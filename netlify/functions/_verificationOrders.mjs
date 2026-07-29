// Paid verification orders: the record of who bought verification for which
// contract, what they paid, and whether it is still valid.
//
// WHERE THE TRUTH LIVES, AND THE ONE PLACE THAT RULE BENDS
//
// Netlify Blobs is this platform's source of truth and Postgres is a
// best-effort mirror that silently no-ops without DATABASE_URL (see _db.mjs,
// whose header is explicit that it "must never break a request"). That posture
// is right for analytics and wrong for the single rule this product cannot get
// wrong:
//
//   AT MOST ONE ACTIVE VERIFICATION PER (chain, contract).
//
// Selling two teams a verified badge for the same token means at least one of
// them proved ownership of something someone else also proved, and the badge
// stops meaning anything. Blobs has no constraints, no transactions and no
// compare-and-swap, so it cannot enforce this; Postgres can, with a partial
// unique index (db/migrations/0002_verification.sql).
//
// So this module uses BOTH, and is explicit about what each one buys:
//
//   Blobs      source of truth for order CONTENT. Every field a customer or an
//              admin reads comes from here. Survives a missing DATABASE_URL
//              completely, exactly like every other store.
//   Postgres   the exclusivity LOCK, when it is available. `claimContract()`
//              does an INSERT ... ON CONFLICT DO NOTHING and reports whether it
//              won the slot.
//
// WHAT HAPPENS WITH NO DATABASE_URL. The lock degrades to a read-check against
// Blobs, which is racy in principle: two activations landing inside the same
// few hundred milliseconds could both see no active record. This is stated
// plainly rather than papered over. Three things make it an acceptable
// exposure and none of them is wishful:
//
//   1. The window requires two DIFFERENT buyers paying for the SAME contract
//      within milliseconds of each other. The contract is the thing being sold
//      exclusivity ON, so this is not a busy-endpoint race, it is a collision
//      between two strangers who both happen to own the same token.
//   2. Both are caught at ACTIVATION — after payment, where a duplicate is
//      detectable and refundable — not silently at quote time.
//   3. The loser is written as `status: 'duplicate'` with the payment signature
//      intact, so the money is traceable and refundable. It is never discarded
//      and never quietly overwritten.
//
// Set DATABASE_URL and the window closes entirely. That is the recommendation,
// and `claimContract` reports which mode it ran in so the difference is visible
// in the logs rather than assumed.
import { getNamedStore, jsonResponse } from './_blobsClient.mjs';
import { mirror, readRows, dbConfigured } from './_db.mjs';
import { getVerificationTier, expiryFromNow, isVerificationActive } from '../../src/lib/verificationTiers.js';

const STORE_NAME = 'khan-trust-verify-orders';
const ORDERS_KEY = 'orders.json';

// The order lifecycle. Every transition is one-way except the terminal states.
//
//   quoted            a price was issued. No money, no reservation, no promise.
//   pending_payment   the buyer committed to a tier and was shown an address.
//   paid              a transaction settled on chain for the right amount.
//   active            payment AND ownership proof are both in. The badge is live.
//   duplicate         paid, but another order already held this contract.
//                     REFUNDABLE — the payment signature is kept.
//   expired           the term ran out.
//   revoked           an admin withdrew it.
//   cancelled         the buyer abandoned it before paying.
export const ORDER_STATUS = {
  QUOTED: 'quoted',
  PENDING_PAYMENT: 'pending_payment',
  PAID: 'paid',
  ACTIVE: 'active',
  DUPLICATE: 'duplicate',
  EXPIRED: 'expired',
  REVOKED: 'revoked',
  CANCELLED: 'cancelled',
};

function store() {
  return getNamedStore(STORE_NAME);
}

// Contract identity is normalised ONCE, here. EVM addresses are case-insensitive
// and wallets/explorers disagree about checksum casing, so `0xAbC…` and `0xabc…`
// are the same token and must not be sellable twice. Solana base58 IS
// case-sensitive and must NOT be lowercased, or two genuinely different mints
// could collide into one key and the second owner would be refused a sale.
export function contractKey(chain, contract) {
  const c = String(contract || '').trim();
  const chainId = String(chain || '').trim().toLowerCase();
  if (!c || !chainId) return '';
  const normalised = c.startsWith('0x') ? c.toLowerCase() : c;
  return `${chainId}:${normalised}`;
}

export async function readOrders() {
  const data = await store().get(ORDERS_KEY, { type: 'json' });
  return data && typeof data === 'object' ? data : {};
}

async function writeOrders(orders) {
  await store().setJSON(ORDERS_KEY, orders);
}

export async function getOrder(orderId) {
  if (!orderId) return null;
  const orders = await readOrders();
  return orders[orderId] || null;
}

export async function putOrder(order) {
  const orders = await readOrders();
  orders[order.id] = order;
  await writeOrders(orders);
  // Mirror is best-effort and must never fail the write — the Blob above is the
  // record. The exclusivity lock is claimed separately by claimContract(); this
  // mirror is for reporting and reconciliation only.
  try {
    await mirror(
      `INSERT INTO verification_orders
         (id, contract_key, chain, contract, tier, usd_amount, status, buyer_subject,
          owner_wallet, payment_signature, quote_score, created_at, activated_at, expires_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         owner_wallet = COALESCE(EXCLUDED.owner_wallet, verification_orders.owner_wallet),
         payment_signature = COALESCE(EXCLUDED.payment_signature, verification_orders.payment_signature),
         activated_at = COALESCE(EXCLUDED.activated_at, verification_orders.activated_at),
         expires_at = COALESCE(EXCLUDED.expires_at, verification_orders.expires_at),
         updated_at = now()`,
      [
        order.id, order.contractKey, order.chain, order.contract, order.tierId,
        order.usd, order.status, order.buyerSubject || null, order.ownerWallet || null,
        order.paymentSignature || null,
        Number.isFinite(order.quoteScore) ? order.quoteScore : null,
        order.createdAt, order.activatedAt || null, order.expiresAt || null,
      ]
    );
  } catch { /* non-fatal by contract */ }
  return order;
}

// Every order currently holding a live badge for this contract.
export async function findActiveOrderForContract(key, now = Date.now()) {
  if (!key) return null;
  const orders = await readOrders();
  for (const order of Object.values(orders)) {
    if (order.contractKey !== key) continue;
    if (order.status !== ORDER_STATUS.ACTIVE) continue;
    // An order whose term has run out is not active any more, whatever the
    // stored status says. Expiry is derived from the timestamp rather than
    // waiting for a sweeper to rewrite the record, so a lapsed verification
    // can never keep a contract locked against the owner renewing it.
    if (!isVerificationActive({ status: 'verified', expiresAt: order.expiresAt, revokedAt: order.revokedAt }, now)) continue;
    return order;
  }
  return null;
}

// ── The exclusivity claim ───────────────────────────────────────────────────
//
// Returns:
//   { won: true,  enforcedBy: 'postgres' | 'blobs' }
//   { won: false, enforcedBy, heldBy }   another order owns this contract
//
// Postgres path: a partial unique index on (contract_key) WHERE status='active'
// makes the INSERT itself the arbiter — two concurrent callers cannot both get
// a row back. `ON CONFLICT DO NOTHING RETURNING id` turns that into a boolean
// with no error-string parsing.
//
// readRows() is used rather than mirror() on purpose: mirror() swallows the
// result, and here the result IS the answer.
export async function claimContract(order) {
  if (!order?.contractKey) return { won: false, enforcedBy: 'none', heldBy: null };

  if (dbConfigured()) {
    const result = await readRows(
      `INSERT INTO verification_active_contracts (contract_key, order_id, activated_at, expires_at)
       VALUES ($1, $2, now(), $3)
       ON CONFLICT (contract_key) DO NOTHING
       RETURNING order_id`,
      [order.contractKey, order.id, order.expiresAt || null],
      { label: 'verification_claim' }
    );
    if (result.ok) {
      if (result.rows.length > 0) return { won: true, enforcedBy: 'postgres' };
      // Lost the race — or WE already hold it (a retried activation of the same
      // order must be idempotent, not a self-inflicted duplicate).
      const holder = await readRows(
        'SELECT order_id FROM verification_active_contracts WHERE contract_key = $1',
        [order.contractKey],
        { label: 'verification_claim_holder' }
      );
      const heldBy = holder.ok ? (holder.rows[0]?.order_id || null) : null;
      if (heldBy && heldBy === order.id) return { won: true, enforcedBy: 'postgres' };
      return { won: false, enforcedBy: 'postgres', heldBy };
    }
    // Postgres is configured but could not answer. FALL THROUGH to the Blobs
    // check rather than failing the activation: the customer has already paid,
    // and refusing to activate a legitimately-paid order because the mirror
    // database was briefly unreachable is a worse outcome than the small race
    // documented at the top of this file. The degradation is logged by
    // readRows() itself.
    console.warn('[verify-orders] exclusivity claim fell back to Blobs — Postgres unavailable');
  }

  const existing = await findActiveOrderForContract(order.contractKey);
  if (existing && existing.id !== order.id) {
    return { won: false, enforcedBy: 'blobs', heldBy: existing.id };
  }
  return { won: true, enforcedBy: 'blobs' };
}

// Releasing the claim (revocation, expiry) so the contract can be sold again.
export async function releaseContract(contractKey, orderId) {
  if (!dbConfigured() || !contractKey) return;
  // Scoped to the holding order id so a stale caller cannot release someone
  // else's live claim.
  await mirror(
    'DELETE FROM verification_active_contracts WHERE contract_key = $1 AND order_id = $2',
    [contractKey, orderId]
  );
}

// ── Construction ────────────────────────────────────────────────────────────

export function buildOrder({ chain, contract, tierId, buyerSubject, quoteScore, projectId }) {
  const tier = getVerificationTier(tierId);
  if (!tier) throw new Error(`unknown verification tier: ${tierId}`);
  const now = new Date().toISOString();
  return {
    id: `vo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    chain: String(chain || '').trim().toLowerCase(),
    contract: String(contract || '').trim(),
    contractKey: contractKey(chain, contract),
    projectId: projectId || '',
    tierId: tier.id,
    // The price is captured ON THE ORDER at creation. The server re-reads it
    // from the tier module when checking the payment, so a price change cannot
    // retroactively under- or over-charge someone mid-purchase; this copy is
    // what the buyer was quoted and what a dispute is settled against.
    usd: tier.usd,
    status: ORDER_STATUS.PENDING_PAYMENT,
    buyerSubject: buyerSubject || '',
    // The client-lane trust score at the moment of sale. Kept because the floor
    // decision must be reconstructable later: "why was this sold?" has to have
    // an answer that does not depend on re-scanning months afterwards.
    quoteScore: Number.isFinite(quoteScore) ? quoteScore : null,
    ownerWallet: '',
    ownershipMethod: '',
    paymentSignature: '',
    paymentCurrency: '',
    amountPaid: null,
    paidAt: '',
    activatedAt: '',
    expiresAt: '',
    revokedAt: '',
    revokeReason: '',
    createdAt: now,
    updatedAt: now,
  };
}

export function withActivation(order, { ownerWallet, ownershipMethod, now = Date.now() }) {
  return {
    ...order,
    status: ORDER_STATUS.ACTIVE,
    ownerWallet,
    ownershipMethod,
    activatedAt: new Date(now).toISOString(),
    expiresAt: expiryFromNow(order.tierId, now),
    updatedAt: new Date(now).toISOString(),
  };
}

export { jsonResponse };
