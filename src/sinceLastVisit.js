// "Your Risk Over Time" — what changed across the user's projects since they
// were last here.
//
// HOW THIS IS NOT THE WATCHTOWER REPORT
//
// They answer different questions from different lanes, and conflating them
// would produce two surfaces contradicting each other about one token:
//
//   WATCHTOWER (Phase 1)  WATCHED tokens only, from the SERVER lane (the
//                         re-scan worker's own observations), over a REPORTING
//                         PERIOD. Its own page. Answers "what did the machine
//                         see while I was away?"
//
//   THIS (Phase 4)        Every project the user has actually LOOKED AT, from
//                         the CLIENT lane (score history, recorded on view),
//                         since their LAST VISIT. On the dashboard. Answers
//                         "what changed in the things I care about?"
//
// The lane split is the same rule the whole platform runs on: score history is
// scored from the client's full 18-provider input set, the watch lane from the
// volatile subset, and the two are different numbers for the same token. This
// module reads ONLY score history, so diffSnapshots applies natively with no
// adapter — that history is exactly the shape it was written for.
//
// WHY THE CLIENT COMPOSES THIS
//
// Everything needed already exists on the client: the project list lives in
// localStorage, fetchScoreHistory is already the client's own reader, and
// diffSnapshots is pure. A server endpoint would have to be told which projects
// the user has, which the server does not know. So this is composition over
// existing parts rather than new infrastructure.
import { useEffect, useState } from 'react';
import { diffSnapshots, riskLevelChange, validHistory } from './lib/snapshotDiff.js';
import { historyKeyFor, fetchScoreHistory } from './scoreHistory.js';

// Never look further back than this, even for a long-lapsed user. Someone
// returning after four months does not want a four-month diff — they want to
// know the current state. Beyond this the panel steps aside for the normal
// dashboard rather than dumping a wall of stale movement.
export const MAX_LOOKBACK_DAYS = 30;

// Cap on projects examined per load. Each is one history fetch; a user with a
// hundred stored projects must not turn a dashboard render into a hundred
// requests. The most recently engaged are the ones that matter.
const MAX_PROJECTS = 12;

function dayOf(iso) {
  return typeof iso === 'string' ? iso.slice(0, 10) : null;
}

// The last snapshot recorded STRICTLY BEFORE the user's previous visit day is
// the baseline; the newest snapshot is the comparison. Both come from the same
// lane, so the comparison is like-for-like.
//
// Returns null when there is nothing honest to compare — fewer than two valid
// snapshots, or no snapshot predating the visit. Null means "we have no basis
// to claim anything changed", which must render as silence, never as "nothing
// changed".
export function changesSinceVisit(history, previousSeenIso, now = Date.now()) {
  const sorted = validHistory(history);
  if (sorted.length < 2) return null;

  const sinceDay = dayOf(previousSeenIso);
  if (!sinceDay) return null;

  // The horizon is applied to the SNAPSHOTS, not just to the day we measure
  // from. Clamping only the floor day looks correct and is not: a user
  // returning after six months still has a pre-floor snapshot from six months
  // ago, and it would be selected as the baseline — producing exactly the
  // unbounded diff the horizon exists to prevent. Restricting the candidate set
  // first is what actually bounds it.
  const oldestAllowed = new Date(now - MAX_LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10);
  const inWindow = sorted.filter((snapshot) => String(snapshot.date) >= oldestAllowed);
  if (inWindow.length < 2) return null;

  const floorDay = sinceDay < oldestAllowed ? oldestAllowed : sinceDay;

  const latest = inWindow[inWindow.length - 1];
  if (String(latest.date) <= floorDay) return null; // nothing newer than the visit

  // The most recent snapshot at or before the floor — what the token looked
  // like when they last saw it. When the whole window postdates the floor (a
  // long-lapsed user), the earliest snapshot we still hold is the honest
  // baseline: it is the oldest state we can actually attest to.
  let baseline = null;
  for (const snapshot of inWindow) {
    if (String(snapshot.date) <= floorDay) baseline = snapshot;
    else break;
  }
  if (!baseline) baseline = inWindow[0];
  if (baseline === latest) return null;

  const changes = diffSnapshots(baseline, latest);
  const riskChange = riskLevelChange(baseline, latest);
  if (!changes.length && !riskChange) return null;

  return {
    baseline,
    latest,
    changes,
    riskChange,
    worse: Boolean(riskChange?.worse) || changes.some((change) => change.worse),
  };
}

// Ranks what deserves the user's eye: risk-level rises first, then anything
// that got worse, then improvements — and inside each, the bigger score move.
function severity(entry) {
  if (entry.riskChange?.worse) return 0;
  if (entry.worse) return 1;
  return 2;
}

export function rankEntries(entries) {
  return [...entries].sort((a, b) => {
    const bySeverity = severity(a) - severity(b);
    if (bySeverity !== 0) return bySeverity;
    const aMove = Math.abs(a.scoreDelta || 0);
    const bMove = Math.abs(b.scoreDelta || 0);
    return bMove - aMove;
  });
}

// Loads the panel. `previousSeen` comes from the retention summary — null on a
// first-ever session, which the caller renders as a welcome rather than as an
// empty diff.
export function useSinceLastVisit({ projects, previousSeen, enabled }) {
  const [state, setState] = useState({ loading: false, entries: [], ready: false });

  useEffect(() => {
    if (!enabled || !previousSeen || !Array.isArray(projects) || !projects.length) {
      setState({ loading: false, entries: [], ready: true });
      return undefined;
    }

    let cancelled = false;
    setState({ loading: true, entries: [], ready: false });

    const candidates = projects.slice(0, MAX_PROJECTS);

    Promise.all(candidates.map(async (project) => {
      const key = historyKeyFor(project);
      if (!key) return null;
      // Best-effort per project: one unreadable history must not blank the
      // whole panel, so a failure resolves to null and is simply omitted.
      const history = await fetchScoreHistory(key).catch(() => null);
      if (!history) return null;
      const result = changesSinceVisit(history, previousSeen);
      if (!result) return null;
      return {
        project,
        identity: key,
        ...result,
        scoreDelta: (result.changes.find((change) => change.key === 'trustScore') || {}).delta || 0,
      };
    })).then((results) => {
      if (cancelled) return;
      setState({ loading: false, entries: rankEntries(results.filter(Boolean)), ready: true });
    });

    return () => { cancelled = true; };
    // Keyed on the project identities rather than the array reference, which is
    // new on every render and would loop.
  }, [enabled, previousSeen, (projects || []).map((p) => p?.id || p?.contract).join(',')]);

  return state;
}
