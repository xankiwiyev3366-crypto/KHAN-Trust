// POST /.netlify/functions/alerts-subscribe
// Toggles a trust-alert subscription for ONE token, for the CALLER's own
// account only. The user and the notification email both come from the
// verified JWT (never the request body), so a caller can never subscribe a
// different person or redirect alerts elsewhere. Auth-gated; additive - no
// existing endpoint or behavior changes.
import { verifyJwt, getUserById, bearerToken } from './_authStore.mjs';
import { toggleToken, jsonResponse } from './_alertsStore.mjs';

const IDENTITY_PATTERN = /^(c:[a-z0-9]{6,90}|id:[a-z0-9-]{3,80})$/i;

function cleanStr(value, max = 120) {
  return String(value == null ? '' : value).replace(/<[^>]*>/g, '').trim().slice(0, max);
}

export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return jsonResponse(405, { message: 'Method not allowed' });

    const payload = verifyJwt(bearerToken(event));
    if (!payload) return jsonResponse(401, { message: 'Unauthorized' });
    const user = await getUserById(payload.sub);
    if (!user) return jsonResponse(404, { message: 'User not found' });

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { message: 'Invalid JSON' }); }

    const identity = cleanStr(body.identity, 100);
    if (!IDENTITY_PATTERN.test(identity)) return jsonResponse(400, { message: 'invalid identity' });

    const token = {
      identity,
      contract: cleanStr(body.contract),
      chain: cleanStr(body.chain, 40),
      name: cleanStr(body.name),
      ticker: cleanStr(body.ticker, 40),
    };

    const result = await toggleToken(user.id, user.email, token);
    return jsonResponse(200, { ok: true, ...result });
  } catch (error) {
    return jsonResponse(500, { message: `alerts-subscribe crashed: ${error.message}` });
  }
}
