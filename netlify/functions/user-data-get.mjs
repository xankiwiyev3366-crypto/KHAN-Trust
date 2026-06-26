// GET /.netlify/functions/user-data-get?wallet=<address> - returns the
// saved reports + synced watchlist for a wallet. Public read (harmless: a
// wallet with no Premium/Early Supporter history just gets empty arrays
// back); writes are the part gated by entitlement, see user-data-save.mjs.
import { getUserData, jsonResponse } from './_userDataStore.mjs';

export async function handler(event) {
  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { message: 'Method not allowed' });
  }
  const wallet = (event.queryStringParameters?.wallet || '').trim();
  if (!wallet) {
    return jsonResponse(400, { message: 'wallet query parameter is required' });
  }
  const data = await getUserData(wallet);
  return jsonResponse(200, data);
}
