// POST /.netlify/functions/db-admin
//
// Admin-gated Phase 1 database ops, run INSIDE the Netlify runtime where
// DATABASE_URL and the Blobs env already exist (so no production secret ever
// leaves Netlify). Fast, synchronous actions only:
//   { action: 'status' | 'verify' } -> migrations applied, Postgres row counts,
//        Blob expected counts, a blob-vs-postgres reconciliation, and the last
//        backfill summaries. Read-only.
//   { action: 'migrate' } -> applies pending migrations (idempotent DDL).
//
// The heavy data backfill is a SEPARATE background function
// (db-admin-backfill-background) because it can exceed the ~10s sync cap.
//
// Auth: an admin Bearer token (from verification-admin-auth) OR the raw
// passcode in the body. Fails closed if KHAN_ADMIN_PASSCODE is unset in prod.
import { checkPasscode, verifyToken, bearerToken } from './_adminAuth.mjs';
import { query, dbConfigured } from './_db.mjs';
import { MIGRATIONS } from './_migrations.mjs';
import { readAllHistory } from './_scoreHistoryStore.mjs';
import { getNamedStore } from './_blobsClient.mjs';

const OPS_STORE = 'khan-trust-db-ops';
const PG_TABLES = ['tokens', 'corpus_tokens', 'score_history', 'watch_snapshots'];

function json(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function authorized(event, payload) {
  const token = bearerToken(event);
  if (token && verifyToken(token)) return true;
  if (payload && checkPasscode(payload.passcode)) return true;
  return false;
}

async function countBlobs(storeName, prefix) {
  const store = getNamedStore(storeName);
  let count = 0;
  for await (const page of store.list({ prefix, paginate: true })) {
    count += page.blobs.length;
  }
  return count;
}

async function pgTableCounts() {
  const out = {};
  for (const name of PG_TABLES) {
    try {
      const r = await query(`SELECT count(*)::int AS c FROM ${name}`); // names are a fixed allowlist
      out[name] = r.rows[0].c;
    } catch (error) {
      out[name] = `error: ${error.message}`;
    }
  }
  return out;
}

async function migrationsApplied() {
  try {
    const r = await query('SELECT version FROM schema_migrations ORDER BY version');
    return r.rows.map((x) => x.version);
  } catch {
    return [];
  }
}

// Cheap "expected rows" from Blobs — listings + one JSON read, no per-token GET,
// so this stays inside the sync budget. These are what the backfill should
// produce, and what Postgres counts are reconciled against.
async function blobExpectedCounts() {
  const all = await readAllHistory().catch(() => ({}));
  const scoreHistoryEntries = Object.values(all)
    .reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0);
  const [corpusTokens, watchSnapshots] = await Promise.all([
    countBlobs('khan-trust-corpus', 'token/').catch(() => null),
    countBlobs('khan-trust-watch-snapshots', 'watch/').catch(() => null),
  ]);
  return { corpusTokens, scoreHistoryKeys: Object.keys(all).length, scoreHistoryEntries, watchSnapshots };
}

async function backfillSummaries() {
  const store = getNamedStore(OPS_STORE);
  const [dry, commit] = await Promise.all([
    store.get('backfill-dry.json', { type: 'json' }).catch(() => null),
    store.get('backfill-commit.json', { type: 'json' }).catch(() => null),
  ]);
  return { dry, commit };
}

async function runMigrations() {
  const applied = new Set(await migrationsApplied());
  const appliedNow = [];
  const already = [];
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) { already.push(migration.version); continue; }
    await query(migration.sql);
    await query('INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING', [migration.version]);
    appliedNow.push(migration.version);
  }
  return { applied: appliedNow, alreadyApplied: already };
}

export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return json(405, { message: 'Method not allowed' });

    let payload;
    try { payload = JSON.parse(event.body || '{}'); } catch { return json(400, { message: 'Invalid request body' }); }
    if (!authorized(event, payload)) return json(401, { message: 'Unauthorized' });
    if (!dbConfigured()) return json(503, { ok: false, message: 'DATABASE_URL is not set in this environment' });

    const action = String(payload.action || 'status');

    if (action === 'status' || action === 'verify') {
      const [migrations, postgres, blobs, backfill] = await Promise.all([
        migrationsApplied(), pgTableCounts(), blobExpectedCounts(), backfillSummaries(),
      ]);
      const comparison = {
        corpus: { blob: blobs.corpusTokens, postgres: postgres.corpus_tokens },
        scoreHistory: { blob: blobs.scoreHistoryEntries, postgres: postgres.score_history },
        watch: { blob: blobs.watchSnapshots, postgres: postgres.watch_snapshots },
      };
      return json(200, { ok: true, action, migrationsApplied: migrations, postgres, blobs, comparison, backfill });
    }

    if (action === 'migrate') {
      const result = await runMigrations();
      const postgres = await pgTableCounts();
      return json(200, { ok: true, action, ...result, postgres });
    }

    return json(400, { message: `Unknown action "${action}". Use "status" or "migrate"; backfill runs via db-admin-backfill-background.` });
  } catch (error) {
    return json(500, { message: `db-admin crashed: ${error.message}` });
  }
}
