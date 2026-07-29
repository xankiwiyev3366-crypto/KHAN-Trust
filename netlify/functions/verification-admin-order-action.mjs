// POST /.netlify/functions/verification-admin-order-action
// { orderId, action: 'mark_refunded' | 'revoke' | 'resend_receipt', reason? }
// Authorization: Bearer <admin HMAC token>
//
// Operator actions on a single order. Every one of them is audited, idempotent,
// and — for the destructive ones — requires an explicit confirmation token from
// the caller.
//
// ── WHAT THIS DOES NOT DO, AND WHY ──────────────────────────────────────────
//
// `mark_refunded` does NOT move money. It records that a refund happened.
//
// That is a deliberate limit, not an omission. Sending funds requires the
// treasury's private key, and putting a key that can move money behind an HTTP
// endpoint guarded by a shared passcode would make that passcode the single
// thing standing between an attacker and the treasury. The refund is performed
// by a human from the wallet, and this endpoint records it so the order,
// the customer email and the revenue figures all reflect reality. An operator
// action that only WRITES cannot be turned into a withdrawal.
//
// ── IDEMPOTENCY ─────────────────────────────────────────────────────────────
//
// Each action checks the state it is about to create and returns success
// unchanged if it is already there. A double-clicked "mark refunded" writes one
// refund, records one audit row and queues one email.
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { getOrder, putOrder, releaseContract, ORDER_STATUS } from './_verificationOrders.mjs';
import { readStatuses, writeStatuses } from './_verificationStore.mjs';
import { enqueue } from './_eventQueue.mjs';
import { JOB_TYPES, MAIL_STAGES } from './_queueHandlers.mjs';
import { recordEvent } from './_productEvents.mjs';
import { appendEvent } from './_analyticsStore.mjs';
import { jsonResponse } from './_blobsClient.mjs';
import { PRODUCT_EVENTS } from '../../src/lib/productEvents.js';
import { PROFILE_VERIFICATION } from '../../src/lib/publicProfile.js';

const ACTIONS = new Set(['mark_refunded', 'revoke', 'resend_receipt']);

// Actions that cannot be undone by clicking something else. The client must
// echo the order id back in `confirm` to perform one — a deliberate speed bump
// so a mis-click on a dense table row cannot revoke a live customer's badge.
const DESTRUCTIVE = new Set(['mark_refunded', 'revoke']);

// The audit trail. Written to the EXISTING analytics event log rather than a new
// store, so admin actions sit in the same timeline as everything else that
// happened to a project and one query answers "what happened to this token".
async function audit(action, order, reason) {
  await appendEvent({
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: `admin_${action}`,
    timestamp: new Date().toISOString(),
    visitorId: '',
    isNewVisitor: false,
    device: 'desktop',
    trafficSource: 'other',
    path: '',
    projectId: order.projectId || order.contractKey || '',
    projectName: order.contract,
    ticker: '',
    contract: order.contract,
    trustScore: null,
    // The operator's stated reason, length-capped. Kept because "why was this
    // revoked" six months later is a question the audit log has to answer.
    query: String(reason || '').slice(0, 200),
  }).catch(() => {});
}

export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return jsonResponse(405, { message: 'Method not allowed' });
    if (!verifyToken(bearerToken(event))) return jsonResponse(401, { message: 'Unauthorized' });

    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { message: 'Invalid request body' });
    }

    const action = String(payload.action || '').trim();
    if (!ACTIONS.has(action)) return jsonResponse(400, { message: 'Unknown action' });

    const orderId = String(payload.orderId || '').trim();
    const order = await getOrder(orderId);
    if (!order) return jsonResponse(404, { message: 'Order not found' });

    if (DESTRUCTIVE.has(action) && String(payload.confirm || '') !== order.id) {
      return jsonResponse(428, {
        message: 'This action changes a customer’s paid product. Confirm by echoing the order id.',
        reason: 'confirmation_required',
      });
    }

    const now = new Date().toISOString();

    if (action === 'mark_refunded') {
      if (order.status === ORDER_STATUS.REFUNDED) {
        return jsonResponse(200, { ok: true, unchanged: true, status: order.status });
      }
      const refunded = {
        ...order,
        status: ORDER_STATUS.REFUNDED,
        // The state it was in when the refund happened. Preserved because
        // "refunded from duplicate" and "refunded from active" are different
        // events commercially, and the status field can only hold one of them.
        refundedFrom: order.status,
        refundedAt: now,
        refundReason: String(payload.reason || '').slice(0, 200),
        updatedAt: now,
      };
      await putOrder(refunded);
      // A refunded order no longer holds the contract. Without releasing it, the
      // token stays locked and neither this owner nor a later one could ever buy
      // verification for it again.
      await releaseContract(order.contractKey, order.id).catch(() => {});

      // The public verification record must stop claiming a live verification
      // for a purchase that was returned.
      if (order.status === ORDER_STATUS.ACTIVE) {
        const projectId = order.projectId || order.contractKey;
        const statuses = await readStatuses();
        if (statuses[projectId]) {
          statuses[projectId] = { ...statuses[projectId], status: 'revoked', revokedAt: now, updatedAt: now };
          await writeStatuses(statuses);
        }
      }

      await Promise.allSettled([
        enqueue({ type: JOB_TYPES.MAIL_SEND, dedupKey: `mail:${order.id}:${MAIL_STAGES.REFUNDED}`, payload: { orderId: order.id, stage: MAIL_STAGES.REFUNDED } }),
        recordEvent({
          name: PRODUCT_EVENTS.VERIFICATION_REFUNDED,
          orderId: order.id,
          chain: order.chain,
          contract: order.contract,
          metadata: { tier: order.tierId, usd: order.usd, from: order.status },
        }),
        order.status === ORDER_STATUS.ACTIVE
          ? enqueue({
            type: JOB_TYPES.WATCH_STATUS,
            dedupKey: `watch:${order.contractKey}:revoked:${now.slice(0, 10)}`,
            payload: { chain: order.chain, contract: order.contract, state: PROFILE_VERIFICATION.REVOKED, at: now },
          })
          : Promise.resolve(),
      ]);
      await audit(action, order, payload.reason);
      return jsonResponse(200, { ok: true, status: ORDER_STATUS.REFUNDED });
    }

    if (action === 'revoke') {
      if (order.status === ORDER_STATUS.REVOKED) {
        return jsonResponse(200, { ok: true, unchanged: true, status: order.status });
      }
      const revoked = {
        ...order,
        status: ORDER_STATUS.REVOKED,
        revokedAt: now,
        revokeReason: String(payload.reason || '').slice(0, 200),
        updatedAt: now,
      };
      await putOrder(revoked);
      await releaseContract(order.contractKey, order.id).catch(() => {});

      const projectId = order.projectId || order.contractKey;
      const statuses = await readStatuses();
      // MERGED, never replaced — the same defect verification-admin-review.mjs
      // documents: a fresh object literal here would destroy tier, orderId and
      // badgeToken, and a record with no expiresAt reads as PERMANENT.
      statuses[projectId] = {
        ...(statuses[projectId] || {}),
        status: 'revoked',
        revokedAt: now,
        updatedAt: now,
        ownerWallet: null,
      };
      await writeStatuses(statuses);

      await Promise.allSettled([
        enqueue({ type: JOB_TYPES.MAIL_SEND, dedupKey: `mail:${order.id}:${MAIL_STAGES.REVOKED}`, payload: { orderId: order.id, stage: MAIL_STAGES.REVOKED } }),
        enqueue({
          type: JOB_TYPES.WATCH_STATUS,
          dedupKey: `watch:${order.contractKey}:revoked:${now.slice(0, 10)}`,
          payload: { chain: order.chain, contract: order.contract, state: PROFILE_VERIFICATION.REVOKED, at: now },
        }),
        recordEvent({
          name: PRODUCT_EVENTS.VERIFICATION_REVOKED,
          orderId: order.id,
          chain: order.chain,
          contract: order.contract,
          metadata: { source: 'admin_action' },
        }),
      ]);
      await audit(action, order, payload.reason);
      return jsonResponse(200, { ok: true, status: ORDER_STATUS.REVOKED });
    }

    // resend_receipt — non-destructive, so no confirmation.
    //
    // THIS IS A RECOVERY ACTION, NOT A RESEND, and the distinction is worth
    // stating because the name invites the wrong expectation. The per-(order,
    // stage) mail ledger is what makes retries safe everywhere else in this
    // system, and it applies here too: if the activation email was already
    // delivered, this will NOT send a second one. What it fixes is the case the
    // requirement actually asks about — the receipt job died, the ledger has no
    // entry, and the customer has nothing. Then it generates and sends.
    //
    // Deliberately not given a bypass. An operator-triggered duplicate email is
    // still a duplicate email, and "the customer says they did not get it" is
    // usually a spam folder rather than a missing send — the response below
    // reports what was queued so the operator can tell which case they are in.
    await Promise.allSettled([
      enqueue({ type: JOB_TYPES.RECEIPT_ENSURE, dedupKey: `receipt:resend:${order.id}:${now.slice(0, 10)}`, payload: { orderId: order.id } }),
      enqueue({ type: JOB_TYPES.MAIL_SEND, dedupKey: `mail:resend:${order.id}:${now.slice(0, 10)}`, payload: { orderId: order.id, stage: MAIL_STAGES.ACTIVATED } }),
    ]);
    await audit(action, order, payload.reason);
    return jsonResponse(200, { ok: true, queued: true });
  } catch (error) {
    console.error(`[verify-admin-order-action] failed: ${error.stack || error.message}`);
    return jsonResponse(500, { message: 'Action failed.' });
  }
}
