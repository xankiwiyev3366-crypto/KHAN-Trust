// The reasoning layer — the evidence the analyst reads instead of a flat blob.
//
// These guard the three additions that turn "describe the metrics" into
// "explain the verdict": score drivers (why the score), conflict detection
// (where the evidence disagrees), and the enriched, still-grounded facts. The
// fixtures are three deliberately different risk profiles — a seasoned
// blue-chip-ish DeFi token, a wash-shaped new launch, and a concentrated
// established token — so a change that flattens the analysis fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeScoreDrivers, LIVE_SCORE_WEIGHTS, calculateLiveScores } from '../src/lib/trustScore.js';
import {
  detectSignalConflicts, runRiskAnalysis,
  rankEvidence, weightForEvidenceKey, EVIDENCE_WEIGHTS,
} from '../src/scoringEngine.js';
import { buildFacts } from '../netlify/functions/_groundedAnalyst.mjs';
import { rejectFabricatedFindings } from '../netlify/functions/_aiValidator.mjs';

// ── computeScoreDrivers: the "why" behind a number ───────────────────────────

test('score drivers name what dragged a score down and what held it up', () => {
  // Heavy concentration (topHolderScore low, weight 18) should dominate the
  // downside; a long track record (tokenAgeScore high, weight 10) the upside.
  const breakdown = {
    topHolderScore: 12,      // 18 * (12-50) = -684  → biggest drag
    liquidityScore: 84,      // 16 * (84-50) = +544  → biggest lift
    tokenAgeScore: 95,       // 10 * (95-50) = +450
    marketCapScore: 42,      //  6 * (42-50) =  -48
    githubScore: null,       // unobserved — must be omitted, not treated as 0
  };
  const { positives, negatives } = computeScoreDrivers(breakdown);

  assert.equal(negatives[0].key, 'topHolderScore', 'the heaviest downward mover leads the negatives');
  assert.equal(positives[0].key, 'liquidityScore', 'the heaviest upward mover leads the positives');
  assert.ok(negatives[0].label.includes('concentration'));
  // A null signal is evidence-absent, never a contributor.
  assert.ok(![...positives, ...negatives].some((d) => d.key === 'githubScore'));
});

test('a signal sitting exactly at neutral is not a driver in either direction', () => {
  const { positives, negatives } = computeScoreDrivers({ liquidityScore: 50 });
  assert.equal(positives.length, 0);
  assert.equal(negatives.length, 0);
});

test('every weighted signal has a human label, so no driver renders as a raw key', () => {
  // If a signal is ever added to the weights without a label, the analyst would
  // surface a bare code like "topTenHolderScore" to a reader.
  const breakdown = Object.fromEntries(LIVE_SCORE_WEIGHTS.map(([key]) => [key, 90]));
  const { positives } = computeScoreDrivers(breakdown, { limit: 100 });
  for (const driver of positives) {
    assert.notEqual(driver.label, driver.key, `${driver.key} needs a plain-language label`);
  }
});

test('the drivers table is the same one that computes the score (no drift)', () => {
  // The weights used to explain the score must be the weights used to make it.
  const project = { realData: {} };
  const data = { marketCapUsd: 5_000_000, totalLiquidityUsd: 400_000, holderCount: 8000, topHolderPercent: 12, topTenHolderPercent: 30, tokenAgeDays: 400 };
  const scores = calculateLiveScores(project, data);
  assert.ok(Number.isInteger(scores.finalTrustScore));
  // computeScoreDrivers reads scoreBreakdown-shaped input; feeding it the same
  // scores must produce drivers without throwing and without inventing keys.
  const { positives, negatives } = computeScoreDrivers(scores);
  for (const d of [...positives, ...negatives]) {
    assert.ok(LIVE_SCORE_WEIGHTS.some(([key]) => key === d.key), `${d.key} must be a real weighted signal`);
  }
});

// ── detectSignalConflicts: where the evidence disagrees ──────────────────────

test('deep liquidity under a dominant wallet is flagged as a governing conflict', () => {
  const conflicts = detectSignalConflicts(
    {},
    { totalLiquidityUsd: 2_000_000, marketCapUsd: 8_000_000, poolCount: 4, topHolderPercent: 41 },
    { liquidityQualityScore: 85 },
  );
  const conflict = conflicts.find((c) => c.key === 'deepLiquidityVsConcentration');
  assert.ok(conflict, 'a deep pool held up by one wallet is a real conflict');
  assert.equal(conflict.severity, 'high');
  assert.ok(conflict.text.includes('41.0%'), 'the conflict cites the actual concentration figure');
});

test('an established token with a live mint authority is flagged as anomalous', () => {
  const conflicts = detectSignalConflicts(
    {},
    { tokenAgeDays: 800, mintAuthorityEnabled: true, freezeAuthorityEnabled: false },
    {},
  );
  assert.ok(conflicts.some((c) => c.key === 'establishedVsLiveAuthority'));
});

test('conflicts never fire on missing data — no observation, no tension', () => {
  // Every field null: a generic engine might still "warn"; this one stays quiet.
  const conflicts = detectSignalConflicts({}, {}, {});
  assert.equal(conflicts.length, 0);
});

test('a healthy, consistent token surfaces no manufactured conflict', () => {
  const conflicts = detectSignalConflicts(
    {},
    { totalLiquidityUsd: 1_000_000, marketCapUsd: 5_000_000, poolCount: 5, topHolderPercent: 8, topTenHolderPercent: 24, tokenAgeDays: 900, holderCount: 20000, mintAuthorityEnabled: false, freezeAuthorityEnabled: false },
    { liquidityQualityScore: 90, volumeConsistencyScore: 88, volatilityScore: 80 },
  );
  assert.equal(conflicts.length, 0, 'no drama where the data agrees');
});

// ── The enriched facts stay grounded ─────────────────────────────────────────

// A concentrated but established token — the kind where the "why" matters most.
const concentrated = {
  name: 'Vault', ticker: 'VLT', chain: 'ethereum', assetCategory: 'DeFi',
  trustScore: 48, riskLevel: 'High', confidenceScore: 70, confidenceLabel: 'medium',
  realData: {
    marketCapUsd: 6_000_000, totalLiquidityUsd: 90_000, volume24hUsd: 2_700_000,
    poolCount: 1, holderCount: 5200, topHolderPercent: 44.0, topTenHolderPercent: 72.0,
    tokenAgeDays: 500, mintAuthorityEnabled: true, freezeAuthorityEnabled: false,
  },
  positiveSignals: ['Project has traded for over a year'],
  hiddenRiskSignals: ['Top 10 wallets hold a large majority of supply', 'Liquidity is shallow relative to market cap'],
  hiddenRiskSignalKeys: ['topTenCentralization', 'shallowLiquidity'],
  missingDataFields: ['githubUrl'],
  scoreBreakdown: { topHolderScore: 12, topTenHolderScore: 10, liquidityScore: 40, tokenAgeScore: 95, securityScore: 52 },
  assetTypeRiskModifier: { label: 'Utility / DeFi asset', cap: 85, rawScore: 48, adjustedScore: 48, capApplied: false, isSpeculative: false },
};

test('buildFacts exposes the interpreted reasoning layers', () => {
  const facts = buildFacts(concentrated);
  assert.equal(facts.deepReads.liquidityQuality, 'very thin'); // 90k liquidity on a 6M cap
  assert.ok(facts.scoreDrivers.pushedDown.includes('largest-holder concentration'));
  assert.ok(facts.scoreDrivers.heldUp.includes('token age / track record'));
  assert.ok(facts.signalConflicts.length >= 1, 'the concentration/authority tension is surfaced');
  assert.equal(facts.assetTypeCap.cap, 85);
  // Ranked most-severe first: the high-severity concentration outranks the
  // medium shallow-liquidity note.
  assert.equal(facts.rankedRiskSignals[0].severity, 'high');
});

test('the enrichment adds only reader-meaningful numbers, not internal sub-scores', () => {
  // The volume/liquidity ratio and cap ARE meaningful and citable; an internal
  // 0-100 deep score is NOT a number the model should ever see or cite.
  const facts = buildFacts(concentrated);
  const flat = JSON.stringify(facts);
  // volumeToLiquidityRatio = 2,700,000 / 90,000 = 30
  assert.equal(facts.volumeToLiquidityRatio, 30);
  // The qualitative reads must be words, never the raw scores.
  assert.equal(typeof facts.deepReads.volumeVsLiquidity, 'string');
  assert.ok(!flat.includes('liquidityQualityScore'), 'raw deep-score keys must not leak into facts');
});

test('a fabricated benchmark is still rejected despite the richer facts', () => {
  // The whole point of keeping internal numbers out: enrichment must not widen
  // the fabrication gap. An invented "industry average" stays caught.
  const facts = buildFacts(concentrated);
  const { kept, rejected } = rejectFabricatedFindings(
    [{ field: 'conclusion', text: 'Its 44% concentration is typical of the 61% seen across peers.' }],
    facts,
    ['text'],
  );
  assert.equal(kept.length, 0);
  assert.ok(rejected[0].unverifiedNumbers.includes(61), 'the invented peer figure is caught');
});

test('a real citation — the actual concentration and volume ratio — survives', () => {
  const facts = buildFacts(concentrated);
  const { kept } = rejectFabricatedFindings(
    [{ field: 'holders', text: 'The top holder controls 44% of supply and volume runs at 30x liquidity.' }],
    facts,
    ['text'],
  );
  assert.equal(kept.length, 1, 'figures that trace to the engine are allowed through');
});

// ── Evidence weighting: the analyst's attention budget ───────────────────────

test('a live mint authority outweighs a missing social link', () => {
  // The whole point of the five-tier weight: these are not the same order of
  // concern, and the narrative must not treat them as equals.
  assert.equal(weightForEvidenceKey('mintAuthorityEnabled'), 'critical');
  assert.equal(weightForEvidenceKey('noPublicPresence'), 'medium');
  assert.equal(weightForEvidenceKey('contractSecurityUnknown'), 'low');
});

test('an unclassified positive is weak by default; an unclassified risk is not trivialised', () => {
  assert.equal(weightForEvidenceKey('somethingNew', 'positive'), 'low');
  assert.equal(weightForEvidenceKey('somethingNew', 'negative'), 'medium');
});

test('rankEvidence splits bull/bear and orders each strongest-first', () => {
  const { bull, bear } = rankEvidence({
    positiveKeys: ['activePublicPresence', 'authoritiesDisabled'],
    positiveTexts: ['Has public links', 'Mint and freeze disabled'],
    riskKeys: ['shallowLiquidity', 'mintAuthorityEnabled'],
    riskTexts: ['Liquidity is shallow', 'Mint authority is enabled'],
    scamKeys: ['topHolderConcentration'],
    scamTexts: ['Largest holder controls 61% of supply'],
  });
  // Bull: the loss-vector-removing signal outranks mere link presence.
  assert.equal(bull[0].key, 'authoritiesDisabled');
  assert.equal(bull[bull.length - 1].weight, 'low');
  // Bear: two 'critical' items (mint authority, 61% holder) lead the shallow one.
  assert.equal(bear[0].weight, 'critical');
  assert.equal(bear[bear.length - 1].key, 'shallowLiquidity');
});

test('rankEvidence dedups a concern surfaced by two detectors', () => {
  // The same text arriving from both the hidden-risk and scam lists is one
  // piece of evidence, not two — otherwise the narrative double-counts it.
  const { bear } = rankEvidence({
    riskKeys: ['topTenCentralization'], riskTexts: ['Top 10 hold a majority'],
    scamKeys: ['topTenConcentration'], scamTexts: ['Top 10 hold a majority'],
  });
  assert.equal(bear.length, 1);
});

test('every classified evidence weight is a real tier', () => {
  const tiers = new Set(['critical', 'high', 'medium', 'low', 'noise']);
  for (const [key, weight] of Object.entries(EVIDENCE_WEIGHTS)) {
    assert.ok(tiers.has(weight), `${key} has an unknown tier ${weight}`);
  }
});

// ── Score drivers: the single biggest lever ──────────────────────────────────

test('computeScoreDrivers names the single most influential signal', () => {
  const { biggest } = computeScoreDrivers({
    topHolderScore: 12,   // 18 * -38 = -684 → dominant
    liquidityScore: 84,   // 16 * +34 = +544
  });
  assert.equal(biggest.key, 'topHolderScore');
  assert.equal(biggest.direction, 'negative');
});

// ── buildFacts surfaces the new reasoning layers ─────────────────────────────

test('buildFacts carries the bull/bear ledger, the biggest lever, and a cap note', () => {
  const facts = buildFacts({
    ...concentrated,
    positiveSignalKeys: ['tradedOverYear', 'coingeckoVerified'],
    scamRiskReasonKeys: [{ key: 'mintAuthorityEnabled' }],
    scamRiskReasons: ['Mint authority is still enabled'],
    // Force the cap to bite so biggestInfluence must report the ceiling.
    assetTypeRiskModifier: { label: 'New / unproven memecoin', cap: 35, rawScore: 61, adjustedScore: 35, capApplied: true, isSpeculative: true },
  });
  assert.ok(Array.isArray(facts.evidence.bull) && Array.isArray(facts.evidence.bear));
  // The critical mint-authority evidence must lead the bear case.
  assert.equal(facts.evidence.bear[0].weight, 'critical');
  // When the cap bites, it is reported as the biggest influence, not a signal.
  assert.match(facts.scoreDrivers.biggestInfluence, /ceiling/);
  assert.equal(facts.scoreDrivers.cappedBy, 'New / unproven memecoin');
});

test('peerComparison is present only when the engine has enough peers', () => {
  const withPeers = buildFacts({ ...concentrated, peerBenchmark: { category: 'DeFi', peerCount: 9, percentile: 30, median: 55, comparison: 'below' } });
  assert.equal(withPeers.peerComparison.percentile, 30);
  assert.equal(withPeers.peerComparison.comparison, 'below');
  // No benchmark → no comparison, so the model cannot invent peers.
  const withoutPeers = buildFacts(concentrated);
  assert.equal(withoutPeers.peerComparison, null);
});

// ── The full engine still produces conflicts end-to-end ──────────────────────

test('runRiskAnalysis carries conflicts through to its output', () => {
  const result = runRiskAnalysis(
    { name: 'X' },
    { totalLiquidityUsd: 90_000, marketCapUsd: 6_000_000, poolCount: 1, topHolderPercent: 44, tokenAgeDays: 500, mintAuthorityEnabled: true },
    {},
    'High',
    { rawScore: 48, adjustedScore: 48 },
  );
  assert.ok(Array.isArray(result.signalConflicts));
  assert.ok(result.signalConflicts.some((c) => c.key === 'establishedVsLiveAuthority'));
});
