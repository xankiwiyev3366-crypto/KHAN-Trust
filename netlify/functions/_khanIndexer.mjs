// KHAN Holder Analytics - shared on-chain indexing engine.
//
// Design constraint: this module must keep working, unmodified, after KHAN
// graduates from Pump.fun to Raydium. So buy/sell classification never
// decodes Pump.fun's bonding-curve instructions - it diffs real on-chain
// token/SOL balances for every account touched by a transaction, which is
// true regardless of which program (Pump.fun bonding curve today, a Raydium
// AMM / Jupiter route tomorrow) executed the swap. The only Pump.fun-specific
// fact used anywhere is the bonding-curve PDA address, and that is used
// purely to exclude the pool/vault account from the holder list, never to
// interpret what happened in a transaction.
import { readMeta, writeMeta, readHolders, writeHolders, readTransactions, appendTransactions, appendAlerts, MAX_TRANSACTIONS } from './_khanHolderStore.mjs';
import { solanaRpc, HAS_DEDICATED_RPC } from './_khanRpc.mjs';
import { deriveBondingCurvePda, getKhanMarket, getCurrentSolUsdPrice } from './_khanMarket.mjs';

export const KHAN_MINT = '6bSHkoMYqzyCZdWPQ45nUv73dvdfx4yEd4yEemefpump';

const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

// Whale = a single wallet holding at least this fraction of all currently-
// held (circulating-among-holders) supply. Large buy/sell threshold is in
// SOL, a deliberately simple, transparent, non-guessed constant rather than
// a "smart" estimate.
const WHALE_SUPPLY_FRACTION = 0.01;
export const LARGE_TRADE_SOL_THRESHOLD = 5;
export const WHALE_TRADE_SOL_THRESHOLD = 25;

const SIGNATURES_PAGE_SIZE = 1000;
const MAX_SIGNATURE_PAGES_PER_BATCH = 3;
const MAX_TX_DETAIL_FETCHES_PER_BATCH = 200;

async function fetchMintProgramId(mint) {
  const accountInfo = await solanaRpc('getAccountInfo', [mint, { encoding: 'jsonParsed' }]);
  return accountInfo?.value?.owner || TOKEN_PROGRAM_ID;
}

async function fetchDexscreenerPoolAddresses(mint) {
  try {
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    if (!response.ok) return [];
    const data = await response.json();
    const pairs = Array.isArray(data?.pairs) ? data.pairs : [];
    return pairs.map((pair) => pair.pairAddress).filter(Boolean);
  } catch {
    return [];
  }
}

// Refreshes the dynamic pool/vault exclude-set. Run at the start of every
// sync batch (cheap, capped to once per few minutes) so a brand-new Raydium
// pool address is picked up automatically post-graduation with zero code
// changes - this is what makes the indexer venue-agnostic in practice, not
// just in theory.
export async function refreshPoolAddresses(meta) {
  const now = Date.now();
  if (meta.poolAddressesUpdatedAt && now - meta.poolAddressesUpdatedAt < 5 * 60 * 1000) {
    return meta;
  }
  const bondingCurve = deriveBondingCurvePda(KHAN_MINT);
  const dexPools = await fetchDexscreenerPoolAddresses(KHAN_MINT);
  const merged = new Set(meta.poolAddresses || []);
  if (bondingCurve) merged.add(bondingCurve);
  dexPools.forEach((address) => merged.add(address));
  return { ...meta, poolAddresses: Array.from(merged), poolAddressesUpdatedAt: now };
}

const SIGNATURE_PAGE_MAX_ATTEMPTS = 5;
const SIGNATURE_PAGE_BASE_DELAY_MS = 400;

async function fetchSignaturePage(before) {
  const params = before ? [KHAN_MINT, { limit: SIGNATURES_PAGE_SIZE, before }] : [KHAN_MINT, { limit: SIGNATURES_PAGE_SIZE }];
  let lastError;
  for (let attempt = 0; attempt < SIGNATURE_PAGE_MAX_ATTEMPTS; attempt += 1) {
    try {
      const result = await solanaRpc('getSignaturesForAddress', params);
      return Array.isArray(result) ? result : [];
    } catch (error) {
      lastError = error;
      await sleep(SIGNATURE_PAGE_BASE_DELAY_MS * 2 ** attempt);
    }
  }
  throw lastError;
}

// Collects signatures newer than `lastSignature`, oldest-first, bounded per
// batch so a single invocation always stays inside the serverless time
// budget. Returns reachedHead=true only once it has walked all the way back
// to (or past) the previously-recorded cursor.
async function collectNewSignatures(lastSignature) {
  const collected = [];
  let before;
  let reachedHead = false;
  for (let page = 0; page < MAX_SIGNATURE_PAGES_PER_BATCH; page += 1) {
    const batch = await fetchSignaturePage(before);
    if (!batch.length) {
      reachedHead = true;
      break;
    }
    let hitCursor = false;
    for (const entry of batch) {
      if (lastSignature && entry.signature === lastSignature) {
        hitCursor = true;
        break;
      }
      collected.push(entry);
    }
    if (hitCursor) {
      reachedHead = true;
      break;
    }
    if (batch.length < SIGNATURES_PAGE_SIZE) {
      reachedHead = true;
      break;
    }
    before = batch[batch.length - 1].signature;
  }
  // oldest-first so holder history (firstBuyAt etc.) is built up in
  // chronological order.
  collected.reverse();
  return { signatures: collected.slice(0, MAX_TX_DETAIL_FETCHES_PER_BATCH), reachedHead: reachedHead && collected.length <= MAX_TX_DETAIL_FETCHES_PER_BATCH };
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Accuracy over speed: a transient RPC error (rate limit, timeout, node lag)
// must never translate into a silently-skipped buy/sell. Retries with
// exponential backoff before giving up - and the caller (runSyncBatch) halts
// the whole batch rather than skipping past a signature that still fails
// after every retry, so the sync cursor can never advance past an
// unprocessed transaction.
const TX_FETCH_MAX_ATTEMPTS = 6;
const TX_FETCH_BASE_DELAY_MS = 400;

async function fetchParsedTransactionWithRetry(signature) {
  let lastError;
  for (let attempt = 0; attempt < TX_FETCH_MAX_ATTEMPTS; attempt += 1) {
    try {
      const tx = await solanaRpc('getTransaction', [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]);
      if (tx) return tx;
      // A null result for a signature getSignaturesForAddress just returned
      // means the node hasn't finished indexing it yet, not that it doesn't
      // exist - retry rather than treat it as "no transaction".
      lastError = new Error(`getTransaction returned null for ${signature}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(TX_FETCH_BASE_DELAY_MS * 2 ** attempt);
  }
  throw lastError;
}

// A small delay between transaction-detail fetches keeps a keyless public
// RPC endpoint from rate-limiting the batch in the first place (prevention
// is cheaper than retries). Skipped when a Helius key is configured, since
// Helius's RPC tier comfortably handles back-to-back requests.
const INTER_REQUEST_DELAY_MS = HAS_DEDICATED_RPC ? 0 : 150;

// Pure balance-delta classifier - the venue-agnostic core. Works identically
// whether the swap routed through Pump.fun's bonding curve or a Raydium AMM,
// because it never looks at *which* program ran - only at whose KHAN and SOL
// balances changed.
export function classifyParsedTransaction(tx, poolAddressSet) {
  if (!tx || tx.meta?.err) return [];
  const accountKeys = (tx.transaction?.message?.accountKeys || []).map((key) => (typeof key === 'string' ? key : key.pubkey));
  const feePayer = accountKeys[0];
  const fee = tx.meta?.fee || 0;
  const blockTime = tx.blockTime ? tx.blockTime * 1000 : null;
  const signature = tx.transaction?.signatures?.[0];

  const preToken = tx.meta?.preTokenBalances || [];
  const postToken = tx.meta?.postTokenBalances || [];
  const preBalances = tx.meta?.preBalances || [];
  const postBalances = tx.meta?.postBalances || [];
  const WSOL_MINT = 'So11111111111111111111111111111111111111112';

  function tokenDeltaByOwnerForMint(mintAddress) {
    const result = new Map();
    const indices = new Set([...preToken.map((b) => b.accountIndex), ...postToken.map((b) => b.accountIndex)]);
    for (const index of indices) {
      const pre = preToken.find((b) => b.accountIndex === index);
      const post = postToken.find((b) => b.accountIndex === index);
      const mint = (post || pre)?.mint;
      if (mint !== mintAddress) continue;
      const owner = (post || pre)?.owner;
      if (!owner) continue;
      const preAmount = Number(pre?.uiTokenAmount?.uiAmount || 0);
      const postAmount = Number(post?.uiTokenAmount?.uiAmount || 0);
      const delta = postAmount - preAmount;
      if (!delta) continue;
      result.set(owner, (result.get(owner) || 0) + delta);
    }
    return result;
  }

  const tokenDeltaByOwner = tokenDeltaByOwnerForMint(KHAN_MINT);
  // Many AMM swaps (e.g. Raydium) move SOL through wrapped-SOL (WSOL) token
  // accounts rather than native lamport transfers - real Pump.fun bonding-
  // curve buys observed on-chain show this pattern too. Both sources are
  // genuine on-chain balance deltas, so both are checked and summed; nothing
  // here is estimated.
  const wsolDeltaByOwner = tokenDeltaByOwnerForMint(WSOL_MINT);

  const events = [];
  for (const [wallet, khanDelta] of tokenDeltaByOwner.entries()) {
    if (poolAddressSet.has(wallet)) continue;
    if (Math.abs(khanDelta) < 1e-9) continue;
    const direction = khanDelta > 0 ? 'buy' : 'sell';

    let solDelta = 0;
    const walletIndex = accountKeys.indexOf(wallet);
    if (walletIndex >= 0 && preBalances[walletIndex] !== undefined && postBalances[walletIndex] !== undefined) {
      const lamportsDelta = postBalances[walletIndex] - preBalances[walletIndex];
      const feeAdjustment = wallet === feePayer ? fee : 0;
      solDelta += (lamportsDelta + feeAdjustment) / 1e9;
    }
    if (wsolDeltaByOwner.has(wallet)) {
      solDelta += wsolDeltaByOwner.get(wallet);
    }
    // For a buy, the wallet's SOL decreases (solDelta negative) -> report a
    // positive "solAmount spent". For a sell, SOL increases -> "solAmount
    // received". Never fabricated: if the wallet's own SOL/WSOL accounts
    // weren't part of this transaction's balance set (e.g. paid via an
    // intermediary/router), solAmount is left at 0 rather than guessed.
    const solAmount = direction === 'buy' ? Math.max(0, -solDelta) : Math.max(0, solDelta);

    events.push({
      signature,
      blockTime,
      wallet,
      direction,
      khanAmount: Math.abs(khanDelta),
      solAmount,
    });
  }
  return events;
}

// Daily SOL/USD for the day a trade happened (UTC day, matching the cache keys
// already stored). CoinGecko first, as before; Kraken's daily candles second,
// because CoinGecko's keyless API throttles cloud IPs. A null is never cached,
// so a day that could not be priced is retried next time instead of being
// frozen as "unknown".
async function fetchCoinGeckoDayPrice(dayStart) {
  const response = await fetch(
    `https://api.coingecko.com/api/v3/coins/solana/market_chart/range?vs_currency=usd&from=${dayStart}&to=${dayStart + 86400}`,
  );
  if (!response.ok) throw new Error(`coingecko HTTP ${response.status}`);
  const data = await response.json();
  const prices = Array.isArray(data?.prices) ? data.prices : [];
  return prices.length ? Number(prices[Math.floor(prices.length / 2)][1]) || null : null;
}

async function fetchKrakenDayPrice(dayStart) {
  const response = await fetch(`https://api.kraken.com/0/public/OHLC?pair=SOLUSD&interval=1440&since=${dayStart - 1}`);
  if (!response.ok) throw new Error(`kraken HTTP ${response.status}`);
  const data = await response.json();
  const candles = Object.entries(data?.result || {}).find(([key]) => key !== 'last')?.[1] || [];
  // [time, open, high, low, close, vwap, volume, count] - the candle opening at
  // exactly this UTC midnight; its VWAP is the day's representative price.
  const candle = candles.find((c) => Number(c[0]) === dayStart);
  return candle ? Number(candle[5]) || Number(candle[4]) || null : null;
}

async function fetchHistoricalSolUsdPrice(blockTime, meta) {
  if (!blockTime) return { price: null, isEstimated: true };
  const dayKey = new Date(blockTime).toISOString().slice(0, 10);
  if (meta.solPriceCacheByDay[dayKey]) {
    return { price: meta.solPriceCacheByDay[dayKey], isEstimated: true };
  }
  const dayStart = Math.floor(new Date(`${dayKey}T00:00:00Z`).getTime() / 1000);
  for (const source of [fetchCoinGeckoDayPrice, fetchKrakenDayPrice]) {
    try {
      const price = await source(dayStart);
      if (price) {
        meta.solPriceCacheByDay[dayKey] = price;
        return { price, isEstimated: true };
      }
    } catch (error) {
      console.warn(`[khan-indexer] historical SOL/USD for ${dayKey}: ${error.message}`);
    }
  }
  return { price: null, isEstimated: true };
}

// Live KHAN market state (price, venue, bonding-curve status) - see
// _khanMarket.mjs for how the venue is decided from on-chain state.
export async function fetchKhanMarket(options) {
  try {
    return await getKhanMarket(KHAN_MINT, options);
  } catch (error) {
    console.error(`[khan-indexer] KHAN market read failed: ${error.message}`);
    return null;
  }
}

export async function fetchKhanUsdPrice() {
  return (await fetchKhanMarket())?.priceUsd ?? null;
}

export { getCurrentSolUsdPrice };

export async function fetchTotalSupply() {
  const result = await solanaRpc('getTokenSupply', [KHAN_MINT]);
  return Number(result?.value?.uiAmount || 0);
}

// The only "exact truth" reconciliation pass: scans every live token account
// for the mint via getProgramAccounts (same approach already used client-side
// in fetchSolanaHolderAnalytics), so currentBalance/isCurrentHolder are always
// authoritative on-chain values even if incremental tx classification ever
// misses an edge case (e.g. a transaction type not yet seen).
export async function reconcileCurrentBalances(holders, poolAddressSet) {
  const programId = await fetchMintProgramId(KHAN_MINT);
  const accounts = await solanaRpc('getProgramAccounts', [
    programId,
    { encoding: 'jsonParsed', filters: [{ memcmp: { offset: 0, bytes: KHAN_MINT } }] },
  ]);
  const liveBalanceByOwner = new Map();
  for (const account of accounts || []) {
    const info = account?.account?.data?.parsed?.info;
    const owner = info?.owner;
    const amount = Number(info?.tokenAmount?.uiAmount || 0);
    if (!owner || poolAddressSet.has(owner)) continue;
    liveBalanceByOwner.set(owner, (liveBalanceByOwner.get(owner) || 0) + amount);
  }
  const updated = { ...holders };
  for (const [wallet, balance] of liveBalanceByOwner.entries()) {
    const existing = updated[wallet] || newHolderRecord(wallet);
    updated[wallet] = { ...existing, currentBalance: balance, isCurrentHolder: balance > 1e-9 };
  }
  // Any wallet we'd tracked that no longer holds a live account is a
  // confirmed full exit, not a guess.
  for (const wallet of Object.keys(updated)) {
    if (!liveBalanceByOwner.has(wallet)) {
      updated[wallet] = { ...updated[wallet], currentBalance: 0, isCurrentHolder: false };
    }
  }
  return updated;
}

function newHolderRecord(wallet) {
  return {
    wallet,
    currentBalance: 0,
    totalBought: 0,
    totalSold: 0,
    buyCount: 0,
    sellCount: 0,
    solSpent: 0,
    solReceived: 0,
    // Distinct moments, never substituted for one another:
    firstSeenAt: null, // first on-chain KHAN balance change of any kind
    firstHolderAt: null, // first time its KHAN balance went from zero to positive
    firstBuyAt: null,
    lastBuyAt: null,
    lastSellAt: null,
    lastActivityAt: null,
    isCurrentHolder: false,
  };
}

const earliest = (a, b) => (a == null ? b : b == null ? a : Math.min(a, b));
const latest = (a, b) => (a == null ? b : b == null ? a : Math.max(a, b));

// Applies one classified balance change. Returns what changed so the caller can
// time notifications to THIS event: whether the wallet had never been seen, and
// whether it just became a holder (ledger balance crossed from <= 0 to > 0).
function applyEventToHolder(holders, event) {
  const existing = holders[event.wallet] || newHolderRecord(event.wallet);
  const next = { ...existing };
  // event.blockTime is only ever missing for a transaction whose block hasn't
  // finalized timestamp metadata yet (vanishingly rare for confirmed mainnet
  // history) - in that case the buy/sell counts and amounts are still real
  // and recorded, but the timestamp fields are left alone rather than being
  // corrupted with a fabricated "0" date that would sort as the dawn of time.
  const hasTimestamp = typeof event.blockTime === 'number' && event.blockTime > 0;
  const ts = hasTimestamp ? event.blockTime : null;
  const balanceBefore = (existing.totalBought || 0) - (existing.totalSold || 0);
  if (event.direction === 'buy') {
    next.totalBought += event.khanAmount;
    next.buyCount += 1;
    next.solSpent += event.solAmount;
    next.firstBuyAt = earliest(next.firstBuyAt, ts);
    next.lastBuyAt = latest(next.lastBuyAt ?? null, ts);
  } else {
    next.totalSold += event.khanAmount;
    next.sellCount += 1;
    next.solReceived = (next.solReceived || 0) + event.solAmount;
    next.lastSellAt = latest(next.lastSellAt ?? null, ts);
  }
  next.firstSeenAt = earliest(next.firstSeenAt ?? null, ts);
  next.lastActivityAt = latest(next.lastActivityAt, ts);
  const balanceAfter = next.totalBought - next.totalSold;
  const becameHolder = balanceBefore <= 1e-9 && balanceAfter > 1e-9;
  if (becameHolder) next.firstHolderAt = earliest(next.firstHolderAt ?? null, ts);
  holders[event.wallet] = next;
  return { wasNew: existing.buyCount === 0 && existing.sellCount === 0, becameHolder };
}

// Records written before firstSeenAt/firstHolderAt/lastBuyAt/lastSellAt existed
// get them derived once from the transaction log, which is every balance change
// the indexer has ever classified. Only when the log is provably complete (never
// truncated at MAX_TRANSACTIONS): from a partial log these would be wrong.
// Existing fields are never overwritten.
export function backfillHolderTimestamps(holders, transactions) {
  if (transactions.length >= MAX_TRANSACTIONS) return holders;
  const needs = Object.values(holders).some((h) => h.firstSeenAt === undefined);
  if (!needs) return holders;
  const derived = {};
  const ordered = transactions.filter((t) => t.blockTime).sort((a, b) => a.blockTime - b.blockTime);
  for (const tx of ordered) applyEventToHolder(derived, tx);
  const updated = { ...holders };
  for (const [wallet, record] of Object.entries(updated)) {
    if (record.firstSeenAt !== undefined) continue;
    const d = derived[wallet] || newHolderRecord(wallet);
    updated[wallet] = {
      ...record,
      firstSeenAt: d.firstSeenAt,
      firstHolderAt: d.firstHolderAt,
      lastBuyAt: d.lastBuyAt,
      lastSellAt: d.lastSellAt,
    };
  }
  return updated;
}

// Every alert carries two times: eventAt (the chain time of the transaction it
// is about) and detectedAt (when the indexer noticed). createdAt keeps its old
// meaning for readers - the event time - so existing consumers and sorting are
// unchanged.
function alertAt(event, detectedAt) {
  return { createdAt: event.blockTime, eventAt: event.blockTime, detectedAt };
}

function buildAlerts(events, isNewWalletByAddress, detectedAt) {
  const alerts = [];
  for (const event of events) {
    const id = `${event.signature}-${event.wallet}`;
    const at = alertAt(event, detectedAt);
    if (event.direction === 'buy') {
      if (isNewWalletByAddress.get(event.wallet)) {
        alerts.push({ id: `${id}-new-holder`, type: 'new_holder', wallet: event.wallet, amount: event.khanAmount, signature: event.signature, ...at });
        alerts.push({ id: `${id}-new-buyer`, type: 'new_buyer', wallet: event.wallet, amount: event.khanAmount, signature: event.signature, ...at });
      }
      if (event.solAmount >= WHALE_TRADE_SOL_THRESHOLD) {
        alerts.push({ id: `${id}-whale-buy`, type: 'whale_buy', wallet: event.wallet, amount: event.solAmount, signature: event.signature, ...at });
      } else if (event.solAmount >= LARGE_TRADE_SOL_THRESHOLD) {
        alerts.push({ id: `${id}-large-buy`, type: 'large_buy', wallet: event.wallet, amount: event.solAmount, signature: event.signature, ...at });
      }
    } else {
      if (event.solAmount >= WHALE_TRADE_SOL_THRESHOLD) {
        alerts.push({ id: `${id}-whale-sell`, type: 'whale_sell', wallet: event.wallet, amount: event.solAmount, signature: event.signature, ...at });
      } else if (event.solAmount >= LARGE_TRADE_SOL_THRESHOLD) {
        alerts.push({ id: `${id}-large-sell`, type: 'large_sell', wallet: event.wallet, amount: event.solAmount, signature: event.signature, ...at });
      }
    }
  }
  return alerts;
}

// Holder-count and top-holder notifications describe a state change, and the
// state changed at a transaction - so they are stamped with that transaction's
// chain time, not with the moment a sync happened to run (which is how
// "Sahib Sayı Artdı" came to show a 04:40 sync time instead of the 23:49 buy
// that caused it). Only a change no classified transaction explains (seen by the
// live-balance reconciliation alone) falls back to its detection time, and says
// so with timeBasis: 'detected'.
function stateChangeAlert(type, amount, wallet, causingEvent, detectedAt) {
  const prefix = type === 'holder_count_increased' ? 'holder-count' : 'top-holder';
  if (causingEvent?.blockTime) {
    return {
      id: `${prefix}-${causingEvent.signature}`,
      type, wallet, amount, signature: causingEvent.signature,
      ...alertAt(causingEvent, detectedAt), timeBasis: 'event',
    };
  }
  return {
    id: `${prefix}-${detectedAt}`,
    type, wallet, amount, signature: null,
    createdAt: detectedAt, eventAt: null, detectedAt, timeBasis: 'detected',
  };
}

// Two overlapping runs (the scheduled worker and an admin's "Refresh now")
// would both start from the same cursor. The transaction log is deduplicated by
// signature regardless, but the holder totals are incremental, so the second run
// is turned away while the first holds the lease. Blobs has no compare-and-set,
// so this narrows the window rather than closing it; the signature dedup is the
// guarantee that no transaction is ever counted twice.
const LEASE_MS = 14 * 60 * 1000;

// Bounded unit of work: pulls the next batch of signatures since the cursor,
// classifies them, updates the holder ledger + transaction log, advances the
// cursor, and emits alerts. Returns whether the cursor has caught up to the
// chain head so callers can decide whether to loop (manual backfill) or stop
// (scheduled tick).
export async function runSyncBatch({ trigger = 'unknown', runId = null } = {}) {
  const startedAt = Date.now();
  let meta = await readMeta();
  const leaseHolder = runId || `${trigger}-${startedAt}`;
  if (meta.syncLease && meta.syncLease.until > startedAt && meta.syncLease.holder !== leaseHolder) {
    console.warn(`[khan-indexer] ${trigger} run skipped: ${meta.syncLease.holder} holds the sync lease until ${new Date(meta.syncLease.until).toISOString()}`);
    return { processed: 0, reachedHead: false, holderCount: meta.lastHolderCount ?? null, skipped: 'locked' };
  }
  meta.syncLease = { holder: leaseHolder, until: startedAt + LEASE_MS };
  await writeMeta(meta);

  try {
    meta = await refreshPoolAddresses(meta);
    const poolAddressSet = new Set(meta.poolAddresses);

    const { signatures, reachedHead: collectedReachedHead } = await collectNewSignatures(meta.lastSignature);

    const existingTransactions = await readTransactions();
    const knownSignatures = new Set(existingTransactions.map((t) => t.signature).filter(Boolean));
    let holders = backfillHolderTimestamps(await readHolders(), existingTransactions);
    const isNewWalletByAddress = new Map();
    const newTransactionRows = [];
    let allEvents = [];
    let lastBecameHolderEvent = null;
    let duplicatesSkipped = 0;
    // Tracks whether every signature in this batch was either fully processed
    // or confirmed on-chain-failed (no balance change possible). If even one
    // signature could not be fetched after every retry, the batch stops dead
    // at that point - the cursor is left exactly on the last fully-processed
    // signature so the unresolved one is retried (never skipped) on the next
    // run, and reachedHead is forced false so callers keep retrying instead of
    // wrongly concluding the indexer is caught up.
    let haltedOnUnresolvedSignature = false;
    let processedCount = 0;

    for (const sigEntry of signatures) {
      if (sigEntry.err) {
        // A transaction that failed on-chain moved no tokens/SOL - safe to
        // skip and advance the cursor past it with certainty, not a guess.
        meta.lastSignature = sigEntry.signature;
        processedCount += 1;
        continue;
      }
      if (knownSignatures.has(sigEntry.signature)) {
        // Already in the ledger (a lost cursor write, or an overlapping run):
        // applying it again would double-count the wallet's totals.
        duplicatesSkipped += 1;
        meta.lastSignature = sigEntry.signature;
        processedCount += 1;
        continue;
      }
      let tx;
      try {
        tx = await fetchParsedTransactionWithRetry(sigEntry.signature);
      } catch (error) {
        console.error(`[khan-indexer] halting batch at ${sigEntry.signature}: ${error.message}`);
        haltedOnUnresolvedSignature = true;
        break;
      }
      const events = classifyParsedTransaction(tx, poolAddressSet);
      for (const event of events) {
        const { wasNew, becameHolder } = applyEventToHolder(holders, event);
        if (wasNew) isNewWalletByAddress.set(event.wallet, true);
        if (becameHolder) lastBecameHolderEvent = event;
        const { price, isEstimated } = await fetchHistoricalSolUsdPrice(event.blockTime, meta);
        newTransactionRows.push({
          ...event,
          usdEstimate: price ? event.solAmount * price : null,
          usdIsEstimated: isEstimated,
        });
      }
      knownSignatures.add(sigEntry.signature);
      allEvents = allEvents.concat(events);
      meta.lastSignature = sigEntry.signature;
      processedCount += 1;
      if (INTER_REQUEST_DELAY_MS) await sleep(INTER_REQUEST_DELAY_MS);
    }

    const reachedHead = collectedReachedHead && !haltedOnUnresolvedSignature;

    // Reconcile against authoritative live balances rather than trusting the
    // incremental ledger forever - after any batch that moved balances, and
    // otherwise at most every 10 minutes.
    const now = Date.now();
    if (now - meta.lastFullBalanceSyncAt > 10 * 60 * 1000 || allEvents.length) {
      try {
        holders = await reconcileCurrentBalances(holders, poolAddressSet);
        meta.lastFullBalanceSyncAt = now;
      } catch (error) {
        // Leave incremental balances as-is if a full reconciliation pass fails;
        // the next scheduled tick will retry.
        console.error(`[khan-indexer] live balance reconciliation failed: ${error.message}`);
      }
    }

    const alerts = buildAlerts(allEvents, isNewWalletByAddress, now);

    const currentHolderRecords = Object.values(holders).filter((h) => h.isCurrentHolder);
    const currentHolderCount = currentHolderRecords.length;
    const topHolder = currentHolderRecords.reduce((top, h) => (!top || h.currentBalance > top.currentBalance ? h : top), null);
    const lastEvent = allEvents.filter((e) => e.blockTime).at(-1) || null;
    if (meta.lastTopHolderWallet && topHolder && topHolder.wallet !== meta.lastTopHolderWallet) {
      const cause = allEvents.filter((e) => e.wallet === topHolder.wallet && e.blockTime).at(-1) || lastEvent;
      alerts.push(stateChangeAlert('top_holder_changed', topHolder.currentBalance, topHolder.wallet, cause, now));
    }
    if (meta.lastHolderCount !== undefined && meta.lastHolderCount !== null && currentHolderCount > meta.lastHolderCount) {
      alerts.push(stateChangeAlert('holder_count_increased', currentHolderCount, null, lastBecameHolderEvent, now));
    }
    meta.lastTopHolderWallet = topHolder?.wallet || meta.lastTopHolderWallet || null;
    meta.lastHolderCount = currentHolderCount;

    await writeHolders(holders);
    await appendTransactions(newTransactionRows);
    await appendAlerts(alerts);
    meta.cursorReachedHead = reachedHead;
    const latestEventAt = newTransactionRows.reduce((max, row) => Math.max(max, row.blockTime || 0), 0);
    if (latestEventAt) meta.latestEventAt = Math.max(meta.latestEventAt || 0, latestEventAt);
    meta.lastRun = {
      at: now, trigger, ok: true, processed: processedCount, newTransactions: newTransactionRows.length,
      duplicatesSkipped, reachedHead, durationMs: Date.now() - startedAt,
    };
    meta.syncLease = null;
    await writeMeta(meta);

    if (duplicatesSkipped) console.warn(`[khan-indexer] skipped ${duplicatesSkipped} already-recorded signature(s)`);
    return { processed: processedCount, newTransactions: newTransactionRows.length, duplicatesSkipped, reachedHead, holderCount: currentHolderCount };
  } catch (error) {
    console.error(`[khan-indexer] ${trigger} sync batch failed: ${error.message}`);
    // Record the failure and release the lease, on a FRESH read so nothing
    // this failed batch half-computed is persisted. Best effort: if Blobs
    // itself is what failed, this write fails too, and the log line above is
    // the record.
    try {
      const fresh = await readMeta();
      fresh.lastRun = { at: Date.now(), trigger, ok: false, error: error.message, durationMs: Date.now() - startedAt };
      if (fresh.syncLease?.holder === leaseHolder) fresh.syncLease = null;
      await writeMeta(fresh);
    } catch {
      // already logged
    }
    throw error;
  }
}

export { WHALE_SUPPLY_FRACTION };
