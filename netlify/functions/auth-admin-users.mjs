// Admin endpoint: list registered users and user analytics.
// Requires the same admin token as other admin endpoints.
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { listRegisteredUsers, countRegisteredUsers, jsonResponse } from './_authStore.mjs';
import { readEvents } from './_analyticsStore.mjs';

export async function handler(event) {
  if (event.httpMethod !== 'GET') return jsonResponse(405, { message: 'Method not allowed' });
  if (!verifyToken(bearerToken(event))) return jsonResponse(401, { message: 'Unauthorized' });

  const [users, events, totalCount] = await Promise.all([
    listRegisteredUsers(200),
    readEvents(),
    countRegisteredUsers(),
  ]);

  const today = new Date().toISOString().slice(0, 10); // UTC calendar day; timestamps are UTC ISO too.
  const dayKey = (ts) => String(ts || '').slice(0, 10);

  // Active users today: unique authenticated accounts active on today's
  // calendar day (not a rolling 24h window).
  const activeUserIds = new Set(
    events.filter((e) => e.userId && dayKey(e.timestamp) === today).map((e) => e.userId)
  );

  // Login count per userId (raw event count, shown per-user below).
  const loginsByUser = new Map();
  // Distinct login DAYS per userId (used to define "returning").
  const loginDaysByUser = new Map();
  events.filter((e) => e.type === 'user_login' && e.userId).forEach((e) => {
    loginsByUser.set(e.userId, (loginsByUser.get(e.userId) || 0) + 1);
    const days = loginDaysByUser.get(e.userId) || new Set();
    days.add(dayKey(e.timestamp));
    loginDaysByUser.set(e.userId, days);
  });

  // Registrations today (UTC calendar day).
  const registeredToday = events.filter(
    (e) => e.type === 'user_registered' && dayKey(e.timestamp) === today
  ).length;

  // Scans per userId (for per-user display / ranking).
  const scanEvents = events.filter((e) => e.type === 'token_scan');
  const scansByUser = new Map();
  scanEvents.filter((e) => e.userId).forEach((e) => {
    scansByUser.set(e.userId, (scansByUser.get(e.userId) || 0) + 1);
  });

  // Average scans per user = total successful scans / total registered users.
  const avgScansPerUser = totalCount > 0
    ? Math.round((scanEvents.length / totalCount) * 10) / 10
    : 0;

  // Top active users by scan count
  const topUsers = users
    .map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      createdAt: u.createdAt,
      emailVerified: u.emailVerified,
      scanCount: scansByUser.get(u.id) || 0,
      loginCount: loginsByUser.get(u.id) || 0,
      isActiveToday: activeUserIds.has(u.id),
    }))
    .sort((a, b) => b.scanCount - a.scanCount);

  return jsonResponse(200, {
    totalRegistered: totalCount,
    registeredToday,
    activeUsersToday: activeUserIds.size,
    returningUsers: Array.from(loginDaysByUser.values()).filter((days) => days.size > 1).length,
    avgScansPerUser,
    users: topUsers,
  });
}
