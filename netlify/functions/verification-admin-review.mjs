import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { readRequests, writeRequests, readStatuses, writeStatuses, jsonResponse } from './_verificationStore.mjs';
import { appendEvent } from './_analyticsStore.mjs';
import { getOrder, putOrder, claimContract, releaseContract, ORDER_STATUS } from './_verificationOrders.mjs';
import { expiryFromNow } from '../../src/lib/verificationTiers.js';

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
