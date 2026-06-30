// Admin endpoint: list registered users and user analytics.
// Requires the same admin token as other admin endpoints.
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { listRegisteredUsers, countRegisteredUsers, jsonResponse } from './_authStore.mjs';
import { readEvents } from './_analyticsStore.mjs';

const DAY_MS = 86400000;

export async function handler(event) {
  if (event.httpMethod !== 'GET') return jsonResponse(405, { message: 'Method not allowed' });
  if (!verifyToken(bearerToken(event))) return jsonResponse(401, { message: 'Unauthorized' });

  const [users, events, totalCount] = await Promise.all([
    listRegisteredUsers(200),
    readEvents(),
    countRegisteredUsers(),
  ]);

  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  // Events in last 24h grouped by userId
  const activeUserIds = new Set(
    events
      .filter((e) => e.userId && now - new Date(e.timestamp).getTime() <= DAY_MS)
      .map((e) => e.userId)
  );

  // Login events per userId
  const loginsByUser = new Map();
  events.filter((e) => e.type === 'user_login' && e.userId).forEach((e) => {
    loginsByUser.set(e.userId, (loginsByUser.get(e.userId) || 0) + 1);
  });

  // Registrations today
  const registeredToday = events.filter(
    (e) => e.type === 'user_registered' && e.timestamp?.startsWith(today)
  ).length;

  // Scans per userId
  const scansByUser = new Map();
  events.filter((e) => e.type === 'token_scan' && e.userId).forEach((e) => {
    scansByUser.set(e.userId, (scansByUser.get(e.userId) || 0) + 1);
  });

  const totalScansWithUser = Array.from(scansByUser.values()).reduce((a, b) => a + b, 0);
  const avgScansPerUser = totalCount > 0 ? Math.round(totalScansWithUser / totalCount) : 0;

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
    returningUsers: Array.from(loginsByUser.values()).filter((n) => n > 1).length,
    avgScansPerUser,
    users: topUsers,
  });
}
