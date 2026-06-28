// KHAN Holder Analytics - client fetch helpers for the admin panel. Mirrors
// the platformAnalytics.js pattern: every call hits a Netlify Function backed
// by real on-chain data (see netlify/functions/_khanIndexer.mjs), gated by
// the same shared admin token used across every admin page.

async function authedGet(path, token, params = {}) {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  ).toString();
  const response = await fetch(`/.netlify/functions/${path}${query ? `?${query}` : ''}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.message || `Request to ${path} failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export async function fetchHolders(token, { search, range, sort, page, pageSize } = {}) {
  return authedGet('khan-holders-admin-list', token, { search, range, sort, page, pageSize });
}

export async function fetchTransactions(token, { search, range, direction, page, pageSize } = {}) {
  return authedGet('khan-holders-admin-transactions', token, { search, range, direction, page, pageSize });
}

export async function fetchHolderStats(token) {
  return authedGet('khan-holders-admin-stats', token);
}

export async function fetchAlerts(token, limit) {
  return authedGet('khan-holders-admin-alerts', token, { limit });
}

export async function triggerManualSync(token) {
  const response = await fetch('/.netlify/functions/khan-holders-admin-sync', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.message || `Request to khan-holders-admin-sync failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}
