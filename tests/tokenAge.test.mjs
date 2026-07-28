// Locks in the age-resolution hierarchy that the Trust Score's maturity model
// depends on. The regression this suite exists to prevent is the production
// one: BONK and WIF reporting "age unavailable" and being scored as brand-new
// tokens because the only two configured sources are structurally unavailable
// for almost every SPL token.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGE_CONFIDENCE,
  resolveTokenAge,
  isUsableTimestamp,
  exactLaunchDate,
} from '../src/lib/tokenAge.js';

const NOW = Date.parse('2026-07-28T12:00:00Z');
const daysAgo = (n) => NOW - n * 24 * 60 * 60 * 1000;

test('resolveTokenAge: prefers CoinGecko genesis over every other source', () => {
  const age = resolveTokenAge({
    coingeckoGenesisDate: '2022-12-25',
    mintCreatedAt: daysAgo(10),
    oldestPairCreatedAt: daysAgo(5),
  }, NOW);
  assert.equal(age.source, 'coingeckoGenesis');
  assert.equal(age.confidence, AGE_CONFIDENCE.EXACT);
  assert.equal(age.isLowerBound, false);
  assert.ok(age.tokenAgeDays > 1300);
});

test('resolveTokenAge: falls back to the mint genesis transaction', () => {
  const age = resolveTokenAge({ mintCreatedAt: daysAgo(400), oldestPairCreatedAt: daysAgo(5) }, NOW);
  assert.equal(age.source, 'mintGenesis');
  assert.equal(age.tokenAgeDays, 400);
  assert.equal(age.confidence, AGE_CONFIDENCE.EXACT);
});

test('resolveTokenAge: falls back to the EVM explorer contract creation', () => {
  const age = resolveTokenAge({ explorerCreatedAt: daysAgo(900), oldestPairCreatedAt: daysAgo(5) }, NOW);
  assert.equal(age.source, 'explorerGenesis');
  assert.equal(age.tokenAgeDays, 900);
});

// THE FIX. This is the case that was returning null in production.
test('resolveTokenAge: uses the oldest DEX pair as a LOWER BOUND when nothing else resolves', () => {
  const age = resolveTokenAge({
    coingeckoGenesisDate: null,
    mintCreatedAt: null,
    oldestPairCreatedAt: daysAgo(1310), // BONK's real pool age, roughly
  }, NOW);
  assert.equal(age.source, 'dexPair');
  assert.equal(age.tokenAgeDays, 1310);
  assert.equal(age.confidence, AGE_CONFIDENCE.LOWER_BOUND);
  assert.equal(age.isLowerBound, true);
});

test('resolveTokenAge: returns a stable all-null shape when no source resolves', () => {
  const age = resolveTokenAge({}, NOW);
  assert.equal(age.tokenAgeDays, null);
  assert.equal(age.createdAt, null);
  assert.equal(age.source, null);
  assert.equal(age.isLowerBound, false);
});

test('isUsableTimestamp: rejects the "unknown means epoch 0" trap', () => {
  // A provider returning 0/null for "unknown" must never resolve to 1970 —
  // that would present the least-known token as the oldest one in existence.
  assert.equal(isUsableTimestamp(0, NOW), false);
  assert.equal(isUsableTimestamp(null, NOW), false);
  assert.equal(isUsableTimestamp(undefined, NOW), false);
  assert.equal(isUsableTimestamp(NaN, NOW), false);
  assert.equal(isUsableTimestamp('not a date', NOW), false);
});

test('isUsableTimestamp: rejects future timestamps beyond clock-skew tolerance', () => {
  assert.equal(isUsableTimestamp(NOW + 10 * 24 * 60 * 60 * 1000, NOW), false);
  assert.equal(isUsableTimestamp(NOW - 1000, NOW), true);
});

test('resolveTokenAge: skips an unusable higher-priority source and uses the next', () => {
  const age = resolveTokenAge({
    coingeckoGenesisDate: 0,            // "unknown" sentinel, must be skipped
    mintCreatedAt: null,
    oldestPairCreatedAt: daysAgo(200),
  }, NOW);
  assert.equal(age.source, 'dexPair');
  assert.equal(age.tokenAgeDays, 200);
});

test('resolveTokenAge: age is never negative', () => {
  const age = resolveTokenAge({ mintCreatedAt: NOW - 1000 }, NOW);
  assert.ok(age.tokenAgeDays >= 0);
});

test('exactLaunchDate: only an EXACT source may be presented as a launch date', () => {
  const exact = resolveTokenAge({ coingeckoGenesisDate: '2022-12-25' }, NOW);
  assert.equal(exactLaunchDate(exact), '2022-12-25');

  const bound = resolveTokenAge({ oldestPairCreatedAt: daysAgo(1310) }, NOW);
  assert.equal(exactLaunchDate(bound), '', 'a lower bound must never be shown as the launch date');

  assert.equal(exactLaunchDate(null), '');
});
