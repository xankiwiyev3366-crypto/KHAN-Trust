// GET /.netlify/functions/entitlement-status
//
// Returns whatever paid plan (if any) is on record, so the frontend can show
// "Premium active" instead of an unlock button without trusting anything stored
// client-side. Two ways to ask:
//
//   Authorization: Bearer <jwt>   -> the CALLER'S OWN account entitlement.
//                                    The primary path since accounts became the
//                                    identity for new purchases.
//   ?wallet=<address>             -> LEGACY. A wallet's paid plan.
//
// The account path is deliberately identified by the JWT and never by a
// ?userId= parameter. Wallet addresses are public and enumerable, so exposing
// them by address leaks only what a block explorer already shows; account ids
// are not public, and an unauthenticated ?userId= lookup would turn this into
// an enumeration oracle for who has paid.
//
// Both paths return only the non-sensitive fields the UI consumes — never
// payment identifiers.
import { verifyJwt, bearerToken } from './_authStore.mjs';
import { getEntitlement, getAccountEntitlement, isPremiumPlan, jsonResponse } from './_entitlementsStore.mjs';

// The wallet path is unauthenticated and wallet addresses are public/enumerable,
// so this must return ONLY the non-sensitive fields the UI actually consumes
// (see src/entitlements.js describeEntitlement + src/main.jsx mergeEntitlements:
// plan, source, reason, expiresAt). It must NEVER expose payment identifiers -
// transactionHash, amountPaid, currency, or Stripe customer/subscription ids.
// The same filter is applied to the account path: the account's own JWT does not
// entitle the browser to its Stripe ids either.
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

  // Which lookup was asked for is decided by the QUERY, not by whether a header
  // happens to be attached. A signed-in legacy user asks about their wallet and
  // their account with two separate calls, and dispatching on header presence
  // would let an auth header silently turn the first into the second — the kind
  // of thing that works in every test and breaks for exactly the users with
  // both identities.
  const wallet = (event.queryStringParameters?.wallet || '').trim();

  if (wallet) {
    // Legacy wallet path, unchanged and still unauthenticated.
    const entitlement = await getEntitlement(wallet);
    return jsonResponse(200, { wallet, entitlement: toPublicEntitlement(entitlement) });
  }

  // Account path: the caller's own entitlement, proven by their JWT.
  const auth = verifyJwt(bearerToken(event));
  if (auth?.sub) {
    const entitlement = await getAccountEntitlement(auth.sub);
    return jsonResponse(200, { account: true, entitlement: toPublicEntitlement(entitlement) });
  }

  return jsonResponse(400, { message: 'Sign in, or pass a wallet query parameter.' });
}
