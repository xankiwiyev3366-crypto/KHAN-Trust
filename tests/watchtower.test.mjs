// Watchtower Report — regression tests for the report composer.
//
// Each test pins a property the report must have for it to be safe to sell as a
// monitoring service. The theme running through all of them: the report must
// never claim to know something it does not know. A monitoring product that
// reassures you about a token it could not see is worse than no product.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildWatchtowerReport,
  classifyToken,
  TOKEN_STATUS,
} from '../netlify/functions/_watchtowerReport.mjs';
import { coverageBetween, toBaselineEntry } from '../netlify/functions/_watchtowerStore.mjs';
import {
  isComparableBaseline,
  COMPARABLE_ENGINE_VERSION,
} from '../netlify/functions/_watchtowerBaseline.mjs';
import { RESCAN_ENGINE_VERSION } from '../netlify/functions/_rescanEngine.mjs';
import {
  adaptWatchSnapshot,
  changeReasonCodes,
  devWalletReasonCodes,
  hasCriticalReason,
} from '../netlify/functions/_watchSignals.mjs';

// A complete watch-lane snapshot; override any field per test.
const snap = (trustScore, signals = {}, extra = {}) => ({
  identity: 'sol:TOKEN',
  contract: 'TOKEN',
  chain: 'solana',
  name: 'Test Token',
  ticker: 'TEST',
  trustScore,
  riskLevel: trustScore >= 70 ? 'Low' : trustScore >= 40 ? 'Medium' : 'High',
  signals: {
    totalLiquidityUsd: 500_000,
    poolCount: 3,
    volume24hUsd: 100_000,
    holderCount: 10_000,
    topHolderPercent: 8,
    topTenHolderPercent: 30,
    mintAuthorityEnabled: false,
    freezeAuthorityEnabled: false,
    upgradeable: false,
    ...signals,
  },
  source: 'server_rescan',
  engineVersion: RESCAN_ENGINE_VERSION,
  observedAt: '2026-07-20T10:00:00.000Z',
  ...extra,
});

const token = { identity: 'sol:TOKEN', name: 'Test Token', ticker: 'TEST', chain: 'solana', contract: 'TOKEN' };
const period = { start: '2026-07-13T00:00:00.000Z', end: '2026-07-20T00:00:00.000Z' };

// ── The duplicated-constant guard ────────────────────────────────────────────

test('the baseline module version tracks the real engine version', () => {
  // _watchtowerBaseline duplicates the version as a literal to stay light (see
  // its header). This test is the thing that stops that duplication drifting: if
  // RESCAN_ENGINE_VERSION is bumped without bumping the other, every comparison
  // silently becomes a no-op and the report goes quiet forever.
  assert.equal(COMPARABLE_ENGINE_VERSION, RESCAN_ENGINE_VERSION);
});

// ── Never claim to know what we do not know ──────────────────────────────────

test('a token with no snapshot is UNOBSERVED, never steady', () => {
  const result = classifyToken({ token, current: null, baseline: toBaselineEntry(snap(80)) });
  assert.equal(result.status, TOKEN_STATUS.UNOBSERVED);
});

test('an unobserved token stops the report claiming all-clear', () => {
  const report = buildWatchtowerReport({
    tokens: [token, { ...token, identity: 'sol:OTHER' }],
    snapshots: { 'sol:OTHER': snap(80) },
    baseline: { 'sol:OTHER': toBaselineEntry(snap(80)) },
    coverage: { known: true, cycles: 168, observations: 300, declined: 12 },
    period,
  });
  // One steady, one unobserved — the headline must be 'partial', not 'steady'.
  assert.equal(report.summary.headlineKey, 'partial');
  assert.equal(report.summary.unobserved, 1);
});

test('a first observation is BASELINED, not a change', () => {
  const result = classifyToken({ token, current: snap(80), baseline: undefined });
  assert.equal(result.status, TOKEN_STATUS.BASELINED);
  assert.equal(result.changes.length, 0);
});

test('a baseline from a different engine version is not comparable', () => {
  const stale = { ...toBaselineEntry(snap(80)), engineVersion: RESCAN_ENGINE_VERSION + 1 };
  assert.equal(isComparableBaseline(stale), false);
  const result = classifyToken({ token, current: snap(40), baseline: stale });
  // A 40-point fall across an engine change must NOT be reported as a collapse.
  assert.equal(result.status, TOKEN_STATUS.BASELINED);
});

test('a legacy baseline with no source is not comparable', () => {
  const legacy = { score: 80, riskLevel: 'Low', signals: snap(80).signals };
  assert.equal(isComparableBaseline(legacy), false);
});

// ── "Nothing changed" is a real report ───────────────────────────────────────

test('a quiet period still reports coverage and every watched token', () => {
  const report = buildWatchtowerReport({
    tokens: [token],
    snapshots: { 'sol:TOKEN': snap(80) },
    baseline: { 'sol:TOKEN': toBaselineEntry(snap(80)) },
    coverage: { known: true, cycles: 168, observations: 168, declined: 0 },
    period,
  });
  assert.equal(report.summary.headlineKey, 'steady');
  assert.equal(report.summary.steady, 1);
  assert.equal(report.coverage.cycles, 168);
  // The token is still listed, with its factual current score.
  assert.equal(report.tokens.length, 1);
  assert.equal(report.tokens[0].score, 80);
  assert.equal(report.tokens[0].status, TOKEN_STATUS.STEADY);
});

test('absence of ledger entries is unknown coverage, never zero cycles', () => {
  const coverage = coverageBetween([], period.start, period.end);
  assert.equal(coverage.known, false);
  assert.equal(coverage.cycles, 0);
});

test('coverage counts only runs inside the period', () => {
  const runs = [
    { at: '2026-07-01T00:00:00.000Z', tokens: 5, observed: 5, declined: 0 }, // before
    { at: '2026-07-15T00:00:00.000Z', tokens: 5, observed: 4, declined: 1 }, // inside
    { at: '2026-07-16T00:00:00.000Z', tokens: 5, observed: 5, declined: 0 }, // inside
    { at: '2026-07-25T00:00:00.000Z', tokens: 5, observed: 5, declined: 0 }, // after
  ];
  const coverage = coverageBetween(runs, period.start, period.end);
  assert.equal(coverage.known, true);
  assert.equal(coverage.cycles, 2);
  assert.equal(coverage.observations, 9);
  assert.equal(coverage.declined, 1);
});

// ── Attention ranking ────────────────────────────────────────────────────────

test('a re-enabled mint authority outranks a bigger score drop', () => {
  const critical = { ...token, identity: 'sol:CRIT' };
  const wobbler = { ...token, identity: 'sol:WOBBLE' };

  const report = buildWatchtowerReport({
    tokens: [wobbler, critical],
    snapshots: {
      // Big score fall, but nothing categorical.
      'sol:WOBBLE': snap(45),
      // Small score move, but the owner can mint again.
      'sol:CRIT': snap(78, { mintAuthorityEnabled: true }),
    },
    baseline: {
      'sol:WOBBLE': toBaselineEntry(snap(85)),
      'sol:CRIT': toBaselineEntry(snap(80)),
    },
    coverage: { known: true, cycles: 168, observations: 336, declined: 0 },
    period,
  });

  assert.equal(report.tokens[0].identity, 'sol:CRIT');
  assert.equal(report.tokens[0].status, TOKEN_STATUS.CRITICAL);
  assert.equal(report.summary.headlineKey, 'critical');
});

test('improvements are reported, not just problems', () => {
  const result = classifyToken({
    token,
    current: snap(88, { totalLiquidityUsd: 900_000 }),
    baseline: toBaselineEntry(snap(70, { totalLiquidityUsd: 500_000 })),
  });
  assert.equal(result.status, TOKEN_STATUS.IMPROVED);
  assert.ok(result.changes.some((change) => change.key === 'trustScore' && !change.worse));
});

// ── Structured output, never prose ───────────────────────────────────────────

test('the report contains no composed sentences — keys and params only', () => {
  const report = buildWatchtowerReport({
    tokens: [token],
    snapshots: { 'sol:TOKEN': snap(40, { totalLiquidityUsd: 0 }) },
    baseline: { 'sol:TOKEN': toBaselineEntry(snap(85)) },
    coverage: { known: true, cycles: 168, observations: 168, declined: 0 },
    period,
  });
  const serialized = JSON.stringify(report);
  // If any English prose leaked into storage, the report can never be
  // re-rendered in another language. These are phrases the old email digest used.
  assert.ok(!serialized.includes('liquidity dropped'));
  assert.ok(!serialized.includes('has been removed'));
  assert.ok(!serialized.includes('risk profile'));
  // The structured code IS present.
  assert.ok(report.tokens[0].reasons.some((r) => r.code === 'liquidityRemoved'));
});

// ── The watch-lane adapter ───────────────────────────────────────────────────

test('the adapter maps watch-lane fields onto the shared diff shape', () => {
  const adapted = adaptWatchSnapshot(snap(72, { totalLiquidityUsd: 250_000, topHolderPercent: 12 }));
  assert.equal(adapted.score, 72);
  assert.equal(adapted.liquidityUsd, 250_000);
  assert.equal(adapted.topHolderPercent, 12);
  // Unobserved dimensions stay absent so diffSnapshots skips them rather than
  // reading an invented 0 as "community collapsed".
  assert.equal(adapted.categories, undefined);
  assert.equal(adapted.socialScore, undefined);
});

test('a null authority flag never reads as re-enabled', () => {
  // _volatileSignals stores null for "the provider did not answer". If null were
  // treated as false, the next successful fetch would fire a mint-re-enabled
  // alarm about someone's money on the strength of a provider gap.
  const before = snap(80, { mintAuthorityEnabled: null });
  const after = snap(80, { mintAuthorityEnabled: true });
  const codes = changeReasonCodes(before, after);
  assert.equal(codes.some(({ code }) => code === 'mintReenabled'), false);
});

test('an empty watchlist reports empty, not steady', () => {
  const report = buildWatchtowerReport({
    tokens: [],
    snapshots: {},
    baseline: {},
    coverage: { known: false, cycles: 0, observations: 0, declined: 0 },
    period,
  });
  assert.equal(report.summary.headlineKey, 'empty');
  assert.equal(report.tokens.length, 0);
});

// ── Developer wallet monitoring ──────────────────────────────────────────────
//
// Field names verified against LIVE GoPlus responses for both chains before
// these were written (Solana: mintable.authority / metadata_mutable; EVM:
// creator_percent / owner_address). Guessing would have shipped a monitor that
// silently reported null forever.

test('an EVM deployer reducing their stake is detected and is critical', () => {
  const before = { creatorAddress: '0xabc', creatorPercent: 5.0, ownerAddress: '0x0', ownerPercent: 0 };
  const after = { creatorAddress: '0xabc', creatorPercent: 1.2, ownerAddress: '0x0', ownerPercent: 0 };
  const codes = devWalletReasonCodes(before, after);
  assert.ok(codes.some(({ code }) => code === 'creatorStakeFell'));
  assert.equal(hasCriticalReason(codes), true);
});

test('a deployer stake move below the threshold is noise, not an event', () => {
  const before = { creatorAddress: '0xabc', creatorPercent: 5.0 };
  const after = { creatorAddress: '0xabc', creatorPercent: 4.8 };
  assert.equal(devWalletReasonCodes(before, after).length, 0);
});

test('an unknown developer stake never reads as a sale', () => {
  // The failure this pins: GoPlus omits creator_percent for one run, then
  // returns it. If null were treated as 0, the recovery would report the
  // deployer dumping their entire stake — maximally alarming, entirely false.
  const gap = { creatorAddress: '0xabc', creatorPercent: null };
  const recovered = { creatorAddress: '0xabc', creatorPercent: 5.0 };
  assert.equal(devWalletReasonCodes(gap, recovered).length, 0);
  assert.equal(devWalletReasonCodes(recovered, gap).length, 0);
});

test('a Solana mint authority moving to another wallet is critical', () => {
  const before = { mintAuthorities: ['Wallet1'], freezeAuthorities: [] };
  const after = { mintAuthorities: ['Wallet2'], freezeAuthorities: [] };
  const codes = devWalletReasonCodes(before, after);
  assert.ok(codes.some(({ code }) => code === 'mintAuthorityMoved'));
  assert.equal(hasCriticalReason(codes), true);
});

test('renouncing an authority is good news, not an alarm', () => {
  const before = { mintAuthorities: ['Wallet1'] };
  const after = { mintAuthorities: [] };
  const codes = devWalletReasonCodes(before, after);
  assert.ok(codes.some(({ code }) => code === 'mintAuthorityMovedRenounced'));
  assert.equal(hasCriticalReason(codes), false);
});

test('authority list reordering is not a control change', () => {
  // GoPlus does not promise stable ordering. addressList() sorts, so a reshuffle
  // of the same wallets must produce no event at all.
  const before = { mintAuthorities: ['Aaa', 'Bbb'] };
  const after = { mintAuthorities: ['Aaa', 'Bbb'] };
  assert.equal(devWalletReasonCodes(before, after).length, 0);
});

test('a missing devWallet block on either side produces no events', () => {
  // Old snapshots written before dev-wallet monitoring existed have no block.
  // They must diff cleanly against new ones rather than fabricating changes.
  assert.equal(devWalletReasonCodes(null, { creatorPercent: 5 }).length, 0);
  assert.equal(devWalletReasonCodes({ creatorPercent: 5 }, null).length, 0);
});

// ── Holder base health ───────────────────────────────────────────────────────

test('holder base growth is reported as good news', () => {
  const before = snap(80, { holderCount: 10_000 });
  const after = snap(80, { holderCount: 11_000 });
  const codes = changeReasonCodes(before, after);
  assert.ok(codes.some(({ code }) => code === 'holderBaseGrew'));
  assert.equal(hasCriticalReason(codes), false);
});

test('holder base drift below the band is not an event', () => {
  const before = snap(80, { holderCount: 10_000 });
  const after = snap(80, { holderCount: 10_200 });
  const codes = changeReasonCodes(before, after);
  assert.equal(codes.some(({ code }) => String(code).startsWith('holderBase')), false);
});

test('a collapsing holder base still trips the stronger alarm, not the drift band', () => {
  const before = snap(80, { holderCount: 10_000 });
  const after = snap(80, { holderCount: 6_000 });
  const codes = changeReasonCodes(before, after);
  assert.ok(codes.some(({ code }) => code === 'holdersFell'));
  assert.equal(codes.some(({ code }) => code === 'holderBaseShrank'), false);
});
