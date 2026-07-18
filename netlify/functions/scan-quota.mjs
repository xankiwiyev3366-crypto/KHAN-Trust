// POST /.netlify/functions/scan-quota
//
// The server-authoritative gate for the Free Scanner Strategy (Step 4). The
// client calls this once per scan the user triggers; the server decides whether
// a free user still has scans left today and, when asked to, records the scan.
//
//   { consume: false }  → peek: how many free scans are left today, writes nothing
//   { consume: true }   → reserve one scan: allowed + the new remaining count,
//                         or allowed:false when today's limit is spent
//
// IDENTITY, AND WHY IT CANNOT BE FORGED
//
// Premium is resolved through resolveVerifiedPremiumAccess — the SAME
// ownership-proven resolver the premium user-data endpoints use (JWT for
// account/manual premium, a signed wallet-session token for a paid wallet). A
// free user cannot unlock unlimited scans by pasting someone else's wallet
// address, because a raw address proves nothing here.
//
// For the free tier, the counted identity is:
//   1. the JWT-verified account id  (u:<sub>) when signed in — survives logout,
//      incognito, and clearing storage, because it is the account, not a cookie;
//   2. otherwise the request IP     (ip:<addr>) for anonymous callers — the only
//      stable handle we have, and the reason clearing localStorage does not mint
//      a fresh three scans. A shared NAT sharing one bucket is the accepted cost;
//      the whole point is to push anonymous users to sign up or upgrade anyway.
//
// FAIL OPEN: a limiter or blob outage returns "allowed". The core action of a
// trust product must not go dark because a counter is unreachable.
import { verifyJwt, bearerToken } from './_authStore.mjs';
import { resolveVerifiedPremiumAccess } from './_premiumAccess.mjs';
import { enforce, getClientIp } from './_rateLimit.mjs';
import { jsonResponse } from './_blobsClient.mjs';
import { peekQuota, consumeQuota, FREE_DAILY_SCAN_LIMIT, nextResetIso } from './_scanQuotaStore.mjs';

// A premium caller has no limit, so there is nothing to count and nothing to
// store. Shaped like the free view (same keys) so the client reads one contract.
function premiumView(now) {
  return {
    ok: true,
    premium: true,
    unlimited: true,
    allowed: true,
    limitReached: false,
    limit: null,
    used: 0,
    remaining: null,
    resetsAt: nextResetIso(now),
  };
}

export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return jsonResponse(405, { message: 'Method not allowed' });

    const now = Date.now();

    // 1. Premium → unlimited, verified the ownership-proven way. Checked first so
    //    a paying user is never counted, never blocked, and never even touches
    //    the quota store.
    const access = await resolveVerifiedPremiumAccess(event);
    if (access.entitled) {
      return jsonResponse(200, premiumView(now));
    }

    // 2. Free tier. Prefer the JWT account id (unforgeable, survives storage
    //    clears); fall back to the client IP for anonymous callers.
    const payload = verifyJwt(bearerToken(event));
    const ip = getClientIp(event);
    const identityKey = payload?.sub ? `u:${payload.sub}` : `ip:${ip}`;

    // Defence-in-depth only — the real limit is per-identity below. This just
    // stops a runaway client hammering the endpoint. Fails open.
    const guard = await enforce('scan_quota_ip', ip);
    if (!guard.allowed) {
      return jsonResponse(429, { message: 'Too many requests', retryAfterMs: guard.retryAfterMs });
    }

    let body = {};
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { message: 'Invalid JSON' });
    }

    const consume = body.consume === true;
    const result = consume
      ? await consumeQuota(identityKey, { now })
      : await peekQuota(identityKey, { now });

    // 200 even when the scan is blocked: this is a normal, expected answer the
    // client renders as an upgrade prompt, not an error. `allowed` carries the
    // decision. limit === FREE_DAILY_SCAN_LIMIT is echoed so the UI never has to
    // hardcode "3".
    return jsonResponse(200, {
      ok: true,
      premium: false,
      unlimited: false,
      ...result,
      limit: result.limit ?? FREE_DAILY_SCAN_LIMIT,
    });
  } catch (error) {
    return jsonResponse(500, { message: `scan-quota crashed: ${error.message}` });
  }
}
