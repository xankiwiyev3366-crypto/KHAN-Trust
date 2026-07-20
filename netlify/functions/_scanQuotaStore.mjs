// Free Scanner Strategy — server-authoritative daily scan quota (Step 4).
//
// WHY THIS LIVES ON THE SERVER
//
// A token scan runs almost entirely in the browser (DexScreener/GoPlus/Solana
// RPC are called client-side), so the ONLY count a free user cannot tamper with
// is one the server keeps. A localStorage counter resets the moment someone
// clears storage or opens an incognito window — i.e. it is not a limit, it is a
// suggestion. This module is the real limit: the count lives in Netlify Blobs,
// keyed by an identity the caller cannot forge (a JWT-verified account id, or
// the request IP for anonymous callers). Clearing cookies does not reset it.
//
// WHAT IT DELIBERATELY IS NOT
//
// It is not a security boundary against a determined scripter — nothing here can
// stop someone calling DexScreener directly, because the scan is not a server
// resource to withhold. It is a conversion gate for the ordinary free user: use
// three real reports a day through the product, then be shown Premium. That is
// the whole job, and keying the count server-side is what makes it hold.
//
// DAILY RESET WITHOUT A CRON
//
// The count is stored alongside the UTC day it belongs to. Reading on a new day
// finds a stale day stamp and treats the count as zero — so the quota resets at
// 00:00 UTC automatically, with no scheduled job to run, fail, or drift. UTC is
// the platform's day boundary everywhere else (retention streaks, growth
// warehouse), so a scan day and a streak day are the same day.
//
// FAIL OPEN
//
// A blob outage returns "allowed" rather than locking every free user out of the
// product's core action. This mirrors _rateLimit.mjs: availability wins for
// everything here except money (the growth AI budget is the one fail-closed
// store). A free scanner is not money.
import { getNamedStore } from './_blobsClient.mjs';
import { FREE_DAILY_SCAN_LIMIT as REGISTRY_LIMIT } from '../../src/lib/features.js';

const STORE_NAME = 'khan-trust-scan-quota';

// The free tier's daily ceiling. Re-exported from the shared feature registry
// (src/lib/features.js) rather than declared here, so the number the server
// enforces and the number the pricing page advertises are the same literal.
// They used to be two constants in two files, which is a silent-drift bug
// waiting to happen: the marketing copy says 5, the gate still allows 3, and
// nothing fails — users just hit a wall the page told them wasn't there.
export const FREE_DAILY_SCAN_LIMIT = REGISTRY_LIMIT;

const DAY_MS = 24 * 60 * 60 * 1000;

function defaultStore() {
  return getNamedStore(STORE_NAME);
}

// The UTC calendar day a moment belongs to (YYYY-MM-DD). Matches dayKey() in
// _retentionEngine.mjs so "today" means the same day across the platform.
export function dayKey(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

// The instant the current day's quota resets — the next UTC midnight. Returned
// to the client so it can render "resets in 4h" without guessing the boundary.
export function nextResetIso(now = Date.now()) {
  const next = new Date(Math.floor(now / DAY_MS) * DAY_MS + DAY_MS);
  return next.toISOString();
}

// Blob keys are derived from caller-influenced identity strings (an IP, an
// account id). Keep them to a safe, collision-free character set; different
// inputs still map to different keys because the substituted characters
// (":" in "u:<id>", dots in an IP) are replaced 1:1, not stripped.
function blobKey(identityKey) {
  return `q_${String(identityKey).replace(/[^A-Za-z0-9_.-]/g, '_')}`;
}

// A view shaped identically by peek and consume so the client has one contract.
function view({ used, limit, allowed, now }) {
  const remaining = Math.max(0, limit - used);
  return {
    limit,
    used,
    remaining,
    allowed,
    limitReached: remaining <= 0,
    day: dayKey(now),
    resetsAt: nextResetIso(now),
  };
}

// Opens the blob store, or null if that fails (e.g. Blobs unconfigured in a
// local dev environment). Never throws — a null store makes every caller fail
// open rather than 500, so a scan is never blocked by the counter being down.
function openStore(getStoreFn) {
  try {
    return getStoreFn();
  } catch {
    return null;
  }
}

// Reads today's count for an identity, treating a stale day stamp as zero. Never
// throws: a read failure surfaces as `count: 0` so the caller fails open.
async function readToday(store, identityKey, now) {
  try {
    const record = await store.get(blobKey(identityKey), { type: 'json' });
    if (record && record.day === dayKey(now)) {
      return Number(record.count) || 0;
    }
    // No record, or a record from an earlier day → this day starts at zero.
    return 0;
  } catch {
    return 0;
  }
}

// Read-only: how many scans this identity has used today and how many remain.
// Writes nothing, so the dashboard/search UI can poll it on load without
// spending a scan. `allowed` reflects whether a scan WOULD be permitted now.
export async function peekQuota(identityKey, { now = Date.now(), limit = FREE_DAILY_SCAN_LIMIT, getStoreFn = defaultStore } = {}) {
  const store = openStore(getStoreFn);
  if (!store) return view({ used: 0, limit, allowed: true, now }); // fail open
  const used = await readToday(store, identityKey, now);
  return view({ used, limit, allowed: used < limit, now });
}

// Check-and-consume: records one scan for this identity today and returns the
// resulting view. When the day's limit is already reached it records NOTHING and
// returns `allowed: false` — the block is the point, and re-writing the same
// number on every blocked attempt would only churn the blob.
//
// Read-modify-write on Netlify Blobs is not transactional, so two scans fired in
// the same instant can both read N and both write N+1, letting one extra scan
// through under a genuine race. That is an acceptable ceiling for a free-tier
// funnel (the same tradeoff _rateLimit.mjs makes) and never UNDER-counts a
// steady stream of scans, which is what the limit is actually defending against.
export async function consumeQuota(identityKey, { now = Date.now(), limit = FREE_DAILY_SCAN_LIMIT, getStoreFn = defaultStore } = {}) {
  const store = openStore(getStoreFn);
  // No store (Blobs unconfigured) → fail open: allow the scan, report it as the
  // first of the day without persisting (nothing to write to).
  if (!store) return view({ used: 1, limit, allowed: true, now });
  const used = await readToday(store, identityKey, now);

  if (used >= limit) {
    return view({ used, limit, allowed: false, now });
  }

  const next = used + 1;
  try {
    await store.setJSON(blobKey(identityKey), { day: dayKey(now), count: next });
  } catch {
    // Write failed → still allow this scan (fail open). The count simply is not
    // persisted; the next call re-reads whatever did land.
    return view({ used: next, limit, allowed: true, now });
  }
  return view({ used: next, limit, allowed: true, now });
}
