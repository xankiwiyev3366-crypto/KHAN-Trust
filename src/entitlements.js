// Reads the server-recorded entitlement (see netlify/functions/entitlement-status.mjs)
// so Premium/Early Supporter UI can be gated on a real verified payment instead
// of a "team will handle it manually" message.
//
// TWO READS, because there are two places a paid plan can live:
//   fetchAccountEntitlement()  the signed-in account. Every purchase made since
//                              checkout stopped demanding a wallet.
//   fetchEntitlement(wallet)   LEGACY. Purchases keyed by wallet from before
//                              this site had accounts.
// src/main.jsx merges them (plus admin-granted manual premium) by highest tier,
// so a legacy user sees Premium with or without their wallet connected, and a
// new user never needs one at all.
const ENTITLEMENT_ENDPOINT = '/.netlify/functions/entitlement-status';

// Same convention as src/userData.js / src/premiumAdmin.js — see the note in
// src/stripeCheckout.js. Must stay identical across all of them.
const AUTH_TOKEN_KEY = 'khan-trust-auth-token-v1';

// LEGACY. Looks a wallet's paid plan up by address. Unauthenticated: wallet
// addresses are public, and this returns only what the UI renders.
export async function fetchEntitlement(walletAddress) {
  if (!walletAddress) return null;
  try {
    const response = await fetch(`${ENTITLEMENT_ENDPOINT}?wallet=${encodeURIComponent(walletAddress)}`);
    if (!response.ok) return null;
    const data = await response.json();
    return data?.entitlement || null;
  } catch {
    return null;
  }
}

// The caller's OWN account entitlement, proven by their JWT. Best-effort: any
// failure (signed out, endpoint down) resolves to null so it can never block or
// break the Premium UI — the same posture as fetchMyManualPremium().
export async function fetchAccountEntitlement() {
  let token = null;
  try { token = localStorage.getItem(AUTH_TOKEN_KEY); } catch { token = null; }
  if (!token) return null;
  try {
    const response = await fetch(ENTITLEMENT_ENDPOINT, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.entitlement || null;
  } catch {
    return null;
  }
}

// Early Supporter is a superset of Premium (one-time $29 includes the same
// research tools as the $9/month plan, plus the badge/recognition below) -
// but it must never be reported as plain 'premium' to the UI, otherwise an
// Early Supporter never sees their badge. Check isEarlySupporter() first.
export function hasPlanAccess(entitlement, plan) {
  if (!entitlement) return false;
  if (plan === 'premium') return entitlement.plan === 'premium' || entitlement.plan === 'early_supporter';
  return entitlement.plan === plan;
}

export function isEarlySupporter(entitlement) {
  return entitlement?.plan === 'early_supporter';
}

// Normalizes a merged entitlement (paid wallet record OR admin-granted manual
// grant - see src/main.jsx mergeEntitlements) into the fields the Premium
// profile indicators and badges need. Pure; safe to call with null.
//   - Paid records carry no `source`, so they default to 'payment'.
//   - Manual grants carry source ('manual' | 'giveaway' | 'promotion' | ...),
//     an optional grant `reason` ('partner' | 'investor' | ...) and `expiresAt`.
//   - Early Supporter and any non-payment grant with no expiry are Lifetime.
export function describeEntitlement(entitlement) {
  if (!entitlement) return null;
  const plan = entitlement.plan;
  const source = entitlement.source || 'payment';
  const reason = entitlement.reason || null;
  const expiresAt = entitlement.expiresAt || null;
  const early = plan === 'early_supporter';
  const isLifetime = early || (source !== 'payment' && !expiresAt);
  let status;
  if (isLifetime) status = 'lifetime';
  else if (expiresAt && Date.parse(expiresAt) < Date.now()) status = 'expired';
  else status = 'active';
  return { plan, source, reason, expiresAt, isLifetime, status, isEarlySupporter: early };
}

// Which badge to show for an entitlement. Early Supporter and special grant
// reasons (Partner/Investor) take precedence over the plain Premium crown.
// Returns null when there is no active Premium at all.
export function premiumBadgeInfo(entitlement) {
  const d = describeEntitlement(entitlement);
  if (!d) return null;
  if (d.isEarlySupporter) return { key: 'earlySupporter', emoji: '⭐', labelKey: 'earlySupporter.badgeLabel', className: 'early' };
  if (d.reason === 'partner') return { key: 'partner', emoji: '🤝', labelKey: 'accountPlan.badges.partner', className: 'partner' };
  if (d.reason === 'investor') return { key: 'investor', emoji: '💼', labelKey: 'accountPlan.badges.investor', className: 'investor' };
  return { key: 'premium', emoji: '👑', labelKey: 'premium.badgeLabel', className: 'premium' };
}
