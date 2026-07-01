// GET /.netlify/functions/alerts-status
// Returns the caller's own alert-subscribed tokens (identities only need to
// match what the client holds, so the report/profile can show the correct
// bell state). Auth-gated to the caller's account. Additive.
import { verifyJwt, bearerToken } from './_authStore.mjs';
import { getSubscription, jsonResponse } from './_alertsStore.mjs';

export async function handler(event) {
  try {
    if (event.httpMethod !== 'GET') return jsonResponse(405, { message: 'Method not allowed' });
    const payload = verifyJwt(bearerToken(event));
    if (!payload) return jsonResponse(401, { message: 'Unauthorized' });
    const sub = await getSubscription(payload.sub);
    return jsonResponse(200, { tokens: Array.isArray(sub.tokens) ? sub.tokens : [] });
  } catch (error) {
    return jsonResponse(500, { message: `alerts-status crashed: ${error.message}` });
  }
}
