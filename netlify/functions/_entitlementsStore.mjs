// Persistence layer for paid access, keyed by SUBJECT.
//
// A subject is one of two things:
//
//   "u:<userId>"   an authenticated account. The primary identity for every
//                  new purchase.
//   "<wallet>"     a Solana address. LEGACY: how every purchase before the
//                  account migration was keyed.
//
// WHY BOTH, FOREVER
//
// This store's original header read: "Keyed by Solana wallet address rather
// than a user account, since the site has no auth/accounts system - the
// connected wallet is the identity." That was true when it was written. The
// site later grew accounts (_authStore.mjs) and this layer never caught up, so
// the platform ended up with two identity systems and a checkout that demanded
// a wallet before it would take someone's money — asking the most
// security-anxious user on the internet to connect their wallet in order to buy
// protection from wallet risk.
//
// Accounts are now primary. But existing paid entitlements are keyed by wallet,
// and those users must never lose access, so wallet keys are not deprecated,
// migrated in bulk, or cleaned up. They are read forever. A legacy user can
// optionally bind their purchase to their account (premium-claim-wallet.mjs),
// which COPIES rather than moves — the wallet key survives the claim, so even a
// broken claim cannot cost someone access they paid for.
//
// The two key spaces cannot collide: base58 wallet addresses never contain ':'
// and never start with "u:". _premiumAccess.mjs already depended on this
// property for manual grants; it is now load-bearing here too.
import { getNamedStore, jsonResponse } from './_blobsClient.mjs';

const STORE_NAME = 'khan-trust-entitlements';
const ENTITLEMENTS_KEY = 'entitlements.json';
const USED_SIGNATURES_KEY = 'used-signatures.json';

const ACCOUNT_PREFIX = 'u:';

function store() {
  return getNamedStore(STORE_NAME);
}

// The subject key for an authenticated account.
export function accountSubject(userId) {
  const clean = String(userId || '').trim();
  return clean ? `${ACCOUNT_PREFIX}${clean}` : '';
}

export function isAccountSubject(subject) {
  return String(subject || '').startsWith(ACCOUNT_PREFIX);
}

export async function readEntitlements() {
  const data = await store().get(ENTITLEMENTS_KEY, { type: 'json' });
  return data && typeof data === 'object' ? data : {};
}

export async function writeEntitlements(entitlements) {
  await store().setJSON(ENTITLEMENTS_KEY, entitlements);
}

// Reads by subject — an account key OR a legacy wallet address. The parameter
// keeps its old name at every call site that passes a wallet; nothing about the
// wallet path changed.
export async function getEntitlement(subject) {
  if (!subject) return null;
  const entitlements = await readEntitlements();
  return entitlements[subject] || null;
}

export async function grantEntitlement(subject, record) {
  const entitlements = await readEntitlements();
  entitlements[subject] = record;
  await writeEntitlements(entitlements);
}

export async function revokeEntitlement(subject) {
  const entitlements = await readEntitlements();
  delete entitlements[subject];
  await writeEntitlements(entitlements);
}

// Convenience readers for the account lane, so callers do not have to know how
// a subject key is spelled.
export async function getAccountEntitlement(userId) {
  return getEntitlement(accountSubject(userId));
}

export async function grantAccountEntitlement(userId, record) {
  const subject = accountSubject(userId);
  if (!subject) throw new Error('grantAccountEntitlement requires a userId');
  return grantEntitlement(subject, record);
}

// Single definition of "this plan counts as Premium" - Early Supporter is a
// one-time purchase that includes every Premium tool (see src/entitlements.js
// hasPlanAccess, the client-side equivalent of this same rule). Every server
// function gating a Premium feature should check entitlements through this
// helper instead of re-deriving the plan comparison itself.
export function isPremiumPlan(plan) {
  return plan === 'premium' || plan === 'early_supporter';
}

export async function hasPremiumEntitlement(walletAddress) {
  const entitlement = await getEntitlement(walletAddress);
  return Boolean(entitlement && isPremiumPlan(entitlement.plan));
}

// Is this entitlement record a PAID, currently-active Premium? Every record in
// this store is a real purchase (Stripe or on-chain) — admin/manual/promo grants
// live in the isolated _premiumStore and never reach here — so "active premium
// entitlement" is exactly "active paid Premium user". Cancelled Stripe
// subscriptions are revoked (deleted) rather than expired, so a present record
// is normally live; the optional expiresAt check is belt-and-braces.
export function isEntitlementActivePremium(record, now = Date.now()) {
  if (!record || !isPremiumPlan(record.plan)) return false;
  if (record.expiresAt && Date.parse(record.expiresAt) <= now) return false;
  return true;
}

// Count DISTINCT paying users with active Premium. A single account purchase is
// written to BOTH the wallet key and the "u:<id>" account key (verify-solana-
// payment / premium-claim-wallet follow a copy-never-move rule), and both copies
// carry the same transactionHash — so we dedupe by transactionHash to count the
// human once, falling back to the subject key for any record without one. This
// is the ONLY definition of "paid premium users"; both admin endpoints call it
// so they can never drift. Returns 0 when nothing has been purchased yet.
export function countActivePaidPremium(entitlements = {}, now = Date.now()) {
  const seen = new Set();
  for (const [subject, record] of Object.entries(entitlements)) {
    if (!isEntitlementActivePremium(record, now)) continue;
    seen.add(record?.transactionHash || subject);
  }
  return seen.size;
}

// Stripe webhooks (e.g. subscription cancellation) identify the affected
// customer/subscription, not the subject directly - entitlements are keyed by
// subject, so look up the subject by scanning for the matching Stripe id that
// was recorded on it at grant time.
//
// Subject-agnostic on purpose: it matches whichever key carries the Stripe id,
// so a cancellation revokes correctly whether the purchase was made by an
// account (new) or by a wallet (legacy). Keying this to wallets only would mean
// account subscriptions could never be cancelled — the customer stops paying
// and keeps Premium forever.
export async function findSubjectByStripeSubscription(subscriptionId) {
  if (!subscriptionId) return null;
  const entitlements = await readEntitlements();
  return Object.keys(entitlements).find((subject) => entitlements[subject]?.stripeSubscriptionId === subscriptionId) || null;
}

export async function findSubjectByStripeCustomer(customerId) {
  if (!customerId) return null;
  const entitlements = await readEntitlements();
  return Object.keys(entitlements).find((subject) => entitlements[subject]?.stripeCustomerId === customerId) || null;
}

// Pre-existing names, kept so nothing that imports them breaks. Same behaviour:
// they always returned "the key carrying this Stripe id", which is now spelled
// "subject" because it may be an account.
export const findWalletByStripeSubscription = findSubjectByStripeSubscription;
export const findWalletByStripeCustomer = findSubjectByStripeCustomer;

// A confirmed transaction signature can only ever redeem one entitlement -
// without this, the same paid tx hash could be replayed against the verify
// endpoint repeatedly to grant access to other wallets.
export async function readUsedSignatures() {
  const data = await store().get(USED_SIGNATURES_KEY, { type: 'json' });
  return data && typeof data === 'object' ? data : {};
}

export async function markSignatureUsed(signature, walletAddress) {
  const used = await readUsedSignatures();
  used[signature] = { walletAddress, usedAt: new Date().toISOString() };
  await store().setJSON(USED_SIGNATURES_KEY, used);
}

export async function isSignatureUsed(signature) {
  const used = await readUsedSignatures();
  return Boolean(used[signature]);
}

export { jsonResponse };
