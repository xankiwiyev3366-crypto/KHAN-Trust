// Trust Movers — the pure intelligence core (src/lib/trustMovers.js).
//
// No mocks: every function here is pure, so these assert the exact ranking, tie
// behaviour, classification, and (crucially) that explanations are GROUNDED in
// real component deltas and that missing history is never invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTrustMovers, toMovement, explainMovement, percentChange, trendOf,
  isEmptyResult, isValidPeriod, periodDays, PERIODS,
} from '../src/lib/trustMovers.js';

// A score-history snapshot in the shape mapScoreHistoryRow produces.
function snap(extra = {}) {
  return {
    date: '2026-07-20', score: 60, riskLevel: 'Medium', confidence: 80, complete: true,
    topHolderPercent: null, liquidityUsd: null, categories: null, socialScore: null, assetCategory: '',
    ...extra,
  };
}
function row(identity, current, previous, extra = {}) {
  return { identity, name: identity, ticker: '', chain: 'ethereum', contract: identity, lastUpdated: current.date, current, previous, ...extra };
}

// ── Primitives ───────────────────────────────────────────────────────────────
test('percentChange: signed, one-decimal, null on a zero/absent baseline', () => {
  assert.equal(percentChange(50, 75), 50);
  assert.equal(percentChange(80, 60), -25);
  assert.equal(percentChange(0, 60), null);
  assert.equal(percentChange(null, 60), null);
  assert.equal(percentChange(60, null), null);
});

test('trendOf: up/down/flat, and "new" when there is no baseline', () => {
  assert.equal(trendOf(5), 'up');
  assert.equal(trendOf(-5), 'down');
  assert.equal(trendOf(0), 'flat');
  assert.equal(trendOf(null), 'new');
});

// ── Movement object ──────────────────────────────────────────────────────────
test('toMovement: computes absolute + percentage change and trend from prev→curr', () => {
  const m = toMovement(row('c:a', snap({ score: 82, date: '2026-07-27' }), snap({ score: 70, date: '2026-07-20' })));
  assert.equal(m.currentScore, 82);
  assert.equal(m.previousScore, 70);
  assert.equal(m.absoluteChange, 12);
  assert.equal(m.percentChange, 17.1);
  assert.equal(m.trend, 'up');
});

test('toMovement: no previous → null deltas, "new" trend, empty reasons (never invented)', () => {
  const m = toMovement(row('c:a', snap({ score: 82 }), null));
  assert.equal(m.previousScore, null);
  assert.equal(m.absoluteChange, null);
  assert.equal(m.percentChange, null);
  assert.equal(m.trend, 'new');
  assert.deepEqual(m.reasons, []);
});

// ── Sorting & ties ───────────────────────────────────────────────────────────
test('rising: sorted by magnitude of absolute change, largest first', () => {
  const rows = [
    row('c:small', snap({ score: 63 }), snap({ score: 60 })),   // +3
    row('c:big', snap({ score: 90 }), snap({ score: 60 })),     // +30
    row('c:mid', snap({ score: 75 }), snap({ score: 60 })),     // +15
  ];
  const { rising } = buildTrustMovers(rows);
  assert.deepEqual(rising.map((m) => m.identity), ['c:big', 'c:mid', 'c:small']);
});

test('falling: most-negative change first; rising excludes decreases and vice versa', () => {
  const rows = [
    row('c:up', snap({ score: 80 }), snap({ score: 60 })),      // +20
    row('c:down', snap({ score: 30 }), snap({ score: 60 })),    // -30
    row('c:down2', snap({ score: 50 }), snap({ score: 60 })),   // -10
  ];
  const { rising, falling } = buildTrustMovers(rows);
  assert.deepEqual(rising.map((m) => m.identity), ['c:up']);
  assert.deepEqual(falling.map((m) => m.identity), ['c:down', 'c:down2']);
});

test('ties: equal absolute change break by |percentage change|, then identity — deterministic', () => {
  // Both move +10 absolute, but from different baselines so the % differs.
  const rows = [
    row('c:zeta', snap({ score: 60 }), snap({ score: 50 })),    // +10, +20%
    row('c:alpha', snap({ score: 40 }), snap({ score: 30 })),   // +10, +33.3%
  ];
  const { rising } = buildTrustMovers(rows);
  // Larger percentage move ranks first despite the identical absolute change.
  assert.deepEqual(rising.map((m) => m.identity), ['c:alpha', 'c:zeta']);
});

test('ties: identical absolute AND percentage change fall back to stable identity order', () => {
  const rows = [
    row('c:bbb', snap({ score: 66 }), snap({ score: 60 })),     // +6, +10%
    row('c:aaa', snap({ score: 66 }), snap({ score: 60 })),     // +6, +10%
  ];
  const { rising } = buildTrustMovers(rows);
  assert.deepEqual(rising.map((m) => m.identity), ['c:aaa', 'c:bbb']);
});

test('limit is applied per section', () => {
  const rows = Array.from({ length: 10 }, (_, i) =>
    row(`c:${i}`, snap({ score: 60 + (i + 1) }), snap({ score: 60 })));
  const { rising } = buildTrustMovers(rows, { limit: 3 });
  assert.equal(rising.length, 3);
});

test('sub-threshold jitter (0 change) is not a mover', () => {
  const rows = [row('c:flat', snap({ score: 60 }), snap({ score: 60 }))];
  const { rising, falling } = buildTrustMovers(rows);
  assert.equal(rising.length, 0);
  assert.equal(falling.length, 0);
});

// ── Classification: new sections ─────────────────────────────────────────────
test('newHighConfidence: high score + high confidence now, not before (or brand new)', () => {
  const rows = [
    // Crossed into high confidence this window.
    row('c:crossed', snap({ score: 85, riskLevel: 'Low', confidence: 82 }), snap({ score: 60, riskLevel: 'Medium', confidence: 80 })),
    // Brand new, already high confidence.
    row('c:new', snap({ score: 88, riskLevel: 'Low', confidence: 90 }), null),
    // Already high confidence before → NOT "new".
    row('c:stable', snap({ score: 90, riskLevel: 'Low', confidence: 85 }), snap({ score: 88, riskLevel: 'Low', confidence: 84 })),
    // High score but LOW confidence → excluded.
    row('c:thin', snap({ score: 85, riskLevel: 'Low', confidence: 40 }), null),
  ];
  const { newHighConfidence } = buildTrustMovers(rows);
  const ids = newHighConfidence.map((m) => m.identity);
  assert.ok(ids.includes('c:crossed'));
  assert.ok(ids.includes('c:new'));
  assert.ok(!ids.includes('c:stable'));
  assert.ok(!ids.includes('c:thin'));
});

test('newlyHighRisk: High now, not High before (or brand new); crossing INTO risk', () => {
  const rows = [
    row('c:crossed', snap({ score: 40, riskLevel: 'High' }), snap({ score: 70, riskLevel: 'Medium' })),
    row('c:new', snap({ score: 30, riskLevel: 'High' }), null),
    row('c:alreadyHigh', snap({ score: 35, riskLevel: 'High' }), snap({ score: 40, riskLevel: 'High' })),
  ];
  const { newlyHighRisk } = buildTrustMovers(rows);
  const ids = newlyHighRisk.map((m) => m.identity);
  assert.ok(ids.includes('c:crossed'));
  assert.ok(ids.includes('c:new'));
  assert.ok(!ids.includes('c:alreadyHigh'));
});

test('risk level derived from score when the stored level is null (never mislabelled)', () => {
  const rows = [row('c:x', snap({ score: 30, riskLevel: null }), null)];
  const { newlyHighRisk } = buildTrustMovers(rows);
  assert.equal(newlyHighRisk.length, 1);          // score 30 → High even with null level
});

// ── Grounded explanations ────────────────────────────────────────────────────
test('explainMovement: each reason is grounded in a real component delta', () => {
  // Exactly three component movements (liquidity, holder concentration, contract
  // security), so all three grounded reasons appear within the reason cap.
  const previous = snap({ score: 60, liquidityUsd: 1000, topHolderPercent: 20, categories: { contractSecurity: 50 } });
  const current = snap({ score: 78, liquidityUsd: 2000, topHolderPercent: 10, categories: { contractSecurity: 70 } });
  const reasons = explainMovement(previous, current);
  assert.ok(reasons.includes('Liquidity increased'));
  assert.ok(reasons.includes('Holder concentration improved'));
  assert.ok(reasons.includes('Contract risk decreased'));
  assert.ok(reasons.length <= 3);                 // capped, strongest first
});

test('explainMovement: worsening components read as risk-negative wording', () => {
  const previous = snap({ score: 80, topHolderPercent: 8, categories: { marketActivity: 75 } });
  const current = snap({ score: 55, topHolderPercent: 25, categories: { marketActivity: 50 } });
  const reasons = explainMovement(previous, current);
  assert.ok(reasons.includes('Large holder accumulation detected'));
  assert.ok(reasons.includes('Trading activity became suspicious'));
});

test('explainMovement: falls back to the literal score delta when no component crossed a threshold', () => {
  const previous = snap({ score: 60 });
  const current = snap({ score: 70 });            // +10 but no component fields to diff
  assert.deepEqual(explainMovement(previous, current), ['Trust Score rose 10 pts']);
  assert.deepEqual(explainMovement(snap({ score: 70 }), snap({ score: 60 })), ['Trust Score fell 10 pts']);
});

test('explainMovement: no previous → no reasons (history never invented)', () => {
  assert.deepEqual(explainMovement(null, snap({ score: 80 })), []);
});

// ── Empty / period helpers ───────────────────────────────────────────────────
test('isEmptyResult: true only when every section is empty', () => {
  assert.equal(isEmptyResult({ rising: [], falling: [], newHighConfidence: [], newlyHighRisk: [] }), true);
  assert.equal(isEmptyResult({ rising: [{}], falling: [], newHighConfidence: [], newlyHighRisk: [] }), false);
});

test('periods: the four supported windows map to day counts', () => {
  assert.deepEqual(Object.keys(PERIODS), ['24H', '7D', '30D', '90D']);
  assert.equal(periodDays('30D'), 30);
  assert.equal(isValidPeriod('7D'), true);
  assert.equal(isValidPeriod('1Y'), false);
  assert.equal(periodDays('bogus'), 7);           // defaults to 7D
});
