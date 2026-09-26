// Live alerts feed for the admin panel - polled periodically. Alerts are
// generated server-side during each sync batch (see _khanIndexer.mjs
// buildAlerts) from real classified transactions, never synthesized here.
import { connectBlobs } from './_blobsConnect.mjs';
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { jsonResponse } from './_blobsClient.mjs';
import { readAlerts, readTransactions } from './_khanHolderStore.mjs';
import { withEventTimes, alertTime } from './_khanHolderAnalytics.mjs';

export async function handler(event) {
  connectBlobs(event);
  try {
    if (event.httpMethod !== 'GET') {
      return jsonResponse(405, { message: 'Method not allowed' });
    }
    if (!verifyToken(bearerToken(event))) {
      return jsonResponse(401, { message: 'Unauthorized' });
    }
    const limit = Math.min(200, Math.max(1, Number(event.queryStringParameters?.limit) || 50));
    const [alerts, transactions] = await Promise.all([readAlerts(), readTransactions()]);
    // Ordered by when the event happened, not when a sync noticed it.
    const sorted = withEventTimes(alerts, transactions).sort((a, b) => alertTime(b) - alertTime(a)).slice(0, limit);
    return jsonResponse(200, { alerts: sorted });
  } catch (error) {
    console.error(`[khan-holders-admin-alerts] ${error.message}`);
    return jsonResponse(500, { message: `khan-holders-admin-alerts crashed: ${error.message}` });
  }
}
