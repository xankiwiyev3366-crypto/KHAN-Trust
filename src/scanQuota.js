// Client for the Free Scanner Strategy (Step 4). One call, scan-quota, backs
// both the "2 of 3 free scans remaining" counter and the hard block after the
// third scan.
//
// TWO MODES
//
//   peek()    — read today's remaining count without spending one. Safe to call
//               on load / when premium status settles, to paint the counter.
//   consume() — reserve one scan. Called the instant the user triggers a real
//               scan, BEFORE the lookup runs, so the limit cannot be raced by
//               firing scans faster than the UI updates.
//
// WHY THE SERVER IS THE ONLY JUDGE HERE
//
// The count that matters is the server's (see _scanQuotaStore.mjs) — a
// localStorage counter would reset on a cleared cookie. So this module holds no
// count of its own; it forwards identity and reports back whatever the server
// says. Premium users never call it: App short-circuits on its merged
// entitlement view, so a paying user is never gated by a network round-trip.
//
// FAIL OPEN
//
// Every failure resolves to `null`, and the caller treats null as "allow". A
// quota endpoint that is down must never block someone from scanning a token —
// the whole product is that scan. This mirrors the fire-and-forget contract in
// platformAnalytics.js and retention.js.
import { getCachedWalletToken } from './walletSession.js';
import { FREE_DAILY_SCAN_LIMIT as REGISTRY_LIMIT } from './lib/features.js';

const AUTH_TOKEN_KEY = 'khan-trust-auth-token-v1';

// The free ceiling, re-exported from the shared registry purely so the UI has a
// sensible default before the first response lands. The server is still
// authoritative and echoes the real `limit` on every reply — this is only what
// the meter shows for the few hundred milliseconds before that arrives.
export const FREE_DAILY_SCAN_LIMIT = REGISTRY_LIMIT;

// Auth token proves the account; the cached wallet token (never a fresh signing
// prompt) lets a legacy paid-wallet user be recognised as premium on a passive
// check. If neither is present the caller is treated as an anonymous free user
// and counted by IP server-side.
function headers(wallet) {
  const out = { 'Content-Type': 'application/json' };
  try {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (token) out.Authorization = `Bearer ${token}`;
  } catch {
    // no auth header — anonymous
  }
  const walletToken = wallet ? getCachedWalletToken(wallet) : null;
  if (walletToken) out['x-khan-wallet-auth'] = walletToken;
  return out;
}

async function post(consume, wallet) {
  try {
    const response = await fetch('/.netlify/functions/scan-quota', {
      method: 'POST',
      headers: headers(wallet),
      body: JSON.stringify({ consume }),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

// Read today's quota without spending a scan. Returns the server view, or null
// on any failure (caller shows no counter rather than a wrong one).
export function peekScanQuota({ wallet = '' } = {}) {
  return post(false, wallet);
}

// Reserve one scan. Returns the server view (`allowed` carries the decision), or
// null on failure — which the caller treats as allowed, so an outage never
// blocks a scan.
export function consumeScanQuota({ wallet = '' } = {}) {
  return post(true, wallet);
}

// Whole hours until the daily reset, from the server's resetsAt. Used for the
// "resets in Xh" line on the block screen. Never negative; rounds up so "0h" is
// never shown for a reset that is still minutes away.
export function hoursUntilReset(resetsAt) {
  if (!resetsAt) return null;
  const ms = new Date(resetsAt).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.max(1, Math.ceil(ms / (60 * 60 * 1000)));
}
