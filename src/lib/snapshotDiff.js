// The pure change-detection core, shared by BOTH lanes.
//
// WHY THIS MODULE EXISTS
//
// The diff logic was written once in src/riskHistory.js, which imports the i18n
// bundle at module level. That import is fine in the browser and wrong in a
// Netlify Function, so alerts-run.mjs could not reuse it and hand-rolled its own
// detection (changeReasonCodes). Two definitions of "what counts as a change"
// then existed, in two lanes, with two sets of thresholds — and nothing kept
// them honest with each other. The Watchtower Report needs the SAME detection on
// the server, so rather than write a third copy, the pure half is extracted here
// and riskHistory.js re-exports it.
//
// The rule this file obeys, and why it is in src/lib/:
//
//   NOTHING HERE MAY IMPORT ANYTHING THAT IS NOT PURE.
//
// No i18n, no React, no fetch, no Node built-ins, no import.meta.env. src/lib/
// is the sanctioned cross-boundary location — the same place src/lib/trustScore.js
// and src/lib/pricing.js already live, imported by _rescanEngine.mjs and
// verify-solana-payment.mjs respectively. Adding an impure import here would
// break the Netlify Function bundle at deploy time, not at review time.
//
// WORDING LIVES ELSEWHERE, DELIBERATELY
//
// Every function here returns STRUCTURED changes ({ key, previous, current,
// delta, worse, unit }) and never a sentence. riskHistory.js turns those into
// localized prose for the browser; the server turns the same objects into keys +
// params for the notification store and the report. This is the same split
// alerts-run.mjs already established with changeReasonCodes: detection is
// language-agnostic and computed once, wording is late-bound per reader.

// Single source of truth for the five Trust Score categories. main.jsx imports
// this (via riskHistory.js) for its CategoryScoreCards / buildCategoryBreakdown
// so the history view and the live report can never drift apart on how a
// category is composed.
export const TRUST_CATEGORIES = [
  { key: 'contractSecurity', labelKey: 'contractSecurity', scoreKeys: ['securityScore'] },
  { key: 'liquidity', labelKey: 'liquidity', scoreKeys: ['liquidityScore', 'marketCapScore'] },
  { key: 'holderHealth', labelKey: 'holderHealth', scoreKeys: ['holderScore', 'topHolderScore', 'topTenHolderScore', 'holderGrowthScore'] },
  { key: 'marketActivity', labelKey: 'marketActivity', scoreKeys: ['marketActivityScore', 'tokenAgeScore'] },
  { key: 'community', labelKey: 'community', scoreKeys: ['websiteScore', 'twitterScore', 'telegramScore', 'githubScore', 'coingeckoScore', 'founderActivity', 'roadmapClarity', 'transparency'] },
];

// Meaningful-change thresholds. Deliberately conservative so the timeline shows
// real drift, not day-to-day data-source jitter. Unchanged from the values the
// client timeline has always used — this extraction must not move a threshold,
// or every existing history view silently re-renders differently.
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
// always kept.
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
// `demo: true` is always excluded.
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
export function confidenceRegressed(prev, curr) {
  const prevConf = num(prev?.confidence);
  const currConf = num(curr?.confidence);
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
// watchlist alerts, the email digest and the Watchtower Report all consume.
// `worse: true` means the change is in the risk-increasing direction.
//
// Comparisons are skipped whenever either side is unknown, so an old snapshot
// missing the newer fields never fabricates a change. This is also what lets the
// WATCH lane reuse this untouched: the volatile input set carries no category or
// social scores, so those comparisons simply do not fire — absence is read as
// "not observed", never as zero or as a change.
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

  // Public liquidity — reported as a percentage swing.
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

// A risk-LEVEL transition, or null when there isn't one.
//
// A missing level on EITHER side is unknown, never a change — this is why the
// storage layer stores null instead of a fabricated 'Medium' (see
// score-history-record.mjs / scoreHistory.js): a null neighbour can no longer
// masquerade as a Low->Medium or Medium->High transition.
export function riskLevelChange(prev, curr) {
  const order = { Low: 0, Medium: 1, High: 2 };
  const prevRisk = prev?.riskLevel;
  const currRisk = curr?.riskLevel;
  if (!Object.prototype.hasOwnProperty.call(order, prevRisk)
    || !Object.prototype.hasOwnProperty.call(order, currRisk)
    || prevRisk === currRisk) {
    return null;
  }
  const worse = order[currRisk] > order[prevRisk];
  // A worsening driven by a thinner-data snapshot is data noise, not a real
  // risk increase — suppress it for the same reason the score drop is suppressed.
  if (worse && confidenceRegressed(prev, curr)) return null;
  return { previous: prevRisk, current: currRisk, worse };
}

export const RISK_HISTORY_THRESHOLDS = {
  SCORE_CHANGE_THRESHOLD,
  CATEGORY_CHANGE_THRESHOLD,
  HOLDER_CHANGE_THRESHOLD,
  LIQUIDITY_CHANGE_RATIO,
};
