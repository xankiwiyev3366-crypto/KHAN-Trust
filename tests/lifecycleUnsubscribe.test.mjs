// The unsubscribe endpoint, end to end.
//
// The token module's own tests prove the capability cannot be forged. These
// prove the endpoint spends it correctly — which is a different problem, and
// the one with the reputational failure modes: a bulk sender whose one-click
// POST 405s is a bulk sender Gmail stops delivering, and an undo that a link
// scanner can trigger is an undo that decides the user's preference for them.
//
// Run with: node --experimental-test-module-mocks --test (see npm test).
process.env.LIFECYCLE_UNSUBSCRIBE_SECRET = 'test-secret-not-a-real-one';

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// The user table, in memory. `updates` records every write so the tests can
// assert on writes NOT happening, which is most of the point here.
const users = new Map();
const updates = [];
const growth = [];

mock.module('../netlify/functions/_authStore.mjs', {
  namedExports: {
    getUserById: async (id) => (users.has(id) ? { ...users.get(id) } : null),
    updateUser: async (id, patch) => {
      updates.push({ id, patch });
      if (users.has(id)) users.set(id, { ...users.get(id), ...patch });
      return users.get(id);
    },
  },
});

mock.module('../netlify/functions/_growthRecord.mjs', {
  namedExports: {
    recordLifecycleUnsubscribed: async (payload) => { growth.push({ type: 'unsubscribed', ...payload }); },
    recordLifecycleResubscribed: async (payload) => { growth.push({ type: 'resubscribed', ...payload }); },
  },
});

const { handler } = await import('../netlify/functions/lifecycle-unsubscribe.mjs');
const { unsubscribeTokenFor, resubscribeTokenFor } = await import('../netlify/functions/_lifecycleToken.mjs');

function reset() {
  users.clear();
  updates.length = 0;
  growth.length = 0;
  users.set('u1', { id: 'u1', email: 'a@b.com', emailOptOut: false });
}

const get = (query) => handler({ httpMethod: 'GET', queryStringParameters: query });
const post = (query) => handler({ httpMethod: 'POST', queryStringParameters: query });

const UNSUB = () => unsubscribeTokenFor({ id: 'u1' });
const RESUB = () => resubscribeTokenFor({ id: 'u1' });

// ── Unsubscribing ────────────────────────────────────────────────────────────

test('a clicked link opts the user out and confirms it', async () => {
  reset();
  const res = await get({ token: UNSUB() });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Unsubscribed/);
  assert.equal(users.get('u1').emailOptOut, true);
  assert.equal(growth.filter((g) => g.type === 'unsubscribed').length, 1);
});

// RFC 8058. This is the one Gmail and Yahoo actually exercise, and the previous
// implementation answered it with 405.
test('the one-click POST works and returns a bare acknowledgement', async () => {
  reset();
  const res = await post({ token: UNSUB() });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, '', 'nothing is rendering this — a body would be noise');
  assert.equal(users.get('u1').emailOptOut, true);
});

test('an unrecognised one-click POST is acknowledged, not diagnosed', async () => {
  reset();
  const res = await post({ token: 'u1.deadbeef' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, '');
  assert.equal(updates.length, 0, 'a forged token must never cause a write');
  assert.equal(growth.length, 0);
});

test('re-clicking the same link does not write again', async () => {
  reset();
  await get({ token: UNSUB() });
  assert.equal(updates.length, 1);
  await get({ token: UNSUB() });
  assert.equal(updates.length, 1, 'already opted out — nothing changed, so nothing is written');
  assert.equal(growth.length, 1, 'and the event is not double-counted');
});

test('an unknown user still reports success rather than an error page', async () => {
  reset();
  users.delete('u1');
  const res = await get({ token: UNSUB() });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Unsubscribed/);
});

test('the confirmation states that watched-token risk alerts are unaffected', async () => {
  reset();
  const res = await get({ token: UNSUB() });
  assert.match(res.body, /Risk alerts .*are still active/s);
});

// ── The way back, and why it cannot be prefetched ────────────────────────────

// THE PROPERTY: a mail client that follows every URL in the page must not be
// able to undo the unsubscribe it just triggered. Only a real click can.
test('the undo is offered as a POST form, never as a followable link', async () => {
  reset();
  const res = await get({ token: UNSUB() });
  assert.match(res.body, /<form method="POST"/, 'the undo must require a submit');
  assert.match(res.body, /action=resubscribe/);
  assert.doesNotMatch(res.body, /<a[^>]+action=resubscribe/, 'never reachable by following a link');
});

test('a resubscribe URL opened as a GET changes nothing', async () => {
  reset();
  await get({ token: UNSUB() });
  const before = updates.length;

  const res = await get({ token: RESUB(), action: 'resubscribe' });
  assert.equal(res.statusCode, 200);
  assert.equal(users.get('u1').emailOptOut, true, 'still opted out — a prefetch must not undo it');
  assert.equal(updates.length, before, 'no write at all');
});

test('submitting the undo form opts the user back in', async () => {
  reset();
  await get({ token: UNSUB() });
  assert.equal(users.get('u1').emailOptOut, true);

  const res = await post({ token: RESUB(), action: 'resubscribe' });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Subscribed again/);
  assert.equal(users.get('u1').emailOptOut, false);
  assert.equal(growth.filter((g) => g.type === 'resubscribed').length, 1);
});

test('an unsubscribe token cannot be spent as a resubscribe', async () => {
  reset();
  await get({ token: UNSUB() });
  const res = await post({ token: UNSUB(), action: 'resubscribe' });
  assert.match(res.body, /not valid/);
  assert.equal(users.get('u1').emailOptOut, true, 'the wrong capability changes nothing');
});

// ── Everything else ──────────────────────────────────────────────────────────

test('other HTTP methods are refused', async () => {
  reset();
  const res = await handler({ httpMethod: 'DELETE', queryStringParameters: { token: UNSUB() } });
  assert.equal(res.statusCode, 405);
  assert.equal(updates.length, 0);
});

test('the result page is not indexable', async () => {
  reset();
  const res = await get({ token: UNSUB() });
  assert.match(res.body, /noindex/);
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

// With no secret the tokens would be forgeable, so the endpoint must refuse to
// act rather than act on anything it is handed.
test('with no secret configured, nothing is actioned', async () => {
  reset();
  const saved = process.env.LIFECYCLE_UNSUBSCRIBE_SECRET;
  const savedJwt = process.env.JWT_SECRET;
  delete process.env.LIFECYCLE_UNSUBSCRIBE_SECRET;
  delete process.env.JWT_SECRET;
  try {
    const res = await get({ token: 'anything' });
    assert.match(res.body, /cannot be changed right now/);
    assert.equal(updates.length, 0);
  } finally {
    process.env.LIFECYCLE_UNSUBSCRIBE_SECRET = saved;
    if (savedJwt !== undefined) process.env.JWT_SECRET = savedJwt;
  }
});
