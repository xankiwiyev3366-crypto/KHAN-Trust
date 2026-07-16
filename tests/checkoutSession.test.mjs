// Tests for card checkout after the wallet requirement was removed.
//
// The line this file exists to defend:
//
//   if (!wallet) return { reason: 'wallet_required', ... }
//
// That refused to take anyone's money until they connected a Solana wallet,
// which meant the platform asked people frightened of wallet risk to connect a
// wallet in order to buy protection from wallet risk. It was a named, measured
// drop-off in the funnel. It is gone, and these tests make sure it cannot come
// back by accident.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.AUTH_SECRET = 'test-secret-for-checkout-tests';
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_PREMIUM_PRICE_ID = 'price_premium';
process.env.STRIPE_SUPPORTER_PRICE_ID = 'price_supporter';
process.env.URL = 'https://khantrust.net';

// Captures what would have been sent to Stripe.
const created = [];
class FakeStripe {
  constructor() {
    this.checkout = {
      sessions: {
        create: async (params) => {
          created.push(params);
          return { url: 'https://checkout.stripe.com/session', id: 'cs_test_1' };
        },
      },
    };
  }
}
mock.module('stripe', { defaultExport: FakeStripe });

mock.module('../netlify/functions/_blobsClient.mjs', {
  namedExports: {
    getNamedStore: () => ({ get: async () => null, setJSON: async () => {}, list: async () => ({ blobs: [] }) }),
    jsonResponse: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
  },
});

const { issueToken } = await import('../netlify/functions/_authStore.mjs');
const { handler } = await import('../netlify/functions/create-stripe-checkout-session.mjs');

const USER = { id: 'user-123', email: 'buyer@example.com', name: 'Buyer' };
const WALLET = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

const post = (payload, { user } = {}) => ({
  httpMethod: 'POST',
  headers: { ...(user ? { authorization: `Bearer ${issueToken(user)}` } : {}) },
  body: JSON.stringify(payload),
});
const body = (res) => JSON.parse(res.body);

function reset() { created.length = 0; }

// ── THE fix ───────────────────────────────────────────────────────────────────

test('checkout works with NO wallet at all', async () => {
  // The entire point of this step.
  reset();
  const res = await handler(post({ plan: 'premium' }, { user: USER }));

  assert.equal(res.statusCode, 200);
  assert.ok(body(res).url, 'a signed-in user with no wallet must reach Stripe');
  assert.equal(created.length, 1);
});

test('the purchase subject is the ACCOUNT', async () => {
  reset();
  await handler(post({ plan: 'premium' }, { user: USER }));

  const session = created[0];
  assert.equal(session.client_reference_id, 'u:user-123', 'the webhook grants to whatever this says');
  assert.equal(session.metadata.subject, 'u:user-123');
  assert.equal(session.metadata.userId, 'user-123');
});

test("'wallet_required' is never returned again", async () => {
  reset();
  const res = await handler(post({ plan: 'premium' }, { user: USER }));
  assert.notEqual(body(res).reason, 'wallet_required');
});

test('the account email is prefilled so there is one less field to type', async () => {
  reset();
  await handler(post({ plan: 'premium' }, { user: USER }));
  assert.equal(created[0].customer_email, 'buyer@example.com');
});

// ── Auth ──────────────────────────────────────────────────────────────────────

test('checkout without signing in is refused', async () => {
  reset();
  const res = await handler(post({ plan: 'premium' }));

  assert.equal(res.statusCode, 401);
  assert.equal(body(res).reason, 'sign_in_required');
  assert.equal(created.length, 0, 'no Stripe session may be created for an anonymous caller');
});

test('a user id in the BODY is ignored — only the JWT decides', async () => {
  // Otherwise anyone could mint a session that attaches their card, and their
  // cancellation, to a stranger's entitlement.
  reset();
  const res = await handler(post({ plan: 'premium', userId: 'victim-999', subject: 'u:victim-999' }, { user: USER }));

  assert.equal(res.statusCode, 200);
  assert.equal(created[0].client_reference_id, 'u:user-123', 'the body must not be able to redirect the grant');
  assert.equal(created[0].metadata.userId, 'user-123');
});

test('a forged token cannot start checkout', async () => {
  reset();
  const res = await handler({ httpMethod: 'POST', headers: { authorization: 'Bearer forged.token.here' }, body: '{}' });
  assert.equal(res.statusCode, 401);
  assert.equal(created.length, 0);
});

// ── Wallet is optional metadata ───────────────────────────────────────────────

test('a supplied wallet rides along as metadata, never as the key', async () => {
  reset();
  await handler(post({ plan: 'premium', wallet: WALLET }, { user: USER }));

  assert.equal(created[0].client_reference_id, 'u:user-123', 'the account is still the subject');
  assert.equal(created[0].metadata.wallet, WALLET, 'the wallet is kept for wallet-specific features');
});

test('a malformed wallet is dropped rather than failing the sale', async () => {
  // Refusing money over a metadata field would recreate the friction in a new
  // shape.
  reset();
  const res = await handler(post({ plan: 'premium', wallet: 'not-a-real-address!!' }, { user: USER }));

  assert.equal(res.statusCode, 200, 'the sale must still go through');
  assert.equal(created[0].metadata.wallet, undefined, 'but garbage is not recorded');
});

// ── Plans ─────────────────────────────────────────────────────────────────────

test('subscription metadata is stamped so cancellations can be attributed', async () => {
  // customer.subscription.deleted arrives with SUBSCRIPTION metadata, not
  // session metadata. Without this the webhook could not tell whose plan ended.
  reset();
  await handler(post({ plan: 'premium' }, { user: USER }));

  assert.equal(created[0].mode, 'subscription');
  assert.equal(created[0].subscription_data.metadata.subject, 'u:user-123');
});

test('early supporter is a one-time payment and carries the same subject', async () => {
  reset();
  await handler(post({ plan: 'early_supporter' }, { user: USER }));

  assert.equal(created[0].mode, 'payment');
  assert.equal(created[0].line_items[0].price, 'price_supporter');
  assert.equal(created[0].client_reference_id, 'u:user-123');
  assert.equal(created[0].subscription_data, undefined, 'a one-time payment has no subscription');
});

test('an unknown plan falls back to premium rather than erroring', async () => {
  reset();
  await handler(post({ plan: 'enterprise_ultra' }, { user: USER }));
  assert.equal(created[0].line_items[0].price, 'price_premium');
});
