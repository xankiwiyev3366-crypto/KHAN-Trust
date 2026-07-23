// One-time backfill of existing Netlify Blob data into PostgreSQL, reusing the
// SAME mirror statements the live dual-write uses (so backfilled rows are
// byte-identical to freshly-mirrored ones).
//
// SAFETY: DRY-RUN BY DEFAULT. It reads Blobs and reports counts but writes
// nothing unless you pass --commit. It is MANUAL ONLY and is never run by the
// build or any schedule. Run migrations first (scripts/db-migrate.mjs).
//
//   node scripts/db-backfill.mjs           # dry run: counts only, no writes
//   node scripts/db-backfill.mjs --commit  # actually write to Postgres
//
// Requires DATABASE_URL plus the Blobs env (SITE_ID + NETLIFY_BLOBS_TOKEN), the
// same variables the functions use. Idempotent: every write is an upsert, so
// re-running never duplicates.
import { dbConfigured, closePool } from '../netlify/functions/_db.mjs';
import {
  buildCorpusStatement, buildScoreHistoryStatement, buildWatchStatement,
} from '../netlify/functions/_pgMirror.mjs';
import { query } from '../netlify/functions/_db.mjs';
import { readAllHistory } from '../netlify/functions/_scoreHistoryStore.mjs';
import { readIndex, getCorpusToken } from '../netlify/functions/_tokenCorpusStore.mjs';
import { getNamedStore } from '../netlify/functions/_blobsClient.mjs';

const COMMIT = process.argv.includes('--commit');

// Execute a built statement directly (surfacing errors), bypassing the
// best-effort request-path mirror() so a backfill failure is loud.
async function write({ text, values }) {
  if (!COMMIT) return;
  await query(text, values);
}

async function backfillCorpus() {
  // The corpus index lists every known identity; the authoritative record is
  // the per-token blob, so read each one for the full record.
  const index = await readIndex();
  const identities = Object.keys(index);
  let done = 0;
  for (const identity of identities) {
    const record = await getCorpusToken(identity).catch(() => null);
    if (!record) continue;
    await write(buildCorpusStatement(identity, record));
    done += 1;
  }
  return { seen: identities.length, written: done };
}

async function backfillScoreHistory() {
  const all = await readAllHistory();
  let rows = 0;
  const keys = Object.keys(all);
  for (const key of keys) {
    for (const snapshot of all[key] || []) {
      await write(buildScoreHistoryStatement(key, snapshot));
      rows += 1;
    }
  }
  return { keys: keys.length, written: rows };
}

async function backfillWatchSnapshots() {
  // The watch store has no index (it is read by identity only), so enumerate
  // its blobs via the store's list(). Each blob is the LATEST observation; the
  // full history begins accumulating from live dual-write going forward.
  const store = getNamedStore('khan-trust-watch-snapshots');
  const { blobs } = await store.list();
  let done = 0;
  for (const { key } of blobs) {
    const snapshot = await store.get(key, { type: 'json' }).catch(() => null);
    if (!snapshot || !snapshot.identity) continue;
    await write(buildWatchStatement(snapshot.identity, snapshot));
    done += 1;
  }
  return { seen: blobs.length, written: done };
}

async function main() {
  if (!dbConfigured()) {
    console.error('DATABASE_URL is not set. Aborting.');
    process.exit(1);
  }
  console.log(COMMIT ? '=== BACKFILL (COMMIT) ===' : '=== BACKFILL (dry run — no writes) ===');

  const corpus = await backfillCorpus();
  console.log(`corpus_tokens : ${corpus.seen} in index, ${COMMIT ? corpus.written + ' written' : corpus.written + ' would write'}`);

  const history = await backfillScoreHistory();
  console.log(`score_history : ${history.keys} keys, ${COMMIT ? history.written + ' rows written' : history.written + ' rows would write'}`);

  const watch = await backfillWatchSnapshots();
  console.log(`watch_snapshots: ${watch.seen} blobs, ${COMMIT ? watch.written + ' written' : watch.written + ' would write'}`);

  if (!COMMIT) console.log('\nDry run complete. Re-run with --commit to write to Postgres.');
  await closePool();
}

main().catch(async (error) => {
  console.error(`Backfill failed: ${error.message}`);
  await closePool();
  process.exit(1);
});
