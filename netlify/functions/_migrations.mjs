// Embedded migration SQL for the serverless ops runner (db-admin.mjs).
//
// Netlify Functions bundle JS, not loose .sql files, so the runtime migration
// path cannot readFileSync the files in db/migrations. The SQL is embedded here
// verbatim instead. db/migrations/0001_phase1_init.sql remains the canonical,
// human-readable copy, and tests/migrationsDrift.test.mjs asserts this string
// is byte-identical to it so the two can never drift.
//
// Ordered oldest-first; each `sql` must be idempotent (IF NOT EXISTS) so a
// re-run is always safe.

export const PHASE1_INIT_SQL = `-- Phase 1 — PostgreSQL mirror schema for the KHAN Trust longitudinal data.
--
-- This is a MIRROR, not a source of truth. During Phase 1 every write still
-- lands in Netlify Blobs first (unchanged), and reads never touch Postgres.
-- These tables exist so that, once backfilled and verified, they can power
-- Trust Movers, Deployer Reputation, historical trends and AI features that a
-- key/value blob store cannot serve.
--
-- Idempotent: safe to run repeatedly (IF NOT EXISTS + ON CONFLICT upserts in
-- the mirror layer). Applied and recorded by scripts/db-migrate.mjs.

-- Applied-migration ledger, so db-migrate.mjs runs each file exactly once.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dimension: one row per canonical token identity. The join key across every
-- fact table. Descriptive columns are filled in best-effort from whichever
-- lane sees them first (corpus/watch carry them; score-history carries only the
-- identity), so they are nullable and merged with COALESCE on conflict.
CREATE TABLE IF NOT EXISTS tokens (
  identity         TEXT PRIMARY KEY,
  contract         TEXT,
  chain            TEXT,
  name             TEXT,
  ticker           TEXT,
  category         TEXT,
  deployer_address TEXT,                          -- seeds Deployer Reputation (Phase 2)
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tokens_chain    ON tokens (chain);
CREATE INDEX IF NOT EXISTS idx_tokens_deployer ON tokens (deployer_address) WHERE deployer_address IS NOT NULL;

-- Client-lane latest verdict (mirror of the khan-trust-corpus per-token blob).
-- One row per token; latest write wins. Discovery / leaderboards source later.
CREATE TABLE IF NOT EXISTS corpus_tokens (
  identity         TEXT PRIMARY KEY REFERENCES tokens(identity) ON DELETE CASCADE,
  trust_score      SMALLINT NOT NULL CHECK (trust_score BETWEEN 0 AND 100),
  risk_level       TEXT CHECK (risk_level IN ('Low','Medium','High')),
  confidence_label TEXT,
  source           TEXT,
  updated_at       TIMESTAMPTZ NOT NULL,
  mirrored_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_corpus_updated ON corpus_tokens (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_corpus_score   ON corpus_tokens (trust_score DESC);

-- Client-lane daily series (mirror of khan-trust-score-history). One row per
-- (token, calendar day); a same-day rescan upserts. THE Trust Movers source.
CREATE TABLE IF NOT EXISTS score_history (
  token_key          TEXT NOT NULL REFERENCES tokens(identity) ON DELETE CASCADE,
  observed_date      DATE NOT NULL,
  score              SMALLINT NOT NULL CHECK (score BETWEEN 0 AND 100),
  risk_level         TEXT CHECK (risk_level IN ('Low','Medium','High')),
  confidence         SMALLINT CHECK (confidence BETWEEN 0 AND 100),
  top_holder_percent NUMERIC(6,3),
  liquidity_usd      NUMERIC(20,2),
  social_score       SMALLINT,
  asset_category     TEXT,
  categories         JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (token_key, observed_date)
);
CREATE INDEX IF NOT EXISTS idx_score_hist_date ON score_history (observed_date DESC);

-- Server-lane observations (from khan-trust-watch-snapshots writes). The Blob
-- keeps only the LATEST observation per token; Postgres keeps EVERY observation
-- as an append-only series — pure additive analytics value, no behaviour change.
CREATE TABLE IF NOT EXISTS watch_snapshots (
  identity         TEXT NOT NULL REFERENCES tokens(identity) ON DELETE CASCADE,
  observed_at      TIMESTAMPTZ NOT NULL,
  trust_score      SMALLINT NOT NULL CHECK (trust_score BETWEEN 0 AND 100),
  risk_level       TEXT CHECK (risk_level IN ('Low','Medium','High')),
  engine_version   TEXT,
  source           TEXT,
  deployer_address TEXT,
  signals          JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (identity, observed_at)             -- idempotent on exact re-write
);
CREATE INDEX IF NOT EXISTS idx_watch_identity_time ON watch_snapshots (identity, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_watch_deployer      ON watch_snapshots (deployer_address) WHERE deployer_address IS NOT NULL;
`;

// Ordered migration list. version === the filename stem recorded in
// schema_migrations, so the serverless runner and scripts/db-migrate.mjs agree
// on what "already applied" means.
export const MIGRATIONS = [
  { version: '0001_phase1_init.sql', sql: PHASE1_INIT_SQL },
];
