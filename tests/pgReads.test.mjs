// Phase 2 Postgres-first reads — the pure row-mappers and the reader wrappers.
//
// _db.mjs is mocked so we control exactly what readRows() returns (a row set, or
// a not-ok failure) without a live database, mirroring tests/pgMirror.test.mjs.
// The mappers are asserted directly (they are pure), and the readers are checked
// for the two things that matter: they MAP on success and they SIGNAL fallback
// (ok:false) on failure — never throwing.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

let nextRead = { ok: true, rows: [] };
const readCalls = [];
mock.module('../netlify/functions/_db.mjs', {
  namedExports: {
    readRows: async (text, values, opts) => {
      readCalls.push({ text, values, opts });
      return nextRead;
    },
    // Unused by _pgReads but present so the module's import surface is complete.
    mirror: async () => ({ ok: true }),
    dbConfigured: () => true,
    query: async () => ({ rows: [] }),
  },
});

const {
  mapScoreHistoryRow, mapWatchRow, mapCorpusIndexRow,
  readScoreHistory, readWatchLatest, readWatchLatestBatch, readWatchHistory, readCorpusListing,
  SCORE_HISTORY_SQL, WATCH_LATEST_SQL, WATCH_HISTORY_SQL, WATCH_LATEST_BATCH_SQL,
} = await import('../netlify/functions/_pgReads.mjs');

// ── Pure mappers ─────────────────────────────────────────────────────────────
test('mapScoreHistoryRow: rebuilds the Blob snapshot shape; NUMERIC strings → numbers; complete:true', () => {
  const snap = mapScoreHistoryRow({
    date: '2026-07-23',
    score: 77,
    risk_level: 'Medium',
    confidence: 90,
    top_holder_percent: '12.500',   // NUMERIC comes back as a string
    liquidity_usd: '1000.50',
    social_score: 60,
    asset_category: 'Meme',
    categories: { liquidity: 80, holders: 55 }, // JSONB → object
  });
  assert.deepEqual(snap, {
    date: '2026-07-23',
    score: 77,
    riskLevel: 'Medium',
    confidence: 90,
    complete: true,
    topHolderPercent: 12.5,
    liquidityUsd: 1000.5,
    categories: { liquidity: 80, holders: 55 },
    socialScore: 60,
    assetCategory: 'Meme',
  });
});

test('mapScoreHistoryRow: null risk/categories preserved as null, never fabricated', () => {
  const snap = mapScoreHistoryRow({ date: '2026-07-23', score: 40, risk_level: null, categories: null });
  assert.equal(snap.riskLevel, null);
  assert.equal(snap.categories, null);
  assert.equal(snap.complete, true);
});

test('mapWatchRow: joins descriptive columns, ISO-normalises observed_at, passes signals through', () => {
  const signals = { totalLiquidityUsd: 1000, devWallet: { address: '0xd' } };
  const snap = mapWatchRow({
    identity: 'c:0xa',
    contract: '0xA', chain: 'ethereum', name: 'X', ticker: 'X',
    trust_score: 40, risk_level: 'High', engine_version: 'v3', source: 'server_rescan',
    observed_at: new Date('2026-07-23T01:00:00.000Z'),
    signals,
  });
  assert.deepEqual(snap, {
    identity: 'c:0xa',
    contract: '0xA', chain: 'ethereum', name: 'X', ticker: 'X',
    trustScore: 40, riskLevel: 'High', signals,
    source: 'server_rescan', engineVersion: 'v3',
    observedAt: '2026-07-23T01:00:00.000Z',
  });
});

test('mapWatchRow: absent join columns become empty strings (Blob-shape parity)', () => {
  const snap = mapWatchRow({ identity: 'c:x', trust_score: 50, observed_at: null, signals: null });
  assert.equal(snap.contract, '');
  assert.equal(snap.ticker, '');
  assert.equal(snap.observedAt, null);
  assert.equal(snap.signals, null);
});

test('mapCorpusIndexRow: produces the compact index-entry shape', () => {
  const entry = mapCorpusIndexRow({
    identity: 'c:0xa', contract: '0xA', chain: 'base', name: 'Foo', ticker: 'FOO',
    category: 'DeFi', trust_score: 82, risk_level: 'Low',
    updated_at: new Date('2026-07-23T00:00:00.000Z'),
  });
  assert.deepEqual(entry, {
    identity: 'c:0xa', contract: '0xA', chain: 'base', name: 'Foo', ticker: 'FOO',
    trustScore: 82, riskLevel: 'Low', category: 'DeFi',
    updatedAt: '2026-07-23T00:00:00.000Z',
  });
});

// ── Ordering is DB-authoritative (asserted on the SQL, not re-sorted in JS) ────
test('SQL enforces the correct ordering per lane', () => {
  assert.match(SCORE_HISTORY_SQL, /ORDER BY observed_date ASC/);
  assert.match(WATCH_HISTORY_SQL, /ORDER BY w\.observed_at ASC/);
  assert.match(WATCH_LATEST_SQL, /ORDER BY w\.observed_at DESC\s+LIMIT 1/);
  assert.match(WATCH_LATEST_BATCH_SQL, /DISTINCT ON \(w\.identity\)/);
});

// ── Readers: map on success, signal fallback on failure ──────────────────────
test('readScoreHistory: maps rows on success', async () => {
  nextRead = { ok: true, rows: [{ date: '2026-07-01', score: 70 }, { date: '2026-07-02', score: 72 }] };
  const res = await readScoreHistory('c:x');
  assert.equal(res.ok, true);
  assert.equal(res.value.length, 2);
  assert.equal(res.value[0].score, 70);
  assert.equal(res.value[1].date, '2026-07-02');
});

test('readScoreHistory: empty result is a valid ok answer (not a fallback)', async () => {
  nextRead = { ok: true, rows: [] };
  const res = await readScoreHistory('c:none');
  assert.deepEqual(res, { ok: true, value: [] });
});

test('readScoreHistory: db failure surfaces ok:false so the store falls back', async () => {
  nextRead = { ok: false, reason: 'error' };
  const res = await readScoreHistory('c:x');
  assert.deepEqual(res, { ok: false });
});

test('readWatchLatest: single mapped snapshot, or null when unobserved', async () => {
  nextRead = { ok: true, rows: [{ identity: 'c:x', trust_score: 33, observed_at: new Date('2026-07-23T00:00:00Z'), signals: {} }] };
  assert.equal((await readWatchLatest('c:x')).value.trustScore, 33);
  nextRead = { ok: true, rows: [] };
  assert.deepEqual(await readWatchLatest('c:x'), { ok: true, value: null });
  nextRead = { ok: false };
  assert.deepEqual(await readWatchLatest('c:x'), { ok: false });
});

test('readWatchLatestBatch: seeds every requested identity, null for the unobserved', async () => {
  nextRead = { ok: true, rows: [{ identity: 'c:a', trust_score: 10, observed_at: new Date(), signals: {} }] };
  const res = await readWatchLatestBatch(['c:a', 'c:b']);
  assert.equal(res.ok, true);
  assert.equal(res.value['c:a'].trustScore, 10);
  assert.equal(res.value['c:b'], null);           // requested but unobserved
  assert.deepEqual(Object.keys(res.value).sort(), ['c:a', 'c:b']);
});

test('readWatchHistory: maps the full ordered series; failure signals fallback', async () => {
  nextRead = {
    ok: true,
    rows: [
      { identity: 'c:x', trust_score: 80, observed_at: new Date('2026-07-01T00:00:00Z'), signals: {} },
      { identity: 'c:x', trust_score: 40, observed_at: new Date('2026-07-02T00:00:00Z'), signals: {} },
    ],
  };
  const res = await readWatchHistory('c:x');
  assert.equal(res.value.length, 2);
  assert.equal(res.value[0].observedAt, '2026-07-01T00:00:00.000Z');
  nextRead = { ok: false };
  assert.deepEqual(await readWatchHistory('c:x'), { ok: false });
});

test('readCorpusListing: builds an identity→entry map, passes limit as a bound param', async () => {
  readCalls.length = 0;
  nextRead = {
    ok: true,
    rows: [
      { identity: 'c:a', contract: '0xA', trust_score: 90, updated_at: new Date('2026-07-02T00:00:00Z') },
      { identity: 'c:b', contract: '0xB', trust_score: 50, updated_at: new Date('2026-07-01T00:00:00Z') },
    ],
  };
  const res = await readCorpusListing(5000);
  assert.equal(res.ok, true);
  assert.equal(res.value['c:a'].trustScore, 90);
  assert.equal(res.value['c:b'].contract, '0xB');
  assert.deepEqual(readCalls[0].values, [5000]);   // limit is a parameter, not interpolated
});
