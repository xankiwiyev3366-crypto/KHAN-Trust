// GET /.netlify/functions/watchtower-report
//
// The caller's current Watchtower Report. Generated ON READ, from the watch-lane
// snapshots the re-scan worker has already stored, then persisted along with the
// baseline it was generated against.
//
// WHY GENERATE ON READ RATHER THAN ON A CRON
//
// A cron would have to pick a moment for every user in the world — 06:00 UTC is
// the middle of someone's night, and a report generated while they sleep is
// stale by the time they read it. Generating on read means the period is always
// "since you last saw a report", which is the only period that is actually
// meaningful to the reader, and it costs nothing extra: the observation work is
// already done by watch-rescan-background, and this only reads and diffs.
//
// It also means an inactive user costs zero. A cron generating weekly reports
// for every account that ever signed up would burn work on people who will never
// open them.
//
// THE PERIOD IS A HIGH-WATER MARK, NOT A WINDOW
//
// Report N covers [when report N-1 was generated -> now]. No gap, no overlap, no
// drift. This is why the baseline lives in _watchtowerStore and NOT in
// sub.lastNotified, which alerts-run re-baselines hourly (see that module's
// header): reading the alert baseline would silently reduce every report to
// "what changed in the last hour" while looking entirely correct.
//
// MIN_PERIOD_SECONDS stops a refresh-happy user from re-baselining themselves
// into an empty report: two reads a minute apart would leave the second one with
// a 60-second period in which, correctly, nothing happened. Inside that window
// the STORED report is returned unchanged.
import { verifyJwt, bearerToken } from './_authStore.mjs';
import { getSubscription } from './_alertsStore.mjs';
import { getWatchSnapshots } from './_watchSnapshotStore.mjs';
import {
  getReportState,
  saveReportState,
  listRuns,
  coverageBetween,
  toBaselineEntry,
} from './_watchtowerStore.mjs';
import { buildWatchtowerReport } from './_watchtowerReport.mjs';
import { resolveUserTier, OBSERVE_INTERVAL_MS, MAX_WATCHED_TOKENS } from './_watchTiers.mjs';
import { jsonResponse } from './_blobsClient.mjs';
import { resolveTier } from './_featureGate.mjs';

// THE FREE TEASER, ENFORCED SERVER-SIDE.
//
// The Watchtower page shows Free users a real summary — "3 tokens changed" —
// and withholds WHICH and WHY behind the upgrade lock. That is a deliberately
// honest cliffhanger: the number is true, and it is the strongest possible
// argument for upgrading precisely because we are not making it up.
//
// But the lock was CLIENT-SIDE ONLY. The endpoint returned the complete
// per-token breakdown to everyone and let the browser decide whether to paint
// it, which means the entire paid deliverable was one devtools panel away.
//
// So the redaction now happens here. Free users get the summary, the coverage
// panel, and the period — everything the teaser legitimately shows — and the
// `tokens` array arrives EMPTY, with `redacted` stating plainly that detail was
// withheld for tier reasons rather than because nothing happened.
//
// That distinction is the important one: an empty array on its own is
// indistinguishable from "all clear", and silently showing a worried user an
// all-clear they did not earn would be a far worse failure than a paywall.
function redactForFree(report) {
  if (!report) return report;
  return {
    ...report,
    tokens: [],
    // The client reads this to render the lock (with the true change count from
    // `summary`) instead of the "nothing is being watched" empty state.
    redacted: { reason: 'premium_required', feature: 'continuousMonitoring', withheldTokens: report.tokens?.length || 0 },
  };
}

// Below this, a re-read returns the stored report instead of generating a new
// one. Fifteen minutes is comfortably shorter than the hourly observation
// cadence (so a user can never be shown a stale report after new data landed)
// and long enough that normal navigation never re-baselines.
const MIN_PERIOD_SECONDS = 15 * 60;

// The period for a user who has never had a report. Seven days matches the
// weekly rhythm the report is written for, and bounds the coverage lookup on a
// brand-new account to something meaningful rather than "all time".
const FIRST_PERIOD_DAYS = 7;

export async function handler(event) {
  try {
    if (event.httpMethod !== 'GET') return jsonResponse(405, { message: 'Method not allowed' });

    const payload = verifyJwt(bearerToken(event));
    if (!payload?.sub) return jsonResponse(401, { message: 'Unauthorized' });

    const userId = payload.sub;
    const now = new Date();

    // Entitlement for the REDACTION decision only. Note this is separate from
    // resolveUserTier below, which decides monitoring CADENCE and deliberately
    // fails to free (an unreadable store must not hand out premium cadence and
    // an unbounded provider bill). This one fails OPEN — a paying customer must
    // still see their report during an outage. Same question, opposite safe
    // direction, which is exactly why they are two calls and not one.
    const { premium } = await resolveTier(event);

    // The caller's monitoring plan, so the report can state its OWN cadence
    // ("checked every 30 minutes") rather than describing monitoring in the
    // abstract. This is the number that makes the tier concrete, and it is
    // resolved server-side from the account — never taken from the request.
    const tier = await resolveUserTier(userId);
    const plan = {
      tier,
      observeIntervalMs: OBSERVE_INTERVAL_MS[tier],
      maxTokens: MAX_WATCHED_TOKENS[tier],
    };

    const state = await getReportState(userId);

    // Serve the stored report inside the debounce window. `fresh: false` lets the
    // client show "generated 4 minutes ago" rather than implying it just ran.
    const lastAt = state.lastReportAt ? Date.parse(state.lastReportAt) : null;
    if (state.lastReport && Number.isFinite(lastAt) && (now.getTime() - lastAt) < MIN_PERIOD_SECONDS * 1000) {
      return jsonResponse(200, {
        ok: true,
        fresh: false,
        plan,
        report: premium ? state.lastReport : redactForFree(state.lastReport),
      });
    }

    const subscription = await getSubscription(userId);
    const tokens = Array.isArray(subscription?.tokens) ? subscription.tokens : [];

    // Read every watched token's latest server observation in one pass. Misses
    // resolve to null (see _watchSnapshotStore) — a token the worker has not
    // managed to observe is reported as UNOBSERVED, never quietly dropped.
    const snapshots = tokens.length
      ? await getWatchSnapshots(tokens.map((token) => token.identity))
      : {};

    const periodStart = state.lastReportAt
      || new Date(now.getTime() - FIRST_PERIOD_DAYS * 86400_000).toISOString();
    const periodEnd = now.toISOString();

    // Coverage is best-effort: an unreadable ledger must not fail the report, it
    // just makes coverage unknown — which the report renders honestly rather
    // than as zero. See coverageBetween().
    let coverage;
    try {
      coverage = coverageBetween(await listRuns(), periodStart, periodEnd);
    } catch {
      coverage = { known: false, cycles: 0, observations: 0, declined: 0 };
    }

    const report = buildWatchtowerReport({
      tokens,
      snapshots,
      baseline: state.baseline || {},
      coverage,
      period: { start: periodStart, end: periodEnd },
    });

    // Re-baseline to what we just observed, so the NEXT report covers exactly
    // from here. Only tokens we actually observed are re-baselined: an
    // unobserved token keeps its previous baseline, so when the worker next
    // manages to see it, the comparison is still against a real past observation
    // rather than against a hole.
    const baseline = { ...(state.baseline || {}) };
    for (const token of tokens) {
      const current = snapshots[token.identity];
      if (!current) continue;
      baseline[token.identity] = toBaselineEntry(current);
    }

    // Drop baselines for tokens no longer watched, so the blob cannot grow
    // without bound as a user churns through a watchlist.
    const watched = new Set(tokens.map((token) => token.identity));
    for (const identity of Object.keys(baseline)) {
      if (!watched.has(identity)) delete baseline[identity];
    }

    await saveReportState({
      userId,
      baseline,
      baselineAt: periodEnd,
      lastReport: report,
      lastReportAt: periodEnd,
    });

    // The report is STORED complete (above) and redacted only on the way out,
    // so the moment a user upgrades, the detail they were already paying us to
    // collect is there — no regeneration, no lost period, no gap in the
    // baseline chain. Redacting before the write would have quietly destroyed
    // history that can never be recomputed.
    return jsonResponse(200, { ok: true, fresh: true, plan, report: premium ? report : redactForFree(report) });
  } catch (error) {
    return jsonResponse(500, { message: `watchtower-report crashed: ${error.message}` });
  }
}
