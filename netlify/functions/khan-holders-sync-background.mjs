// POST /.netlify/functions/khan-holders-sync-background
// Authorization: Bearer <admin HMAC token>
//
// Runs the holder-analytics indexer until the cursor reaches the chain head or
// the run budget is spent. A BACKGROUND function (15-minute cap), fired every
// ten minutes by khan-holders-sync; see that file for why the work is not done
// in the scheduled function itself.
//
// Authenticated like queue-worker-background: it spends RPC quota and writes
// the ledger, so an anonymous caller must not be able to drive it in a loop.
// Idempotent regardless - the cursor, the per-signature dedup and the sync
// lease mean a second invocation can never count a transaction twice.
import crypto from 'node:crypto';
import { connectBlobs } from './_blobsConnect.mjs';
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { jsonResponse } from './_blobsClient.mjs';
import { runSyncBatch } from './_khanIndexer.mjs';

// Leaves headroom under the 15-minute cap: a batch is never started after
// this, so the one in flight finishes and writes its cursor.
const RUN_BUDGET_MS = 10 * 60 * 1000;

export async function handler(event) {
  const hasInvocationBlobs = connectBlobs(event);
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { message: 'Method not allowed' });
  }
  if (!verifyToken(bearerToken(event))) {
    return jsonResponse(401, { message: 'Unauthorized' });
  }
  if (!hasInvocationBlobs) {
    console.warn('[khan-holders-sync-background] no per-request Blobs context on this invocation; Blob access will use the NETLIFY_BLOBS_TOKEN fallback.');
  }

  let trigger = 'scheduled';
  try {
    trigger = JSON.parse(event.body || '{}').trigger === 'manual' ? 'manual' : 'scheduled';
  } catch {
    // default
  }
  const runId = `${trigger}-${crypto.randomUUID()}`;
  const startedAt = Date.now();
  const totals = { processed: 0, newTransactions: 0, duplicatesSkipped: 0, batches: 0 };
  let last = null;
  try {
    do {
      last = await runSyncBatch({ trigger, runId });
      totals.batches += 1;
      totals.processed += last.processed;
      totals.newTransactions += last.newTransactions || 0;
      totals.duplicatesSkipped += last.duplicatesSkipped || 0;
      if (last.skipped || last.processed === 0) break;
    } while (!last.reachedHead && Date.now() - startedAt < RUN_BUDGET_MS);
    console.log(`[khan-holders-sync-background] ${trigger}: ${JSON.stringify({ ...totals, reachedHead: last?.reachedHead, holderCount: last?.holderCount, skipped: last?.skipped || null, ms: Date.now() - startedAt })}`);
    return jsonResponse(200, { ...totals, reachedHead: last?.reachedHead ?? false, holderCount: last?.holderCount ?? null });
  } catch (error) {
    console.error(`[khan-holders-sync-background] ${trigger} run failed after ${totals.batches} batch(es): ${error.message}`);
    return jsonResponse(500, { message: 'sync failed' });
  }
}
