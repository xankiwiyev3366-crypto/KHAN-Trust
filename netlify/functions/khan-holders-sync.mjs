// Scheduled tick for the KHAN Holder Analytics indexer. Runs automatically in
// the background every 10 minutes (Netlify Scheduled Functions) so the
// holder/transaction ledger stays current without any admin action. Safe to
// run indefinitely after Pump.fun->Raydium graduation - see _khanIndexer.mjs.
import { runSyncBatch } from './_khanIndexer.mjs';
import { jsonResponse } from './_blobsClient.mjs';

export const config = { schedule: '*/10 * * * *' };

export async function handler() {
  try {
    const result = await runSyncBatch();
    return jsonResponse(200, result);
  } catch (error) {
    return jsonResponse(500, { message: `khan-holders-sync crashed: ${error.message}`, stack: error.stack });
  }
}
