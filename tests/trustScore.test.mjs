// Characterization tests for the trust scoring engine.
//
// This engine was extracted verbatim out of src/main.jsx so that Netlify
// Functions could reach it (see src/lib/trustScore.js header). At extraction
// time the move was proven byte-identical against git. That proof was a
// one-shot; THIS file is the durable replacement — it pins the engine's actual
// behaviour so a future edit that changes what a score MEANS has to do so
// deliberately, in a reviewable diff, rather than by accident.
//
// These are deliberately behavioural, not unit-trivia: each test states a
// property the product depends on, and several of them are load-bearing for
// the alert loop specifically.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateLiveScores,
  calculateManualScores,
  scoreToRisk,
  weightedAverage,
  liveDataPenalty,
  riskPenalty,
  scoreSecurity,
  scoreLiquidity,
  scoreHolders,
  isLargeVerifiedAsset,
  MAX_TRUST_SCORE_PENALTY,
} from '../src/lib/trustScore.js';

// Representative fixtures. Values pinned from the engine as extracted; a diff
// here means the meaning of a score moved.
const BLUE_CHIP = [
  { name: 'Ethereum', website: 'https://ethereum.org', twitter: 'https://x.com/ethereum', founderStatus: 'Public' },
  { coingeckoListed: true, marketCapUsd: 4e11, isNativeAsset: true, marketCapRank: 2, tokenAgeDays: 3000, volume24hUsd: 2e10 },
];
const RUG_SHAPED = [
  { name: 'SafeMoonInu', riskNotes: 'anonymous team' },
  {
    liquidityUsd: 1200, holderCount: 40, topHolderPercent: 62, topTenHolderPercent: 88,
    tokenAgeDays: 2, mintAuthorityEnabled: true, freezeAuthorityEnabled: true, volume24hUsd: 500,
  },
];
const HEALTHY_MIDCAP = [
  { name: 'Jupiter', website: 'https://jup.ag', twitter: 'https://x.com/jupiter', telegram: 'https://t.me/j' },
  {
    coingeckoListed: true, marketCapUsd: 8e8, liquidityUsd: 5e6, holderCount: 600000,
    topHolderPercent: 4, topTenHolderPercent: 22, tokenAgeDays: 700, volume24hUsd: 3e7,
  },
];

// ── The engine is importable outside a browser ────────────────────────────────

test('the engine runs in plain Node with no browser globals', () => {
  // THE point of the extraction. If this file can be imported by the test
  // runner, a Netlify Function can import it too — which is what makes
  // server-side re-scanning (and therefore the alert loop) possible at all.
  // A regression here silently re-breaks retention.
  assert.equal(typeof calculateLiveScores, 'function');
  assert.doesNotThrow(() => calculateLiveScores({}, {}));
});

// ── Determinism: load-bearing for alerts ──────────────────────────────────────

test('the same inputs always produce the same score', () => {
  // alerts-run decides "this token got riskier" by comparing two scores taken
  // at different times. If the engine were non-deterministic, that comparison
  // would fire alerts at random — and every one would be a lie told by a
  // product whose only asset is trust.
  const [project, data] = HEALTHY_MIDCAP;
  const first = calculateLiveScores(project, data).finalTrustScore;
  for (let i = 0; i < 25; i += 1) {
    assert.equal(calculateLiveScores(project, data).finalTrustScore, first);
  }
});

test('scoring does not mutate its inputs', () => {
  // The re-scan worker will score many tokens in a loop over shared objects.
  // Mutation would leak state between tokens and corrupt scores.
  const project = { name: 'X', website: 'https://x.io' };
  const data = { liquidityUsd: 50000, holderCount: 900 };
  const projectCopy = structuredClone(project);
  const dataCopy = structuredClone(data);
  calculateLiveScores(project, data);
  assert.deepEqual(project, projectCopy);
  assert.deepEqual(data, dataCopy);
});

// ── Golden scenarios ──────────────────────────────────────────────────────────

test('a blue-chip native asset scores Low risk', () => {
  const score = calculateLiveScores(...BLUE_CHIP).finalTrustScore;
  assert.equal(score, 82);
  assert.equal(scoreToRisk(score), 'Low');
});

test('a rug-shaped token bottoms out at High risk', () => {
  // Tiny liquidity + 62% top holder + 2 days old + mint AND freeze authority
  // live. If this ever stops reading High, the engine is broken in the only
  // direction that actually costs a user money.
  const score = calculateLiveScores(...RUG_SHAPED).finalTrustScore;
  assert.equal(score, 5);
  assert.equal(scoreToRisk(score), 'High');
});

test('a healthy mid-cap scores Low risk', () => {
  const score = calculateLiveScores(...HEALTHY_MIDCAP).finalTrustScore;
  assert.equal(score, 91);
  assert.equal(scoreToRisk(score), 'Low');
});

// ── Absence is not zero ───────────────────────────────────────────────────────

test('unavailable signals score null, never 0', () => {
  // A missing metric is an UNKNOWN, not a bad value. Scoring it 0 would let a
  // provider outage masquerade as a risk finding. The nulls are what
  // weightedAverage() drops rather than averages in.
  const scores = calculateLiveScores({ name: 'Unknown' }, {});
  for (const key of ['liquidityScore', 'topHolderScore', 'securityScore', 'marketCapScore', 'tokenAgeScore']) {
    assert.equal(scores[key], null, `${key} must be null when its input is absent`);
  }
});

test('weightedAverage ignores nulls rather than treating them as zero', () => {
  assert.equal(weightedAverage([[90, 10], [null, 90]]), 90, 'a null must not drag the average down');
  assert.equal(weightedAverage([[null, 5]]), 5, 'nothing known at all falls back to the floor, not 0');
});

// ── HAZARD: partial data looks like risk ──────────────────────────────────────

test('DANGER: a token with no data scores lower than the same token with good data', () => {
  // This is not a bug to fix here — it is the correct fail-safe posture for a
  // security product, and it is pinned so nobody "fixes" it casually.
  //
  // But it is a TRAP for the re-scan worker: if a provider times out mid-scan,
  // the very same token scores 91 one hour and 19 the next, and a naive
  // alerts-run would email "your token got riskier" when nothing happened but a
  // failed HTTP call. The worker must therefore never write a snapshot from a
  // partial fetch — absence of data must be handled as "no observation", never
  // as an observation of risk. See netlify/functions/_rescanEngine.mjs.
  // alerts-run.mjs SCORE_DROP_THRESHOLD is 10 points.
  const ALERT_THRESHOLD = 10;

  const withData = calculateLiveScores(...HEALTHY_MIDCAP).finalTrustScore;
  // Same token, same profile — only the market/on-chain providers went quiet.
  const providersDown = calculateLiveScores(HEALTHY_MIDCAP[0], {}).finalTrustScore;
  // And with nothing known at all.
  const nothingKnown = calculateLiveScores({}, {}).finalTrustScore;

  assert.equal(withData, 91);
  assert.equal(providersDown, 72, 'profile signals hold the score up; market signals go null');
  assert.equal(nothingKnown, 19, 'no profile and no data reads as High risk — fail-safe, by design');

  assert.ok(
    withData - providersDown > ALERT_THRESHOLD,
    `a provider outage alone moves the score ${withData - providersDown} pts — past the ${ALERT_THRESHOLD}pt alert threshold. `
    + 'The re-scan worker MUST NOT write a snapshot from a partial fetch.',
  );
});

// ── Floors, caps and boundaries ───────────────────────────────────────────────

test('a large verified asset never reads below the confidence floor', () => {
  // BTC/ETH/USDC have no "liquidity pool" or holder count the way a DEX token
  // does. Missing that data is not evidence of risk for them, so a verified
  // floor keeps a top asset from reading "High risk" because one provider was
  // quiet.
  const data = { coingeckoListed: true, marketCapUsd: 5e10 };
  assert.equal(isLargeVerifiedAsset(data), true);
  assert.ok(calculateLiveScores({ name: 'USDC' }, data).finalTrustScore >= 70);
});

test('the total penalty is capped so profile quality always still counts', () => {
  const notes = 'anonymous, no roadmap, mint authority enabled, freeze authority enabled, upgradeable contract';
  assert.ok(riskPenalty(notes) > MAX_TRUST_SCORE_PENALTY, 'raw penalties exceed the cap');
  // The cap is applied inside the engine, so even a maximally-bad note set
  // cannot drive a well-documented project to the floor on notes alone.
  const scored = calculateLiveScores(
    { name: 'X', website: 'https://x.io', twitter: 'https://x.com/x', founderStatus: 'Public', description: 'A real project', riskNotes: notes },
    { coingeckoListed: true, marketCapUsd: 2e6, liquidityUsd: 3e5, holderCount: 5000, topHolderPercent: 8, topTenHolderPercent: 30, tokenAgeDays: 400 },
  ).finalTrustScore;
  assert.ok(scored > 5, 'a documented project is never fully cancelled out by notes');
});

test('the score floor is 5 and the ceiling is 100', () => {
  assert.ok(calculateLiveScores(...RUG_SHAPED).finalTrustScore >= 5);
  assert.ok(calculateLiveScores(...HEALTHY_MIDCAP).finalTrustScore <= 100);
});

test('risk bands sit exactly at 78 and 55', () => {
  // These two numbers are the difference between a user being warned and not.
  assert.equal(scoreToRisk(78), 'Low');
  assert.equal(scoreToRisk(77), 'Medium');
  assert.equal(scoreToRisk(55), 'Medium');
  assert.equal(scoreToRisk(54), 'High');
});

// ── Individual signals worth pinning ──────────────────────────────────────────

test('security scoring counts live authorities, and unknown stays unknown', () => {
  assert.equal(scoreSecurity(false, false, false), 92, 'nothing enabled is the good case');
  assert.equal(scoreSecurity(true, false, false), 52, 'one live authority is a real downgrade');
  assert.equal(scoreSecurity(true, true, false), 18, 'two is close to the floor');
  assert.equal(scoreSecurity(null, null, null), null, 'unknown authorities must not score as safe');
});

test('liquidity and holder scores return null at zero rather than a bad score', () => {
  // "No liquidity data" and "zero liquidity" are different claims; the engine
  // must not conflate them.
  assert.equal(scoreLiquidity(0), null);
  assert.equal(scoreHolders(0), null);
  assert.equal(scoreLiquidity(1e6), 95);
  assert.equal(scoreHolders(10000), 95);
});

test('liveDataPenalty punishes thin liquidity but exempts large verified assets', () => {
  assert.ok(liveDataPenalty({ liquidityUsd: 1000 }, 50) > 0);
  assert.equal(liveDataPenalty({ coingeckoListed: true, marketCapUsd: 1e11 }, 0), 0, 'a top asset is not penalised for absent DEX data');
});

// ── Manual scoring ────────────────────────────────────────────────────────────

test('manual scoring works without any live data', () => {
  // Projects with no on-chain presence yet (Early Stage) are scored on profile
  // alone; this path must not require a data object at all.
  const score = calculateManualScores({
    name: 'Preview', website: 'https://p.io', twitter: 'https://x.com/p',
    founderStatus: 'Public', roadmapText: 'Q1 launch',
  }).finalTrustScore;
  assert.ok(score >= 5 && score <= 100);
});
