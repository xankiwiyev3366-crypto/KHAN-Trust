// Grounded AI Analyst — the guarantees that make a user-facing LLM safe here.
//
// The single property every test below defends: the deterministic engine is the
// only source of every number, and the model can only ever contribute sentences
// about numbers the engine already produced. A model that hallucinates should
// cost prose, never a figure on someone's screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildFacts, ANALYST_FIELDS, SUPPORTED_LANGUAGES } from '../netlify/functions/_groundedAnalyst.mjs';
import { fingerprintFacts, ANALYST_PROMPT_VERSION } from '../netlify/functions/_analysisStore.mjs';
import { rejectFabricatedFindings } from '../netlify/functions/_aiValidator.mjs';
import { mergeAnalysis } from '../src/groundedAnalysis.js';
import { RATE_POLICIES } from '../netlify/functions/_rateLimit.mjs';

const project = {
  name: 'Aurum Vault',
  ticker: 'AUR',
  chain: 'ethereum',
  assetCategory: 'DeFi',
  trustScore: 62,
  riskLevel: 'Medium',
  confidenceScore: 74,
  confidenceLabel: 'medium',
  realData: {
    marketCapUsd: 4_200_000,
    totalLiquidityUsd: 318_000,
    volume24hUsd: 91_500,
    poolCount: 3,
    holderCount: 12_400,
    topHolderPercent: 18.6,
    topTenHolderPercent: 44.2,
    tokenAgeDays: 214,
    mintAuthorityEnabled: false,
    freezeAuthorityEnabled: false,
  },
  positiveSignals: ['Mint authority renounced'],
  hiddenRiskSignals: ['Top 10 holders control a large share'],
  missingDataFields: ['githubUrl'],
  scoreBreakdown: { securityScore: 80, liquidityScore: 55 },
};

// ── The facts are the boundary ───────────────────────────────────────────────

test('buildFacts carries the engine verdict and the raw signals', () => {
  const facts = buildFacts(project);
  assert.equal(facts.trustScore, 62);
  assert.equal(facts.riskLevel, 'Medium');
  assert.equal(facts.topHolderPercent, 18.6);
  assert.equal(facts.totalLiquidityUsd, 318_000);
  assert.deepEqual(facts.positiveSignals, ['Mint authority renounced']);
});

test('an unobserved value is null in the facts, never zero', () => {
  // The model is told "null means NOT OBSERVED". If absence arrived as 0 it
  // would write "liquidity is $0", which is a rug claim about a token whose
  // provider merely did not answer.
  const facts = buildFacts({ ...project, realData: { ...project.realData, totalLiquidityUsd: undefined } });
  assert.equal(facts.totalLiquidityUsd, null);
});

test('buildFacts does not leak fields it was not asked to expose', () => {
  const facts = buildFacts({ ...project, internalNote: 'do not send', ownerEmail: 'a@b.c' });
  assert.equal(facts.internalNote, undefined);
  assert.equal(facts.ownerEmail, undefined);
});

// ── Numeric grounding ────────────────────────────────────────────────────────

const validate = (text) => rejectFabricatedFindings(
  [{ field: 'conclusion', text }],
  buildFacts(project),
  ['text']
);

test('prose citing only engine numbers survives', () => {
  const { kept, rejected } = validate(
    'The largest holder controls 18.6% of supply and liquidity stands at 318000, against a Trust Score of 62.'
  );
  assert.equal(kept.length, 1);
  assert.equal(rejected.length, 0);
});

test('a fabricated benchmark is rejected', () => {
  // The exact failure mode: fluent, plausible, decision-shaping, and invented.
  const { kept, rejected } = validate(
    'Its 18.6% concentration is well below the 35% industry average for DeFi tokens.'
  );
  assert.equal(kept.length, 0);
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0].unverifiedNumbers.includes(35));
});

test('an invented score is rejected even when it looks plausible', () => {
  const { kept } = validate('This token scores 71/100 on our risk model.');
  assert.equal(kept.length, 0, 'the engine said 62 — 71 is the model inventing a score');
});

test('small ordinals and years are not treated as fabricated statistics', () => {
  const { kept } = validate('There are 3 liquidity pools and 2 clear concerns to track in 2026.');
  assert.equal(kept.length, 1);
});

test('one bad sentence costs only that sentence', () => {
  // Fields are validated independently so a single hallucination does not blank
  // the whole card.
  const { kept, rejected } = rejectFabricatedFindings(
    [
      { field: 'liquidity', text: 'Liquidity is 318000 across 3 pools.' },
      { field: 'outlook', text: 'Comparable tokens average 88% higher retention.' },
    ],
    buildFacts(project),
    ['text']
  );
  assert.deepEqual(kept.map((k) => k.field), ['liquidity']);
  assert.deepEqual(rejected.map((r) => r.finding.field), ['outlook']);
});

// ── The overlay can never touch a number ─────────────────────────────────────

test('mergeAnalysis overlays prose and leaves engine values untouched', () => {
  const deterministic = {
    liquidity: 'template liquidity line',
    conclusion: 'template conclusion',
    riskConfidenceScore: 74,
    bullish: ['Mint authority renounced'],
    dataQuality: { key: 'partial', label: 'Partial' },
  };
  const merged = mergeAnalysis(deterministic, {
    liquidity: 'AI liquidity line',
    // Every field below is NOT overlayable and must be ignored outright.
    riskConfidenceScore: 99,
    bullish: ['fabricated signal'],
    dataQuality: { key: 'complete', label: 'Complete' },
    trustScore: 100,
  });

  assert.equal(merged.liquidity, 'AI liquidity line', 'prose is overlaid');
  assert.equal(merged.conclusion, 'template conclusion', 'ungenerated prose keeps the template');
  assert.equal(merged.riskConfidenceScore, 74, 'engine score is NOT overlayable');
  assert.deepEqual(merged.bullish, ['Mint authority renounced'], 'engine signals are NOT overlayable');
  assert.equal(merged.dataQuality.label, 'Partial', 'engine data quality is NOT overlayable');
  assert.equal(merged.trustScore, undefined, 'the model cannot introduce a score at all');
});

test('a null or empty AI response leaves the deterministic build intact', () => {
  const deterministic = { liquidity: 'template', conclusion: 'template' };
  assert.deepEqual(mergeAnalysis(deterministic, null), deterministic);
  assert.deepEqual(mergeAnalysis(deterministic, {}), deterministic);
  assert.deepEqual(mergeAnalysis(deterministic, { liquidity: '   ' }), deterministic);
  assert.deepEqual(mergeAnalysis(deterministic, { recommendations: [] }), deterministic);
});

// ── Cache keying is the anti-poisoning boundary ──────────────────────────────

test('different facts fingerprint differently, so forged facts cannot poison a token', () => {
  const honest = fingerprintFacts(buildFacts(project));
  const forged = fingerprintFacts(buildFacts({ ...project, trustScore: 99 }));
  assert.notEqual(honest, forged);
});

test('the fingerprint is stable across property order', () => {
  // Otherwise any client-side refactor silently invalidates the entire cache.
  const a = fingerprintFacts({ alpha: 1, beta: 2 });
  const b = fingerprintFacts({ beta: 2, alpha: 1 });
  assert.equal(a, b);
});

test('identical facts reuse one cache entry — this is the cost model', () => {
  // A thousand users viewing one token must be ONE generation. If this ever
  // stops holding, a popular token exhausts the monthly AI budget alone.
  assert.equal(fingerprintFacts(buildFacts(project)), fingerprintFacts(buildFacts({ ...project })));
});

// ── Wiring guards ────────────────────────────────────────────────────────────

test('the rate-limit policy actually exists', () => {
  // enforce() silently ALLOWS an unknown policy name, so a typo here would make
  // the only money-spending endpoint's cost guard dead code that looks live.
  assert.ok(RATE_POLICIES.premium_analysis_user, 'premium_analysis_user policy must be registered');
  assert.ok(RATE_POLICIES.premium_analysis_user.max > 0);
});

test('every analyst field is overlayable and every language is supported', () => {
  const deterministic = Object.fromEntries(ANALYST_FIELDS.map((f) => [f, 'template']));
  const ai = Object.fromEntries(ANALYST_FIELDS.map((f) => [f, 'generated']));
  const merged = mergeAnalysis(deterministic, ai);
  for (const field of ANALYST_FIELDS) {
    assert.equal(merged[field], 'generated', `${field} must be overlayable`);
  }
  for (const lang of ['en', 'az', 'tr', 'ru']) {
    assert.ok(SUPPORTED_LANGUAGES.has(lang), `${lang} must be generatable`);
  }
});

test('the prompt version is part of the cache identity', () => {
  // A prompt change must invalidate existing prose without a purge step.
  assert.ok(Number.isInteger(ANALYST_PROMPT_VERSION) && ANALYST_PROMPT_VERSION >= 1);
});
