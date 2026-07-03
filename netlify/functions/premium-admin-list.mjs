// GET /.netlify/functions/premium-admin-list
// Admin-only. Returns every registered user merged with their manual-premium
// grant, so the Premium Management page can show plan / status / source for
// all accounts and search across them. Read-only; never mutates anything.
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { listRegisteredUsers, countRegisteredUsers, jsonResponse } from './_authStore.mjs';
import { readGrants, isGrantActive, effectivePlan } from './_premiumStore.mjs';

export async function handler(event) {
  if (event.httpMethod !== 'GET') return jsonResponse(405, { message: 'Method not allowed' });
  if (!verifyToken(bearerToken(event))) return jsonResponse(401, { message: 'Unauthorized' });

  const [users, grants, total] = await Promise.all([
    listRegisteredUsers(500),
    readGrants(),
    countRegisteredUsers(),
  ]);

  const now = Date.now();
  const rows = users.map((u) => {
    const grant = grants[u.id] || null;
    const active = isGrantActive(grant, now);
    return {
      id: u.id,
      name: u.name || '',
      username: u.username || '',
      email: u.email,
      createdAt: u.createdAt || null,
      emailVerified: Boolean(u.emailVerified),
      plan: effectivePlan(grant, now),
      status: active ? 'active' : 'inactive',
      source: grant?.source || null,
      reason: grant?.reason || '',
      expiresAt: active ? (grant?.expiresAt ?? null) : null,
      grantedBy: grant?.grantedBy || null,
      grantedAt: grant?.grantedAt || null,
    };
  });

  // Most recently granted first, then newest accounts.
  rows.sort((a, b) => {
    const ga = a.grantedAt ? Date.parse(a.grantedAt) : 0;
    const gb = b.grantedAt ? Date.parse(b.grantedAt) : 0;
    if (gb !== ga) return gb - ga;
    return (b.createdAt ? Date.parse(b.createdAt) : 0) - (a.createdAt ? Date.parse(a.createdAt) : 0);
  });

  const premiumCount = rows.filter((r) => r.status === 'active').length;

  return jsonResponse(200, {
    totalRegistered: total,
    premiumCount,
    users: rows,
  });
}
