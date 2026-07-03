// GET /.netlify/functions/user-data-get?wallet=<address> - returns the saved
// reports + synced watchlist for the caller. Identity is resolved the same way
// writes are (see _premiumAccess.mjs), so it works for both a paid wallet
// (?wallet=...) and an admin-granted account (Authorization: Bearer <jwt>).
// Public read: a caller with no Premium history just gets empty arrays back;
// data is only ever written when entitled, so nothing sensitive is exposed.
import { resolvePremiumAccess } from './_premiumAccess.mjs';
import { getUserData, jsonResponse } from './_userDataStore.mjs';

export async function handler(event) {
  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { message: 'Method not allowed' });
  }
  const wallet = (event.queryStringParameters?.wallet || '').trim();
  const access = await resolvePremiumAccess(event, wallet);
  if (!access.storageKey) {
    // No wallet and no signed-in account - nothing to look up.
    return jsonResponse(200, { savedReports: [], watchlist: [] });
  }
  const data = await getUserData(access.storageKey);
  return jsonResponse(200, data);
}
