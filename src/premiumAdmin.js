// Client helpers for the admin Premium Management module and for the
// logged-in user's own manual-premium status.
//
// Admin calls reuse the same shared admin token as every other admin page
// (sessionStorage, see verification.js getStoredAdminToken). The user-facing
// call reuses the normal auth JWT (localStorage). Nothing here touches the
// payment / wallet-entitlement code paths.
const AUTH_TOKEN_KEY = 'khan-trust-auth-token-v1';

async function callAdmin(path, token, options = {}) {
  const res = await fetch(`/.netlify/functions/${path}`, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(data.message || `Request to ${path} failed (${res.status})`), { status: res.status });
  }
  return data;
}

// ── Admin: list registered users + their manual premium ───────────────────────
export async function fetchPremiumUsers(token) {
  return callAdmin('premium-admin-list', token);
}

// Admin: registered users enriched with real activity metrics + dashboard
// aggregates (see premium-admin-activity.mjs). Superset of fetchPremiumUsers.
export async function fetchUserActivity(token) {
  return callAdmin('premium-admin-activity', token);
}

// Admin: full activity history for one user (User Details modal).
export async function fetchUserActivityDetail(token, userId) {
  return callAdmin(`premium-admin-user-detail?userId=${encodeURIComponent(userId)}`, token);
}

export async function fetchPremiumAudit(token) {
  const data = await callAdmin('premium-admin-audit', token);
  return data.entries || [];
}

// action: 'grant' | 'change_plan' | 'revoke'
export async function submitPremiumAction(token, body) {
  return callAdmin('premium-admin-action', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Bulk grant/remove Premium for many users at once.
// action: 'bulk_grant' | 'bulk_revoke'; body carries userIds[] + duration.
export async function submitBulkPremiumAction(token, body) {
  return callAdmin('premium-admin-bulk-action', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ── Current user: read own manual premium entitlement ─────────────────────────
// Best-effort: any failure (logged out, endpoint unavailable) resolves to null
// so it can never block or break the Premium UI.
export async function fetchMyManualPremium() {
  let token = null;
  try { token = localStorage.getItem(AUTH_TOKEN_KEY); } catch { token = null; }
  if (!token) return null;
  try {
    const res = await fetch('/.netlify/functions/premium-me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.entitlement || null;
  } catch {
    return null;
  }
}
