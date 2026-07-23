// POST /.netlify/functions/db-admin-backfill-background
//
// Admin-gated Phase 1 backfill of existing Netlify Blob data into Postgres,
// reusing the SAME statement builders the live dual-write uses (so backfilled
// rows are identical to freshly-mirrored ones). Runs as a BACKGROUND function
// (15-min cap) because a full backfill can exceed the ~10s sync cap.
//
// Idempotent: corpus/score upsert, watch inserts with ON CONFLICT DO NOTHING —
// re-running never duplicates. Blobs is untouched and remains the source of
// truth; this only writes into Postgres.
//
// Body: { passcode | (Authorization: Bearer <token>), commit?: boolean }
//   commit !== true  -> DRY RUN: count what WOULD be written, write nothing.
//   commit === true  -> actually write to Postgres.
//
// Background functions can't return a body to the caller, so the result summary
// is persisted to the khan-trust-db-ops blob store, which db-admin's `status`
// action reads back.
import { checkPasscode, verifyToken, bearerToken } from './_adminAuth.mjs';
import { query, dbConfigured } from './_db.mjs';
import {
  buildCorpusStatement, buildScoreHistoryStatement, buildWatchStatement,
} from './_pgMirror.mjs';
import { readAllHistory } from './_scoreHistoryStore.mjs';
import { getNamedStore } from './_blobsClient.mjs';

const OPS_STORE = 'khan-trust-db-ops';

function authorized(event, payload) {
  const token = bearerToken(event);
  if (token && verifyToken(token)) return true;
  if (payload && checkPasscode(payload.passcode)) return true;
  return false;
}

async function backfillCorpus(commit, errors) {
  const store = getNamedStore('khan-trust-corpus');
  let seen = 0;
  let written = 0;
  for await (const page of store.list({ prefix: 'token/', paginate: true })) {
    for (const blob of page.blobs) {
      const record = await store.get(blob.key, { type: 'json' }).catch(() => null);
      if (!record || !record.identity) continue;
      seen += 1;
      if (commit) {
        try {
          const { text, values } = buildCorpusStatement(record.identity, record);
          await query(text, values);
          written += 1;
        } catch (error) { errors.corpus = errors.corpus || error.message; }
      }
    }
  }
  return { seen, written };
}

async function backfillScoreHistory(commit, errors) {
  const all = await readAllHistory().catch(() => ({}));
  let seen = 0;
  let written = 0;
  for (const key of Object.keys(all)) {
    for (const snapshot of all[key] || []) {
      seen += 1;
      if (commit) {
        try {
          const { text, values } = buildScoreHistoryStatement(key, snapshot);
          await query(text, values);
          written += 1;
        } catch (error) { errors.scoreHistory = errors.scoreHistory || error.message; }
      }
    }
  }
  return { seen, written };
}

async function backfillWatch(commit, errors) {
  const store = getNamedStore('khan-trust-watch-snapshots');
  let seen = 0;
  let written = 0;
  for await (const page of store.list({ prefix: 'watch/', paginate: true })) {
    for (const blob of page.blobs) {
      const snapshot = await store.get(blob.key, { type: 'json' }).catch(() => null);
      if (!snapshot || !snapshot.identity) continue;
      seen += 1;
      if (commit) {
        try {
          const { text, values } = buildWatchStatement(snapshot.identity, snapshot);
          await query(text, values);
          written += 1;
        } catch (error) { errors.watch = errors.watch || error.message; }
      }
    }
  }
  return { seen, written };
}

export async function handler(event) {
  const started = new Date().toISOString();
  let payload = {};
  try { payload = JSON.parse(event.body || '{}'); } catch { /* empty body ok */ }

  if (!authorized(event, payload)) return { statusCode: 401, body: 'Unauthorized' };
  if (!dbConfigured()) return { statusCode: 503, body: 'DATABASE_URL is not set' };

  const commit = payload.commit === true;
  const errors = {};
  const summary = { mode: commit ? 'commit' : 'dry', started, ok: true };

  try {
    summary.corpus = await backfillCorpus(commit, errors);
    summary.scoreHistory = await backfillScoreHistory(commit, errors);
    summary.watch = await backfillWatch(commit, errors);
    summary.errors = errors;
  } catch (error) {
    summary.ok = false;
    summary.error = error.message;
  }
  summary.finished = new Date().toISOString();

  // Persist so db-admin `status` can read the outcome (background functions
  // return only 202 to the caller).
  try {
    await getNamedStore(OPS_STORE).setJSON(`backfill-${summary.mode}.json`, summary);
  } catch (error) {
    console.warn(`[db-admin-backfill] could not persist summary: ${error.message}`);
  }

  return { statusCode: 202, body: JSON.stringify({ accepted: true, mode: summary.mode }) };
}
