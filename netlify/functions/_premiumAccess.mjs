// Single source of truth for "does this caller have Premium?" on the server,
// across ALL entitlement sources - exactly mirroring the client's merged view
// in src/main.jsx (usePremiumEntitlement -> mergeEntitlements):
//
//   1. Paid wallet entitlement   (_entitlementsStore.mjs, keyed by wallet)   LEGACY
//   2. Paid account entitlement  (_entitlementsStore.mjs, keyed by u:<userId>) PRIMARY
//   3. Admin-granted manual grant (_premiumStore.mjs, keyed by auth user id)
//
// All sources treat plan === 'premium' || 'early_supporter' as Premium
// (isPremiumPlan / isGrantActive), so Early Supporter is honored everywhere.
//
// THE STORAGE KEY IS THE DANGEROUS PART
//
// This also resolves the STORAGE KEY that a caller's Premium-only user data
// (saved reports / synced watchlist) lives under, so reads and writes always
// agree. Get this wrong and a paying customer signs in to an empty account —
// their data is not deleted, but it is unreachable, which they cannot tell
// apart from deleted.
//
// Two rules protect that:
//
//   - A proven wallet with a paid entitlement is checked FIRST and keeps using
//     its wallet address as the key. Every pre-migration purchase wrote data
//     under that key; resolving such a caller to their account id instead would
//     silently strand it.
//   - A CLAIMED account (see premium-claim-wallet.mjs) carries the wallet it was
//     claimed from as `legacyStorageKey`, and keeps reading that key forever.
//     This is why claiming never has to copy data: copying can half-fail, a
//     pointer cannot. It is also what lets a legacy user stop connecting their
//     wallet entirely without losing a single saved report.
//
// Wallet addresses are base58 and never start with "u:", so the two key spaces
// cannot collide.
import { verifyJwt, bearerToken } from './_authStore.mjs';
import { getEntitlement, getAccountEntitlement, accountSubject, isPremiumPlan } from './_entitlementsStore.mjs';
import { getGrant, isGrantActive } from './_premiumStore.mjs';
import { provenWallet } from './_walletSession.mjs';

// Where a paid ACCOUNT entitlement's data lives. A claimed legacy entitlement
// points back at the wallet key its data was written under; a native account
// purchase uses the account key.
function storageKeyForAccount(userId, entitlement) {
  return entitlement?.legacyStorageKey || accountSubject(userId);
}

// Ownership-verified access resolver for premium USER DATA (saved reports /
// watchlist). Unlike resolvePremiumAccess below, it NEVER trusts a raw wallet
// address from the query/body - a wallet identity is only honored when the
// caller presented a valid wallet-session token proving control of that exact
// wallet (see _walletSession.mjs / P0-1). This closes the IDOR where anyone
// could read another user's wallet-keyed data by supplying their public
// address. The account-JWT path is unchanged (a JWT already proves ownership),
// so admin-granted / account premium users need no signature.
export async function resolveVerifiedPremiumAccess(event) {
  // 1. Cryptographically-proven wallet with a paid entitlement. FIRST, so a
  //    legacy paid user who connects their wallet keeps reading the exact key
  //    their data was written under.
  const wallet = provenWallet(event);
  if (wallet) {
    const ent = await getEntitlement(wallet);
    if (ent && isPremiumPlan(ent.plan)) {
      return { entitled: true, storageKey: wallet, plan: ent.plan, source: 'wallet' };
    }
  }

  const payload = verifyJwt(bearerToken(event));

  // 2. Paid ACCOUNT entitlement — the primary path for every purchase made
  //    since checkout stopped demanding a wallet. A JWT already proves
  //    ownership, so no signature is needed.
  if (payload?.sub) {
    const ent = await getAccountEntitlement(payload.sub);
    if (ent && isPremiumPlan(ent.plan)) {
      return {
        entitled: true,
        storageKey: storageKeyForAccount(payload.sub, ent),
        plan: ent.plan,
        source: 'account',
      };
    }
  }

  // 3. Admin-granted manual entitlement, identified by the normal auth JWT.
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

  const payload = verifyJwt(bearerToken(event));

  // 2. Paid ACCOUNT entitlement — the primary path since checkout stopped
  //    requiring a wallet.
  if (payload?.sub) {
    const ent = await getAccountEntitlement(payload.sub);
    if (ent && isPremiumPlan(ent.plan)) {
      return {
        entitled: true,
        storageKey: storageKeyForAccount(payload.sub, ent),
        plan: ent.plan,
        source: 'account',
      };
    }
  }

  // 3. Admin-granted manual entitlement, identified by the normal auth JWT.
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
