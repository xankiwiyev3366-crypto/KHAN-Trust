// Real transaction table for the admin panel - every row is a stored
// balance-delta event from _khanIndexer.mjs, never synthesized.
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { jsonResponse } from './_blobsClient.mjs';
import { readTransactions, readHolders } from './_khanHolderStore.mjs';
import { KHAN_MINT } from './_khanIndexer.mjs';

const RANGE_WINDOWS_MS = {
  today: 24 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

function withinRange(timestamp, range) {
  if (!range || range === 'all') return true;
  if (!timestamp) return false;
  const windowMs = RANGE_WINDOWS_MS[range];
  if (!windowMs) return true;
  return Date.now() - timestamp <= windowMs;
}

export async function handler(event) {
  try {
    if (event.httpMethod !== 'GET') {
      return jsonResponse(405, { message: 'Method not allowed' });
    }
    if (!verifyToken(bearerToken(event))) {
      return jsonResponse(401, { message: 'Unauthorized' });
    }
    const params = event.queryStringParameters || {};
    const search = (params.search || '').trim().toLowerCase();
    const range = params.range || 'all';
    const direction = params.direction || 'all';
    const page = Math.max(1, Number(params.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(params.pageSize) || 50));

    let rows = await readTransactions();
    rows = rows.filter((row) => withinRange(row.blockTime, range));
    if (direction !== 'all') rows = rows.filter((row) => row.direction === direction);
    if (search) {
      rows = rows.filter(
        (row) =>
          row.wallet.toLowerCase().includes(search) ||
          (row.signature || '').toLowerCase().includes(search) ||
          String(row.khanAmount).includes(search) ||
          String(row.solAmount).includes(search),
      );
    }
    rows = rows.slice().sort((a, b) => (b.blockTime || 0) - (a.blockTime || 0));

    const total = rows.length;
    const startIndex = (page - 1) * pageSize;
    // Every row is joined with the wallet's current on-chain state (current
    // balance, current-holder status) so each individual buy/sell can be
    // read on its own without cross-referencing the holders table - required
    // for the competition-audit use case (who bought what, and do they still
    // hold).
    const holdersMap = await readHolders();
    const pageRows = rows.slice(startIndex, startIndex + pageSize).map((row) => {
      const holder = holdersMap[row.wallet];
      return {
        ...row,
        currentBalance: holder ? holder.currentBalance : 0,
        isCurrentHolder: holder ? holder.isCurrentHolder : false,
        solscanUrl: row.signature ? `https://solscan.io/tx/${row.signature}` : null,
        // Pump.fun has no per-transaction page - this links to the coin's
        // trade page, and the frontend hides it once KHAN is shown as
        // graduated (Pump.fun stops being the live trading venue).
        pumpFunUrl: `https://pump.fun/coin/${KHAN_MINT}`,
      };
    });

    return jsonResponse(200, { total, page, pageSize, transactions: pageRows });
  } catch (error) {
    return jsonResponse(500, { message: `khan-holders-admin-transactions crashed: ${error.message}`, stack: error.stack });
  }
}
