// GET /.netlify/functions/premium-admin-activity
// Admin-only, read-only. Returns every registered user enriched with real
// activity metrics derived from the analytics event log, their manual-premium
// grant, account-scoped watchlist size, and observed wallet link - plus the
// dashboard aggregate cards. This is the data source for the enhanced
// Registered Users / Premium Management table.
//
// It is purely additive and never mutates anything. The original
// premium-admin-list endpoint is left untouched for backward compatibility.
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { listRegisteredUsers, countRegisteredUsers, jsonResponse } from './_authStore.mjs';
import { readGrants, isGrantActive, effectivePlan } from './_premiumStore.mjs';
import { readEntitlements, countActivePaidPremium } from './_entitlementsStore.mjs';
import { readEvents } from './_analyticsStore.mjs';
import { readAllUserData } from './_userDataStore.mjs';
import { readWalletLinks } from './_walletLinkStore.mjs';
import {
  indexEventsByUser, computeUserMetrics, computeActivityScore, isActiveWithinDays, dayKey,
} from './_userActivity.mjs';

export async function handler(event) {
  if (event.httpMethod !== 'GET') return jsonResponse(405, { message: 'Method not allowed' });
  if (!verifyToken(bearerToken(event))) return jsonResponse(401, { message: 'Unauthorized' });

  const [users, grants, total, events, allUserData, walletLinks] = await Promise.all([
    listRegisteredUsers(2000),
    readGrants(),
    countRegisteredUsers(),
    readEvents(),
    readAllUserData(),
    readWalletLinks(),
  ]);

  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const eventsByUser = indexEventsByUser(events);

  // Paid Premium is read from the paid-entitlements store, which is the ONLY
  // record of a real purchase — it is fully isolated from the manual/promo/
  // gifted grants above (see _premiumStore vs _entitlementsStore). Read
  // separately and fail-soft to 0: a blob hiccup on this store must degrade one
  // analytics card, never take down the whole Premium dashboard.
  const entitlements = await readEntitlements().catch(() => ({}));
  const paidPremiumCount = countActivePaidPremium(entitlements, now);

  const rows = users.map((u) => {
    const grant = grants[u.id] || null;
    const active = isGrantActive(grant, now);

    const metrics = computeUserMetrics(eventsByUser.get(u.id));
    // Account-scoped watchlist lives under the "u:<id>" key (see
    // _premiumAccess.mjs). Paid-wallet watchlists are keyed by wallet and are
    // intentionally not linked to accounts, so this reflects account usage.
    const accountData = allUserData[`u:${u.id}`] || null;
    const watchlistCount = Array.isArray(accountData?.watchlist) ? accountData.watchlist.length : 0;
    const link = walletLinks[u.id] || null;

    const { score, level } = computeActivityScore({ ...metrics, watchlistCount }, now);

    return {
      id: u.id,
      name: u.name || '',
      username: u.username || '',
      email: u.email,
      createdAt: u.createdAt || null,
      emailVerified: Boolean(u.emailVerified),
      // Premium (unchanged from premium-admin-list)
      plan: effectivePlan(grant, now),
      status: active ? 'active' : 'inactive',
      source: grant?.source || null,
      reason: grant?.reason || '',
      expiresAt: active ? (grant?.expiresAt ?? null) : null,
      grantedBy: grant?.grantedBy || null,
      grantedAt: grant?.grantedAt || null,
      // Activity intelligence (analysis only - never a moderation signal)
      //
      // lastLogin/lastActivity prefer the DURABLE fields on the user record and
      // fall back to what the event log still remembers. The record is
      // authoritative and permanent; the event log is a capped window that
      // silently forgets. Falling back the other way round would make an
      // account look dormant simply because its events aged out.
      lastLogin: u.lastLoginAt || metrics.lastLogin,
      lastActivity: u.lastActiveAt || metrics.lastActivity,
      hasLoggedIn: u.hasLoggedIn === true,
      firstLoginAt: u.firstLoginAt || null,
      // Whether this account's login state was RECONSTRUCTED by the migration
      // rather than observed. Surfaced so an admin can tell the difference.
      loginStateSource: u.loginStateSource || 'observed',
      loginCount: metrics.loginCount,
      scanCount: metrics.scanCount,
      compareCount: metrics.compareCount,
      projectsViewed: metrics.projectsViewed,
      watchlistCount,
      walletConnected: Boolean(link),
      walletAddress: link?.wallet || null,
      accountAgeDays: u.createdAt ? Math.max(0, Math.floor((now - Date.parse(u.createdAt)) / 86400000)) : null,
      activityScore: score,
      activityLevel: level,
    };
  });

  // Most recently active first, then most recently granted, then newest.
  rows.sort((a, b) => {
    const aa = a.lastActivity ? Date.parse(a.lastActivity) : 0;
    const ba = b.lastActivity ? Date.parse(b.lastActivity) : 0;
    if (ba !== aa) return ba - aa;
    const ga = a.grantedAt ? Date.parse(a.grantedAt) : 0;
    const gb = b.grantedAt ? Date.parse(b.grantedAt) : 0;
    if (gb !== ga) return gb - ga;
    return (b.createdAt ? Date.parse(b.createdAt) : 0) - (a.createdAt ? Date.parse(a.createdAt) : 0);
  });

  // Dashboard aggregate cards.
  //
  // The user-state cards (registered / logged in / never logged in / active)
  // are derived from `rows`, which are the USER RECORDS — the same durable
  // `hasLoggedIn` and `lastActiveAt` fields analytics-summary reads. Both
  // endpoints therefore report identical figures.
  //
  // They previously disagreed because this endpoint derived "never logged in"
  // from `loginCount === 0` (a count of surviving `user_login` EVENTS, written
  // only by the password-login path) while analytics-summary derived "logged
  // in" from distinct userIds across ALL event types. The two were not
  // complements of each other and shared no denominator, so they could never
  // sum to the registered total — and both drifted as the event log evicted.
  const loggedInRows = rows.filter((r) => r.hasLoggedIn);
  const dashboard = {
    totalRegistered: total,
    verified: rows.filter((r) => r.emailVerified).length,

    // Active = authenticated activity. Restricted to accounts that have
    // actually logged in, so activeToday can never exceed loggedIn.
    activeToday: loggedInRows.filter((r) => dayKey(r.lastActivity) === today).length,
    activeThisWeek: loggedInRows.filter((r) => isActiveWithinDays(r.lastActivity, 7, now)).length,

    withScans: rows.filter((r) => r.scanCount > 0).length,
    zeroScans: rows.filter((r) => r.scanCount === 0).length,

    loggedIn: loggedInRows.length,
    neverLoggedIn: rows.filter((r) => !r.hasLoggedIn).length,

    walletConnected: rows.filter((r) => r.walletConnected).length,
    // Active Premium = EVERY active grant regardless of source (manual, promo,
    // giveaway, early_supporter, or payment). Paid Premium = only real
    // purchases, from the separate entitlements store. Paid is a subset in
    // spirit but counted from a different lane, so it is never derived by
    // filtering `rows`.
    premiumUsers: rows.filter((r) => r.status === 'active').length,
    paidPremiumUsers: paidPremiumCount,
  };

  // Same assertion as analytics-summary. `total` comes from countRegisteredUsers
  // (a blob-prefix count) while the buckets come from listRegisteredUsers, so
  // this ALSO catches the pagination trap: if the user list is ever truncated
  // below the true total, the halves stop summing and we refuse to serve rather
  // than quietly under-report every card.
  if (dashboard.loggedIn + dashboard.neverLoggedIn !== total) {
    return jsonResponse(500, {
      message: 'premium-admin-activity: user metrics failed their consistency check',
      detail: {
        totalRegistered: total,
        loggedIn: dashboard.loggedIn,
        neverLoggedIn: dashboard.neverLoggedIn,
        rowsReturned: rows.length,
      },
    });
  }

  return jsonResponse(200, {
    totalRegistered: total,
    premiumCount: dashboard.premiumUsers,
    paidPremiumCount: dashboard.paidPremiumUsers,
    dashboard,
    users: rows,
  });
}
