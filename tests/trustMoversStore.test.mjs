// Trust Movers — data layer + endpoint integration.
//
// _db (Postgres reads), _blobsClient (the TTL cache) and _verificationStore (the
// verified-audience filter) are faked so we can drive the REAL store + handler
// end to end without a live database. Covers: chain-filter parameterisation,
// empty database, DB-unavailable fallback (honest insufficient-data, never
// invented), caching, verified fail-closed filtering, ranking through the real
// pure core, response shape, and endpoint param validation.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// ── Controllable Postgres ────────────────────────────────────────────────────
let nextRead = { ok: true, rows: [] };
const readCalls = [];
mock.module('../netlify/functions/_db.mjs', {
  exports: {
    readRows: async (text, values, opts) => { readCalls.push({ text, values, opts }); return nextRead; },
    mirror: async () => ({ ok: true }),
    dbConfigured: () => true,
    query: async () => ({ rows: [] }),
  },
});

// ── In-memory blob cache ─────────────────────────────────────────────────────
class FakeStore {
  constructor() { this.data = new Map(); }
  async setJSON(key, value) { this.data.set(key, JSON.parse(JSON.stringify(value))); }
  async get(key) { return this.data.has(key) ? JSON.parse(JSON.stringify(this.data.get(key))) : null; }
}
const stores = new Map();
mock.module('../netlify/functions/_blobsClient.mjs', {
  exports: {
    getNamedStore: (name) => {
      if (!stores.has(name)) stores.set(name, new FakeStore());
      return stores.get(name);
    },
    jsonResponse: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
  },
});

// ── Controllable verification store ──────────────────────────────────────────
let statuses = {};
mock.module('../netlify/functions/_verificationStore.mjs', {
  exports: { readStatuses: async () => statuses, jsonResponse: (s, b) => ({ statusCode: s, body: JSON.stringify(b) }) },
});

const { getTrustMovers, chainAliases, TRUST_MOVERS_SQL } = await import('../netlify/functions/_trustMoversStore.mjs');
const { handler } = await import('../netlify/functions/trust-movers.mjs');

// A raw DB row (current + previous columns) as the SQL would return it.
function dbRow(identity, cScore, pScore, extra = {}) {
  return {
    identity, contract: identity, chain: extra.chain || 'ethereum', name: identity, ticker: '',
    c_date: '2026-07-27', c_created: '2026-07-27T00:00:00.000Z',
    c_score: cScore, c_risk_level: extra.cRisk || null, c_confidence: extra.cConf ?? 80,
    c_top_holder_percent: null, c_liquidity_usd: null, c_social_score: null, c_asset_category: '', c_categories: null,
    p_date: pScore === null ? null : '2026-07-20',
    p_score: pScore, p_risk_level: extra.pRisk || null, p_confidence: extra.pConf ?? 80,
    p_top_holder_percent: null, p_liquidity_usd: null, p_social_score: null, p_asset_category: '', p_categories: null,
  };
}

function reset() {
  stores.clear();
  statuses = {};
  readCalls.length = 0;
  nextRead = { ok: true, rows: [] };
}

// ── Chain alias mapping ──────────────────────────────────────────────────────
test('chainAliases: canonical chain → its accepted stored spellings; all → null', () => {
  assert.equal(chainAliases('all'), null);
  assert.deepEqual(chainAliases('bsc'), ['bsc', 'bnb', 'bnb chain', 'binance', 'binance smart chain']);
  assert.deepEqual(chainAliases('solana'), ['solana', 'sol']);
});

test('SQL: bounded DISTINCT ON passes over the PK index, parameterised, LEFT JOINs previous', () => {
  assert.match(TRUST_MOVERS_SQL, /DISTINCT ON \(sh\.token_key\)/);
  assert.match(TRUST_MOVERS_SQL, /observed_date >= CURRENT_DATE - \$1::int/);   // current window bound
  assert.match(TRUST_MOVERS_SQL, /observed_date <= CURRENT_DATE - \$1::int/);   // previous boundary
  assert.match(TRUST_MOVERS_SQL, /LEFT JOIN previous_snap/);
  assert.match(TRUST_MOVERS_SQL, /\$2::text\[\] IS NULL OR lower/);             // chain filter, parameterised
});

// ── Query parameterisation & chain filter ────────────────────────────────────
test('getTrustMovers: passes period-days and chain aliases as bound params', async () => {
  reset();
  nextRead = { ok: true, rows: [] };
  await getTrustMovers({ period: '30D', chain: 'bsc', limit: 20 });
  assert.equal(readCalls[0].values[0], 30);                                     // periodDays(30D)
  assert.deepEqual(readCalls[0].values[1], ['bsc', 'bnb', 'bnb chain', 'binance', 'binance smart chain']);
});

// ── Empty database & DB-unavailable ──────────────────────────────────────────
test('empty database → insufficientData true, all sections empty, cached false', async () => {
  reset();
  nextRead = { ok: true, rows: [] };
  const res = await getTrustMovers({ period: '7D', chain: 'all' });
  assert.equal(res.insufficientData, true);
  assert.deepEqual(res.sections, { rising: [], falling: [], newHighConfidence: [], newlyHighRisk: [] });
});

test('Postgres unavailable → honest insufficient-data (never invented) and NOT cached', async () => {
  reset();
  nextRead = { ok: false, reason: 'error' };
  const res = await getTrustMovers({ period: '7D', chain: 'all' });
  assert.equal(res.insufficientData, true);
  assert.equal(res.reason, 'history_unavailable');
  // A second call must retry the DB, not serve a cached failure.
  nextRead = { ok: true, rows: [dbRow('c:a', 90, 60)] };
  const res2 = await getTrustMovers({ period: '7D', chain: 'all' });
  assert.equal(res2.insufficientData, false);
  assert.equal(res2.sections.rising[0].identity, 'c:a');
});

// ── Ranking through the real pure core ───────────────────────────────────────
test('ranking: biggest movers first; risers and fallers separated; deltas computed', async () => {
  reset();
  nextRead = { ok: true, rows: [
    dbRow('c:small', 63, 60),   // +3
    dbRow('c:big', 92, 60),     // +32
    dbRow('c:drop', 40, 70),    // -30
  ] };
  const res = await getTrustMovers({ period: '7D', chain: 'all' });
  assert.deepEqual(res.sections.rising.map((m) => m.identity), ['c:big', 'c:small']);
  assert.equal(res.sections.rising[0].absoluteChange, 32);
  assert.equal(res.sections.falling[0].identity, 'c:drop');
  assert.equal(res.sections.falling[0].absoluteChange, -30);
});

test('missing history: a token with no previous snapshot is never given a fake delta', async () => {
  reset();
  nextRead = { ok: true, rows: [dbRow('c:new', 88, null, { cRisk: 'Low', cConf: 90 })] };
  const res = await getTrustMovers({ period: '7D', chain: 'all' });
  assert.equal(res.sections.rising.length, 0);          // no delta → not a riser
  assert.equal(res.sections.newHighConfidence[0].identity, 'c:new');
  assert.equal(res.sections.newHighConfidence[0].previousScore, null);
  assert.deepEqual(res.sections.newHighConfidence[0].reasons, []);
});

// ── Caching ──────────────────────────────────────────────────────────────────
test('results are cached: the second identical call is served from cache without a DB read', async () => {
  reset();
  nextRead = { ok: true, rows: [dbRow('c:a', 90, 60)] };
  const first = await getTrustMovers({ period: '7D', chain: 'all' });
  assert.equal(first.cached, false);
  const callsAfterFirst = readCalls.length;
  const second = await getTrustMovers({ period: '7D', chain: 'all' });
  assert.equal(second.cached, true);
  assert.equal(readCalls.length, callsAfterFirst);      // no additional DB read
  assert.equal(second.sections.rising[0].identity, 'c:a');
});

// ── Verified audience (fail-closed) ──────────────────────────────────────────
test('audience=verified: only positively-verified projects survive (fail-closed)', async () => {
  reset();
  nextRead = { ok: true, rows: [dbRow('c:0xverified', 90, 60), dbRow('c:0xunknown', 88, 60)] };
  statuses = { 'c:0xverified': { status: 'verified' }, 'c:0xother': { status: 'pending' } };
  const res = await getTrustMovers({ period: '7D', chain: 'all', audience: 'verified' });
  assert.deepEqual(res.sections.rising.map((m) => m.identity), ['c:0xverified']);
});

test('audience=verified with an empty verification store → empty, not an error', async () => {
  reset();
  nextRead = { ok: true, rows: [dbRow('c:a', 90, 60)] };
  statuses = {};
  const res = await getTrustMovers({ period: '7D', chain: 'all', audience: 'verified' });
  assert.equal(res.insufficientData, true);
  assert.equal(res.sections.rising.length, 0);
});

// ── Endpoint: validation, shape, single-section ──────────────────────────────
test('handler: rejects non-GET', async () => {
  reset();
  const res = await handler({ httpMethod: 'POST', queryStringParameters: {} });
  assert.equal(res.statusCode, 405);
});

test('handler: invalid params fall back to safe defaults (period 7D, chain all)', async () => {
  reset();
  nextRead = { ok: true, rows: [] };
  const res = await handler({ httpMethod: 'GET', queryStringParameters: { period: '1Y', chain: 'dogechain', limit: '999' } });
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(body.period, '7D');
  assert.equal(body.chain, 'all');
  assert.equal(readCalls[0].values[0], 7);
});

test('handler: section param returns just that one section, uniform shape', async () => {
  reset();
  nextRead = { ok: true, rows: [dbRow('c:a', 90, 60), dbRow('c:drop', 40, 70)] };
  const res = await handler({ httpMethod: 'GET', queryStringParameters: { section: 'falling' } });
  const body = JSON.parse(res.body);
  assert.deepEqual(Object.keys(body.sections), ['falling']);
  assert.equal(body.sections.falling[0].identity, 'c:drop');
});

test('handler: full response carries the documented top-level contract', async () => {
  reset();
  nextRead = { ok: true, rows: [dbRow('c:a', 90, 60)] };
  const res = await handler({ httpMethod: 'GET', queryStringParameters: { period: '24H', chain: 'ethereum' } });
  const body = JSON.parse(res.body);
  for (const field of ['period', 'chain', 'audience', 'generatedAt', 'cached', 'insufficientData', 'sections']) {
    assert.ok(Object.prototype.hasOwnProperty.call(body, field), `missing ${field}`);
  }
  const card = body.sections.rising[0];
  for (const field of ['identity', 'name', 'chain', 'currentScore', 'previousScore', 'absoluteChange', 'percentChange', 'trend', 'riskLevel', 'lastUpdated', 'reasons']) {
    assert.ok(Object.prototype.hasOwnProperty.call(card, field), `card missing ${field}`);
  }
});
