// The authoritative watch lane — server-observed snapshots of watched tokens.
//
// Deliberately NOT the token corpus. The corpus is the client's lane: what
// users have scanned, scored from all 18 providers, powering discovery, SEO
// token pages and leaderboards. This store is the server's lane: what the
// re-scan worker observed on a schedule, scored from the volatile subset.
//
// They are different numbers for the same token — BONK measures 35 (High) in
// the client's lane and 76 (Medium) in this one at the same instant, because
// the input sets differ. Keeping them in one record would mean either the
// worker overwrites the score users see (so discovery contradicts the scanner)
// or alerts compare across methodologies (so every watcher gets a false rug
// alert on the first tick). Two lanes, never mixed, is the only version of this
// that is both honest and safe.
//
// Layout mirrors _tokenCorpusStore.mjs: one blob per token, so concurrent
// writes to different tokens cannot collide. There is no index — this store is
// only ever read by identity, by the alert worker.
import { getNamedStore } from './_blobsClient.mjs';
import { mirrorWatchSnapshot } from './_pgMirror.mjs';
import { readWatchLatest, readWatchLatestBatch, readWatchHistory } from './_pgReads.mjs';

const STORE_NAME = 'khan-trust-watch-snapshots';

function store() {
  return getNamedStore(STORE_NAME);
}

function snapshotKey(identity) {
  return `watch/${identity}`;
}

// Blob-only latest read, kept as the fallback and reused by getWatchSnapshots.
async function getWatchSnapshotFromBlob(identity) {
  const data = await store().get(snapshotKey(identity), { type: 'json' });
  return data && typeof data === 'object' ? data : null;
}

// Postgres-FIRST latest observation (Phase 2). Postgres keeps the full series,
// so "latest" is `ORDER BY observed_at DESC LIMIT 1` — never a single stale Blob
// masquerading as current. Falls back to the Blob (which holds exactly this
// latest value) only when Postgres cannot serve the read. An empty Postgres
// result (no observation yet) is a valid null answer, matching the Blob's own
// first-run behaviour.
export async function getWatchSnapshot(identity) {
  const pg = await readWatchLatest(identity);
  if (pg.ok) return pg.value;
  return getWatchSnapshotFromBlob(identity);
}

// Postgres-FIRST full append-only history for one token, oldest→newest. This
// series exists ONLY in Postgres — the Blob keeps a single latest record — so the
// Blob fallback here is explicitly degraded: it can return at most a one-element
// array ([latest]) and never a real history. It is used solely when Postgres
// cannot serve the request, so a complete DB history is never replaced by the
// single latest Blob when the DB is healthy.
export async function getWatchSnapshotHistory(identity) {
  const pg = await readWatchHistory(identity);
  if (pg.ok) return pg.value;
  const latest = await getWatchSnapshotFromBlob(identity);
  return latest ? [latest] : [];
}

export async function putWatchSnapshot(identity, snapshot) {
  await store().setJSON(snapshotKey(identity), snapshot);
  // Phase 1 dual-write: append this observation to Postgres, best-effort. The
  // Blob keeps only the latest; Postgres keeps the full series. Never fatal.
  try { await mirrorWatchSnapshot(identity, snapshot); } catch { /* non-fatal */ }
  return snapshot;
}

// Reads many snapshots' LATEST observation at once. Postgres-FIRST: one batched
// query returns the newest row per identity (see readWatchLatestBatch), with
// every requested identity present (null when unobserved). Falls back to the
// per-Blob reads only when Postgres cannot serve the batch. Individual Blob
// misses resolve to null rather than rejecting: a token with no snapshot yet is
// the normal first-run state, not an error, and one unreadable blob must not
// abort the whole alert run.
export async function getWatchSnapshots(identities) {
  const pg = await readWatchLatestBatch(identities);
  if (pg.ok) return pg.value;
  const entries = await Promise.all(
    identities.map(async (identity) => [identity, await getWatchSnapshotFromBlob(identity).catch(() => null)])
  );
  return Object.fromEntries(entries);
}
