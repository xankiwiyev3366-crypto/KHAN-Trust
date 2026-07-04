// GET /.netlify/functions/entitlement-status?wallet=<address>
// Returns whatever paid plan (if any) is on record for a wallet address, so
// the frontend can show "Premium active" instead of an unlock button without
// trusting anything stored client-side.
import { getEntitlement, isPremiumPlan, jsonResponse } from './_entitlementsStore.mjs';

// This endpoint is unauthenticated and wallet addresses are public/enumerable,
// so it must return ONLY the non-sensitive fields the UI actually consumes
// (see src/entitlements.js describeEntitlement + src/main.jsx mergeEntitlements:
// plan, source, reason, expiresAt). It must NEVER expose payment identifiers -
// transactionHash, amountPaid, currency, or Stripe customer/subscription ids.
function toPublicEntitlement(entitlement) {
  if (!entitlement || typeof entitlement !== 'object') return null;
  return {
    plan: entitlement.plan || null,
    active: isPremiumPlan(entitlement.plan),
    source: entitlement.source || null,
    reason: entitlement.reason || null,
    expiresAt: entitlement.expiresAt || null,
  };
}

export async function handler(event) {
  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { message: 'Method not allowed' });
  }

  const wallet = (event.queryStringParameters?.wallet || '').trim();
  if (!wallet) {
    return jsonResponse(400, { message: 'wallet query parameter is required' });
  }

  const entitlement = await getEntitlement(wallet);
  return jsonResponse(200, { wallet, entitlement: toPublicEntitlement(entitlement) });
}
