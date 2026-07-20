// SERVER-SIDE enforcement of the Free/Premium split. The counterpart to the
// crown overlays in the UI — and the half that actually matters.
//
// A crown in the DOM is a sales cue, not a boundary: anyone can open devtools,
// flip `hasPremium`, and render a locked panel. What stops them getting the
// DATA is this module, sitting at the top of every Premium endpoint.
//
// One import, one call:
//
//   import { requireFeature } from './_featureGate.mjs';
//   const gate = await requireFeature(event, 'scoreHistory');
//   if (!gate.allowed) return gate.response;
//   // gate.access.storageKey is the caller's resolved data key
//
// The tier itself is never written here — it is read from the shared registry
// in src/lib/features.js, the same file the client reads, so the UI's idea of
// what is Premium and the server's cannot drift apart.
//
// ── IDENTITY ─────────────────────────────────────────────────────────────────
//
// Entitlement comes from resolveVerifiedPremiumAccess — the ownership-proven
// resolver (account JWT, or a signed wallet-session token). Never a raw wallet
// address from the query or body: a public address proves nothing, and trusting
// one would let any free user unlock Premium by pasting a known paid wallet.
// See the long note in _premiumAccess.mjs.
//
// ── WHY THIS FAILS OPEN ──────────────────────────────────────────────────────
//
// If the entitlement store is unreachable, getNamedStore THROWS (see
// _blobsClient.mjs) rather than quietly reporting "not entitled". That
// distinction is the whole reason this module can be safe: a thrown error is
// an OUTAGE, not a denial, and the two get opposite treatment.
//
// On an outage we allow the request. The alternative — failing closed — locks
// out every paying customer the moment Blobs hiccups, which is precisely the
// "never strand a paying customer" rule this codebase already follows in
// scan-quota.mjs and _rateLimit.mjs. The cost of failing open is that Free
// users briefly see Premium panels during an incident. The cost of failing
// closed is that people who paid cannot use what they bought, and they cannot
// tell an outage apart from being cheated.
//
// Note this is the opposite call from the growth AI budget, which is the sole
// fail-closed store here — that one guards real spend, and an unmetered LLM
// loop costs money on every retry. A premium panel does not.
import { canUseFeature, isPremiumFeature } from '../../src/lib/features.js';
import { resolveVerifiedPremiumAccess } from './_premiumAccess.mjs';
import { jsonResponse } from './_blobsClient.mjs';

// The body a blocked caller gets. 402 Payment Required is the honest status:
// the request was well-formed and authenticated, it just is not paid for.
// Deliberately NOT 403 — the client distinguishes the two, and renders 402 as
// the upgrade modal rather than as an error.
function upgradeRequiredResponse(featureKey) {
  return jsonResponse(402, {
    ok: false,
    error: 'premium_required',
    feature: featureKey,
    message: 'This feature requires KHAN Trust Premium.',
    upgradeUrl: '/#/pricing',
  });
}

// Resolves the caller and decides. Returns:
//   { allowed: true,  access, premium }            → proceed
//   { allowed: false, response }                   → return response verbatim
//
// `access` is the full resolveVerifiedPremiumAccess result, so an endpoint that
// needs the caller's storage key does not have to resolve identity twice.
export async function requireFeature(event, featureKey) {
  // A free feature still resolves access — endpoints want the storage key and
  // the premium flag for shaping their payload — but can never be refused.
  let access;
  try {
    access = await resolveVerifiedPremiumAccess(event);
  } catch {
    // OUTAGE, not a denial. See the header: allow, and report premium so a
    // paying customer's UI does not flicker into its locked state mid-incident.
    return { allowed: true, access: { entitled: true, storageKey: '', plan: null, source: 'degraded' }, premium: true, degraded: true };
  }

  if (!isPremiumFeature(featureKey)) {
    return { allowed: true, access, premium: access.entitled === true };
  }

  if (!canUseFeature(featureKey, { hasPremium: access.entitled === true })) {
    return { allowed: false, response: upgradeRequiredResponse(featureKey), access, premium: false };
  }

  return { allowed: true, access, premium: true };
}

// For endpoints that must serve BOTH tiers from one route, returning a reduced
// payload to Free users instead of a 402 (the "short AI explanation" case: the
// free summary is a real answer, not a teaser). Never refuses; just reports.
export async function resolveTier(event) {
  try {
    const access = await resolveVerifiedPremiumAccess(event);
    return { premium: access.entitled === true, access, degraded: false };
  } catch {
    return { premium: true, access: { entitled: true, storageKey: '', plan: null, source: 'degraded' }, degraded: true };
  }
}
