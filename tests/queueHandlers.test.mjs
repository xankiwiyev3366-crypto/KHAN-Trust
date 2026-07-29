// Phase 5 — the queue handlers, and specifically the two that are easiest to
// get subtly and expensively wrong:
//
//   watch.enroll  must ADD the verified owner's token, never toggle it. Using
//                 toggleToken() here would mean a retried job silently
//                 UN-watches the one token the customer most wanted watched.
//   watch.status  must reach free users on a REVOCATION. Gating that behind
//                 Premium would monetise the exact harm the product prevents.
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
    sendEmail: async () => ({ ok: true }),
    isEmailConfigured: () => true,
    getAdminNotifyEmail: () => '',
    sendVerificationEmail: async () => ({ ok: true }),
  },
});
mock.module('../netlify/functions/_authStore.mjs', {
  namedExports: {
    getUserById: async (id) => ({ id, email: `${id}@example.com`, name: id }),
    verifyJwt: () => null,
    bearerToken: () => '',
    jsonResponse: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
  },
});

// Tier resolution is the Premium gate. Mocked so a test can say plainly who is
// premium and who is not.
let tiers = new Map();
mock.module('../netlify/functions/_watchTiers.mjs', {
  namedExports: {
    TIER: { FREE: 'free', PREMIUM: 'premium' },
    resolveUserTier: async (userId) => tiers.get(userId) || 'free',
    MAX_WATCHED_TOKENS: { free: 5, premium: 100 },
  },
});

const { runJob, JOB_TYPES } = await import('../netlify/functions/_queueHandlers.mjs');
const { getSubscription, saveSubscription } = await import('../netlify/functions/_alertsStore.mjs');
const { listNotifications } = await import('../netlify/functions/_notificationStore.mjs');
const { putOrder, ORDER_STATUS } = await import('../netlify/functions/_verificationOrders.mjs');
const { PROFILE_VERIFICATION } = await import('../src/lib/publicProfile.js');

const SOL = 'So11111111111111111111111111111111111111112';
const IDENTITY = `c:${SOL.toLowerCase()}`;

function reset() {
  stores.clear();
  tiers = new Map();
}

async function seedOrder(overrides = {}) {
  const order = {
    id: 'vo-1',
    chain: 'solana',
    contract: SOL,
    contractKey: `solana:${SOL}`,
    tierId: 'verified',
    usd: 149,
    status: ORDER_STATUS.ACTIVE,
    buyerSubject: 'u:owner',
    ownerWallet: 'Owner1111',
    paymentSignature: 'sig-1',
    createdAt: '2026-07-20T00:00:00Z',
    activatedAt: '2026-07-20T00:05:00Z',
    expiresAt: '2027-07-20T00:05:00Z',
    ...overrides,
  };
  await putOrder(order);
  return order;
}

const job = (type, payload) => ({ type, payload });

// ── watch.enroll ────────────────────────────────────────────────────────────

test('a verified owner is enrolled into Watchtower automatically', async () => {
  reset();
  await seedOrder();
  const result = await runJob(job(JOB_TYPES.WATCH_ENROLL, { orderId: 'vo-1' }));

  assert.equal(result.ok, true);
  assert.equal(result.reason, 'enrolled');
  const sub = await getSubscription('owner');
  assert.equal(sub.tokens.length, 1);
  assert.equal(sub.tokens[0].identity, IDENTITY);
});

test('a retried enrolment does NOT un-watch the token', async () => {
  reset();
  await seedOrder();
  await runJob(job(JOB_TYPES.WATCH_ENROLL, { orderId: 'vo-1' }));
  const second = await runJob(job(JOB_TYPES.WATCH_ENROLL, { orderId: 'vo-1' }));

  assert.equal(second.ok, true);
  assert.equal(second.reason, 'already_watching');
  // The failure this locks in: toggleToken() would have REMOVED it here.
  const sub = await getSubscription('owner');
  assert.equal(sub.tokens.length, 1, 'the retry removed the token');
});

test('an owner who was already watching the token keeps their own entry', async () => {
  reset();
  await seedOrder();
  await saveSubscription({ userId: 'owner', email: '', tokens: [{ identity: IDENTITY, name: 'My Token' }], lastNotified: {} });

  await runJob(job(JOB_TYPES.WATCH_ENROLL, { orderId: 'vo-1' }));
  const sub = await getSubscription('owner');
  assert.equal(sub.tokens.length, 1);
  assert.equal(sub.tokens[0].name, 'My Token', 'the owner’s own metadata was overwritten');
});

test('a wallet-only buyer has no account to enrol, and that is not a failure', async () => {
  reset();
  await seedOrder({ buyerSubject: 'SomeWalletAddress' });
  const result = await runJob(job(JOB_TYPES.WATCH_ENROLL, { orderId: 'vo-1' }));
  assert.equal(result.ok, true);
  assert.equal(result.reason, 'no_account');
  assert.equal(result.retryable, false);
});

test('a job for a missing order fails terminally, not retryably', async () => {
  reset();
  const result = await runJob(job(JOB_TYPES.WATCH_ENROLL, { orderId: 'vo-missing' }));
  assert.equal(result.ok, false);
  // Retrying cannot make the order appear; it would just delay the dead-letter
  // that tells an operator about the orphan.
  assert.equal(result.retryable, false);
});

// ── watch.status ────────────────────────────────────────────────────────────

async function seedWatcher(userId, tier) {
  tiers.set(userId, tier);
  await saveSubscription({ userId, email: `${userId}@example.com`, tokens: [{ identity: IDENTITY, name: 'Tok' }], lastNotified: {} });
}

test('a Premium watcher is told when a watched token becomes verified', async () => {
  reset();
  await seedWatcher('premiumUser', 'premium');

  const result = await runJob(job(JOB_TYPES.WATCH_STATUS, {
    chain: 'solana', contract: SOL, state: PROFILE_VERIFICATION.ACTIVE, at: '2026-07-29T00:00:00Z',
  }));
  assert.equal(result.ok, true);

  const notifications = await listNotifications('premiumUser');
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].type, 'verification_status');
  assert.equal(notifications[0].titleKey, 'notifications.verificationActive.title');
});

test('a free watcher is NOT told about the positive transition', async () => {
  reset();
  await seedWatcher('freeUser', 'free');
  await runJob(job(JOB_TYPES.WATCH_STATUS, {
    chain: 'solana', contract: SOL, state: PROFILE_VERIFICATION.ACTIVE, at: '2026-07-29T00:00:00Z',
  }));
  assert.equal((await listNotifications('freeUser')).length, 0);
});

test('a free watcher IS told about a REVOCATION', async () => {
  reset();
  await seedWatcher('freeUser', 'free');
  await runJob(job(JOB_TYPES.WATCH_STATUS, {
    chain: 'solana', contract: SOL, state: PROFILE_VERIFICATION.REVOKED, at: '2026-07-29T00:00:00Z',
  }));

  const notifications = await listNotifications('freeUser');
  // Withholding "this token's verification was withdrawn" in order to sell an
  // upgrade would monetise the exact harm the product claims to prevent.
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].severity, 'critical');
  assert.equal(notifications[0].titleKey, 'notifications.verificationRevoked.title');
});

test('the notification is deduplicated, so a re-run job does not double-notify', async () => {
  reset();
  await seedWatcher('premiumUser', 'premium');
  const payload = { chain: 'solana', contract: SOL, state: PROFILE_VERIFICATION.EXPIRED, at: '2026-07-29T00:00:00Z' };

  await runJob(job(JOB_TYPES.WATCH_STATUS, payload));
  await runJob(job(JOB_TYPES.WATCH_STATUS, payload));
  await runJob(job(JOB_TYPES.WATCH_STATUS, payload));

  assert.equal((await listNotifications('premiumUser')).length, 1);
});

test('nobody watching means nothing to do, not an error', async () => {
  reset();
  const result = await runJob(job(JOB_TYPES.WATCH_STATUS, {
    chain: 'solana', contract: SOL, state: PROFILE_VERIFICATION.REVOKED, at: '2026-07-29T00:00:00Z',
  }));
  assert.equal(result.ok, true);
  assert.equal(result.reason, 'no_watchers');
});

test('an unknown state is refused rather than delivered as something else', async () => {
  reset();
  await seedWatcher('premiumUser', 'premium');
  const result = await runJob(job(JOB_TYPES.WATCH_STATUS, { chain: 'solana', contract: SOL, state: 'pending' }));
  assert.equal(result.ok, false);
  assert.equal(result.retryable, false);
});

// ── Dispatch ────────────────────────────────────────────────────────────────

test('an unknown job type is terminal, never retried five times', async () => {
  reset();
  const result = await runJob(job('does.not.exist', {}));
  assert.equal(result.ok, false);
  assert.equal(result.retryable, false);
  assert.equal(result.reason, 'unknown_job_type');
});

test('a receipt job is idempotent across retries', async () => {
  reset();
  await seedOrder();
  const first = await runJob(job(JOB_TYPES.RECEIPT_ENSURE, { orderId: 'vo-1' }));
  const second = await runJob(job(JOB_TYPES.RECEIPT_ENSURE, { orderId: 'vo-1' }));

  assert.equal(first.ok, true);
  assert.equal(first.created, true);
  assert.equal(second.ok, true);
  assert.equal(second.created, false);
});

test('a receipt is generated for a PAID order too, not only an active one', async () => {
  reset();
  // The customer parted with money and is entitled to proof of that now, not
  // conditionally on a review whose timing they do not control.
  await seedOrder({ status: ORDER_STATUS.PAID, activatedAt: '', expiresAt: '' });
  const result = await runJob(job(JOB_TYPES.RECEIPT_ENSURE, { orderId: 'vo-1' }));
  assert.equal(result.ok, true);
});

test('a receipt is refused for an order that never paid', async () => {
  reset();
  await seedOrder({ status: ORDER_STATUS.PENDING_PAYMENT, paymentSignature: '', activatedAt: '', expiresAt: '' });
  const result = await runJob(job(JOB_TYPES.RECEIPT_ENSURE, { orderId: 'vo-1' }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not_paid');
  assert.equal(result.retryable, false);
});
