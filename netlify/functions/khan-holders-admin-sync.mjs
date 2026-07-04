// Manual "Refresh now" trigger for the admin panel. Loops the same
// runSyncBatch unit of work used by the scheduled function until the cursor
// catches up to the chain head or a wall-clock time budget is hit - this is
// also what drives the very first historical backfill.
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { jsonResponse } from './_blobsClient.mjs';
import { runSyncBatch } from './_khanIndexer.mjs';

const TIME_BUDGET_MS = 20000;

export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { message: 'Method not allowed' });
    }
    if (!verifyToken(bearerToken(event))) {
      return jsonResponse(401, { message: 'Unauthorized' });
    }
    const startedAt = Date.now();
    let totalProcessed = 0;
    let reachedHead = false;
    let holderCount = 0;
    do {
      const result = await runSyncBatch();
      totalProcessed += result.processed;
      reachedHead = result.reachedHead;
      holderCount = result.holderCount;
      if (result.processed === 0) break;
    } while (!reachedHead && Date.now() - startedAt < TIME_BUDGET_MS);
    return jsonResponse(200, { processed: totalProcessed, reachedHead, holderCount });
  } catch (error) {
    return jsonResponse(500, { message: `khan-holders-admin-sync crashed: ${error.message}` });
  }
}
