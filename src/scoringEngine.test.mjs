// Regression net for the risk scoring engine (Phase 2). Locks in the current,
// intended behavior of the product's credibility core before any accuracy
// tuning. Pure functions, no external calls — runnable with `npm test`
// (node --test, zero dependencies).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyAsset,
  getAssetTypeRiskModifier,
  applyAssetTypeRiskModifier,
  scoreLiquidityQuality,
  scoreVolumeLiquidityConsistency,
  scoreVolatility,
  scoreMarketMaturity,
  detectManipulationPattern,
  computeConfidence,
  detectHiddenRisks,
  detectPositiveSignals,
  runRiskAnalysis,
} from './scoringEngine.js';

test('classifyAsset: recognizes core categories from name/ticker', () => {
  assert.equal(classifyAsset({ name: 'Dogecoin', ticker: 'DOGE' }).category, 'Meme Token');
  assert.equal(classifyAsset({ name: 'USD Coin', ticker: 'USDC' }).category, 'Stablecoin');
  assert.equal(classifyAsset({ name: 'Solana', ticker: 'SOL' }).category, 'Layer 1');
  assert.equal(classifyAsset({ name: 'Arbitrum', ticker: 'ARB' }).category, 'Layer 2');
  assert.equal(classifyAsset({ name: 'Totally Unknown Thing', ticker: 'ZZZ' }).category, 'Other');
});

test('classifyAsset: meme SHAPE (huge supply, sub-cent price) without a meme keyword', () => {
  const res = classifyAsset({ name: 'Random', ticker: 'RND' }, { supply: 2_000_000_000, priceUsd: 0.0001, marketCapUsd: 1_000_000 });
  assert.equal(res.category, 'Meme Token');
  assert.equal(res.confidence, 'heuristic');
});

test('asset-type modifier: unproven memecoin capped at 35, established at 70', () => {
  const unproven = getAssetTypeRiskModifier('Meme Token', { name: 'Pepe' }, {});
  assert.equal(unproven.cap, 35);
  assert.equal(unproven.isSpeculative, true);

  const established = getAssetTypeRiskModifier('Meme Token', { name: 'Doge' }, {
    tokenAgeDays: 500, totalLiquidityUsd: 2_000_000, marketCapUsd: 500_000_000, holderCount: 50_000,
  });
  assert.equal(established.cap, 70);
});

test('asset-type modifier: major blue-chip L1 capped at 95, generic caps below 100', () => {
  assert.equal(getAssetTypeRiskModifier('Layer 1', { name: 'Bitcoin', ticker: 'BTC' }, { marketCapUsd: 1_000_000_000_000 }).cap, 95);
  assert.equal(getAssetTypeRiskModifier('Layer 1', { name: 'SomeChain' }, { marketCapUsd: 10_000_000 }).cap, 92);
  assert.equal(getAssetTypeRiskModifier('Stablecoin', {}, {}).cap, 95);
  assert.equal(getAssetTypeRiskModifier('Other', {}, {}).cap, 90);
});

test('applyAssetTypeRiskModifier: caps down but NEVER raises a score', () => {
  const capped = applyAssetTypeRiskModifier('Meme Token', { name: 'Pepe' }, {}, 90);
  assert.equal(capped.adjustedScore, 35);
  assert.equal(capped.capApplied, true);

  const belowCap = applyAssetTypeRiskModifier('Meme Token', { name: 'Pepe' }, {}, 20);
  assert.equal(belowCap.adjustedScore, 20, 'a low raw score is never raised to the cap');
  assert.equal(belowCap.capApplied, false);
});

test('scoreLiquidityQuality: deeper ratio scores higher; single pool penalized', () => {
  const deep = scoreLiquidityQuality(20, 100, 3);   // ratio 0.2, 3 pools
  const shallow = scoreLiquidityQuality(1, 100, 1);  // ratio 0.01, 1 pool
  assert.ok(deep > shallow);
  assert.equal(scoreLiquidityQuality(0, 100), null, 'missing liquidity -> null (Unknown), not a guess');
});

test('scoreVolumeLiquidityConsistency: flags wash-trade shape (volume >> liquidity)', () => {
  assert.equal(scoreVolumeLiquidityConsistency(1_000_000, 10_000), 10); // ratio 100
  assert.ok(scoreVolumeLiquidityConsistency(5_000, 10_000) >= 80);       // healthy turnover
  assert.equal(scoreVolumeLiquidityConsistency(0, 10_000), null);
});

test('scoreVolatility / scoreMarketMaturity: bounded and null-safe', () => {
  assert.equal(scoreVolatility(2, 3, 4), 90);
  assert.ok(scoreVolatility(200, 5, 5) <= 10);
  assert.equal(scoreVolatility(), null);
  assert.ok(scoreMarketMaturity(1000) >= 90);
  assert.equal(scoreMarketMaturity(null), null);
});

test('detectManipulationPattern: raises expected flags', () => {
  const flags = detectManipulationPattern({ totalLiquidityUsd: 1_000, volume24hUsd: 50_000 });
  assert.ok(flags.some((f) => /wash-traded|artificial/i.test(f)));
  assert.equal(detectManipulationPattern({}).length, 0, 'no data -> no fabricated flags');
});

test('computeConfidence: reflects how much real data is present', () => {
  const empty = computeConfidence({});
  assert.equal(empty.confidenceScore, 0);
  assert.equal(empty.label, 'Low');

  const full = computeConfidence({
    marketCapUsd: 1, totalLiquidityUsd: 1, holderCount: 1, topHolderPercent: 1, topTenHolderPercent: 1,
    tokenAgeDays: 1, volume24hUsd: 1, mintAuthorityEnabled: false, freezeAuthorityEnabled: false, upgradeable: false,
    coingeckoListed: true, websiteUrl: 'x', twitterUrl: 'x', telegramUrl: 'x', githubUrl: 'x', priceChange24h: 1,
    holderGrowthPercent: 1, supply: 1, poolCount: 1, ath: 1,
  });
  assert.equal(full.confidenceScore, 100);
  assert.equal(full.label, 'High');
});

test('detectHiddenRisks / detectPositiveSignals: evidence-driven, not arbitrary', () => {
  const risks = detectHiddenRisks({}, { tokenAgeDays: 5 }, {}, []);
  assert.ok(risks.some((r) => /very new/i.test(r)));

  const positives = detectPositiveSignals({}, { topHolderPercent: 5, mintAuthorityEnabled: false, freezeAuthorityEnabled: false }, {});
  assert.ok(positives.some((p) => /well distributed/i.test(p)));
  assert.ok(positives.some((p) => /mint and freeze/i.test(p)));
});

test('runRiskAnalysis: integrates into a stable shape without touching trustScore', () => {
  const project = { name: 'Pepe', ticker: 'PEPE', website: '', twitter: '', telegram: '' };
  const data = { totalLiquidityUsd: 5_000, volume24hUsd: 500_000, tokenAgeDays: 3, marketCapUsd: 1_000_000, priceChange24h: 250 };
  const out = runRiskAnalysis(project, data, {}, 'High', { rawScore: 88, adjustedScore: 35 });
  assert.equal(out.assetCategory, 'Meme Token');
  assert.equal(out.assetTypeRiskModifier.cap, 35);
  assert.ok(Array.isArray(out.hiddenRiskSignals) && out.hiddenRiskSignals.length > 0);
  assert.equal(typeof out.confidenceScore, 'number');
  assert.ok('aiRiskSummary' in out && typeof out.aiRiskSummary === 'string');
  // Purely additive: the orchestrator returns no trustScore of its own.
  assert.equal('trustScore' in out, false);
});
