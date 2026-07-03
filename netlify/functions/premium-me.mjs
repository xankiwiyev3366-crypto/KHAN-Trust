// GET /.netlify/functions/premium-me
// Returns the MANUAL Premium entitlement for the currently authenticated user
// (identified by their normal auth JWT, not the admin token). The frontend
// merges this with the wallet-based paid entitlement so an admin-granted plan
// unlocks Premium features immediately, with no logout or wallet required.
//
// Read-only and account-scoped: it can only ever report the caller's own grant.
import { verifyJwt, bearerToken, jsonResponse } from './_authStore.mjs';
import { getGrant, isGrantActive } from './_premiumStore.mjs';

export async function handler(event) {
  if (event.httpMethod !== 'GET') return jsonResponse(405, { message: 'Method not allowed' });

  const payload = verifyJwt(bearerToken(event));
  if (!payload) return jsonResponse(401, { message: 'Invalid or expired token' });

  const grant = await getGrant(payload.sub);
  if (!isGrantActive(grant)) {
    return jsonResponse(200, { entitlement: null });
  }

  // Only expose what the client needs to gate UI and render Premium profile
  // indicators / badges - not the full audit trail.
  return jsonResponse(200, {
    entitlement: {
      plan: grant.plan,
      source: grant.source || 'manual',
      reason: grant.reason || null,
      expiresAt: grant.expiresAt ?? null,
    },
  });
}
