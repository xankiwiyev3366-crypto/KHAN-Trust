// GET /.netlify/functions/premium-admin-user-detail?userId=<id>
// Admin-only, read-only. Returns the full activity history for ONE registered
// user for the "User Details" modal: registration, logins, scans, compares,
// project views, searches, watchlist, premium history, and wallet status.
// Loaded on demand so the main table stays light. Analysis only - it never
// mutates anything and never classifies the account.
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { getUserById, jsonResponse } from './_authStore.mjs';
import { readGrants, isGrantActive, effectivePlan, readAudit } from './_premiumStore.mjs';
import { readEvents } from './_analyticsStore.mjs';
import { readAllUserData } from './_userDataStore.mjs';
import { readWalletLinks } from './_walletLinkStore.mjs';
import { indexEventsByUser, computeUserMetrics, computeActivityScore } from './_userActivity.mjs';

// Keep each history slice bounded so a very active account can never produce an
// unboundedly large response.
const MAX_ITEMS = 100;

function sortDescByTime(list) {
  return [...list].sort((a, b) => Date.parse(b.timestamp || '') - Date.parse(a.timestamp || ''));
}

export async function handler(event) {
  if (event.httpMethod !== 'GET') return jsonResponse(405, { message: 'Method not allowed' });
  if (!verifyToken(bearerToken(event))) return jsonResponse(401, { message: 'Unauthorized' });

  const userId = (event.queryStringParameters?.userId || '').trim();
  if (!userId) return jsonResponse(400, { message: 'userId is required.' });

  const user = await getUserById(userId);
  if (!user) return jsonResponse(404, { message: 'Registered user not found.' });

  const [grants, events, allUserData, walletLinks, audit] = await Promise.all([
    readGrants(),
    readEvents(),
    readAllUserData(),
    readWalletLinks(),
    readAudit(),
  ]);

  const now = Date.now();
  const bucket = indexEventsByUser(events).get(userId) || null;
  const metrics = computeUserMetrics(bucket);

  const accountData = allUserData[`u:${userId}`] || null;
  const watchlist = Array.isArray(accountData?.watchlist) ? accountData.watchlist : [];
  const savedReports = Array.isArray(accountData?.savedReports) ? accountData.savedReports : [];
  const watchlistCount = watchlist.length;

  const grant = grants[userId] || null;
  const { score, level } = computeActivityScore({ ...metrics, watchlistCount }, now);

  const link = walletLinks[userId] || null;

  // Premium history: every audit entry that targeted this specific user
  // (bulk entries have no userId, so they are naturally excluded here).
  const premiumHistory = audit
    .filter((entry) => entry.userId === userId)
    .slice(0, MAX_ITEMS);

  const b = bucket || { logins: [], scans: [], compares: [], views: [], searches: [] };
  const mapEvt = (e) => ({
    timestamp: e.timestamp,
    projectName: e.projectName || '',
    ticker: e.ticker || '',
    contract: e.contract || '',
    trustScore: Number.isFinite(e.trustScore) ? e.trustScore : null,
    query: e.query || '',
  });

  return jsonResponse(200, {
    user: {
      id: user.id,
      name: user.name || '',
      username: user.username || '',
      email: user.email,
      createdAt: user.createdAt || null,
      emailVerified: Boolean(user.emailVerified),
    },
    metrics: {
      ...metrics,
      watchlistCount,
      savedReportsCount: savedReports.length,
      accountAgeDays: user.createdAt ? Math.max(0, Math.floor((now - Date.parse(user.createdAt)) / 86400000)) : null,
      activityScore: score,
      activityLevel: level,
    },
    premium: {
      plan: effectivePlan(grant, now),
      status: isGrantActive(grant, now) ? 'active' : 'inactive',
      source: grant?.source || null,
      expiresAt: isGrantActive(grant, now) ? (grant?.expiresAt ?? null) : null,
      grantedBy: grant?.grantedBy || null,
      grantedAt: grant?.grantedAt || null,
    },
    wallet: {
      connected: Boolean(link),
      address: link?.wallet || null,
      firstLinkedAt: link?.firstLinkedAt || null,
      lastSeenAt: link?.lastSeenAt || null,
    },
    history: {
      logins: sortDescByTime(b.logins).slice(0, MAX_ITEMS).map((e) => ({ timestamp: e.timestamp })),
      scans: sortDescByTime(b.scans).slice(0, MAX_ITEMS).map(mapEvt),
      compares: sortDescByTime(b.compares).slice(0, MAX_ITEMS).map(mapEvt),
      views: sortDescByTime(b.views).slice(0, MAX_ITEMS).map(mapEvt),
      searches: sortDescByTime(b.searches).slice(0, MAX_ITEMS).map((e) => ({ timestamp: e.timestamp, query: e.query || '' })),
      watchlist,
      premium: premiumHistory,
    },
  });
}
