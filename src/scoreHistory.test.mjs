// Tests for the pure score-history helpers (Phase 2 coverage). historyKeyFor
// and computeScoreDelta are pure; the network/React parts are not exercised.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historyKeyFor, computeScoreDelta, assessSnapshot } from './scoreHistory.js';

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

test('historyKeyFor: prefers the contract address (lowercased)', () => {
  assert.equal(historyKeyFor({ contract: 'DezXAZ8z...ABC', id: 'x' }), 'c:dezxaz8z...abc');
});

test('historyKeyFor: falls back to id for placeholder / native contracts', () => {
  assert.equal(historyKeyFor({ contract: 'Not provided', id: 'native-bitcoin' }), 'id:native-bitcoin');
  assert.equal(historyKeyFor({ contract: 'Native asset (no contract)', id: 'native-solana' }), 'id:native-solana');
  assert.equal(historyKeyFor({ id: 'proj-1' }), 'id:proj-1');
});

test('historyKeyFor: empty when nothing identifies the project', () => {
  assert.equal(historyKeyFor({}), '');
});

test('computeScoreDelta: null with insufficient history', () => {
  assert.equal(computeScoreDelta([], 50), null);
  assert.equal(computeScoreDelta([{ date: daysAgo(1), score: 40 }], 50), null);
});

test('computeScoreDelta: "thisWeek" against a snapshot >= 6 days old', () => {
  const history = [
    { date: daysAgo(8), score: 30 },
    { date: daysAgo(1), score: 45 },
  ];
  const delta = computeScoreDelta(history, 50);
  assert.equal(delta.label, 'thisWeek');
  assert.equal(delta.delta, 20); // 50 - 30
});

test('computeScoreDelta: "sinceLaunch" when no snapshot is a week old yet', () => {
  const history = [
    { date: daysAgo(3), score: 60 },
    { date: daysAgo(1), score: 55 },
  ];
  const delta = computeScoreDelta(history, 50);
  assert.equal(delta.label, 'sinceLaunch');
  assert.equal(delta.delta, -10); // 50 - 60 (earliest)
});

test('computeScoreDelta: ignores invalid (demo/incomplete) snapshots', () => {
  // The only valid baseline is the 60 from 3 days ago; the demo point must not
  // become the comparison anchor.
  const history = [
    { date: daysAgo(3), score: 60, complete: true },
    { date: daysAgo(2), score: 20, demo: true },
    { date: daysAgo(1), score: 58, complete: true },
  ];
  const delta = computeScoreDelta(history, 50);
  assert.equal(delta.delta, -10); // 50 - 60 (earliest VALID), not 50 - 20
});

// ── assessSnapshot: the storage-time data-quality gate ────────────────────────

const live = (extra = {}) => ({
  realData: { marketCapUsd: 5_000_000, totalLiquidityUsd: 250_000, ...extra },
  confidenceScore: 82,
});

test('assessSnapshot records a normal live token (any chain)', () => {
  const r = assessSnapshot(live(), 77);
  assert.equal(r.recordable, true);
  assert.equal(r.confidence, 82);
});

test('assessSnapshot rejects demo/fallback reports', () => {
  const r = assessSnapshot({ realData: { isDemo: true, marketCapUsd: 1_000_000 }, confidenceScore: 30 }, 40);
  assert.equal(r.recordable, false);
  assert.equal(r.reason, 'demo');
});

test('assessSnapshot rejects manually-entered projects (no live data)', () => {
  const r = assessSnapshot({ realData: null, confidenceScore: 50 }, 65);
  assert.equal(r.recordable, false);
  assert.equal(r.reason, 'manual');
});

test('assessSnapshot rejects an empty observation (no market cap AND no liquidity)', () => {
  // A transient outage where neither DexScreener nor CoinGecko answered — the
  // degraded score must never enter history as a real decrease.
  const r = assessSnapshot({ realData: { marketCapUsd: 0, totalLiquidityUsd: 0, holderCount: 5 }, confidenceScore: 15 }, 44);
  assert.equal(r.recordable, false);
  assert.equal(r.reason, 'no_market_observed');
});

test('assessSnapshot admits a native L1 coin with market cap but no liquidity/holder data', () => {
  // BTC/ETH/SOL via CoinGecko: no single on-chain pool, no holder concentration,
  // but a real market cap. Must be recordable so native coins get history too.
  const r = assessSnapshot({ realData: { marketCapUsd: 1_200_000_000_000, totalLiquidityUsd: null, liquidityUsd: null }, confidenceScore: 55 }, 88);
  assert.equal(r.recordable, true);
});

test('assessSnapshot rejects a non-finite score', () => {
  assert.equal(assessSnapshot(live(), NaN).recordable, false);
  assert.equal(assessSnapshot(live(), undefined).recordable, false);
});

test('assessSnapshot: confidence is null when the project has no confidenceScore', () => {
  const r = assessSnapshot({ realData: { liquidityUsd: 10000 } }, 50);
  assert.equal(r.recordable, true);
  assert.equal(r.confidence, null);
});
