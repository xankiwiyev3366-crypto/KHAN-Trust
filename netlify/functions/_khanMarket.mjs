// Live KHAN and SOL market data for the holder-analytics admin page.
//
// SOL/USD comes from the first of several independent public tickers that
// answers. CoinGecko alone was the old source, and its keyless API throttles
// shared cloud egress IPs - the address a Netlify function calls from - so in
// production it answered 429 while working fine from a laptop.
//
// KHAN/USD comes from KHAN's actual trading venue, which is decided from
// on-chain state on every read, never assumed:
//   - Pump.fun bonding curve still active (`complete == false`): the price is the
//     curve's own virtual reserves (the exact quote the program would give) in
//     SOL, times SOL/USD. Progress is read from the same account.
//   - Curve complete: the token has migrated; the price comes from the deepest
//     non-Pump.fun pool DexScreener lists (PumpSwap, Raydium, ...), and no
//     curve percentage is reported, because there no longer is a curve.
//   - Curve unreadable: DexScreener's price is used, and the curve status is
//     reported as unknown rather than guessed.
// Nothing here is ever hard-coded or estimated; a source that cannot be read
// reports null, and the page renders "not available", never $0.
import { PublicKey } from '@solana/web3.js';
import { solanaRpc } from './_khanRpc.mjs';

export const PUMP_FUN_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

// Pump.fun's global curve parameters (raw units, 6-decimal tokens): every curve
// starts with 1,073,000,000 virtual and 793,100,000 real tokens, so
// virtual - real is a constant 279,900,000 for the curve's whole life. Progress
// is the share of the real reserve sold. If a curve's reserves do NOT satisfy
// that invariant it was created under different parameters, and a percentage
// computed from these constants would be invented - so none is reported.
const INITIAL_REAL_TOKEN_RESERVES = 793_100_000_000_000n;
const VIRTUAL_MINUS_REAL_TOKENS = 279_900_000_000_000n;

const FETCH_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 60 * 1000;

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

const positive = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// Ordered: first one to return a sane positive number wins.
export const SOL_USD_PROVIDERS = [
  { name: 'coingecko', url: 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', read: (d) => d?.solana?.usd },
  { name: 'coinbase', url: 'https://api.coinbase.com/v2/prices/SOL-USD/spot', read: (d) => d?.data?.amount },
  { name: 'kraken', url: 'https://api.kraken.com/0/public/Ticker?pair=SOLUSD', read: (d) => Object.values(d?.result || {})[0]?.c?.[0] },
];

let solCache = null;

export async function getSolUsdQuote({ fresh = false } = {}) {
  if (!fresh && solCache && Date.now() - solCache.at < CACHE_TTL_MS) return solCache.quote;
  const failures = [];
  for (const provider of SOL_USD_PROVIDERS) {
    try {
      const price = positive(provider.read(await fetchJson(provider.url)));
      if (price) {
        if (failures.length) console.warn(`[khan-market] SOL/USD from ${provider.name} after: ${failures.join('; ')}`);
        const quote = { price, source: provider.name, at: Date.now() };
        solCache = { at: Date.now(), quote };
        return quote;
      }
      failures.push(`${provider.name}: no price in response`);
    } catch (error) {
      failures.push(`${provider.name}: ${error.name === 'AbortError' ? 'timeout' : error.message}`);
    }
  }
  console.error(`[khan-market] SOL/USD unavailable from every provider: ${failures.join('; ')}`);
  return { price: null, source: null, at: Date.now(), error: failures.join('; ') };
}

export async function getCurrentSolUsdPrice() {
  return (await getSolUsdQuote()).price;
}

export function deriveBondingCurvePda(mint) {
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

// Decodes a Pump.fun BondingCurve account: 8-byte discriminator, then
// virtualTokenReserves, virtualSolReserves, realTokenReserves, realSolReserves,
// tokenTotalSupply (u64 LE each), then `complete` (bool).
export function decodeBondingCurve(data, tokenDecimals = 6) {
  if (!data || data.length < 49) return null;
  const u64 = (offset) => data.readBigUInt64LE(offset);
  const virtualTokenReserves = u64(8);
  const virtualSolReserves = u64(16);
  const realTokenReserves = u64(24);
  const realSolReserves = u64(32);
  const tokenTotalSupply = u64(40);
  const complete = data[48] === 1;

  const priceSol = virtualTokenReserves > 0n
    ? (Number(virtualSolReserves) / 1e9) / (Number(virtualTokenReserves) / 10 ** tokenDecimals)
    : null;

  let progressPercent = null;
  if (complete) {
    progressPercent = 100;
  } else if (virtualTokenReserves - realTokenReserves === VIRTUAL_MINUS_REAL_TOKENS && realTokenReserves <= INITIAL_REAL_TOKEN_RESERVES) {
    const sold = INITIAL_REAL_TOKEN_RESERVES - realTokenReserves;
    // Basis points in BigInt, then to a percentage - no float drift on u64s.
    progressPercent = Number((sold * 1_000_000n) / INITIAL_REAL_TOKEN_RESERVES) / 10_000;
  }

  return {
    complete,
    priceSol,
    progressPercent,
    realSolReserves: Number(realSolReserves) / 1e9,
    realTokenReserves: Number(realTokenReserves) / 10 ** tokenDecimals,
    tokenTotalSupply: Number(tokenTotalSupply) / 10 ** tokenDecimals,
  };
}

async function readBondingCurve(mint, tokenDecimals) {
  const address = deriveBondingCurvePda(mint);
  if (!address) return { address: null, state: null };
  const info = await solanaRpc('getAccountInfo', [address, { encoding: 'base64' }]);
  const value = info?.value;
  if (!value) return { address, state: null, exists: false };
  if (value.owner !== PUMP_FUN_PROGRAM_ID) return { address, state: null, exists: true };
  return { address, exists: true, state: decodeBondingCurve(Buffer.from(value.data[0], 'base64'), tokenDecimals) };
}

async function readDexScreenerPairs(mint) {
  const data = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
  return Array.isArray(data?.pairs) ? data.pairs : [];
}

function deepestPair(pairs) {
  return pairs
    .filter((pair) => positive(pair.priceUsd))
    .sort((a, b) => (Number(b.liquidity?.usd) || 0) - (Number(a.liquidity?.usd) || 0))[0] || null;
}

let marketCache = new Map();

// Returns { priceUsd, priceSol, priceSource, venue, bondingCurve, solUsd, at }.
export async function getKhanMarket(mint, { tokenDecimals = 6, fresh = false } = {}) {
  const cached = marketCache.get(mint);
  if (!fresh && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.market;

  const [solUsd, curveResult, pairsResult] = await Promise.all([
    getSolUsdQuote({ fresh }),
    readBondingCurve(mint, tokenDecimals).then((v) => ({ ok: true, v }), (error) => ({ ok: false, error })),
    readDexScreenerPairs(mint).then((v) => ({ ok: true, v }), (error) => ({ ok: false, error })),
  ]);
  if (!curveResult.ok) console.error(`[khan-market] bonding-curve read failed: ${curveResult.error.message}`);
  if (!pairsResult.ok) console.error(`[khan-market] DexScreener read failed: ${pairsResult.error.message}`);

  const curve = curveResult.ok ? curveResult.v : null;
  const pairs = pairsResult.ok ? pairsResult.v : [];

  const market = {
    priceUsd: null,
    priceSol: null,
    priceSource: null,
    venue: null,
    pairAddress: null,
    bondingCurve: { status: 'unknown', progressPercent: null, address: curve?.address || null },
    solUsd: solUsd.price,
    solUsdSource: solUsd.source,
    at: Date.now(),
  };

  if (curve?.state && !curve.state.complete) {
    market.venue = 'pumpfun_bonding_curve';
    market.pairAddress = curve.address;
    market.bondingCurve = { status: 'active', progressPercent: curve.state.progressPercent, address: curve.address, realSolReserves: curve.state.realSolReserves };
    market.priceSol = curve.state.priceSol;
    if (market.priceSol && solUsd.price) {
      market.priceUsd = market.priceSol * solUsd.price;
      market.priceSource = 'bonding_curve';
    } else {
      // SOL/USD unavailable: DexScreener's own USD quote for the same curve is
      // the next-best real number.
      const pumpPair = pairs.find((pair) => pair.dexId === 'pumpfun' && positive(pair.priceUsd));
      if (pumpPair) {
        market.priceUsd = Number(pumpPair.priceUsd);
        market.priceSource = 'dexscreener';
      }
    }
  } else {
    const migrated = Boolean(curve?.state?.complete);
    const candidates = migrated ? pairs.filter((pair) => pair.dexId !== 'pumpfun') : pairs;
    const pair = deepestPair(candidates);
    if (migrated) market.bondingCurve = { status: 'complete', progressPercent: null, address: curve.address };
    if (pair) {
      market.venue = pair.dexId || null;
      market.pairAddress = pair.pairAddress || null;
      market.priceUsd = Number(pair.priceUsd);
      market.priceSol = positive(pair.priceNative);
      market.priceSource = 'dexscreener';
    }
  }

  if (!market.priceUsd) console.error(`[khan-market] KHAN/USD unavailable (venue=${market.venue}, curve=${market.bondingCurve.status}, sol=${solUsd.price ? 'ok' : 'missing'})`);
  marketCache.set(mint, { at: Date.now(), market });
  return market;
}

// Test hook: forget cached quotes.
export function resetMarketCache() {
  solCache = null;
  marketCache = new Map();
}
