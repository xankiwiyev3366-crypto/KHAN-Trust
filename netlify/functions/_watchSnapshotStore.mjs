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

const STORE_NAME = 'khan-trust-watch-snapshots';

function store() {
  return getNamedStore(STORE_NAME);
}

function snapshotKey(identity) {
  return `watch/${identity}`;
}

export async function getWatchSnapshot(identity) {
  const data = await store().get(snapshotKey(identity), { type: 'json' });
  return data && typeof data === 'object' ? data : null;
}

export async function putWatchSnapshot(identity, snapshot) {
  await store().setJSON(snapshotKey(identity), snapshot);
  return snapshot;
}

// Reads many snapshots at once. Individual misses resolve to null rather than
// rejecting: a token with no snapshot yet is the normal first-run state, not an
// error, and one unreadable blob must not abort the whole alert run.
export async function getWatchSnapshots(identities) {
  const entries = await Promise.all(
    identities.map(async (identity) => [identity, await getWatchSnapshot(identity).catch(() => null)])
  );
  return Object.fromEntries(entries);
}
