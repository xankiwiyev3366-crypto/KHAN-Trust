// Tests for the pure score-history helpers (Phase 2 coverage). historyKeyFor
// and computeScoreDelta are pure; the network/React parts are not exercised.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { historyKeyFor, computeScoreDelta } from './scoreHistory.js';

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
