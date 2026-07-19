// Referral & Invite System — client half.
//
// Two jobs:
//   1. CAPTURE  — when a visitor lands on /signup?ref=<CODE> (or any URL with a
//      ?ref=), remember the code as a write-once first touch so the eventual
//      sign-up can be credited to the inviter, and fire a lightweight click
//      ping so the promoter's top-of-funnel counter moves.
//   2. READ     — the account's own referral dashboard, and (admin) the whole
//      referral analytics surface.
//
// The captured code rides along on registration through AuthContext, exactly
// like the growth first-touch attribution already does. Nothing here can block
// or fail sign-up: every capture path is defensive and best-effort.

const REF_KEY = 'khan-trust-referral-code-v1';
const AUTH_TOKEN_KEY = 'khan-trust-auth-token-v1';
// One click per code per browser session — a reload or a bounce back to the
// link must not keep inflating the counter, but a genuinely new visit (new tab
// session) counts.
const CLICK_MARK_KEY = 'khan-trust-referral-clicked-v1';

// Codes are uppercase, unambiguous alphanumerics (see _referralStore.mjs). Be
// liberal in what we read from the URL, strict in what we store.
function normalizeCode(raw) {
  return String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 32);
}

function readRefFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    return normalizeCode(params.get('ref'));
  } catch {
    return '';
  }
}

// Write-once: the FIRST referral link a visitor uses wins, mirroring first-touch
// attribution. Someone who arrives via a promoter's link, leaves, and comes
// back later through a different one is still credited to the original.
function storeCode(code) {
  if (!code) return;
  try {
    if (!localStorage.getItem(REF_KEY)) localStorage.setItem(REF_KEY, code);
  } catch {
    // Private mode / full quota — attribution degrades, sign-up still works.
  }
}

export function getStoredReferralCode() {
  try {
    return localStorage.getItem(REF_KEY) || null;
  } catch {
    return null;
  }
}

export function clearStoredReferralCode() {
  try {
    localStorage.removeItem(REF_KEY);
  } catch {
    // ignore
  }
}

// Fire-and-forget click ping, deduped per session per code.
function trackClickOnce(code) {
  if (!code) return;
  let alreadyClicked = null;
  try {
    alreadyClicked = sessionStorage.getItem(CLICK_MARK_KEY);
  } catch {
    alreadyClicked = null;
  }
  if (alreadyClicked === code) return;
  try {
    sessionStorage.setItem(CLICK_MARK_KEY, code);
  } catch {
    // ignore — worst case we count one extra click, never fewer
  }
  try {
    fetch('/.netlify/functions/referral-track-click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
      keepalive: true, // survive the navigation into the app
    }).catch(() => {});
  } catch {
    // network/CSP — ignore
  }
}

// Called once on app boot (alongside initGrowth). Captures the code and counts
// the click. Returns the captured code (or null) for callers that want it.
export function initReferral() {
  const code = readRefFromUrl();
  if (!code) return getStoredReferralCode();
  storeCode(code);
  trackClickOnce(code);
  return code;
}

// ── Authenticated: the user's own referral dashboard ──────────────────────────

function authToken() {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY) || null;
  } catch {
    return null;
  }
}

async function apiFetch(path, options = {}) {
  const res = await fetch(`/.netlify/functions/${path}`, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || 'Request failed'), { status: res.status });
  return data;
}

export async function fetchMyReferral() {
  const token = authToken();
  if (!token) throw new Error('Not authenticated');
  return apiFetch('referral-me', { headers: { Authorization: `Bearer ${token}` } });
}

export async function regenerateMyReferralCode() {
  const token = authToken();
  if (!token) throw new Error('Not authenticated');
  return apiFetch('referral-me', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: 'regenerate' }),
  });
}

// ── Admin: referral analytics ─────────────────────────────────────────────────

async function callAdmin(path, token) {
  const res = await fetch(`/.netlify/functions/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || `Request to ${path} failed (${res.status})`), { status: res.status });
  return data;
}

export async function fetchReferralAnalytics(token) {
  return callAdmin('referral-admin-list', token);
}

export async function fetchReferralDetail(token, userId) {
  return callAdmin(`referral-admin-detail?userId=${encodeURIComponent(userId)}`, token);
}
