// Tests for the Confidence Engine.
//
// These are not incidental unit tests: this module is what stops the Growth OS
// from inventing insight out of noise, so its thresholds and its maths are
// pinned here deliberately. If a change makes these fail, the system has become
// more confident than the data allows — which is the exact failure mode the
// whole design exists to prevent.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  wilsonInterval, assessRate, assessCount, assessChange, CONFIDENCE, isTrustworthy,
} from './_growthConfidence.mjs';

test('Wilson: interval stays inside [0,1] at the extremes', () => {
  // The normal approximation famously produces impossible bounds here. Wilson
  // must not - these are the exact cases KHAN Trust hits today.
  const zero = wilsonInterval(0, 10);
  assert.ok(zero.low >= 0, 'low must not go below 0');
  assert.ok(zero.high <= 1 && zero.high > 0, 'zero successes still leaves real uncertainty');

  const all = wilsonInterval(10, 10);
  assert.ok(all.high <= 1, 'high must not exceed 1');
  assert.ok(all.low < 1, '10/10 is not proof of 100%');
});

test('Wilson: more data narrows the interval', () => {
  const small = wilsonInterval(5, 10);
  const large = wilsonInterval(500, 1000);
  assert.ok(large.width < small.width, 'n=1000 must be tighter than n=10');
  assert.ok(small.width > 0.5, 'half of ten tells you almost nothing');
  assert.ok(large.width < 0.07, 'half of a thousand is reasonably precise');
});

test('Wilson: no data is total ignorance, not a crash', () => {
  const none = wilsonInterval(0, 0);
  assert.deepEqual(none, { low: 0, high: 1, width: 1 });
});

test('assessRate: the platform\'s real situation is reported as insufficient', () => {
  // 2 signups from 4 visitors = "50% conversion". Arithmetically true,
  // decision-useless. This is THE case the engine exists to catch.
  const bogus = assessRate(2, 4);
  assert.equal(bogus.level, CONFIDENCE.INSUFFICIENT);
  assert.match(bogus.reason, /below the 30/);
  assert.equal(isTrustworthy(bogus.confidence), false);
});

test('assessRate: sample size drives the verdict', () => {
  assert.equal(assessRate(15, 29).level, CONFIDENCE.INSUFFICIENT, 'under 30 is never usable');

  // n=100 at p=0.5 is the widest a proportion gets: ~19pp interval -> directional.
  assert.equal(assessRate(50, 100).level, CONFIDENCE.DIRECTIONAL);

  // n=1000 at p=0.5 -> ~6pp interval -> sufficient.
  assert.equal(assessRate(500, 1000).level, CONFIDENCE.SUFFICIENT);
});

test('assessRate: judged on interval width, not sample size alone', () => {
  // Same n, very different certainty. A bare n>=X cutoff would call these
  // equally trustworthy; they are not.
  const uncertain = assessRate(50, 100);   // p=0.5, widest case
  const certain = assessRate(1, 100);      // p=0.01, much tighter
  assert.ok(certain.interval.width < uncertain.interval.width);
  assert.equal(certain.level, CONFIDENCE.SUFFICIENT);
  assert.equal(uncertain.level, CONFIDENCE.DIRECTIONAL);
});

test('assessCount: counts use their own, lower bar', () => {
  assert.equal(assessCount(3).level, CONFIDENCE.INSUFFICIENT);
  assert.equal(assessCount(25).level, CONFIDENCE.DIRECTIONAL);
  assert.equal(assessCount(120).level, CONFIDENCE.SUFFICIENT);
});

test('assessChange: refuses to call small-number swings a trend', () => {
  // 5 -> 7 signups is "+40%" and is the classic early-stage dashboard lie.
  const noise = assessChange(7, 20, 5, 20);
  assert.equal(noise.significant, false);
  assert.equal(noise.level, CONFIDENCE.INSUFFICIENT);
  assert.match(noise.reason, /too little data/);
});

test('assessChange: overlapping intervals are not a real change', () => {
  const overlapping = assessChange(52, 100, 48, 100);
  assert.equal(overlapping.significant, false);
  assert.match(overlapping.reason, /overlap/);
});

test('assessChange: a genuinely large, well-sampled shift IS reported', () => {
  // The engine must not be uselessly pessimistic - when the data really does
  // support a conclusion, it has to say so, or the operator learns to ignore it.
  const real = assessChange(300, 1000, 100, 1000);
  assert.equal(real.significant, true);
  assert.equal(real.level, CONFIDENCE.SUFFICIENT);
  assert.match(real.reason, /do not overlap/);
});
