// Phase 2 — Postgres-FIRST reads for the three already-mirrored analytics
// domains (token corpus listing, score history, watch snapshots).
//
// Postgres is now the PRIMARY read source for these lanes; Netlify Blobs remains
// a temporary safety fallback for when the DB cannot serve a read (see each
// store module). This module owns two things and nothing else:
//
//   1. The SELECT statements (Postgres-side ordering is authoritative — the DB
//      sorts, the caller does not re-sort a trusted result).
//   2. PURE row-mappers that rebuild the EXACT Blob response shape from a DB row,
//      so every existing API contract and frontend consumer is unchanged. The
//      mappers take a plain object and are unit-tested without a live database.
//
// The reader functions wrap _db.readRows() (which never throws and never hangs)
// and return a small discriminated result:
//   { ok: true, value }  — Postgres answered; value is already in Blob shape.
//                          An empty series ([]/{}) is a VALID answer, not a miss.
//   { ok: false }        — Postgres could not serve it; the store falls back to
//                          Blobs. readRows has already logged the reason.
//
// WHY NOT the single per-token corpus record: the corpus mirror is a LOSSY
// projection — it does not store `scoreInputs`, which the monitored-score bridge
// (src/lib/monitoredScore.js) reads off the corpus record to rebuild a full
// score. Serving getCorpusToken() from Postgres would silently drop that field
// and break Trust Graph gap-fill, so that read stays Blob-authoritative. Only
// the DISCOVERY LISTING (which needs none of those fields) is served here.
import { readRows } from './_db.mjs';

// ── Shared coercions (Postgres returns NUMERIC as strings, smallint as number) ─
function intOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function numOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// A TIMESTAMPTZ column comes back from node-pg as a JS Date at the correct
// instant regardless of server timezone; normalise to the exact UTC ISO string
// the Blob snapshots store, so a PG-served snapshot is byte-identical in shape.
function isoOrNull(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ── Score history ────────────────────────────────────────────────────────────
// observed_date is a DATE; to_char keeps it a 'YYYY-MM-DD' string so node-pg's
// local-midnight Date parsing can never shift a point onto the wrong day.
export const SCORE_HISTORY_SQL = `SELECT
  to_char(observed_date, 'YYYY-MM-DD') AS date,
  score, risk_level, confidence, top_holder_percent, liquidity_usd,
  social_score, asset_category, categories
FROM score_history
WHERE token_key = $1
ORDER BY observed_date ASC`;

// One row → the exact snapshot shape src/scoreHistory.js writes to the Blob.
// `complete: true` is reconstructed, not stored: the write path only ever
// persists snapshots that passed the quality gate (assessSnapshot /
// buildMonitoredHistoryPoint both stamp complete:true), so every stored row is
// by construction a complete observation. isValidSnapshot() would treat a
// missing flag as valid anyway; setting it true is the faithful, explicit form.
export function mapScoreHistoryRow(row) {
  return {
    date: row.date,
    score: intOrNull(row.score),
    riskLevel: row.risk_level ?? null,
    confidence: intOrNull(row.confidence),
    complete: true,
    topHolderPercent: numOrNull(row.top_holder_percent),
    liquidityUsd: numOrNull(row.liquidity_usd),
    categories: row.categories ?? null,
    socialScore: intOrNull(row.social_score),
    assetCategory: row.asset_category ?? '',
  };
}

export async function readScoreHistory(key) {
  const res = await readRows(SCORE_HISTORY_SQL, [key], { label: 'score_history' });
  if (!res.ok) return { ok: false };
  return { ok: true, value: res.rows.map(mapScoreHistoryRow) };
}

// ── Watch snapshots ──────────────────────────────────────────────────────────
// The descriptive columns (contract/chain/name/ticker) live on the tokens
// dimension, so every watch read LEFT JOINs it to reproduce the full Blob
// snapshot shape. deployer_address is NOT surfaced as a top-level field because
// the Blob snapshot never had one (it lives inside signals.devWallet) — shape
// fidelity means adding nothing the Blob lacked.
const WATCH_COLUMNS = `w.identity, t.contract, t.chain, t.name, t.ticker,
  w.trust_score, w.risk_level, w.engine_version, w.source, w.observed_at, w.signals`;

export const WATCH_LATEST_SQL = `SELECT ${WATCH_COLUMNS}
FROM watch_snapshots w
LEFT JOIN tokens t ON t.identity = w.identity
WHERE w.identity = $1
ORDER BY w.observed_at DESC
LIMIT 1`;

// Latest observation per identity in ONE round trip (DISTINCT ON keeps the first
// row of each identity group, and the ORDER BY makes that the newest).
export const WATCH_LATEST_BATCH_SQL = `SELECT DISTINCT ON (w.identity) ${WATCH_COLUMNS}
FROM watch_snapshots w
LEFT JOIN tokens t ON t.identity = w.identity
WHERE w.identity = ANY($1)
ORDER BY w.identity, w.observed_at DESC`;

// The FULL append-only series for one token, oldest→newest. This is the whole
// reason Postgres exists for this lane: the Blob keeps only the latest, so this
// history can only ever come from the DB.
export const WATCH_HISTORY_SQL = `SELECT ${WATCH_COLUMNS}
FROM watch_snapshots w
LEFT JOIN tokens t ON t.identity = w.identity
WHERE w.identity = $1
ORDER BY w.observed_at ASC`;

export function mapWatchRow(row) {
  return {
    identity: row.identity,
    contract: row.contract ?? '',
    chain: row.chain ?? '',
    name: row.name ?? '',
    ticker: row.ticker ?? '',
    trustScore: intOrNull(row.trust_score),
    riskLevel: row.risk_level ?? null,
    signals: row.signals ?? null,
    source: row.source ?? null,
    engineVersion: row.engine_version ?? null,
    observedAt: isoOrNull(row.observed_at),
  };
}

export async function readWatchLatest(identity) {
  const res = await readRows(WATCH_LATEST_SQL, [identity], { label: 'watch_latest' });
  if (!res.ok) return { ok: false };
  return { ok: true, value: res.rows.length ? mapWatchRow(res.rows[0]) : null };
}

export async function readWatchLatestBatch(identities) {
  const res = await readRows(WATCH_LATEST_BATCH_SQL, [identities], { label: 'watch_latest_batch' });
  if (!res.ok) return { ok: false };
  // Seed every requested identity to null so a token with no observation yet is
  // reported as absent (the normal first-run state), exactly like the Blob path.
  const map = {};
  for (const identity of identities) map[identity] = null;
  for (const row of res.rows) map[row.identity] = mapWatchRow(row);
  return { ok: true, value: map };
}

export async function readWatchHistory(identity) {
  const res = await readRows(WATCH_HISTORY_SQL, [identity], { label: 'watch_history' });
  if (!res.ok) return { ok: false };
  return { ok: true, value: res.rows.map(mapWatchRow) };
}

// ── Corpus discovery listing ─────────────────────────────────────────────────
// Feeds token-corpus-list and the sitemap. Maps to the compact index-entry shape
// (a subset of the full record) — all of which Postgres holds, so this listing
// is served completely from the DB. Capped to match the Blob index's own cap so
// `total` semantics are unchanged.
export const CORPUS_LISTING_SQL = `SELECT
  c.identity, t.contract, t.chain, t.name, t.ticker, t.category,
  c.trust_score, c.risk_level, c.updated_at
FROM corpus_tokens c
LEFT JOIN tokens t ON t.identity = c.identity
ORDER BY c.updated_at DESC
LIMIT $1`;

export function mapCorpusIndexRow(row) {
  return {
    identity: row.identity,
    contract: row.contract ?? '',
    chain: row.chain ?? '',
    name: row.name ?? '',
    ticker: row.ticker ?? '',
    trustScore: intOrNull(row.trust_score),
    riskLevel: row.risk_level ?? null,
    category: row.category ?? '',
    updatedAt: isoOrNull(row.updated_at),
  };
}

// Returns the same identity→entry MAP shape readIndex() produces, so the two
// read endpoints keep their existing Object.values()/sort/slice logic verbatim.
export async function readCorpusListing(limit) {
  const res = await readRows(CORPUS_LISTING_SQL, [limit], { label: 'corpus_listing' });
  if (!res.ok) return { ok: false };
  const map = {};
  for (const row of res.rows) {
    const entry = mapCorpusIndexRow(row);
    map[entry.identity] = entry;
  }
  return { ok: true, value: map };
}
