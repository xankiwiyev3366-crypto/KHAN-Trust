// What each queued job actually does.
//
// ── EVERY HANDLER IS IDEMPOTENT, AND NOT AS A COURTESY ──────────────────────
//
// _eventQueue.mjs is explicit that without DATABASE_URL its lease is racy, and
// that the design tolerates this because the handlers absorb a double delivery.
// This file is where that promise is either kept or broken, so each handler
// below states the mechanism that makes re-running it a no-op:
//
//   receipt.ensure    ensureReceipt() is write-once and returns the existing
//                     record unchanged.
//   mail.send         a per-(order, stage) ledger, written only after the
//                     provider accepts.
//   admin.alert       NOT deduplicated — see its note. A duplicate Telegram line
//                     is noise; a missing one is a missed refund.
//   watch.enroll      an add-if-absent over the subscription's own token list.
//   watch.status      notification ids are derived from (identity, state, day),
//                     and addNotifications() skips ids it already holds.
//
// ── HANDLERS RETURN, THEY DO NOT THROW FOR CONTROL FLOW ─────────────────────
//
// A handler returns { ok, retryable, reason }. A THROWN error is treated as
// retryable by the worker, which is the right default for an unexpected fault —
// but "this order has no email address" is not a fault and must not consume five
// retries and a dead-letter slot. The distinction is the difference between a
// dead-letter shelf an operator reads and one they learn to ignore.
import { getOrder, ORDER_STATUS } from './_verificationOrders.mjs';
import { ensureReceipt, getReceipt } from './_verificationReceipts.mjs';
import { sendVerificationEmailOnce, MAIL_STAGES } from './_verificationEmails.mjs';
import { notifyAdmin } from './_verificationAlerts.mjs';
import { getSubscription, saveSubscription, listSubscriptions } from './_alertsStore.mjs';
import { addNotifications } from './_notificationStore.mjs';
import { resolveUserTier, TIER } from './_watchTiers.mjs';
import { recordEvent } from './_productEvents.mjs';
import { isAccountSubject } from './_entitlementsStore.mjs';
import { siteOrigin } from './_badgeState.mjs';
import { tokenIdentity } from '../../src/lib/tokenIdentity.js';
import { profileUrlFor, PROFILE_VERIFICATION } from '../../src/lib/publicProfile.js';
import { PRODUCT_EVENTS } from '../../src/lib/productEvents.js';

export const JOB_TYPES = {
  RECEIPT_ENSURE: 'receipt.ensure',
  MAIL_SEND: 'mail.send',
  ADMIN_ALERT: 'admin.alert',
  WATCH_ENROLL: 'watch.enroll',
  WATCH_STATUS: 'watch.status',
};

// ── receipt.ensure ──────────────────────────────────────────────────────────

async function handleReceiptEnsure(payload) {
  const order = await getOrder(payload.orderId);
  if (!order) return { ok: false, retryable: false, reason: 'order_not_found' };
  // Deliberately NOT gated on status === 'active'. A receipt is a record of a
  // PAYMENT, and an order that was paid and later expired still had money change
  // hands. Refusing to generate the receipt because the badge has since lapsed
  // would leave the one customer most likely to need proof of purchase without
  // any.
  if (!order.paymentSignature && order.status !== ORDER_STATUS.ACTIVE) {
    return { ok: false, retryable: false, reason: 'not_paid' };
  }
  const result = await ensureReceipt(order, { origin: siteOrigin() });
  return { ok: result.ok, retryable: false, reason: result.reason || '', created: result.created };
}

// ── mail.send ───────────────────────────────────────────────────────────────

async function handleMailSend(payload) {
  const order = await getOrder(payload.orderId);
  if (!order) return { ok: false, retryable: false, reason: 'order_not_found' };

  // The receipt is looked up rather than created here: a mail job must not be
  // the thing that mints a financial record, or a retry storm on the email
  // provider would be writing receipts.
  const receipt = await getReceipt(order.id).catch(() => null);

  const origin = siteOrigin();
  const result = await sendVerificationEmailOnce({
    order,
    stage: payload.stage,
    ctx: {
      receipt,
      profileUrl: profileUrlFor(origin, order.chain, order.contract),
      badgeUrl: `${origin}/badge/${encodeURIComponent(order.chain)}/${encodeURIComponent(order.contract)}`,
      renewUrl: `${origin}/#/verify?contract=${encodeURIComponent(order.contract)}&chain=${encodeURIComponent(order.chain)}`,
      days: payload.days,
    },
  });
  return { ok: result.ok, retryable: Boolean(result.retryable), reason: result.reason || result.skipped || '' };
}

// ── admin.alert ─────────────────────────────────────────────────────────────

// NOT DEDUPLICATED, on purpose, and this is the one place that choice is made
// consciously rather than by omission.
//
// Every other handler here suppresses a repeat. An operator alert is the
// opposite trade: the cost of a duplicate line in a Telegram group is that
// somebody scrolls past it; the cost of a suppressed one is a duplicate sale
// that never got refunded because the notification was deduped against an
// earlier, unrelated message. Noise is recoverable, silence is not.
async function handleAdminAlert(payload) {
  const ctx = { ...payload.ctx };
  if (payload.orderId) {
    const order = await getOrder(payload.orderId).catch(() => null);
    if (order) ctx.order = order;
  }
  if (!ctx.order && payload.kind !== 'dead_letter' && payload.kind !== 'reconciliation' && payload.kind !== 'payment_failure') {
    return { ok: false, retryable: false, reason: 'order_not_found' };
  }
  const result = await notifyAdmin(payload.kind, ctx);
  return { ok: result.ok, retryable: Boolean(result.retryable), reason: result.reason || result.skipped || '' };
}

// ── watch.enroll ────────────────────────────────────────────────────────────
//
// A verified owner gets their own token into the Watchtower lane automatically.
// This is the "verified owners automatically receive the intended monitoring"
// requirement, and it is done by ADDING to the existing subscription rather than
// through toggleToken() — which, as its name says, would REMOVE the token if the
// owner had already added it themselves. A retried job would then silently
// un-watch the one token they most wanted watched.
//
// The per-plan cap is deliberately not enforced here. A paying verification
// customer being refused monitoring of the token they just paid to verify,
// because they are at their free-tier watch limit, would be an absurd outcome;
// the hard 100-token ceiling in _alertsStore still bounds the blob.
async function handleWatchEnroll(payload) {
  const order = await getOrder(payload.orderId);
  if (!order) return { ok: false, retryable: false, reason: 'order_not_found' };
  if (!isAccountSubject(order.buyerSubject || '')) {
    // A wallet-only buyer has no account to attach a watch to. Not a failure.
    return { ok: true, retryable: false, reason: 'no_account' };
  }
  const userId = order.buyerSubject.slice(2);
  const identity = tokenIdentity({ contract: order.contract, chainId: order.chain });
  if (!identity) return { ok: false, retryable: false, reason: 'no_identity' };

  const sub = await getSubscription(userId);
  sub.userId = userId;
  if (!Array.isArray(sub.tokens)) sub.tokens = [];
  if (sub.tokens.some((entry) => entry.identity === identity)) {
    return { ok: true, retryable: false, reason: 'already_watching' };
  }
  sub.tokens = [{
    identity,
    contract: order.contract,
    chain: order.chain,
    name: '',
    ticker: '',
  }, ...sub.tokens].slice(0, 100);
  await saveSubscription(sub);
  return { ok: true, retryable: false, reason: 'enrolled' };
}

// ── watch.status ────────────────────────────────────────────────────────────
//
// Tells everyone WATCHING a token that its verification status changed.
//
// WHY THIS IS A risk_alert AND NOT A NEW NOTIFICATION TYPE FOR EACH STATE:
// _notificationStore's header says its two types exist because "nothing here
// exists to manufacture a reason to ping someone". A verification being revoked
// on a token you are actively watching is not manufactured — it is the single
// most material trust event that can happen to a project short of a rug, and it
// is precisely what the user opted into being told about. It gets the existing
// risk channel. The one new type, `verification_status`, exists so the bell can
// render the neutral/positive transitions (a token you watch BECOMING verified)
// without dressing them up as risk.
//
// PREMIUM-GATED, as required — but only for the positive transition. A REVOCATION
// is delivered to every watcher regardless of plan: withholding "this token's
// verification was withdrawn" from a free user in order to sell them an upgrade
// would be monetising the exact harm the product claims to prevent.
const STATUS_COPY = {
  [PROFILE_VERIFICATION.ACTIVE]: { severity: 'info', key: 'verificationActive', premiumOnly: true },
  [PROFILE_VERIFICATION.EXPIRED]: { severity: 'warning', key: 'verificationExpired', premiumOnly: true },
  [PROFILE_VERIFICATION.REVOKED]: { severity: 'critical', key: 'verificationRevoked', premiumOnly: false },
};

async function handleWatchStatus(payload) {
  const state = payload.state;
  const copy = STATUS_COPY[state];
  if (!copy) return { ok: false, retryable: false, reason: 'unknown_state' };

  const identity = tokenIdentity({ contract: payload.contract, chainId: payload.chain });
  if (!identity) return { ok: false, retryable: false, reason: 'no_identity' };

  const subs = await listSubscriptions();
  const watchers = subs.filter((sub) => (sub?.tokens || []).some((t) => t.identity === identity));
  if (!watchers.length) return { ok: true, retryable: false, reason: 'no_watchers' };

  const origin = siteOrigin();
  const link = profileUrlFor(origin, payload.chain, payload.contract);
  // Derived from the transition, never from the clock — a re-run of this job
  // produces the same id and addNotifications() drops it.
  const day = new Date(payload.at || Date.now()).toISOString().slice(0, 10);
  const id = `verif:${identity}:${state}:${day}`;

  let delivered = 0;
  for (const sub of watchers) {
    if (copy.premiumOnly) {
      const tier = await resolveUserTier(sub.userId).catch(() => TIER.FREE);
      if (tier !== TIER.PREMIUM) continue;
    }
    const token = (sub.tokens || []).find((t) => t.identity === identity) || {};
    const written = await addNotifications(sub.userId, [{
      id,
      type: 'verification_status',
      severity: copy.severity,
      titleKey: `notifications.${copy.key}.title`,
      bodyKey: `notifications.${copy.key}.body`,
      params: { name: token.name || token.ticker || payload.contract },
      link,
      at: new Date(payload.at || Date.now()).toISOString(),
    }]);
    if (written.length) delivered += 1;
  }

  await recordEvent({
    name: PRODUCT_EVENTS.ALERT_FIRED,
    chain: payload.chain,
    contract: payload.contract,
    metadata: { kind: 'verification_status', state, delivered },
  }).catch(() => {});

  return { ok: true, retryable: false, reason: `delivered:${delivered}` };
}

// ── Dispatch ────────────────────────────────────────────────────────────────

const HANDLERS = {
  [JOB_TYPES.RECEIPT_ENSURE]: handleReceiptEnsure,
  [JOB_TYPES.MAIL_SEND]: handleMailSend,
  [JOB_TYPES.ADMIN_ALERT]: handleAdminAlert,
  [JOB_TYPES.WATCH_ENROLL]: handleWatchEnroll,
  [JOB_TYPES.WATCH_STATUS]: handleWatchStatus,
};

export function hasHandler(type) {
  return Boolean(HANDLERS[type]);
}

// An unknown type is NOT retryable. It means a job was enqueued by code that no
// longer exists (a rolled-back deploy, a renamed constant), and retrying it five
// times cannot make the handler reappear — it just delays the dead-letter that
// tells an operator about the orphan.
export async function runJob(job) {
  const handler = HANDLERS[job.type];
  if (!handler) return { ok: false, retryable: false, reason: 'unknown_job_type' };
  return handler(job.payload || {}, job);
}

export { MAIL_STAGES };
