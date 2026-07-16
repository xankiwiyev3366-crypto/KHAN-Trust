// The trust scoring engine — the single source of truth for what a KHAN Trust
// score IS, shared by the browser and by Netlify Functions.
//
// WHY THIS MODULE EXISTS
//
// This code used to live inside src/main.jsx, an 11,480-line React entry file.
// That made it unreachable from the server: you cannot import JSX into a
// Netlify Function. So scores could only ever be computed in a user's browser,
// which meant a token's snapshot only refreshed when a human happened to look
// at it — and that, in turn, is why the alert loop (alerts-run.mjs) could never
// fire for a dormant token. The retention engine was blocked on a file layout.
//
// THE RULE THIS MODULE ENFORCES: ONE SCORER, NOT TWO
//
// The obvious shortcut is a server-side copy of the maths. That would be a
// silent catastrophe. alerts-run decides "this token got riskier" by comparing
// two scores over time. If the score that wrote the baseline and the score that
// writes the next snapshot come from two implementations, they drift — and
// every drift is indistinguishable from a real risk change. The product would
// email "your token got riskier" when nothing happened, from a platform whose
// entire value is trust. So: one implementation, imported by both sides. A
// divergence becomes impossible rather than merely unlikely.
//
// CONSTRAINTS THIS FILE MUST KEEP
//
//   - Pure. No React, no window/document/localStorage, no fetch, no i18n.
//     It is imported into a CJS-bundled Netlify Function; anything
//     environment-specific breaks the deploy, not the test run.
//   - No top-level await (esbuild targets CJS for functions — see
//     scripts/verify-functions.mjs for the deploy failure this caused before).
//   - Behaviour-preserving. Every threshold below is byte-identical to the
//     original main.jsx implementation; tests/trustScore.test.mjs pins that.
//     This was a MOVE, not a rewrite. Tuning the engine is a separate decision
//     from making it reachable, and mixing the two would make a scoring change
//     impossible to review.

// ── Primitives ────────────────────────────────────────────────────────────────

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// The platform's sentinel strings for "we looked and found nothing". Treating
// them as absent (rather than as a value) is what keeps a missing field from
// scoring as though it were present.
export function hasValue(value) {
  return Boolean(value && !['Not provided', 'Not available', 'Missing', 'Data unavailable'].includes(value));
}

export function firstPresent(...values) {
  return values.find((value) => hasValue(value)) || '';
}

export function weightedAverage(items) {
  const available = items.filter(([value]) => value !== null && value !== undefined);
  if (!available.length) return 5;
  const totalWeight = available.reduce((total, [, weight]) => total + weight, 0);
  const total = available.reduce((sum, [value, weight]) => sum + value * weight, 0);
  return Math.round(total / totalWeight);
}

export function scoreToRisk(score) {
  if (score >= 78) return 'Low';
  if (score >= 55) return 'Medium';
  return 'High';
}

// Maximum combined penalty (liveDataPenalty + riskPenalty) that can be subtracted from
// the weighted score, so a fully-completed profile keeps a meaningful score advantage
// over an identical project with no profile data, regardless of how risky the chain data is.
export const MAX_TRUST_SCORE_PENALTY = 35;

// ── Profile signals ───────────────────────────────────────────────────────────

export function isPublicFounder(status = '') {
  const text = status.toLowerCase();
  return text.includes('public') || text.includes('doxxed') || text.includes('known');
}

export function hasRoadmap(project = {}) {
  return hasValue(project.roadmapText) || (project.roadmap && project.roadmap.some((item) => hasValue(item.phase)));
}

export function scoreFounder(status = '') {
  if (!hasValue(status)) return null;
  const text = status.toLowerCase();
  if (text.includes('anonymous')) return 18;
  if (isPublicFounder(status)) return 72;
  return 42;
}

export function socialPresenceState(kind, project = {}, data = {}) {
  const fieldMap = {
    website: ['website', 'websiteUrl'],
    twitter: ['twitter', 'twitterUrl', 'xUrl'],
    telegram: ['telegram', 'telegramUrl'],
    github: ['github', 'githubUrl'],
    discord: ['discord', 'discordUrl'],
  };
  const value = firstPresent(...fieldMap[kind].flatMap((field) => [project[field], data[field]]));
  if (value) return { state: 'Present', value };
  if (data.socialMetadataAvailable === false) return { state: 'Data unavailable', value: 'Data unavailable' };
  return { state: 'Missing', value: 'Missing' };
}

export function scorePresence(value) {
  const state = typeof value === 'string' ? value : value?.state;
  if (state === 'Present') return 88;
  if (state === 'Data unavailable') return 44;
  if (state === 'Missing') return 26;
  return hasValue(value) ? 88 : 44;
}

export function scoreSocial(project = {}, data = {}) {
  data = data || {};
  const checks = [
    socialPresenceState('website', project, data).state === 'Present',
    socialPresenceState('twitter', project, data).state === 'Present',
    socialPresenceState('telegram', project, data).state === 'Present',
    hasValue(firstPresent(project.github, data.githubUrl)),
  ];
  const count = checks.filter(Boolean).length;
  if (!count) return null;
  return [0, 28, 55, 78, 92][count];
}

// ── Market / on-chain signals ─────────────────────────────────────────────────

export function scoreMarketCap(value) {
  const amount = Number(value || 0);
  if (!amount) return null;
  if (amount >= 10000000) return 95;
  if (amount >= 1000000) return 82;
  if (amount >= 100000) return 65;
  if (amount >= 10000) return 42;
  return 12;
}

export function scoreLiquidity(value) {
  const amount = Number(value || 0);
  if (!amount) return null;
  if (amount >= 1000000) return 95;
  if (amount >= 250000) return 84;
  if (amount >= 50000) return 68;
  if (amount >= 10000) return 48;
  if (amount >= 5000) return 34;
  return 10;
}

export function scoreHolders(value) {
  const count = Number(value || 0);
  if (!count) return null;
  if (count >= 10000) return 95;
  if (count >= 5000) return 84;
  if (count >= 1000) return 70;
  if (count >= 500) return 52;
  if (count >= 100) return 32;
  return 10;
}

// Distribution proxy for a NATIVE asset (BTC, ETH, SOL...) whose holder count no
// single explorer can report. Used only as the LAST holder-health signal, after a
// real on-chain holder count has been attempted, and mirrors the engine's policy
// of crediting verifiable listing/rank signals. Returns null when rank is
// unknown, so nothing is invented.
export function scoreNativeHolderDistribution(marketCapRank) {
  const rank = Number(marketCapRank || 0);
  if (!rank) return null;
  if (rank <= 3) return 96;
  if (rank <= 10) return 90;
  if (rank <= 25) return 82;
  if (rank <= 50) return 72;
  if (rank <= 100) return 60;
  return 48;
}

export function scoreTokenAge(days) {
  if (days === null || days === undefined) return null;
  if (days >= 365) return 95;
  if (days >= 180) return 82;
  if (days >= 90) return 66;
  if (days >= 30) return 48;
  if (days >= 7) return 25;
  return 8;
}

export function scoreTopHolder(percent) {
  if (percent === null || percent === undefined) return null;
  if (percent <= 5) return 94;
  if (percent <= 10) return 82;
  if (percent <= 20) return 62;
  if (percent <= 35) return 38;
  return 12;
}

export function scoreTopTenHolder(percent) {
  if (percent === null || percent === undefined) return null;
  if (percent <= 25) return 92;
  if (percent <= 40) return 78;
  if (percent <= 55) return 58;
  if (percent <= 70) return 34;
  return 10;
}

export function scoreHolderGrowth(percent) {
  if (percent === null || percent === undefined) return null;
  if (percent >= 25) return 88;
  if (percent >= 10) return 72;
  if (percent >= 1) return 58;
  if (percent === 0) return 45;
  return 24;
}

export function scoreSecurity(mintAuthorityEnabled, freezeAuthorityEnabled, upgradeable) {
  const flags = [mintAuthorityEnabled, freezeAuthorityEnabled, upgradeable];
  if (flags.every((value) => value === null || value === undefined)) return null;
  const enabledCount = flags.filter((value) => value === true).length;
  if (enabledCount === 0) return 92;
  if (enabledCount === 1) return 52;
  return 18;
}

export function scoreSupply(value) {
  const supply = Number(value || 0);
  if (!supply) return null;
  if (supply <= 1000000000) return 72;
  if (supply <= 10000000000) return 62;
  if (supply <= 100000000000) return 50;
  return 38;
}

// Real trading activity, not just a liquidity snapshot - a token can have a
// deep pool that nobody is actually trading against. Scored relative to its
// own liquidity (turnover) when both are known, falling back to absolute
// volume only when liquidity is unavailable (e.g. a native asset).
export function scoreMarketActivity(volume24hUsd, liquidityUsd) {
  if (volume24hUsd === null || volume24hUsd === undefined) return null;
  if (!volume24hUsd) return 15;
  if (!liquidityUsd) {
    if (volume24hUsd >= 1000000) return 85;
    if (volume24hUsd >= 100000) return 65;
    if (volume24hUsd >= 10000) return 45;
    return 25;
  }
  const turnover = volume24hUsd / liquidityUsd;
  if (turnover >= 0.5 && volume24hUsd >= 10000) return 88;
  if (turnover >= 0.1 && volume24hUsd >= 1000) return 68;
  return 40;
}

// ── Penalties ─────────────────────────────────────────────────────────────────

// Large, CoinGecko-verified assets (BTC, ETH, USDC, ...) routinely have no
// "liquidity pool" or "holder count" concept the way a DEX-traded token
// does - missing that data is not a risk signal for them. The flat "missing
// data" penalties below only apply to unverified/lower-cap tokens, where an
// absent metric is itself a real transparency gap worth flagging.
export function isLargeVerifiedAsset(data = {}) {
  return Boolean(data.coingeckoListed) && Number(data.marketCapUsd || 0) >= 50000000;
}

export function liveDataPenalty(data = {}, holderCount = 0) {
  let penalty = 0;
  const liquidity = Number(data.totalLiquidityUsd ?? data.liquidityUsd ?? 0);
  const skipMissingDataPenalty = isLargeVerifiedAsset(data);
  if (!liquidity && !skipMissingDataPenalty) penalty += 4;
  if (liquidity > 0 && liquidity < 5000) penalty += 12;
  if (holderCount > 0 && holderCount < 100) penalty += 10;
  if (!holderCount && !skipMissingDataPenalty) penalty += 3;
  if (data.tokenAgeDays !== null && data.tokenAgeDays !== undefined && data.tokenAgeDays < 7) penalty += 8;
  if (data.topHolderPercent > 35) penalty += 12;
  if (data.topTenHolderPercent > 70) penalty += 10;
  return penalty;
}

// Phrases here ('low liquidity', 'low holders', 'very new') describe the same conditions
// already scored by liveDataPenalty (liquidity/holderCount/tokenAgeDays/concentration).
// They are excluded when liveData is present so a project isn't penalized twice for one signal.
export function riskPenalty(notes = '', { excludeLiveDataDupes = false } = {}) {
  const text = notes.toLowerCase();
  const penalties = [
    ['anonymous', 10],
    ['no roadmap', 8],
    ['mint authority enabled', 10],
    ['freeze authority enabled', 10],
    ['upgradeable contract', 8],
    ...(excludeLiveDataDupes ? [] : [
      ['low liquidity', 10],
      ['low holders', 7],
      ['very new', 6],
    ]),
  ];
  return penalties.reduce((total, [phrase, value]) => total + (text.includes(phrase) ? value : 0), 0);
}

// ── The engine ────────────────────────────────────────────────────────────────

export function calculateLiveScores(project = {}, data = {}) {
  const holderCount = Number(data.holderCount || project.holders || project.communitySize || 0);
  const websiteScore = scorePresence(socialPresenceState('website', project, data));
  const twitterScore = scorePresence(socialPresenceState('twitter', project, data));
  const telegramScore = scorePresence(socialPresenceState('telegram', project, data));
  const githubScore = scorePresence(socialPresenceState('github', project, data));
  // Listing on a major independent research platform (CoinGecko) is a real,
  // checkable signal of project legitimacy - only awarded when actually
  // confirmed listed, never assumed.
  const coingeckoScore = data.coingeckoListed ? 85 : null;
  const founderScore = scoreFounder(project.founderStatus);
  const roadmapScore = hasRoadmap(project) ? 68 : null;
  const communityScoreValue = scoreHolders(project.communitySize);
  const descriptionScore = hasValue(project.description) ? 58 : null;
  const socialScoreInputs = [websiteScore, twitterScore, telegramScore, githubScore].filter((value) => value !== null && value !== undefined);
  // Holder-health signal with a provider fallback chain: a real on-chain holder
  // count first (works for tokens and for native chains Blockchair covers),
  // then - for a native asset only - the CoinGecko market-rank distribution
  // proxy, so a top base-layer coin never reads as "Holder Health: Not
  // Available" when its distribution is verifiably broad. Non-native tokens are
  // unaffected: the fallback only fires when data.isNativeAsset is true.
  const holderScore = scoreHolders(holderCount)
    ?? (data.isNativeAsset ? scoreNativeHolderDistribution(data.marketCapRank) : null);
  const scores = {
    marketCapScore: scoreMarketCap(data.marketCapUsd),
    liquidityScore: scoreLiquidity(data.totalLiquidityUsd ?? data.liquidityUsd),
    holderScore,
    topHolderScore: scoreTopHolder(data.topHolderPercent),
    topTenHolderScore: scoreTopTenHolder(data.topTenHolderPercent),
    tokenAgeScore: scoreTokenAge(data.tokenAgeDays),
    websiteScore,
    twitterScore,
    telegramScore,
    githubScore,
    coingeckoScore,
    socialScore: socialScoreInputs.length ? Math.round(socialScoreInputs.reduce((total, value) => total + value, 0) / socialScoreInputs.length) : null,
    founderActivity: founderScore,
    roadmapClarity: roadmapScore,
    communityActivity: communityScoreValue,
    transparency: descriptionScore,
    holderGrowthScore: scoreHolderGrowth(data.holderGrowthPercent),
    supplyScore: scoreSupply(data.supply),
    securityScore: scoreSecurity(data.mintAuthorityEnabled, data.freezeAuthorityEnabled, data.upgradeable),
    marketActivityScore: scoreMarketActivity(data.volume24hUsd, data.totalLiquidityUsd ?? data.liquidityUsd),
  };
  const weighted = weightedAverage([
    [scores.holderScore, 16],
    [scores.topHolderScore, 18],
    [scores.topTenHolderScore, 14],
    [scores.tokenAgeScore, 10],
    [scores.liquidityScore, 16],
    [scores.marketCapScore, 6],
    [scores.securityScore, 8],
    [scores.marketActivityScore, 6],
    [scores.websiteScore, 6],
    [scores.twitterScore, 6],
    [scores.telegramScore, 5],
    [scores.githubScore, 3],
    [scores.coingeckoScore, 4],
    [scores.founderActivity, 7],
    [scores.roadmapClarity, 6],
    [scores.communityActivity, 5],
    [scores.transparency, 3],
  ]);
  const livePenaltyValue = liveDataPenalty(data, holderCount);
  const riskPenaltyValue = riskPenalty(project.riskNotes, { excludeLiveDataDupes: true });
  // Cap total penalty so a project with a complete profile (social links, founder
  // status, description, roadmap) can never be fully cancelled out by on-chain risk
  // signals alone — those signals still matter, but profile quality keeps contributing.
  const penalty = Math.min(livePenaltyValue + riskPenaltyValue, MAX_TRUST_SCORE_PENALTY);
  // A large, CoinGecko-verified asset should never read as "high risk" just
  // because one source (e.g. a DEX liquidity pool, an on-chain holder scan)
  // didn't return data for it - confidence floor, not a fabricated score.
  const verifiedFloor = isLargeVerifiedAsset(data) ? 70 : 0;
  const finalTrustScore = clamp(Math.max(5, verifiedFloor, weighted - penalty), 5, 100);
  return {
    ...scores,
    finalTrustScore,
  };
}

export function calculateManualScores(project = {}) {
  const socialScore = scoreSocial(project, project.realData);
  const founderScore = scoreFounder(project.founderStatus) ?? 42;
  const roadmapScore = hasRoadmap(project) ? 68 : null;
  const communityScoreValue = scoreHolders(project.communitySize);
  const available = [socialScore, founderScore, roadmapScore, communityScoreValue].filter((value) => value !== null);
  const average = available.length ? Math.round(available.reduce((total, value) => total + value, 0) / available.length) : 5;

  return {
    founderActivity: founderScore,
    communityActivity: communityScoreValue,
    roadmapClarity: roadmapScore,
    transparency: socialScore,
    socialProof: socialScore,
    finalTrustScore: clamp(Math.max(5, average - Math.min(riskPenalty(project.riskNotes), MAX_TRUST_SCORE_PENALTY)), 5, 100),
  };
}
