// GET /.netlify/functions/verification-admin-orders?status=<status>
// Authorization: Bearer <admin HMAC token>
//
// The operator's view of every verification order and every verified project.
//
// verification-admin-list.mjs already returns the REVIEW QUEUE — pending
// ownership requests — and is untouched. This is the commercial view beside it:
// what was sold, what is live, what is about to lapse, and what took money and
// never delivered. Those are different questions asked by the same person at
// different times, and answering both from one endpoint would mean the review
// screen loading every historical order to render a five-row queue.
//
// ── WHAT AN ADMIN SEES THAT A CUSTOMER DOES NOT ─────────────────────────────
//
// Everything, including the payment signature and payer wallet — this is the
// screen where a refund gets traced, and a refund cannot be traced without them.
// That is precisely why the endpoint is behind the admin HMAC and why the
// TELEGRAM alerts deliberately carry none of it (see _verificationAlerts.mjs):
// the console is an authenticated surface, a group chat is not.
//
// What is NOT here: nothing is computed from these rows that could be recomputed
// wrongly. `derivedStatus` is resolved through isVerificationActive(), the same
// predicate the badge uses, so an order the badge treats as expired can never
// appear "Active" on this screen.
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { readOrders, ORDER_STATUS } from './_verificationOrders.mjs';
import { jsonResponse } from './_blobsClient.mjs';
import { isVerificationActive } from '../../src/lib/verificationTiers.js';

const DAY_MS = 86400000;
const EXPIRING_SOON_DAYS = 30;

// The live status, derived rather than trusted.
//
// A stored status of 'active' on an order whose term ran out yesterday is not a
// lie, it is just stale — the expiry sweep runs daily and the badge derives
// expiry from the clock without waiting for it. This screen must agree with the
// badge, not with the sweep's last run.
export function derivedStatus(order, now = Date.now()) {
  if (order.status !== ORDER_STATUS.ACTIVE) return order.status;
  const live = isVerificationActive(
    { status: 'verified', expiresAt: order.expiresAt, revokedAt: order.revokedAt },
    now,
  );
  return live ? ORDER_STATUS.ACTIVE : ORDER_STATUS.EXPIRED;
}

export function summarise(orders, now = Date.now()) {
  const counts = {};
  let expiringSoon = 0;
  let revenue = 0;
  for (const order of orders) {
    const status = derivedStatus(order, now);
    counts[status] = (counts[status] || 0) + 1;
    if (status === ORDER_STATUS.ACTIVE) {
      const expires = Date.parse(order.expiresAt);
      if (Number.isFinite(expires) && expires - now <= EXPIRING_SOON_DAYS * DAY_MS) expiringSoon += 1;
    }
    // Revenue counts every order that was actually PAID, including ones that
    // later expired, were revoked, or turned out to be duplicates. Money that
    // changed hands is money that changed hands; a revenue figure that shrinks
    // when a badge is revoked would be wrong in the direction that matters to an
    // accountant. Refunds are subtracted separately below.
    if (order.paymentSignature && order.status !== ORDER_STATUS.REFUNDED) {
      revenue += Number(order.usd) || 0;
    }
  }
  return { counts, expiringSoon, revenue };
}

export async function handler(event) {
  try {
    if (event.httpMethod !== 'GET') return jsonResponse(405, { message: 'Method not allowed' });
    if (!verifyToken(bearerToken(event))) return jsonResponse(401, { message: 'Unauthorized' });

    const now = Date.now();
    const all = Object.values(await readOrders());
    const wanted = String(event.queryStringParameters?.status || 'all').trim();

    const rows = all
      .map((order) => ({
        id: order.id,
        chain: order.chain,
        contract: order.contract,
        contractKey: order.contractKey,
        tier: order.tierId,
        usd: order.usd,
        status: derivedStatus(order, now),
        storedStatus: order.status,
        ownershipMethod: order.ownershipMethod || '',
        ownerWallet: order.ownerWallet || '',
        paymentSignature: order.paymentSignature || '',
        paymentCurrency: order.paymentCurrency || '',
        amountPaid: order.amountPaid ?? null,
        quoteScore: order.quoteScore ?? null,
        supersededBy: order.supersededBy || '',
        refundedAt: order.refundedAt || '',
        createdAt: order.createdAt,
        paidAt: order.paidAt || '',
        activatedAt: order.activatedAt || '',
        expiresAt: order.expiresAt || '',
        revokedAt: order.revokedAt || '',
        daysToExpiry: Number.isFinite(Date.parse(order.expiresAt))
          ? Math.round((Date.parse(order.expiresAt) - now) / DAY_MS)
          : null,
      }))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    const filtered = wanted === 'all' ? rows : rows.filter((row) => row.status === wanted);

    return jsonResponse(200, {
      orders: filtered,
      total: rows.length,
      ...summarise(all, now),
      // Every status the UI may filter by, from the vocabulary itself rather
      // than from whatever happens to be present today — so a status with zero
      // orders still renders its (empty) tab instead of silently vanishing.
      statuses: Object.values(ORDER_STATUS),
    });
  } catch (error) {
    console.error(`[verify-admin-orders] failed: ${error.stack || error.message}`);
    return jsonResponse(500, { message: 'Could not load orders.' });
  }
}
