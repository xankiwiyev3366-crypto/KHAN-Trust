// Pure derivations for the KHAN holder-analytics admin endpoints. Everything is
// computed at read time from holders.json + transactions.json (the single
// source of truth, see _khanHolderStore.mjs), so the cards, the chart and the
// notifications are derived from the same rows and cannot disagree.
//
// CALENDAR: every "today" and every chart day is an Asia/Baku calendar day
// (src/lib/bakuTime.js). "Bu Günkü" used to be the UTC day, which put a buy at
// 02:30 Baku on the previous day.
import { bakuDayKey, startOfBakuDay } from '../../src/lib/bakuTime.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const EPSILON = 1e-9;

const RANGE_WINDOWS_MS = {
  '24h': DAY_MS,
  '7d': 7 * DAY_MS,
  '30d': 30 * DAY_MS,
};

// 'today' = since 00:00 Baku; the others are rolling windows, as before.
export function withinRange(timestamp, range, now = Date.now()) {
  if (!range || range === 'all') return true;
  if (!timestamp) return false;
  if (range === 'today') return timestamp >= startOfBakuDay(now) && timestamp <= now;
  const windowMs = RANGE_WINDOWS_MS[range];
  if (!windowMs) return true;
  return now - timestamp <= windowMs;
}

function lastDays(now, days) {
  const keys = [];
  const today = startOfBakuDay(now);
  for (let i = days - 1; i >= 0; i -= 1) {
    const dayStart = today - i * DAY_MS;
    keys.push({ date: bakuDayKey(dayStart), dayStart, dayEnd: dayStart + DAY_MS - 1 });
  }
  return keys;
}

export function buildDailySeries(transactions, { days = 30, now = Date.now() } = {}) {
  const buckets = new Map(lastDays(now, days).map(({ date }) => [date, { date, buyVolumeSol: 0, sellVolumeSol: 0, buyers: new Set(), sellers: new Set() }]));
  for (const tx of transactions) {
    if (!tx.blockTime) continue;
    const bucket = buckets.get(bakuDayKey(tx.blockTime));
    if (!bucket) continue;
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

// Holder/buyer/wallet counts as of the END of each Baku day, reconstructed by
// replaying every logged balance delta in chronological order - the real
// balance each wallet held at that moment, not a snapshot or an estimate.
export function buildGrowthSeries(transactions, { days = 30, now = Date.now() } = {}) {
  const sorted = transactions.filter((t) => t.blockTime).sort((a, b) => a.blockTime - b.blockTime);
  const balances = new Map();
  const everBought = new Set();
  const everTouched = new Set();
  const buckets = [];
  let pointer = 0;
  for (const { date, dayEnd } of lastDays(now, days)) {
    const cutoff = Math.min(dayEnd, now);
    while (pointer < sorted.length && sorted[pointer].blockTime <= cutoff) {
      const tx = sorted[pointer];
      const delta = tx.direction === 'buy' ? tx.khanAmount : -tx.khanAmount;
      balances.set(tx.wallet, (balances.get(tx.wallet) || 0) + delta);
      everTouched.add(tx.wallet);
      if (tx.direction === 'buy') everBought.add(tx.wallet);
      pointer += 1;
    }
    const holderCount = Array.from(balances.values()).filter((balance) => balance > EPSILON).length;
    buckets.push({ date, holderCount, buyerCount: everBought.size, walletCount: everTouched.size });
  }
  return buckets;
}

// First time each wallet's replayed ledger balance went from <= 0 to > 0.
function firstHolderTimes(transactions) {
  const sorted = transactions.filter((t) => t.blockTime).sort((a, b) => a.blockTime - b.blockTime);
  const balances = new Map();
  const first = new Map();
  for (const tx of sorted) {
    const before = balances.get(tx.wallet) || 0;
    const after = before + (tx.direction === 'buy' ? tx.khanAmount : -tx.khanAmount);
    balances.set(tx.wallet, after);
    if (before <= EPSILON && after > EPSILON && !first.has(tx.wallet)) first.set(tx.wallet, tx);
  }
  return first;
}

export function computeHolderStats(holdersMap, transactions, { now = Date.now() } = {}) {
  const holders = Object.values(holdersMap);
  const currentHolders = holders.filter((h) => h.isCurrentHolder);
  const buys = transactions.filter((t) => t.direction === 'buy');
  const sells = transactions.filter((t) => t.direction === 'sell');
  const buyers = new Set(buys.map((t) => t.wallet));
  const sellers = new Set(sells.map((t) => t.wallet));

  const startOfToday = startOfBakuDay(now);
  const isToday = (ts) => Boolean(ts) && ts >= startOfToday && ts <= now;
  const todaysBuys = buys.filter((t) => isToday(t.blockTime));
  const todaysBuyers = new Set(todaysBuys.map((t) => t.wallet));
  // "Today's holders" = wallets that BECAME holders today (Baku) and still are.
  // Derived from the ledger, so it agrees with the transactions it is made of;
  // a stored firstBuyAt is not the moment a wallet became a holder.
  const becameHolder = firstHolderTimes(transactions);
  const todaysHolders = currentHolders.filter((h) => isToday(becameHolder.get(h.wallet)?.blockTime ?? h.firstHolderAt));

  const sum = (rows) => rows.reduce((total, t) => total + (t.solAmount || 0), 0);
  const totalBuyVolumeSol = sum(buys);
  const totalSellVolumeSol = sum(sells);
  const latestEventAt = transactions.reduce((max, t) => Math.max(max, t.blockTime || 0), 0) || null;

  return {
    totalHolders: holders.length,
    currentHolders: currentHolders.length,
    uniqueBuyers: buyers.size,
    uniqueSellers: sellers.size,
    todaysBuyers: todaysBuyers.size,
    todaysHolders: todaysHolders.length,
    todaysTransactions: transactions.filter((t) => isToday(t.blockTime)).length,
    largestBuyTodaySol: todaysBuys.reduce((max, t) => Math.max(max, t.solAmount || 0), 0),
    largestHolderBalance: currentHolders.reduce((max, h) => Math.max(max, h.currentBalance), 0),
    averageBuySol: buys.length ? totalBuyVolumeSol / buys.length : 0,
    averageHolding: currentHolders.length ? currentHolders.reduce((total, h) => total + h.currentBalance, 0) / currentHolders.length : 0,
    totalBuyVolumeSol,
    totalSellVolumeSol,
    netBuyVolumeSol: totalBuyVolumeSol - totalSellVolumeSol,
    buyTxCount: buys.length,
    sellTxCount: sells.length,
    latestEventAt,
    todayStartsAt: startOfToday,
  };
}

// Gives every alert an eventAt - the chain time of the transaction it is about.
// Alerts written since the indexer stamps both times already carry it. Older
// holder-count / top-holder alerts were stamped with the time a sync RAN; for
// those the causing transaction is recovered from the ledger (the latest
// wallet-became-holder, or the top holder's latest trade, at or before the
// detection time). If none can be identified, eventAt stays null and the alert
// is marked timeBasis 'detected' - the page then says it is a detection time,
// rather than passing it off as an event time. Nothing stored is modified.
export function withEventTimes(alerts, transactions) {
  const becameHolderEvents = Array.from(firstHolderTimes(transactions).values()).sort((a, b) => a.blockTime - b.blockTime);
  const byWallet = new Map();
  for (const tx of transactions) {
    if (!tx.blockTime) continue;
    if (!byWallet.has(tx.wallet)) byWallet.set(tx.wallet, []);
    byWallet.get(tx.wallet).push(tx);
  }
  const latestAtOrBefore = (rows, at) => rows.filter((t) => t.blockTime <= at).sort((a, b) => b.blockTime - a.blockTime)[0] || null;

  return alerts.map((alert) => {
    if (alert.eventAt !== undefined) return alert;
    const detectedAt = alert.createdAt || null;
    if (alert.signature) {
      // Transaction alerts were always stamped with the block time.
      return { ...alert, eventAt: alert.createdAt || null, detectedAt: null, timeBasis: 'event' };
    }
    let cause = null;
    if (alert.type === 'holder_count_increased' && detectedAt) cause = latestAtOrBefore(becameHolderEvents, detectedAt);
    if (alert.type === 'top_holder_changed' && detectedAt && alert.wallet) cause = latestAtOrBefore(byWallet.get(alert.wallet) || [], detectedAt);
    if (cause) return { ...alert, eventAt: cause.blockTime, detectedAt, causeSignature: cause.signature, timeBasis: 'event' };
    return { ...alert, eventAt: null, detectedAt, timeBasis: 'detected' };
  });
}

// Sort key for the notifications feed: when the thing happened.
export function alertTime(alert) {
  return alert.eventAt || alert.detectedAt || alert.createdAt || 0;
}
