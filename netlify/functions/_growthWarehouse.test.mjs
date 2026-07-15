// Tests for the Growth Warehouse metric definitions.
//
// These use synthetic event logs rather than fixtures so each test states the
// exact scenario it is pinning. The subtle ones - cohort maturity, first-touch
// attribution, visitor-vs-event counting - are the places where a plausible
// implementation is quietly wrong and produces numbers that look fine and
// mislead for months.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildFunnel, findBottleneck, findInstrumentationGaps, buildRetention, buildChannels,
  buildContentDemand, buildConversionBlockers,
} from './_growthWarehouse.mjs';
import { CONFIDENCE } from './_growthConfidence.mjs';

const DAY = 86400000;
const NOW = Date.parse('2026-07-15T12:00:00.000Z');

function evt(type, at, fields = {}) {
  return { id: `e${Math.random()}`, type, timestamp: new Date(at).toISOString(), ...fields };
}

// ── Funnel ────────────────────────────────────────────────────────────────────

test('funnel counts VISITORS, not events', () => {
  // One obsessive visitor scanning 40 tokens must not look like 40 activations.
  const events = [
    evt('page_view', NOW, { visitorId: 'v1' }),
    ...Array.from({ length: 40 }, () => evt('token_scan', NOW, { visitorId: 'v1', contract: 'c1' })),
    evt('page_view', NOW, { visitorId: 'v2' }),
  ];
  const funnel = buildFunnel(events);
  assert.equal(funnel.totalVisitors, 2);
  assert.equal(funnel.stages.find((s) => s.id === 'activated').count, 1, '40 scans by one person = 1 activated visitor');
});

test('funnel does not drop users who took an unexpected path', () => {
  // Signed up without ever scanning. A strictly-sequential funnel would lose
  // them and understate registrations.
  const events = [
    evt('page_view', NOW, { visitorId: 'v1' }),
    evt('user_registered', NOW, { visitorId: 'v1', userId: 'u1' }),
  ];
  const funnel = buildFunnel(events);
  assert.equal(funnel.stages.find((s) => s.id === 'registered').count, 1);
  assert.equal(funnel.stages.find((s) => s.id === 'activated').count, 0);
});

test('funnel labels paid conversions as an event count, not a person count', () => {
  // Card checkout is keyed by wallet, so the platform cannot know how many
  // distinct people paid. The flag is what stops a consumer implying it can.
  const events = [evt('checkout_completed', NOW, { plan: 'premium' })];
  const paid = buildFunnel(events).stages.find((s) => s.id === 'converted');
  assert.equal(paid.countIsEvents, true);
});

test('bottleneck refuses to answer on a tiny sample', () => {
  // THE critical behaviour: 1 of 3 visitors scanning is not a 33% activation
  // rate worth acting on, and the system must say so rather than name a
  // bottleneck the AI would then invent a strategy for.
  const events = [
    evt('page_view', NOW, { visitorId: 'v1' }),
    evt('page_view', NOW, { visitorId: 'v2' }),
    evt('page_view', NOW, { visitorId: 'v3' }),
    evt('token_scan', NOW, { visitorId: 'v1', contract: 'c1' }),
  ];
  const bottleneck = findBottleneck(buildFunnel(events));
  assert.equal(bottleneck.stage, null);
  assert.match(bottleneck.reason, /not enough data|More traffic/i);
});

test('bottleneck DOES answer once a step has real data', () => {
  // The engine must not be uselessly pessimistic, or it gets ignored.
  const events = [];
  for (let i = 0; i < 400; i += 1) {
    events.push(evt('page_view', NOW, { visitorId: `v${i}` }));
    if (i < 320) events.push(evt('token_scan', NOW, { visitorId: `v${i}`, contract: 'c1' }));
    if (i < 8) events.push(evt('user_registered', NOW, { visitorId: `v${i}`, userId: `u${i}` }));
    // Pricing is instrumented and genuinely visited, so "registered" is a real
    // bottleneck rather than an untracked-event artefact.
    if (i < 100) events.push(evt('pricing_view', NOW, { visitorId: `v${i}` }));
    if (i < 20) events.push(evt('checkout_started', NOW, { visitorId: `v${i}` }));
  }
  const bottleneck = findBottleneck(buildFunnel(events));
  assert.equal(bottleneck.stage, 'registered', 'registration is clearly the worst step here');
  assert.ok(bottleneck.rate < 0.05);
  assert.deepEqual(bottleneck.instrumentationGaps, [], 'nothing is untracked in this scenario');
});

test('a zero-event step with real upstream traffic is an instrumentation question, not a bottleneck', () => {
  // The failure this guards against: 400 visitors, nobody "views pricing".
  // Statistically that is 0.0% at n=400 with a narrow interval - the Confidence
  // Engine would certify it, and the AI would then author a detailed strategy
  // to fix a funnel step that is merely untracked. Blaming the funnel for a
  // missing tracking call is fabricated insight wearing a lab coat.
  const events = [];
  for (let i = 0; i < 400; i += 1) {
    events.push(evt('page_view', NOW, { visitorId: `v${i}` }));
    if (i < 320) events.push(evt('token_scan', NOW, { visitorId: `v${i}`, contract: 'c1' }));
    if (i < 40) events.push(evt('user_registered', NOW, { visitorId: `v${i}`, userId: `u${i}` }));
    // ...and NOT a single pricing_view.
  }
  const funnel = buildFunnel(events);

  const gaps = findInstrumentationGaps(funnel);
  assert.ok(gaps.some((gap) => gap.stage === 'pricing'), 'the untracked step must be escalated');
  assert.match(gaps.find((gap) => gap.stage === 'pricing').reason, /not being tracked|Verify instrumentation/i);

  const bottleneck = findBottleneck(funnel);
  assert.notEqual(bottleneck.stage, 'pricing', 'an untracked step must never be named the bottleneck');
  assert.ok(bottleneck.instrumentationGaps.includes('pricing'), 'but the doubt must travel with the answer');
});

test('a zero-event step with trivial upstream traffic raises no instrumentation doubt', () => {
  // With 3 visitors, "nobody viewed pricing" is unremarkable and must not be
  // escalated as a tracking fault - that would cry wolf on every new deploy.
  const events = [
    evt('page_view', NOW, { visitorId: 'v1' }),
    evt('page_view', NOW, { visitorId: 'v2' }),
    evt('page_view', NOW, { visitorId: 'v3' }),
  ];
  assert.deepEqual(findInstrumentationGaps(buildFunnel(events)), []);
});

// ── Retention ─────────────────────────────────────────────────────────────────

test('retention: a user who has not reached D7 yet is NOT a D7 failure', () => {
  // The most consequential bug in most retention dashboards. Signed up 2 days
  // ago -> their D7 has not happened. Counting them as churned understates
  // retention and would have the AI diagnose a crisis that does not exist.
  const signupAt = NOW - 2 * DAY;
  const events = [
    evt('user_registered', signupAt, { userId: 'u1', visitorId: 'v1' }),
    evt('user_login', signupAt + 1 * DAY + 3600000, { userId: 'u1', visitorId: 'v1' }),
  ];
  const retention = buildRetention(events, NOW);
  const cohort = retention.cohorts[0];

  assert.equal(cohort.horizons.d1.matured, true, 'D1 has elapsed');
  assert.equal(cohort.horizons.d1.retained, 1);
  assert.equal(cohort.horizons.d7.matured, false, 'D7 has NOT elapsed');
  assert.equal(cohort.horizons.d7.eligible, 0, 'immature users must be out of the denominator');
});

test('retention: "retained at D7" means active IN the D7 window, not ever after', () => {
  // If "any activity after day 7" counted, D1 and D30 would be nearly identical
  // and the decay curve - the entire point - would vanish.
  const signupAt = NOW - 40 * DAY;
  const activeOnDay1Only = [
    evt('user_registered', signupAt, { userId: 'u1', visitorId: 'v1' }),
    evt('user_login', signupAt + 1 * DAY + 3600000, { userId: 'u1', visitorId: 'v1' }),
  ];
  const cohort = buildRetention(activeOnDay1Only, NOW).cohorts[0];
  assert.equal(cohort.horizons.d1.retained, 1);
  assert.equal(cohort.horizons.d7.retained, 0, 'day-1 activity must not count as day-7 retention');
  assert.equal(cohort.horizons.d7.matured, true, 'but D7 has elapsed, so it IS measured');
});

test('retention: no registrations is an explicit insufficient, not a zero', () => {
  const retention = buildRetention([evt('page_view', NOW, { visitorId: 'v1' })], NOW);
  assert.equal(retention.summary.d1.value, null, 'must be null, never 0 - "no data" is not "0% retention"');
  assert.equal(retention.summary.d1.confidence.level, CONFIDENCE.INSUFFICIENT);
});

// ── Channels ──────────────────────────────────────────────────────────────────

test('channels attribute on FIRST touch, not last', () => {
  // Found via TikTok, came back later by typing the URL. Last-touch would call
  // this "direct" and the operator would kill a channel that is working.
  const events = [
    evt('page_view', NOW - 3 * DAY, { visitorId: 'v1', firstTouchChannel: 'tiktok', channel: 'tiktok' }),
    evt('page_view', NOW, { visitorId: 'v1', firstTouchChannel: 'tiktok', channel: 'direct' }),
    evt('user_registered', NOW, { visitorId: 'v1', userId: 'u1', firstTouchChannel: 'tiktok' }),
  ];
  const channels = buildChannels(events);
  const tiktok = channels.find((c) => c.channel === 'tiktok');
  assert.ok(tiktok, 'tiktok must be credited');
  assert.equal(tiktok.visitors, 1);
  assert.equal(tiktok.signups, 1);
  assert.equal(channels.find((c) => c.channel === 'direct'), undefined, 'direct must NOT be credited');
});

// ── Content demand ────────────────────────────────────────────────────────────

test('content demand favours recent attention over stale volume', () => {
  // Crypto attention decays in days. 30 scans last month is yesterday's video;
  // 8 scans today is tomorrow's.
  const events = [
    ...Array.from({ length: 30 }, () => evt('token_scan', NOW - 30 * DAY, { visitorId: `old${Math.random()}`, contract: 'STALE', projectName: 'Stale', trustScore: 40 })),
    ...Array.from({ length: 8 }, () => evt('token_scan', NOW, { visitorId: `new${Math.random()}`, contract: 'HOT', projectName: 'Hot', trustScore: 30 })),
  ];
  const demand = buildContentDemand(events, NOW);
  assert.equal(demand[0].name, 'Hot', 'recent demand must outrank stale volume');
  assert.ok(demand[0].demandScore > demand[1].demandScore);
  assert.equal(demand.find((d) => d.name === 'Stale').scans, 30, 'raw count is still reported honestly');
});

test('content demand reports its own thinness', () => {
  const events = [evt('token_scan', NOW, { visitorId: 'v1', contract: 'c1', projectName: 'One' })];
  assert.equal(buildContentDemand(events, NOW)[0].confidence.level, CONFIDENCE.INSUFFICIENT);
});

// ── Conversion blockers ───────────────────────────────────────────────────────

test('conversion blockers keep the REASON a checkout died', () => {
  // 'wallet_required' (product friction) and 'missing_config' (revenue outage)
  // are wildly different problems that look identical in Google Analytics.
  const events = [
    evt('checkout_failed', NOW, { reason: 'wallet_required' }),
    evt('checkout_failed', NOW, { reason: 'wallet_required' }),
    evt('checkout_failed', NOW, { reason: 'missing_config' }),
  ];
  const blockers = buildConversionBlockers(events);
  assert.deepEqual(blockers, [
    { reason: 'wallet_required', count: 2 },
    { reason: 'missing_config', count: 1 },
  ]);
});
