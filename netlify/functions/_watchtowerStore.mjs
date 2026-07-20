// Durable state for the Watchtower Report: the observation ledger and, per
// user, the period baseline plus the last report generated.
//
// TWO THINGS LIVE HERE, AND THEY ARE DELIBERATELY SEPARATE
//
// 1. THE RUN LEDGER (one shared blob).
//    What the re-scan worker did, run by run. This is what lets a report say
//    "we ran 168 observation cycles across your 6 tokens this week" on a week
//    where nothing changed. Without it, a quiet week produces an empty report,
//    and an empty report reads as a broken product rather than a calm one —
//    which is the single most important failure mode to avoid for a paid
//    monitoring service. The work IS the product; a report that cannot describe
//    the work can only describe findings, and findings are not guaranteed.
//
//    ABSENCE IS NOT ZERO. A period with no ledger entries means "we do not know
//    what ran", NOT "nothing ran" — the report must say so rather than claim a
//    coverage of 0, which would defame a worker that was probably running fine
//    before this ledger existed.
//
// 2. THE PER-USER REPORT STATE (one blob per user, `report:<userId>`).
//    Same contention rule as _alertsStore/_notificationStore: never one shared
//    object that every user's write races on.
//
// WHY THE BASELINE CANNOT BE sub.lastNotified
//
// alerts-run.mjs re-baselines lastNotified EVERY HOUR, by design, so a given
// worsening is never emailed twice. A weekly report reading that baseline could
// therefore only ever report "what changed in the last hour" — it would silently
// omit six days and twenty-three hours of drift, while looking completely
// correct. The report keeps its own baseline, stamped when the previous report
// was generated, so report N covers exactly [report N-1 -> now] with no gap and
// no overlap. Two consumers, two cadences, two baselines.
import { getNamedStore } from './_blobsClient.mjs';

const STORE_NAME = 'khan-trust-watchtower';

// The ledger is a single rolling blob rather than one blob per run. There is
// exactly ONE writer (the background worker, one instance per cron tick), so
// there is no write contention to design around, and a single read gives the
// whole period — where one-blob-per-run would cost 168 reads to build a weekly
// report. Capped so the blob stays small and readable in one shot.
const RUNS_KEY = 'runs';
const MAX_RUNS = 400; // ~16 days at hourly cadence; comfortably covers a weekly period

function store() {
  return getNamedStore(STORE_NAME);
}

function reportKey(userId) {
  return `report:${userId}`;
}

// ── Run ledger ───────────────────────────────────────────────────────────────

// Appends one observation cycle. Best-effort by contract: the ledger is
// REPORTING metadata, never a precondition for observing. If this throws, the
// re-scan worker must still have written its snapshots — losing a coverage row
// costs a line of prose in a report; failing a run costs an alert.
export async function recordRun(entry) {
  const runs = await listRuns();
  runs.push({
    at: entry.at || new Date().toISOString(),
    tokens: Number(entry.tokens) || 0,
    observed: Number(entry.observed) || 0,
    declined: Number(entry.declined) || 0,
  });
  // Oldest dropped first.
  const trimmed = runs.slice(-MAX_RUNS);
  await store().setJSON(RUNS_KEY, trimmed);
  return trimmed.length;
}

export async function listRuns() {
  const data = await store().get(RUNS_KEY, { type: 'json' }).catch(() => null);
  return Array.isArray(data) ? data : [];
}

// Coverage over a window. Returns `known: false` when the ledger holds nothing
// for the period — see the absence-is-not-zero note above. The report renders
// that as "coverage not recorded for this period", never as zero cycles.
export function coverageBetween(runs, sinceIso, untilIso) {
  const since = Date.parse(sinceIso);
  const until = Date.parse(untilIso);
  const inWindow = (Array.isArray(runs) ? runs : []).filter((run) => {
    const at = Date.parse(run?.at);
    if (!Number.isFinite(at)) return false;
    if (Number.isFinite(since) && at < since) return false;
    if (Number.isFinite(until) && at > until) return false;
    return true;
  });

  if (!inWindow.length) {
    return { known: false, cycles: 0, observations: 0, declined: 0 };
  }

  return {
    known: true,
    cycles: inWindow.length,
    observations: inWindow.reduce((total, run) => total + (Number(run.observed) || 0), 0),
    declined: inWindow.reduce((total, run) => total + (Number(run.declined) || 0), 0),
  };
}

// ── Per-user report state ────────────────────────────────────────────────────

// The stored shape:
//   { userId, baseline: { [identity]: <watch-lane snapshot fields> },
//     baselineAt: ISO, lastReport: <report>, lastReportAt: ISO }
//
// `baseline` mirrors the shape alerts-run stores in lastNotified (score,
// riskLevel, signals, source, engineVersion) precisely so the SAME comparability
// guard — isComparableBaseline — applies to both without a second definition of
// what a comparable baseline is.
export async function getReportState(userId) {
  const data = await store().get(reportKey(userId), { type: 'json' }).catch(() => null);
  if (data && typeof data === 'object') return data;
  return { userId, baseline: {}, baselineAt: null, lastReport: null, lastReportAt: null };
}

export async function saveReportState(state) {
  await store().setJSON(reportKey(state.userId), state);
  return state;
}

// Reduces a live watch-lane snapshot to the fields a baseline needs. Keeping the
// raw `signals` is what lets the NEXT report explain why in plain language
// without re-fetching, and freezes the evidence at observation time so a later
// engine change cannot retroactively rewrite why a user was told their money was
// at risk.
export function toBaselineEntry(snapshot) {
  if (!snapshot) return null;
  return {
    score: snapshot.trustScore,
    riskLevel: snapshot.riskLevel,
    signals: snapshot.signals,
    source: snapshot.source,
    engineVersion: snapshot.engineVersion,
    observedAt: snapshot.observedAt || null,
    at: new Date().toISOString(),
  };
}
