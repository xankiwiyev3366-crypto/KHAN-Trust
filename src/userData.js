// Client module for Premium/Early Supporter-exclusive user data (saved
// reports, synced watchlist) - see netlify/functions/user-data-*.mjs.
// Writes are rejected server-side for callers without an active entitlement;
// this module doesn't duplicate that check, it just surfaces whatever the
// server decides.
//
// Every request also carries the auth JWT (when signed in) so the server can
// honor admin-granted Premium users, who may have no wallet at all - the
// server resolves identity from wallet OR account (see _premiumAccess.mjs).
const FALLBACK_KEY = 'khan-trust-userdata-fallback-v1';
const AUTH_TOKEN_KEY = 'khan-trust-auth-token-v1';

function isFunctionUnavailable(error) {
  return Boolean(error) && (error.status === undefined || error.status === 404);
}

function authHeaders() {
  try {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function callFunction(path, options = {}) {
  const response = await fetch(`/.netlify/functions/${path}`, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.message || `Request to ${path} failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function readFallbackStore() {
  try {
    const raw = localStorage.getItem(FALLBACK_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeFallbackStore(store) {
  try {
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(store));
  } catch {
    // ignore - dev fallback only
  }
}

export async function fetchUserData(wallet) {
  // A caller with neither a wallet nor a signed-in account has nothing to fetch.
  const hasToken = Boolean(authHeaders().Authorization);
  if (!wallet && !hasToken) return { savedReports: [], watchlist: [] };
  try {
    return await callFunction(`user-data-get?wallet=${encodeURIComponent(wallet || '')}`, { method: 'GET' });
  } catch (error) {
    if (!isFunctionUnavailable(error)) throw error;
    const store = readFallbackStore();
    return store[wallet || 'self'] || { savedReports: [], watchlist: [] };
  }
}

async function performAction(wallet, body) {
  try {
    return await callFunction('user-data-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet, ...body }),
    });
  } catch (error) {
    // Dev-only fallback (no Netlify Functions server, e.g. plain `vite dev`).
    // Mirrors the entitlement-aware write the real function performs so the
    // flow is testable end-to-end locally - intentionally not gated by
    // entitlement here since there's no local entitlement store to check.
    if (!isFunctionUnavailable(error)) throw error;
    const key = wallet || 'self';
    const store = readFallbackStore();
    const data = store[key] || { savedReports: [], watchlist: [] };
    if (body.action === 'save_report') {
      const report = body.report || {};
      const entry = { id: `sr-${Date.now()}`, savedAt: new Date().toISOString(), ...report };
      data.savedReports = [entry, ...data.savedReports.filter((item) => item.projectId !== report.projectId)];
    } else if (body.action === 'remove_report') {
      data.savedReports = data.savedReports.filter((item) => item.id !== body.reportId);
    } else if (body.action === 'toggle_watch') {
      data.watchlist = data.watchlist.includes(body.projectId)
        ? data.watchlist.filter((id) => id !== body.projectId)
        : [...data.watchlist, body.projectId];
    }
    store[key] = data;
    writeFallbackStore(store);
    return { ok: true, data, fallback: true };
  }
}

export const saveReport = (wallet, report) => performAction(wallet, { action: 'save_report', report });
export const removeSavedReport = (wallet, reportId) => performAction(wallet, { action: 'remove_report', reportId });
export const toggleServerWatch = (wallet, projectId) => performAction(wallet, { action: 'toggle_watch', projectId });
