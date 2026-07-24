// The monitored-score bridge: how continuous server monitoring writes a
// full-methodology Trust Score History point without a browser.
//
// The load-bearing property is PARITY. The whole reason this exists (rather than
// writing the cheap volatile score) is that a monitored point must be
// COMPARABLE to the client's own points — otherwise the Trust Graph line jumps
// by data source, not by real change. So the central test proves that, given the
// SAME volatile signals the client saw, the reconstructed score equals the
// client's own calculateLiveScores result exactly. The rest pins the honest
// skips and the gap-fill store semantics.
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

const { calculateLiveScores } = await import('../src/lib/trustScore.js');
const { extractScoreInputs, buildMonitoredHistoryPoint } = await import('../src/lib/monitoredScore.js');
const { appendSnapshotIfDateAbsent, appendSnapshot, getHistory } = await import('../netlify/functions/_scoreHistoryStore.mjs');

// A realistic full project as the client would hold it after a live scan.
function makeProject(overrides = {}) {
  const realData = {
    marketCapUsd: 5_000_000,
    totalLiquidityUsd: 250_000,
    liquidityUsd: 250_000,
    volume24hUsd: 90_000,
    holderCount: 12_000,
    topHolderPercent: 12,
    topTenHolderPercent: 40,
    tokenAgeDays: 200,
    mintAuthorityEnabled: false,
    freezeAuthorityEnabled: false,
    upgradeable: false,
    coingeckoListed: true,
    supply: 1_000_000_000,
    holderGrowthPercent: 5,
    isNativeAsset: false,
    socialMetadataAvailable: true,
    websiteUrl: 'https://example.io',
    twitterUrl: 'https://twitter.com/example',
    telegramUrl: '',
    githubUrl: '',
    ...(overrides.realData || {}),
  };
  return {
    founderStatus: 'Public / doxxed team',
    description: 'A genuine project description with substance.',
    roadmapText: 'Q1 mainnet, Q2 partnerships, Q3 scaling.',
    communitySize: 12_000,
    riskNotes: '',
    confidenceScore: 82,
    ...overrides,
    realData,
  };
}

// The volatile half the worker gets fresh each cycle (snapshot.signals shape),
// mirroring a project's realData so parity can be asserted.
function freshFrom(project) {
  const d = project.realData;
  return {
    totalLiquidityUsd: d.totalLiquidityUsd,
    volume24hUsd: d.volume24hUsd,
    holderCount: d.holderCount,
    topHolderPercent: d.topHolderPercent,
    topTenHolderPercent: d.topTenHolderPercent,
    tokenAgeDays: d.tokenAgeDays,
    mintAuthorityEnabled: d.mintAuthorityEnabled,
    freezeAuthorityEnabled: d.freezeAuthorityEnabled,
    upgradeable: d.upgradeable,
  };
}

test('a monitored point equals the client full score for the same volatile data', () => {
  const project = makeProject();
  const clientScore = calculateLiveScores(project, project.realData).finalTrustScore;

  const scoreInputs = extractScoreInputs(project);
  const built = buildMonitoredHistoryPoint({ scoreInputs, freshSignals: freshFrom(project), date: '2026-07-24' });

  assert.equal(built.recordable, true);
  assert.equal(built.snapshot.score, Math.round(clientScore));
});

test('parity holds across profile shapes (no socials, anon founder, risk notes)', () => {
  const project = makeProject({
    founderStatus: 'Anonymous',
    description: '',
    roadmapText: '',
    riskNotes: 'anonymous team, no roadmap',
    realData: {
      socialMetadataAvailable: false,
      websiteUrl: '',
      twitterUrl: '',
      telegramUrl: '',
      githubUrl: '',
    },
  });
  const clientScore = calculateLiveScores(project, project.realData).finalTrustScore;
  const built = buildMonitoredHistoryPoint({
    scoreInputs: extractScoreInputs(project),
    freshSignals: freshFrom(project),
    date: '2026-07-24',
  });
  assert.equal(built.snapshot.score, Math.round(clientScore));
});

test('the point tracks a real volatile change — a liquidity drain lowers the score', () => {
  const project = makeProject();
  const scoreInputs = extractScoreInputs(project);

  const healthy = buildMonitoredHistoryPoint({ scoreInputs, freshSignals: freshFrom(project), date: '2026-07-24' });
  const drained = buildMonitoredHistoryPoint({
    scoreInputs,
    freshSignals: { ...freshFrom(project), totalLiquidityUsd: 0, volume24hUsd: 0 },
    date: '2026-07-25',
  });

  assert.ok(drained.snapshot.score < healthy.snapshot.score,
    `expected drained ${drained.snapshot.score} < healthy ${healthy.snapshot.score}`);
});

test('riskLevel and provenance ride on the monitored snapshot', () => {
  const built = buildMonitoredHistoryPoint({
    scoreInputs: extractScoreInputs(makeProject()),
    freshSignals: freshFrom(makeProject()),
    date: '2026-07-24',
  });
  assert.ok(['Low', 'Medium', 'High'].includes(built.snapshot.riskLevel));
  assert.equal(built.snapshot.source, 'server_rescan');
  assert.equal(built.snapshot.complete, true);
  assert.equal(built.snapshot.confidence, 82);
});

test('no persisted profile is an honest skip, never a volatile score in disguise', () => {
  const built = buildMonitoredHistoryPoint({
    scoreInputs: null,
    freshSignals: freshFrom(makeProject()),
    date: '2026-07-24',
  });
  assert.equal(built.recordable, false);
  assert.equal(built.reason, 'no_score_inputs');
});

test('an observation with no market (outage) is skipped, not recorded as a decline', () => {
  const project = makeProject({ realData: { marketCapUsd: 0, totalLiquidityUsd: 0, liquidityUsd: 0 } });
  const built = buildMonitoredHistoryPoint({
    scoreInputs: extractScoreInputs(project),
    freshSignals: { ...freshFrom(project), totalLiquidityUsd: 0 },
    date: '2026-07-24',
  });
  assert.equal(built.recordable, false);
  assert.equal(built.reason, 'no_market_observed');
});

test('gap-fill writes the day, then leaves an existing same-day point untouched', async () => {
  stores.clear();
  const key = 'c:monitored-token';
  const first = await appendSnapshotIfDateAbsent(key, { date: '2026-07-24', score: 70, riskLevel: 'Medium', complete: true, source: 'server_rescan' });
  assert.equal(first.written, true);

  // A second observation the same UTC day must NOT overwrite the first point.
  const second = await appendSnapshotIfDateAbsent(key, { date: '2026-07-24', score: 99, riskLevel: 'Low', complete: true, source: 'server_rescan' });
  assert.equal(second.written, false);

  const history = await getHistory(key);
  assert.equal(history.length, 1);
  assert.equal(history[0].score, 70);
});

test('a client view still refreshes the day, overwriting a monitored point with the fuller scan', async () => {
  stores.clear();
  const key = 'c:monitored-token';
  await appendSnapshotIfDateAbsent(key, { date: '2026-07-24', score: 70, riskLevel: 'Medium', complete: true, source: 'server_rescan' });
  // The client path (appendSnapshot) upserts by date — the human view wins.
  await appendSnapshot(key, { date: '2026-07-24', score: 74, riskLevel: 'Medium', complete: true });
  const history = await getHistory(key);
  assert.equal(history.length, 1);
  assert.equal(history[0].score, 74);
});

test('gap-fill preserves earlier days and appends new ones in date order', async () => {
  stores.clear();
  const key = 'c:series-token';
  await appendSnapshotIfDateAbsent(key, { date: '2026-07-22', score: 60, riskLevel: 'Medium', complete: true });
  await appendSnapshotIfDateAbsent(key, { date: '2026-07-24', score: 66, riskLevel: 'Medium', complete: true });
  await appendSnapshotIfDateAbsent(key, { date: '2026-07-23', score: 63, riskLevel: 'Medium', complete: true });
  const history = await getHistory(key);
  assert.deepEqual(history.map((h) => h.date), ['2026-07-22', '2026-07-23', '2026-07-24']);
});
