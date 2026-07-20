// Continuous Watch — tier cadence and due-selection.
//
// The theme: a tier may change HOW OFTEN we look and how often we tell, and
// nothing else. It may never change what counts as a valid observation, and it
// may never cause an alert to be lost rather than delayed.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TIER,
  OBSERVE_INTERVAL_MS,
  NOTIFY_INTERVAL_MS,
  MAX_WATCHED_TOKENS,
  bestTier,
  isDue,
  isNotifyDue,
} from '../netlify/functions/_watchTiers.mjs';
import { distinctWatchedTokens, selectDueTokens } from '../netlify/functions/_rescanEngine.mjs';

const NOW = Date.parse('2026-07-20T12:00:00.000Z');
const ago = (ms) => new Date(NOW - ms).toISOString();

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

// ── Cadence ──────────────────────────────────────────────────────────────────

test('premium observes every 30 minutes, free every 12 hours', () => {
  assert.equal(OBSERVE_INTERVAL_MS[TIER.PREMIUM], 30 * MIN);
  assert.equal(OBSERVE_INTERVAL_MS[TIER.FREE], 12 * HOUR);
  assert.equal(NOTIFY_INTERVAL_MS[TIER.PREMIUM], 30 * MIN);
  assert.equal(NOTIFY_INTERVAL_MS[TIER.FREE], 12 * HOUR);
});

test('a never-observed token is always due', () => {
  // Absence is "never looked at", not "recently looked at". Getting this wrong
  // means a newly watched token is never picked up at all.
  assert.equal(isDue(null, TIER.FREE, NOW), true);
  assert.equal(isDue(undefined, TIER.PREMIUM, NOW), true);
  assert.equal(isDue('not-a-date', TIER.FREE, NOW), true);
});

test('a premium token is due after 30 minutes, a free one is not', () => {
  const thirtyOneMinAgo = ago(31 * MIN);
  assert.equal(isDue(thirtyOneMinAgo, TIER.PREMIUM, NOW), true);
  assert.equal(isDue(thirtyOneMinAgo, TIER.FREE, NOW), false);
});

test('a free token becomes due after 12 hours', () => {
  assert.equal(isDue(ago(11 * HOUR), TIER.FREE, NOW), false);
  assert.equal(isDue(ago(13 * HOUR), TIER.FREE, NOW), true);
});

test('cron jitter a few seconds early does not slip the whole cycle', () => {
  // Without the slack, a run firing seconds early leaves every token one second
  // short of due and the cadence silently halves.
  assert.equal(isDue(ago(30 * MIN - 5000), TIER.PREMIUM, NOW), true);
});

// ── Observation is a token property, notification is a user property ─────────

test('a token watched by any premium user gets the premium cadence', () => {
  assert.equal(bestTier([TIER.FREE, TIER.FREE, TIER.PREMIUM]), TIER.PREMIUM);
  assert.equal(bestTier([TIER.FREE, TIER.FREE]), TIER.FREE);
  assert.equal(bestTier([]), TIER.FREE);
});

test('distinctWatchedTokens dedupes and upgrades the tier across watchers', () => {
  const subscriptions = [
    { userId: 'free1', tokens: [{ identity: 'c:bonk', contract: 'B', chain: 'solana' }] },
    { userId: 'prem1', tokens: [{ identity: 'c:bonk', contract: 'B', chain: 'solana' }] },
    { userId: 'free2', tokens: [{ identity: 'c:other', contract: 'O', chain: 'solana' }] },
  ];
  const tiers = { free1: TIER.FREE, prem1: TIER.PREMIUM, free2: TIER.FREE };
  const tokens = distinctWatchedTokens(subscriptions, tiers);

  // Ten users watching BONK is still ONE re-scan — the property that keeps this
  // affordable must survive tiering.
  assert.equal(tokens.length, 2);
  assert.equal(tokens.find((t) => t.identity === 'c:bonk').tier, TIER.PREMIUM);
  assert.equal(tokens.find((t) => t.identity === 'c:other').tier, TIER.FREE);
});

test('tier upgrade works regardless of which watcher is seen first', () => {
  const premiumFirst = distinctWatchedTokens(
    [
      { userId: 'p', tokens: [{ identity: 'c:x' }] },
      { userId: 'f', tokens: [{ identity: 'c:x' }] },
    ],
    { p: TIER.PREMIUM, f: TIER.FREE }
  );
  assert.equal(premiumFirst[0].tier, TIER.PREMIUM);
});

test('called without tiers, distinctWatchedTokens behaves as before', () => {
  // The pre-tier call signature is still used by any caller that does not care
  // about cadence; it must not start stamping a tier.
  const tokens = distinctWatchedTokens([{ userId: 'a', tokens: [{ identity: 'c:x' }] }]);
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].tier, undefined);
});

// ── Due selection ────────────────────────────────────────────────────────────

test('only due tokens are re-scanned', () => {
  const tokens = [
    { identity: 'c:prem', tier: TIER.PREMIUM },
    { identity: 'c:free', tier: TIER.FREE },
  ];
  const snapshots = {
    'c:prem': { observedAt: ago(45 * MIN) },  // due (>30m)
    'c:free': { observedAt: ago(45 * MIN) },  // not due (<12h)
  };
  const { dueTokens, skipped } = selectDueTokens(tokens, snapshots, { now: NOW });
  assert.deepEqual(dueTokens.map((t) => t.identity), ['c:prem']);
  assert.equal(skipped, 1);
});

test('the most overdue are served first when the run is capped', () => {
  const tokens = [
    { identity: 'c:a', tier: TIER.PREMIUM },
    { identity: 'c:b', tier: TIER.PREMIUM },
    { identity: 'c:c', tier: TIER.PREMIUM },
  ];
  const snapshots = {
    'c:a': { observedAt: ago(1 * HOUR) },
    'c:b': { observedAt: ago(5 * HOUR) },   // most overdue
    'c:c': { observedAt: ago(2 * HOUR) },
  };
  const { dueTokens, deferred } = selectDueTokens(tokens, snapshots, { now: NOW, maxPerRun: 2 });
  assert.deepEqual(dueTokens.map((t) => t.identity), ['c:b', 'c:c']);
  // Deferred, never dropped — 'c:a' is picked up next run, still in order.
  assert.equal(deferred, 1);
});

test('a never-observed token outranks every observed one', () => {
  const tokens = [
    { identity: 'c:old', tier: TIER.PREMIUM },
    { identity: 'c:new', tier: TIER.PREMIUM },
  ];
  const snapshots = { 'c:old': { observedAt: ago(48 * HOUR) } }; // c:new has none
  const { dueTokens } = selectDueTokens(tokens, snapshots, { now: NOW, maxPerRun: 1 });
  assert.deepEqual(dueTokens.map((t) => t.identity), ['c:new']);
});

// ── Notification cadence ─────────────────────────────────────────────────────

test('a user never notified is immediately due', () => {
  assert.equal(isNotifyDue(null, TIER.FREE, NOW), true);
});

test('a free user is not re-notified within 12 hours, a premium user is after 30m', () => {
  const oneHourAgo = ago(1 * HOUR);
  assert.equal(isNotifyDue(oneHourAgo, TIER.PREMIUM, NOW), true);
  assert.equal(isNotifyDue(oneHourAgo, TIER.FREE, NOW), false);
});

// ── Caps ─────────────────────────────────────────────────────────────────────

test('free watches 5 tokens, premium 100', () => {
  assert.equal(MAX_WATCHED_TOKENS[TIER.FREE], 5);
  assert.equal(MAX_WATCHED_TOKENS[TIER.PREMIUM], 100);
});
