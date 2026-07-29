// GET /.netlify/functions/verify-order-status?orderId=<id>
//
// What the buyer's screen polls between submitting a payment and the badge
// going live. Read-only; it never advances the order.
//
// WHY THIS IS AUTHENTICATED WHEN THE QUOTE IS NOT
//
// verify-quote is deliberately public — "is this token eligible, and for how
// much" is a sales question. An order is not. It carries who bought it, which
// wallet proved ownership and a payment signature, and an unauthenticated
// endpoint keyed by a guessable-ish id would leak all three to anyone willing
// to enumerate. The caller must present the same proven identity the order was
// created under: their account JWT, or the wallet session that owns it.
import { verifyJwt, bearerToken } from './_authStore.mjs';
import { provenWallet } from './_walletSession.mjs';
import { accountSubject } from './_entitlementsStore.mjs';
import { getOrder, jsonResponse } from './_verificationOrders.mjs';

export async function handler(event) {
  try {
    if (event.httpMethod !== 'GET') {
      return jsonResponse(405, { message: 'Method not allowed' });
    }
    const orderId = (event.queryStringParameters?.orderId || '').trim();
    if (!orderId) return jsonResponse(400, { message: 'orderId query parameter is required' });

    const order = await getOrder(orderId);
    // A missing order and an order belonging to somebody else return the SAME
    // 404. Distinguishing them would turn this endpoint into an oracle for
    // "does this order id exist", which is the enumeration the auth above is
    // there to prevent.
    if (!order) return jsonResponse(404, { message: 'Order not found' });

    const auth = verifyJwt(bearerToken(event));
    const wallet = provenWallet(event);
    const callerSubjects = [
      auth?.sub ? accountSubject(auth.sub) : '',
      wallet || '',
    ].filter(Boolean);

    const owns = callerSubjects.some((subject) => subject === order.buyerSubject)
      // An order created anonymously has no buyerSubject; the wallet that
      // proved ownership at activation is then the only claimant.
      || (wallet && order.ownerWallet && wallet === order.ownerWallet);

    if (!owns) return jsonResponse(404, { message: 'Order not found' });

    return jsonResponse(200, {
      order: {
        id: order.id,
        chain: order.chain,
        contract: order.contract,
        tierId: order.tierId,
        usd: order.usd,
        status: order.status,
        ownershipMethod: order.ownershipMethod || '',
        paidAt: order.paidAt || '',
        activatedAt: order.activatedAt || '',
        expiresAt: order.expiresAt || '',
        badgeToken: order.badgeToken || '',
        supersededBy: order.supersededBy || '',
        createdAt: order.createdAt,
      },
    });
  } catch (error) {
    return jsonResponse(500, { message: `verify-order-status crashed: ${error.message}` });
  }
}
