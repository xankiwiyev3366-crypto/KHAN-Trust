// Premium-only deep research composer. Like khanAnalyst.js, this is
// deliberately deterministic: every field is composed from data the scoring
// engine already produced (positiveSignals, hiddenRiskSignals, scamRisk,
// scoreBreakdown, realData) - there is NO external LLM call and nothing here
// can assert anything the underlying data doesn't support. It is rendered only
// for Premium users (see AdvancedResearchCard / PremiumAnalysisCard in
// src/main.jsx); this module itself does no gating, it just builds the text.
import { translate as t } from './i18n/index.js';

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

// Derived strengths/weaknesses on top of whatever explicit signals exist, so
// the lists are never empty for a project that still scored.
function deriveStrengths(project) {
  const list = [...(project.positiveSignals || [])];
  const b = project.scoreBreakdown || {};
  if (num(b.liquidityScore) !== null && b.liquidityScore >= 15) list.push(t('advancedResearch.derived.deepLiquidity'));
  if (num(b.topHolderScore) !== null && b.topHolderScore >= 15) list.push(t('advancedResearch.derived.distributedSupply'));
  if (num(project.trustScore) >= 70) list.push(t('advancedResearch.derived.highTrust'));
  return [...new Set(list)];
}

function deriveWeaknesses(project) {
  const list = [...(project.hiddenRiskSignals || [])];
  if (num(project.trustScore) !== null && project.trustScore < 45) list.push(t('advancedResearch.derived.lowTrust'));
  if ((project.missingDataFields || []).length >= 3) list.push(t('advancedResearch.derived.thinData'));
  return [...new Set(list)];
}

function potentialRisks(project) {
  const scam = project.scamRisk?.reasons || [];
  const hidden = project.hiddenRiskSignals || [];
  const merged = [...new Set([...scam, ...hidden])];
  return merged.length ? merged : [t('advancedResearch.noMajorRisks')];
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

function recommendations(project) {
  const recs = [];
  const risk = String(project.riskLevel || 'medium').toLowerCase();
  if (risk === 'high' || risk === 'critical' || risk === 'severe') recs.push(t('premiumAnalysis.recs.highRisk'));
  if (num(liquidityUsd(project)) !== null && liquidityUsd(project) < 50000) recs.push(t('premiumAnalysis.recs.thinLiquidity'));
  if (num(realData(project).topHolderPercent) > 40) recs.push(t('premiumAnalysis.recs.concentration'));
  if ((project.missingDataFields || []).length) recs.push(t('premiumAnalysis.recs.verifyMissing'));
  recs.push(t('premiumAnalysis.recs.alwaysDyor'));
  return [...new Set(recs)];
}

export function buildPremiumAnalysis(project) {
  const conf = aiConfidenceLevel(project);
  const dq = dataQuality(project);
  return {
    explanation: project.aiRiskSummary
      ? t('premiumAnalysis.explanationWithSummary', { summary: project.aiRiskSummary })
      : t('premiumAnalysis.explanationFallback', {
          score: num(project.trustScore) ?? 0,
          risk: t(`common.${String(project.riskLevel || 'medium').toLowerCase()}`),
        }),
    riskConfidenceScore: num(project.confidenceScore) ?? 0,
    aiConfidence: { level: t(`premiumAnalysis.confidence.${conf.key}`), pct: conf.pct },
    bullish: project.positiveSignals || [],
    bearish: [...new Set([...(project.hiddenRiskSignals || []), ...(project.scamRisk?.reasons || [])])],
    dataQuality: dq,
    missingInfo: project.missingDataFields || [],
    recommendations: recommendations(project),
  };
}
