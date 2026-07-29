// GET /.netlify/functions/verify-receipt?orderId=<id>
// Authorization: Bearer <account JWT>   and/or   x-khan-wallet-auth: <token>
//
// The JSON transport of a verification receipt, for the SPA's post-purchase
// success screen. Same record and the SAME authorisation check as the printable
// page (receipt-page.mjs) — canViewReceipt() is imported rather than restated,
// because two copies of an access rule is how one of them ends up more
// permissive than the other and nobody notices until it matters.
//
// SELF-SERVICE RECOVERY. When the receipt job has not completed yet this
// answers 202 with `pending: true` rather than 404, so the client can poll
// instead of showing a buyer who has just paid $149 a "not found" screen.
import { verifyJwt, bearerToken } from './_authStore.mjs';
import { provenWallet } from './_walletSession.mjs';
import { verifyToken } from './_adminAuth.mjs';
import { getOrder } from './_verificationOrders.mjs';
import { getReceipt, ensureReceipt, canViewReceipt } from './_verificationReceipts.mjs';
import { accountSubject, jsonResponse } from './_entitlementsStore.mjs';
import { siteOrigin } from './_badgeState.mjs';
import { ORDER_STATUS } from './_verificationOrders.mjs';

export async function handler(event) {
  try {
    if (event.httpMethod !== 'GET') return jsonResponse(405, { message: 'Method not allowed' });

    const orderId = String(event.queryStringParameters?.orderId || '').trim();
    if (!orderId) return jsonResponse(400, { message: 'orderId is required' });

    const token = bearerToken(event);
    const auth = verifyJwt(token);
    const wallet = provenWallet(event);
    const isAdmin = verifyToken(token);

    const order = await getOrder(orderId);
    const allowed = canViewReceipt({
      order,
      accountSubject: auth?.sub ? accountSubject(auth.sub) : '',
      wallet,
      isAdmin,
    });

    // 403 for both "no such order" and "not yours", never 404. Distinguishing
    // them would make this endpoint an oracle for which order ids exist — see
    // the header of receipt-page.mjs on why the id space is guessable enough for
    // that to matter.
    if (!allowed) return jsonResponse(403, { message: 'This receipt is not available to you.' });

    let receipt = await getReceipt(orderId);

    // RECOVERY PATH. If the order is genuinely paid but no receipt exists — the
    // queue job failed, or was dead-lettered, or this deploy predates it — the
    // rightful owner asking for their own receipt is sufficient reason to write
    // it now. ensureReceipt() is write-once, so this can never produce a second
    // one or overwrite the original.
    if (!receipt && order && (order.paymentSignature || order.status === ORDER_STATUS.ACTIVE)) {
      const created = await ensureReceipt(order, { origin: siteOrigin() }).catch(() => null);
      receipt = created?.receipt || null;
    }

    if (!receipt) {
      return {
        statusCode: 202,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify({
          pending: true,
          orderId,
          message: 'Your receipt is being generated.',
        }),
      };
    }

    return {
      statusCode: 200,
      // Never cached by a shared cache: this response is per-customer.
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private' },
      body: JSON.stringify({ ok: true, receipt }),
    };
  } catch (error) {
    console.error(`[verify-receipt] failed: ${error.stack || error.message}`);
    return jsonResponse(500, { message: 'Could not load this receipt.' });
  }
}
