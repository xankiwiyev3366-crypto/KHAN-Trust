// The Watchtower Report composer.
//
// Turns "what the re-scan worker observed" into the artefact a paying user
// actually receives: a per-period briefing over every token they watch, ranked
// by what deserves their attention, with a truthful account of the monitoring
// work done even when nothing changed.
//
// PURE BY CONTRACT
//
// Nothing here reads or writes storage, fetches, or looks at the clock beyond
// what it is handed. Every input arrives as an argument and the output is a
// plain object. That is what makes the whole report unit-testable without
// mocking Netlify Blobs, and it is why the interesting logic lives here rather
// than in the endpoint.
//
// KEYS AND PARAMS, NEVER SENTENCES
//
// Same rule as _notificationStore.mjs: a report is persisted and re-read later,
// possibly by someone who has since switched language. Composing English prose
// at generation time would freeze the report's language forever. Every headline,
// status and reason here is a translation KEY plus its numbers, rendered by the
// client's i18n at display time — so one stored report renders correctly in all
// four languages, including a language added after it was written.
//
// "NOTHING CHANGED" IS A REPORT, NOT AN ABSENCE
//
// The hardest requirement, and the one that decides whether this feels like a
// premium monitoring service or a broken notifier. A quiet week is the NORMAL
// case for a healthy watchlist, and it is exactly when a user asks "what am I
// paying for?". So a report with zero changes still carries: how many cycles
// ran, how many observations were made, when each token was last confirmed, and
// which tokens could not be observed at all. The work is the product. Findings
// are the exception, not the deliverable.
import { isComparableBaseline } from './_watchtowerBaseline.mjs';
import {
  watchScoreChanges,
  watchRiskChange,
  changeReasonCodes,
  hasCriticalReason,
} from './_watchSignals.mjs';

// How a token is reported. Ordered by how much attention it deserves, which is
// also the order tokens are sorted in — the user should never have to scroll to
// find the thing that matters.
export const TOKEN_STATUS = {
  CRITICAL: 'critical',    // an authority regained, or liquidity gone
  WORSENED: 'worsened',    // risk level up, or risk-increasing changes
  IMPROVED: 'improved',    // changes, all in the safer direction
  STEADY: 'steady',        // observed, compared, nothing meaningful moved
  BASELINED: 'baselined',  // first comparable observation — nothing to compare yet
  UNOBSERVED: 'unobserved',// no snapshot at all this period
};

const STATUS_RANK = {
  [TOKEN_STATUS.CRITICAL]: 0,
  [TOKEN_STATUS.WORSENED]: 1,
  [TOKEN_STATUS.IMPROVED]: 2,
  [TOKEN_STATUS.UNOBSERVED]: 3,
  [TOKEN_STATUS.BASELINED]: 4,
  [TOKEN_STATUS.STEADY]: 5,
};

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// Classifies one watched token for the period.
//
// The order of these checks is the product judgement: a CRITICAL categorical
// event outranks any score movement, because "mint authority is back on" is
// actionable in a way that "trust score fell 4 points" is not — and a user who
// has to read past four score wobbles to find it has been failed.
export function classifyToken({ token, current, baseline }) {
  // No observation at all. Distinct from "nothing changed" and must never be
  // reported as steady: telling someone their token looks fine when we never
  // managed to look at it is the one lie a monitoring product cannot survive.
  if (!current) {
    return {
      identity: token.identity,
      status: TOKEN_STATUS.UNOBSERVED,
      changes: [],
      codes: [],
      riskChange: null,
    };
  }

  // No comparable baseline: a new subscription, or a snapshot produced by a
  // different engine version. We establish the baseline and say so, rather than
  // inventing a comparison against a methodology that no longer exists.
  if (!isComparableBaseline(baseline)) {
    return {
      identity: token.identity,
      status: TOKEN_STATUS.BASELINED,
      changes: [],
      codes: [],
      riskChange: null,
    };
  }

  const changes = watchScoreChanges(baseline, current);
  const riskChange = watchRiskChange(baseline, current);
  const codes = changeReasonCodes(baseline, current);

  let status;
  if (hasCriticalReason(codes)) {
    status = TOKEN_STATUS.CRITICAL;
  } else if (riskChange?.worse || changes.some((change) => change.worse)) {
    status = TOKEN_STATUS.WORSENED;
  } else if (changes.length || riskChange) {
    status = TOKEN_STATUS.IMPROVED;
  } else {
    status = TOKEN_STATUS.STEADY;
  }

  return { identity: token.identity, status, changes, codes, riskChange };
}

// Builds the full report. Pure: every input is supplied by the caller.
//
//   tokens    — the user's watched tokens (from their alert subscription)
//   snapshots — { [identity]: current watch-lane snapshot | null }
//   baseline  — { [identity]: baseline entry | undefined } from the last report
//   coverage  — from coverageBetween(); { known, cycles, observations, declined }
//   period    — { start, end } ISO strings
export function buildWatchtowerReport({ tokens = [], snapshots = {}, baseline = {}, coverage, period }) {
  const entries = tokens.map((token) => {
    const current = snapshots[token.identity] || null;
    const classified = classifyToken({ token, current, baseline: baseline[token.identity] });
    return {
      identity: token.identity,
      name: token.name || token.ticker || token.contract || '',
      ticker: token.ticker || '',
      chain: token.chain || '',
      contract: token.contract || '',
      status: classified.status,
      // The factual transition, shown even when no change crossed a threshold —
      // "78/100, unchanged since Monday" is information, not noise.
      score: current ? num(current.trustScore) : null,
      riskLevel: current?.riskLevel || null,
      previousScore: num(baseline[token.identity]?.score),
      previousRiskLevel: baseline[token.identity]?.riskLevel || null,
      observedAt: current?.observedAt || null,
      changes: classified.changes,
      reasons: classified.codes,
      riskChange: classified.riskChange,
    };
  });

  // Attention order, then by score ascending inside a status so the weakest
  // token of an equally-ranked group leads.
  entries.sort((a, b) => {
    const rank = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (rank !== 0) return rank;
    return (a.score ?? 101) - (b.score ?? 101);
  });

  const counts = entries.reduce((acc, entry) => {
    acc[entry.status] = (acc[entry.status] || 0) + 1;
    return acc;
  }, {});

  const needsAttention = (counts[TOKEN_STATUS.CRITICAL] || 0) + (counts[TOKEN_STATUS.WORSENED] || 0);
  const improved = counts[TOKEN_STATUS.IMPROVED] || 0;

  return {
    version: 1,
    period: { start: period.start, end: period.end },
    generatedAt: period.end,
    coverage,
    summary: {
      watched: entries.length,
      needsAttention,
      improved,
      steady: counts[TOKEN_STATUS.STEADY] || 0,
      baselined: counts[TOKEN_STATUS.BASELINED] || 0,
      unobserved: counts[TOKEN_STATUS.UNOBSERVED] || 0,
      // The one-line verdict, as a key. Deliberately NOT "all clear" when
      // anything went unobserved — a report that cannot see a token must not
      // reassure about it.
      headlineKey: headlineKeyFor({ needsAttention, improved, counts, entries }),
    },
    tokens: entries,
  };
}

// The single-sentence verdict key. Order encodes the same priority as the token
// sort: danger, then blind spots, then good news, then calm.
function headlineKeyFor({ needsAttention, improved, counts, entries }) {
  if (counts[TOKEN_STATUS.CRITICAL]) return 'critical';
  if (needsAttention) return 'attention';
  if (counts[TOKEN_STATUS.UNOBSERVED]) return 'partial';
  if (improved) return 'improved';
  if (!entries.length) return 'empty';
  if (counts[TOKEN_STATUS.BASELINED] === entries.length) return 'baselined';
  return 'steady';
}
