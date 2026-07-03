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
