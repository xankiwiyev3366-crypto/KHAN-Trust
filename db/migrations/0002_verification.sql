-- Phase 2 — paid verification.
--
-- THIS FILE IS THE ONE PLACE POSTGRES IS MORE THAN A MIRROR.
--
-- 0001 established the rule: Blobs is the source of truth, Postgres is a
-- best-effort mirror, and a missing DATABASE_URL costs nothing. That still
-- holds for verification_orders below — it is a reporting projection.
--
-- verification_active_contracts is different. It exists for exactly one
-- property that a key/value store cannot provide at any price: a UNIQUE
-- constraint. At most one active verification may exist per (chain, contract),
-- because selling two teams a verified badge for the same token means at least
-- one of them is not the owner, and the badge is then worth nothing to anyone.
--
-- The application still runs correctly without this table (see the header of
-- netlify/functions/_verificationOrders.mjs, which documents the degraded
-- Blobs-only check and the race it leaves open). Applying this migration and
-- setting DATABASE_URL closes that window completely.
--
-- Idempotent: safe to run repeatedly. Applied by `node scripts/db-migrate.mjs`,
-- which is MANUAL and deliberately not wired into the build.

-- One row per verification order. Reporting/reconciliation projection of the
-- Blob record; the Blob is authoritative for content.
CREATE TABLE IF NOT EXISTS verification_orders (
  id                TEXT PRIMARY KEY,
  contract_key      TEXT NOT NULL,             -- "<chain>:<contract>", normalised by contractKey()
  chain             TEXT NOT NULL,
  contract          TEXT NOT NULL,
  tier              TEXT NOT NULL,
  usd_amount        NUMERIC(10,2) NOT NULL CHECK (usd_amount > 0),
  status            TEXT NOT NULL,
  buyer_subject     TEXT,                      -- "u:<userId>" or a base58 wallet
  owner_wallet      TEXT,                      -- the wallet that proved ownership
  payment_signature TEXT,                      -- kept on duplicates too, so a refund is traceable
  quote_score       SMALLINT CHECK (quote_score BETWEEN 0 AND 100),
  created_at        TIMESTAMPTZ NOT NULL,
  activated_at      TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_verification_orders_contract ON verification_orders (contract_key);
CREATE INDEX IF NOT EXISTS idx_verification_orders_status   ON verification_orders (status);
CREATE INDEX IF NOT EXISTS idx_verification_orders_expiry   ON verification_orders (expires_at)
  WHERE expires_at IS NOT NULL;

-- A payment signature may fund at most one order. The same guarantee
-- _entitlementsStore.mjs provides for Premium through its used-signatures
-- ledger, expressed here as a constraint the database enforces rather than
-- application code the next contributor might route around.
--
-- Partial, because unpaid orders legitimately share the NULL signature.
CREATE UNIQUE INDEX IF NOT EXISTS uq_verification_orders_signature
  ON verification_orders (payment_signature)
  WHERE payment_signature IS NOT NULL;

-- THE EXCLUSIVITY LOCK. The whole reason this migration exists.
--
-- contract_key is the PRIMARY KEY rather than a partial unique index on
-- verification_orders(status): a row exists here only while a verification is
-- live, so "is this contract taken?" is a primary-key lookup, and the claim is
-- an INSERT ... ON CONFLICT DO NOTHING that two concurrent activations cannot
-- both win. Releasing (revocation, expiry) DELETEs the row.
--
-- Modelling it as a separate table instead of a partial index on the orders
-- table is deliberate: a partial unique index over a mutable `status` column
-- would have to be maintained by every status transition, and the one that
-- forgot would silently unlock the contract.
--
-- NO FOREIGN KEY to verification_orders, on purpose. That table is populated by
-- the best-effort mirror in putOrder(), which by contract (_db.mjs) may silently
-- no-op on a timeout without failing the request. An FK would make this lock
-- inherit that unreliability precisely backwards: the customer's order would be
-- safely in Blobs, the mirror row would be missing, and the INSERT below would
-- fail with a constraint violation — refusing to activate a paid order because
-- a REPORTING write was slow. order_id is therefore a plain reference.
CREATE TABLE IF NOT EXISTS verification_active_contracts (
  contract_key TEXT PRIMARY KEY,
  order_id     TEXT NOT NULL,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_verification_active_expiry ON verification_active_contracts (expires_at)
  WHERE expires_at IS NOT NULL;
