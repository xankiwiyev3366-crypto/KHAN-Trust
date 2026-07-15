// Tests for the Growth Loop's state machine and honesty rules.
//
// These cover pure logic only (transitions, summarising) — the blob-backed
// CRUD needs a live store and is exercised end-to-end instead.
import test from 'node:test';
import assert from 'node:assert/strict';

import { canTransition, summarise, snapshotBaseline, STATUS, OUTCOME } from './_growthInitiatives.mjs';

test('an initiative cannot skip straight to measured', () => {
  // The transition that matters: proposed -> measured has no baseline, so its
  // "result" would be a comparison against nothing. A meaningless result
  // recorded as fact is worse than no result at all.
  assert.equal(canTransition(STATUS.PROPOSED, STATUS.MEASURED), false);
  assert.equal(canTransition(STATUS.PROPOSED, STATUS.SHIPPED), false);
});

test('the legal path runs proposed -> accepted -> shipped -> measured', () => {
  assert.ok(canTransition(STATUS.PROPOSED, STATUS.ACCEPTED));
  assert.ok(canTransition(STATUS.ACCEPTED, STATUS.SHIPPED));
  assert.ok(canTransition(STATUS.SHIPPED, STATUS.MEASURED));
});

test('terminal states are terminal', () => {
  assert.equal(canTransition(STATUS.MEASURED, STATUS.SHIPPED), false);
  assert.equal(canTransition(STATUS.REJECTED, STATUS.ACCEPTED), false);
});

test('an initiative can be rejected before it is shipped, but not after', () => {
  assert.ok(canTransition(STATUS.PROPOSED, STATUS.REJECTED));
  assert.ok(canTransition(STATUS.ACCEPTED, STATUS.REJECTED));
  assert.equal(canTransition(STATUS.SHIPPED, STATUS.REJECTED), false, 'shipped work must be measured, not disowned');
});

test('the baseline captures what a later comparison will need', () => {
  const warehouse = {
    funnel: {
      totalVisitors: 400,
      stages: [{ id: 'activated', count: 320, rate: { value: 0.8, confidence: { level: 'sufficient' } } }],
    },
    channels: [{ channel: 'youtube', visitors: 100, signups: 5 }],
    retention: { summary: { d1: { value: 0.4 }, d7: { value: 0.2 }, d30: { value: null } } },
  };
  const baseline = snapshotBaseline(warehouse);

  assert.equal(baseline.totalVisitors, 400);
  assert.equal(baseline.stages[0].rate, 0.8);
  assert.equal(baseline.channels[0].channel, 'youtube');
  assert.equal(baseline.retention.d7, 0.2);
  assert.ok(baseline.at, 'the snapshot must be timestamped or it cannot be compared against');
});

test('hit rate is null until there is anything to judge', () => {
  // "0% hit rate" from zero measured initiatives would read as total failure.
  // The same absence-is-not-zero rule the warehouse follows.
  const summary = summarise([
    { status: STATUS.PROPOSED }, { status: STATUS.ACCEPTED },
  ]);
  assert.equal(summary.hitRate, null);
  assert.equal(summary.measuredCount, 0);
});

test('a thin hit rate is reported with an explicit caveat', () => {
  const summary = summarise([
    { status: STATUS.MEASURED, outcome: OUTCOME.WORKED },
    { status: STATUS.MEASURED, outcome: OUTCOME.NO_EFFECT },
  ]);
  assert.equal(summary.hitRate, 0.5);
  assert.match(summary.hitRateNote, /too few to judge/i);
});

test('a mature hit rate drops the caveat', () => {
  const initiatives = Array.from({ length: 6 }, (_, i) => ({
    status: STATUS.MEASURED,
    outcome: i < 4 ? OUTCOME.WORKED : OUTCOME.NO_EFFECT,
  }));
  const summary = summarise(initiatives);
  assert.equal(summary.hitRate, 0.67);
  assert.equal(summary.hitRateNote, null);
});

test('inconclusive is a first-class outcome', () => {
  // At this scale it is usually the CORRECT answer. Forcing every result into
  // worked/failed would manufacture exactly the false certainty this system
  // exists to prevent.
  const summary = summarise([{ status: STATUS.MEASURED, outcome: OUTCOME.INCONCLUSIVE }]);
  assert.equal(summary.byOutcome.inconclusive, 1);
  assert.equal(summary.hitRate, 0, 'inconclusive must not be counted as a win');
});
