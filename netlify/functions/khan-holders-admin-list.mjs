// Holder table for the admin panel. Rank/%/whale-status/USD value are
// derived here at read time from the stored ledger + a live SOL/USD price -
// never stored, so they can never drift from the underlying facts.
import { connectBlobs } from './_blobsConnect.mjs';
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { jsonResponse } from './_blobsClient.mjs';
import { withinRange } from './_khanHolderAnalytics.mjs';
import { readHolders } from './_khanHolderStore.mjs';
import { fetchTotalSupply, fetchKhanMarket, WHALE_SUPPLY_FRACTION } from './_khanIndexer.mjs';

export async function handler(event) {
  connectBlobs(event);
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
    const sort = params.sort || 'balance';
    const page = Math.max(1, Number(params.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(params.pageSize) || 50));

    const holdersMap = await readHolders();
    const [totalSupply, market] = await Promise.all([
      fetchTotalSupply().catch(() => 0),
      fetchKhanMarket(),
    ]);
    const solUsdPrice = market?.solUsd ?? null;
    const khanUsdPrice = market?.priceUsd ?? null;

    let rows = Object.values(holdersMap);
    if (search) {
      rows = rows.filter((row) => row.wallet.toLowerCase().includes(search));
    }
    rows = rows.filter((row) => withinRange(row.lastActivityAt, range));

    const currentHolderBalances = rows.filter((row) => row.isCurrentHolder).map((row) => row.currentBalance);
    const sortedBalances = currentHolderBalances.slice().sort((a, b) => b - a);

    const sorters = {
      balance: (a, b) => b.currentBalance - a.currentBalance,
      totalBought: (a, b) => b.totalBought - a.totalBought,
      firstBuyAt: (a, b) => (b.firstBuyAt || 0) - (a.firstBuyAt || 0),
      lastActivityAt: (a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0),
    };
    rows = rows.slice().sort(sorters[sort] || sorters.balance);

    const total = rows.length;
    const startIndex = (page - 1) * pageSize;
    const pageRows = rows.slice(startIndex, startIndex + pageSize).map((row) => {
      const rank = row.isCurrentHolder ? sortedBalances.indexOf(row.currentBalance) + 1 : null;
      const portfolioPercent = totalSupply ? (row.currentBalance / totalSupply) * 100 : null;
      const estimatedValueUsd = khanUsdPrice ? row.currentBalance * khanUsdPrice : null;
      const netPosition = row.totalBought - row.totalSold;
      const isWhale = totalSupply ? row.currentBalance / totalSupply >= WHALE_SUPPLY_FRACTION : false;
      return {
        wallet: row.wallet,
        shortWallet: `${row.wallet.slice(0, 4)}...${row.wallet.slice(-4)}`,
        currentBalance: row.currentBalance,
        totalBought: row.totalBought,
        totalSold: row.totalSold,
        buyCount: row.buyCount,
        sellCount: row.sellCount,
        firstSeenAt: row.firstSeenAt ?? null,
        firstHolderAt: row.firstHolderAt ?? null,
        firstBuyAt: row.firstBuyAt,
        lastBuyAt: row.lastBuyAt ?? null,
        lastSellAt: row.lastSellAt ?? null,
        lastActivityAt: row.lastActivityAt,
        isCurrentHolder: row.isCurrentHolder,
        solSpent: row.solSpent,
        usdSpentEstimate: solUsdPrice ? row.solSpent * solUsdPrice : null,
        netPosition,
        rank,
        portfolioPercent,
        isWhale,
        estimatedValueUsd,
      };
    });

    return jsonResponse(200, { total, page, pageSize, totalSupply, solUsdPrice, holders: pageRows });
  } catch (error) {
    console.error(`[khan-holders-admin-list] ${error.message}`);
    return jsonResponse(500, { message: `khan-holders-admin-list crashed: ${error.message}` });
  }
}
