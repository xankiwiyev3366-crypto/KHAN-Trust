// End-to-end tests for the score-history record endpoint after the Platform
// Memory repair. Drives the REAL handler + store against a faked blob backend
// (same approach as tests/retentionSync.test.mjs). Pins the server-side halves
// of the fix: no fabricated 'Medium', incomplete snapshots refused, quality
// stamps persisted — across several tokens and chains.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

class FakeStore {
  constructor() { this.data = new Map(); }
  async setJSON(key, value) { this.data.set(key, JSON.parse(JSON.stringify(value))); }
  async get(key) { return this.data.has(key) ? JSON.parse(JSON.stringify(this.data.get(key))) : null; }
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

const { handler } = await import('../netlify/functions/score-history-record.mjs');
const { getHistory } = await import('../netlify/functions/_scoreHistoryStore.mjs');

function reset() { stores.clear(); }
const parse = (res) => JSON.parse(res.body);

function record(key, snapshot) {
  return handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ key, snapshot }) });
}

const base = (extra = {}) => ({ date: '2026-07-02', score: 77, riskLevel: 'Low', confidence: 80, complete: true, ...extra });

test('a missing/invalid risk level is stored as null, never a fabricated Medium', async () => {
  reset();
  const res = await record('c:0xethtoken', base({ riskLevel: 'bogus' }));
  assert.equal(res.statusCode, 200);
  const history = await getHistory('c:0xethtoken');
  assert.equal(history[0].riskLevel, null);
});

test('a valid risk level is preserved', async () => {
  reset();
  await record('c:solmint', base({ riskLevel: 'High' }));
  assert.equal((await getHistory('c:solmint'))[0].riskLevel, 'High');
});

test('an incomplete snapshot is refused storage (200 skipped, not stored)', async () => {
  reset();
  const res = await record('c:bsctoken', base({ complete: false }));
  assert.equal(res.statusCode, 200);
  assert.equal(parse(res).skipped, true);
  assert.deepEqual(await getHistory('c:bsctoken'), []);
});

test('a demo-flagged snapshot is refused storage', async () => {
  reset();
  const res = await record('c:demotoken', base({ demo: true }));
  assert.equal(parse(res).skipped, true);
  assert.deepEqual(await getHistory('c:demotoken'), []);
});

test('quality stamps (confidence, complete) are persisted', async () => {
  reset();
  await record('id:native-bitcoin', base({ confidence: 55 }));
  const snap = (await getHistory('id:native-bitcoin'))[0];
  assert.equal(snap.confidence, 55);
  assert.equal(snap.complete, true);
});

test('one entry per key per day — a rescan upserts rather than duplicating', async () => {
  reset();
  await record('c:arbtoken', base({ score: 70 }));
  await record('c:arbtoken', base({ score: 74 })); // same date, later scan
  const history = await getHistory('c:arbtoken');
  assert.equal(history.length, 1);
  assert.equal(history[0].score, 74);
});

test('different tokens/chains are keyed independently', async () => {
  reset();
  await record('c:solmint', base({ score: 60 }));
  await record('c:0xethtoken', base({ score: 90 }));
  assert.equal((await getHistory('c:solmint'))[0].score, 60);
  assert.equal((await getHistory('c:0xethtoken'))[0].score, 90);
});

test('score out of range is rejected (shape validation intact)', async () => {
  reset();
  const res = await record('c:solmint', base({ score: 500 }));
  assert.equal(res.statusCode, 400);
});
