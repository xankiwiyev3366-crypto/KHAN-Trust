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
import { PublicKey } from '@solana/web3.js';
import { readMeta, writeMeta, readHolders, writeHolders, appendTransactions, appendAlerts } from './_khanHolderStore.mjs';

export const KHAN_MINT = '6bSHkoMYqzyCZdWPQ45nUv73dvdfx4yEd4yEemefpump';

const PUMP_FUN_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';
const RPC_URL = HELIUS_API_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`
  : process.env.SOLANA_RPC_URL || process.env.VITE_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

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

async function solanaRpc(method, params) {
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params }),
  });
  if (!response.ok) throw new Error(`${method} failed (${response.status}).`);
  const payload = await response.json();
  if (payload.error) throw new Error(`${method}: ${payload.error.message}`);
  return payload.result;
}

async function fetchMintProgramId(mint) {
  const accountInfo = await solanaRpc('getAccountInfo', [mint, { encoding: 'jsonParsed' }]);
  return accountInfo?.value?.owner || TOKEN_PROGRAM_ID;
}

function deriveBondingCurvePda(mint) {
  try {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('bonding-curve'), new PublicKey(mint).toBuffer()],
      new PublicKey(PUMP_FUN_PROGRAM_ID),
    );
    return pda.toBase58();
  } catch {
    return null;
  }
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

async function fetchSignaturePage(before) {
  const params = before ? [KHAN_MINT, { limit: SIGNATURES_PAGE_SIZE, before }] : [KHAN_MINT, { limit: SIGNATURES_PAGE_SIZE }];
  const result = await solanaRpc('getSignaturesForAddress', params);
  return Array.isArray(result) ? result : [];
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

async function fetchParsedTransaction(signature) {
  return solanaRpc('getTransaction', [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]);
}

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

async function fetchHistoricalSolUsdPrice(blockTime, meta) {
  if (!blockTime) return { price: null, isEstimated: true };
  const dayKey = new Date(blockTime).toISOString().slice(0, 10);
  if (meta.solPriceCacheByDay[dayKey]) {
    return { price: meta.solPriceCacheByDay[dayKey], isEstimated: true };
  }
  try {
    const dayStart = Math.floor(new Date(`${dayKey}T00:00:00Z`).getTime() / 1000);
    const dayEnd = dayStart + 86400;
    const response = await fetch(
      `https://api.coingecko.com/api/v3/coins/solana/market_chart/range?vs_currency=usd&from=${dayStart}&to=${dayEnd}`,
    );
    if (!response.ok) return { price: null, isEstimated: true };
    const data = await response.json();
    const prices = Array.isArray(data?.prices) ? data.prices : [];
    if (!prices.length) return { price: null, isEstimated: true };
    const price = prices[Math.floor(prices.length / 2)][1];
    meta.solPriceCacheByDay[dayKey] = price;
    return { price, isEstimated: true };
  } catch {
    return { price: null, isEstimated: true };
  }
}

// Live KHAN/USD price for "current holdings value" - read from Dexscreener's
// public pairs endpoint (same data source already used elsewhere in the app
// for token pricing display). This is a read-only lookup for the holder
// table; it does not touch or alter the existing Pricing module.
export async function fetchKhanUsdPrice() {
  try {
    const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${KHAN_MINT}`);
    if (!response.ok) return null;
    const data = await response.json();
    const pairs = Array.isArray(data?.pairs) ? data.pairs : [];
    const withPrice = pairs.find((pair) => pair.priceUsd);
    return withPrice ? Number(withPrice.priceUsd) : null;
  } catch {
    return null;
  }
}

export async function fetchTotalSupply() {
  const result = await solanaRpc('getTokenSupply', [KHAN_MINT]);
  return Number(result?.value?.uiAmount || 0);
}

export async function getCurrentSolUsdPrice() {
  try {
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    if (!response.ok) return null;
    const data = await response.json();
    return data?.solana?.usd || null;
  } catch {
    return null;
  }
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
    firstBuyAt: null,
    lastActivityAt: null,
    isCurrentHolder: false,
  };
}

function applyEventToHolder(holders, event) {
  const existing = holders[event.wallet] || newHolderRecord(event.wallet);
  const next = { ...existing };
  if (event.direction === 'buy') {
    next.totalBought += event.khanAmount;
    next.buyCount += 1;
    next.solSpent += event.solAmount;
    if (!next.firstBuyAt || event.blockTime < next.firstBuyAt) next.firstBuyAt = event.blockTime;
  } else {
    next.totalSold += event.khanAmount;
    next.sellCount += 1;
    next.solReceived += event.solAmount;
  }
  if (!next.lastActivityAt || (event.blockTime && event.blockTime > next.lastActivityAt)) {
    next.lastActivityAt = event.blockTime;
  }
  holders[event.wallet] = next;
  return existing.buyCount === 0 && existing.sellCount === 0;
}

function buildAlerts(events, holders, isNewWalletByAddress) {
  const alerts = [];
  for (const event of events) {
    const id = `${event.signature}-${event.wallet}`;
    if (event.direction === 'buy') {
      if (isNewWalletByAddress.get(event.wallet)) {
        alerts.push({ id: `${id}-new-holder`, type: 'new_holder', wallet: event.wallet, amount: event.khanAmount, signature: event.signature, createdAt: event.blockTime });
        alerts.push({ id: `${id}-new-buyer`, type: 'new_buyer', wallet: event.wallet, amount: event.khanAmount, signature: event.signature, createdAt: event.blockTime });
      }
      if (event.solAmount >= WHALE_TRADE_SOL_THRESHOLD) {
        alerts.push({ id: `${id}-whale-buy`, type: 'whale_buy', wallet: event.wallet, amount: event.solAmount, signature: event.signature, createdAt: event.blockTime });
      } else if (event.solAmount >= LARGE_TRADE_SOL_THRESHOLD) {
        alerts.push({ id: `${id}-large-buy`, type: 'large_buy', wallet: event.wallet, amount: event.solAmount, signature: event.signature, createdAt: event.blockTime });
      }
    } else {
      if (event.solAmount >= WHALE_TRADE_SOL_THRESHOLD) {
        alerts.push({ id: `${id}-whale-sell`, type: 'whale_sell', wallet: event.wallet, amount: event.solAmount, signature: event.signature, createdAt: event.blockTime });
      } else if (event.solAmount >= LARGE_TRADE_SOL_THRESHOLD) {
        alerts.push({ id: `${id}-large-sell`, type: 'large_sell', wallet: event.wallet, amount: event.solAmount, signature: event.signature, createdAt: event.blockTime });
      }
    }
  }
  return alerts;
}

// Bounded unit of work: pulls the next batch of signatures since the cursor,
// classifies them, updates the holder ledger + transaction log, advances the
// cursor, and emits alerts. Returns whether the cursor has caught up to the
// chain head so callers can decide whether to loop (manual backfill) or stop
// (scheduled tick).
export async function runSyncBatch() {
  let meta = await readMeta();
  meta = await refreshPoolAddresses(meta);
  const poolAddressSet = new Set(meta.poolAddresses);

  const { signatures, reachedHead } = await collectNewSignatures(meta.lastSignature);

  let holders = await readHolders();
  const isNewWalletByAddress = new Map();
  const newTransactionRows = [];
  let allEvents = [];

  for (const sigEntry of signatures) {
    if (sigEntry.err) continue;
    let tx;
    try {
      tx = await fetchParsedTransaction(sigEntry.signature);
    } catch {
      continue;
    }
    const events = classifyParsedTransaction(tx, poolAddressSet);
    for (const event of events) {
      const wasNew = applyEventToHolder(holders, event);
      if (wasNew) isNewWalletByAddress.set(event.wallet, true);
      const { price, isEstimated } = await fetchHistoricalSolUsdPrice(event.blockTime, meta);
      newTransactionRows.push({
        ...event,
        usdEstimate: price ? event.solAmount * price : null,
        usdIsEstimated: isEstimated,
      });
    }
    allEvents = allEvents.concat(events);
    meta.lastSignature = sigEntry.signature;
  }

  // Periodically reconcile against authoritative live balances rather than
  // trusting the incremental ledger forever - bounded to avoid doing a full
  // program-account scan on every single batch.
  const now = Date.now();
  if (now - meta.lastFullBalanceSyncAt > 10 * 60 * 1000) {
    try {
      holders = await reconcileCurrentBalances(holders, poolAddressSet);
      meta.lastFullBalanceSyncAt = now;
    } catch {
      // Leave incremental balances as-is if a full reconciliation pass fails;
      // the next scheduled tick will retry.
    }
  }

  const alerts = buildAlerts(allEvents, holders, isNewWalletByAddress);

  const currentHolderRecords = Object.values(holders).filter((h) => h.isCurrentHolder);
  const currentHolderCount = currentHolderRecords.length;
  const topHolder = currentHolderRecords.reduce((top, h) => (!top || h.currentBalance > top.currentBalance ? h : top), null);
  if (meta.lastTopHolderWallet && topHolder && topHolder.wallet !== meta.lastTopHolderWallet) {
    alerts.push({ id: `top-holder-${Date.now()}`, type: 'top_holder_changed', wallet: topHolder.wallet, amount: topHolder.currentBalance, signature: null, createdAt: Date.now() });
  }
  if (meta.lastHolderCount !== undefined && meta.lastHolderCount !== null && currentHolderCount > meta.lastHolderCount) {
    alerts.push({ id: `holder-count-${Date.now()}`, type: 'holder_count_increased', wallet: null, amount: currentHolderCount, signature: null, createdAt: Date.now() });
  }
  meta.lastTopHolderWallet = topHolder?.wallet || meta.lastTopHolderWallet || null;
  meta.lastHolderCount = currentHolderCount;

  await writeHolders(holders);
  await appendTransactions(newTransactionRows);
  await appendAlerts(alerts);
  meta.cursorReachedHead = reachedHead;
  await writeMeta(meta);

  return { processed: signatures.length, reachedHead, holderCount: currentHolderCount };
}

export { WHALE_SUPPLY_FRACTION };
