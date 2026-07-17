// The approval risk engine: what a token approval MEANS, and how dangerous it
// is. Pure and chain-agnostic - no RPC, no wallet, no React, no i18n. Every
// chain lane (src/approvals/solanaLane.js today, an EVM lane later) normalizes
// its on-chain data into the shape below and hands it here, so the risk rules
// are defined exactly once for every chain.
//
// This mirrors the discipline in src/lib/trustScore.js: one implementation of
// the maths, imported by everything that needs it, so two chains can never
// disagree about what "high risk" means.
//
// WHAT AN APPROVAL IS
//
// A standing permission for someone else's address (the "spender", called a
// DELEGATE on Solana) to move your tokens out of your wallet without asking you
// again. It is the mechanism behind most wallet-drain incidents: the victim
// approved something once, months ago, and the permission never expired.
//
// TWO NUMBERS, NOT ONE
//
// The approved amount alone does not tell you your risk. What can actually be
// taken right now is min(approved, balance) - the EXPOSURE. An unlimited
// approval on an empty account can take nothing today; a small approval on a
// large balance can only take the small amount. Ranking by approved amount would
// put a scary-looking, harmless permission above a live one that is draining.
//
// ...WHICH IS WHY A DORMANT APPROVAL IS NOT SAFE
//
// An unlimited approval on a zero balance is not a non-issue: it is a permission
// over every token you have not received YET. The moment tokens land in that
// account they are immediately takeable, with no further action by the attacker.
// So zero exposure + unlimited grant is graded MEDIUM, not low. This is the
// non-obvious finding this scanner exists to surface, and grading it "low"
// because the number is currently zero would be the one mistake that makes the
// whole feature worthless.
//
// UNKNOWN IS NOT SAFE
//
// There is no allowlist of "trusted" spenders here (see KNOWN_SPENDERS). An
// allowlist that is wrong labels a drainer as safe, which is worse than saying
// nothing. Until one can be sourced and verified, every spender is unknown, and
// unknown never reduces a severity - it only ever fails to reduce it.

// u64::MAX. Solana's SPL approve takes a u64, so this is the "infinite"
// sentinel: an amount nobody could ever legitimately intend to transfer, chosen
// precisely so the permission never needs renewing.
export const UNLIMITED_SENTINEL = 18446744073709551615n;

export const RISK_HIGH = 'high';
export const RISK_MEDIUM = 'medium';
export const RISK_LOW = 'low';

const RISK_ORDER = { [RISK_HIGH]: 0, [RISK_MEDIUM]: 1, [RISK_LOW]: 2 };

// Deliberately empty. See the "UNKNOWN IS NOT SAFE" note above: this is the seam
// for a verified spender allowlist (a staking program, a DEX router), not a
// place to guess. An entry here must be a program address someone has actually
// verified, because its only effect is to make a warning quieter.
export const KNOWN_SPENDERS = {};

// Parses an on-chain raw amount into BigInt. Raw amounts are u64/uint256 and
// routinely exceed Number.MAX_SAFE_INTEGER, so they travel as strings and are
// compared as BigInt - never as floats. A garbage value becomes 0n rather than
// NaN, so a malformed record degrades to "nothing at risk" instead of poisoning
// every comparison downstream with NaN.
export function parseRaw(value) {
  if (typeof value === 'bigint') return value >= 0n ? value : 0n;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return BigInt(Math.floor(value));
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return 0n;
    try {
      return BigInt(trimmed);
    } catch {
      return 0n;
    }
  }
  return 0n;
}

// Raw -> human-readable units. Returns null when decimals are unknown rather
// than assuming 0, which would render 1 USDC (6 decimals) as 1,000,000 tokens
// and turn a trivial approval into an apparent catastrophe.
export function toUiAmount(raw, decimals) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 32) return null;
  const value = parseRaw(raw);
  if (decimals === 0) return Number(value);
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const fraction = value % divisor;
  // Via string, not Number(value)/Number(divisor): the latter loses precision
  // for large balances long before it overflows.
  const asNumber = Number(`${whole}.${fraction.toString().padStart(decimals, '0')}`);
  return Number.isFinite(asNumber) ? asNumber : null;
}

export function isUnlimitedAmount(raw) {
  return parseRaw(raw) >= UNLIMITED_SENTINEL;
}

export function spenderInfo(spender) {
  const known = KNOWN_SPENDERS[spender];
  return { spenderKnown: Boolean(known), spenderLabel: known || '' };
}

// The rules. Kept as one small, readable function on purpose: this is the part a
// security-minded user is entitled to have explained to them, and the UI
// explains it by rendering `reasonCodes` (see i18n `approvals.reasons.*`), never
// by restating the logic in prose that could drift from it.
export function classifyApproval(approval) {
  const approved = parseRaw(approval.approvedRaw);
  const balance = parseRaw(approval.balanceRaw);
  // What can be taken RIGHT NOW. The whole ranking rests on this.
  const exposure = approved < balance ? approved : balance;

  const unlimited = isUnlimitedAmount(approval.approvedRaw);
  const coversEntireBalance = balance > 0n && approved >= balance;
  const { spenderKnown, spenderLabel } = spenderInfo(approval.spender);

  const reasonCodes = [];
  let risk;

  if (exposure > 0n) {
    if (coversEntireBalance) {
      // Every token in this account can leave without you signing anything.
      reasonCodes.push('coversEntireBalance');
      risk = spenderKnown ? RISK_MEDIUM : RISK_HIGH;
    } else {
      reasonCodes.push('partialExposure');
      risk = RISK_MEDIUM;
    }
    if (unlimited) reasonCodes.push('unlimitedGrant');
  } else if (unlimited) {
    // Nothing to take today - but a standing permission over anything that
    // arrives tomorrow. See the DORMANT note at the top of this file.
    reasonCodes.push('dormantUnlimited');
    risk = RISK_MEDIUM;
  } else {
    reasonCodes.push('dormantLimited');
    risk = RISK_LOW;
  }

  reasonCodes.push(spenderKnown ? 'knownSpender' : 'unknownSpender');

  return {
    ...approval,
    approvedRaw: approved.toString(),
    balanceRaw: balance.toString(),
    exposureRaw: exposure.toString(),
    approvedUi: toUiAmount(approved, approval.decimals),
    balanceUi: toUiAmount(balance, approval.decimals),
    exposureUi: toUiAmount(exposure, approval.decimals),
    isUnlimited: unlimited,
    coversEntireBalance,
    hasLiveExposure: exposure > 0n,
    spenderKnown,
    spenderLabel,
    risk,
    reasonCodes,
  };
}

// Most dangerous first, then by what is actually at stake. Comparing exposure as
// BigInt (not via Number) keeps the ordering correct for balances above 2^53.
export function sortApprovals(approvals) {
  return [...approvals].sort((a, b) => {
    const byRisk = (RISK_ORDER[a.risk] ?? 3) - (RISK_ORDER[b.risk] ?? 3);
    if (byRisk !== 0) return byRisk;
    const aExposure = parseRaw(a.exposureRaw);
    const bExposure = parseRaw(b.exposureRaw);
    if (aExposure !== bExposure) return bExposure > aExposure ? 1 : -1;
    // Stable, human-meaningful tiebreak so the list does not reshuffle between
    // scans of an unchanged wallet.
    return String(a.tokenSymbol || a.tokenAddress).localeCompare(String(b.tokenSymbol || b.tokenAddress));
  });
}

export function classifyAll(approvals) {
  return sortApprovals((approvals || []).map(classifyApproval));
}

// Headline counts for the scanner's summary strip.
//
// `worstRisk` is null - not 'low' - for an empty list, so the UI can say "no
// approvals found" instead of "low risk", which would imply we found something
// and judged it safe. Same absence-is-not-zero rule the growth console enforces.
export function summarizeApprovals(approvals) {
  const list = approvals || [];
  const counts = { high: 0, medium: 0, low: 0 };
  for (const item of list) {
    if (counts[item.risk] !== undefined) counts[item.risk] += 1;
  }
  const worstRisk = counts.high ? RISK_HIGH : counts.medium ? RISK_MEDIUM : list.length ? RISK_LOW : null;
  return {
    total: list.length,
    ...counts,
    liveExposureCount: list.filter((item) => item.hasLiveExposure).length,
    worstRisk,
  };
}
