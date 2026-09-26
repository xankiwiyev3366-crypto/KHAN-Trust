// Admin dashboard numbers + chart series - everything derived at read time
// from holders.json/transactions.json, the single source of truth, mirroring
// the analytics-summary.mjs pattern used elsewhere in this admin panel. The
// derivations live in _khanHolderAnalytics.mjs; "today" and the chart days are
// Asia/Baku calendar days.
import { connectBlobs } from './_blobsConnect.mjs';
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { jsonResponse } from './_blobsClient.mjs';
import { readHolders, readTransactions, readMeta } from './_khanHolderStore.mjs';
import { fetchTotalSupply, fetchKhanMarket, WHALE_SUPPLY_FRACTION } from './_khanIndexer.mjs';
import { computeHolderStats, buildDailySeries, buildGrowthSeries } from './_khanHolderAnalytics.mjs';

export async function handler(event) {
  connectBlobs(event);
  try {
    if (event.httpMethod !== 'GET') {
      return jsonResponse(405, { message: 'Method not allowed' });
    }
    if (!verifyToken(bearerToken(event))) {
      return jsonResponse(401, { message: 'Unauthorized' });
    }
    const now = Date.now();
    const [holdersMap, transactions, meta, totalSupply, market] = await Promise.all([
      readHolders(),
      readTransactions(),
      readMeta(),
      fetchTotalSupply().catch((error) => {
        console.error(`[khan-holders-admin-stats] total supply read failed: ${error.message}`);
        return 0;
      }),
      fetchKhanMarket(),
    ]);

    const stats = computeHolderStats(holdersMap, transactions, { now });
    const topHolderDistribution = Object.values(holdersMap)
      .filter((h) => h.isCurrentHolder)
      .sort((a, b) => b.currentBalance - a.currentBalance)
      .slice(0, 10)
      .map((h) => ({ label: `${h.wallet.slice(0, 4)}...${h.wallet.slice(-4)}`, value: h.currentBalance, color: '#d4af37' }));

    return jsonResponse(200, {
      stats: {
        ...stats,
        totalSupply,
        khanUsdPrice: market?.priceUsd ?? null,
        solUsdPrice: market?.solUsd ?? null,
        whaleSupplyFraction: WHALE_SUPPLY_FRACTION,
      },
      market: market && {
        khanUsd: market.priceUsd,
        khanSol: market.priceSol,
        khanPriceSource: market.priceSource,
        solUsd: market.solUsd,
        solUsdSource: market.solUsdSource,
        venue: market.venue,
        pairAddress: market.pairAddress,
        bondingCurve: market.bondingCurve,
        at: market.at,
      },
      sync: {
        lastRun: meta.lastRun || null,
        cursorReachedHead: meta.cursorReachedHead ?? null,
        latestEventAt: stats.latestEventAt,
        // Pre-heartbeat deployments only left this behind; it is the last time
        // a batch completed, which is still an honest "last synced".
        lastCompletedAt: meta.lastRun?.ok ? meta.lastRun.at : (meta.lastFullBalanceSyncAt || null),
      },
      timeZone: 'Asia/Baku',
      charts: {
        dailyVolume: buildDailySeries(transactions, { days: 30, now }),
        growth: buildGrowthSeries(transactions, { days: 30, now }),
        topHolderDistribution,
      },
    });
  } catch (error) {
    console.error(`[khan-holders-admin-stats] ${error.message}`);
    return jsonResponse(500, { message: `khan-holders-admin-stats crashed: ${error.message}` });
  }
}
