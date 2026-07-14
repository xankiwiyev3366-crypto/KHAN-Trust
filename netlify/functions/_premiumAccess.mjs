// Single source of truth for "does this caller have Premium?" on the server,
// across BOTH entitlement sources - exactly mirroring the client's merged view
// in src/main.jsx (useWalletEntitlement -> mergeEntitlements):
//
//   1. Paid wallet entitlement   (_entitlementsStore.mjs, keyed by wallet)
//   2. Admin-granted manual grant (_premiumStore.mjs, keyed by auth user id)
//
// Both sources treat plan === 'premium' || 'early_supporter' as Premium
// (isPremiumPlan / isGrantActive), so Early Supporter is honored everywhere.
//
// It also resolves the STORAGE KEY that a caller's Premium-only user data
// (saved reports / synced watchlist) lives under, so reads and writes always
// agree:
//   - A wallet with a paid entitlement keeps using its wallet address as the
//     key (backward compatible - existing data is untouched).
//   - An admin-granted user (who may have no wallet at all) uses a stable
//     account-scoped key `u:<userId>`. Wallet addresses are base58 and never
//     start with "u:", so the two key spaces can't collide.
import { verifyJwt, bearerToken } from './_authStore.mjs';
import { getEntitlement, isPremiumPlan } from './_entitlementsStore.mjs';
import { getGrant, isGrantActive } from './_premiumStore.mjs';
import { provenWallet } from './_walletSession.mjs';

// Ownership-verified access resolver for premium USER DATA (saved reports /
// watchlist). Unlike resolvePremiumAccess below, it NEVER trusts a raw wallet
// address from the query/body - a wallet identity is only honored when the
// caller presented a valid wallet-session token proving control of that exact
// wallet (see _walletSession.mjs / P0-1). This closes the IDOR where anyone
// could read another user's wallet-keyed data by supplying their public
// address. The account-JWT path is unchanged (a JWT already proves ownership),
// so admin-granted / account premium users need no signature.
export async function resolveVerifiedPremiumAccess(event) {
  // 1. Cryptographically-proven wallet with a paid entitlement.
  const wallet = provenWallet(event);
  if (wallet) {
    const ent = await getEntitlement(wallet);
    if (ent && isPremiumPlan(ent.plan)) {
      return { entitled: true, storageKey: wallet, plan: ent.plan, source: 'wallet' };
    }
  }

  // 2. Admin-granted manual entitlement, identified by the normal auth JWT.
  const payload = verifyJwt(bearerToken(event));
  if (payload?.sub) {
    const grant = await getGrant(payload.sub);
    if (isGrantActive(grant)) {
      return { entitled: true, storageKey: `u:${payload.sub}`, plan: grant.plan, source: 'manual' };
    }
  }

  // Not entitled. Only ever fall back to an ownership-proven key (the account
  // id from the verified JWT, or the proven wallet) - NEVER a raw address a
  // caller merely claimed, so a GET can't be used to read someone else's data.
  const fallbackKey = wallet || (payload?.sub ? `u:${payload.sub}` : '');
  return { entitled: false, storageKey: fallbackKey, plan: null, source: null };
}

export async function resolvePremiumAccess(event, wallet) {
  const cleanWallet = (wallet || '').trim();

  // 1. Paid wallet entitlement takes precedence so paid users keep their
  //    existing wallet-keyed saved reports / watchlist.
  if (cleanWallet) {
    const ent = await getEntitlement(cleanWallet);
    if (ent && isPremiumPlan(ent.plan)) {
      return { entitled: true, storageKey: cleanWallet, plan: ent.plan, source: 'wallet' };
    }
  }

  // 2. Admin-granted manual entitlement, identified by the normal auth JWT.
  const payload = verifyJwt(bearerToken(event));
  if (payload?.sub) {
    const grant = await getGrant(payload.sub);
    if (isGrantActive(grant)) {
      return { entitled: true, storageKey: `u:${payload.sub}`, plan: grant.plan, source: 'manual' };
    }
  }

  // Not entitled. Still return the best-guess key (wallet if supplied, else the
  // account id) so a public GET can return the correct - usually empty - bucket
  // without leaking anything, since data is only ever written when entitled.
  const fallbackKey = cleanWallet || (payload?.sub ? `u:${payload.sub}` : '');
  return { entitled: false, storageKey: fallbackKey, plan: null, source: null };
}
