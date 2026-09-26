// Manual "Refresh now" trigger for the admin panel. Loops the same
// runSyncBatch unit of work used by the scheduled function until the cursor
// catches up to the chain head or a wall-clock time budget is hit - this is
// also what drives the very first historical backfill.
import { connectBlobs } from './_blobsConnect.mjs';
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { jsonResponse } from './_blobsClient.mjs';
import { runSyncBatch } from './_khanIndexer.mjs';

// A synchronous function is cut off at ~10s, and a batch only writes its cursor
// when it finishes - so no new batch is started past this point. (It was 20s,
// which let a slow second batch be killed mid-flight.) Anything left over is
// picked up by the scheduled worker within ten minutes.
const TIME_BUDGET_MS = 6000;

export async function handler(event) {
  connectBlobs(event);
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
    let skipped = null;
    const runId = `manual-${startedAt}`;
    do {
      const result = await runSyncBatch({ trigger: 'manual', runId });
      totalProcessed += result.processed;
      reachedHead = result.reachedHead;
      holderCount = result.holderCount;
      skipped = result.skipped || null;
      if (skipped || result.processed === 0) break;
    } while (!reachedHead && Date.now() - startedAt < TIME_BUDGET_MS);
    return jsonResponse(200, { processed: totalProcessed, reachedHead, holderCount, skipped });
  } catch (error) {
    console.error(`[khan-holders-admin-sync] ${error.message}`);
    return jsonResponse(500, { message: `khan-holders-admin-sync crashed: ${error.message}` });
  }
}
