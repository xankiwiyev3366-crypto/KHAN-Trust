// Your Risk Over Time — what changed since the user's last visit.
//
// The governing rule: this panel interrupts a page the user came to for
// something else, so it must render ONLY on a real, measured change. Every
// ambiguous case resolves to silence, never to "nothing changed".
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { changesSinceVisit, rankEntries, MAX_LOOKBACK_DAYS } from '../src/sinceLastVisit.js';

// A client-lane score-history snapshot, the shape scoreHistory.js records.
const snap = (date, score, extra = {}) => ({
  date,
  score,
  riskLevel: score >= 70 ? 'Low' : score >= 40 ? 'Medium' : 'High',
  confidence: 80,
  liquidityUsd: 500_000,
  topHolderPercent: 8,
  categories: { contractSecurity: 80, holderHealth: 70, marketActivity: 60, community: 55 },
  socialScore: 60,
  ...extra,
});

const NOW = Date.parse('2026-07-20T12:00:00.000Z');
const VISIT = '2026-07-15T09:00:00.000Z';

// ── Silence unless there is something real to say ────────────────────────────

test('a single snapshot is not a comparison', () => {
  assert.equal(changesSinceVisit([snap('2026-07-18', 80)], VISIT, NOW), null);
});

test('no previous visit yields nothing — a first session has no "since"', () => {
  const history = [snap('2026-07-10', 85), snap('2026-07-18', 60)];
  assert.equal(changesSinceVisit(history, null, NOW), null);
});

test('history entirely older than the visit yields nothing', () => {
  // Everything we know predates their last visit, so they have already seen it.
  const history = [snap('2026-07-10', 85), snap('2026-07-12', 70)];
  assert.equal(changesSinceVisit(history, VISIT, NOW), null);
});

test('movement below the engine thresholds is not a change', () => {
  // Reuses diffSnapshots' thresholds, so the dashboard cannot become chattier
  // than the token page about the same movement.
  const history = [snap('2026-07-14', 80), snap('2026-07-18', 81)];
  assert.equal(changesSinceVisit(history, VISIT, NOW), null);
});

// ── Real changes surface, with the right baseline ────────────────────────────

test('a drop since the last visit is reported against the pre-visit baseline', () => {
  const history = [
    snap('2026-07-10', 88),  // older
    snap('2026-07-14', 85),  // the state when they last visited
    snap('2026-07-18', 52),  // what happened since
  ];
  const result = changesSinceVisit(history, VISIT, NOW);
  assert.ok(result);
  assert.equal(result.baseline.score, 85, 'baseline is the last snapshot before the visit');
  assert.equal(result.latest.score, 52);
  assert.equal(result.worse, true);
  assert.ok(result.riskChange, 'Low -> Medium is a risk-level change');
});

test('improvements are reported too, and are not marked worse', () => {
  const history = [snap('2026-07-14', 45), snap('2026-07-18', 78)];
  const result = changesSinceVisit(history, VISIT, NOW);
  assert.ok(result);
  assert.equal(result.worse, false);
});

test('a data-thinned drop is suppressed, exactly as on the token page', () => {
  // The shared confidence-regression guard: a provider outage must not be
  // reported to a returning user as their token collapsing.
  const history = [
    snap('2026-07-14', 88, { confidence: 90 }),
    snap('2026-07-18', 60, { confidence: 40 }),
  ];
  assert.equal(changesSinceVisit(history, VISIT, NOW), null);
});

// ── The lookback horizon ─────────────────────────────────────────────────────

test('a long-lapsed user is not shown an unbounded diff', () => {
  // Returning after months, the baseline is clamped to the lookback horizon
  // rather than reaching back to their genuine last visit.
  const longAgo = '2026-01-01T00:00:00.000Z';
  const withinWindow = new Date(NOW - 5 * 86400000).toISOString().slice(0, 10);
  const history = [
    snap('2026-01-02', 90),      // far outside the window
    snap(withinWindow, 88),      // inside the window — the real baseline
    snap('2026-07-20', 84),
  ];
  const result = changesSinceVisit(history, longAgo, NOW);
  assert.ok(result);
  assert.equal(result.baseline.score, 88, 'baseline is clamped to the lookback horizon');
  assert.ok(MAX_LOOKBACK_DAYS > 0);
});

// ── Ranking ──────────────────────────────────────────────────────────────────

test('risk-level rises outrank bigger score drops', () => {
  const ranked = rankEntries([
    { identity: 'big-drop', worse: true, riskChange: null, scoreDelta: -30 },
    { identity: 'risk-rise', worse: true, riskChange: { worse: true }, scoreDelta: -9 },
    { identity: 'improved', worse: false, riskChange: null, scoreDelta: 12 },
  ]);
  assert.deepEqual(ranked.map((e) => e.identity), ['risk-rise', 'big-drop', 'improved']);
});

test('within the same severity, the larger move leads', () => {
  const ranked = rankEntries([
    { identity: 'small', worse: true, riskChange: null, scoreDelta: -5 },
    { identity: 'large', worse: true, riskChange: null, scoreDelta: -22 },
  ]);
  assert.deepEqual(ranked.map((e) => e.identity), ['large', 'small']);
});
