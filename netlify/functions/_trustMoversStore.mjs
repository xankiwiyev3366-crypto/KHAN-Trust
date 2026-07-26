// Trust Movers — data layer.
//
// Reads the PostgreSQL `score_history` longitudinal series (the source the Phase
// 1 schema was explicitly built for — "THE Trust Movers source") and turns it
// into the four ranked sections via the pure core in src/lib/trustMovers.js.
//
// PERFORMANCE POSTURE (requirement 8: never scan all projects per request)
//   * The heavy work runs behind a short-TTL cache keyed by the exact query
//     shape (period + chain + audience). A burst of requests collapses onto one
//     computation; steady traffic recomputes at most once per TTL.
//   * The query itself is two DISTINCT ON passes over score_history, which ride
//     the (token_key, observed_date) PRIMARY KEY index — one latest row and one
//     pre-window row per token, not a full history scan. The "current" side is
//     additionally bounded to the selected window so only tokens actually
//     observed recently are even considered.
//   * Reads go through _db.readRows (bounded timeout, never throws/hangs). If
//     Postgres cannot serve the read we DO NOT invent history from Blobs — the
//     watch/corpus Blobs hold no time series — we return an honest
//     insufficient-data result.
import { readRows } from './_db.mjs';
import { mapScoreHistoryRow } from './_pgReads.mjs';
import { getNamedStore } from './_blobsClient.mjs';
import { readStatuses } from './_verificationStore.mjs';
import { buildTrustMovers, isEmptyResult, periodDays, SECTIONS } from '../../src/lib/trustMovers.js';

const CACHE_STORE = 'khan-trust-movers-cache';
// Ten minutes: analytics freshness that a human perceives as "live" while
// keeping the DB work to at most a handful of computations per hour per filter.
const CACHE_TTL_MS = 10 * 60 * 1000;

// Chain filter aliases. The corpus/watch lanes store whatever `chain` string the
// client had in hand (an id like "ethereum", or occasionally a label like "BNB
// Chain"), so the filter normalises BOTH sides: the stored value is lowercased
// in SQL and matched against this alias set for the requested canonical chain.
// Keys are the canonical chain ids from src/chains/registry.js.
const CHAIN_ALIASES = {
  solana: ['solana', 'sol'],
  ethereum: ['ethereum', 'eth', 'ethereum mainnet'],
  base: ['base'],
  bsc: ['bsc', 'bnb', 'bnb chain', 'binance', 'binance smart chain'],
  arbitrum: ['arbitrum', 'arb', 'arbitrum one'],
  optimism: ['optimism', 'op'],
  polygon: ['polygon', 'matic', 'pol'],
  avalanche: ['avalanche', 'avax'],
  sui: ['sui'],
  aptos: ['aptos', 'apt'],
};

export const SUPPORTED_CHAINS = Object.keys(CHAIN_ALIASES);

export function chainAliases(chain) {
  if (!chain || chain === 'all') return null;
  return CHAIN_ALIASES[chain] || [String(chain).toLowerCase()];
}

// The current/previous extraction. Two DISTINCT ON passes, both index-friendly:
//   current  — the latest snapshot within the window (so only recently-observed
//              tokens qualify as movers), one row per token.
//   previous — the latest snapshot at or before the window start, one per token.
// A LEFT JOIN keeps tokens that have a current point but no prior one (they can
// still be "new" movers); `previous` is simply null for them — never faked.
// $1 = window length in days. $2 = chain alias array, or NULL for all chains.
export const TRUST_MOVERS_SQL = `WITH current_snap AS (
  SELECT DISTINCT ON (sh.token_key)
    sh.token_key,
    to_char(sh.observed_date, 'YYYY-MM-DD') AS date,
    sh.score, sh.risk_level, sh.confidence, sh.top_holder_percent,
    sh.liquidity_usd, sh.social_score, sh.asset_category, sh.categories,
    sh.created_at
  FROM score_history sh
  WHERE sh.observed_date >= CURRENT_DATE - $1::int
  ORDER BY sh.token_key, sh.observed_date DESC
),
previous_snap AS (
  SELECT DISTINCT ON (sh.token_key)
    sh.token_key,
    to_char(sh.observed_date, 'YYYY-MM-DD') AS date,
    sh.score, sh.risk_level, sh.confidence, sh.top_holder_percent,
    sh.liquidity_usd, sh.social_score, sh.asset_category, sh.categories
  FROM score_history sh
  WHERE sh.observed_date <= CURRENT_DATE - $1::int
  ORDER BY sh.token_key, sh.observed_date DESC
)
SELECT
  c.token_key AS identity,
  t.contract, t.chain, t.name, t.ticker,
  c.date AS c_date, c.created_at AS c_created,
  c.score AS c_score, c.risk_level AS c_risk_level, c.confidence AS c_confidence,
  c.top_holder_percent AS c_top_holder_percent, c.liquidity_usd AS c_liquidity_usd,
  c.social_score AS c_social_score, c.asset_category AS c_asset_category, c.categories AS c_categories,
  p.date AS p_date,
  p.score AS p_score, p.risk_level AS p_risk_level, p.confidence AS p_confidence,
  p.top_holder_percent AS p_top_holder_percent, p.liquidity_usd AS p_liquidity_usd,
  p.social_score AS p_social_score, p.asset_category AS p_asset_category, p.categories AS p_categories
FROM current_snap c
LEFT JOIN previous_snap p ON p.token_key = c.token_key
LEFT JOIN tokens t ON t.identity = c.token_key
WHERE ($2::text[] IS NULL OR lower(coalesce(t.chain, '')) = ANY($2))`;

// Reassemble one query row into the shape src/lib/trustMovers.js expects:
// { identity, name, ticker, chain, contract, lastUpdated, current, previous }.
// current/previous are rebuilt with the SAME mapper the rest of the platform
// uses (mapScoreHistoryRow), so the diff/explanation logic sees identical
// snapshots to the live ones. A row with no previous score maps `previous` to
// null — the honest "no history before the window" state.
export function rowToMoverInput(row) {
  const current = mapScoreHistoryRow({
    date: row.c_date,
    score: row.c_score,
    risk_level: row.c_risk_level,
    confidence: row.c_confidence,
    top_holder_percent: row.c_top_holder_percent,
    liquidity_usd: row.c_liquidity_usd,
    social_score: row.c_social_score,
    asset_category: row.c_asset_category,
    categories: row.c_categories,
  });
  const previous = row.p_score === null || row.p_score === undefined
    ? null
    : mapScoreHistoryRow({
      date: row.p_date,
      score: row.p_score,
      risk_level: row.p_risk_level,
      confidence: row.p_confidence,
      top_holder_percent: row.p_top_holder_percent,
      liquidity_usd: row.p_liquidity_usd,
      social_score: row.p_social_score,
      asset_category: row.p_asset_category,
      categories: row.p_categories,
    });
  const lastUpdated = row.c_created ? new Date(row.c_created).toISOString() : (row.c_date || null);
  return {
    identity: row.identity,
    name: row.name || row.ticker || row.identity,
    ticker: row.ticker || '',
    chain: row.chain || '',
    contract: row.contract || '',
    lastUpdated,
    current,
    previous,
  };
}

// Verified-only audience filter. Verification statuses live in a Blobs store,
// keyed by projectId, so this is a FAIL-CLOSED intersection: a mover is kept
// only when we can positively confirm it maps to a 'verified' status (by its
// identity's project id — the `id:<projectId>` identity form — or by its
// contract or raw identity appearing as a verified key). Anything we cannot
// confirm is treated as unverified and dropped, so "verified only" never shows a
// project we are not sure about. An empty verified set yields an empty result,
// which is honest, not an error.
async function verifiedKeySet() {
  const statuses = await readStatuses().catch(() => ({}));
  const set = new Set();
  for (const [key, value] of Object.entries(statuses || {})) {
    if (value && value.status === 'verified') set.add(String(key).toLowerCase());
  }
  return set;
}

function moverProjectId(identity) {
  // historyKeyFor() encodes native/early-stage identities as `id:<projectId>`.
  return identity && identity.startsWith('id:') ? identity.slice(3) : null;
}

function isVerifiedMover(mover, verified) {
  if (!verified.size) return false;
  const candidates = [
    moverProjectId(mover.identity),
    mover.contract,
    mover.identity,
  ].filter(Boolean).map((v) => String(v).toLowerCase());
  return candidates.some((c) => verified.has(c));
}

async function applyAudience(sections, audience) {
  // 'all' is the default and needs no work. 'verified' (and 'premium', which we
  // treat as the same curated set until token-level premium tagging exists) is a
  // fail-closed intersection with the verification store.
  if (audience !== 'verified' && audience !== 'premium') return sections;
  const verified = await verifiedKeySet();
  const filtered = {};
  for (const key of SECTIONS) {
    filtered[key] = (sections[key] || []).filter((mover) => isVerifiedMover(mover, verified));
  }
  return filtered;
}

// ── Cache (best-effort, never fatal) ─────────────────────────────────────────
function cacheKey({ period, chain, audience, limit }) {
  return `movers/${period}_${chain}_${audience}_${limit}.json`;
}

async function readCache(key) {
  try {
    const data = await getNamedStore(CACHE_STORE).get(key, { type: 'json' });
    if (!data || typeof data !== 'object' || !data.computedAt) return null;
    if (Date.now() - Date.parse(data.computedAt) > CACHE_TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}

async function writeCache(key, payload) {
  try {
    await getNamedStore(CACHE_STORE).setJSON(key, payload);
  } catch {
    // Cache is an optimisation only; a write miss must never fail the request.
  }
}

// The one public entry point. Returns a fully-shaped result:
//   { period, chain, audience, generatedAt, cached, insufficientData, sections }
// `insufficientData` is true when Postgres could not serve the read OR the query
// produced no rankable movers — both surface to the UI as the same honest
// "Not enough historical data yet." No history is ever invented.
export async function getTrustMovers({ period, chain = 'all', audience = 'all', limit = 20 } = {}) {
  const key = cacheKey({ period, chain, audience, limit });
  const cached = await readCache(key);
  if (cached) return { ...cached.result, cached: true };

  const res = await readRows(TRUST_MOVERS_SQL, [periodDays(period), chainAliases(chain)], { label: 'trust_movers' });
  if (!res.ok) {
    // Postgres unavailable: honestly report insufficient data rather than
    // fabricate movers from a store that has no time series. NOT cached (so the
    // next request retries the DB).
    return {
      period, chain, audience,
      generatedAt: new Date().toISOString(),
      cached: false,
      insufficientData: true,
      reason: 'history_unavailable',
      sections: { rising: [], falling: [], newHighConfidence: [], newlyHighRisk: [] },
    };
  }

  const inputs = res.rows.map(rowToMoverInput);
  const built = buildTrustMovers(inputs, { limit });
  const sections = await applyAudience(built, audience);
  const insufficientData = isEmptyResult(sections);

  const result = {
    period, chain, audience,
    generatedAt: new Date().toISOString(),
    insufficientData,
    sections,
  };
  // Cache successful computations only (never a DB-down result).
  await writeCache(key, { computedAt: new Date().toISOString(), result });
  return { ...result, cached: false };
}
