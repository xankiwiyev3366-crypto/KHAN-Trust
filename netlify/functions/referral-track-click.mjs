// POST /.netlify/functions/referral-track-click   { code }
//
// Public, unauthenticated. Records ONE click on a referral link's top-of-funnel
// counter. This is a marketing metric, never an entitlement, so it is
// deliberately lightweight: rate-limited per IP to bound click fraud and write
// amplification, and always returns 200 (even for an unknown code) so it can
// never leak which codes exist or interfere with the sign-up page the link
// points at. Fails open on any error.
import { recordClick, jsonResponse } from './_referralStore.mjs';
import { enforce, getClientIp } from './_rateLimit.mjs';

export async function handler(event) {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { message: 'Method not allowed' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }
  const code = body.code;
  if (!code) return jsonResponse(200, { ok: true, recorded: false });

  // Per-IP throttle. Fails open (allowed) on limiter outage.
  const limit = await enforce('referral_click_ip', getClientIp(event));
  if (!limit.allowed) return jsonResponse(200, { ok: true, recorded: false, throttled: true });

  try {
    const recorded = await recordClick(code);
    return jsonResponse(200, { ok: true, recorded });
  } catch {
    return jsonResponse(200, { ok: true, recorded: false });
  }
}
