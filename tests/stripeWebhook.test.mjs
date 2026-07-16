// Tests for the webhook that turns money into access.
//
// The cutover risk this file covers: sessions created BEFORE the account change
// were keyed by wallet and may still be open in someone's browser tab when the
// new code deploys. If the webhook only understood account subjects, those
// people would pay and receive nothing — the worst possible bug in the worst
// possible place.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_fake';

let currentEvent = null;
class FakeStripe {
  constructor() {
    this.webhooks = {
      // The real thing verifies the signature. That is Stripe's code, not ours;
      // what we test is what we do with a verified event.
      constructEvent: () => currentEvent,
    };
  }
}
mock.module('stripe', { defaultExport: FakeStripe });

class FakeStore {
  constructor() { this.data = new Map(); }
  async setJSON(key, value) { this.data.set(key, JSON.parse(JSON.stringify(value))); }
  async get(key) { return this.data.has(key) ? JSON.parse(JSON.stringify(this.data.get(key))) : null; }
  async list({ prefix } = {}) {
    return { blobs: Array.from(this.data.keys()).filter((k) => !prefix || k.startsWith(prefix)).map((key) => ({ key })) };
  }
  async delete(key) { this.data.delete(key); }
}
const stores = new Map();
mock.module('../netlify/functions/_blobsClient.mjs', {
  namedExports: {
    getNamedStore: (name) => {
      if (!stores.has(name)) stores.set(name, new FakeStore());
      return stores.get(name);
    },
    jsonResponse: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
  },
});

const growthEvents = [];
mock.module('../netlify/functions/_growthRecord.mjs', {
  namedExports: {
    recordCheckoutCompleted: async (e) => { growthEvents.push(e); },
  },
});

const { handler } = await import('../netlify/functions/stripe-webhook.mjs');
const { getEntitlement, accountSubject } = await import('../netlify/functions/_entitlementsStore.mjs');

const WALLET = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

function reset() { stores.clear(); growthEvents.length = 0; }

const webhook = (event) => {
  currentEvent = event;
  return handler({ httpMethod: 'POST', headers: { 'stripe-signature': 'sig' }, body: '{}' });
};

const completed = (session) => ({ type: 'checkout.session.completed', data: { object: { amount_total: 900, ...session } } });

// ── Account purchases ─────────────────────────────────────────────────────────

test('an account purchase grants to the account subject', async () => {
  reset();
  await webhook(completed({
    client_reference_id: 'u:user-123',
    metadata: { subject: 'u:user-123', userId: 'user-123', plan: 'premium' },
    customer: 'cus_1',
    subscription: 'sub_1',
    id: 'cs_1',
  }));

  const ent = await getEntitlement(accountSubject('user-123'));
  assert.ok(ent, 'the account must now have an entitlement');
  assert.equal(ent.plan, 'premium');
  assert.equal(ent.userId, 'user-123');
  assert.equal(ent.stripeSubscriptionId, 'sub_1');
});

test('conversions are now attributable to a real user for the first time', async () => {
  // The old comment here said "the identity is a WALLET, not an auth user id"
  // and passed userId: null, honestly, because the platform could not know who
  // paid. Account checkout means it can.
  reset();
  await webhook(completed({
    client_reference_id: 'u:user-123',
    metadata: { subject: 'u:user-123', userId: 'user-123', plan: 'premium' },
  }));

  assert.equal(growthEvents.length, 1);
  assert.equal(growthEvents[0].userId, 'user-123');
  assert.equal(growthEvents[0].plan, 'premium');
});

// ── Legacy sessions still in flight ───────────────────────────────────────────

test('a LEGACY wallet session created before the deploy still grants', async () => {
  // Someone had the pricing page open when this shipped. Their session carries
  // a bare wallet as client_reference_id and no `subject`. They must not pay and
  // get nothing.
  reset();
  await webhook(completed({
    client_reference_id: WALLET,
    metadata: { wallet: WALLET, plan: 'premium' },
  }));

  const ent = await getEntitlement(WALLET);
  assert.ok(ent, 'a legacy in-flight session must still grant access');
  assert.equal(ent.plan, 'premium');
});

test('a legacy conversion reports no user id rather than inventing one', async () => {
  // The warehouse must never be handed an identity that was not established.
  reset();
  await webhook(completed({ client_reference_id: WALLET, metadata: { wallet: WALLET, plan: 'premium' } }));

  assert.equal(growthEvents[0].userId, null);
});

test('a session with no subject at all grants nothing and does not crash', async () => {
  reset();
  const res = await webhook(completed({ metadata: { plan: 'premium' } }));
  assert.equal(res.statusCode, 200, 'must still acknowledge, or Stripe retries forever');
  assert.equal(growthEvents.length, 0);
});

// ── Cancellation ──────────────────────────────────────────────────────────────

test('cancelling an ACCOUNT subscription revokes the account entitlement', async () => {
  // If this failed, a customer could stop paying and keep Premium forever.
  reset();
  await webhook(completed({
    client_reference_id: 'u:user-123',
    metadata: { subject: 'u:user-123', userId: 'user-123', plan: 'premium' },
    subscription: 'sub_1',
  }));
  assert.ok(await getEntitlement('u:user-123'));

  await webhook({
    type: 'customer.subscription.deleted',
    data: { object: { id: 'sub_1', metadata: { subject: 'u:user-123', userId: 'user-123' } } },
  });

  assert.equal(await getEntitlement('u:user-123'), null, 'access must end when payment does');
});

test('cancelling a LEGACY wallet subscription still revokes it', async () => {
  reset();
  await webhook(completed({ client_reference_id: WALLET, metadata: { wallet: WALLET, plan: 'premium' }, subscription: 'sub_legacy' }));
  assert.ok(await getEntitlement(WALLET));

  await webhook({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_legacy', metadata: { wallet: WALLET } } } });

  assert.equal(await getEntitlement(WALLET), null);
});

test('a cancellation with no metadata is resolved by scanning for the subscription id', async () => {
  // Older subscriptions predate `subject` in metadata entirely.
  reset();
  await webhook(completed({ client_reference_id: WALLET, metadata: { wallet: WALLET, plan: 'premium' }, subscription: 'sub_bare' }));

  await webhook({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_bare', metadata: {} } } });

  assert.equal(await getEntitlement(WALLET), null, 'the scan fallback must find it');
});

test('an unknown subscription id revokes nothing', async () => {
  reset();
  await webhook(completed({ client_reference_id: 'u:user-123', metadata: { subject: 'u:user-123', plan: 'premium' } }));

  await webhook({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_nonexistent', metadata: {} } } });

  assert.ok(await getEntitlement('u:user-123'), 'an unrelated cancellation must not touch anyone else');
});
