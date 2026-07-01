// Trust Graph Corpus — the shared, server-side, accumulating index of every
// token KHAN Trust has scored. This is the keystone the platform previously
// lacked: scans used to be computed then discarded to each user's own
// browser localStorage (see readProjectStorage in src/main.jsx), so usage
// never compounded into an asset. This store keeps a durable snapshot of
// every scanned token so the same data can power shared discovery, SEO token
// pages, leaderboards, and retention alerts.
//
// Design: each token is its OWN blob key ("token/<identity>") rather than one
// giant JSON file, so concurrent writes to different tokens never collide
// (avoids the whole-file last-writer-wins pattern the older stores use). A
// single compact "index.json" is maintained alongside purely as a listing
// convenience for discovery/leaderboards — it is NOT authoritative (the
// per-token blob is), so a lost index update self-heals on that token's next
// scan and never corrupts a token's real record.
import { getNamedStore, jsonResponse } from './_blobsClient.mjs';

const STORE_NAME = 'khan-trust-corpus';
const INDEX_KEY = 'index.json';
const MAX_INDEX_ENTRIES = 5000;

function store() {
  return getNamedStore(STORE_NAME);
}

function tokenKey(identity) {
  return `token/${identity}`;
}

export async function getCorpusToken(identity) {
  const data = await store().get(tokenKey(identity), { type: 'json' });
  return data && typeof data === 'object' ? data : null;
}

export async function readIndex() {
  const data = await store().get(INDEX_KEY, { type: 'json' });
  return data && typeof data === 'object' ? data : {};
}

// Trims the discovery index to the most-recently-updated MAX_INDEX_ENTRIES so
// it can't grow unbounded. Only the index is capped; every token's full blob
// is always retained.
function capIndex(index) {
  const entries = Object.values(index);
  if (entries.length <= MAX_INDEX_ENTRIES) return index;
  const kept = entries
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, MAX_INDEX_ENTRIES);
  const next = {};
  for (const entry of kept) next[entry.identity] = entry;
  return next;
}

export async function upsertCorpusToken(identity, record) {
  // Authoritative per-token write first - this must succeed for the record to
  // count as stored.
  await store().setJSON(tokenKey(identity), record);

  // Best-effort discovery index. A failure here is swallowed on purpose: the
  // token's real record is already saved above, and the index self-heals on
  // the next scan of this token, so an index hiccup must never fail the write.
  try {
    const index = await readIndex();
    index[identity] = {
      identity,
      contract: record.contract,
      chain: record.chain,
      name: record.name,
      ticker: record.ticker,
      trustScore: record.trustScore,
      riskLevel: record.riskLevel,
      category: record.category,
      updatedAt: record.updatedAt,
    };
    await store().setJSON(INDEX_KEY, capIndex(index));
  } catch {
    // index is a convenience only; ignore
  }

  return record;
}

export { jsonResponse };
