// Paid verification: the invariants that involve money and exclusivity.
//
// Three things are proven here, chosen because each has a silent failure mode:
//
//   1. The contract identity that decides "is this token already sold" treats
//      EVM and Solana addresses differently, and getting either wrong sells the
//      same token twice or refuses a legitimate second owner.
//   2. The Premium bonus included with verification can only ever EXTEND
//      access. The naive version silently converts a monthly subscriber's
//      open-ended entitlement into one that dies in 90 days.
//   3. Read-time expiry, so a lapsed badge stops asserting itself the instant
//      it lapses rather than whenever a sweeper next runs.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

class FakeStore {
  constructor() { this.data = new Map(); }
  async setJSON(key, value) { this.data.set(key, JSON.parse(JSON.stringify(value))); }
  async get(key) { return this.data.has(key) ? JSON.parse(JSON.stringify(this.data.get(key))) : null; }
  async delete(key) { this.data.delete(key); }
  async list({ prefix } = {}) {
    return { blobs: Array.from(this.data.keys()).filter((k) => !prefix || k.startsWith(prefix)).map((key) => ({ key })) };
  }
}

const stores = new Map();
const storeFor = (name) => {
  if (!stores.has(name)) stores.set(name, new FakeStore());
  return stores.get(name);
};

mock.module('../netlify/functions/_blobsClient.mjs', {
  namedExports: {
    getNamedStore: storeFor,
    jsonResponse: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
  },
});

const { contractKey, buildOrder, putOrder, findActiveOrderForContract, ORDER_STATUS } =
  await import('../netlify/functions/_verificationOrders.mjs');
const { grantTimedBonus, getEntitlement, grantEntitlement } =
  await import('../netlify/functions/_entitlementsStore.mjs');
const { applyExpiry } = await import('../netlify/functions/verification-status.mjs');

// ── Contract identity ───────────────────────────────────────────────────────

test('EVM addresses are case-folded, Solana addresses are not', () => {
  // EVM checksum casing is cosmetic — wallets and explorers disagree about it,
  // so `0xAbC…` and `0xabc…` are ONE token and must not be sellable twice.
  assert.equal(
    contractKey('ethereum', '0xAbCdEf0000000000000000000000000000000001'),
    contractKey('ethereum', '0xabcdef0000000000000000000000000000000001')
  );

  // Solana base58 IS case-sensitive. Lowercasing it would collapse two
  // genuinely different mints onto one key and refuse the second owner a sale
  // they are entitled to make.
  assert.notEqual(
    contractKey('solana', 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'),
    contractKey('solana', 'dezxaz8z7pnrnrjjz3wxborgixca6xjnb7yab1ppb263')
  );
});

test('the same address on two chains is two different products', () => {
  const addr = '0xAbCdEf0000000000000000000000000000000001';
  assert.notEqual(contractKey('ethereum', addr), contractKey('base', addr));
});

test('an incomplete identity produces no key rather than a colliding one', () => {
  // '' must never be a usable key: every token with a missing chain or contract
  // would share it and the first sale would lock out all of them.
  assert.equal(contractKey('', '0xabc'), '');
  assert.equal(contractKey('solana', ''), '');
  assert.equal(contractKey(null, null), '');
});

// ── Exclusivity, derived rather than stored ─────────────────────────────────

test('an expired active order stops holding its contract', async () => {
  const order = buildOrder({ chain: 'solana', contract: 'Mint1111111111111111111111111111111111111', tierId: 'verified', quoteScore: 80 });
  order.status = ORDER_STATUS.ACTIVE;
  order.activatedAt = '2025-01-01T00:00:00.000Z';
  order.expiresAt = '2026-01-01T00:00:00.000Z';   // long past
  await putOrder(order);

  // If this returned the lapsed order, the original owner could never renew and
  // nobody else could ever buy it — the contract would be locked forever by a
  // verification that had already ended.
  assert.equal(await findActiveOrderForContract(order.contractKey), null);

  order.expiresAt = '2099-01-01T00:00:00.000Z';
  await putOrder(order);
  const held = await findActiveOrderForContract(order.contractKey);
  assert.equal(held?.id, order.id);
});

test('a revoked order releases its contract even before the term ends', async () => {
  const order = buildOrder({ chain: 'solana', contract: 'Mint2222222222222222222222222222222222222', tierId: 'verified', quoteScore: 90 });
  order.status = ORDER_STATUS.ACTIVE;
  order.expiresAt = '2099-01-01T00:00:00.000Z';
  order.revokedAt = '2026-07-01T00:00:00.000Z';
  await putOrder(order);
  assert.equal(await findActiveOrderForContract(order.contractKey), null);
});

// ── The included Premium months ─────────────────────────────────────────────

test('the verification bonus never shortens an existing unlimited entitlement', async () => {
  // THE BUG THIS EXISTS TO PREVENT. A monthly subscriber has an entitlement
  // with no expiresAt. Writing a 3-month bonus over it converts their
  // open-ended Premium into one that dies in 90 days while they carry on being
  // billed — and they would have no way to tell why they lost access.
  const subject = 'u:monthly-subscriber';
  await grantEntitlement(subject, { plan: 'premium', transactionHash: 'tx-monthly' });

  const result = await grantTimedBonus(subject, { plan: 'premium', expiresAt: '2026-10-29T00:00:00.000Z' });
  assert.equal(result.granted, false);
  assert.equal(result.reason, 'already_unlimited');

  const after = await getEntitlement(subject);
  assert.equal(after.expiresAt, undefined, 'an unlimited entitlement grew an expiry date');
  assert.equal(after.transactionHash, 'tx-monthly', 'the original purchase record was overwritten');
});

test('a later existing expiry wins over a shorter bonus', async () => {
  const subject = 'u:has-longer';
  await grantEntitlement(subject, { plan: 'premium', expiresAt: '2027-01-01T00:00:00.000Z' });
  const result = await grantTimedBonus(subject, { plan: 'premium', expiresAt: '2026-10-01T00:00:00.000Z' });
  assert.equal(result.granted, false);
  assert.equal(result.reason, 'existing_expiry_is_later');
  assert.equal((await getEntitlement(subject)).expiresAt, '2027-01-01T00:00:00.000Z');
});

test('the bonus is granted to a new buyer, and extends a shorter one', async () => {
  const fresh = 'u:brand-new';
  assert.equal((await grantTimedBonus(fresh, { plan: 'premium', expiresAt: '2026-10-29T00:00:00.000Z' })).granted, true);
  assert.equal((await getEntitlement(fresh)).expiresAt, '2026-10-29T00:00:00.000Z');

  const shorter = 'u:expiring-soon';
  await grantEntitlement(shorter, { plan: 'premium', expiresAt: '2026-08-01T00:00:00.000Z' });
  assert.equal((await grantTimedBonus(shorter, { plan: 'premium', expiresAt: '2027-08-01T00:00:00.000Z' })).granted, true);
  assert.equal((await getEntitlement(shorter)).expiresAt, '2027-08-01T00:00:00.000Z');
});

test('an Early Supporter receiving a verification bonus is never demoted to premium', async () => {
  const subject = 'u:founding-member';
  await grantEntitlement(subject, { plan: 'early_supporter', expiresAt: '2026-08-01T00:00:00.000Z' });
  await grantTimedBonus(subject, { plan: 'premium', expiresAt: '2027-08-01T00:00:00.000Z' });
  assert.equal((await getEntitlement(subject)).plan, 'early_supporter');
});

test('a bonus with no subject or no expiry is refused rather than half-written', async () => {
  assert.equal((await grantTimedBonus('', { expiresAt: '2027-01-01T00:00:00.000Z' })).granted, false);
  assert.equal((await grantTimedBonus('u:x', { expiresAt: '' })).granted, false);
});

// ── Read-time expiry on the public status map ───────────────────────────────

test('the public status map expires a lapsed badge without a sweeper', () => {
  const now = Date.parse('2026-07-29T12:00:00.000Z');
  const statuses = {
    live: { status: 'verified', expiresAt: '2027-01-01T00:00:00.000Z' },
    lapsed: { status: 'verified', expiresAt: '2026-01-01T00:00:00.000Z' },
    legacy: { status: 'verified' },                 // admin-approved, pre-paid-product
    pending: { status: 'pending' },
  };
  const out = applyExpiry(statuses, now);

  assert.equal(out.live.status, 'verified');
  // 'expired', NOT 'unverified': the owner must be able to tell "your term ran
  // out, renew" apart from "you were never verified".
  assert.equal(out.lapsed.status, 'expired');
  assert.equal(out.lapsed.expiredAt, '2026-01-01T00:00:00.000Z');
  assert.equal(out.legacy.status, 'verified', 'a pre-existing verification was retroactively expired');
  assert.equal(out.pending.status, 'pending');
});
