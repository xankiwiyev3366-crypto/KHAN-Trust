// Shared, sliding-window rate limiter (P0-2). Generalizes the per-IP throttle
// already used by _reportStore/_supportStore so the auth endpoints (login,
// register, forgot/reset password) can be protected against brute-force and
// credential-stuffing without each re-implementing the same map logic.
//
// Netlify Functions are stateless between invocations, so an in-memory counter
// would not survive - state lives in a single Netlify Blobs JSON map per named
// bucket: { "<identifier>": [ts, ts, ...] }. Each bucket is its own blob key so
// unrelated limiters never contend on the same object.
//
// The store is injectable (getStoreFn) purely so the logic can be unit-tested
// with an in-memory stand-in; in production it always uses Netlify Blobs.
import { getNamedStore } from './_blobsClient.mjs';

const STORE_NAME = 'khan-trust-rate-limits';

function defaultStore() {
  return getNamedStore(STORE_NAME);
}

// Extract the caller's real client IP from Netlify's headers. Falls back to a
// constant so a missing header degrades to "shared bucket" rather than
// bypassing the limit entirely.
export function getClientIp(event) {
  const headers = event?.headers || {};
  return (
    headers['x-nf-client-connection-ip'] ||
    headers['X-Nf-Client-Connection-Ip'] ||
    headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    headers['X-Forwarded-For']?.split(',')[0]?.trim() ||
    'unknown'
  );
}

// Sliding-window check-and-record. Returns { allowed, remaining, retryAfterMs }.
// Records the attempt (when allowed) so repeated calls converge on the limit.
// A storage failure fails OPEN (allowed: true) - a limiter outage must never
// lock every user out of login; the fixed secrets/auth checks still apply.
export async function checkRateLimit({
  bucket,
  identifier,
  max,
  windowMs,
  getStoreFn = defaultStore,
}) {
  if (!identifier) return { allowed: true, remaining: max, retryAfterMs: 0 };
  const key = `${bucket}.json`;
  try {
    const store = getStoreFn();
    const data = await store.get(key, { type: 'json' });
    const map = data && typeof data === 'object' ? data : {};
    const now = Date.now();
    const recent = (map[identifier] || []).filter((ts) => now - ts < windowMs);

    if (recent.length >= max) {
      map[identifier] = recent;
      // Best-effort prune of other cold identifiers to keep the blob small.
      pruneExpired(map, now, windowMs);
      await store.setJSON(key, map);
      const oldest = recent[0];
      return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, windowMs - (now - oldest)) };
    }

    recent.push(now);
    map[identifier] = recent;
    pruneExpired(map, now, windowMs);
    await store.setJSON(key, map);
    return { allowed: true, remaining: max - recent.length, retryAfterMs: 0 };
  } catch {
    // Fail open on storage errors - see note above.
    return { allowed: true, remaining: max, retryAfterMs: 0 };
  }
}

function pruneExpired(map, now, windowMs) {
  for (const id of Object.keys(map)) {
    const kept = (map[id] || []).filter((ts) => now - ts < windowMs);
    if (kept.length) map[id] = kept;
    else delete map[id];
  }
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// Named policies so limits live in one place and stay consistent.
export const RATE_POLICIES = {
  login_ip: { max: 20, windowMs: 15 * MINUTE },
  login_email: { max: 8, windowMs: 15 * MINUTE },
  register_ip: { max: 5, windowMs: HOUR },
  forgot_ip: { max: 5, windowMs: HOUR },
  forgot_email: { max: 3, windowMs: HOUR },
  reset_ip: { max: 15, windowMs: 15 * MINUTE },
  // Retention sync is not security-sensitive (it reads and writes only the
  // caller's own JWT-identified record), so this is a runaway-client guard, not
  // a brute-force one. The ceiling sits far above any legitimate session - the
  // client sends at most one per day plus one per context change - and is
  // per-IP rather than per-user so a shared office NAT is not the unit being
  // limited. Fails open like every other policy here.
  retention_sync_ip: { max: 120, windowMs: 5 * MINUTE },
  // Free scan quota (Step 4) is enforced per-identity by _scanQuotaStore, not
  // here. This is only a defence-in-depth runaway guard on the quota endpoint
  // itself, per-IP, well above any legitimate use: a free user makes at most a
  // handful of scan checks a day, so a client hammering it is buggy or hostile.
  // Fails open like every policy here — a limiter outage must not block scans.
  scan_quota_ip: { max: 300, windowMs: 5 * MINUTE },
  // Referral click tracking is a public, unauthenticated top-of-funnel counter.
  // This caps how fast one IP can inflate a promoter's click count (click
  // fraud / write amplification) while staying far above a real human opening a
  // link a few times. Fails open — a broken counter must never block the
  // sign-up page the link points at.
  referral_click_ip: { max: 30, windowMs: 5 * MINUTE },
};

// Convenience wrapper: enforce one named policy for one identifier.
export async function enforce(policyName, identifier, opts = {}) {
  const policy = RATE_POLICIES[policyName];
  if (!policy) return { allowed: true, remaining: Infinity, retryAfterMs: 0 };
  return checkRateLimit({
    bucket: policyName,
    identifier,
    max: policy.max,
    windowMs: policy.windowMs,
    ...opts,
  });
}
