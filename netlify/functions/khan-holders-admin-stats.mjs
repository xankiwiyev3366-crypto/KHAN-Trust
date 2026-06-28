// Admin dashboard numbers + chart series - everything derived at read time
// from holders.json/transactions.json, the single source of truth, mirroring
// the analytics-summary.mjs pattern used elsewhere in this admin panel.
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { jsonResponse } from './_blobsClient.mjs';
import { readHolders, readTransactions } from './_khanHolderStore.mjs';
import { fetchTotalSupply, fetchKhanUsdPrice, WHALE_SUPPLY_FRACTION } from './_khanIndexer.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function buildDailySeries(transactions, days = 30) {
  const buckets = new Map();
  const now = Date.now();
  for (let i = days - 1; i >= 0; i -= 1) {
    buckets.set(dayKey(now - i * DAY_MS), { date: dayKey(now - i * DAY_MS), buyVolumeSol: 0, sellVolumeSol: 0, buyers: new Set(), sellers: new Set() });
  }
  for (const tx of transactions) {
    if (!tx.blockTime) continue;
    const key = dayKey(tx.blockTime);
    if (!buckets.has(key)) continue;
    const bucket = buckets.get(key);
    if (tx.direction === 'buy') {
      bucket.buyVolumeSol += tx.solAmount || 0;
      bucket.buyers.add(tx.wallet);
    } else {
      bucket.sellVolumeSol += tx.solAmount || 0;
      bucket.sellers.add(tx.wallet);
    }
  }
  return Array.from(buckets.values()).map((bucket) => ({
    date: bucket.date,
    buyVolumeSol: bucket.buyVolumeSol,
    sellVolumeSol: bucket.sellVolumeSol,
    buyerCount: bucket.buyers.size,
    sellerCount: bucket.sellers.size,
  }));
}

// Reconstructs holder/buyer/wallet counts for each past day exactly from the
// logged buy/sell deltas (not a snapshot, not an estimate) - replaying every
// transaction in chronological order gives the real balance each wallet held
// as of any given day, since every recorded transaction is itself a real
// on-chain balance delta.
function buildGrowthSeries(transactions, days = 30) {
  const sorted = transactions.slice().filter((t) => t.blockTime).sort((a, b) => a.blockTime - b.blockTime);
  const now = Date.now();
  const cutoffs = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    cutoffs.push(now - i * DAY_MS);
  }
  const balances = new Map();
  const everBought = new Set();
  const everTouched = new Set();
  const buckets = [];
  let pointer = 0;
  for (const cutoff of cutoffs) {
    while (pointer < sorted.length && sorted[pointer].blockTime <= cutoff) {
      const tx = sorted[pointer];
      const delta = tx.direction === 'buy' ? tx.khanAmount : -tx.khanAmount;
      balances.set(tx.wallet, (balances.get(tx.wallet) || 0) + delta);
      everTouched.add(tx.wallet);
      if (tx.direction === 'buy') everBought.add(tx.wallet);
      pointer += 1;
    }
    const holderCount = Array.from(balances.values()).filter((balance) => balance > 1e-9).length;
    buckets.push({ date: dayKey(cutoff), holderCount, buyerCount: everBought.size, walletCount: everTouched.size });
  }
  return buckets;
}

export async function handler(event) {
  try {
    if (event.httpMethod !== 'GET') {
      return jsonResponse(405, { message: 'Method not allowed' });
    }
    if (!verifyToken(bearerToken(event))) {
      return jsonResponse(401, { message: 'Unauthorized' });
    }
    const holdersMap = await readHolders();
    const transactions = await readTransactions();
    const holders = Object.values(holdersMap);

    const [totalSupply, khanUsdPrice] = await Promise.all([fetchTotalSupply().catch(() => 0), fetchKhanUsdPrice()]);

    const currentHolders = holders.filter((h) => h.isCurrentHolder);
    const buyers = new Set(transactions.filter((t) => t.direction === 'buy').map((t) => t.wallet));
    const sellers = new Set(transactions.filter((t) => t.direction === 'sell').map((t) => t.wallet));

    const now = Date.now();
    const startOfToday = new Date(new Date(now).toISOString().slice(0, 10)).getTime();
    const todaysTx = transactions.filter((t) => t.blockTime && t.blockTime >= startOfToday);
    const todaysBuys = todaysTx.filter((t) => t.direction === 'buy');
    const todaysBuyers = new Set(todaysBuys.map((t) => t.wallet));
    const todaysHolders = currentHolders.filter((h) => h.firstBuyAt && h.firstBuyAt >= startOfToday);

    const largestBuyToday = todaysBuys.reduce((max, t) => Math.max(max, t.solAmount || 0), 0);
    const largestHolder = currentHolders.reduce((max, h) => Math.max(max, h.currentBalance), 0);

    const buyTxCount = transactions.filter((t) => t.direction === 'buy').length;
    const sellTxCount = transactions.filter((t) => t.direction === 'sell').length;
    const totalBuyVolumeSol = transactions.filter((t) => t.direction === 'buy').reduce((sum, t) => sum + (t.solAmount || 0), 0);
    const totalSellVolumeSol = transactions.filter((t) => t.direction === 'sell').reduce((sum, t) => sum + (t.solAmount || 0), 0);
    const averageBuySol = buyTxCount ? totalBuyVolumeSol / buyTxCount : 0;
    const averageHolding = currentHolders.length ? currentHolders.reduce((sum, h) => sum + h.currentBalance, 0) / currentHolders.length : 0;

    const topHolderDistribution = currentHolders
      .slice()
      .sort((a, b) => b.currentBalance - a.currentBalance)
      .slice(0, 10)
      .map((h) => ({ label: `${h.wallet.slice(0, 4)}...${h.wallet.slice(-4)}`, value: h.currentBalance, color: '#d4af37' }));

    return jsonResponse(200, {
      stats: {
        totalHolders: holders.length,
        currentHolders: currentHolders.length,
        uniqueBuyers: buyers.size,
        uniqueSellers: sellers.size,
        todaysBuyers: todaysBuyers.size,
        todaysHolders: todaysHolders.length,
        largestBuyTodaySol: largestBuyToday,
        largestHolderBalance: largestHolder,
        averageBuySol,
        averageHolding,
        totalBuyVolumeSol,
        totalSellVolumeSol,
        netBuyVolumeSol: totalBuyVolumeSol - totalSellVolumeSol,
        totalSupply,
        khanUsdPrice,
        whaleSupplyFraction: WHALE_SUPPLY_FRACTION,
      },
      charts: {
        dailyVolume: buildDailySeries(transactions, 30),
        growth: buildGrowthSeries(transactions, 30),
        topHolderDistribution,
      },
    });
  } catch (error) {
    return jsonResponse(500, { message: `khan-holders-admin-stats crashed: ${error.message}`, stack: error.stack });
  }
}
