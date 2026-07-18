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

// A score DROP that coincides with a materially thinner data snapshot is far
// more likely to be a provider that stopped answering than a token that got
// riskier — the exact "an outage moves 91 -> 72" hazard the server re-scan lane
// guards against (see _rescanEngine.mjs). When both snapshots carry a
// `confidence` stamp (0-100, from scoringEngine.computeConfidence) and the newer
// one is this many points thinner, a DOWNWARD score/category move is treated as
// data-driven and suppressed. An UPWARD move, or a drop on equal/better data, is
// always kept. This is how "missing API data is never rendered as a real
// decrease" is enforced at diff time, on top of the storage-time gate that keeps
// most thin snapshots out of history in the first place (see scoreHistory.js).
const CONFIDENCE_DROP_TOLERANCE = 15;    // points of completeness

function round(value) {
  return Math.round(Number(value));
}

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// A snapshot is comparable history only if it records a real, finite Trust Score
// and was not explicitly flagged incomplete/demo at storage time. Legacy
// snapshots predate the `complete` stamp; absence of the flag is treated as
// valid (we cannot retroactively know), but an explicit `complete: false` or
// `demo: true` is always excluded. This is the single gate every consumer
// (timeline, alerts, delta, sparkline) filters through, so no view ever compares
// against or renders a snapshot the others would reject.
export function isValidSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  if (snapshot.demo === true || snapshot.complete === false) return false;
  return num(snapshot.score) !== null;
}

// The valid snapshots in ascending date order — the canonical view every
// comparison walks, so "the latest valid previous snapshot" means the same thing
// everywhere.
export function validHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter(isValidSnapshot)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

// True when `curr` is scored on materially LESS complete data than `prev`, so a
// downward move between them is suspect. Only fires when BOTH sides carry a
// confidence stamp — unknown confidence never suppresses a real change.
// Exported so the watchlist alerts (riskAlerts.js) apply the identical rule the
// timeline does — one definition of "this decrease is just missing data".
export function confidenceRegressed(prev, curr) {
  const prevConf = num(prev.confidence);
  const currConf = num(curr.confidence);
  if (prevConf === null || currConf === null) return false;
  return currConf < prevConf - CONFIDENCE_DROP_TOLERANCE;
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

// The heart of change detection: compares two snapshots and returns a list of
// meaningful, human-facing changes. Each change is a plain object the UI, the
// watchlist alerts, and the email digest all consume. `worse: true` means the
// change is in the risk-increasing direction (used for severity/coloring).
// Comparisons are skipped whenever either side is unknown, so an old snapshot
// missing the newer fields never fabricates a change. A downward score/category
// move is additionally suppressed when the newer snapshot is scored on
// materially thinner data (confidenceRegressed), so a provider outage never
// renders as a real decrease.
export function diffSnapshots(prev, curr) {
  const changes = [];
  if (!prev || !curr) return changes;
  const dataThinned = confidenceRegressed(prev, curr);

  // Trust Score.
  const prevScore = num(prev.score);
  const currScore = num(curr.score);
  if (prevScore !== null && currScore !== null) {
    const delta = currScore - prevScore;
    // A drop on materially thinner data is data-driven, not a real decline.
    if (Math.abs(delta) >= SCORE_CHANGE_THRESHOLD && !(delta < 0 && dataThinned)) {
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
    if (Math.abs(delta) >= CATEGORY_CHANGE_THRESHOLD && !(delta < 0 && dataThinned)) {
      changes.push({ key: category.key, previous: prevVal, current: currVal, delta, worse: delta < 0, unit: 'points' });
    }
  }

  // Community/Social score (its own signal, distinct from the community category).
  const prevSocial = num(prev.socialScore);
  const currSocial = num(curr.socialScore);
  if (prevSocial !== null && currSocial !== null) {
    const delta = currSocial - prevSocial;
    if (Math.abs(delta) >= CATEGORY_CHANGE_THRESHOLD && !(delta < 0 && dataThinned)) {
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
  // A missing level on EITHER side is unknown, never a change — this is why the
  // storage layer now stores null instead of a fabricated 'Medium' (see
  // score-history-record.mjs / scoreHistory.js): a null neighbour can no longer
  // masquerade as a Low->Medium or Medium->High transition.
  if (!order.hasOwnProperty(prevRisk) || !order.hasOwnProperty(currRisk) || prevRisk === currRisk) return null;
  const worse = order[currRisk] > order[prevRisk];
  // A worsening driven by a thinner-data snapshot is data noise, not a real
  // risk increase — suppress it for the same reason the score drop is suppressed.
  if (worse && confidenceRegressed(prev, curr)) return null;
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
  // Only VALID snapshots take part, and each is compared to the LATEST VALID
  // snapshot before it — not merely the previous array element. A thin/demo
  // snapshot that slipped through storage is skipped rather than becoming half
  // of a false back-and-forth (real -> outage -> real would otherwise render as
  // a drop then a recovery; here the outage day is invisible and the two real
  // days compare directly, showing no spurious change).
  const sorted = validHistory(history);
  if (sorted.length < 2) return [];
  const events = [];

  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i += 1) {
    const curr = sorted[i];
    const changes = diffSnapshots(prev, curr);
    const riskChange = riskLevelChange(prev, curr);
    if (!changes.length && !riskChange) {
      // No meaningful change: this snapshot becomes the new baseline so the next
      // comparison is still against the most recent real observation, but it
      // produces NO event (the "no event without meaningful change" rule).
      prev = curr;
      continue;
    }

    const prevScore = num(prev.score);
    const currScore = num(curr.score);
    // The headline score delta is the one that SURVIVED diffSnapshots — so a
    // score drop suppressed as data-driven never drives the explanation or the
    // colour, even if some other real change (e.g. holder concentration) makes
    // this an event. prev/new scores are still shown as the factual transition.
    const scoreChange = changes.find((change) => change.key === 'trustScore') || null;
    const scoreDelta = scoreChange ? scoreChange.delta : null;
    const event = {
      date: curr.date,
      previousScore: prevScore,
      newScore: currScore,
      scoreDelta,
      previousRisk: prev.riskLevel || null,
      newRisk: curr.riskLevel || null,
      riskChange,
      changes,
      // "worse" overall only from changes that actually surfaced: any
      // risk-increasing change, or a risk-level rise. A suppressed score drop is
      // not in `changes`, so it can never colour a row red.
      worse: Boolean(riskChange?.worse) || changes.some((change) => change.worse),
    };
    event.explanation = describeEvent(event, language);
    events.push(event);
    prev = curr;
  }

  return events.reverse();
}

export const RISK_HISTORY_THRESHOLDS = {
  SCORE_CHANGE_THRESHOLD,
  CATEGORY_CHANGE_THRESHOLD,
  HOLDER_CHANGE_THRESHOLD,
  LIQUIDITY_CHANGE_RATIO,
};
