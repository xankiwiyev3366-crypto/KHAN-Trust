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
      lastLogin: metrics.lastLogin,
      lastActivity: metrics.lastActivity,
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

  // Dashboard aggregate cards - all derived from the same rows.
  const dashboard = {
    totalRegistered: total,
    verified: rows.filter((r) => r.emailVerified).length,
    activeToday: rows.filter((r) => dayKey(r.lastActivity) === today).length,
    activeThisWeek: rows.filter((r) => isActiveWithinDays(r.lastActivity, 7, now)).length,
    withScans: rows.filter((r) => r.scanCount > 0).length,
    zeroScans: rows.filter((r) => r.scanCount === 0).length,
    neverLoggedIn: rows.filter((r) => r.loginCount === 0).length,
    walletConnected: rows.filter((r) => r.walletConnected).length,
    premiumUsers: rows.filter((r) => r.status === 'active').length,
  };

  return jsonResponse(200, {
    totalRegistered: total,
    premiumCount: dashboard.premiumUsers,
    dashboard,
    users: rows,
  });
}
