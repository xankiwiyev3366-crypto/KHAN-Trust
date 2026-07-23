// Phase 1 dual-write: build the PostgreSQL mirror statement for each Blob write
// and execute it best-effort. Blobs stays the source of truth; these never
// throw (see _db.mjs mirror()).
//
// Each write is ONE atomic statement: a CTE upserts the tokens dimension (so
// the fact's foreign key is always satisfiable) and then upserts/inserts the
// fact. One round trip, FK-safe, idempotent.
//
// The build* functions are PURE (no DB, no env) so they can be unit-tested by
// asserting the exact SQL and parameters without a live database.
import { mirror } from './_db.mjs';

// '' / undefined -> null, so COALESCE keeps a previously-known value instead of
// overwriting it with an empty string, and we never store '' as data.
function nz(value) {
  if (value === undefined || value === null) return null;
  const str = String(value);
  return str.length ? str : null;
}

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

// Best-effort extraction of a deployer/dev-wallet address from a watch
// snapshot's signals. The shape of devWallet is not guaranteed, so probe the
// common fields and fall back to null — never throw on a surprising shape.
export function deployerFromSignals(signals) {
  const dw = signals && signals.devWallet;
  if (!dw) return null;
  if (typeof dw === 'string') return dw || null;
  if (typeof dw === 'object') return nz(dw.address || dw.wallet || dw.owner || dw.pubkey || null);
  return null;
}

// ── Corpus (client-lane latest verdict) ─────────────────────────────────────
export function buildCorpusStatement(identity, record = {}) {
  const text = `WITH t AS (
  INSERT INTO tokens (identity, contract, chain, name, ticker, category, last_seen_at)
  VALUES ($1,$2,$3,$4,$5,$6, now())
  ON CONFLICT (identity) DO UPDATE SET
    contract = COALESCE(EXCLUDED.contract, tokens.contract),
    chain    = COALESCE(EXCLUDED.chain, tokens.chain),
    name     = COALESCE(EXCLUDED.name, tokens.name),
    ticker   = COALESCE(EXCLUDED.ticker, tokens.ticker),
    category = COALESCE(EXCLUDED.category, tokens.category),
    last_seen_at = now()
)
INSERT INTO corpus_tokens (identity, trust_score, risk_level, confidence_label, source, updated_at)
VALUES ($1,$7,$8,$9,$10,$11)
ON CONFLICT (identity) DO UPDATE SET
  trust_score = EXCLUDED.trust_score,
  risk_level = EXCLUDED.risk_level,
  confidence_label = EXCLUDED.confidence_label,
  source = EXCLUDED.source,
  updated_at = EXCLUDED.updated_at,
  mirrored_at = now()`;
  const values = [
    identity,
    nz(record.contract), nz(record.chain), nz(record.name), nz(record.ticker), nz(record.category),
    intOrNull(record.trustScore),
    nz(record.riskLevel),
    nz(record.confidenceLabel),
    nz(record.source),
    record.updatedAt || new Date().toISOString(),
  ];
  return { text, values };
}

// ── Score history (client-lane daily series) ────────────────────────────────
export function buildScoreHistoryStatement(key, snapshot = {}) {
  const text = `WITH t AS (
  INSERT INTO tokens (identity, last_seen_at) VALUES ($1, now())
  ON CONFLICT (identity) DO UPDATE SET last_seen_at = now()
)
INSERT INTO score_history
  (token_key, observed_date, score, risk_level, confidence, top_holder_percent, liquidity_usd, social_score, asset_category, categories)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
ON CONFLICT (token_key, observed_date) DO UPDATE SET
  score = EXCLUDED.score,
  risk_level = EXCLUDED.risk_level,
  confidence = EXCLUDED.confidence,
  top_holder_percent = EXCLUDED.top_holder_percent,
  liquidity_usd = EXCLUDED.liquidity_usd,
  social_score = EXCLUDED.social_score,
  asset_category = EXCLUDED.asset_category,
  categories = EXCLUDED.categories`;
  const values = [
    key,
    nz(snapshot.date),
    intOrNull(snapshot.score),
    nz(snapshot.riskLevel),
    intOrNull(snapshot.confidence),
    numOrNull(snapshot.topHolderPercent),
    numOrNull(snapshot.liquidityUsd),
    intOrNull(snapshot.socialScore),
    nz(snapshot.assetCategory),
    snapshot.categories && typeof snapshot.categories === 'object'
      ? JSON.stringify(snapshot.categories)
      : null,
  ];
  return { text, values };
}

// ── Watch snapshot (server-lane observation, append-only) ───────────────────
export function buildWatchStatement(identity, snapshot = {}) {
  const deployer = deployerFromSignals(snapshot.signals);
  const text = `WITH t AS (
  INSERT INTO tokens (identity, contract, chain, name, ticker, deployer_address, last_seen_at)
  VALUES ($1,$2,$3,$4,$5,$6, now())
  ON CONFLICT (identity) DO UPDATE SET
    contract = COALESCE(EXCLUDED.contract, tokens.contract),
    chain    = COALESCE(EXCLUDED.chain, tokens.chain),
    name     = COALESCE(EXCLUDED.name, tokens.name),
    ticker   = COALESCE(EXCLUDED.ticker, tokens.ticker),
    deployer_address = COALESCE(EXCLUDED.deployer_address, tokens.deployer_address),
    last_seen_at = now()
)
INSERT INTO watch_snapshots
  (identity, observed_at, trust_score, risk_level, engine_version, source, deployer_address, signals)
VALUES ($1,$7,$8,$9,$10,$11,$6,$12)
ON CONFLICT (identity, observed_at) DO NOTHING`;
  const values = [
    identity,
    nz(snapshot.contract), nz(snapshot.chain), nz(snapshot.name), nz(snapshot.ticker),
    deployer,
    snapshot.observedAt || new Date().toISOString(),
    intOrNull(snapshot.trustScore),
    nz(snapshot.riskLevel),
    nz(snapshot.engineVersion),
    nz(snapshot.source),
    snapshot.signals && typeof snapshot.signals === 'object'
      ? JSON.stringify(snapshot.signals)
      : null,
  ];
  return { text, values };
}

// ── Best-effort executors called by the Blob stores after their write ───────
export async function mirrorCorpusToken(identity, record) {
  const { text, values } = buildCorpusStatement(identity, record);
  return mirror(text, values);
}

export async function mirrorScoreHistory(key, snapshot) {
  const { text, values } = buildScoreHistoryStatement(key, snapshot);
  return mirror(text, values);
}

export async function mirrorWatchSnapshot(identity, snapshot) {
  const { text, values } = buildWatchStatement(identity, snapshot);
  return mirror(text, values);
}
