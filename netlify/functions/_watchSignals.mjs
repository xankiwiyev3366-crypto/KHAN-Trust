// Watch-lane change detection, shared by the alert worker and the Watchtower
// Report so the two can never disagree about what happened to a token.
//
// WHY THIS WAS EXTRACTED
//
// This detection lived inside alerts-run.mjs, which was correct while alerts
// were its only consumer. The Watchtower Report is a second consumer of the
// exact same question ("what changed between these two watch-lane snapshots?"),
// and a second copy would drift: the day someone tunes the liquidity threshold
// for alerts, the weekly report would quietly keep the old one and the two
// surfaces would describe the same token differently. For a product whose only
// asset is trust, two numbers for one fact is the worst possible bug.
//
// alerts-run.mjs now imports and RE-EXPORTS these, so its public surface (and
// tests/alertsRun.test.mjs) is unchanged.
//
// TWO KINDS OF CHANGE, TWO MECHANISMS
//
//   1. GRADUAL, scored — trust score, liquidity swing, holder concentration.
//      Detected by the shared pure brain in src/lib/snapshotDiff.js, the same
//      one the client timeline uses. Reached here through adaptWatchSnapshot().
//   2. CATEGORICAL, binary — mint/freeze authority flipping back ON, holders
//      collapsing. These are not "a number moved", they are "someone can now do
//      something to you that they could not do yesterday", and no threshold on a
//      score expresses that. Detected by changeReasonCodes() below.
//
// Both produce STRUCTURED output ({ code, params } / { key, delta, worse }),
// never sentences — see _notificationStore.mjs for why keys beat prose.
import { diffSnapshots, riskLevelChange } from '../../src/lib/snapshotDiff.js';

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// Adapts a WATCH-LANE snapshot into the shape the shared diff brain expects.
//
// The two shapes differ because they were built for different lanes: the client
// records `score` + flat metrics from the full 18-provider set; the re-scan
// worker records `trustScore` + a nested `signals` object from the volatile
// subset. Rather than teach the brain about two shapes (which would make every
// future field a two-place change), the caller adapts.
//
// WHAT IS DELIBERATELY ABSENT
//
// No `categories`, no `socialScore`, no `confidence`. The volatile lane does not
// observe them — community/social signals cannot change between hourly runs, so
// _rescanEngine.mjs deliberately excludes them to keep every snapshot in this
// lane comparable to every other. diffSnapshots() skips any comparison where
// either side is null, so those simply never fire here. That is the correct
// behaviour and it is load-bearing: inventing a 0 for an unobserved category
// would render "community collapsed" on every single token, forever.
//
// `confidence` being absent also means confidenceRegressed() is always false in
// this lane — which is safe, because the lane has a STRONGER guarantee already:
// _rescanEngine writes a snapshot only from a COMPLETE fetch, so a thin
// observation never reaches storage to be compared in the first place.
export function adaptWatchSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const score = num(snapshot.trustScore) ?? num(snapshot.score);
  if (score === null) return null;
  const signals = snapshot.signals || {};
  return {
    score,
    riskLevel: snapshot.riskLevel || null,
    liquidityUsd: num(signals.totalLiquidityUsd),
    topHolderPercent: num(signals.topHolderPercent),
  };
}

// The gradual, scored changes between two watch-lane snapshots, via the shared
// brain. Returns [] when either side is missing or unscoreable.
export function watchScoreChanges(prev, current) {
  const before = adaptWatchSnapshot(prev);
  const after = adaptWatchSnapshot(current);
  if (!before || !after) return [];
  return diffSnapshots(before, after);
}

// The risk-LEVEL transition between two watch-lane snapshots, or null.
export function watchRiskChange(prev, current) {
  const before = adaptWatchSnapshot(prev);
  const after = adaptWatchSnapshot(current);
  if (!before || !after) return null;
  return riskLevelChange(before, after);
}

// The categorical events, as structured CODES rather than sentences:
// [{ code, params }]. Three consumers render these, and they must never
// disagree about what happened:
//
//   - the email digest, in English, via changeReasons() in alerts-run.mjs;
//   - the in-app notification center, in the reader's own language, by passing
//     the code to the client's i18n at RENDER time;
//   - the Watchtower Report, likewise localized at render.
//
// Splitting detection from wording is what makes the last two possible. A
// sentence built here is frozen in English forever; a code is late-bound.
export function changeReasonCodes(prev, current) {
  const codes = [];
  const before = prev?.signals;
  const after = current?.signals;
  if (!before || !after) return codes;

  const prevLiq = num(before.totalLiquidityUsd);
  const currLiq = num(after.totalLiquidityUsd);
  if (prevLiq !== null && currLiq !== null && prevLiq > 0) {
    // A total drain is the headline event, named as what it is rather than as
    // "liquidity dropped 100%".
    if (currLiq === 0) codes.push({ code: 'liquidityRemoved', params: {} });
    else if ((currLiq - prevLiq) / prevLiq <= -0.1) {
      codes.push({ code: 'liquidityDropped', params: { percent: Math.round(Math.abs((currLiq - prevLiq) / prevLiq) * 100) } });
    }
  }

  const prevHolder = num(before.topHolderPercent);
  const currHolder = num(after.topHolderPercent);
  if (prevHolder !== null && currHolder !== null && currHolder - prevHolder >= 3) {
    codes.push({ code: 'topHolderGrew', params: { from: prevHolder, to: currHolder } });
  }

  // An authority flipping back on is a categorical change, not a gradual one:
  // someone can now mint or freeze supply that they previously could not.
  //
  // The `=== false` / `=== true` comparison is exact on purpose. _volatileSignals
  // stores null for "the provider did not tell us", and null must never read as
  // "was disabled" — that would fire a mint-re-enabled alarm on the first run
  // after any provider gap, which is a false alarm about someone's money.
  if (before.mintAuthorityEnabled === false && after.mintAuthorityEnabled === true) {
    codes.push({ code: 'mintReenabled', params: {} });
  }
  if (before.freezeAuthorityEnabled === false && after.freezeAuthorityEnabled === true) {
    codes.push({ code: 'freezeReenabled', params: {} });
  }

  // ── Holder base health ─────────────────────────────────────────────────────
  //
  // The on-chain community, measured by the only metric that cannot be bought.
  // Follower counts cost $50 to fake; a holder base is a ledger fact. A base
  // that is draining is a community problem no amount of engagement disguises.
  //
  // Both directions are reported: growth is genuinely good news and a monitoring
  // service that only ever delivers bad news trains people to dread opening it.
  const prevHolders = num(before.holderCount);
  const currHolders = num(after.holderCount);
  if (prevHolders !== null && currHolders !== null && prevHolders > 0) {
    const ratio = (currHolders - prevHolders) / prevHolders;
    if (ratio <= -0.2) codes.push({ code: 'holdersFell', params: { percent: Math.round(Math.abs(ratio) * 100) } });
    else if (ratio <= -HOLDER_BASE_DRIFT) codes.push({ code: 'holderBaseShrank', params: { percent: Math.round(Math.abs(ratio) * 100) } });
    else if (ratio >= HOLDER_BASE_DRIFT) codes.push({ code: 'holderBaseGrew', params: { percent: Math.round(ratio * 100) } });
  }

  codes.push(...devWalletReasonCodes(before.devWallet, after.devWallet));

  return codes;
}

// Below the existing 20% `holdersFell` alarm, this is the gentler "your holder
// base is drifting" band. Conservative enough that ordinary churn on a large
// token does not trip it every single run.
const HOLDER_BASE_DRIFT = 0.05;

// How far a developer's stake must move to be worth reporting, in percentage
// points of supply. A deployer trimming 0.01% is noise; half a point is a
// decision. Absolute points rather than a ratio, because a creator going from
// 0.2% to 0.1% is a 50% "drop" that means almost nothing in supply terms.
const DEV_STAKE_MOVE_POINTS = 0.5;

// Developer-wallet change detection.
//
// TWO CHAINS, TWO GENUINELY DIFFERENT SIGNALS — see parseDevWallet() in
// _volatileSignals.mjs. EVM exposes the deployer's remaining stake; Solana
// exposes who holds each privileged authority. Both are real; neither is
// simulated to make the other chain look complete.
//
// THE NULL RULE IS THE WHOLE SAFETY PROPERTY HERE. Every field is null when
// GoPlus did not answer, and a null on EITHER side skips the comparison
// entirely. Without that, the first successful fetch after a provider gap would
// report "the developer dumped their entire stake" — a maximally alarming,
// completely false claim about someone's money. Absence is not zero, and it is
// certainly not a sale.
export function devWalletReasonCodes(before, after) {
  const codes = [];
  if (!before || !after) return codes;

  // EVM: the deployer's and owner's remaining share of supply.
  for (const [role, addressKey, percentKey] of [
    ['creator', 'creatorAddress', 'creatorPercent'],
    ['owner', 'ownerAddress', 'ownerPercent'],
  ]) {
    const prevPercent = num(before[percentKey]);
    const currPercent = num(after[percentKey]);
    if (prevPercent !== null && currPercent !== null) {
      const delta = currPercent - prevPercent;
      if (delta <= -DEV_STAKE_MOVE_POINTS) {
        codes.push({ code: `${role}StakeFell`, params: { from: prevPercent, to: currPercent } });
      } else if (delta >= DEV_STAKE_MOVE_POINTS) {
        codes.push({ code: `${role}StakeGrew`, params: { from: prevPercent, to: currPercent } });
      }
    }

    // Control changing hands. Only reported when BOTH addresses are known —
    // a null previous address is "we did not know who it was", not "it changed".
    const prevAddress = before[addressKey];
    const currAddress = after[addressKey];
    if (prevAddress && currAddress && prevAddress !== currAddress) {
      codes.push({ code: `${role}Changed`, params: { from: prevAddress, to: currAddress } });
    }
  }

  // Solana: WHO holds each privileged authority. The powers themselves are
  // already covered by mintReenabled/freezeReenabled above — this is the
  // orthogonal question of whether they moved to a different wallet, which the
  // status flags cannot express.
  for (const [key, code] of [
    ['mintAuthorities', 'mintAuthorityMoved'],
    ['freezeAuthorities', 'freezeAuthorityMoved'],
    ['balanceAuthorities', 'balanceAuthorityMoved'],
    ['metadataAuthorities', 'metadataAuthorityMoved'],
  ]) {
    const prevList = before[key];
    const currList = after[key];
    // Arrays are pre-sorted by addressList(), so this compares sets, not order.
    if (!Array.isArray(prevList) || !Array.isArray(currList)) continue;
    if (prevList.join(',') === currList.join(',')) continue;
    // An authority being RENOUNCED (list emptied) is good news and named as such;
    // anything else is a transfer of control the holder did not consent to.
    if (prevList.length && !currList.length) codes.push({ code: `${code}Renounced`, params: {} });
    else codes.push({ code, params: { count: currList.length } });
  }

  return codes;
}

// Codes that mean "act now" rather than "your score moved" — an authority the
// owner regained, or the liquidity simply gone. Shared so the notification
// severity and the report's attention ranking agree on what is critical.
// Note what is deliberately NOT here: every *Renounced code, and the
// *StakeGrew / holderBaseGrew codes. Those are good news. A monitoring product
// that flags improvements as urgent is a product people mute.
export const CRITICAL_REASON_CODES = new Set([
  'liquidityRemoved',
  'mintReenabled',
  'freezeReenabled',
  // A privileged authority moving to a DIFFERENT wallet is a transfer of
  // control the holder never agreed to, and is exactly as actionable as the
  // authority being re-enabled in the first place.
  'mintAuthorityMoved',
  'freezeAuthorityMoved',
  'balanceAuthorityMoved',
  // The deployer reducing their own stake is the classic pre-rug move: it
  // precedes the liquidity pull rather than following it, which is the entire
  // reason to watch for it.
  'creatorStakeFell',
  'ownerStakeFell',
  'creatorChanged',
  'ownerChanged',
]);

export function hasCriticalReason(codes = []) {
  return codes.some(({ code }) => CRITICAL_REASON_CODES.has(code));
}
