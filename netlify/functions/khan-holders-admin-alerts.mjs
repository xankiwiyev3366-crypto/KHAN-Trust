// Live alerts feed for the admin panel - polled periodically. Alerts are
// generated server-side during each sync batch (see _khanIndexer.mjs
// buildAlerts) from real classified transactions, never synthesized here.
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { jsonResponse } from './_blobsClient.mjs';
import { readAlerts } from './_khanHolderStore.mjs';

export async function handler(event) {
  try {
    if (event.httpMethod !== 'GET') {
      return jsonResponse(405, { message: 'Method not allowed' });
    }
    if (!verifyToken(bearerToken(event))) {
      return jsonResponse(401, { message: 'Unauthorized' });
    }
    const limit = Math.min(200, Math.max(1, Number(event.queryStringParameters?.limit) || 50));
    const alerts = await readAlerts();
    const sorted = alerts.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, limit);
    return jsonResponse(200, { alerts: sorted });
  } catch (error) {
    return jsonResponse(500, { message: `khan-holders-admin-alerts crashed: ${error.message}`, stack: error.stack });
  }
}
