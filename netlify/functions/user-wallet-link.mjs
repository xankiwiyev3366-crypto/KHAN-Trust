// POST /.netlify/functions/user-wallet-link
// Called best-effort by the client when a signed-in user has a Solana wallet
// connected (see src/walletLink.js). Records the account -> wallet observation
// so the admin panel can show "Wallet Connected: Yes". Purely additive
// telemetry: it authenticates the caller with their normal auth JWT, writes
// only the isolated wallet-links store, and returns ok either way. It never
// touches payments, entitlements, or premium access.
import { verifyJwt, bearerToken, jsonResponse } from './_authStore.mjs';
import { recordWalletLink } from './_walletLinkStore.mjs';

// Solana base58 addresses are 32-44 chars; reject anything obviously not one so
// a stray value can never be stored.
const BASE58_WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return jsonResponse(405, { message: 'Method not allowed' });

    const payload = verifyJwt(bearerToken(event));
    if (!payload?.sub) return jsonResponse(401, { message: 'Unauthorized' });

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { message: 'Invalid request body' });
    }

    const wallet = String(body.wallet || '').trim();
    if (!BASE58_WALLET.test(wallet)) {
      return jsonResponse(400, { message: 'A valid wallet address is required.' });
    }

    await recordWalletLink(payload.sub, wallet);
    return jsonResponse(200, { ok: true });
  } catch (error) {
    return jsonResponse(500, { message: `user-wallet-link crashed: ${error.message}` });
  }
}
