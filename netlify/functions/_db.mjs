// Shared PostgreSQL client for the Phase 1 dual-write mirror.
//
// CONTRACT WITH THE REST OF THE PLATFORM: this module must never break a
// request. Netlify Blobs remains the source of truth. Postgres is a best-effort
// mirror, so:
//   - If DATABASE_URL is unset, every mirror is a silent no-op (local dev, and
//     any environment where the DB is not wired, behave exactly as before).
//   - If the DB is slow or down, mirror() resolves to { ok:false } within a
//     hard timeout instead of throwing or hanging the caller.
//   - The pool is created lazily and reused across warm invocations; a failed
//     init disables the mirror for the rest of the process rather than retrying
//     on every write.
//
// query() (used by the migration/backfill SCRIPTS, not the request path) DOES
// surface errors, because those are interactive tools where a failure must be
// seen, not swallowed.
import pg from 'pg';

const { Pool } = pg;

// Connect fast or give up — a request must not wait on a wedged connection.
const CONNECT_TIMEOUT_MS = 3000;
// Server-side cap on any single statement.
const STATEMENT_TIMEOUT_MS = 4000;
// Overall cap on a mirror write from the request path (belt-and-suspenders on
// top of the pg timeouts): a healthy DB answers in tens of ms; a sick one can
// never cost the user more than this.
const MIRROR_RACE_MS = 1500;

let pool = null;
let poolBroken = false;

export function dbConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

function getPool() {
  if (pool || poolBroken) return pool;
  if (!dbConfigured()) return null;
  try {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
      statement_timeout: STATEMENT_TIMEOUT_MS,
      query_timeout: STATEMENT_TIMEOUT_MS,
      // Don't keep the Lambda/event loop alive on an idle pooled connection.
      allowExitOnIdle: true,
    });
    // An error on an idle client (e.g. the DB dropped the connection) must not
    // crash the process — log and let the next query re-acquire.
    pool.on('error', (error) => {
      console.warn(`[db] idle client error (non-fatal): ${error.message}`);
    });
  } catch (error) {
    poolBroken = true;
    console.warn(`[db] pool init failed (mirror disabled): ${error.message}`);
    pool = null;
  }
  return pool;
}

function raceTimeout(ms) {
  return new Promise((_, reject) => {
    const id = setTimeout(() => reject(new Error('mirror_timeout')), ms);
    if (id && typeof id.unref === 'function') id.unref();
  });
}

// Best-effort single-statement mirror write. NEVER throws and NEVER hangs the
// caller. Returns a small status object for logging/tests.
export async function mirror(text, values) {
  if (!dbConfigured()) return { ok: false, skipped: true, reason: 'no_database_url' };
  const p = getPool();
  if (!p) return { ok: false, skipped: true, reason: 'no_pool' };
  try {
    await Promise.race([p.query(text, values), raceTimeout(MIRROR_RACE_MS)]);
    return { ok: true };
  } catch (error) {
    console.warn(`[db] mirror write failed (non-fatal): ${error.message}`);
    return { ok: false, error: error.message };
  }
}

// Script-only query helper: surfaces errors on purpose (migrate/backfill).
export async function query(text, values) {
  if (!dbConfigured()) throw new Error('DATABASE_URL is not set');
  const p = getPool();
  if (!p) throw new Error('database pool unavailable');
  return p.query(text, values);
}

// Grab a dedicated client for multi-statement transactions (scripts only).
export async function withClient(fn) {
  const p = getPool();
  if (!p) throw new Error('database pool unavailable');
  const client = await p.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

// For scripts and tests to shut the pool cleanly so the process can exit.
export async function closePool() {
  const p = pool;
  pool = null;
  poolBroken = false;
  if (p) {
    try { await p.end(); } catch { /* already closed */ }
  }
}
