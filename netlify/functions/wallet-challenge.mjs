// POST /.netlify/functions/wallet-challenge  { wallet }
// Issues a one-time message for the wallet to sign, proving ownership before
// premium user-data is released (see _walletSession.mjs / P0-1). Rate-limited
// per IP so it can't be used to spray challenges.
import { createChallenge, isValidWallet } from './_walletSession.mjs';
import { enforce, getClientIp } from './_rateLimit.mjs';
import { jsonResponse } from './_blobsClient.mjs';

export async function handler(event) {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { message: 'Method not allowed' });

  const limit = await enforce('reset_ip', getClientIp(event)); // reuse a modest IP policy
  if (!limit.allowed) {
    return { statusCode: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(Math.ceil((limit.retryAfterMs || 0) / 1000)) }, body: JSON.stringify({ message: 'Too many requests. Please wait a moment.' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { message: 'Invalid JSON' }); }

  const wallet = String(body.wallet || '').trim();
  if (!isValidWallet(wallet)) return jsonResponse(400, { message: 'A valid wallet address is required.' });

  try {
    const message = await createChallenge(wallet);
    return jsonResponse(200, { message });
  } catch (error) {
    return jsonResponse(500, { message: `wallet-challenge crashed: ${error.message}` });
  }
}
