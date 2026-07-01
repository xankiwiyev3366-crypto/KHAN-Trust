// Phase 5 — Smart Risk History & Intelligent Risk Alerts.
//
// This module is the pure, framework-free brain of the intelligent monitoring
// system. It does ONE new thing on top of the existing Score Memory
// (scoreHistory.js) and Trust Graph Corpus (tokenCorpus.js): it turns the
// per-token daily snapshot stream into a human-readable "what changed and why"
// timeline, and the same diff logic powers the smarter watchlist alerts
// (riskAlerts.js) and the email digest.
//
// Design principles that keep this additive and non-breaking:
//   * It NEVER stores its own data. It derives everything from the snapshots
//     already persisted by scoreHistory.js (the platform-memory store), so
//     there is no duplicate source of truth to keep in sync.
//   * Every function is pure and tolerant of old/thin snapshots: a snapshot
//     recorded before this phase simply lacks the `categories`/`socialScore`
//     fields, and every comparison below treats a missing value as "unknown"
//     and skips it rather than inventing a change.
//   * It imports only the standalone i18n `translate()` mirror (usable outside
//     React), matching riskAlerts.js — so explanations are localized in all
//     four languages with zero new plumbing.
import { translate as t } from './i18n/index.js';

// Single source of truth for the five Trust Score categories. main.jsx imports
// this exact array for its CategoryScoreCards / buildCategoryBreakdown so the
// history view and the live report can never drift apart on how a category is
// composed.
export const TRUST_CATEGORIES = [
  { key: 'contractSecurity', labelKey: 'contractSecurity', scoreKeys: ['securityScore'] },
  { key: 'liquidity', labelKey: 'liquidity', scoreKeys: ['liquidityScore', 'marketCapScore'] },
  { key: 'holderHealth', labelKey: 'holderHealth', scoreKeys: ['holderScore', 'topHolderScore', 'topTenHolderScore', 'holderGrowthScore'] },
  { key: 'marketActivity', labelKey: 'marketActivity', scoreKeys: ['marketActivityScore', 'tokenAgeScore'] },
  { key: 'community', labelKey: 'community', scoreKeys: ['websiteScore', 'twitterScore', 'telegramScore', 'githubScore', 'coingeckoScore', 'founderActivity', 'roadmapClarity', 'transparency'] },
];

// Meaningful-change thresholds. Deliberately conservative so the timeline shows
// real drift, not day-to-day data-source jitter.
const SCORE_CHANGE_THRESHOLD = 3;        // Trust Score points
const CATEGORY_CHANGE_THRESHOLD = 5;     // any 0-100 category score, points
const HOLDER_CHANGE_THRESHOLD = 3;       // top-holder concentration, percentage points
const LIQUIDITY_CHANGE_RATIO = 0.1;      // 10% swing in public liquidity

function round(value) {
  return Math.round(Number(value));
}

// Average the already-computed sub-scores that make up one category, exactly
// the way buildCategoryBreakdown() does in main.jsx. Returns null when none of
// the category's inputs are known, so "unknown" is never rendered as 0.
function categoryScore(scoreBreakdown, category) {
  const values = category.scoreKeys
    .map((key) => scoreBreakdown[key])
    .filter((value) => value !== null && value !== undefined && Number.isFinite(Number(value)));
  if (!values.length) return null;
  return round(values.reduce((total, value) => total + Number(value), 0) / values.length);
}

// Extracts the extra dimensions a history snapshot should capture from a fully
// normalized project (the same object the report page renders). Pure; safe to
// call with a partial project — missing inputs become null.
export function snapshotMetrics(project = {}) {
  const breakdown = project.scoreBreakdown || {};
  const categories = {};
  for (const category of TRUST_CATEGORIES) {
    categories[category.key] = categoryScore(breakdown, category);
  }
  const socialRaw = breakdown.socialScore;
  const socialScore = socialRaw === null || socialRaw === undefined || !Number.isFinite(Number(socialRaw))
    ? null
    : round(socialRaw);
  return {
    categories,
    socialScore,
    assetCategory: project.assetCategory || '',
  };
}

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// The heart of change detection: compares two snapshots and returns a list of
// meaningful, human-facing changes. Each change is a plain object the UI, the
// watchlist alerts, and the email digest all consume. `worse: true` means the
// change is in the risk-increasing direction (used for severity/coloring).
// Comparisons are skipped whenever either side is unknown, so an old snapshot
// missing the newer fields never fabricates a change.
export function diffSnapshots(prev, curr) {
  const changes = [];
  if (!prev || !curr) return changes;

  // Trust Score.
  const prevScore = num(prev.score);
  const currScore = num(curr.score);
  if (prevScore !== null && currScore !== null) {
    const delta = currScore - prevScore;
    if (Math.abs(delta) >= SCORE_CHANGE_THRESHOLD) {
      changes.push({ key: 'trustScore', previous: prevScore, current: currScore, delta, worse: delta < 0, unit: 'score' });
    }
  }

  // Public liquidity — reported as a percentage swing (matches the product
  // spec's "Liquidity dropped 18%").
  const prevLiq = num(prev.liquidityUsd);
  const currLiq = num(curr.liquidityUsd);
  if (prevLiq !== null && currLiq !== null && prevLiq > 0) {
    const ratio = (currLiq - prevLiq) / prevLiq;
    if (Math.abs(ratio) >= LIQUIDITY_CHANGE_RATIO) {
      changes.push({
        key: 'liquidity',
        previous: prevLiq,
        current: currLiq,
        percent: Math.round(Math.abs(ratio) * 100),
        delta: ratio,
        worse: ratio < 0,
        unit: 'percent',
      });
    }
  }

  // Largest-holder concentration — reported in percentage points. Higher = worse.
  const prevHolder = num(prev.topHolderPercent);
  const currHolder = num(curr.topHolderPercent);
  if (prevHolder !== null && currHolder !== null) {
    const delta = currHolder - prevHolder;
    if (Math.abs(delta) >= HOLDER_CHANGE_THRESHOLD) {
      changes.push({ key: 'holderConcentration', previous: prevHolder, current: currHolder, delta, worse: delta > 0, unit: 'points' });
    }
  }

  // Category scores (contract security, community, market activity, ...). Higher = better.
  const prevCats = prev.categories || {};
  const currCats = curr.categories || {};
  for (const category of TRUST_CATEGORIES) {
    if (category.key === 'liquidity') continue; // covered above via raw liquidity USD
    const prevVal = num(prevCats[category.key]);
    const currVal = num(currCats[category.key]);
    if (prevVal === null || currVal === null) continue;
    const delta = currVal - prevVal;
    if (Math.abs(delta) >= CATEGORY_CHANGE_THRESHOLD) {
      changes.push({ key: category.key, previous: prevVal, current: currVal, delta, worse: delta < 0, unit: 'points' });
    }
  }

  // Community/Social score (its own signal, distinct from the community category).
  const prevSocial = num(prev.socialScore);
  const currSocial = num(curr.socialScore);
  if (prevSocial !== null && currSocial !== null) {
    const delta = currSocial - prevSocial;
    if (Math.abs(delta) >= CATEGORY_CHANGE_THRESHOLD) {
      changes.push({ key: 'social', previous: prevSocial, current: currSocial, delta, worse: delta < 0, unit: 'points' });
    }
  }

  return changes;
}

// Localized one-line label for a single change, e.g.
// "Liquidity dropped 18%" or "Contract security improved 6 pts".
export function describeChange(change, language) {
  const dir = change.worse ? 'Worse' : 'Better';
  switch (change.key) {
    case 'liquidity':
      return t(`riskHistory.reasons.liquidity${change.delta < 0 ? 'Down' : 'Up'}`, { percent: change.percent }, language);
    case 'holderConcentration':
      return t(`riskHistory.reasons.holder${change.delta > 0 ? 'Up' : 'Down'}`, { points: Math.abs(round(change.delta)) }, language);
    case 'trustScore':
      return t(`riskHistory.reasons.score${change.delta < 0 ? 'Down' : 'Up'}`, { points: Math.abs(round(change.delta)) }, language);
    default:
      // contractSecurity / holderHealth / marketActivity / community / social
      return t(`riskHistory.reasons.${change.key}${dir}`, { points: Math.abs(round(change.delta)) }, language);
  }
}

function riskLevelChange(prev, curr) {
  const order = { Low: 0, Medium: 1, High: 2 };
  const prevRisk = prev?.riskLevel;
  const currRisk = curr?.riskLevel;
  if (!prevRisk || !currRisk || prevRisk === currRisk) return null;
  const worse = (order[currRisk] ?? 1) > (order[prevRisk] ?? 1);
  return { previous: prevRisk, current: currRisk, worse };
}

// Composes the plain-language "AI explanation" paragraph for one history event
// from its detected changes — the text shown under each timeline entry and in
// the alert body. Never empty when there are changes.
export function describeEvent(event, language) {
  const reasons = (event.changes || [])
    .filter((change) => change.key !== 'trustScore')
    .map((change) => describeChange(change, language));

  const scoreDelta = event.scoreDelta;
  let headline;
  if (typeof scoreDelta === 'number' && Math.abs(scoreDelta) >= SCORE_CHANGE_THRESHOLD) {
    headline = t(
      `riskHistory.${scoreDelta < 0 ? 'headlineDown' : 'headlineUp'}`,
      { points: Math.abs(round(scoreDelta)) },
      language
    );
  } else if (event.riskChange) {
    headline = t('riskHistory.headlineRisk', {}, language);
  } else {
    headline = t('riskHistory.headlineNeutral', {}, language);
  }

  if (!reasons.length) return headline;
  return `${headline} ${t('riskHistory.reasonLead', {}, language)} ${reasons.join(t('riskHistory.reasonSeparator', {}, language))}.`;
}

// Turns the raw snapshot stream into the timeline: one event per day on which a
// meaningful change occurred, newest first. Each event carries the previous and
// new Trust Score, any risk-level change, the full list of detected changes,
// and the composed explanation — everything the UI needs to render a row.
export function buildRiskHistory(history, language) {
  if (!Array.isArray(history) || history.length < 2) return [];
  const sorted = [...history].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const events = [];

  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const changes = diffSnapshots(prev, curr);
    const riskChange = riskLevelChange(prev, curr);
    if (!changes.length && !riskChange) continue;

    const prevScore = num(prev.score);
    const currScore = num(curr.score);
    const scoreDelta = prevScore !== null && currScore !== null ? currScore - prevScore : null;
    const event = {
      date: curr.date,
      previousScore: prevScore,
      newScore: currScore,
      scoreDelta,
      previousRisk: prev.riskLevel || null,
      newRisk: curr.riskLevel || null,
      riskChange,
      changes,
      // "worse" overall if the score dropped meaningfully or risk level rose.
      worse: (typeof scoreDelta === 'number' && scoreDelta <= -SCORE_CHANGE_THRESHOLD) || Boolean(riskChange?.worse),
    };
    event.explanation = describeEvent(event, language);
    events.push(event);
  }

  return events.reverse();
}

export const RISK_HISTORY_THRESHOLDS = {
  SCORE_CHANGE_THRESHOLD,
  CATEGORY_CHANGE_THRESHOLD,
  HOLDER_CHANGE_THRESHOLD,
  LIQUIDITY_CHANGE_RATIO,
};
