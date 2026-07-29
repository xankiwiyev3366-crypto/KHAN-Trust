// POST /.netlify/functions/verification-lifecycle-background
// Authorization: Bearer <admin HMAC token>
//
// The scheduled sweep over paid verifications: expiry reminders, the expiry
// transition itself, renewal nudges, and reconciliation of orders that took
// money and never delivered.
//
// ── SAFE TO RUN TWICE, BY CONSTRUCTION ──────────────────────────────────────
//
// Netlify can and does invoke a schedule more than once, a deploy can overlap a
// run, and an operator can trigger this by hand while it is already running.
// Nothing here relies on running exactly once:
//
//   - Expiry is DERIVED from expiresAt, not from having been swept. A second run
//     over an already-expired order sees status === 'expired' and skips it.
//   - Every notification is enqueued with a dedup key of (order, stage), so the
//     queue collapses repeats before a handler ever sees them, and the mail
//     ledger collapses them again if it does.
//   - releaseContract() is scoped to the holding order id, so re-releasing is a
//     no-op and can never free someone else's live claim.
//
// ── WHAT THIS DOES NOT DO ───────────────────────────────────────────────────
//
// It does not send anything. Every outbound message is a queued job, because
// this function is on a scheduled trigger and a provider outage here would
// otherwise silently drop a day's expiry warnings with no record that they were
// ever attempted. Queueing makes a failed send a visible, retried, dead-letterable
// fact.
//
// It also does NOT rewrite the verification status record on expiry. That is
// deliberate and it matters: resolveBadgeState() already derives EXPIRED from
// the stored expiresAt, so the badge, the JSON endpoint and the public profile
// are correct the instant the clock passes — with no dependency on this sweep
// having run. A system where the badge only expires if a cron fires is a system
// where a missed cron leaves a lapsed verification showing green.
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { readOrders, putOrder, releaseContract, ORDER_STATUS } from './_verificationOrders.mjs';
import { enqueue } from './_eventQueue.mjs';
import { JOB_TYPES, MAIL_STAGES } from './_queueHandlers.mjs';
import { recordEvent } from './_productEvents.mjs';
import { jsonResponse } from './_blobsClient.mjs';
import { PRODUCT_EVENTS } from '../../src/lib/productEvents.js';
import { PROFILE_VERIFICATION } from '../../src/lib/publicProfile.js';

const DAY_MS = 86400000;

// The reminder ladder. Each entry fires once, when the order first falls inside
// its window, and the dedup key is the (order, stage) pair so it can never fire
// twice however often this runs.
//
// WINDOWS, NOT EXACT DAYS. A schedule that fires "when daysLeft === 7" misses
// the reminder entirely if that day's run is skipped — a deploy, an outage, a
// platform hiccup — and the customer is never told. Each rung therefore covers
// the range down to the next one, so a missed day is caught by the following
// run rather than lost.
const REMINDERS = [
  { stage: MAIL_STAGES.EXPIRING_30, days: 30, from: 30, to: 7 },
  { stage: MAIL_STAGES.EXPIRING_7, days: 7, from: 7, to: 1 },
  { stage: MAIL_STAGES.EXPIRING_1, days: 1, from: 1, to: 0 },
];

// How long a PAID order may sit without activating before an operator is told.
// Long enough that a buyer genuinely working through admin review is not
// escalated as a fault; short enough that money taken for nothing surfaces
// within days rather than at the next audit.
const STALE_PAID_DAYS = 3;

// When to nudge a lapsed customer about renewing. Not immediately on expiry —
// that message has already been sent — and not so late the token has moved on.
const RENEWAL_NUDGE_DAYS = 7;

export async function handler(event) {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { message: 'Method not allowed' });
  if (!verifyToken(bearerToken(event))) return jsonResponse(401, { message: 'Unauthorized' });

  const now = Date.now();
  const summary = { scanned: 0, expired: 0, reminders: 0, renewals: 0, stalePaid: 0 };

  try {
    const orders = Object.values(await readOrders());
    summary.scanned = orders.length;

    for (const order of orders) {
      // ── Paid but never activated ────────────────────────────────────────
      if (order.status === ORDER_STATUS.PAID) {
        const paidAt = Date.parse(order.paidAt || order.updatedAt || order.createdAt);
        if (Number.isFinite(paidAt) && now - paidAt > STALE_PAID_DAYS * DAY_MS) {
          summary.stalePaid += 1;
          // Dedup by order and by DAY, not by order alone: this is a condition
          // that persists, and an operator who has not acted on it should be
          // reminded tomorrow — but once tomorrow, not once per run.
          await enqueue({
            type: JOB_TYPES.ADMIN_ALERT,
            dedupKey: `stale-paid:${order.id}:${new Date(now).toISOString().slice(0, 10)}`,
            payload: { kind: 'ownership_review', orderId: order.id, ctx: {} },
          }).catch(() => {});
        }
        continue;
      }

      if (order.status !== ORDER_STATUS.ACTIVE && order.status !== ORDER_STATUS.EXPIRED) continue;

      const expiresAt = Date.parse(order.expiresAt);
      // No expiry means a pre-paid, admin-approved verification that is
      // permanent by design (see isVerificationActive). It has nothing to
      // remind about and must never be swept into expiry.
      if (!Number.isFinite(expiresAt)) continue;

      // ── The expiry transition ───────────────────────────────────────────
      if (expiresAt <= now && order.status === ORDER_STATUS.ACTIVE) {
        const expiredAt = new Date(now).toISOString();
        await putOrder({ ...order, status: ORDER_STATUS.EXPIRED, updatedAt: expiredAt });
        // Free the contract so this owner — or a legitimate later one — can buy
        // verification again. Without this the token is locked out forever.
        await releaseContract(order.contractKey, order.id).catch(() => {});
        summary.expired += 1;

        await recordEvent({
          name: PRODUCT_EVENTS.VERIFICATION_EXPIRED,
          orderId: order.id,
          chain: order.chain,
          contract: order.contract,
          metadata: { tier: order.tierId },
        }).catch(() => {});

        await Promise.all([
          enqueue({
            type: JOB_TYPES.MAIL_SEND,
            dedupKey: `mail:${order.id}:${MAIL_STAGES.EXPIRED}`,
            payload: { orderId: order.id, stage: MAIL_STAGES.EXPIRED },
          }),
          enqueue({
            type: JOB_TYPES.ADMIN_ALERT,
            dedupKey: `alert:expired:${order.id}`,
            payload: { kind: 'expired', orderId: order.id, ctx: {} },
          }),
          enqueue({
            type: JOB_TYPES.WATCH_STATUS,
            dedupKey: `watch:${order.contractKey}:expired`,
            payload: {
              chain: order.chain,
              contract: order.contract,
              state: PROFILE_VERIFICATION.EXPIRED,
              at: expiredAt,
            },
          }),
        ].map((p) => p.catch(() => {})));
        continue;
      }

      // ── Renewal nudge, after the fact ───────────────────────────────────
      if (order.status === ORDER_STATUS.EXPIRED) {
        const sinceExpiry = now - expiresAt;
        if (sinceExpiry >= RENEWAL_NUDGE_DAYS * DAY_MS && sinceExpiry < (RENEWAL_NUDGE_DAYS + 7) * DAY_MS) {
          summary.renewals += 1;
          await enqueue({
            type: JOB_TYPES.MAIL_SEND,
            dedupKey: `mail:${order.id}:${MAIL_STAGES.RENEWAL_REMINDER}`,
            payload: { orderId: order.id, stage: MAIL_STAGES.RENEWAL_REMINDER },
          }).catch(() => {});
        }
        continue;
      }

      // ── Expiry reminders ────────────────────────────────────────────────
      const daysLeft = (expiresAt - now) / DAY_MS;
      for (const rung of REMINDERS) {
        if (daysLeft > rung.from || daysLeft <= rung.to) continue;
        summary.reminders += 1;
        await Promise.all([
          enqueue({
            type: JOB_TYPES.MAIL_SEND,
            dedupKey: `mail:${order.id}:${rung.stage}`,
            payload: { orderId: order.id, stage: rung.stage, days: rung.days },
          }),
          // The operator alert only for the last rung. Telling an admin about
          // every verification 30 days out would be a monthly wall of text
          // nobody reads, which is how the one that mattered gets missed.
          rung.days === 1
            ? enqueue({
              type: JOB_TYPES.ADMIN_ALERT,
              dedupKey: `alert:expiring:${order.id}`,
              payload: { kind: 'expiring', orderId: order.id, ctx: { days: 1 } },
            })
            : Promise.resolve(),
        ].map((p) => p.catch(() => {})));
        break;
      }
    }

    console.log(`[verify-lifecycle] ${JSON.stringify(summary)}`);
    return { statusCode: 202, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, ...summary }) };
  } catch (error) {
    console.error(`[verify-lifecycle] sweep failed: ${error.stack || error.message}`);
    return jsonResponse(500, { message: 'lifecycle sweep failed' });
  }
}
