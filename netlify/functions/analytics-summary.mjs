import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { readEvents, jsonResponse } from './_analyticsStore.mjs';
import { readStatuses, readRequests } from './_verificationStore.mjs';
import { countRegisteredUsers } from './_authStore.mjs';

const DAY_MS = 86400000;

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
  const statuses = await readStatuses();
  const values = Object.values(statuses);
  const verifiedProjects = values.filter((entry) => entry.status === 'verified').length;
  const pendingVerification = values.filter((entry) => entry.status === 'pending').length;
  const rejectedVerification = values.filter((entry) => entry.status === 'rejected').length;

  const requests = await readRequests();
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

export async function handler(event) {
  try {
    if (event.httpMethod !== 'GET') {
      return jsonResponse(405, { message: 'Method not allowed' });
    }
    if (!verifyToken(bearerToken(event))) {
      return jsonResponse(401, { message: 'Unauthorized' });
    }

    const events = await readEvents();
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

    const verificationAnalytics = await buildVerificationAnalytics();
    const visitorAnalytics = buildVisitorAnalytics(pageViewEvents);

    // Registered-user analytics. Every value below is derived from the same
    // event log plus the auth store's real user count - no counters, no mocks.
    // "Today" is the UTC calendar day; event timestamps are UTC ISO strings
    // too, so all day comparisons are timezone-consistent (no local/UTC drift).
    const registeredTotal = await countRegisteredUsers().catch(() => 0);
    const today = new Date().toISOString().slice(0, 10);

    // New registrations today: user_registered events stamped with today (UTC).
    const registeredToday = events.filter(
      (e) => e.type === 'user_registered' && dateKey(e.timestamp) === today
    ).length;

    // Active users today: unique authenticated accounts with ANY activity on
    // today's calendar day (scan, view, page_view, login...). Requires a
    // userId, so only authenticated activity is counted - a calendar-day match,
    // not a rolling 24h window.
    const activeUserIds = new Set(
      events.filter((e) => e.userId && dateKey(e.timestamp) === today).map((e) => e.userId)
    );

    // Returning users: accounts that logged in on 2+ DIFFERENT calendar days.
    // A set of distinct day-keys per user means multiple logins on the same
    // day count once (fixes over-counting same-day repeat requests).
    const loginDaysByUser = new Map();
    events.filter((e) => e.type === 'user_login' && e.userId).forEach((e) => {
      const days = loginDaysByUser.get(e.userId) || new Set();
      days.add(dateKey(e.timestamp));
      loginDaysByUser.set(e.userId, days);
    });
    const returningUsers = Array.from(loginDaysByUser.values()).filter((days) => days.size > 1).length;

    // Logged-in visitors: unique authenticated accounts (distinct userIds).
    const loggedInVisitors = new Set(events.filter((e) => e.userId).map((e) => e.userId)).size;

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

    const userAnalytics = {
      registeredTotal,
      registeredToday,
      activeUsersToday: activeUserIds.size,
      returningUsers,
      loggedInVisitors,
      avgScansPerUser,
      topActiveUsers,
    };

    const overview = {
      totalScans: scanEvents.length,
      totalUsers: visitorAnalytics.uniqueVisitors,
      totalProjects: distinctProjects.size,
      verifiedProjects: verificationAnalytics.overview.verifiedProjects,
      pendingVerification: verificationAnalytics.overview.pendingVerification,
      rejectedVerification: verificationAnalytics.overview.rejectedVerification,
    };

    return jsonResponse(200, {
      generatedAt: new Date().toISOString(),
      eventCount: events.length,
      overview,
      scanAnalytics: buildScanAnalytics(scanEvents),
      mostScannedTokens: buildMostScannedTokens(scanEvents),
      projectAnalytics: buildProjectAnalytics(viewEvents.length ? viewEvents : scanEvents, scoreEvents),
      trustScoreAnalytics: buildTrustScoreAnalytics(scoreEvents),
      visitorAnalytics,
      verificationAnalytics,
      userAnalytics,
      popularSearches: buildPopularSearches(searchEvents.length ? searchEvents : scanEvents),
      topActivity: buildTopActivity(events),
      projectsAddedCount: addedEvents.length,
    });
  } catch (error) {
    return jsonResponse(500, { message: `analytics-summary crashed: ${error.message}` });
  }
}
