// Tests for the Bulk Premium Management endpoint, focused on the new
// "Grant 2 Months Premium" (60d) duration.
//
// Drives the REAL premium-admin-bulk-action handler and the REAL
// _premiumStore against a faked blob backend (same approach as
// tests/scanQuota.test.mjs). What is under test is the actual wiring:
// duration validation, computeExpiry math, and that both a single selected
// user and multiple selected users are written with the correct expiry.
import test from 'node:test';
import assert from 'node:assert/strict';

// Admin auth signs tokens from KHAN_ADMIN_PASSCODE; set it before importing.
process.env.KHAN_ADMIN_PASSCODE = 'test-admin-passcode';

class FakeStore {
  constructor() { this.data = new Map(); }
  async setJSON(key, value) { this.data.set(key, JSON.parse(JSON.stringify(value))); }
  async get(key) { return this.data.has(key) ? JSON.parse(JSON.stringify(this.data.get(key))) : null; }
  async delete(key) { this.data.delete(key); }
  async list({ prefix } = {}) {
    return { blobs: [...this.data.keys()].filter((k) => !prefix || k.startsWith(prefix)).map((key) => ({ key })) };
  }
}

const stores = new Map();
const storeFor = (name) => {
  if (!stores.has(name)) stores.set(name, new FakeStore());
  return stores.get(name);
};

const { mock } = await import('node:test');
mock.module('../netlify/functions/_blobsClient.mjs', {
  namedExports: {
    getNamedStore: (name) => storeFor(name),
    jsonResponse: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
  },
});

const { handler } = await import('../netlify/functions/premium-admin-bulk-action.mjs');
const { issueToken } = await import('../netlify/functions/_adminAuth.mjs');
const { readGrants, computeExpiry, DURATIONS } = await import('../netlify/functions/_premiumStore.mjs');

const AUTH_STORE = 'khan-trust-auth';
const DAY_MS = 24 * 60 * 60 * 1000;

function reset() { stores.clear(); }

async function seedUser(id, email) {
  await storeFor(AUTH_STORE).setJSON(`user:email:${email}`, { id, email, name: email.split('@')[0] });
}

function bulkEvent(body) {
  return {
    httpMethod: 'POST',
    headers: { Authorization: `Bearer ${issueToken()}` },
    body: JSON.stringify(body),
  };
}

test('60d is a recognised premium duration', () => {
  assert.equal(DURATIONS.has('60d'), true);
});

test('computeExpiry("60d") is 60 days out', () => {
  const before = Date.now();
  const expiry = Date.parse(computeExpiry('60d'));
  const after = Date.now();
  // Allow for the small wall-clock delta between the two Date.now() reads.
  assert.ok(expiry >= before + 60 * DAY_MS - 5);
  assert.ok(expiry <= after + 60 * DAY_MS + 5);
});

test('bulk_grant 60d for a SINGLE user sets ~2 months expiry', async () => {
  reset();
  await seedUser('u1', 'solo@example.com');

  const res = await handler(bulkEvent({
    action: 'bulk_grant',
    userIds: ['u1'],
    duration: '60d',
    adminName: 'Tester',
  }));
  assert.equal(res.statusCode, 200);
  const payload = JSON.parse(res.body);
  assert.equal(payload.ok, true);
  assert.equal(payload.duration, '60d');
  assert.equal(payload.successCount, 1);
  assert.equal(payload.effectivePlan, 'premium');

  const grants = await readGrants();
  assert.equal(grants.u1.plan, 'premium');
  assert.equal(grants.u1.status, 'active');
  assert.equal(grants.u1.duration, '60d');
  const days = (Date.parse(grants.u1.expiresAt) - Date.now()) / DAY_MS;
  assert.ok(days > 59.9 && days < 60.1, `expected ~60 days, got ${days}`);
});

test('bulk_grant 60d for MULTIPLE users shares one 2-month expiry', async () => {
  reset();
  await seedUser('a', 'a@example.com');
  await seedUser('b', 'b@example.com');
  await seedUser('c', 'c@example.com');

  const res = await handler(bulkEvent({
    action: 'bulk_grant',
    userIds: ['a', 'b', 'c'],
    duration: '60d',
    adminName: 'Tester',
  }));
  assert.equal(res.statusCode, 200);
  const payload = JSON.parse(res.body);
  assert.equal(payload.successCount, 3);

  const grants = await readGrants();
  for (const id of ['a', 'b', 'c']) {
    assert.equal(grants[id].duration, '60d');
    const days = (Date.parse(grants[id].expiresAt) - Date.now()) / DAY_MS;
    assert.ok(days > 59.9 && days < 60.1, `${id}: expected ~60 days, got ${days}`);
  }
  // Whole batch pinned to the same clock.
  assert.equal(grants.a.expiresAt, grants.b.expiresAt);
  assert.equal(grants.b.expiresAt, grants.c.expiresAt);
});

test('existing durations are unchanged: 30d ~1 month, 90d ~3 months', async () => {
  reset();
  await seedUser('m1', 'm1@example.com');
  await seedUser('m3', 'm3@example.com');

  await handler(bulkEvent({ action: 'bulk_grant', userIds: ['m1'], duration: '30d', adminName: 'T' }));
  await handler(bulkEvent({ action: 'bulk_grant', userIds: ['m3'], duration: '90d', adminName: 'T' }));

  const grants = await readGrants();
  const days1 = (Date.parse(grants.m1.expiresAt) - Date.now()) / DAY_MS;
  const days3 = (Date.parse(grants.m3.expiresAt) - Date.now()) / DAY_MS;
  assert.ok(days1 > 29.9 && days1 < 30.1, `30d: got ${days1}`);
  assert.ok(days3 > 89.9 && days3 < 90.1, `90d: got ${days3}`);
});

test('unknown duration is rejected', async () => {
  reset();
  await seedUser('x', 'x@example.com');
  const res = await handler(bulkEvent({
    action: 'bulk_grant', userIds: ['x'], duration: '45d', adminName: 'T',
  }));
  assert.equal(res.statusCode, 400);
});
