// POST /.netlify/functions/wallet-auth  { wallet, signature }
// Verifies the wallet's signature over its outstanding challenge and, on
// success, returns a short-lived wallet-session token that proves ownership to
// user-data-get/save (see _walletSession.mjs / P0-1).
import { verifyAndIssue, isValidWallet } from './_walletSession.mjs';
import { enforce, getClientIp } from './_rateLimit.mjs';
import { jsonResponse } from './_blobsClient.mjs';

export async function handler(event) {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { message: 'Method not allowed' });

  const limit = await enforce('login_ip', getClientIp(event)); // brute-force guard on verification
  if (!limit.allowed) {
    return { statusCode: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(Math.ceil((limit.retryAfterMs || 0) / 1000)) }, body: JSON.stringify({ message: 'Too many attempts. Please wait a moment.' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { message: 'Invalid JSON' }); }

  const wallet = String(body.wallet || '').trim();
  const signature = String(body.signature || '');
  if (!isValidWallet(wallet)) return jsonResponse(400, { message: 'A valid wallet address is required.' });
  if (!signature) return jsonResponse(400, { message: 'A signature is required.' });

  try {
    const result = await verifyAndIssue(wallet, signature);
    if (!result) return jsonResponse(401, { message: 'Signature verification failed or the challenge expired. Please try again.' });
    return jsonResponse(200, result);
  } catch (error) {
    // issueWalletToken throws only when AUTH_SECRET is unconfigured in prod.
    return jsonResponse(500, { message: `wallet-auth crashed: ${error.message}` });
  }
}
