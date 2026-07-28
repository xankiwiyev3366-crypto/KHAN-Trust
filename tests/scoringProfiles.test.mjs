// END-TO-END scoring validation across the full range of tokens the product is
// asked about, through the REAL pipeline (normalizeProject -> trust score ->
// asset-type ceiling -> verdict resolver), not through the scoring engine's
// internals.
//
// This is the acceptance test for the credibility fix. Before it, every
// memecoin in this file — from a minutes-old rug to BONK — produced exactly
// 35/100 "High Risk". The properties asserted here are the ones a user would
// notice immediately and that no unit test was checking:
//
//   1. the scores are ORDERED (a rug ranks below a young token ranks below a
//      mature one), and
//   2. the headline verdict never contradicts the evidence shown beneath it.
//
// Fixture numbers are the real, observed values from live scans where the token
// exists (BONK and WIF were captured from production on 2026-07-28).
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProject } from '../src/tokenLogic/project.js';
import { riskFactors } from '../src/tokenLogic/riskModel.js';

const DAY = 24 * 60 * 60 * 1000;

// Builds the shape a live Solana lookup hands normalizeProject.
function scan({ name, ticker, ageDays, ...data }) {
  return normalizeProject({
    name,
    ticker,
    chain: 'Solana',
    chainId: 'solana',
    contract: `fixture-${ticker}`,
    website: data.websiteUrl || 'Not provided',
    twitter: data.twitterUrl || 'Not provided',
    telegram: data.telegramUrl || 'Not provided',
    realData: {
      source: 'test fixture',
      tokenAgeDays: ageDays ?? null,
      fetchedAt: new Date().toISOString(),
      socialMetadataAvailable: true,
      ...data,
    },
  });
}

// ── The seven required profiles ──────────────────────────────────────────────

const BONK = scan({
  name: 'Bonk', ticker: 'BONK', ageDays: 1310,
  totalLiquidityUsd: 700_770, liquidityUsd: 700_770, marketCapUsd: 256_773_293,
  holderCount: 1_007_128, topHolderPercent: 7.68, topTenHolderPercent: 37.76,
  mintAuthorityEnabled: false, freezeAuthorityEnabled: false, upgradeable: false,
  volume24hUsd: 29_042_572, poolCount: 30, coingeckoListed: true,
  websiteUrl: 'https://www.bonkcoin.com', twitterUrl: 'https://twitter.com/bonk_inu',
  telegramUrl: 'https://t.me/Official_Bonk_Inu', priceUsd: 0.00000292,
  priceChange24h: -2.17, priceChange1h: 0.14, supply: 87_994_600_764_073,
});

const WIF = scan({
  name: 'dogwifhat', ticker: 'WIF', ageDays: 1000,
  totalLiquidityUsd: 4_262_971, liquidityUsd: 4_262_971, marketCapUsd: 147_645_832,
  holderCount: 255_577, topHolderPercent: 13.72, topTenHolderPercent: 42.0,
  mintAuthorityEnabled: false, freezeAuthorityEnabled: false, upgradeable: false,
  volume24hUsd: 12_000_000, poolCount: 18, coingeckoListed: true,
  websiteUrl: 'https://dogwifcoin.org', twitterUrl: 'https://twitter.com/dogwifcoin',
  priceUsd: 0.147, priceChange24h: -1.2, priceChange1h: 0.3, supply: 998_926_392,
});

// Large non-memecoin: an established Layer 1 with real utility.
const LAYER1 = scan({
  name: 'Solana', ticker: 'SOL', ageDays: 2100,
  totalLiquidityUsd: 400_000_000, liquidityUsd: 400_000_000, marketCapUsd: 90_000_000_000,
  holderCount: 5_000_000, topHolderPercent: 3.1, topTenHolderPercent: 18.0,
  mintAuthorityEnabled: false, freezeAuthorityEnabled: false, upgradeable: false,
  volume24hUsd: 2_000_000_000, poolCount: 120, coingeckoListed: true,
  websiteUrl: 'https://solana.com', twitterUrl: 'https://twitter.com/solana',
  githubUrl: 'https://github.com/solana-labs', telegramUrl: 'https://t.me/solana',
  priceUsd: 180, priceChange24h: 1.4, priceChange1h: 0.2, supply: 500_000_000,
});

// Mid-cap utility token: real product, less proven than a top L1.
const MIDCAP = scan({
  name: 'Jupiter Exchange', ticker: 'JUP', ageDays: 700,
  totalLiquidityUsd: 25_000_000, liquidityUsd: 25_000_000, marketCapUsd: 900_000_000,
  holderCount: 700_000, topHolderPercent: 6.2, topTenHolderPercent: 28.0,
  mintAuthorityEnabled: false, freezeAuthorityEnabled: false, upgradeable: false,
  volume24hUsd: 60_000_000, poolCount: 40, coingeckoListed: true,
  websiteUrl: 'https://jup.ag', twitterUrl: 'https://twitter.com/JupiterExchange',
  githubUrl: 'https://github.com/jup-ag', priceUsd: 0.9,
  priceChange24h: 2.0, priceChange1h: 0.1, supply: 1_000_000_000,
});

// Newly launched but not obviously malicious: authorities revoked, thin but
// real liquidity, small holder base, days old.
const NEWLY_LAUNCHED = scan({
  name: 'New Dog Coin', ticker: 'NEWDOG', ageDays: 4,
  totalLiquidityUsd: 85_000, liquidityUsd: 85_000, marketCapUsd: 1_200_000,
  holderCount: 900, topHolderPercent: 12.0, topTenHolderPercent: 44.0,
  mintAuthorityEnabled: false, freezeAuthorityEnabled: false, upgradeable: false,
  volume24hUsd: 210_000, poolCount: 2, coingeckoListed: false,
  twitterUrl: 'https://twitter.com/newdogcoin', priceUsd: 0.0012,
  priceChange24h: 30, priceChange1h: 5, supply: 1_000_000_000,
});

// Obvious rug: minutes old, no liquidity to speak of, a handful of holders,
// deployer holds most of supply, mint AND freeze authority still live.
const RUG = scan({
  name: 'Safe Moon Inu Elon', ticker: 'SAFEMOON', ageDays: 0,
  totalLiquidityUsd: 2_800, liquidityUsd: 2_800, marketCapUsd: 42_000,
  holderCount: 14, topHolderPercent: 71.0, topTenHolderPercent: 96.0,
  mintAuthorityEnabled: true, freezeAuthorityEnabled: true, upgradeable: true,
  volume24hUsd: 190_000, poolCount: 1, coingeckoListed: false,
  priceUsd: 0.0000042, priceChange24h: 420, priceChange1h: 88, supply: 10_000_000_000,
});

// Every provider that could have said anything is unavailable.
const NO_METADATA = scan({
  name: 'Unknown Token', ticker: 'UNK', ageDays: null,
  totalLiquidityUsd: null, liquidityUsd: null, marketCapUsd: null,
  holderCount: null, topHolderPercent: null, topTenHolderPercent: null,
  mintAuthorityEnabled: null, freezeAuthorityEnabled: null, upgradeable: null,
  volume24hUsd: null, poolCount: null, coingeckoListed: false,
  socialMetadataAvailable: false,
});

const ALL = [
  ['BONK', BONK], ['WIF', WIF], ['SOL', LAYER1], ['JUP', MIDCAP],
  ['NEWDOG', NEWLY_LAUNCHED], ['RUG', RUG], ['UNK', NO_METADATA],
];

// ── Properties ───────────────────────────────────────────────────────────────

test('every profile produces a usable score and verdict', () => {
  for (const [label, p] of ALL) {
    assert.ok(Number.isFinite(p.trustScore), `${label}: score is not a number`);
    assert.ok(p.trustScore >= 0 && p.trustScore <= 100, `${label}: ${p.trustScore} out of range`);
    assert.ok(['Low', 'Medium', 'High'].includes(p.riskLevel), `${label}: bad verdict ${p.riskLevel}`);
  }
});

// THE REGRESSION. All seven previously collapsed toward one another; the
// memecoins were literally identical.
test('scores discriminate — a rug and a blue-chip memecoin are not the same number', () => {
  assert.ok(RUG.trustScore < BONK.trustScore - 20,
    `rug ${RUG.trustScore} must be far below BONK ${BONK.trustScore}`);
  assert.ok(RUG.trustScore < NEWLY_LAUNCHED.trustScore,
    `rug ${RUG.trustScore} must rank below a clean new token ${NEWLY_LAUNCHED.trustScore}`);
  assert.ok(NEWLY_LAUNCHED.trustScore < BONK.trustScore,
    `new ${NEWLY_LAUNCHED.trustScore} must rank below mature ${BONK.trustScore}`);
});

test('mature memecoins are no longer floored at the rug ceiling', () => {
  assert.ok(BONK.trustScore >= 60, `BONK scored ${BONK.trustScore}, expected >= 60`);
  assert.ok(WIF.trustScore >= 60, `WIF scored ${WIF.trustScore}, expected >= 60`);
});

test('a memecoin still never outranks real infrastructure', () => {
  assert.ok(BONK.trustScore < LAYER1.trustScore,
    `BONK ${BONK.trustScore} must stay below SOL ${LAYER1.trustScore}`);
  assert.ok(WIF.trustScore < LAYER1.trustScore);
  assert.ok(BONK.trustScore < MIDCAP.trustScore,
    `BONK ${BONK.trustScore} must stay below a real utility token ${MIDCAP.trustScore}`);
});

test('a memecoin is never presented as Low Risk, however clean', () => {
  assert.notEqual(BONK.riskLevel, 'Low');
  assert.notEqual(WIF.riskLevel, 'Low');
});

test('the obvious rug is High Risk and says so', () => {
  assert.equal(RUG.riskLevel, 'High');
  assert.ok(RUG.trustScore <= 35, `rug scored ${RUG.trustScore}`);
});

test('an unknown token is not accused — it is reported as unknown', () => {
  // No data must not manufacture a High-Risk verdict backed by nothing, but it
  // must also not be flattered. Medium-or-worse with low confidence is right.
  assert.ok(['Medium', 'High'].includes(NO_METADATA.riskLevel));
  assert.ok(NO_METADATA.confidenceScore < 40,
    `expected low confidence, got ${NO_METADATA.confidenceScore}`);
});

// THE CONSISTENCY INVARIANT. This is the property whose violation was visible
// on production: a High Risk headline over a 0/100 scam score and eight "Low"
// factors. It must hold for every profile, not just the ones we fixed.
// "Not a scam" and "not risky" are different questions, and the guard is right
// to keep them apart: a four-day-old token with 900 holders is genuinely high
// risk while being no more likely to be a scam than any other new launch. So a
// High headline is only a CONTRADICTION when the scam model is clean AND no
// medium-or-worse factor is outstanding — i.e. when the report offers the user
// nothing at all to justify the warning. That is the state BONK was in.
test('no profile contradicts itself: a High headline always has evidence behind it', () => {
  for (const [label, p] of ALL) {
    if (p.riskLevel !== 'High') continue;
    const scamIsClean = p.scamRisk?.level === 'Low' && Number(p.scamRisk?.riskScore || 0) === 0;
    if (!scamIsClean) continue;
    const factors = riskFactors({ ...p, holders: p.holders, communitySize: p.communitySize });
    const supporting = factors.filter((f) => f.severity === 'High' || f.severity === 'Medium');
    assert.ok(supporting.length > 0,
      `${label}: High Risk headline with a clean scam verdict and no medium-or-high factor to justify it`);
  }
});

test('a new-but-clean token is High Risk for a stated reason, not by default', () => {
  assert.equal(NEWLY_LAUNCHED.riskLevel, 'High');
  const factors = riskFactors({ ...NEWLY_LAUNCHED, holders: 900, communitySize: 900 });
  const high = factors.filter((f) => f.severity === 'High');
  assert.ok(high.length > 0, 'the High verdict must be backed by a High-severity factor');
  // And that reason must be its age, not an unexplained floor.
  assert.ok(high.some((f) => /age/i.test(f.title)), `expected an age factor, got ${high.map((f) => f.title).join(', ')}`);
});

test('no profile contradicts itself: a High scam verdict never carries a Low headline', () => {
  for (const [label, p] of ALL) {
    if (p.scamRisk?.level !== 'High') continue;
    assert.notEqual(p.riskLevel, 'Low', `${label}: High scam risk under a Low headline`);
  }
});

test('category scores and the headline point the same way', () => {
  // A token whose every category scores well must not carry a High headline.
  for (const [label, p] of ALL) {
    const categories = (p.categoryBreakdown || []).filter((c) => typeof c.score === 'number');
    if (categories.length < 3) continue;
    const allStrong = categories.every((c) => c.score >= 60);
    if (!allStrong) continue;
    assert.notEqual(p.riskLevel, 'High',
      `${label}: every category scored >= 60/100 yet the headline says High Risk`);
  }
});

test('an adjusted verdict always carries a stated reason', () => {
  for (const [label, p] of ALL) {
    if (!p.verdictAdjustment) continue;
    assert.ok(p.verdictAdjustment.reason, `${label}: adjusted verdict with no reason`);
    assert.ok(p.verdictAdjustment.from && p.verdictAdjustment.to, `${label}: incomplete adjustment record`);
  }
});
