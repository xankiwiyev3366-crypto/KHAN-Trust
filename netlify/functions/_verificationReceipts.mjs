// The permanent record that someone paid for something and got it.
//
// ── WHY THIS IS NOT JUST "THE ORDER" ────────────────────────────────────────
//
// The order is a LIVE object. Its status moves — active becomes expired becomes
// revoked — and its expiry is rewritten on renewal. A receipt must not: it
// records what was true at the moment of purchase, which is exactly the question
// a chargeback, a tax return or an angry email six months later asks. Deriving
// the receipt from the order at read time would mean a revoked project's receipt
// silently changed to say the customer bought nothing.
//
// So the receipt is written ONCE, at activation, and never updated. `status`
// on it is the status AT ISSUE. The live status is always one lookup away
// through the profile URL it carries, which is where a reader should go for
// "what is true now" — and the receipt says so.
//
// ── THE RECEIPT NUMBER IS DERIVED, NOT ALLOCATED ────────────────────────────
//
// An incrementing counter would need a lock (Blobs has none) and would leak the
// platform's total sales volume to anyone holding two receipts. A random number
// would produce a DIFFERENT receipt on every retry of a flaky activation, so one
// purchase could end up with three receipt numbers and the customer would not
// know which to quote.
//
// It is therefore a deterministic HMAC of the order id: the same order always
// yields the same number, a retry is a no-op, and the number reveals nothing
// about volume. It is an identifier, not a secret — the HMAC is there for
// stability and non-enumerability, not to authenticate anything. Authorisation
// is a real check in verify-receipt.mjs, never "you knew the number".
import crypto from 'node:crypto';
import { getNamedStore, jsonResponse } from './_blobsClient.mjs';
import { mirror } from './_db.mjs';
import { profileUrlFor } from '../../src/lib/publicProfile.js';
import { siteOrigin } from './_badgeState.mjs';

const STORE_NAME = 'khan-trust-receipts';

function store() {
  return getNamedStore(STORE_NAME);
}

function receiptKey(orderId) {
  return `receipt/${orderId}`;
}

// The salt only has to be stable, not secret — see the header. It falls back to
// a fixed string so a deployment that never set it still produces consistent
// numbers rather than a different one per cold start, which would be the one
// failure mode that actually hurts.
function numberSalt() {
  return process.env.RECEIPT_NUMBER_SALT || 'khan-trust-receipt-v1';
}

export function receiptNumber(orderId, createdAt) {
  const year = String(createdAt || new Date().toISOString()).slice(0, 4);
  const digest = crypto.createHmac('sha256', numberSalt()).update(String(orderId)).digest('hex');
  // Base36 of the first 40 bits: eight characters, unambiguous to read aloud.
  const body = parseInt(digest.slice(0, 10), 16).toString(36).toUpperCase().padStart(8, '0').slice(0, 8);
  return `KT-${year}-${body}`;
}

// Builds the immutable record. Pure — no store, no clock beyond what is passed —
// so the redaction rules below are testable.
//
// WHAT IS DELIBERATELY NOT ON A RECEIPT: buyerSubject (an internal account key),
// adminNote (an internal review comment), badgeToken (a per-verification
// secret), quoteScore's provenance, and anything else the customer did not pay
// for and has no use for. A receipt is handed around — attached to an email,
// forwarded to an accountant, pasted into a support ticket — so it is treated as
// public-to-its-holder from the start rather than trimmed later.
export function buildReceipt(order, { origin = siteOrigin(), now = Date.now() } = {}) {
  const createdAt = order.activatedAt || new Date(now).toISOString();
  return {
    receiptNumber: receiptNumber(order.id, createdAt),
    orderId: order.id,

    chain: order.chain,
    contract: order.contract,
    projectId: order.projectId || order.contractKey || '',

    tier: order.tierId,
    amount: order.usd,
    // The USD figure is what was CHARGED; amountPaid/paymentCurrency are what
    // actually moved on chain. Both are kept because they are different facts
    // and a dispute needs the pair — a SOL-denominated payment for a USD price
    // is not reconcilable from either one alone.
    currency: 'USD',
    amountPaid: Number.isFinite(order.amountPaid) ? order.amountPaid : null,
    paymentCurrency: order.paymentCurrency || '',
    transactionSignature: order.paymentSignature || '',
    payerWallet: order.ownerWallet || '',

    paidAt: order.paidAt || '',
    activatedAt: order.activatedAt || '',
    expiresAt: order.expiresAt || '',
    ownershipMethod: order.ownershipMethod || '',

    // The status AT ISSUE — see the header. Never rewritten.
    statusAtIssue: order.status,

    profileUrl: profileUrlFor(origin, order.chain, order.contract),
    badgeUrl: `${origin}/badge/${encodeURIComponent(order.chain)}/${encodeURIComponent(order.contract)}`,
    receiptUrl: `${origin}/receipt/${encodeURIComponent(order.id)}`,

    issuedAt: createdAt,
  };
}

export async function getReceipt(orderId) {
  if (!orderId) return null;
  const data = await store().get(receiptKey(orderId), { type: 'json' }).catch(() => null);
  return data && typeof data === 'object' ? data : null;
}

// WRITE-ONCE. A second call for an order that already has a receipt returns the
// existing one untouched.
//
// This is what makes receipt generation safe to retry — and it must be safe to
// retry, because the whole reason it runs on the queue is that the activation
// path may not wait for it. Overwriting would let a later, degraded view of the
// order (say, after expiry) replace the record of the sale.
export async function ensureReceipt(order, { origin = siteOrigin(), now = Date.now() } = {}) {
  if (!order?.id) return { ok: false, reason: 'no_order' };
  const existing = await getReceipt(order.id);
  if (existing) return { ok: true, created: false, receipt: existing };

  const receipt = buildReceipt(order, { origin, now });
  await store().setJSON(receiptKey(order.id), receipt);

  try {
    await mirror(
      `INSERT INTO verification_receipts
         (receipt_number, order_id, chain, contract, tier, amount_usd, amount_paid,
          payment_currency, transaction_signature, payer_wallet, paid_at, activated_at,
          expires_at, status_at_issue, issued_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (order_id) DO NOTHING`,
      [
        receipt.receiptNumber, receipt.orderId, receipt.chain, receipt.contract,
        receipt.tier, receipt.amount, receipt.amountPaid, receipt.paymentCurrency || null,
        receipt.transactionSignature || null, receipt.payerWallet || null,
        receipt.paidAt || null, receipt.activatedAt || null, receipt.expiresAt || null,
        receipt.statusAtIssue, receipt.issuedAt,
      ],
    );
  } catch { /* mirror is non-fatal by contract */ }

  return { ok: true, created: true, receipt };
}

// May this caller see this receipt?
//
// Three ways to qualify, and none of them is "you knew the order id":
//   - the authenticated account that placed the order
//   - the wallet that proved ownership and paid
//   - an admin
//
// Order ids are guessable enough (`vo-<ms>-<8 chars>`) that treating knowledge of
// one as proof would expose a customer's payment details, wallet and transaction
// signature to anyone who could brute-force a millisecond timestamp.
export function canViewReceipt({ order, accountSubject: subject = '', wallet = '', isAdmin = false }) {
  if (isAdmin) return true;
  if (!order) return false;
  if (subject && order.buyerSubject && order.buyerSubject === subject) return true;
  if (wallet && order.ownerWallet && order.ownerWallet === wallet) return true;
  return false;
}

export { jsonResponse };
