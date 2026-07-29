import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { readRequests, writeRequests, readStatuses, writeStatuses, jsonResponse } from './_verificationStore.mjs';
import { appendEvent } from './_analyticsStore.mjs';
import { getOrder, putOrder, claimContract, releaseContract, ORDER_STATUS } from './_verificationOrders.mjs';
import { recordEvent } from './_productEvents.mjs';
import { enqueue } from './_eventQueue.mjs';
import { JOB_TYPES, MAIL_STAGES } from './_queueHandlers.mjs';
import { expiryFromNow } from '../../src/lib/verificationTiers.js';
import { PRODUCT_EVENTS } from '../../src/lib/productEvents.js';
import { PROFILE_VERIFICATION } from '../../src/lib/publicProfile.js';

// TWO DEFECTS FIXED HERE IN PHASE 3, BOTH FOUND BY ASKING WHAT THE BADGE WIDGET
// IS ACTUALLY ALLOWED TO CLAIM.
//
// 1. APPROVAL USED TO ERASE THE PAID TERM.
//
//    This handler wrote a brand-new status object — {status, updatedAt,
//    adminNote, ownerWallet} — over whatever was already there. For the free
//    flow that was harmless. For a PAID order it silently destroyed expiresAt,
//    tier, orderId and badgeToken, and because isVerificationActive() treats a
//    record with no expiresAt as PERMANENT (correctly: that is what every
//    pre-paid admin approval looks like), a customer's 365-day product quietly
//    became a forever badge the moment a reviewer approved it.
//
//    Paid verification routes every buyer who cannot prove mint authority
//    through exactly this screen, so it was the normal path, not an edge case.
//    The status record is now MERGED, and the term starts at APPROVAL — the
//    buyer was not verified while they sat in the queue, and charging them for
//    that time would be taking days they paid for.
//
// 2. THERE WAS NO WAY TO REVOKE.
//
//    The vocabulary was {verified, rejected}, and 'rejected' is a verdict on a
//    pending REQUEST — it cannot express "this was verified and we are
//    withdrawing it". A verification product that can only ever grant is not
//    one: the badge's worth comes from the fact that it can be taken away.
//    'revoked' is now a third decision, it outranks the clock in
//    resolveBadgeState(), and it releases the contract's exclusivity claim so
//    the token is not locked out of ever being verified again.
const VALID_DECISIONS = new Set(['verified', 'rejected', 'revoked']);

export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { message: 'Method not allowed' });
    }
    if (!verifyToken(bearerToken(event))) {
      return jsonResponse(401, { message: 'Unauthorized' });
    }

    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { message: 'Invalid request body' });
    }

    if (!VALID_DECISIONS.has(payload.decision)) {
      return jsonResponse(400, { message: 'Decision must be "verified", "rejected" or "revoked".' });
    }

    const requests = await readRequests();
    const request = requests.find((item) => item.id === payload.requestId);
    if (!request) {
      return jsonResponse(404, { message: 'Verification request not found.' });
    }

    const reviewedAt = new Date().toISOString();
    request.status = payload.decision;
    request.adminNote = payload.adminNote || '';
    request.reviewedAt = reviewedAt;
    await writeRequests(requests);

    const statuses = await readStatuses();
    // MERGE, never replace. Everything paid verification wrote onto this record
    // (tier, orderId, badgeToken, ownershipMethod) has to survive a review, and
    // a fresh object literal is exactly how it stopped surviving.
    const existing = statuses[request.projectId] || {};

    // Is there a paid order behind this request? verify-order-activate.mjs
    // stamps `paidOrderId` and `tier` onto the queue entry when a buyer proves
    // a wallet but not its link to the token.
    const order = request.paidOrderId ? await getOrder(request.paidOrderId).catch(() => null) : null;

    if (payload.decision === 'verified') {
      const expiresAt = order
        ? expiryFromNow(order.tierId, Date.parse(reviewedAt))
        : (existing.expiresAt || '');

      if (order) {
        // DUPLICATE PROTECTION, taken at the moment the badge actually goes
        // live. Another team's order for the same contract may have completed
        // while this one waited in the queue, so the claim is made here rather
        // than assumed from the earlier payment.
        const claim = await claimContract({ ...order, expiresAt });
        if (!claim.won) {
          // Do NOT verify. The payment stays recorded and refundable, exactly
          // as the automatic path handles it, and the reviewer is told plainly
          // instead of the platform quietly issuing a second badge for one
          // token. The request goes back to pending so it is not lost.
          await putOrder({
            ...order,
            status: ORDER_STATUS.DUPLICATE,
            supersededBy: claim.heldBy || '',
            updatedAt: reviewedAt,
          });
          request.status = 'pending';
          request.adminNote = `${request.adminNote} [blocked: another verification holds this contract]`.trim();
          await writeRequests(requests);
          return jsonResponse(409, {
            message: 'Another verification already holds this contract. The payment is recorded and refundable.',
            reason: 'duplicate',
          });
        }
        await putOrder({
          ...order,
          status: ORDER_STATUS.ACTIVE,
          ownershipMethod: order.ownershipMethod || 'admin_review',
          activatedAt: reviewedAt,
          expiresAt,
          updatedAt: reviewedAt,
        });
      }

      statuses[request.projectId] = {
        ...existing,
        status: 'verified',
        updatedAt: reviewedAt,
        adminNote: request.adminNote,
        // ownerWallet rides along on approval so the frontend can restrict
        // project editing to the verified owner (see canEditProject in
        // src/main.jsx) without a second round-trip - it's already public data,
        // shown elsewhere in the admin panel.
        ownerWallet: request.ownerWallet,
        ...(expiresAt ? { expiresAt } : {}),
        ...(order ? { tier: order.tierId, orderId: order.id, ownershipMethod: order.ownershipMethod || 'admin_review' } : {}),
        // Clear any earlier revocation — this record has just been granted again.
        revokedAt: '',
      };
    } else if (payload.decision === 'revoked') {
      statuses[request.projectId] = {
        ...existing,
        status: 'revoked',
        updatedAt: reviewedAt,
        revokedAt: reviewedAt,
        adminNote: request.adminNote,
        ownerWallet: null,
      };
      if (order) {
        await putOrder({ ...order, status: ORDER_STATUS.REVOKED, revokedAt: reviewedAt, updatedAt: reviewedAt });
        // Release the exclusivity claim. Without this the contract stays locked
        // forever and neither this owner nor a legitimate later one could ever
        // buy verification for it again.
        await releaseContract(order.contractKey, order.id).catch(() => {});
      }
    } else {
      // 'rejected'. A verdict on the REQUEST, which the badge reports as
      // Unverified — a private review outcome is not something to publish on
      // the applicant's own website. See resolveBadgeState().
      statuses[request.projectId] = {
        ...existing,
        status: 'rejected',
        updatedAt: reviewedAt,
        adminNote: request.adminNote,
        ownerWallet: null,
      };
    }

    await writeStatuses(statuses);

    // ── Phase 5 lifecycle, for the REVIEW path ──────────────────────────────
    //
    // A verification approved here is, to the customer, indistinguishable from
    // one activated automatically — so it must produce the same receipt, the
    // same email, the same Watchtower enrolment and the same watcher
    // notification. Without this, every buyer who could not prove mint authority
    // (which is the normal path for most chains) would silently receive none of
    // it. All queued and all keyed on the ORDER, so a reviewer who clicks twice
    // cannot send two of anything.
    const lifecycle = [];
    if (payload.decision === 'verified' && order) {
      lifecycle.push(
        enqueue({ type: JOB_TYPES.RECEIPT_ENSURE, dedupKey: `receipt:${order.id}`, payload: { orderId: order.id } }),
        enqueue({ type: JOB_TYPES.MAIL_SEND, dedupKey: `mail:${order.id}:${MAIL_STAGES.ACTIVATED}`, payload: { orderId: order.id, stage: MAIL_STAGES.ACTIVATED } }),
        enqueue({ type: JOB_TYPES.WATCH_ENROLL, dedupKey: `enroll:${order.id}`, payload: { orderId: order.id } }),
        enqueue({
          type: JOB_TYPES.WATCH_STATUS,
          dedupKey: `watch:${order.contractKey}:active`,
          payload: { chain: order.chain, contract: order.contract, state: PROFILE_VERIFICATION.ACTIVE, at: reviewedAt },
        }),
        recordEvent({
          name: PRODUCT_EVENTS.VERIFICATION_ACTIVATED,
          orderId: order.id,
          chain: order.chain,
          contract: order.contract,
          metadata: { tier: order.tierId, usd: order.usd, method: 'admin_review' },
        }),
      );
    } else if (payload.decision === 'revoked') {
      // A revocation is delivered to the owner AND to every watcher, and the
      // watcher notification is deliberately not Premium-gated (see
      // handleWatchStatus): withholding "this token's verification was
      // withdrawn" from free users to sell an upgrade would monetise the exact
      // harm the product exists to prevent.
      if (order) {
        lifecycle.push(
          enqueue({ type: JOB_TYPES.MAIL_SEND, dedupKey: `mail:${order.id}:${MAIL_STAGES.REVOKED}`, payload: { orderId: order.id, stage: MAIL_STAGES.REVOKED } }),
          enqueue({ type: JOB_TYPES.ADMIN_ALERT, dedupKey: `alert:revoked:${order.id}`, payload: { kind: 'revoked', orderId: order.id, ctx: {} } }),
          enqueue({
            type: JOB_TYPES.WATCH_STATUS,
            dedupKey: `watch:${order.contractKey}:revoked:${reviewedAt.slice(0, 10)}`,
            payload: { chain: order.chain, contract: order.contract, state: PROFILE_VERIFICATION.REVOKED, at: reviewedAt },
          }),
        );
      }
      lifecycle.push(recordEvent({
        name: PRODUCT_EVENTS.VERIFICATION_REVOKED,
        orderId: order?.id || '',
        projectId: request.projectId,
        chain: order?.chain || '',
        contract: request.contract || order?.contract || '',
        metadata: { source: 'admin_review' },
      }));
    } else if (payload.decision === 'rejected' && order) {
      lifecycle.push(
        enqueue({ type: JOB_TYPES.MAIL_SEND, dedupKey: `mail:${order.id}:${MAIL_STAGES.OWNERSHIP_FAILED}`, payload: { orderId: order.id, stage: MAIL_STAGES.OWNERSHIP_FAILED } }),
      );
    }
    // Awaited, unlike the activation path: this is an ADMIN request, not a
    // customer-facing one. There is no buyer waiting on the response, the
    // reviewer benefits from knowing the follow-up was actually scheduled, and
    // allSettled means a failed enqueue still cannot fail the review.
    for (const result of await Promise.allSettled(lifecycle)) {
      if (result.status === 'rejected') {
        console.warn(`[verify-review] lifecycle enqueue failed (non-fatal): ${result.reason?.message || result.reason}`);
      }
    }

    await appendEvent({
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: payload.decision === 'verified'
        ? 'verification_approved'
        : (payload.decision === 'revoked' ? 'verification_revoked' : 'verification_rejected'),
      timestamp: reviewedAt,
      visitorId: '',
      isNewVisitor: false,
      device: 'desktop',
      trafficSource: 'other',
      path: '',
      projectId: request.projectId,
      projectName: request.projectName,
      ticker: '',
      contract: request.contract,
      trustScore: null,
      query: '',
    }).catch(() => {});

    return jsonResponse(200, { ok: true, request });
  } catch (error) {
    return jsonResponse(500, { message: `verification-admin-review crashed: ${error.message}` });
  }
}
