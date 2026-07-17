// Client for the retention loop: the streak/activity/continue-context view and
// the notification bell, both fed by ONE endpoint (retention-sync).
//
// NOT EVERY PAGE VIEW IS A REQUEST
//
// The obvious wiring - sync on every navigation - would issue a request per
// click for every signed-in user forever, to re-learn a fact that changes once a
// day. So this de-dupes on the CLIENT as well as the server:
//
//   - the daily visit is sent once per UTC day (localStorage remembers the last
//     day sent), matching the server's own day granularity;
//   - a context update is sent only when the user actually moves to a different
//     project, not when they revisit the one they were already on.
//
// The server independently skips the write when nothing changed (recordVisit ->
// `changed: false`), so this is belt-and-braces: the client avoids the request,
// the server avoids the write. Neither is trusted to be the only guard.
//
// FAILURE IS SILENT
//
// Retention is memory, not a feature anything depends on. Every call here is
// best-effort and resolves to null on failure - a retention outage must never
// surface an error to someone trying to scan a token. This mirrors the
// fire-and-forget contract in platformAnalytics.js.
const AUTH_TOKEN_KEY = 'khan-trust-auth-token-v1';
const LAST_VISIT_DAY_KEY = 'khan-trust-retention-last-visit-v1';

function authHeaders() {
  try {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

// Has the daily visit already been recorded in this browser today? Keyed per
// user id so switching accounts on one machine does not make the second user's
// first visit invisible.
function visitAlreadySentToday(userId) {
  try {
    return localStorage.getItem(LAST_VISIT_DAY_KEY) === `${userId}:${todayKey()}`;
  } catch {
    return false;
  }
}

function markVisitSent(userId) {
  try {
    localStorage.setItem(LAST_VISIT_DAY_KEY, `${userId}:${todayKey()}`);
  } catch {
    // Private mode / quota: fall back to syncing more often than necessary,
    // which is wasteful but correct. Never let this throw into a render.
  }
}

async function post(path, body) {
  const headers = authHeaders();
  if (!headers.Authorization) return null; // signed out - nothing to sync
  try {
    const response = await fetch(`/.netlify/functions/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body || {}),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

// Records the visit (and optionally the resume context) and returns the whole
// retention view. `force` bypasses the once-a-day client guard - used after an
// action that should refresh the bell immediately, e.g. marking notifications
// read elsewhere, or a context change.
export async function syncRetention({ userId, context = null, force = false } = {}) {
  if (!userId) return null;
  if (!force && !context && visitAlreadySentToday(userId)) return null;
  const result = await post('retention-sync', { context });
  if (result?.ok) markVisitSent(userId);
  return result;
}

export async function markNotificationsRead(ids) {
  // Omitting `ids` means mark-all; an explicit array marks only those. See
  // notifications-read.mjs for why an empty array is deliberately not mark-all.
  return post('notifications-read', ids ? { ids } : {});
}

// Builds the resume context from a project the user is looking at. Returns null
// for anything unroutable, so a half-formed project never becomes a resume card
// that leads nowhere.
export function contextFromProject(project, type = 'project') {
  if (!project?.id) return null;
  return {
    type,
    projectId: project.id,
    name: project.name || '',
    ticker: project.ticker || '',
    contract: project.contract || '',
    chain: project.chain || '',
  };
}
