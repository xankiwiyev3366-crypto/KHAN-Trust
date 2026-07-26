// Phase 2 — Postgres-FIRST reads at the STORE level, with the Blob as fallback.
//
// Two backends are faked: _pgReads (the Postgres readers — a controller lets each
// test force a success, an empty result, or a not-ok failure) and _blobsClient
// (an in-memory blob store, same FakeStore approach as the other store tests).
// This pins the exact contract Phase 2 promises:
//   * a healthy Postgres read is authoritative (Blob is NOT consulted),
//   * an empty Postgres result is returned as-is (not masked by a Blob re-read),
//   * a Postgres failure falls back to the Blob safely,
//   * response shapes are unchanged, ordering is preserved,
//   * watch HISTORY is never replaced by the single latest Blob when the DB is up,
//   * and the WRITE path still lands in the Blob (no write regression).
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// ── Controllable Postgres readers ────────────────────────────────────────────
const pg = {
  scoreHistory: { ok: false },
  watchLatest: { ok: false },
  watchLatestBatch: { ok: false },
  watchHistory: { ok: false },
  corpusListing: { ok: false },
};
mock.module('../netlify/functions/_pgReads.mjs', {
  namedExports: {
    readScoreHistory: async () => pg.scoreHistory,
    readWatchLatest: async () => pg.watchLatest,
    readWatchLatestBatch: async () => pg.watchLatestBatch,
    readWatchHistory: async () => pg.watchHistory,
    readCorpusListing: async () => pg.corpusListing,
  },
});

// ── In-memory blob backend ───────────────────────────────────────────────────
class FakeStore {
  constructor() { this.data = new Map(); }
  async setJSON(key, value) { this.data.set(key, JSON.parse(JSON.stringify(value))); }
  async get(key) { return this.data.has(key) ? JSON.parse(JSON.stringify(this.data.get(key))) : null; }
  async list() {
    return { blobs: [...this.data.keys()].map((key) => ({ key })) };
  }
  async delete(key) { this.data.delete(key); }
}
const stores = new Map();
const storeFor = (name) => {
  if (!stores.has(name)) stores.set(name, new FakeStore());
  return stores.get(name);
};
mock.module('../netlify/functions/_blobsClient.mjs', {
  namedExports: {
    getNamedStore: (name) => storeFor(name),
    jsonResponse: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
  },
});

const scoreStore = await import('../netlify/functions/_scoreHistoryStore.mjs');
const watchStore = await import('../netlify/functions/_watchSnapshotStore.mjs');
const corpusStore = await import('../netlify/functions/_tokenCorpusStore.mjs');

function reset() {
  stores.clear();
  pg.scoreHistory = { ok: false };
  pg.watchLatest = { ok: false };
  pg.watchLatestBatch = { ok: false };
  pg.watchHistory = { ok: false };
  pg.corpusListing = { ok: false };
}

// ── Score history ────────────────────────────────────────────────────────────
test('getHistory: successful Postgres read is authoritative (Blob NOT consulted)', async () => {
  reset();
  // Put DIFFERENT data in the Blob to prove Postgres wins when it answers.
  await scoreStore.appendSnapshot('c:x', { date: '2026-07-01', score: 11, complete: true });
  pg.scoreHistory = { ok: true, value: [{ date: '2026-07-02', score: 99, complete: true }] };
  const history = await scoreStore.getHistory('c:x');
  assert.equal(history.length, 1);
  assert.equal(history[0].score, 99);        // from Postgres, not the Blob's 11
});

test('getHistory: empty Postgres result is returned as-is (not masked by the Blob)', async () => {
  reset();
  await scoreStore.appendSnapshot('c:x', { date: '2026-07-01', score: 11, complete: true });
  pg.scoreHistory = { ok: true, value: [] };
  assert.deepEqual(await scoreStore.getHistory('c:x'), []);
});

test('getHistory: Postgres failure falls back to the Blob series', async () => {
  reset();
  await scoreStore.appendSnapshot('c:x', { date: '2026-07-01', score: 70, complete: true });
  await scoreStore.appendSnapshot('c:x', { date: '2026-07-02', score: 72, complete: true });
  pg.scoreHistory = { ok: false };
  const history = await scoreStore.getHistory('c:x');
  assert.equal(history.length, 2);
  assert.equal(history[0].score, 70);
  assert.equal(history[1].score, 72);
});

test('getHistory: ordering (ascending by date) is preserved from Postgres', async () => {
  reset();
  pg.scoreHistory = {
    ok: true,
    value: [
      { date: '2026-07-01', score: 60, complete: true },
      { date: '2026-07-02', score: 61, complete: true },
      { date: '2026-07-03', score: 62, complete: true },
    ],
  };
  const dates = (await scoreStore.getHistory('c:x')).map((s) => s.date);
  assert.deepEqual(dates, ['2026-07-01', '2026-07-02', '2026-07-03']);
});

test('appendSnapshot: write still lands in the Blob (no write regression)', async () => {
  reset();
  const result = await scoreStore.appendSnapshot('c:x', { date: '2026-07-01', score: 55, complete: true });
  assert.equal(result.length, 1);
  // Read it back via the Blob-only path (Postgres forced not-ok) to prove the
  // write reached the authoritative store.
  pg.scoreHistory = { ok: false };
  assert.equal((await scoreStore.getHistory('c:x'))[0].score, 55);
  // A same-day rescan upserts rather than duplicating (unchanged behaviour).
  await scoreStore.appendSnapshot('c:x', { date: '2026-07-01', score: 58, complete: true });
  const after = await scoreStore.getHistory('c:x');
  assert.equal(after.length, 1);
  assert.equal(after[0].score, 58);
});

// ── Watch snapshots ──────────────────────────────────────────────────────────
test('getWatchSnapshot: Postgres latest wins; empty is null; failure falls back to Blob', async () => {
  reset();
  await watchStore.putWatchSnapshot('c:x', { identity: 'c:x', trustScore: 20, observedAt: '2026-07-01T00:00:00.000Z', signals: {} });
  // Postgres answers with a newer latest → authoritative.
  pg.watchLatest = { ok: true, value: { identity: 'c:x', trustScore: 44, observedAt: '2026-07-09T00:00:00.000Z', signals: {} } };
  assert.equal((await watchStore.getWatchSnapshot('c:x')).trustScore, 44);
  // Postgres says no observation → null, even though the Blob has one.
  pg.watchLatest = { ok: true, value: null };
  assert.equal(await watchStore.getWatchSnapshot('c:x'), null);
  // Postgres down → fall back to the Blob's latest.
  pg.watchLatest = { ok: false };
  assert.equal((await watchStore.getWatchSnapshot('c:x')).trustScore, 20);
});

test('getWatchSnapshots: batched Postgres map wins; failure falls back to per-Blob reads', async () => {
  reset();
  await watchStore.putWatchSnapshot('c:a', { identity: 'c:a', trustScore: 10, observedAt: '2026-07-01T00:00:00.000Z', signals: {} });
  pg.watchLatestBatch = { ok: true, value: { 'c:a': { identity: 'c:a', trustScore: 77, signals: {} }, 'c:b': null } };
  const viaPg = await watchStore.getWatchSnapshots(['c:a', 'c:b']);
  assert.equal(viaPg['c:a'].trustScore, 77);
  assert.equal(viaPg['c:b'], null);
  // Fallback: only c:a exists in the Blob; c:b resolves to null, run not aborted.
  pg.watchLatestBatch = { ok: false };
  const viaBlob = await watchStore.getWatchSnapshots(['c:a', 'c:b']);
  assert.equal(viaBlob['c:a'].trustScore, 10);
  assert.equal(viaBlob['c:b'], null);
});

test('getWatchSnapshotHistory: full ordered Postgres history is NEVER replaced by the single latest Blob', async () => {
  reset();
  // The Blob holds only the latest observation.
  await watchStore.putWatchSnapshot('c:x', { identity: 'c:x', trustScore: 40, observedAt: '2026-07-09T00:00:00.000Z', signals: {} });
  // Postgres holds the full append-only series.
  pg.watchHistory = {
    ok: true,
    value: [
      { identity: 'c:x', trustScore: 80, observedAt: '2026-07-01T00:00:00.000Z', signals: {} },
      { identity: 'c:x', trustScore: 60, observedAt: '2026-07-05T00:00:00.000Z', signals: {} },
      { identity: 'c:x', trustScore: 40, observedAt: '2026-07-09T00:00:00.000Z', signals: {} },
    ],
  };
  const history = await watchStore.getWatchSnapshotHistory('c:x');
  assert.equal(history.length, 3);                                   // full series, not 1
  assert.deepEqual(history.map((s) => s.observedAt), [
    '2026-07-01T00:00:00.000Z', '2026-07-05T00:00:00.000Z', '2026-07-09T00:00:00.000Z',
  ]);
});

test('getWatchSnapshotHistory: only when Postgres is down does it degrade to the latest Blob ([latest])', async () => {
  reset();
  pg.watchHistory = { ok: false };
  // No Blob yet → empty, never a throw.
  assert.deepEqual(await watchStore.getWatchSnapshotHistory('c:x'), []);
  // With a Blob latest → a one-element degraded series, clearly not full history.
  await watchStore.putWatchSnapshot('c:x', { identity: 'c:x', trustScore: 40, observedAt: '2026-07-09T00:00:00.000Z', signals: {} });
  const degraded = await watchStore.getWatchSnapshotHistory('c:x');
  assert.equal(degraded.length, 1);
  assert.equal(degraded[0].trustScore, 40);
});

test('putWatchSnapshot: write still lands in the Blob (no write regression)', async () => {
  reset();
  await watchStore.putWatchSnapshot('c:x', { identity: 'c:x', trustScore: 33, observedAt: '2026-07-01T00:00:00.000Z', signals: {} });
  pg.watchLatest = { ok: false };
  assert.equal((await watchStore.getWatchSnapshot('c:x')).trustScore, 33);
});

// ── Corpus discovery listing ─────────────────────────────────────────────────
test('getCorpusListingIndex: Postgres listing wins; failure falls back to the Blob index', async () => {
  reset();
  // Seed the Blob discovery index via a real corpus write.
  await corpusStore.upsertCorpusToken('c:blob', {
    identity: 'c:blob', contract: '0xB', chain: 'base', name: 'Blob', ticker: 'BLB',
    trustScore: 12, riskLevel: 'High', category: 'Meme', updatedAt: '2026-07-01T00:00:00.000Z',
  });
  pg.corpusListing = {
    ok: true,
    value: { 'c:pg': { identity: 'c:pg', contract: '0xP', trustScore: 88, updatedAt: '2026-07-02T00:00:00.000Z' } },
  };
  const viaPg = await corpusStore.getCorpusListingIndex();
  assert.deepEqual(Object.keys(viaPg), ['c:pg']);          // Postgres, not the Blob
  assert.equal(viaPg['c:pg'].trustScore, 88);
  // Fallback to the Blob index.
  pg.corpusListing = { ok: false };
  const viaBlob = await corpusStore.getCorpusListingIndex();
  assert.equal(viaBlob['c:blob'].trustScore, 12);
});

test('getCorpusToken stays Blob-authoritative (full record incl. scoreInputs) — never routed to Postgres', async () => {
  reset();
  await corpusStore.upsertCorpusToken('c:x', {
    identity: 'c:x', contract: '0xX', trustScore: 70, updatedAt: '2026-07-01T00:00:00.000Z',
    scoreInputs: { website: true, marketCapUsd: 1000 },   // lossy field NOT in the PG mirror
  });
  // Even with a Postgres listing available, the single-record read comes from the
  // Blob and retains scoreInputs (which the monitored-score bridge depends on).
  pg.corpusListing = { ok: true, value: { 'c:x': { identity: 'c:x', trustScore: 999 } } };
  const record = await corpusStore.getCorpusToken('c:x');
  assert.equal(record.trustScore, 70);
  assert.deepEqual(record.scoreInputs, { website: true, marketCapUsd: 1000 });
});
