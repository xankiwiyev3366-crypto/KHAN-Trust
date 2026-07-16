// POST /.netlify/functions/premium-claim-wallet
//
// Binds a legacy wallet-keyed purchase to the caller's account, so a user who
// paid before accounts existed never has to connect that wallet again.
//
// WHY THIS EXISTS
//
// Entitlements used to be keyed by Solana address because the site had no
// accounts (see _entitlementsStore.mjs). Those users' Premium is still attached
// to a wallet, which means their access depends on them holding those keys and
// connecting them every time — the exact friction this whole step removes. This
// endpoint lets them move to the account identity voluntarily.
//
// SECURITY: TWO PROOFS, NOT ONE
//
// This grants paid access, so it demands BOTH:
//
//   1. a valid account JWT   — proves who is claiming
//   2. a wallet-session token — proves control of the wallet being claimed
//      (_walletSession.mjs: the wallet signed a nonce; a raw address is never
//      accepted)
//
// Without (2) this would be a total giveaway of every paid entitlement on the
// platform: wallet addresses are public and enumerable, so anyone could read a
// paid address off a block explorer, POST it, and receive that person's
// Premium. The address is never taken from the request body for this reason —
// only from the cryptographic proof.
//
// SAFETY: COPY, NEVER MOVE
//
// The wallet entitlement is COPIED to the account key and deliberately left in
// place. Nothing is revoked, moved, or deleted:
//
//   - If anything here goes wrong, the user still has exactly the access they
//     had this morning. The worst case is a no-op, never a lockout.
//   - Their saved reports and watchlist were written under the WALLET key. The
//     copy records that key as `legacyStorageKey`, and _premiumAccess.mjs reads
//     it forever, so the data is reachable from the account with no bulk copy —
//     a pointer cannot half-fail the way a data migration can.
//   - Re-claiming is idempotent: same input, same result, no duplicate state.
import { verifyJwt, bearerToken } from './_authStore.mjs';
import {
  getEntitlement,
  getAccountEntitlement,
  grantAccountEntitlement,
  grantEntitlement,
  isPremiumPlan,
  jsonResponse,
} from './_entitlementsStore.mjs';
import { provenWallet } from './_walletSession.mjs';
import { recordWalletLink } from './_walletLinkStore.mjs';

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { message: 'Method not allowed' });
  }

  const auth = verifyJwt(bearerToken(event));
  if (!auth?.sub) {
    return jsonResponse(401, { reason: 'sign_in_required', message: 'Sign in to claim a purchase.' });
  }

  // Note: NOT from the body. The only wallet this endpoint will ever act on is
  // one whose owner has signed a challenge for it.
  const wallet = provenWallet(event);
  if (!wallet) {
    return jsonResponse(403, {
      reason: 'wallet_proof_required',
      message: 'Verify wallet ownership before claiming a purchase.',
    });
  }

  const walletEntitlement = await getEntitlement(wallet);
  if (!walletEntitlement || !isPremiumPlan(walletEntitlement.plan)) {
    return jsonResponse(404, {
      reason: 'no_purchase_found',
      message: 'No paid plan is on record for this wallet.',
    });
  }

  // Already claimed by this account — report success rather than an error, so a
  // double-click or a retry is harmless.
  const existing = await getAccountEntitlement(auth.sub);
  if (existing && isPremiumPlan(existing.plan) && existing.legacyStorageKey === wallet) {
    return jsonResponse(200, { ok: true, alreadyClaimed: true, plan: existing.plan });
  }

  // A different account already claimed this wallet. Refuse rather than move
  // the entitlement: two accounts sharing one purchase would be a silent
  // duplication of paid access, and we cannot tell which claim was legitimate.
  // The wallet path still works for whoever holds the keys, so nobody is locked
  // out by this refusal.
  if (walletEntitlement.claimedByUserId && walletEntitlement.claimedByUserId !== auth.sub) {
    return jsonResponse(409, {
      reason: 'already_claimed',
      message: 'This purchase has already been linked to a different account.',
    });
  }

  // This account ALREADY has a paid plan of its own. Refuse, because the grant
  // below is a write, not a merge: it would replace that record wholesale.
  //
  // The concrete way that costs someone money: a user claims a legacy lifetime
  // early_supporter wallet, later also takes a monthly premium subscription,
  // then cancels it. The cancellation revokes `u:<userId>` — which by then holds
  // the CLAIMED record — and destroys the lifetime access they bought years ago.
  // It would also silently repoint their storage key at the wallet, stranding
  // anything saved during their account-era subscription.
  //
  // Refusing costs this user nothing: they already have Premium via their
  // account, and their legacy wallet still resolves on its own path. There is
  // simply nothing here worth the risk of a destructive write.
  if (existing && isPremiumPlan(existing.plan)) {
    return jsonResponse(409, {
      reason: 'account_already_has_plan',
      message: 'This account already has a paid plan. Contact support to merge an older wallet purchase.',
    });
  }

  await grantAccountEntitlement(auth.sub, {
    ...walletEntitlement,
    // Where this entitlement's existing user data lives. _premiumAccess.mjs
    // resolves reads/writes here, which is why no data has to be copied.
    legacyStorageKey: wallet,
    claimedFromWallet: wallet,
    claimedAt: new Date().toISOString(),
    userId: auth.sub,
  });

  // Best-effort provenance on the wallet record, so support (and a future
  // re-claim by the same account) can see where it went. Never fails the claim:
  // the account grant above is what matters and it has already succeeded.
  try {
    await grantEntitlement(wallet, { ...walletEntitlement, claimedByUserId: auth.sub, claimedAt: new Date().toISOString() });
  } catch {
    // ignore — the claim stands
  }

  try {
    await recordWalletLink(auth.sub, wallet);
  } catch {
    // telemetry only
  }

  return jsonResponse(200, { ok: true, claimed: true, plan: walletEntitlement.plan });
}
