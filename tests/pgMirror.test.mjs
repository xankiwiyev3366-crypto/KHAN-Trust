// Phase 1 dual-write — statement builders, wrapper delegation, and schema.
//
// _db.mjs is mocked here so we can assert exactly what SQL/params the mirror
// layer produces and that the wrappers delegate to mirror() — without a live
// database. The real client's runtime fallback behaviour (missing URL, failure)
// is covered separately in tests/pgClient.test.mjs, which does NOT mock _db.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const calls = [];
mock.module('../netlify/functions/_db.mjs', {
  exports: {
    mirror: async (text, values) => { calls.push({ text, values }); return { ok: true, mocked: true }; },
    dbConfigured: () => true,
    query: async () => ({ rows: [] }),
    withClient: async (fn) => fn({ query: async () => ({ rows: [] }) }),
    closePool: async () => {},
  },
});

const {
  buildCorpusStatement, buildScoreHistoryStatement, buildWatchStatement,
  deployerFromSignals, mirrorCorpusToken, mirrorScoreHistory, mirrorWatchSnapshot,
} = await import('../netlify/functions/_pgMirror.mjs');

// ── Corpus statement ────────────────────────────────────────────────────────
test('buildCorpusStatement: atomic token+corpus upsert, rounded score, 11 params', () => {
  const { text, values } = buildCorpusStatement('c:0xabc', {
    contract: '0xABC', chain: 'ethereum', name: 'Weth', ticker: 'WETH', category: 'DeFi',
    trustScore: 82.4, riskLevel: 'Low', confidenceLabel: 'High', source: 'client_scan',
    updatedAt: '2026-07-23T00:00:00.000Z',
  });
  assert.match(text, /INSERT INTO tokens/);
  assert.match(text, /INSERT INTO corpus_tokens/);
  assert.match(text, /ON CONFLICT \(identity\) DO UPDATE/);
  assert.equal(values.length, 11);
  assert.equal(values[0], 'c:0xabc');
  assert.equal(values[6], 82);                       // trust_score rounded
  assert.equal(values[7], 'Low');
  assert.equal(values[10], '2026-07-23T00:00:00.000Z');
});

test('buildCorpusStatement: empty strings become null (COALESCE-safe)', () => {
  const { values } = buildCorpusStatement('c:x', { contract: '', chain: '', trustScore: 50, updatedAt: 't' });
  assert.equal(values[1], null);
  assert.equal(values[2], null);
});

// ── Score-history statement (duplicate-write / upsert semantics) ─────────────
test('buildScoreHistoryStatement: per-day upsert, JSON categories, 10 params', () => {
  const { text, values } = buildScoreHistoryStatement('c:x', {
    date: '2026-07-23', score: 77, riskLevel: 'Medium', confidence: 90,
    topHolderPercent: 12.5, liquidityUsd: 1000.5, socialScore: 60,
    assetCategory: 'Meme', categories: { liquidity: 80, holders: 55 },
  });
  assert.match(text, /ON CONFLICT \(token_key, observed_date\) DO UPDATE/);
  assert.equal(values.length, 10);
  assert.equal(values[1], '2026-07-23');
  assert.equal(values[2], 77);
  assert.equal(values[5], 12.5);
  assert.equal(values[9], JSON.stringify({ liquidity: 80, holders: 55 }));
});

test('buildScoreHistoryStatement: missing riskLevel stored as null, never fabricated', () => {
  const { values } = buildScoreHistoryStatement('c:x', { date: '2026-07-23', score: 40 });
  assert.equal(values[3], null);
  assert.equal(values[9], null); // no categories
});

// ── Watch statement (append-only, idempotent) ───────────────────────────────
test('buildWatchStatement: append-only insert, deployer extracted, 12 params', () => {
  const signals = { topHolderPercent: 5, devWallet: { address: '0xDeployer' } };
  const { text, values } = buildWatchStatement('c:0xa', {
    contract: '0xA', chain: 'ethereum', name: 'X', ticker: 'X',
    trustScore: 40, riskLevel: 'High', engineVersion: 'v3', source: 'server_rescan',
    observedAt: '2026-07-23T01:00:00.000Z', signals,
  });
  assert.match(text, /INSERT INTO watch_snapshots/);
  assert.match(text, /ON CONFLICT \(identity, observed_at\) DO NOTHING/);
  assert.equal(values.length, 12);
  assert.equal(values[5], '0xDeployer');             // deployer_address ($6)
  assert.equal(values[6], '2026-07-23T01:00:00.000Z'); // observed_at ($7)
  assert.equal(values[7], 40);                       // trust_score ($8)
  assert.equal(values[11], JSON.stringify(signals)); // signals ($12)
});

test('deployerFromSignals: handles string, object, and absent shapes', () => {
  assert.equal(deployerFromSignals({ devWallet: '0xstr' }), '0xstr');
  assert.equal(deployerFromSignals({ devWallet: { address: '0xobj' } }), '0xobj');
  assert.equal(deployerFromSignals({ devWallet: { wallet: '0xw' } }), '0xw');
  assert.equal(deployerFromSignals({ devWallet: null }), null);
  assert.equal(deployerFromSignals({}), null);
  assert.equal(deployerFromSignals(null), null);
});

// ── Wrapper delegation (successful write path) ──────────────────────────────
test('mirror wrappers delegate the built statement to mirror()', async () => {
  calls.length = 0;
  const r1 = await mirrorCorpusToken('c:x', { trustScore: 10, updatedAt: 't' });
  const r2 = await mirrorScoreHistory('c:x', { date: '2026-07-23', score: 20 });
  const r3 = await mirrorWatchSnapshot('c:x', { trustScore: 30, observedAt: 't', signals: {} });
  assert.equal(r1.mocked, true);
  assert.equal(r2.mocked, true);
  assert.equal(r3.mocked, true);
  assert.equal(calls.length, 3);
  assert.match(calls[0].text, /corpus_tokens/);
  assert.match(calls[1].text, /score_history/);
  assert.match(calls[2].text, /watch_snapshots/);
  assert.equal(calls[0].values[0], 'c:x');
});

// ── Schema validation ───────────────────────────────────────────────────────
test('migration 0001 defines every table, key, FK and CHECK the mirror relies on', () => {
  const sqlPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations', '0001_phase1_init.sql');
  const sql = readFileSync(sqlPath, 'utf8');
  for (const tbl of ['schema_migrations', 'tokens', 'corpus_tokens', 'score_history', 'watch_snapshots']) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${tbl}\\b`), `missing table ${tbl}`);
  }
  assert.match(sql, /identity\s+TEXT PRIMARY KEY/);                       // tokens PK
  assert.match(sql, /REFERENCES tokens\(identity\) ON DELETE CASCADE/);   // FK integrity
  assert.match(sql, /PRIMARY KEY \(token_key, observed_date\)/);          // score_history upsert key
  assert.match(sql, /PRIMARY KEY \(identity, observed_at\)/);             // watch idempotency key
  assert.match(sql, /CHECK \(trust_score BETWEEN 0 AND 100\)/);
  assert.match(sql, /CHECK \(score BETWEEN 0 AND 100\)/);
  assert.match(sql, /risk_level\b[^\n]*IN \('Low','Medium','High'\)/);
});
