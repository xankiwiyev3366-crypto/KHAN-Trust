// GET  /.netlify/functions/referral-me   → this account's referral dashboard
// POST /.netlify/functions/referral-me   { action: 'regenerate' } → new code
//
// User-facing. Identity comes ONLY from the caller's own auth JWT (never the
// body), so a user can only ever read/mutate their OWN referral record. A code
// is created on first read, so every registered user has an invite link the
// moment they open this page.
import { verifyJwt, bearerToken } from './_authStore.mjs';
import { getPromoterView, regenerateCode, buildReferralLink, jsonResponse } from './_referralStore.mjs';

// Prefer the origin the request actually arrived on, so the link a user copies
// matches the domain they are browsing (custom domain, deploy preview, or
// localhost) rather than a hardcoded production host.
function originFrom(event) {
  const origin = event.headers?.origin || event.headers?.Origin;
  if (origin) return origin;
  const host = event.headers?.host || event.headers?.Host;
  if (host) {
    const proto = event.headers?.['x-forwarded-proto'] || 'https';
    return `${proto}://${host}`;
  }
  return null;
}

export async function handler(event) {
  const auth = verifyJwt(bearerToken(event));
  if (!auth?.sub) return jsonResponse(401, { message: 'Unauthorized' });
  const userId = auth.sub;
  const siteOrigin = originFrom(event);

  try {
    if (event.httpMethod === 'GET') {
      const view = await getPromoterView(userId, { siteOrigin });
      return jsonResponse(200, view);
    }

    if (event.httpMethod === 'POST') {
      let body = {};
      try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { message: 'Invalid JSON' }); }
      if (body.action !== 'regenerate') return jsonResponse(400, { message: 'Unknown action' });
      const owner = await regenerateCode(userId);
      if (!owner) return jsonResponse(500, { message: 'Could not regenerate code' });
      return jsonResponse(200, {
        code: owner.code,
        link: buildReferralLink(owner.code, siteOrigin),
      });
    }

    return jsonResponse(405, { message: 'Method not allowed' });
  } catch (error) {
    return jsonResponse(500, { message: `referral-me crashed: ${error.message}` });
  }
}
