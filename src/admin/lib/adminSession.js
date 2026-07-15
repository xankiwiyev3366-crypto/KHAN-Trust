// Admin session handling for the private console.
//
// Self-contained on purpose: the console is a separate application (see
// admin.html / vite.config.js), and nothing here may be reachable from
// src/main.jsx or it would be hoisted into the bundle every visitor downloads.
//
// The sessionStorage key is deliberately IDENTICAL to the one the legacy
// in-app admin pages use (src/verification.js), so an operator already signed
// in keeps their session while the legacy pages are migrated across.
//
// Auth model (unchanged from the existing platform): one shared passcode is
// POSTed to verification-admin-auth, which returns an HMAC-signed token with a
// 12h TTL. The passcode itself is never stored - only the returned token, and
// only in sessionStorage, so it dies with the tab.
const ADMIN_TOKEN_KEY = 'khan-trust-admin-token';

export function getAdminToken() {
  try {
    return sessionStorage.getItem(ADMIN_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function setAdminToken(token) {
  try {
    sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
  } catch {
    // Private-mode Safari can throw on write; the session simply won't persist.
  }
}

export function clearAdminToken() {
  try {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {
    // Nothing to do - a failed clear still leaves the in-memory state signed out.
  }
}

export async function adminLogin(passcode) {
  const response = await fetch('/.netlify/functions/verification-admin-auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || 'Incorrect passcode.');
  }
  const data = await response.json();
  setAdminToken(data.token);
  return data.token;
}

// Every console data call goes through here so that a 401 (expired 12h token)
// has exactly ONE handler: clear the dead token and surface a typed error the
// shell turns back into the passcode screen. Without this, each page would
// invent its own expiry handling and an expired session would surface as a
// generic "load failed" with no way back.
export async function adminFetch(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`/.netlify/functions/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (response.status === 401) {
    clearAdminToken();
    const error = new Error('Session expired. Sign in again.');
    error.code = 'UNAUTHORIZED';
    throw error;
  }

  // A 200 is NOT a promise of JSON.
  //
  // When the function is missing, a proxy misroutes, or a CDN serves an error
  // page, the response is frequently `200 text/html` containing an SPA
  // fallback. Swallowing that into `{}` (the obvious `.catch(() => ({}))`) is
  // silently catastrophic: the caller sees a successful, empty payload and
  // every page then dereferences `data.funnel.stages` on undefined and dies
  // with a blank screen and no explanation. Parse failure is an error and has
  // to be reported as one.
  const raw = await response.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(
      `${path} returned ${response.status} but the body was not JSON (${response.headers.get('content-type') || 'unknown type'}). ` +
      'The function is probably not running — Netlify Functions do not serve under plain `vite dev`; use `netlify dev`.'
    );
  }

  if (!response.ok) {
    throw new Error(data.message || `${path} failed (${response.status})`);
  }
  return data;
}
