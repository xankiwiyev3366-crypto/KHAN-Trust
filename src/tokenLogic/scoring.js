// Score computation wrappers, extracted verbatim from src/main.jsx. Thin,
// explainable adapters over the shared trustScore engine: compute the trust
// score, build the score/category breakdowns, derive the deterministic scam-risk
// signal, and the community score. Pure — deps are the trustScore engine
// (calculateLiveScores/calculateManualScores/clamp/hasValue), i18n, and formatters.
import { translate } from '../i18n/index.js';
import { clamp, calculateLiveScores, calculateManualScores, hasValue } from '../lib/trustScore.js';
import { formatPercent } from '../format.js';
import { TRUST_CATEGORIES } from '../riskHistory.js';

export function calculateTrustScore(project, liveData = project?.realData) {
  if (liveData) {
    return calculateLiveScores(project, liveData).finalTrustScore;
  }
  return calculateManualScores(project).finalTrustScore;
}

export function buildScoreBreakdown(project, holders, communitySize, score) {
  if (project.realData) {
    const liveScores = calculateLiveScores(project, project.realData);
    return {
      marketCapScore: liveScores.marketCapScore,
      liquidityScore: liveScores.liquidityScore,
      holderScore: liveScores.holderScore,
      topHolderScore: liveScores.topHolderScore,
      topTenHolderScore: liveScores.topTenHolderScore,
      tokenAgeScore: liveScores.tokenAgeScore,
      websiteScore: liveScores.websiteScore,
      twitterScore: liveScores.twitterScore,
      telegramScore: liveScores.telegramScore,
      githubScore: liveScores.githubScore,
      coingeckoScore: liveScores.coingeckoScore,
      socialScore: liveScores.socialScore,
      holderGrowthScore: liveScores.holderGrowthScore,
      supplyScore: liveScores.supplyScore,
      securityScore: liveScores.securityScore,
      marketActivityScore: liveScores.marketActivityScore,
      finalTrustScore: liveScores.finalTrustScore,
    };
  }

  return calculateManualScores(project);
}

// Groups the existing fine-grained scores into the 5 named categories a
// research-platform-style breakdown shows (Contract Security, Liquidity,
// Holder Health, Market Activity, Community). This is purely a display
// aggregation over scores that calculateLiveScores already computed -
// it does not change finalTrustScore or any individual score's math.
// Single source of truth now lives in riskHistory.js so the live report and the
// Risk History timeline can never drift on how a category is composed (imported
// above as TRUST_CATEGORIES).

export function buildCategoryBreakdown(scoreBreakdown = {}) {
  return TRUST_CATEGORIES.map((category) => {
    const values = category.scoreKeys
      .map((key) => scoreBreakdown[key])
      .filter((value) => value !== null && value !== undefined);
    const score = values.length ? Math.round(values.reduce((total, value) => total + value, 0) / values.length) : null;
    return {
      key: category.key,
      labelKey: category.labelKey,
      score,
      // /20 scale to match the "Contract Security 18/20" style breakdown -
      // purely a display rescale of the same 0-100 average, not a new score.
      outOf20: score === null ? null : Math.round(score / 5),
      available: values.length > 0,
    };
  });
}

// Rule-based scam-risk signal built only from real, already-fetched data
// (holder concentration, liquidity, social presence, mint/freeze/upgrade
// flags, token age). Never penalizes a category that is simply unknown -
// only confirmed-true findings add risk points, consistent with the rest
// of the engine's "Unknown != Bad" policy. Deeper checks this can't cover
// without a specialized API (honeypot simulation, LP lock/burn, clone-site
// detection) are intentionally left out rather than guessed - see
// SCAM_RISK_COVERAGE_NOTE below for what's not covered.
// `reasons` (English, interpolated) is kept for backward compatibility with
// existing consumers (PDF export, premiumResearch.js dedup-by-string). The
// parallel `reasonKeys` array (translation key + params, no English baked in)
// is what the UI renders, via t(), so it re-translates instantly on language
// switch instead of freezing whatever language was active when the project
// was last normalized (see ScamRiskCard).
export function calculateScamRisk(project = {}, data = {}) {
  const reasons = [];
  const reasonKeys = [];
  let riskPoints = 0;

  const addRisk = (points, reason, key, params) => {
    riskPoints += points;
    reasons.push(reason);
    reasonKeys.push({ key, params });
  };

  if (typeof data.topHolderPercent === 'number' && data.topHolderPercent > 50) {
    addRisk(25, `Largest holder controls ${formatPercent(data.topHolderPercent)} of supply`, 'topHolderConcentration', { pct: formatPercent(data.topHolderPercent) });
  }
  if (typeof data.topTenHolderPercent === 'number' && data.topTenHolderPercent > 80) {
    addRisk(20, `Top 10 holders control ${formatPercent(data.topTenHolderPercent)} of supply`, 'topTenConcentration', { pct: formatPercent(data.topTenHolderPercent) });
  }

  const liquidity = Number(data.totalLiquidityUsd ?? data.liquidityUsd ?? 0);
  if (data.socialMetadataAvailable && !liquidity) {
    addRisk(15, 'No public liquidity was found for this token', 'noLiquidityFound');
  } else if (liquidity > 0 && liquidity < 2000) {
    addRisk(15, 'Liquidity is extremely low (under $2,000)', 'extremelyLowLiquidity');
  }

  const noSocial = !hasValue(project.website) && !hasValue(project.twitter) && !hasValue(project.telegram);
  if (noSocial && data.socialMetadataAvailable) {
    addRisk(15, 'No website, X/Twitter, or Telegram presence found', 'noSocialPresence');
  }

  if (data.mintAuthorityEnabled === true) addRisk(10, 'Mint authority is still enabled', 'mintAuthorityEnabled');
  if (data.freezeAuthorityEnabled === true) addRisk(10, 'Freeze authority is still enabled', 'freezeAuthorityEnabled');
  if (data.upgradeable === true) addRisk(10, 'Contract is upgradeable', 'contractUpgradeable');

  if (typeof data.tokenAgeDays === 'number' && data.tokenAgeDays < 3) {
    addRisk(10, 'Token is less than 3 days old', 'veryNewToken');
  }

  const riskScore = clamp(riskPoints, 0, 100);
  const level = riskScore >= 50 ? 'High' : riskScore >= 25 ? 'Medium' : 'Low';
  return { riskScore, level, reasons, reasonKeys };
}

// Render-time translation of scam-risk reasons - always uses the current
// language via t(), unlike the frozen `reasons` array baked in at normalize
// time. Falls back to the raw English reason only if a reasonKeys entry is
// somehow missing (should not happen for anything produced by
// calculateScamRisk above).
export function translatedScamReasons(scamRisk, t) {
  if (scamRisk?.reasonKeys?.length) {
    return scamRisk.reasonKeys.map(({ key, params }) => t(`scamRisk.reasons.${key}`, params));
  }
  return scamRisk?.reasons || [];
}

// Deliberately NOT implemented (would require fabricating data or a paid
// specialized API rather than reading real on-chain/market data):
// honeypot/transfer-restriction simulation, LP lock/burn status, fake
// website or clone-branding detection. These would need GoPlus Security,
// RugCheck, or TokenSniffer-style integrations - documented here rather
// than guessed.
export const SCAM_RISK_COVERAGE_NOTE = 'Concentration, liquidity, social presence, mint/freeze/upgrade authority, and token age only.';

export function communityScore(size) {
  if (!size) return 0;
  return clamp(Math.round(Number(size) / 1000), 0, 15);
}
