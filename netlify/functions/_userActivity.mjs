// Derives per-user activity intelligence from the ONE analytics event log
// (_analyticsStore.mjs). This module is read-only and additive: it never
// writes events, never mutates the auth / premium / entitlement stores, and
// never classifies or bans anyone. It only summarises real, already-recorded
// platform usage so an administrator can tell an active account from a dormant
// one before granting Premium.
//
// Every metric comes from events that already carry a `userId` (attached by
// src/platformAnalytics.js once a user is signed in), so only authenticated
// activity is attributed to an account - exactly the same basis the analytics
// dashboard already uses.
const DAY_MS = 86400000;

// Event types the aggregation understands. Login is recorded server-side by
// auth-login.mjs; the rest arrive through analytics-track.mjs.
export const ACTIVITY_EVENT_TYPES = new Set([
  'user_login', 'token_scan', 'compare_used', 'project_view',
  'project_added', 'search', 'page_view',
]);

function dayKey(iso) {
  return typeof iso === 'string' ? iso.slice(0, 10) : '';
}

// Group every user-attributed event into one bucket per account in a single
// pass. Returns Map(userId -> { logins, scans, compares, views, searches,
// pageViews, all }) where each value is the array of that user's events.
export function indexEventsByUser(events) {
  const byUser = new Map();
  for (const evt of events) {
    if (!evt || !evt.userId) continue;
    let bucket = byUser.get(evt.userId);
    if (!bucket) {
      bucket = { logins: [], scans: [], compares: [], views: [], added: [], searches: [], pageViews: [], all: [] };
      byUser.set(evt.userId, bucket);
    }
    bucket.all.push(evt);
    switch (evt.type) {
      case 'user_login': bucket.logins.push(evt); break;
      case 'token_scan': bucket.scans.push(evt); break;
      case 'compare_used': bucket.compares.push(evt); break;
      case 'project_view': bucket.views.push(evt); break;
      case 'project_added': bucket.added.push(evt); break;
      case 'search': bucket.searches.push(evt); break;
      case 'page_view': bucket.pageViews.push(evt); break;
      default: break;
    }
  }
  return byUser;
}

function latestTimestamp(list) {
  let max = null;
  for (const evt of list) {
    const ts = Date.parse(evt.timestamp || '');
    if (!Number.isNaN(ts) && (max === null || ts > max)) max = ts;
  }
  return max === null ? null : new Date(max).toISOString();
}

function distinctProjectCount(list) {
  const set = new Set();
  for (const evt of list) {
    const key = evt.projectId || evt.contract || evt.projectName;
    if (key) set.add(key);
  }
  return set.size;
}

function distinctDayCount(list) {
  const set = new Set();
  for (const evt of list) {
    const key = dayKey(evt.timestamp);
    if (key) set.add(key);
  }
  return set.size;
}

// Summarise one user's bucket into the flat metrics the admin table shows.
// An empty/undefined bucket (a user with zero attributed activity) yields all
// zeros / nulls, which is itself meaningful ("Never Logged In", "Never
// Scanned").
export function computeUserMetrics(bucket) {
  const b = bucket || { logins: [], scans: [], compares: [], views: [], all: [] };
  return {
    loginCount: b.logins.length,
    lastLogin: latestTimestamp(b.logins),
    scanCount: b.scans.length,
    compareCount: b.compares.length,
    projectsViewed: distinctProjectCount(b.views),
    lastActivity: latestTimestamp(b.all),
    distinctLoginDays: distinctDayCount(b.logins),
    pageViewCount: b.pageViews ? b.pageViews.length : 0,
  };
}

// A simple, transparent 0-100 Activity Score built ONLY from real usage. It is
// an engagement indicator, NOT a bot detector and NOT a moderation signal - it
// never labels an account as fake. The platform does not record session
// duration, so "time spent" is proxied by how many distinct days the account
// was active and how recently. Each component is capped so no single behaviour
// dominates, and the caps sum to exactly 100.
export function computeActivityScore(metrics, now = Date.now()) {
  const cap = (value, max) => Math.min(value, max);

  const loginPoints = cap(metrics.loginCount * 3, 20);         // showing up
  const scanPoints = cap(metrics.scanCount * 2, 30);           // core action
  const comparePoints = cap(metrics.compareCount * 3, 15);     // deeper usage
  const watchlistPoints = cap((metrics.watchlistCount || 0) * 3, 15);
  const returningPoints = cap(metrics.distinctLoginDays * 3, 10); // repeat visits

  let recencyPoints = 0;
  if (metrics.lastActivity) {
    const ageDays = (now - Date.parse(metrics.lastActivity)) / DAY_MS;
    if (ageDays <= 7) recencyPoints = 10;
    else if (ageDays <= 30) recencyPoints = 5;
  }

  const score = Math.max(0, Math.min(100, Math.round(
    loginPoints + scanPoints + comparePoints + watchlistPoints + returningPoints + recencyPoints
  )));

  let level = 'low';
  if (score >= 65) level = 'high';
  else if (score >= 30) level = 'medium';

  return { score, level };
}

// True when the account had ANY attributed activity today (UTC calendar day),
// matching the analytics dashboard's "active today" definition.
export function isActiveWithinDays(lastActivityIso, days, now = Date.now()) {
  if (!lastActivityIso) return false;
  const ts = Date.parse(lastActivityIso);
  if (Number.isNaN(ts)) return false;
  return now - ts <= days * DAY_MS;
}

export { DAY_MS, dayKey };
