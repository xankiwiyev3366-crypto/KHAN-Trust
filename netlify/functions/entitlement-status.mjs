// GET /.netlify/functions/entitlement-status?wallet=<address>
// Returns whatever paid plan (if any) is on record for a wallet address, so
// the frontend can show "Premium active" instead of an unlock button without
// trusting anything stored client-side.
import { getEntitlement, jsonResponse } from './_entitlementsStore.mjs';

export async function handler(event) {
  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { message: 'Method not allowed' });
  }

  const wallet = (event.queryStringParameters?.wallet || '').trim();
  if (!wallet) {
    return jsonResponse(400, { message: 'wallet query parameter is required' });
  }

  const entitlement = await getEntitlement(wallet);
  return jsonResponse(200, { wallet, entitlement });
}
