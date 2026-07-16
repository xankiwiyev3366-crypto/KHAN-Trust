// The Growth Warehouse — every metric the Growth OS reasons about.
//
// Design rules, all of which exist to keep the AI layer honest:
//
//  1. DERIVED, NEVER STORED. Every figure is computed from the event log at
//     read time. There are no counters to drift out of sync with reality, and a
//     metric definition can be corrected retroactively across all history.
//  2. NO NUMBER WITHOUT A VERDICT. Every rate comes back wrapped by the
//     Confidence Engine. A consumer cannot get a bare number, so it cannot
//     accidentally treat noise as signal.
//  3. ABSENCE IS A RESULT. When the data cannot answer a question, the answer
//     is an explicit "insufficient" plus what would be needed - never a zero,
//     never a guess, never an omission. Zeros and gaps are how dashboards lie.
import { readWindow } from './_growthEvents.mjs';
import { EVENT_TYPES, CHANNELS } from './_growthSchema.mjs';
import { assessRate, assessCount, assessChange, metric, CONFIDENCE } from './_growthConfidence.mjs';

export { CONFIDENCE };

const DAY_MS = 86400000;

function dayOf(iso) {
  return String(iso).slice(0, 10);
}

function uniq(events, field) {
  const set = new Set();
  for (const event of events) if (event[field]) set.add(event[field]);
  return set;
}

function byType(events, type) {
  return events.filter((event) => event.type === type);
}

// ── Funnel ────────────────────────────────────────────────────────────────────
//
// Measured in VISITORS, not events: one person scanning forty tokens is one
// activated visitor, not forty. Counting events here would make the funnel look
// dramatically healthier than it is - the classic vanity-metric error.
//
// Stages are deliberately cumulative-by-membership rather than strictly
// sequential. A visitor who signs up without scanning still counts as
// registered. Forcing a strict order would silently drop real users who took an
// unexpected path and make the funnel a fiction about the ideal journey rather
// than a description of the real one.
export function buildFunnel(events) {
  const visitors = uniq(events, 'visitorId');

  const scanned = uniq(byType(events, EVENT_TYPES.SCAN_COMPLETED), 'visitorId');
  const registeredUserIds = uniq(byType(events, EVENT_TYPES.SIGNUP_COMPLETED), 'userId');
  const pricingViewers = uniq(byType(events, EVENT_TYPES.PRICING_VIEW), 'visitorId');
  const checkoutStarters = uniq(byType(events, EVENT_TYPES.CHECKOUT_STARTED), 'visitorId');
  const conversions = byType(events, EVENT_TYPES.CHECKOUT_COMPLETED);

  const totalVisitors = visitors.size;

  const stages = [
    {
      id: 'visited',
      label: 'Visited',
      count: totalVisitors,
      confidence: assessCount(totalVisitors, { minMeaningful: 30, minReliable: 200 }),
    },
    {
      id: 'activated',
      label: 'Scanned a token',
      count: scanned.size,
      rate: metric(
        totalVisitors ? scanned.size / totalVisitors : null,
        assessRate(scanned.size, totalVisitors)
      ),
    },
    {
      id: 'registered',
      label: 'Registered',
      count: registeredUserIds.size,
      rate: metric(
        totalVisitors ? registeredUserIds.size / totalVisitors : null,
        assessRate(registeredUserIds.size, totalVisitors)
      ),
    },
    {
      id: 'pricing',
      label: 'Viewed pricing',
      count: pricingViewers.size,
      rate: metric(
        totalVisitors ? pricingViewers.size / totalVisitors : null,
        assessRate(pricingViewers.size, totalVisitors)
      ),
    },
    {
      id: 'checkout',
      label: 'Started checkout',
      count: checkoutStarters.size,
      rate: metric(
        pricingViewers.size ? checkoutStarters.size / pricingViewers.size : null,
        assessRate(checkoutStarters.size, pricingViewers.size)
      ),
    },
    {
      id: 'converted',
      label: 'Paid',
      // Counted as EVENTS, not visitors, and the field name says so. Card
      // checkout is keyed by wallet, not by the auth/visitor identity, so the
      // platform genuinely cannot say how many distinct people this is. Naming
      // it `count` alongside the visitor-based stages would quietly imply a
      // precision that does not exist.
      count: conversions.length,
      countIsEvents: true,
      rate: metric(
        checkoutStarters.size ? conversions.length / checkoutStarters.size : null,
        assessRate(conversions.length, checkoutStarters.size)
      ),
    },
  ];

  return { stages, totalVisitors };
}

// A funnel step with ZERO events but meaningful upstream traffic is ambiguous
// in a way that matters enormously, and the statistics cannot resolve it.
//
// 0 of 400 visitors reaching pricing is EITHER a catastrophic funnel problem OR
// the pricing_view call simply is not firing. The Confidence Engine will happily
// certify "0.0%, n=400, sufficient" for both, because a 0/400 Wilson interval is
// genuinely narrow - the maths is right and the conclusion would be garbage.
//
// Handing that to an AI produces a confident, detailed, completely fictitious
// strategy for fixing a funnel step that was never broken. So a zero-with-
// upstream-volume stage is never ranked as a bottleneck; it is escalated as an
// instrumentation question, because that is the honest reading.
const INSTRUMENTATION_DOUBT_THRESHOLD = 30;

function hasInstrumentationDoubt(stage, upstreamCount) {
  return stage.count === 0 && upstreamCount >= INSTRUMENTATION_DOUBT_THRESHOLD;
}

export function findInstrumentationGaps(funnel) {
  const gaps = [];
  for (let i = 1; i < funnel.stages.length; i += 1) {
    const stage = funnel.stages[i];
    const upstream = funnel.stages[i - 1];
    if (hasInstrumentationDoubt(stage, upstream.count)) {
      gaps.push({
        stage: stage.id,
        label: stage.label,
        upstreamCount: upstream.count,
        reason: `Not one of the ${upstream.count} visitors who reached "${upstream.label}" registered a "${stage.label}" event. That is either a total funnel collapse at this step or the event is not being tracked. Verify instrumentation before treating it as a growth problem.`,
        // Code + params so the console can render this in the operator's
        // language; the prose above stays for the AI and as a fallback.
        //
        // The stage params carry IDs, not labels: the console resolves them
        // against funnel.stages.* so the embedded step name is translated too.
        // Passing stage.label here would strand "Scanned a token" inside an
        // otherwise-Azerbaijani sentence.
        reasonCode: 'instrumentation_gap',
        reasonParams: { upstreamCount: upstream.count, upstreamStage: upstream.id, stage: stage.id },
      });
    }
  }
  return gaps;
}

// Finds the funnel's binding constraint: the step losing the most people.
//
// Returns null rather than a guess when nothing can be trusted. This is the
// single most consequential output of the warehouse - it is what the AI is
// pointed at - so it must refuse to answer rather than invent a bottleneck out
// of a 3-visitor sample or an untracked event.
export function findBottleneck(funnel) {
  const gaps = new Set(findInstrumentationGaps(funnel).map((gap) => gap.stage));

  const usable = funnel.stages.filter((stage) => (
    stage.rate
    && stage.rate.value !== null
    && stage.rate.confidence.level !== CONFIDENCE.INSUFFICIENT
    && !gaps.has(stage.id)
  ));

  if (!usable.length) {
    return {
      stage: null,
      reason: gaps.size
        ? 'No funnel step can be ranked yet: the steps with enough traffic to judge have no events recorded at all, which points at missing instrumentation rather than a growth problem.'
        : 'No funnel step has enough data to identify a bottleneck yet. More traffic is required before this question is answerable.',
      reasonCode: gaps.size ? 'bottleneck_blocked_by_gaps' : 'bottleneck_insufficient',
      reasonParams: {},
      instrumentationGaps: Array.from(gaps),
    };
  }

  const worst = usable.reduce((a, b) => (a.rate.value <= b.rate.value ? a : b));
  return {
    stage: worst.id,
    label: worst.label,
    rate: worst.rate.value,
    confidence: worst.rate.confidence,
    reason: `"${worst.label}" converts at the lowest rate of any step with usable data (${(worst.rate.value * 100).toFixed(1)}%).`,
    reasonCode: 'bottleneck_found',
    reasonParams: { stage: worst.id, percent: (worst.rate.value * 100).toFixed(1) },
    instrumentationGaps: Array.from(gaps),
  };
}

// ── Retention ─────────────────────────────────────────────────────────────────
//
// True cohort retention: group users by the DAY THEY REGISTERED, then ask
// whether each returned on day 1 / 7 / 30 after that.
//
// This is not what the legacy dashboard called "returning users" (accounts that
// ever logged in on 2+ distinct days). That number has no time dimension at
// all: it can only grow, it never reveals that retention is getting worse, and
// it cannot be compared between cohorts. It is a lifetime counter wearing a
// retention costume. This replaces it.
export function buildRetention(events, now = Date.now()) {
  const signups = byType(events, EVENT_TYPES.SIGNUP_COMPLETED).filter((event) => event.userId);

  if (!signups.length) {
    return {
      cohorts: [],
      summary: {
        d1: metric(null, { level: CONFIDENCE.INSUFFICIENT, sampleSize: 0, reason: 'No registrations recorded in this window.' }),
        d7: metric(null, { level: CONFIDENCE.INSUFFICIENT, sampleSize: 0, reason: 'No registrations recorded in this window.' }),
        d30: metric(null, { level: CONFIDENCE.INSUFFICIENT, sampleSize: 0, reason: 'No registrations recorded in this window.' }),
      },
      note: 'Cohort retention needs registrations inside the window, and enough elapsed time for each horizon to have matured.',
      noteCode: 'retention_no_signups',
    };
  }

  // Every timestamp at which each user did anything at all.
  const activityByUser = new Map();
  for (const event of events) {
    if (!event.userId) continue;
    const list = activityByUser.get(event.userId) || [];
    list.push(Date.parse(event.timestamp));
    activityByUser.set(event.userId, list);
  }

  const signupAtByUser = new Map();
  for (const event of signups) {
    const at = Date.parse(event.timestamp);
    const existing = signupAtByUser.get(event.userId);
    if (existing === undefined || at < existing) signupAtByUser.set(event.userId, at);
  }

  // A user is "retained at day N" if they were active in the 24h window that
  // OPENS at day N — not "any time after". "Any time after" would make D1 and
  // D30 nearly identical and hide exactly the decay retention exists to expose.
  const retainedAt = (userId, signupAt, day) => {
    const from = signupAt + day * DAY_MS;
    const to = from + DAY_MS;
    return (activityByUser.get(userId) || []).some((at) => at >= from && at < to);
  };

  // A cohort can only be measured for a horizon that has actually elapsed.
  // Someone who signed up two days ago has NOT failed D7 — their D7 has not
  // happened yet. Counting them as a failure is the most common way retention
  // dashboards understate reality; those users are excluded from the
  // denominator until their horizon matures.
  const cohortMap = new Map();
  for (const [userId, signupAt] of signupAtByUser) {
    const key = dayOf(new Date(signupAt).toISOString());
    const cohort = cohortMap.get(key) || { day: key, users: [], size: 0 };
    cohort.users.push({ userId, signupAt });
    cohort.size += 1;
    cohortMap.set(key, cohort);
  }

  const horizons = [1, 7, 30];
  const totals = { 1: { retained: 0, eligible: 0 }, 7: { retained: 0, eligible: 0 }, 30: { retained: 0, eligible: 0 } };

  const cohorts = Array.from(cohortMap.values())
    .sort((a, b) => (a.day < b.day ? -1 : 1))
    .map((cohort) => {
      const row = { day: cohort.day, size: cohort.size, horizons: {} };
      for (const day of horizons) {
        const eligible = cohort.users.filter((user) => now >= user.signupAt + (day + 1) * DAY_MS);
        if (!eligible.length) {
          row.horizons[`d${day}`] = { matured: false, retained: null, eligible: 0 };
          continue;
        }
        const retained = eligible.filter((user) => retainedAt(user.userId, user.signupAt, day)).length;
        row.horizons[`d${day}`] = { matured: true, retained, eligible: eligible.length };
        totals[day].retained += retained;
        totals[day].eligible += eligible.length;
      }
      return row;
    });

  const summarise = (day) => {
    const { retained, eligible } = totals[day];
    return metric(eligible ? retained / eligible : null, assessRate(retained, eligible), {
      retained,
      eligible,
    });
  };

  return {
    cohorts,
    summary: { d1: summarise(1), d7: summarise(7), d30: summarise(30) },
    note: 'Only cohorts whose horizon has fully elapsed are counted, so recent signups never appear as retention failures.',
    noteCode: 'retention_matured_only',
  };
}

// ── Channels ──────────────────────────────────────────────────────────────────
//
// Attributed on FIRST touch. A user who found KHAN Trust through a TikTok, left,
// and returned by typing the URL is a TikTok acquisition — last-touch would file
// them under "direct" and the operator would conclude, wrongly, that TikTok does
// not work. This is the number that answers "is my content earning users".
export function buildChannels(events) {
  const visitorChannel = new Map();
  for (const event of events) {
    if (!event.visitorId) continue;
    if (!visitorChannel.has(event.visitorId)) {
      visitorChannel.set(event.visitorId, event.firstTouchChannel || CHANNELS.DIRECT);
    }
  }

  // Which channel each registered user originally came from.
  const signupChannel = new Map();
  for (const event of byType(events, EVENT_TYPES.SIGNUP_COMPLETED)) {
    if (event.userId) signupChannel.set(event.userId, event.firstTouchChannel || CHANNELS.DIRECT);
  }

  const rows = new Map();
  const ensure = (channel) => {
    if (!rows.has(channel)) rows.set(channel, { channel, visitors: 0, signups: 0, scans: 0 });
    return rows.get(channel);
  };

  for (const channel of visitorChannel.values()) ensure(channel).visitors += 1;
  for (const channel of signupChannel.values()) ensure(channel).signups += 1;

  const scannedVisitors = new Set();
  for (const event of byType(events, EVENT_TYPES.SCAN_COMPLETED)) {
    if (event.visitorId && !scannedVisitors.has(event.visitorId)) {
      scannedVisitors.add(event.visitorId);
      ensure(visitorChannel.get(event.visitorId) || CHANNELS.DIRECT).scans += 1;
    }
  }

  return Array.from(rows.values())
    .map((row) => ({
      ...row,
      signupRate: metric(
        row.visitors ? row.signups / row.visitors : null,
        assessRate(row.signups, row.visitors)
      ),
      activationRate: metric(
        row.visitors ? row.scans / row.visitors : null,
        assessRate(row.scans, row.visitors)
      ),
    }))
    .sort((a, b) => b.visitors - a.visitors);
}

// ── Content demand ────────────────────────────────────────────────────────────
//
// KHAN Trust's genuinely proprietary signal, and the reason the Content Engine
// can be more than a generic idea generator.
//
// Every scan is a person telling the platform, in their own time and unprompted,
// which token they are anxious enough about to check. Nobody else has this
// readout of what crypto users are worried about THIS WEEK. It is a direct
// content-demand signal for YouTube and TikTok: the tokens people are already
// searching for are the videos that will already have an audience.
//
// `demandScore` deliberately favours RECENT scans (a 7-day half-life) because
// crypto attention decays in days. A token scanned 40 times last month is
// yesterday's video; one scanned 12 times this week is tomorrow's.
export function buildContentDemand(events, now = Date.now(), limit = 20) {
  const scans = byType(events, EVENT_TYPES.SCAN_COMPLETED);
  const HALF_LIFE_DAYS = 7;

  const byToken = new Map();
  for (const scan of scans) {
    const key = scan.contract || scan.projectId || scan.projectName;
    if (!key) continue;

    const entry = byToken.get(key) || {
      key,
      name: scan.projectName || 'Unknown',
      ticker: scan.ticker || null,
      chain: scan.chain || null,
      scans: 0,
      uniqueVisitors: new Set(),
      demandScore: 0,
      trustScores: [],
      lastScannedAt: null,
    };

    entry.scans += 1;
    if (scan.visitorId) entry.uniqueVisitors.add(scan.visitorId);
    if (Number.isFinite(scan.trustScore)) entry.trustScores.push(scan.trustScore);

    const at = Date.parse(scan.timestamp);
    const ageDays = Math.max(0, (now - at) / DAY_MS);
    entry.demandScore += Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
    if (!entry.lastScannedAt || at > Date.parse(entry.lastScannedAt)) entry.lastScannedAt = scan.timestamp;

    byToken.set(key, entry);
  }

  return Array.from(byToken.values())
    .map((entry) => ({
      key: entry.key,
      name: entry.name,
      ticker: entry.ticker,
      chain: entry.chain,
      scans: entry.scans,
      uniqueVisitors: entry.uniqueVisitors.size,
      demandScore: Math.round(entry.demandScore * 100) / 100,
      avgTrustScore: entry.trustScores.length
        ? Math.round(entry.trustScores.reduce((sum, score) => sum + score, 0) / entry.trustScores.length)
        : null,
      lastScannedAt: entry.lastScannedAt,
      confidence: assessCount(entry.scans, { minMeaningful: 3, minReliable: 15 }),
    }))
    .sort((a, b) => b.demandScore - a.demandScore)
    .slice(0, limit);
}

// ── Conversion blockers ───────────────────────────────────────────────────────
//
// Every checkout that died, grouped by WHY. This is pure product signal that
// existed nowhere before: 'wallet_required' means the product is demanding a
// wallet before it will take someone's money; 'missing_config' means checkout is
// broken and revenue is being lost silently. In Google Analytics both look
// identical to "nobody converted".
export function buildConversionBlockers(events) {
  const failures = byType(events, EVENT_TYPES.CHECKOUT_FAILED);
  const byReason = new Map();
  for (const failure of failures) {
    const reason = failure.reason || 'unknown';
    byReason.set(reason, (byReason.get(reason) || 0) + 1);
  }
  return Array.from(byReason.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}

// ── Trend ─────────────────────────────────────────────────────────────────────

export function buildTrend(events, days, now = Date.now()) {
  const buckets = new Map();
  for (let i = days - 1; i >= 0; i -= 1) {
    buckets.set(new Date(now - i * DAY_MS).toISOString().slice(0, 10), { visitors: new Set(), scans: 0, signups: 0 });
  }
  for (const event of events) {
    const bucket = buckets.get(dayOf(event.timestamp));
    if (!bucket) continue;
    if (event.visitorId) bucket.visitors.add(event.visitorId);
    if (event.type === EVENT_TYPES.SCAN_COMPLETED) bucket.scans += 1;
    if (event.type === EVENT_TYPES.SIGNUP_COMPLETED) bucket.signups += 1;
  }
  return Array.from(buckets.entries()).map(([date, bucket]) => ({
    date,
    visitors: bucket.visitors.size,
    scans: bucket.scans,
    signups: bucket.signups,
  }));
}

// ── Top-level ─────────────────────────────────────────────────────────────────

export async function buildWarehouse({ days = 30, now = Date.now() } = {}) {
  const events = await readWindow(days, now);

  // Split the window in half to test whether anything actually changed. The
  // Confidence Engine will usually say "no" at this platform's scale - which is
  // the honest answer, and far more useful than a fabricated trend arrow.
  const midpoint = now - (days / 2) * DAY_MS;
  const recent = events.filter((event) => Date.parse(event.timestamp) >= midpoint);
  const earlier = events.filter((event) => Date.parse(event.timestamp) < midpoint);

  const funnel = buildFunnel(events);
  const recentVisitors = uniq(recent, 'visitorId').size;
  const earlierVisitors = uniq(earlier, 'visitorId').size;
  const recentSignups = uniq(byType(recent, EVENT_TYPES.SIGNUP_COMPLETED), 'userId').size;
  const earlierSignups = uniq(byType(earlier, EVENT_TYPES.SIGNUP_COMPLETED), 'userId').size;

  return {
    generatedAt: new Date(now).toISOString(),
    windowDays: days,
    eventCount: events.length,

    funnel,
    bottleneck: findBottleneck(funnel),
    // Escalated to the top level rather than left inside the funnel: a missing
    // event is a data-integrity fault that invalidates conclusions downstream
    // of it, so the operator and the AI must both see it before reading
    // anything else.
    instrumentationGaps: findInstrumentationGaps(funnel),
    retention: buildRetention(events, now),
    channels: buildChannels(events),
    contentDemand: buildContentDemand(events, now),
    conversionBlockers: buildConversionBlockers(events),
    trend: buildTrend(events, days, now),

    signupTrend: {
      recent: recentSignups,
      earlier: earlierSignups,
      change: assessChange(recentSignups, recentVisitors, earlierSignups, earlierVisitors),
    },

    // Surfaced rather than buried: the operator needs to know how much of this
    // is knowable at all, and the AI layer is required to read it before
    // reasoning about anything else.
    dataHealth: {
      totalEvents: events.length,
      distinctVisitors: funnel.totalVisitors,
      note: events.length < 500
        ? 'The Growth Data Plane is newly deployed and this window is thin. Most rates will read "insufficient" until traffic accumulates — that is correct behaviour, not a bug.'
        : null,
      noteCode: events.length < 500 ? 'data_plane_thin' : null,
    },
  };
}
