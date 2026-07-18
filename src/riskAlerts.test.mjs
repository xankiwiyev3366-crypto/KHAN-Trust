// Watchlist alert regressions (riskAlerts.js). The smart alerts must fire on
// real drift and stay silent on data noise — the same guarantees the on-page
// timeline now makes, since both read the same score history.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectRiskAlerts } from './riskAlerts.js';

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

test('a real score drop on stable data raises a high-severity alert', () => {
  const alerts = detectRiskAlerts([snap('2026-07-01', 82), snap('2026-07-02', 70)]);
  assert.ok(alerts.some((a) => a.type === 'score_drop' && a.severity === 'high'));
});

test('a score drop caused by thinner data raises NO alert', () => {
  // 82 -> 70 but confidence collapsed 90 -> 50: a provider went quiet, not a rug.
  const alerts = detectRiskAlerts([
    snap('2026-07-01', 82, { confidence: 90 }),
    snap('2026-07-02', 70, { confidence: 50 }),
  ]);
  assert.equal(alerts.some((a) => a.type === 'score_drop'), false);
});

test('an invalid latest snapshot is ignored — alerts compare the last two VALID', () => {
  const alerts = detectRiskAlerts([
    snap('2026-07-01', 82),
    snap('2026-07-02', 70),
    snap('2026-07-03', 10, { complete: false }), // slipped-through junk, ignored
  ]);
  // Still the real 82 -> 70 drop, not a phantom 70 -> 10 collapse.
  const drop = alerts.find((a) => a.type === 'score_drop');
  assert.ok(drop);
});

test('a null risk level never raises a phantom risk_level_up alert', () => {
  const alerts = detectRiskAlerts([
    snap('2026-07-01', 80, { riskLevel: 'Low' }),
    snap('2026-07-02', 80, { riskLevel: null }),
  ]);
  assert.equal(alerts.some((a) => a.type === 'risk_level_up'), false);
});

test('holder concentration spike and liquidity drop each raise their alert', () => {
  const alerts = detectRiskAlerts([
    snap('2026-07-01', 80, { topHolderPercent: 10, liquidityUsd: 100000 }),
    snap('2026-07-02', 80, { topHolderPercent: 20, liquidityUsd: 60000 }),
  ]);
  assert.ok(alerts.some((a) => a.type === 'holder_concentration'));
  assert.ok(alerts.some((a) => a.type === 'liquidity_drop'));
});

test('fewer than two valid snapshots yields no alerts (multi-chain safe)', () => {
  assert.deepEqual(detectRiskAlerts([snap('2026-07-01', 80)]), []);
  assert.deepEqual(detectRiskAlerts([snap('2026-07-01', 80), snap('2026-07-02', 60, { complete: false })]), []);
});
