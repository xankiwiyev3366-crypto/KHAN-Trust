// Phase 5 — Smart Risk History & Intelligent Risk Alerts: the LOCALIZED half.
//
// The pure change-detection brain moved to src/lib/snapshotDiff.js so the
// server can share it (see the header there for why). What remains here is
// everything that needs the i18n bundle — turning structured changes into the
// human-readable "what changed and why" timeline the report page renders.
//
// The detection functions are RE-EXPORTED rather than re-implemented, so every
// existing importer (main.jsx, riskAlerts.js, scoreHistory.js,
// riskHistory.test.mjs) keeps working against this module unchanged, and there
// is still exactly one definition of what counts as a change.
//
// Design principles that keep this additive and non-breaking:
//   * It NEVER stores its own data. It derives everything from the snapshots
//     already persisted by scoreHistory.js (the platform-memory store), so
//     there is no duplicate source of truth to keep in sync.
//   * Every function is pure and tolerant of old/thin snapshots: a snapshot
//     recorded before this phase simply lacks the `categories`/`socialScore`
//     fields, and every comparison treats a missing value as "unknown" and
//     skips it rather than inventing a change.
//   * It imports only the standalone i18n `translate()` mirror (usable outside
//     React), matching riskAlerts.js — so explanations are localized in all
//     four languages with zero new plumbing.
import { translate as t } from './i18n/index.js';
import {
  diffSnapshots,
  riskLevelChange,
  validHistory,
  RISK_HISTORY_THRESHOLDS,
} from './lib/snapshotDiff.js';

// The detection core, re-exported so this module stays the single import site
// the client app has always used. A consumer of the raw brain on the SERVER
// should import src/lib/snapshotDiff.js directly instead — importing this file
// would drag the i18n bundle into a Netlify Function.
export {
  TRUST_CATEGORIES,
  isValidSnapshot,
  validHistory,
  confidenceRegressed,
  snapshotMetrics,
  diffSnapshots,
  riskLevelChange,
  RISK_HISTORY_THRESHOLDS,
} from './lib/snapshotDiff.js';

const { SCORE_CHANGE_THRESHOLD } = RISK_HISTORY_THRESHOLDS;

function round(value) {
  return Math.round(Number(value));
}

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
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
