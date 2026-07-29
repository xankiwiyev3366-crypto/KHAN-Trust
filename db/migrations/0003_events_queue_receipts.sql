-- Phase 5 — product events, the durable outbox, and verification receipts.
--
-- THE SPLIT THIS FILE INHERITS, AND THE ONE PLACE IT EXTENDS IT
--
-- 0001 established the rule: Blobs is the source of truth, Postgres is a
-- best-effort mirror, and a missing DATABASE_URL costs nothing. 0002 carved out
-- exactly one exception — verification_active_contracts — because "at most one
-- active verification per contract" is a CONSTRAINT and a key/value store
-- cannot express one at any price.
--
-- This migration adds the second and last such exception: queue_leases.
--
-- Everything else here is a reporting projection and behaves exactly like every
-- other mirror. Without DATABASE_URL:
--   product_events         still written to Blobs; the funnel reads them from
--                          Blobs instead, more slowly.
--   queue_jobs             still written to Blobs; the admin queue view reads
--                          Blobs.
--   verification_receipts  still written to Blobs; receipts render from Blobs.
--   queue_leases           degrades to a write-then-reread check, which is racy.
--                          See the header of netlify/functions/_eventQueue.mjs
--                          for what that race actually costs (nothing that is
--                          not already absorbed by idempotent handlers) and why
--                          the recommendation is still to set DATABASE_URL.
--
-- Idempotent: safe to run repeatedly. Applied by `node scripts/db-migrate.mjs`,
-- which is MANUAL and deliberately not wired into the build.

-- ── Product events ──────────────────────────────────────────────────────────
--
-- The funnel's source data. One row per distinct product event.
--
-- NO PERSONAL DATA BY CONSTRUCTION, not merely by convention: the writer
-- (_productEvents.mjs) strips a denylist of keys from `metadata` and refuses
-- nested objects, and `source` is truncated to a URL origin so a referrer's
-- query string — which routinely carries a token or an email somebody else put
-- there — never lands in a table that is kept forever.
CREATE TABLE IF NOT EXISTS product_events (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  session_id  TEXT,
  user_id     TEXT,
  order_id    TEXT,
  project_id  TEXT,
  chain       TEXT,
  contract    TEXT,
  source      TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- THE IDEMPOTENCY KEY. Derived from the thing that happened (an order id, a
  -- project id, a session+day bucket) rather than from the clock, so a retried
  -- request, a re-run cron and a double-clicking user all collapse to one row.
  -- UNIQUE here is what makes recordEvent's `ON CONFLICT (dedup_key) DO NOTHING`
  -- an actual guarantee rather than a hopeful read-then-write.
  --
  -- Partial, because an event with no natural key legitimately has NULL and
  -- several of those may coexist.
  dedup_key   TEXT,
  created_at  TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_product_events_dedup
  ON product_events (dedup_key) WHERE dedup_key IS NOT NULL;
-- The funnel's only query shape: a time window, then grouped by name.
CREATE INDEX IF NOT EXISTS idx_product_events_created ON product_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_events_name_created ON product_events (name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_events_order ON product_events (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_product_events_contract ON product_events (chain, contract)
  WHERE contract IS NOT NULL;

-- ── The outbox ──────────────────────────────────────────────────────────────
--
-- Reporting projection of the job blobs. The queue WORKS without this table;
-- what it buys is an admin queue view that does not have to list and fetch every
-- blob, and a permanent record of jobs that have since been deleted from the
-- live prefix on completion.
CREATE TABLE IF NOT EXISTS queue_jobs (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  status       TEXT NOT NULL,
  attempts     SMALLINT NOT NULL DEFAULT 0,
  dedup_key    TEXT,
  last_error   TEXT,
  run_after    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
-- One job per idempotency key. The enqueue path also checks a Blob marker
-- first; this is the constraint that makes it true rather than likely.
CREATE UNIQUE INDEX IF NOT EXISTS uq_queue_jobs_dedup
  ON queue_jobs (dedup_key) WHERE dedup_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_queue_jobs_status ON queue_jobs (status, run_after);
CREATE INDEX IF NOT EXISTS idx_queue_jobs_created ON queue_jobs (created_at DESC);

-- THE LEASE. The second thing in this schema that is a constraint rather than a
-- projection, and it exists for one property Blobs cannot provide: no two
-- workers may hold the same job at once. @netlify/blobs has no conditional
-- write — no onlyIfMatch, no etag precondition on set — so compare-and-swap is
-- not available there at any price.
--
-- job_id is the PRIMARY KEY, so claiming is a single atomic statement:
--
--   INSERT ... ON CONFLICT (job_id) DO UPDATE
--     SET worker_id = EXCLUDED.worker_id, expires_at = EXCLUDED.expires_at
--     WHERE queue_leases.expires_at < now()
--   RETURNING worker_id
--
-- A live lease makes the UPDATE match nothing, RETURNING is empty, and the
-- caller loses. A lease from a worker that died is reclaimed by the same
-- statement, so a crash cannot wedge a job forever.
--
-- NO FOREIGN KEY to queue_jobs, for exactly the reason 0002 gives for
-- verification_active_contracts: queue_jobs is populated by a best-effort mirror
-- that may silently no-op on a timeout. An FK would make the lease inherit that
-- unreliability backwards — the job would be safely in Blobs, the mirror row
-- missing, and the claim would fail on a constraint violation, refusing to
-- process real work because a REPORTING write was slow.
CREATE TABLE IF NOT EXISTS queue_leases (
  job_id     TEXT PRIMARY KEY,
  worker_id  TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
-- Lets an operator (or a future sweeper) find abandoned leases cheaply.
CREATE INDEX IF NOT EXISTS idx_queue_leases_expiry ON queue_leases (expires_at);

-- ── Receipts ────────────────────────────────────────────────────────────────
--
-- WRITE-ONCE FINANCIAL RECORDS. `ON CONFLICT (order_id) DO NOTHING` in the
-- writer plus the unique constraint here is what makes a retried receipt job a
-- no-op instead of a rewrite — and a rewrite is the failure that matters: a
-- later, degraded view of the order (after expiry, after revocation) must never
-- be able to replace the record of what was actually sold.
--
-- Deliberately NOT deleted when a verification expires or is revoked. The
-- requirement to "preserve historical records" and "not delete financial/audit
-- history" is enforced here by there being no delete path at all.
CREATE TABLE IF NOT EXISTS verification_receipts (
  order_id              TEXT PRIMARY KEY,
  receipt_number        TEXT NOT NULL,
  chain                 TEXT NOT NULL,
  contract              TEXT NOT NULL,
  tier                  TEXT NOT NULL,
  amount_usd            NUMERIC(10,2) NOT NULL CHECK (amount_usd > 0),
  amount_paid           NUMERIC(30,10),
  payment_currency      TEXT,
  transaction_signature TEXT,
  payer_wallet          TEXT,
  paid_at               TIMESTAMPTZ,
  activated_at          TIMESTAMPTZ,
  expires_at            TIMESTAMPTZ,
  status_at_issue       TEXT NOT NULL,
  issued_at             TIMESTAMPTZ NOT NULL
);
-- The customer-facing reference. Derived deterministically from the order id
-- (an HMAC — see _verificationReceipts.mjs on why not a counter and why not
-- random), so this constraint should never fire; it is here to make sure a
-- collision would be a loud error rather than two customers quoting one number.
CREATE UNIQUE INDEX IF NOT EXISTS uq_verification_receipts_number
  ON verification_receipts (receipt_number);
CREATE UNIQUE INDEX IF NOT EXISTS uq_verification_receipts_signature
  ON verification_receipts (transaction_signature)
  WHERE transaction_signature IS NOT NULL;

-- ── Additive columns on the 0002 orders projection ──────────────────────────
--
-- ADD COLUMN IF NOT EXISTS is idempotent and takes no table rewrite on a
-- nullable column with no default, so this is safe to run against a live table.
ALTER TABLE verification_orders ADD COLUMN IF NOT EXISTS badge_token  TEXT;
ALTER TABLE verification_orders ADD COLUMN IF NOT EXISTS refunded_at  TIMESTAMPTZ;

-- A badge token pins a badge to the exact verification that produced it, so two
-- verifications sharing one would defeat the entire point of having it. Partial,
-- because every order that has not been activated legitimately has NULL.
CREATE UNIQUE INDEX IF NOT EXISTS uq_verification_orders_badge_token
  ON verification_orders (badge_token)
  WHERE badge_token IS NOT NULL;
