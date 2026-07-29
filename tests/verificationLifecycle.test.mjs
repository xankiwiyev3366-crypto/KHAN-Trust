// Phase 5 — receipts, transactional email idempotency, expiry transitions, the
// Premium bonus, Telegram redaction, and admin authorisation.
//
// The common thread: this is the part of the system that handles money and makes
// promises to people who have paid. Every test is about something that must
// happen exactly once, or must never happen twice, or must never be published.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

class FakeStore {
  constructor() { this.data = new Map(); }
  async setJSON(key, value) { this.data.set(key, JSON.parse(JSON.stringify(value))); }
  async get(key) { return this.data.has(key) ? JSON.parse(JSON.stringify(this.data.get(key))) : null; }
  async delete(key) { this.data.delete(key); }
  async list({ prefix = '' } = {}) {
    return { blobs: [...this.data.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) };
  }
}

const stores = new Map();
const storeFor = (name) => {
  if (!stores.has(name)) stores.set(name, new FakeStore());
  return stores.get(name);
};

// Every send is captured rather than performed, so "was this sent twice?" is a
// question with an exact answer.
const sent = [];
let sendResult = { ok: true };

mock.module('../netlify/functions/_blobsClient.mjs', {
  namedExports: {
    getNamedStore: storeFor,
    jsonResponse: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
  },
});

mock.module('../netlify/functions/_db.mjs', {
  namedExports: {
    mirror: async () => ({ ok: false, skipped: true }),
    readRows: async () => ({ ok: false, reason: 'no_database_url' }),
    dbConfigured: () => false,
  },
});

mock.module('../netlify/functions/_email.mjs', {
  namedExports: {
    sendEmail: async (message) => { sent.push(message); return sendResult; },
    isEmailConfigured: () => true,
    getAdminNotifyEmail: () => '',
    sendVerificationEmail: async () => ({ ok: true }),
  },
});

const users = new Map([['u1', { id: 'u1', email: 'owner@example.com', name: 'Owner' }]]);
mock.module('../netlify/functions/_authStore.mjs', {
  namedExports: {
    getUserById: async (id) => users.get(id) || null,
    verifyJwt: () => null,
    bearerToken: () => '',
    jsonResponse: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
  },
});

const {
  buildReceipt,
  receiptNumber,
  ensureReceipt,
  getReceipt,
  canViewReceipt,
} = await import('../netlify/functions/_verificationReceipts.mjs');
const {
  sendVerificationEmailOnce,
  buildMail,
  wasSent,
  resolveRecipient,
  MAIL_STAGES,
} = await import('../netlify/functions/_verificationEmails.mjs');
const { buildAdminAlert, shortAddress } = await import('../netlify/functions/_verificationAlerts.mjs');
const { derivedStatus, summarise } = await import('../netlify/functions/verification-admin-orders.mjs');
const { grantTimedBonus } = await import('../netlify/functions/_entitlementsStore.mjs');
const { ORDER_STATUS } = await import('../netlify/functions/_verificationOrders.mjs');
const { renderReceiptHtml } = await import('../netlify/functions/receipt-page.mjs');

function order(overrides = {}) {
  return {
    id: 'vo-1753000000000-abcdef12',
    chain: 'solana',
    contract: 'So11111111111111111111111111111111111111112',
    contractKey: 'solana:So11111111111111111111111111111111111111112',
    projectId: '',
    tierId: 'verified',
    usd: 149,
    status: ORDER_STATUS.ACTIVE,
    buyerSubject: 'u:u1',
    ownerWallet: 'Owner11111111111111111111111111111111111111',
    ownershipMethod: 'mint_authority',
    paymentSignature: 'sig-abc',
    paymentCurrency: 'USDC',
    amountPaid: 149,
    paidAt: '2026-07-20T09:00:00.000Z',
    activatedAt: '2026-07-20T09:05:00.000Z',
    expiresAt: '2027-07-20T09:05:00.000Z',
    createdAt: '2026-07-20T08:00:00.000Z',
    ...overrides,
  };
}

function reset() {
  stores.clear();
  sent.length = 0;
  sendResult = { ok: true };
}

// ── Receipts ────────────────────────────────────────────────────────────────

test('the receipt carries every field the requirement lists', async () => {
  const receipt = buildReceipt(order(), { origin: 'https://khantrust.net' });
  for (const key of [
    'orderId', 'chain', 'contract', 'tier', 'amount', 'currency',
    'transactionSignature', 'payerWallet', 'paidAt', 'activatedAt', 'expiresAt',
    'statusAtIssue', 'profileUrl', 'badgeUrl', 'receiptNumber',
  ]) {
    assert.ok(receipt[key] !== undefined && receipt[key] !== '', `receipt is missing ${key}`);
  }
  assert.match(receipt.profileUrl, /\/t\/solana\//);
});

test('the receipt number is deterministic, so a retry produces the same one', () => {
  const a = receiptNumber('vo-1', '2026-07-20T00:00:00Z');
  const b = receiptNumber('vo-1', '2026-07-20T00:00:00Z');
  assert.equal(a, b);
  assert.notEqual(a, receiptNumber('vo-2', '2026-07-20T00:00:00Z'));
  assert.match(a, /^KT-2026-[0-9A-Z]{8}$/);
});

test('the receipt never carries internal fields', () => {
  const receipt = buildReceipt(order({ badgeToken: 'secret-token', adminNote: 'private note' }), { origin: 'https://khantrust.net' });
  const serialised = JSON.stringify(receipt);
  // A receipt is forwarded to accountants and pasted into tickets.
  assert.doesNotMatch(serialised, /secret-token/);
  assert.doesNotMatch(serialised, /private note/);
  assert.equal(receipt.buyerSubject, undefined);
});

test('receipt generation is write-once — a retry returns the original untouched', async () => {
  reset();
  const first = await ensureReceipt(order(), { origin: 'https://khantrust.net' });
  assert.equal(first.created, true);

  // A LATER, degraded view of the order (after expiry) must not replace the
  // record of what was actually sold.
  const second = await ensureReceipt(order({ status: ORDER_STATUS.EXPIRED }), { origin: 'https://khantrust.net' });
  assert.equal(second.created, false);
  assert.equal(second.receipt.statusAtIssue, ORDER_STATUS.ACTIVE);
  assert.equal(second.receipt.receiptNumber, first.receipt.receiptNumber);
});

test('the stored receipt is readable back by order id', async () => {
  reset();
  await ensureReceipt(order(), { origin: 'https://khantrust.net' });
  const stored = await getReceipt(order().id);
  assert.equal(stored.orderId, order().id);
});

test('knowing an order id is not enough to read its receipt', () => {
  const o = order();
  // Order ids are `vo-<epoch-ms>-<8 chars>`; the timestamp half is guessable
  // from a PUBLIC verification date.
  assert.equal(canViewReceipt({ order: o }), false);
  assert.equal(canViewReceipt({ order: o, accountSubject: 'u:someone-else' }), false);
  assert.equal(canViewReceipt({ order: o, wallet: 'SomeOtherWallet' }), false);

  assert.equal(canViewReceipt({ order: o, accountSubject: 'u:u1' }), true);
  assert.equal(canViewReceipt({ order: o, wallet: o.ownerWallet }), true);
  assert.equal(canViewReceipt({ order: o, isAdmin: true }), true);
});

test('a missing order is never viewable, even by an authenticated user', () => {
  assert.equal(canViewReceipt({ order: null, accountSubject: 'u:u1' }), false);
});

test('the printable receipt is noindex, no-store and says where the LIVE status is', () => {
  const receipt = buildReceipt(order(), { origin: 'https://khantrust.net' });
  const html = renderReceiptHtml(receipt, { origin: 'https://khantrust.net' });
  assert.match(html, /<meta name="robots" content="noindex/);
  assert.match(html, /never rewritten/);
  assert.match(html, /public profile/);
  assert.match(html, /window\.print\(\)/);
  assert.match(html, new RegExp(receipt.receiptNumber));
});

// ── Email idempotency ───────────────────────────────────────────────────────

test('a transactional email is sent exactly once, however often the job runs', async () => {
  reset();
  const o = order();
  const first = await sendVerificationEmailOnce({ order: o, stage: MAIL_STAGES.ACTIVATED });
  const second = await sendVerificationEmailOnce({ order: o, stage: MAIL_STAGES.ACTIVATED });
  const third = await sendVerificationEmailOnce({ order: o, stage: MAIL_STAGES.ACTIVATED });

  assert.equal(first.ok, true);
  assert.equal(second.skipped, 'already_sent');
  assert.equal(third.skipped, 'already_sent');
  assert.equal(sent.length, 1, `expected one send, got ${sent.length}`);
});

test('different stages for one order are different emails', async () => {
  reset();
  const o = order();
  await sendVerificationEmailOnce({ order: o, stage: MAIL_STAGES.PAYMENT_CONFIRMED });
  await sendVerificationEmailOnce({ order: o, stage: MAIL_STAGES.ACTIVATED });
  assert.equal(sent.length, 2);
});

test('the ledger is written only AFTER the provider accepts', async () => {
  reset();
  sendResult = { ok: false, reason: 'provider_error' };
  const o = order();
  const failed = await sendVerificationEmailOnce({ order: o, stage: MAIL_STAGES.ACTIVATED });

  assert.equal(failed.ok, false);
  assert.equal(failed.retryable, true);
  // A provider outage must not silently consume the customer's one send.
  assert.equal(await wasSent(o.id, MAIL_STAGES.ACTIVATED), false);

  sendResult = { ok: true };
  const retried = await sendVerificationEmailOnce({ order: o, stage: MAIL_STAGES.ACTIVATED });
  assert.equal(retried.ok, true);
  // Two ATTEMPTS reached the provider — the rejected one and the accepted one —
  // but only the second was a delivery, and the ledger now closes the stage so a
  // third attempt cannot happen.
  assert.equal(sent.length, 2, 'expected one rejected attempt plus one accepted');
  assert.equal(await wasSent(o.id, MAIL_STAGES.ACTIVATED), true);

  const third = await sendVerificationEmailOnce({ order: o, stage: MAIL_STAGES.ACTIVATED });
  assert.equal(third.skipped, 'already_sent');
  assert.equal(sent.length, 2, 'the customer must never receive a second copy');
});

test('a wallet-only buyer is "no recipient", not a failure that fills the dead-letter shelf', async () => {
  reset();
  const o = order({ buyerSubject: 'SomeWalletAddress111111111111111111111111' });
  const result = await sendVerificationEmailOnce({ order: o, stage: MAIL_STAGES.ACTIVATED });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, 'no_recipient');
  assert.equal(result.retryable, undefined);
  assert.equal(sent.length, 0);
});

test('a missing email provider is not retried five times over half an hour', async () => {
  reset();
  sendResult = { ok: false, reason: 'missing_api_key' };
  const result = await sendVerificationEmailOnce({ order: order(), stage: MAIL_STAGES.ACTIVATED });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, 'not_configured');
});

test('resolveRecipient distinguishes "no inbox" from "we could not look"', async () => {
  reset();
  assert.equal((await resolveRecipient(order({ buyerSubject: '' }))).reason, 'no_recipient');
  assert.equal((await resolveRecipient(order({ buyerSubject: 'u:u1' }))).email, 'owner@example.com');
  // An account that no longer exists is genuinely no recipient.
  assert.equal((await resolveRecipient(order({ buyerSubject: 'u:missing' }))).reason, 'no_recipient');
});

test('every lifecycle email has a subject that names the token and the action', () => {
  for (const stage of Object.values(MAIL_STAGES)) {
    const mail = buildMail(stage, { order: order(), days: 7, renewUrl: 'https://x', profileUrl: 'https://y', badgeUrl: 'https://z' });
    assert.ok(mail, `no template for ${stage}`);
    assert.ok(mail.subject.trim().length > 10, `${stage} has a weak subject`);
    assert.ok(mail.html.includes('KHAN Trust'), `${stage} is unbranded`);
  }
});

test('lifecycle mail carries no unsubscribe link — it is transactional, not bulk', () => {
  // A customer cannot opt out of being told their paid product is about to
  // lapse; offering an unsubscribe would silence the only warning they get.
  const mail = buildMail(MAIL_STAGES.EXPIRING_7, { order: order(), days: 7, renewUrl: 'https://x' });
  assert.doesNotMatch(mail.html, /unsubscribe/i);
});

test('the expiry ladder names the number of days in the subject', () => {
  assert.match(buildMail(MAIL_STAGES.EXPIRING_30, { order: order(), days: 30 }).subject, /30 days/);
  assert.match(buildMail(MAIL_STAGES.EXPIRING_7, { order: order(), days: 7 }).subject, /7 days/);
  assert.match(buildMail(MAIL_STAGES.EXPIRING_1, { order: order(), days: 1 }).subject, /1 day\b/);
});

// ── Telegram redaction ──────────────────────────────────────────────────────

test('an admin alert never carries a transaction signature or a full wallet', () => {
  for (const kind of ['order_paid', 'ownership_review', 'activated', 'expired', 'revoked', 'duplicate_sale']) {
    const text = buildAdminAlert(kind, { order: order(), days: 1 });
    assert.ok(text, `no builder for ${kind}`);
    // The destination may be a team group: no access control we administer,
    // indefinite retention, fully searchable.
    assert.doesNotMatch(text, /sig-abc/, `${kind} leaked the payment signature`);
    assert.doesNotMatch(text, /Owner11111111111111111111111111111111111111/, `${kind} leaked the full wallet`);
    assert.doesNotMatch(text, /owner@example\.com/, `${kind} leaked an email`);
    assert.doesNotMatch(text, /u:u1/, `${kind} leaked the buyer subject`);
  }
});

test('a truncated address is matchable by an operator but not identifying', () => {
  assert.equal(shortAddress('Owner11111111111111111111111111111111111111'), 'Owne…1111');
  assert.equal(shortAddress(''), '—');
  assert.equal(shortAddress('short'), 'short');
});

test('the dead-letter alert points at the console rather than embedding the payload', () => {
  const text = buildAdminAlert('dead_letter', { type: 'mail.send', jobId: 'job-1', attempts: 5, lastError: 'boom' });
  assert.match(text, /job-1/);
  assert.match(text, /console/);
});

// ── Expiry transitions ──────────────────────────────────────────────────────

test('an order past its expiry reports as expired even before the sweep runs', () => {
  // The badge derives expiry from the clock; the admin screen must agree with
  // the badge, not with the sweep's last run.
  const lapsed = order({ status: ORDER_STATUS.ACTIVE, expiresAt: '2020-01-01T00:00:00.000Z' });
  assert.equal(derivedStatus(lapsed, Date.now()), ORDER_STATUS.EXPIRED);
});

test('an order with no expiry stays active forever (pre-paid admin approval)', () => {
  const permanent = order({ status: ORDER_STATUS.ACTIVE, expiresAt: '' });
  assert.equal(derivedStatus(permanent, Date.now()), ORDER_STATUS.ACTIVE);
});

test('a revoked order is never resurrected by the clock', () => {
  const revoked = order({ status: ORDER_STATUS.REVOKED, expiresAt: '2099-01-01T00:00:00.000Z' });
  assert.equal(derivedStatus(revoked, Date.now()), ORDER_STATUS.REVOKED);
});

test('revenue counts money that changed hands, including later-revoked orders', () => {
  const now = Date.now();
  const summary = summarise([
    order({ id: 'a', status: ORDER_STATUS.ACTIVE }),
    order({ id: 'b', status: ORDER_STATUS.REVOKED }),
    order({ id: 'c', status: ORDER_STATUS.PENDING_PAYMENT, paymentSignature: '' }),
    order({ id: 'd', status: ORDER_STATUS.REFUNDED }),
  ], now);
  // a + b are paid and not refunded; c never paid; d was returned.
  assert.equal(summary.revenue, 298);
});

test('expiring-soon counts only what is still active', () => {
  const now = Date.parse('2026-07-29T00:00:00Z');
  const summary = summarise([
    order({ id: 'a', status: ORDER_STATUS.ACTIVE, expiresAt: '2026-08-10T00:00:00Z' }),
    order({ id: 'b', status: ORDER_STATUS.ACTIVE, expiresAt: '2027-08-10T00:00:00Z' }),
    order({ id: 'c', status: ORDER_STATUS.REVOKED, expiresAt: '2026-08-10T00:00:00Z' }),
  ], now);
  assert.equal(summary.expiringSoon, 1);
});

// ── The Premium bonus ───────────────────────────────────────────────────────

test('the Premium bonus is granted exactly once and never shortens an existing plan', async () => {
  reset();
  const subject = 'u:u1';
  const expiry = new Date(Date.now() + 90 * 86400000).toISOString();

  const first = await grantTimedBonus(subject, { plan: 'premium', expiresAt: expiry, source: 'verification_bonus' });
  assert.equal(first.granted, true);

  // A retried activation must not extend it again.
  const second = await grantTimedBonus(subject, { plan: 'premium', expiresAt: expiry, source: 'verification_bonus' });
  assert.equal(second.granted, false);
  assert.equal(second.reason, 'existing_expiry_is_later');
});

test('a monthly subscriber is never downgraded to a 90-day bonus', async () => {
  reset();
  const { grantEntitlement } = await import('../netlify/functions/_entitlementsStore.mjs');
  await grantEntitlement('u:sub', { plan: 'premium' }); // no expiresAt = unlimited

  const result = await grantTimedBonus('u:sub', {
    plan: 'premium',
    expiresAt: new Date(Date.now() + 90 * 86400000).toISOString(),
  });
  assert.equal(result.granted, false);
  assert.equal(result.reason, 'already_unlimited');
});

test('an Early Supporter receiving the bonus keeps being an Early Supporter', async () => {
  reset();
  const { grantEntitlement, getEntitlement } = await import('../netlify/functions/_entitlementsStore.mjs');
  await grantEntitlement('u:es', { plan: 'early_supporter', expiresAt: new Date(Date.now() + 86400000).toISOString() });

  await grantTimedBonus('u:es', { plan: 'premium', expiresAt: new Date(Date.now() + 90 * 86400000).toISOString() });
  const after = await getEntitlement('u:es');
  assert.equal(after.plan, 'early_supporter');
});
