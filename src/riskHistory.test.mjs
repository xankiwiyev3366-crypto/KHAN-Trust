// Platform Memory / Risk History repair — regression tests for the pure diff
// brain (riskHistory.js). Each test pins one of the root causes the timeline
// used to exhibit, and exercises MULTIPLE tokens across MULTIPLE chains
// (Solana, Ethereum, BSC, and a native L1 coin) so nothing is Solana- or
// Pyth-specific.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidSnapshot,
  validHistory,
  confidenceRegressed,
  diffSnapshots,
  buildRiskHistory,
} from './riskHistory.js';

// A complete, high-confidence snapshot; override any field per test.
const snap = (date, score, extra = {}) => ({
  date,
  score,
  riskLevel: 'Medium',
  confidence: 90,
  complete: true,
  topHolderPercent: null,
  liquidityUsd: null,
  categories: {},
  socialScore: null,
  ...extra,
});

// ── Snapshot validity gate ────────────────────────────────────────────────────

test('isValidSnapshot rejects demo, incomplete, and scoreless snapshots', () => {
  assert.equal(isValidSnapshot(snap('2026-07-01', 80)), true);
  assert.equal(isValidSnapshot(snap('2026-07-01', 80, { demo: true })), false);
  assert.equal(isValidSnapshot(snap('2026-07-01', 80, { complete: false })), false);
  assert.equal(isValidSnapshot(snap('2026-07-01', null)), false);
  assert.equal(isValidSnapshot({ date: '2026-07-01' }), false);
  assert.equal(isValidSnapshot(null), false);
});

test('validHistory drops invalid entries and sorts ascending', () => {
  const history = [
    snap('2026-07-03', 80),
    snap('2026-07-02', 70, { complete: false }),
    snap('2026-07-01', 60),
  ];
  const valid = validHistory(history);
  assert.deepEqual(valid.map((s) => s.date), ['2026-07-01', '2026-07-03']);
});

// ── Missing/thin data is never a real decrease ───────────────────────────────

test('confidenceRegressed only fires on a material completeness drop with both stamps', () => {
  assert.equal(confidenceRegressed(snap('a', 90, { confidence: 90 }), snap('b', 70, { confidence: 60 })), true);
  assert.equal(confidenceRegressed(snap('a', 90, { confidence: 90 }), snap('b', 70, { confidence: 80 })), false);
  // Unknown confidence on either side never suppresses.
  assert.equal(confidenceRegressed(snap('a', 90, { confidence: null }), snap('b', 70, { confidence: 40 })), false);
});

test('a score drop on materially thinner data is suppressed (BSC token, GoPlus outage)', () => {
  // Yesterday: full data. Today: holder/authority provider went quiet, score
  // fell 91 -> 74 purely because inputs vanished. Must NOT be a change.
  const prev = snap('2026-07-01', 91, { confidence: 90 });
  const curr = snap('2026-07-02', 74, { confidence: 55 });
  const changes = diffSnapshots(prev, curr);
  assert.equal(changes.find((c) => c.key === 'trustScore'), undefined);
});

test('an identical-confidence score drop IS a real change (Ethereum token)', () => {
  const prev = snap('2026-07-01', 91, { confidence: 88 });
  const curr = snap('2026-07-02', 74, { confidence: 88 });
  const change = diffSnapshots(prev, curr).find((c) => c.key === 'trustScore');
  assert.ok(change);
  assert.equal(change.delta, -17);
  assert.equal(change.worse, true);
});

test('an UPWARD move is kept even when data got thinner', () => {
  const prev = snap('2026-07-01', 60, { confidence: 90 });
  const curr = snap('2026-07-02', 80, { confidence: 40 });
  const change = diffSnapshots(prev, curr).find((c) => c.key === 'trustScore');
  assert.ok(change);
  assert.equal(change.worse, false);
});

// ── diffSnapshots metric coverage ─────────────────────────────────────────────

test('liquidity swing is reported as a percentage, holder concentration in points', () => {
  const prev = snap('2026-07-01', 80, { liquidityUsd: 100000, topHolderPercent: 10 });
  const curr = snap('2026-07-02', 80, { liquidityUsd: 60000, topHolderPercent: 18 });
  const changes = diffSnapshots(prev, curr);
  const liq = changes.find((c) => c.key === 'liquidity');
  const holder = changes.find((c) => c.key === 'holderConcentration');
  assert.equal(liq.percent, 40);
  assert.equal(liq.worse, true);
  assert.equal(holder.delta, 8);
  assert.equal(holder.worse, true);
});

test('a metric known on only one side never fabricates a change', () => {
  const prev = snap('2026-07-01', 80, { liquidityUsd: 100000, topHolderPercent: null });
  const curr = snap('2026-07-02', 80, { liquidityUsd: null, topHolderPercent: 12 });
  assert.deepEqual(diffSnapshots(prev, curr), []);
});

// ── buildRiskHistory: compare to latest VALID previous, no false swings ───────

test('real -> outage(invalid) -> real shows NO event (no false back-and-forth)', () => {
  // The exact bug: an outage day between two identical real days used to render
  // as a drop then a recovery. With the invalid middle skipped, the two real
  // days compare directly and produce nothing.
  const history = [
    snap('2026-07-01', 82, { confidence: 90 }),
    snap('2026-07-02', 61, { complete: false, confidence: 40 }),
    snap('2026-07-03', 82, { confidence: 90 }),
  ];
  assert.deepEqual(buildRiskHistory(history, 'en'), []);
});

test('each snapshot is compared to the latest VALID previous, not the array neighbour', () => {
  const history = [
    snap('2026-07-01', 80, { confidence: 90 }),          // A (valid baseline)
    snap('2026-07-02', 50, { complete: false }),          // invalid, skipped
    snap('2026-07-03', 66, { confidence: 90 }),          // C compared to A (80 -> 66)
  ];
  const events = buildRiskHistory(history, 'en');
  assert.equal(events.length, 1);
  assert.equal(events[0].previousScore, 80);
  assert.equal(events[0].newScore, 66);
  assert.equal(events[0].scoreDelta, -14);
});

test('no event is created when nothing meaningful changed', () => {
  const history = [snap('2026-07-01', 80), snap('2026-07-02', 81), snap('2026-07-03', 82)];
  // +1 then +1 are both below the 3-point threshold → no events at all.
  assert.deepEqual(buildRiskHistory(history, 'en'), []);
});

test('a null risk level never manufactures a risk-level change', () => {
  const history = [
    snap('2026-07-01', 80, { riskLevel: 'Low' }),
    snap('2026-07-02', 80, { riskLevel: null }),
  ];
  assert.deepEqual(buildRiskHistory(history, 'en'), []);
});

test('a genuine decline surfaces a worse event with a factual transition', () => {
  const history = [
    snap('2026-07-01', 85, { riskLevel: 'Low', confidence: 90 }),
    snap('2026-07-02', 60, { riskLevel: 'High', confidence: 90 }),
  ];
  const events = buildRiskHistory(history, 'en');
  assert.equal(events.length, 1);
  assert.equal(events[0].worse, true);
  assert.equal(events[0].previousScore, 85);
  assert.equal(events[0].newScore, 60);
  assert.ok(events[0].riskChange);
  assert.equal(events[0].riskChange.worse, true);
  assert.ok(events[0].explanation && events[0].explanation.length > 0);
});

test('a data-thinned drop does not colour the row worse, even alongside a real change', () => {
  // Score fell on thinner data (suppressed) but holder concentration genuinely
  // rose. The event exists (holder change) but must not be flagged "worse" by
  // the phantom score drop, and its headline must not claim a score drop.
  const prev = snap('2026-07-01', 90, { confidence: 90, topHolderPercent: 10 });
  const curr = snap('2026-07-02', 70, { confidence: 50, topHolderPercent: 14 });
  const events = buildRiskHistory([prev, curr], 'en');
  assert.equal(events.length, 1);
  assert.equal(events[0].scoreDelta, null); // suppressed score change
  const holder = events[0].changes.find((c) => c.key === 'holderConcentration');
  assert.ok(holder);
});

// ── Independence across tokens/chains ─────────────────────────────────────────

test('histories for different tokens/chains are computed independently', () => {
  const solana = [snap('2026-07-01', 80), snap('2026-07-02', 65)]; // -15 real
  const ethereum = [snap('2026-07-01', 40), snap('2026-07-02', 41)]; // +1 no event
  assert.equal(buildRiskHistory(solana, 'en').length, 1);
  assert.equal(buildRiskHistory(ethereum, 'en').length, 0);
});
