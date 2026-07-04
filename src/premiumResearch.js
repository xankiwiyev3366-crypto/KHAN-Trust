// Premium-only deep research composer. Like khanAnalyst.js, this is
// deliberately deterministic: every field is composed from data the scoring
// engine already produced (positiveSignals, hiddenRiskSignals, scamRisk,
// scoreBreakdown, realData) - there is NO external LLM call and nothing here
// can assert anything the underlying data doesn't support. It is rendered only
// for Premium users (see AdvancedResearchCard / PremiumAnalysisCard in
// src/main.jsx); this module itself does no gating, it just builds the text.
import { translate as t } from './i18n/index.js';
import { translateSignalKeys, translatedCategory, translatedModifier } from './khanAnalyst.js';

// Canonical mapping from raw scoring-engine field names to the humanized
// `missingDataLabels.*` translation keys. Lives here (a plain module) so both
// the Premium research and the profile card in main.jsx translate missing-data
// fields identically in the selected language.
export const MISSING_DATA_LABEL_KEYS = {
  marketCapUsd: 'marketCap',
  totalLiquidityUsd: 'liquidity',
  holderCount: 'holderCount',
  topHolderPercent: 'topHolder',
  topTenHolderPercent: 'topTenHolders',
  tokenAgeDays: 'tokenAge',
  volume24hUsd: 'volume',
  mintAuthorityEnabled: 'mintAuthority',
  freezeAuthorityEnabled: 'freezeAuthority',
  upgradeable: 'upgradeable',
  coingeckoListed: 'coingecko',
  websiteUrl: 'website',
  twitterUrl: 'twitter',
  telegramUrl: 'telegram',
  githubUrl: 'github',
  priceChange24h: 'priceChange',
  holderGrowthPercent: 'holderGrowth',
  supply: 'supply',
  poolCount: 'pools',
  ath: 'ath',
};

export function friendlyMissingFields(fields = []) {
  return fields.map((field) => {
    const key = MISSING_DATA_LABEL_KEYS[field];
    // Fall back to the raw field only if an unmapped field ever appears, so the
    // UI degrades to something rather than dropping the entry silently.
    return key ? t(`missingDataLabels.${key}`) : field;
  });
}

// Render-time translation of scam-risk reasons: prefers the language-agnostic
// reasonKeys (+params) produced by calculateScamRisk, falling back to the
// English `reasons` array only for older records that predate reasonKeys.
function translatedScamReasons(project) {
  const scamRisk = project.scamRisk;
  if (scamRisk?.reasonKeys?.length) {
    return scamRisk.reasonKeys.map(({ key, params }) => t(`scamRisk.reasons.${key}`, params));
  }
  return scamRisk?.reasons || [];
}

// Rebuilds the free "AI Risk Summary" narrative in the currently selected
// language from the structured fields the scoring engine already produced,
// rather than reusing project.aiRiskSummary (which is frozen English). Mirrors
// buildRiskSummary() in scoringEngine.js piece for piece.
export function buildLocalizedRiskSummary(project = {}) {
  const parts = [];
  const risk = t(`common.${String(project.riskLevel || 'medium').toLowerCase()}`);
  parts.push(t('riskSummary.compose.classified', {
    category: translatedCategory(project.assetCategory),
    risk,
  }));
  const modifier = project.assetTypeRiskModifier;
  const modifierNote = translatedModifier(modifier, project.assetCategory);
  if (modifierNote) {
    parts.push(modifierNote);
    if (modifier?.capApplied) {
      parts.push(t('riskSummary.compose.capApplied', { raw: modifier.rawScore, adjusted: modifier.adjustedScore }));
    }
  }
  const positives = deriveStrengths(project);
  if (positives.length) {
    parts.push(t('riskSummary.compose.strengths', { signals: positives.slice(0, 3).join('; ') }));
  }
  const risks = deriveWeaknesses(project);
  if (risks.length) {
    parts.push(t('riskSummary.compose.concerns', { signals: risks.slice(0, 3).join('; ') }));
  } else {
    parts.push(t('riskSummary.compose.noConcerns'));
  }
  const confidence = t(`common.${String(project.confidenceLabel || 'medium').toLowerCase()}`);
  const missing = friendlyMissingFields((project.missingDataFields || []).slice(0, 5));
  parts.push(missing.length
    ? t('riskSummary.compose.confidenceWithMissing', { confidence, score: project.confidenceScore ?? 0, fields: missing.join(', ') })
    : t('riskSummary.compose.confidence', { confidence, score: project.confidenceScore ?? 0 }));
  return parts.join(' ');
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatUsd(value) {
  const n = num(value);
  if (n === null || n <= 0) return null;
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function realData(project) {
  return project.realData || {};
}

function liquidityUsd(project) {
  const d = realData(project);
  return num(d.totalLiquidityUsd ?? d.liquidityUsd);
}

function holderCount(project) {
  const d = realData(project);
  return num(d.holderCount ?? project.holders ?? project.communitySize);
}

// ── Observations (one sentence each, always safe to render) ───────────────────
function liquidityObservation(project) {
  const liq = liquidityUsd(project);
  const cap = num(realData(project).marketCapUsd);
  if (liq === null) return t('advancedResearch.liquidityUnknown');
  const ratio = cap ? liq / cap : null;
  const depth = ratio === null
    ? t('advancedResearch.depthUnknown')
    : ratio >= 0.1 ? t('advancedResearch.depthDeep')
    : ratio >= 0.03 ? t('advancedResearch.depthModerate')
    : t('advancedResearch.depthShallow');
  return t('advancedResearch.liquidityObservation', { amount: formatUsd(liq) || '—', depth });
}

function holderObservation(project) {
  const holders = holderCount(project);
  const topPct = num(realData(project).topHolderPercent);
  if (holders === null && topPct === null) return t('advancedResearch.holdersUnknown');
  const parts = [];
  if (holders !== null) parts.push(t('advancedResearch.holdersCount', { count: holders.toLocaleString() }));
  if (topPct !== null) {
    const conc = topPct > 50 ? t('advancedResearch.concHigh')
      : topPct > 25 ? t('advancedResearch.concModerate')
      : t('advancedResearch.concLow');
    parts.push(t('advancedResearch.holdersTop', { pct: topPct.toFixed(1), concentration: conc }));
  }
  return parts.join(' ');
}

function communityObservation(project) {
  const size = num(project.communitySize);
  if (size === null || size <= 0) return t('advancedResearch.communityUnknown');
  const level = size >= 20000 ? t('advancedResearch.communityLarge')
    : size >= 5000 ? t('advancedResearch.communityGrowing')
    : t('advancedResearch.communitySmall');
  return t('advancedResearch.communityObservation', { size: size.toLocaleString(), level });
}

function longTermOutlook(project) {
  const score = num(project.trustScore) ?? 0;
  const tone = score >= 70 ? 'positive' : score >= 45 ? 'mixed' : 'cautious';
  return t(`advancedResearch.outlook.${tone}`, {
    score,
    risk: t(`common.${String(project.riskLevel || 'medium').toLowerCase()}`),
  });
}

function overallConclusion(project) {
  const score = num(project.trustScore) ?? 0;
  const verdict = score >= 70 ? 'strong' : score >= 45 ? 'balanced' : 'elevated';
  return t(`advancedResearch.conclusion.${verdict}`, {
    score,
    risk: t(`common.${String(project.riskLevel || 'medium').toLowerCase()}`),
    confidence: t(`common.${String(project.confidenceLabel || 'medium').toLowerCase()}`),
  });
}

// Strengths and Weaknesses are the real, de-duplicated signals the engine
// already detected - no generic filler and no restating the Trust Score, so
// nothing appears without specific data evidence.
function deriveStrengths(project) {
  return [...new Set(translateSignalKeys(project.positiveSignalKeys, project.positiveSignals || []))];
}

function deriveWeaknesses(project) {
  return [...new Set(translateSignalKeys(project.hiddenRiskSignalKeys, project.hiddenRiskSignals || []))];
}

// Potential Risks must be UNIQUE and must not repeat Weaknesses (which is
// exactly hiddenRiskSignals). So Risks are the scam-risk reasons only, with any
// item that already appears in Weaknesses removed. All comparison and output
// is done on the translated strings so dedup holds in every language.
function potentialRisks(project) {
  const weaknesses = new Set(deriveWeaknesses(project));
  const unique = [...new Set(translatedScamReasons(project))].filter((r) => !weaknesses.has(r));
  return unique.length ? unique : [t('advancedResearch.noMajorRisks')];
}

// ── Section 1: Advanced AI Research ───────────────────────────────────────────
export function buildAdvancedResearch(project) {
  return {
    strengths: deriveStrengths(project),
    weaknesses: deriveWeaknesses(project),
    risks: potentialRisks(project),
    communitySignals: communityObservation(project),
    liquidity: liquidityObservation(project),
    holders: holderObservation(project),
    outlook: longTermOutlook(project),
    conclusion: overallConclusion(project),
  };
}

// ── Section 2: Premium AI Analysis ────────────────────────────────────────────
// A distinct, deeper companion to the existing free AI Risk Summary - never a
// replacement for it.
function aiConfidenceLevel(project) {
  const missing = (project.missingDataFields || []).length;
  const hasReal = Boolean(project.realData);
  if (!hasReal || missing >= 4) return { key: 'low', pct: 40 };
  if (missing >= 2) return { key: 'medium', pct: 68 };
  return { key: 'high', pct: 90 };
}

function dataQuality(project) {
  const missing = (project.missingDataFields || []).length;
  const key = missing === 0 ? 'complete' : missing <= 2 ? 'partial' : 'limited';
  return { key, label: t(`premiumAnalysis.dataQuality.${key}`), missingCount: missing };
}

// Recommendations are generated dynamically from the specific weak/missing data
// points detected - never a fixed generic line. When nothing specific fires,
// a single data-driven "clear areas" note is shown instead of boilerplate.
function recommendations(project) {
  const recs = [];
  const risk = String(project.riskLevel || 'medium').toLowerCase();
  if (risk === 'high' || risk === 'critical' || risk === 'severe') recs.push(t('premiumAnalysis.recs.highRisk'));
  if (num(liquidityUsd(project)) !== null && liquidityUsd(project) < 50000) recs.push(t('premiumAnalysis.recs.thinLiquidity'));
  if (num(realData(project).topHolderPercent) > 40) recs.push(t('premiumAnalysis.recs.concentration'));
  if ((project.missingDataFields || []).length) recs.push(t('premiumAnalysis.recs.verifyMissing'));
  if (!recs.length) recs.push(t('premiumAnalysis.recs.monitor'));
  return [...new Set(recs)];
}

export function buildPremiumAnalysis(project) {
  const conf = aiConfidenceLevel(project);
  const dq = dataQuality(project);
  return {
    // Localized, render-time summary so the detailed read switches language
    // with the rest of the UI instead of freezing the English aiRiskSummary.
    explanation: t('premiumAnalysis.explanationWithSummary', { summary: buildLocalizedRiskSummary(project) }),
    riskConfidenceScore: num(project.confidenceScore) ?? 0,
    aiConfidence: { level: t(`premiumAnalysis.confidence.${conf.key}`), pct: conf.pct },
    bullish: deriveStrengths(project),
    bearish: [...new Set([...deriveWeaknesses(project), ...translatedScamReasons(project)])],
    dataQuality: dq,
    missingInfo: project.missingDataFields || [],
    recommendations: recommendations(project),
  };
}
