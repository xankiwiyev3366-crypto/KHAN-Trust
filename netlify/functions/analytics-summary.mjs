// GET /.netlify/functions/analytics-summary
//   ?section=events,users,verification   — one or more slices (default: all)
//   &refresh=1                           — bypass the aggregate cache
//
// ── WHY THIS ENDPOINT IS SLICED ─────────────────────────────────────────────
//
// It reads from three independent sources with wildly different costs:
//
//   events        1 blob GET of the whole capped event log (megabytes), then
//                 pure CPU aggregation.
//   verification  2 blob GETs.
//   users         1 blob LIST + 1 GET PER REGISTERED ACCOUNT. At 206 accounts
//                 that is 207 HTTP round trips and dominates everything else.
//
// They used to be awaited one after another and returned as one object, so the
// Admin Panel could not paint a single card until the slowest source had
// answered — and a failure in any one of them blanked the entire screen. The
// slices let the dashboard request all three in parallel and render each card
// group the moment its own source lands.
//
// The DEFAULT response is unchanged: with no `section` the endpoint still
// returns the complete, identically-shaped payload it always did, so every
// existing consumer (and the CSV/JSON export) keeps working untouched.
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { readEvents, jsonResponse } from './_analyticsStore.mjs';
import { readStatuses, readRequests } from './_verificationStore.mjs';
import { getUserLoginStats, countRegisteredUsers } from './_authStore.mjs';
import { cachedAggregate } from './_aggregateCache.mjs';

const DAY_MS = 86400000;

// How long a computed slice may be served before it is recomputed. Every one of
// these is an aggregate over hours-to-months of history — none of them changes
// meaningfully inside a minute — and the dashboard re-polls every 30 seconds
// for as long as the tab is open, so without this the most expensive read on
// the platform runs twice a minute forever. Refresh always bypasses it, and
// each slice reports its own `generatedAt` so the operator can see exactly how
// old the figures on screen are rather than having to trust a claim.
const SLICE_TTL_MS = 60000;

const SLICES = ['events', 'verification', 'users'];

function dateKey(isoTimestamp) {
  return isoTimestamp.slice(0, 10);
}

function withinDays(isoTimestamp, days) {
  return Date.now() - new Date(isoTimestamp).getTime() <= days * DAY_MS;
}

function growthPercent(current, previous) {
  if (!previous) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function buildDailySeries(events, days) {
  const buckets = new Map();
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(Date.now() - i * DAY_MS).toISOString().slice(0, 10);
    buckets.set(date, 0);
  }
  events.forEach((event) => {
    const key = dateKey(event.timestamp);
    if (buckets.has(key)) buckets.set(key, buckets.get(key) + 1);
  });
  return Array.from(buckets.entries()).map(([date, count]) => ({ date, count }));
}

function topByCount(map, limit) {
  return Array.from(map.entries())
    .map(([key, value]) => ({ key, count: value.count, ...value }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function trustBucket(score) {
  if (score <= 20) return '0-20';
  if (score <= 40) return '21-40';
  if (score <= 60) return '41-60';
  if (score <= 80) return '61-80';
  return '81-100';
}

function buildScanAnalytics(scanEvents) {
  const last7 = buildDailySeries(scanEvents, 7);
  const last30 = buildDailySeries(scanEvents, 30);
  const last90 = buildDailySeries(scanEvents, 90);
  const sum = (series) => series.reduce((total, point) => total + point.count, 0);
  const last7Count = sum(last7);
  const prev7Count = scanEvents.filter((event) => {
    const ageDays = (Date.now() - new Date(event.timestamp).getTime()) / DAY_MS;
    return ageDays > 7 && ageDays <= 14;
  }).length;
  const last30Count = sum(last30);
  const prev30Count = scanEvents.filter((event) => {
    const ageDays = (Date.now() - new Date(event.timestamp).getTime()) / DAY_MS;
    return ageDays > 30 && ageDays <= 60;
  }).length;

  return {
    daily: last30,
    last7,
    last30,
    last90,
    totalsToday: last7[last7.length - 1]?.count || 0,
    totalThisWeek: last7Count,
    totalThisMonth: last30Count,
    growth7d: growthPercent(last7Count, prev7Count),
    growth30d: growthPercent(last30Count, prev30Count),
  };
}

function buildMostScannedTokens(scanEvents) {
  const byContract = new Map();
  scanEvents.forEach((event) => {
    const key = event.contract || event.projectId || event.projectName;
    if (!key) return;
    const existing = byContract.get(key) || {
      name: event.projectName || 'Unknown project',
      ticker: event.ticker || 'N/A',
      contract: event.contract || 'Not provided',
      count: 0,
      scoreSum: 0,
      scoreCount: 0,
    };
    existing.count += 1;
    if (Number.isFinite(event.trustScore)) {
      existing.scoreSum += event.trustScore;
      existing.scoreCount += 1;
    }
    byContract.set(key, existing);
  });
  return Array.from(byContract.values())
    .map((entry) => ({
      name: entry.name,
      ticker: entry.ticker,
      contract: entry.contract,
      scanCount: entry.count,
      avgTrustScore: entry.scoreCount ? Math.round(entry.scoreSum / entry.scoreCount) : null,
    }))
    .sort((a, b) => b.scanCount - a.scanCount)
    .slice(0, 20);
}

function buildProjectAnalytics(viewEvents, scoreEvents) {
  const byProjectViews = new Map();
  viewEvents.forEach((event) => {
    const key = event.projectId || event.contract || event.projectName;
    if (!key) return;
    const existing = byProjectViews.get(key) || { name: event.projectName || 'Unknown project', ticker: event.ticker || 'N/A', count: 0 };
    existing.count += 1;
    byProjectViews.set(key, existing);
  });
  const mostViewed = Array.from(byProjectViews.values()).sort((a, b) => b.count - a.count).slice(0, 10);

  const latestScoreByProject = new Map();
  scoreEvents.forEach((event) => {
    const key = event.projectId || event.contract || event.projectName;
    if (!key || !Number.isFinite(event.trustScore)) return;
    const existing = latestScoreByProject.get(key);
    if (!existing || new Date(event.timestamp) > new Date(existing.timestamp)) {
      latestScoreByProject.set(key, {
        name: event.projectName || 'Unknown project',
        ticker: event.ticker || 'N/A',
        trustScore: event.trustScore,
        timestamp: event.timestamp,
      });
    }
  });
  const scored = Array.from(latestScoreByProject.values());
  const mostTrusted = [...scored].sort((a, b) => b.trustScore - a.trustScore).slice(0, 10);
  const lowestTrust = [...scored].sort((a, b) => a.trustScore - b.trustScore).slice(0, 10);

  // This platform's "search" and "scan" are the same action (pasting a
  // contract address scans it), so "most searched projects" reuses the same
  // view/scan grouping rather than a separate, necessarily-duplicate metric.
  const mostSearched = mostViewed;

  return { mostViewed, mostSearched, mostTrusted, lowestTrust };
}

function buildTrustScoreAnalytics(scoreEvents) {
  const latestScoreByProject = new Map();
  scoreEvents.forEach((event) => {
    if (!Number.isFinite(event.trustScore)) return;
    const key = event.projectId || event.contract || event.projectName;
    if (!key) return;
    const existing = latestScoreByProject.get(key);
    if (!existing || new Date(event.timestamp) > new Date(existing.timestamp)) {
      latestScoreByProject.set(key, event);
    }
  });
  const scores = Array.from(latestScoreByProject.values()).map((event) => event.trustScore);
  const average = scores.length ? Math.round(scores.reduce((total, score) => total + score, 0) / scores.length) : null;

  const distribution = { '0-20': 0, '21-40': 0, '41-60': 0, '61-80': 0, '81-100': 0 };
  scores.forEach((score) => {
    distribution[trustBucket(score)] += 1;
  });

  const trendByDay = new Map();
  scoreEvents.forEach((event) => {
    if (!Number.isFinite(event.trustScore) || !withinDays(event.timestamp, 30)) return;
    const key = dateKey(event.timestamp);
    const existing = trendByDay.get(key) || { sum: 0, count: 0 };
    existing.sum += event.trustScore;
    existing.count += 1;
    trendByDay.set(key, existing);
  });
  const trend = Array.from(trendByDay.entries())
    .map(([date, { sum, count }]) => ({ date, average: Math.round(sum / count) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  return { average, distribution, trend, sampleSize: scores.length };
}

function buildVisitorAnalytics(pageViewEvents) {
  const latestByVisitor = new Map();
  pageViewEvents.forEach((event) => {
    if (!event.visitorId) return;
    const existing = latestByVisitor.get(event.visitorId);
    if (!existing || new Date(event.timestamp) > new Date(existing.timestamp)) {
      latestByVisitor.set(event.visitorId, event);
    }
  });
  const visitors = Array.from(latestByVisitor.values());
  const newVisitors = visitors.filter((event) => event.isNewVisitor).length;
  const desktop = visitors.filter((event) => event.device !== 'mobile').length;
  const mobile = visitors.filter((event) => event.device === 'mobile').length;
  const loggedInVisitors = visitors.filter((event) => event.isLoggedIn).length;
  const guestVisitors = visitors.length - loggedInVisitors;

  const trafficSources = { direct: 0, google: 0, x: 0, telegram: 0, other: 0 };
  visitors.forEach((event) => {
    trafficSources[event.trafficSource] = (trafficSources[event.trafficSource] || 0) + 1;
  });

  return {
    totalVisitors: pageViewEvents.length,
    uniqueVisitors: visitors.length,
    newVisitors,
    returningVisitors: Math.max(0, visitors.length - newVisitors),
    loggedInVisitors,
    guestVisitors,
    desktop,
    mobile,
    trafficSources,
  };
}

async function buildVerificationAnalytics() {
  // Two independent blobs — read together, not one after the other.
  const [statuses, requests] = await Promise.all([readStatuses(), readRequests()]);

  const values = Object.values(statuses);
  const verifiedProjects = values.filter((entry) => entry.status === 'verified').length;
  const pendingVerification = values.filter((entry) => entry.status === 'pending').length;
  const rejectedVerification = values.filter((entry) => entry.status === 'rejected').length;

  const totalRequests = requests.length;
  const approved = requests.filter((request) => request.status === 'verified').length;
  const rejected = requests.filter((request) => request.status === 'rejected').length;
  const decided = approved + rejected;

  return {
    overview: { verifiedProjects, pendingVerification, rejectedVerification },
    totalRequests,
    pending: pendingVerification,
    approved,
    rejected,
    approvalRate: decided ? Math.round((approved / decided) * 1000) / 10 : 0,
    rejectionRate: decided ? Math.round((rejected / decided) * 1000) / 10 : 0,
  };
}

function buildPopularSearches(searchEvents) {
  const byQuery = new Map();
  searchEvents.forEach((event) => {
    const query = (event.query || '').trim();
    if (!query) return;
    const existing = byQuery.get(query) || { count: 0 };
    existing.count += 1;
    byQuery.set(query, existing);
  });
  return topByCount(byQuery, 20).map((entry) => ({ query: entry.key, count: entry.count }));
}

function buildTopActivity(events) {
  const byDay = new Map();
  const byWeek = new Map();
  const byMonth = new Map();
  events.forEach((event) => {
    const date = new Date(event.timestamp);
    const dayKey = date.toISOString().slice(0, 10);
    const monthKey = date.toISOString().slice(0, 7);
    const weekStart = new Date(date);
    weekStart.setUTCDate(date.getUTCDate() - date.getUTCDay());
    const weekKey = weekStart.toISOString().slice(0, 10);
    byDay.set(dayKey, (byDay.get(dayKey) || 0) + 1);
    byWeek.set(weekKey, (byWeek.get(weekKey) || 0) + 1);
    byMonth.set(monthKey, (byMonth.get(monthKey) || 0) + 1);
  });
  const pickTop = (map, labelKey) => {
    const entries = Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
    return entries.length ? { [labelKey]: entries[0][0], count: entries[0][1] } : { [labelKey]: null, count: 0 };
  };
  return {
    mostActiveDay: pickTop(byDay, 'date'),
    mostActiveWeek: pickTop(byWeek, 'weekStarting'),
    mostActiveMonth: pickTop(byMonth, 'month'),
  };
}

// ── Slice: everything derived from the analytics event log ───────────────────
//
// Reads the event log ONCE and the registered-user COUNT once, in parallel.
//
// The count comes from countRegisteredUsers() — a single LIST over the user key
// space — and NOT from getUserLoginStats(), which fetches every user record in
// full. `avgScansPerUser` and the Registered Users card need a number, not the
// records, and this slice must not be dragged down to the cost of the user slice
// to get one.
async function buildEventsSlice() {
  const [events, registeredTotal] = await Promise.all([
    readEvents(),
    countRegisteredUsers(),
  ]);

  const scanEvents = events.filter((item) => item.type === 'token_scan');
  const viewEvents = events.filter((item) => item.type === 'project_view');
  const addedEvents = events.filter((item) => item.type === 'project_added');
  const pageViewEvents = events.filter((item) => item.type === 'page_view');
  const searchEvents = events.filter((item) => item.type === 'search');
  const scoreEvents = events.filter((item) => Number.isFinite(item.trustScore) && (item.type === 'token_scan' || item.type === 'project_view'));

  const distinctProjects = new Set(
    events
      .filter((item) => ['token_scan', 'project_view', 'project_added'].includes(item.type))
      .map((item) => item.projectId || item.contract || item.projectName)
      .filter(Boolean)
  );

  const visitorAnalytics = buildVisitorAnalytics(pageViewEvents);
  const today = new Date().toISOString().slice(0, 10);

  // New registrations today: user_registered events stamped with today (UTC).
  const registeredToday = events.filter(
    (e) => e.type === 'user_registered' && dateKey(e.timestamp) === today
  ).length;

  // Returning users: accounts that logged in on 2+ DIFFERENT calendar days.
  // A set of distinct day-keys per user means multiple logins on the same
  // day count once (fixes over-counting same-day repeat requests).
  //
  // Still event-derived, and honestly so: this is a BEHAVIOURAL pattern over
  // time, not an all-time account fact, so the capped window is an
  // acceptable (and stated) horizon for it. It is deliberately NOT used for
  // any of the five headline cards.
  const loginDaysByUser = new Map();
  events.filter((e) => e.type === 'user_login' && e.userId).forEach((e) => {
    const days = loginDaysByUser.get(e.userId) || new Set();
    days.add(dateKey(e.timestamp));
    loginDaysByUser.set(e.userId, days);
  });
  const returningUsers = Array.from(loginDaysByUser.values()).filter((days) => days.size > 1).length;

  // Per-user scan counts, used only for the top-active-users ranking.
  const scansByUser = new Map();
  scanEvents.filter((e) => e.userId).forEach((e) => {
    scansByUser.set(e.userId, (scansByUser.get(e.userId) || 0) + 1);
  });
  const topActiveUsers = Array.from(scansByUser.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([userId, count]) => ({ userId, scanCount: count }));

  // Average scans per user = total successful scans / total registered users.
  // Uses the full scan total (every successful token_scan event), not just
  // scans attributed to a logged-in user, per the required definition.
  const avgScansPerUser = registeredTotal > 0
    ? Math.round((scanEvents.length / registeredTotal) * 10) / 10
    : 0;

  return {
    generatedAt: new Date().toISOString(),
    eventCount: events.length,
    overview: {
      totalScans: scanEvents.length,
      totalUsers: visitorAnalytics.uniqueVisitors,
      totalProjects: distinctProjects.size,
    },
    scanAnalytics: buildScanAnalytics(scanEvents),
    mostScannedTokens: buildMostScannedTokens(scanEvents),
    projectAnalytics: buildProjectAnalytics(viewEvents.length ? viewEvents : scanEvents, scoreEvents),
    trustScoreAnalytics: buildTrustScoreAnalytics(scoreEvents),
    visitorAnalytics,
    popularSearches: buildPopularSearches(searchEvents.length ? searchEvents : scanEvents),
    topActivity: buildTopActivity(events),
    projectsAddedCount: addedEvents.length,
    // The event-derived half of userAnalytics. The record-derived half lives in
    // the users slice; the two are merged into one object for the caller. They
    // are split along exactly the line the code already drew between them — a
    // capped telemetry window versus a permanent account fact.
    userAnalytics: { registeredToday, returningUsers, avgScansPerUser, topActiveUsers },
  };
}

// ── Slice: verification store ────────────────────────────────────────────────
async function buildVerificationSlice() {
  const verificationAnalytics = await buildVerificationAnalytics();
  return {
    generatedAt: new Date().toISOString(),
    overview: {
      verifiedProjects: verificationAnalytics.overview.verifiedProjects,
      pendingVerification: verificationAnalytics.overview.pendingVerification,
      rejectedVerification: verificationAnalytics.overview.rejectedVerification,
    },
    verificationAnalytics,
  };
}

// ── Slice: user records ──────────────────────────────────────────────────────
//
// THE AUTHORITATIVE FIVE, all from getUserLoginStats() — the USER RECORDS, not
// the event log. The event log is capped at 20 000 events and evicts
// oldest-first, so anything derived from it answers "…recently enough to survive
// the cap", not "…ever". For an all-time fact like "has this account ever
// authenticated" that is simply the wrong data source, and it is what made
// Logged In / Never Logged In disagree with each other and with Registered
// Users.
//
// `loggedInUsers` counts accounts whose `hasLoggedIn` flag is set by a
// successful authentication — NOT accounts that merely appear in the event log.
// The old value counted any event carrying a userId, so a page view or a scan
// made "logged in visitors" tick up, which is why it drifted up toward the
// registered total and eventually matched it.
//
// Throws (rather than returning zeros) when the figures do not add up. Absence
// is not zero: serving 0 registered users because a read failed would be a
// confident lie on the one screen whose entire purpose is being trustworthy.
async function buildUsersSlice() {
  const loginStats = await getUserLoginStats();

  const registeredUsers = loginStats.registeredUsers;
  const loggedInUsers = loginStats.loggedInUsers;
  const neverLoggedInUsers = loginStats.neverLoggedInUsers;
  const activeToday = loginStats.activeToday;
  const activeLast7Days = loginStats.activeLast7Days;

  // Fail LOUD rather than serve numbers that do not add up. The whole point of
  // this dashboard is that an administrator can trust it; silently rendering an
  // impossible set of figures is worse than an error, because decisions get made
  // on it. The buckets are complementary by construction, so this can only trip
  // on a genuine bug or on a partial read of the user records — `readFailures`
  // distinguishes the two.
  if (registeredUsers !== loggedInUsers + neverLoggedInUsers) {
    const error = new Error('user metrics failed their consistency check');
    error.detail = { registeredUsers, loggedInUsers, neverLoggedInUsers, readFailures: loginStats.readFailures ?? 0 };
    throw error;
  }

  return {
    generatedAt: new Date().toISOString(),
    userAnalytics: {
      // Canonical names, matching the required API contract.
      registeredUsers,
      loggedInUsers,
      neverLoggedInUsers,
      activeToday,
      activeLast7Days,

      // Legacy aliases, kept so nothing that already reads these breaks. They
      // point at the CORRECT values rather than the old event-derived ones.
      // `loggedInVisitors` in particular used to mean something else entirely
      // (see visitorAnalytics.loggedInVisitors, which is a distinct metric about
      // page-view sessions and keeps its own name).
      registeredTotal: registeredUsers,
      activeUsersToday: activeToday,
      loggedInVisitors: loggedInUsers,
    },
  };
}

const BUILDERS = {
  events: buildEventsSlice,
  verification: buildVerificationSlice,
  users: buildUsersSlice,
};

// Which slices this request asked for. Unknown names are ignored rather than
// rejected, and an empty/absent parameter means ALL — so the endpoint's original
// no-parameter contract is exactly what it always was.
function requestedSlices(params) {
  const raw = String(params?.section || '').trim();
  if (!raw) return SLICES;
  const asked = new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
  const picked = SLICES.filter((name) => asked.has(name));
  return picked.length ? picked : SLICES;
}

// Merge slice payloads into one response. Only `overview` is contributed to by
// more than one slice, and only `userAnalytics` is split across two, so both are
// shallow-merged and everything else is assigned.
//
// `generatedAt` is the OLDEST slice's stamp, not the time the response was
// assembled. Slices are cached independently, so they can be minutes apart, and
// a fresh-looking timestamp over a stale figure is exactly the kind of quiet
// untruth this dashboard cannot afford. The per-slice stamps are returned too,
// so the screen can label each card group with its own age.
function mergeSlices(names, parts) {
  const merged = { overview: {}, userAnalytics: {} };
  const sectionsGeneratedAt = {};
  parts.forEach((part, index) => {
    sectionsGeneratedAt[names[index]] = part.generatedAt;
    for (const [key, value] of Object.entries(part)) {
      if (key === 'generatedAt') continue;
      if (key === 'overview' || key === 'userAnalytics') Object.assign(merged[key], value);
      else merged[key] = value;
    }
  });
  // A slice-scoped request never invents the keys it did not compute.
  if (!Object.keys(merged.overview).length) delete merged.overview;
  if (!Object.keys(merged.userAnalytics).length) delete merged.userAnalytics;
  const stamps = Object.values(sectionsGeneratedAt).filter(Boolean).sort();
  return { generatedAt: stamps[0] || new Date().toISOString(), sectionsGeneratedAt, ...merged };
}

export async function handler(event) {
  try {
    if (event.httpMethod !== 'GET') {
      return jsonResponse(405, { message: 'Method not allowed' });
    }
    if (!verifyToken(bearerToken(event))) {
      return jsonResponse(401, { message: 'Unauthorized' });
    }

    const params = event.queryStringParameters || {};
    const sections = requestedSlices(params);
    // Manual Refresh must be able to see a change the operator has just made,
    // so it recomputes every requested slice from the store instead of being
    // answered from the cache.
    const bypass = params.refresh === '1' || params.refresh === 'true';

    // Every slice reads a DIFFERENT store, so they overlap instead of queueing.
    // This is the whole reason the four store reads no longer add up: the
    // request now costs the slowest source, not the sum of all of them.
    const settled = await Promise.allSettled(sections.map((name) => cachedAggregate(
      `analytics-summary:${name}`,
      BUILDERS[name],
      { ttlMs: SLICE_TTL_MS, bypass },
    )));

    // Any failed slice fails the response. A partially-populated payload would
    // be indistinguishable from real zeros to anything reading it without
    // checking — including the CSV export and the consistency note on screen —
    // and "absence rendered as 0" is precisely the class of bug this dashboard
    // has already been burned by. Isolation comes from the CALLER asking for one
    // slice at a time: a broken source then costs one card group, not the
    // screen. The all-or-nothing rule for the combined payload is unchanged.
    const failure = settled.findIndex((result) => result.status === 'rejected');
    if (failure !== -1) {
      const reason = settled[failure].reason;
      return jsonResponse(500, {
        message: `analytics-summary (${sections[failure]}): ${reason?.message || 'failed'}`,
        ...(reason?.detail ? { detail: reason.detail } : {}),
      });
    }

    return jsonResponse(200, {
      sections,
      ...mergeSlices(sections, settled.map((result) => result.value)),
    });
  } catch (error) {
    return jsonResponse(500, { message: `analytics-summary crashed: ${error.message}` });
  }
}
