// End-to-end tests for the Free Scanner Strategy (Step 4).
//
// Drives the REAL scan-quota handler and the REAL _scanQuotaStore against a
// faked blob backend (same approach as tests/retentionSync.test.mjs). What is
// under test is the actual wiring: identity resolution, the 3/day ceiling, the
// automatic UTC day reset, and premium bypass.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

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

mock.module('../netlify/functions/_blobsClient.mjs', {
  namedExports: {
    getNamedStore: (name) => storeFor(name),
    jsonResponse: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
  },
});

const { handler } = await import('../netlify/functions/scan-quota.mjs');
const { issueToken } = await import('../netlify/functions/_authStore.mjs');
const { setGrant } = await import('../netlify/functions/_premiumStore.mjs');
const {
  consumeQuota, peekQuota, dayKey, nextResetIso, FREE_DAILY_SCAN_LIMIT,
} = await import('../netlify/functions/_scanQuotaStore.mjs');

function reset() { stores.clear(); }
const parse = (res) => JSON.parse(res.body);

// A request from an anonymous caller at a given IP.
function anon(ip, body = {}) {
  return handler({
    httpMethod: 'POST',
    headers: { 'x-nf-client-connection-ip': ip },
    body: JSON.stringify(body),
  });
}

// A request from a signed-in caller (JWT), optionally from a given IP.
function asUser(user, body = {}, ip = '10.0.0.1') {
  return handler({
    httpMethod: 'POST',
    headers: { 'x-nf-client-connection-ip': ip, authorization: `Bearer ${issueToken(user)}` },
    body: JSON.stringify(body),
  });
}

// Burns a full day's free allowance through `call`, whatever the limit is.
// Used by the tests that only care about the state AFTER the allowance is
// gone, so none of them carry a hardcoded number of repeated calls.
async function spendAllowance(call) {
  for (let i = 0; i < FREE_DAILY_SCAN_LIMIT; i += 1) {
    await call({ consume: true });
  }
}

// ── Method / shape ────────────────────────────────────────────────────────────

test('rejects non-POST', async () => {
  reset();
  const res = await handler({ httpMethod: 'GET', headers: {}, body: null });
  assert.equal(res.statusCode, 405);
});

test('a peek writes nothing and reports the full allowance', async () => {
  reset();
  const res = await anon('1.1.1.1', { consume: false });
  const body = parse(res);
  assert.equal(body.limit, FREE_DAILY_SCAN_LIMIT);
  assert.equal(body.used, 0);
  assert.equal(body.remaining, FREE_DAILY_SCAN_LIMIT);
  assert.equal(body.allowed, true);
  // A second peek still reports zero used — peek never consumes.
  assert.equal(parse(await anon('1.1.1.1', { consume: false })).used, 0);
});

// ── The core rule: N free scans a day, then a block ───────────────────────────
//
// These drive the loop off FREE_DAILY_SCAN_LIMIT rather than a literal count.
// They were originally written against a hardcoded 3 and broke the moment the
// free tier moved to 5 — which is exactly backwards: raising the limit is a
// pricing decision, not a regression, and a test suite should not have to be
// edited to permit one. What actually needs protecting is the SHAPE of the
// rule: you get exactly `limit` scans, the counter walks down to zero, and the
// next attempt is refused. That holds at any limit.

test('an anonymous user gets exactly the free limit, then is blocked', async () => {
  reset();
  // Spend the whole allowance, asserting the countdown at every step.
  for (let spent = 1; spent <= FREE_DAILY_SCAN_LIMIT; spent += 1) {
    const body = parse(await anon('2.2.2.2', { consume: true }));
    assert.equal(body.allowed, true, `scan ${spent} of ${FREE_DAILY_SCAN_LIMIT} should be allowed`);
    assert.equal(body.remaining, FREE_DAILY_SCAN_LIMIT - spent);
    // limitReached flips only on the one that spends the last unit.
    assert.equal(body.limitReached, spent === FREE_DAILY_SCAN_LIMIT);
  }

  const overLimit = parse(await anon('2.2.2.2', { consume: true }));
  assert.equal(overLimit.allowed, false);
  assert.equal(overLimit.remaining, 0);
  assert.equal(overLimit.limitReached, true);
  // A blocked attempt is a 200 the client renders as an upgrade prompt — never
  // an error status.
  assert.equal((await anon('2.2.2.2', { consume: true })).statusCode, 200);
});

test('two different IPs are counted independently', async () => {
  reset();
  await spendAllowance((body) => anon('3.3.3.3', body));
  // A different IP still has its own full allowance.
  assert.equal(parse(await anon('4.4.4.4', { consume: false })).remaining, FREE_DAILY_SCAN_LIMIT);
});

test('a signed-in user is counted by account, not IP — a new IP does not reset it', async () => {
  reset();
  const user = { id: 'u-free', email: 'free@example.com' };
  await spendAllowance((body) => asUser(user, body, '5.5.5.5'));
  // Same account, different IP (e.g. moved networks / cleared cookies): still spent.
  const fromNewIp = parse(await asUser(user, { consume: true }, '6.6.6.6'));
  assert.equal(fromNewIp.allowed, false);
});

// ── Premium bypass ────────────────────────────────────────────────────────────

test('a premium user is unlimited and never counted', async () => {
  reset();
  const user = { id: 'u-premium', email: 'vip@example.com' };
  await setGrant(user.id, { status: 'active', plan: 'premium', expiresAt: null });

  for (let i = 0; i < 5; i += 1) {
    const body = parse(await asUser(user, { consume: true }));
    assert.equal(body.premium, true);
    assert.equal(body.unlimited, true);
    assert.equal(body.allowed, true);
    assert.equal(body.remaining, null);
  }
});

// ── Automatic daily reset (store-level, with an injectable clock) ─────────────

test('the count resets at the UTC day boundary with no cron', async () => {
  const store = new FakeStore();
  const getStoreFn = () => store;
  const day1 = Date.parse('2026-07-18T12:00:00Z');
  const day2 = Date.parse('2026-07-19T00:30:00Z');

  for (let i = 0; i < FREE_DAILY_SCAN_LIMIT; i += 1) {
    await consumeQuota('ip:9.9.9.9', { now: day1, getStoreFn });
  }
  assert.equal((await consumeQuota('ip:9.9.9.9', { now: day1, getStoreFn })).allowed, false);

  // Next UTC day: the stored day stamp is stale, so the count is zero again.
  const nextDay = await peekQuota('ip:9.9.9.9', { now: day2, getStoreFn });
  assert.equal(nextDay.remaining, FREE_DAILY_SCAN_LIMIT);
  assert.equal(nextDay.allowed, true);
});

test('dayKey and nextResetIso track the UTC boundary', () => {
  const noon = Date.parse('2026-07-18T12:00:00Z');
  assert.equal(dayKey(noon), '2026-07-18');
  assert.equal(nextResetIso(noon), '2026-07-19T00:00:00.000Z');
});

// ── Fail open ─────────────────────────────────────────────────────────────────

test('a blob read failure fails open (scan allowed)', async () => {
  const brokenStore = {
    async get() { throw new Error('blobs down'); },
    async setJSON() { throw new Error('blobs down'); },
  };
  const result = await consumeQuota('ip:x', { getStoreFn: () => brokenStore });
  assert.equal(result.allowed, true);
});
