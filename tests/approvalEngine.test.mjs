// Tests for the approval risk engine.
//
// This engine decides whether to tell someone their wallet is in danger. Both
// directions of error are expensive: a false "high" trains users to ignore the
// scanner, and a false "low" is an all-clear on a live drain. So these tests pin
// the judgement calls, not just the arithmetic.
//
// The three that matter most:
//
//   1. A dormant UNLIMITED approval is MEDIUM, not low. It is a standing
//      permission over every token the wallet has not received yet. Grading it
//      by today's zero balance is the mistake that would make this feature
//      worthless - it is exactly the case a user cannot see for themselves.
//   2. Raw amounts are BigInt end to end. u64 balances exceed
//      Number.MAX_SAFE_INTEGER, and a float comparison here silently misjudges
//      real wallets.
//   3. An empty result has NO worst-risk, rather than "low". "We found nothing"
//      and "we found things and they are fine" are different claims.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseRaw,
  toUiAmount,
  isUnlimitedAmount,
  classifyApproval,
  classifyAll,
  sortApprovals,
  summarizeApprovals,
  UNLIMITED_SENTINEL,
  RISK_HIGH,
  RISK_MEDIUM,
  RISK_LOW,
} from '../src/approvals/approvalEngine.js';

// A normalized approval as a lane produces it. 9 decimals, like most SPL tokens.
function approval(overrides = {}) {
  return {
    id: 'solana:acct1:spender1',
    chain: 'solana',
    standard: 'spl-token',
    accountAddress: 'acct1',
    programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    tokenAddress: 'mint1',
    tokenName: 'Bonk',
    tokenSymbol: 'BONK',
    decimals: 9,
    spender: 'spender1',
    approvedRaw: '1000000000',
    balanceRaw: '1000000000',
    ...overrides,
  };
}

// ── Raw amount handling ───────────────────────────────────────────────────────

test('raw amounts parse as BigInt and survive u64', () => {
  assert.equal(parseRaw('18446744073709551615'), UNLIMITED_SENTINEL);
  assert.equal(parseRaw(0), 0n);
  assert.equal(parseRaw('42'), 42n);
  assert.equal(parseRaw(7n), 7n);
});

test('garbage raw amounts become 0, never NaN', () => {
  // A NaN here would poison every comparison downstream and silently produce
  // wrong risk levels rather than an obvious failure.
  assert.equal(parseRaw('abc'), 0n);
  assert.equal(parseRaw(''), 0n);
  assert.equal(parseRaw(null), 0n);
  assert.equal(parseRaw(undefined), 0n);
  assert.equal(parseRaw({}), 0n);
  assert.equal(parseRaw(-5), 0n);
  assert.equal(parseRaw('-5'), 0n);
  assert.equal(parseRaw('1.5'), 0n, 'a raw amount is an integer - a decimal string is malformed');
});

test('ui amounts respect decimals', () => {
  assert.equal(toUiAmount('1000000000', 9), 1);
  assert.equal(toUiAmount('1500000', 6), 1.5);
  assert.equal(toUiAmount('42', 0), 42);
});

test('unknown decimals yield null, never a raw number shown as a balance', () => {
  // Rendering 1 USDC (6 decimals) as "1,000,000 tokens" would turn a trivial
  // approval into an apparent catastrophe. Unknown must stay unknown.
  assert.equal(toUiAmount('1000000', null), null);
  assert.equal(toUiAmount('1000000', undefined), null);
  assert.equal(toUiAmount('1000000', -1), null);
});

test('ui conversion keeps precision for very large balances', () => {
  // Number(raw)/Number(divisor) loses precision here long before it overflows.
  const raw = '123456789123456789';
  assert.equal(toUiAmount(raw, 9), 123456789.123456789);
});

test('only the u64 sentinel counts as unlimited', () => {
  assert.equal(isUnlimitedAmount('18446744073709551615'), true);
  assert.equal(isUnlimitedAmount('18446744073709551614'), false);
  assert.equal(isUnlimitedAmount('1000000000'), false);
  assert.equal(isUnlimitedAmount('0'), false);
});

// ── Exposure: the number the ranking rests on ─────────────────────────────────

test('exposure is what can be taken NOW, not what was approved', () => {
  // Approved far more than the balance: only the balance can actually leave.
  const result = classifyApproval(approval({ approvedRaw: '9000000000', balanceRaw: '1000000000' }));
  assert.equal(result.exposureRaw, '1000000000');
  assert.equal(result.exposureUi, 1);
});

test('a partial approval exposes only the approved amount', () => {
  const result = classifyApproval(approval({ approvedRaw: '250000000', balanceRaw: '1000000000' }));
  assert.equal(result.exposureRaw, '250000000');
  assert.equal(result.coversEntireBalance, false);
  assert.equal(result.risk, RISK_MEDIUM, 'a partial grant on a real balance is live exposure');
  assert.ok(result.reasonCodes.includes('partialExposure'));
});

// ── The risk rules ───────────────────────────────────────────────────────────

test('an unknown spender that can take the entire balance is HIGH', () => {
  const result = classifyApproval(approval({ approvedRaw: '1000000000', balanceRaw: '1000000000' }));
  assert.equal(result.risk, RISK_HIGH);
  assert.equal(result.coversEntireBalance, true);
  assert.equal(result.hasLiveExposure, true);
  assert.ok(result.reasonCodes.includes('coversEntireBalance'));
  assert.ok(result.reasonCodes.includes('unknownSpender'));
});

test('an unlimited approval on a funded account is HIGH and flagged unlimited', () => {
  const result = classifyApproval(approval({ approvedRaw: UNLIMITED_SENTINEL.toString(), balanceRaw: '5000000000' }));
  assert.equal(result.risk, RISK_HIGH);
  assert.equal(result.isUnlimited, true);
  assert.ok(result.reasonCodes.includes('unlimitedGrant'));
  assert.equal(result.exposureRaw, '5000000000', 'exposure is capped by the balance, not the sentinel');
});

test('a DORMANT unlimited approval is MEDIUM, not low', () => {
  // THE case this scanner exists for. Zero balance today, but the delegate can
  // take anything that arrives tomorrow, with no further action by the attacker.
  // A user cannot see this for themselves, and "low" here would be an all-clear
  // on a live standing permission.
  const result = classifyApproval(approval({ approvedRaw: UNLIMITED_SENTINEL.toString(), balanceRaw: '0' }));
  assert.equal(result.risk, RISK_MEDIUM);
  assert.equal(result.hasLiveExposure, false, 'nothing is at risk this instant...');
  assert.ok(result.reasonCodes.includes('dormantUnlimited'), '...but the permission covers everything you receive next');
});

test('a dormant LIMITED approval is LOW', () => {
  // A finite grant on an empty account: worth listing for hygiene, not worth
  // alarming anyone about.
  const result = classifyApproval(approval({ approvedRaw: '1000000000', balanceRaw: '0' }));
  assert.equal(result.risk, RISK_LOW);
  assert.equal(result.hasLiveExposure, false);
  assert.ok(result.reasonCodes.includes('dormantLimited'));
});

test('a zero approval on a funded account is LOW', () => {
  const result = classifyApproval(approval({ approvedRaw: '0', balanceRaw: '1000000000' }));
  assert.equal(result.risk, RISK_LOW);
  assert.equal(result.exposureRaw, '0');
});

test('every spender is unknown until an allowlist is actually built', () => {
  // KNOWN_SPENDERS is deliberately empty. This test exists so that populating it
  // is a conscious act with a failing test attached, not a quiet edit - its only
  // effect is to make a warning quieter.
  const result = classifyApproval(approval());
  assert.equal(result.spenderKnown, false);
  assert.equal(result.spenderLabel, '');
  assert.ok(result.reasonCodes.includes('unknownSpender'));
});

test('malformed amounts degrade to low rather than throwing', () => {
  const result = classifyApproval(approval({ approvedRaw: 'not-a-number', balanceRaw: 'also-bad' }));
  assert.equal(result.risk, RISK_LOW);
  assert.equal(result.exposureRaw, '0');
});

// ── Ordering ─────────────────────────────────────────────────────────────────

test('the most dangerous approval is listed first', () => {
  const list = classifyAll([
    approval({ id: 'low', approvedRaw: '1000000000', balanceRaw: '0' }),                                  // low
    approval({ id: 'high', approvedRaw: '1000000000', balanceRaw: '1000000000' }),                        // high
    approval({ id: 'medium', approvedRaw: UNLIMITED_SENTINEL.toString(), balanceRaw: '0' }),              // medium
  ]);
  assert.deepEqual(list.map((item) => item.id), ['high', 'medium', 'low']);
});

test('within a risk level, the larger exposure ranks first - compared as BigInt', () => {
  // Both exposures exceed Number.MAX_SAFE_INTEGER and differ only in their last
  // digits. Float comparison collapses them to equal and the order goes random.
  const big = '9007199254740993000';
  const bigger = '9007199254740994000';
  const list = classifyAll([
    approval({ id: 'smaller', approvedRaw: big, balanceRaw: big, tokenSymbol: 'A' }),
    approval({ id: 'larger', approvedRaw: bigger, balanceRaw: bigger, tokenSymbol: 'B' }),
  ]);
  assert.deepEqual(list.map((item) => item.id), ['larger', 'smaller']);
});

test('ordering is stable for an unchanged wallet', () => {
  // Two identical-risk, identical-exposure rows must not reshuffle between
  // scans - a list that reorders itself looks like the wallet changed.
  const build = () => classifyAll([
    approval({ id: 'b', tokenSymbol: 'ZZZ' }),
    approval({ id: 'a', tokenSymbol: 'AAA' }),
  ]);
  assert.deepEqual(build().map((i) => i.id), build().map((i) => i.id));
  assert.deepEqual(build().map((i) => i.tokenSymbol), ['AAA', 'ZZZ']);
});

test('sortApprovals does not mutate its input', () => {
  const input = classifyAll([approval({ id: 'x', balanceRaw: '0', approvedRaw: '1' })]);
  const copy = [...input];
  sortApprovals(input);
  assert.deepEqual(input, copy);
});

// ── Summary ──────────────────────────────────────────────────────────────────

test('the summary counts each risk level and live exposure', () => {
  const list = classifyAll([
    approval({ id: '1', approvedRaw: '1000000000', balanceRaw: '1000000000' }),              // high, live
    approval({ id: '2', approvedRaw: '250000000', balanceRaw: '1000000000' }),               // medium, live
    approval({ id: '3', approvedRaw: UNLIMITED_SENTINEL.toString(), balanceRaw: '0' }),      // medium, dormant
    approval({ id: '4', approvedRaw: '1000000000', balanceRaw: '0' }),                       // low, dormant
  ]);
  const summary = summarizeApprovals(list);
  assert.equal(summary.total, 4);
  assert.equal(summary.high, 1);
  assert.equal(summary.medium, 2);
  assert.equal(summary.low, 1);
  assert.equal(summary.liveExposureCount, 2);
  assert.equal(summary.worstRisk, RISK_HIGH);
});

test('a clean wallet has NO worst risk, rather than a low one', () => {
  // "We found nothing" is not "we found things and they are fine". Reporting
  // 'low' for an empty list would imply a judgement we never made.
  const summary = summarizeApprovals([]);
  assert.equal(summary.total, 0);
  assert.equal(summary.worstRisk, null);
  assert.equal(summary.liveExposureCount, 0);
});
