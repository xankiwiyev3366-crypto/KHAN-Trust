// Admin Panel performance contract.
//
// These are correctness tests for a performance change, which means they assert
// two different kinds of thing and both matter:
//
//   1. THE NUMBERS ARE STILL RIGHT. The registered-user count in particular is
//      now produced by a COUNT over the user key space instead of by reading
//      every user record, so it is checked directly against the store on every
//      shape of population these tests can build.
//
//   2. THE WORK IS STILL AVOIDED. A cache that silently stops caching, or a
//      slice that quietly starts reading every user record again, is invisible
//      to an assertion about values — the dashboard just gets slow again and
//      nobody notices until an operator complains. So the fake blob backend
//      COUNTS round trips, and the tests assert on those counts.
//
// The blob store is faked; everything above it (the real _authStore, the real
// analytics-summary handler) is the production code path.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.KHAN_ADMIN_PASSCODE = 'test-admin-passcode';

// Round-trip counters, plus a high-water mark of concurrent in-flight reads —
// the only way to tell "read in parallel" from "read one after another" without
// timing anything.
const io = { get: 0, list: 0, byStore: {}, inFlight: 0, peakInFlight: 0 };

function countIo(kind, name) {
  io[kind] += 1;
  io.byStore[name] = io.byStore[name] || { get: 0, list: 0 };
  io.byStore[name][kind] += 1;
}

async function ioTick() {
  io.inFlight += 1;
  io.peakInFlight = Math.max(io.peakInFlight, io.inFlight);
  // One macrotask of latency, so genuinely-parallel reads overlap and
  // genuinely-sequential ones do not.
  await new Promise((resolve) => setTimeout(resolve, 1));
  io.inFlight -= 1;
}

class FakeStore {
  constructor(name) { this.name = name; this.data = new Map(); this.failKeys = new Set(); }
  async setJSON(key, value) { this.data.set(key, JSON.parse(JSON.stringify(value))); }
  async set(key, value) { this.data.set(key, value); }
  async get(key, opts) {
    await ioTick();
    countIo('get', this.name);
    if (this.failKeys.has(key)) throw new Error(`blob read failed: ${key}`);
    if (!this.data.has(key)) return null;
    const raw = this.data.get(key);
    if (opts?.type === 'text') return typeof raw === 'string' ? raw : JSON.stringify(raw);
    return JSON.parse(JSON.stringify(raw));
  }
  async delete(key) { this.data.delete(key); }
  async list({ prefix } = {}) {
    await ioTick();
    countIo('list', this.name);
    if (this.failList) throw new Error(`blob list failed: ${this.name}`);
    return { blobs: [...this.data.keys()].filter((k) => !prefix || k.startsWith(prefix)).map((key) => ({ key })) };
  }
}

const stores = new Map();
const storeFor = (name) => {
  if (!stores.has(name)) stores.set(name, new FakeStore(name));
  return stores.get(name);
};

mock.module('../netlify/functions/_blobsClient.mjs', {
  namedExports: {
    getNamedStore: storeFor,
    jsonResponse: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
  },
});

mock.module('../netlify/functions/_email.mjs', {
  namedExports: {
    sendVerificationEmail: async () => ({ ok: true }),
    sendPasswordResetEmail: async () => ({ ok: true }),
    sendEmail: async () => ({ ok: true }),
  },
});

const { countRegisteredUsers, getUserLoginStats, saveUser, hashPassword } = await import('../netlify/functions/_authStore.mjs');
const { handler: analyticsSummary } = await import('../netlify/functions/analytics-summary.mjs');
const { handler: register } = await import('../netlify/functions/auth-register.mjs');
const { issueToken: issueAdmin } = await import('../netlify/functions/_adminAuth.mjs');
const { appendEvent } = await import('../netlify/functions/_analyticsStore.mjs');
const { invalidateAggregate } = await import('../netlify/functions/_aggregateCache.mjs');

const AUTH_STORE = 'khan-trust-auth';

function reset() {
  stores.clear();
  // The aggregate cache lives for the life of the function INSTANCE, which in a
  // test process is the life of the whole file. Without this every test after
  // the first would be answered from the previous test's population.
  invalidateAggregate();
  resetIo();
}

function resetIo() {
  io.get = 0;
  io.list = 0;
  io.byStore = {};
  io.inFlight = 0;
  io.peakInFlight = 0;
}

const parse = (res) => JSON.parse(res.body);

function get(query = {}) {
  return analyticsSummary({
    httpMethod: 'GET',
    headers: { authorization: `Bearer ${issueAdmin()}` },
    queryStringParameters: query,
  });
}

// Writes an account straight into the store — the same shape auth-register
// produces, without the round trips.
async function seedUser(id, { hasLoggedIn = false, lastActiveAt = null } = {}) {
  await saveUser({
    id,
    email: `${id}@example.com`,
    name: id,
    passwordHash: hashPassword('correct-horse-battery'),
    createdAt: '2026-01-01T00:00:00.000Z',
    emailVerified: true,
    ...(hasLoggedIn ? { hasLoggedIn: true, firstLoginAt: '2026-02-01T00:00:00.000Z', lastLoginAt: '2026-02-01T00:00:00.000Z' } : {}),
    ...(lastActiveAt ? { lastActiveAt } : {}),
  });
}

// The count taken directly off the store, with no product code involved. This is
// the "database" side of every accuracy check below.
function trueRegisteredCount() {
  return [...storeFor(AUTH_STORE).data.keys()].filter((k) => k.startsWith('user:email:')).length;
}

// ── The count is right ───────────────────────────────────────────────────────

test('countRegisteredUsers matches the store exactly, at every size', async () => {
  for (const size of [0, 1, 7, 206]) {
    reset();
    for (let i = 0; i < size; i += 1) await seedUser(`u${i}`);
    resetIo();
    const counted = await countRegisteredUsers();
    assert.equal(counted, size);
    assert.equal(counted, trueRegisteredCount(), `count disagrees with the store at size ${size}`);
  }
});

test('the count reads ZERO user records — it counts keys, it does not fetch accounts', async () => {
  reset();
  for (let i = 0; i < 50; i += 1) await seedUser(`u${i}`);
  resetIo();

  const counted = await countRegisteredUsers();

  assert.equal(counted, 50);
  assert.equal(io.byStore[AUTH_STORE].list, 1, 'one LIST is all it should take');
  assert.equal(io.byStore[AUTH_STORE].get, 0, 'fetching user records to produce a count is the bug this exists to prevent');
});

test('the count tracks real registrations through the real endpoint', async () => {
  reset();
  for (const email of ['a@example.com', 'b@example.com', 'c@example.com']) {
    const res = await register({
      httpMethod: 'POST',
      headers: { 'x-nf-client-connection-ip': '1.2.3.4' },
      body: JSON.stringify({ email, password: 'correct-horse-battery', name: email.split('@')[0] }),
    });
    assert.equal(res.statusCode, 201);
  }
  assert.equal(await countRegisteredUsers(), 3);
  assert.equal(await countRegisteredUsers(), trueRegisteredCount());
});

test('getUserLoginStats reports the count from the key listing, and the buckets still sum to it', async () => {
  reset();
  for (let i = 0; i < 40; i += 1) await seedUser(`p${i}`, { hasLoggedIn: i < 12, lastActiveAt: i < 5 ? new Date().toISOString() : null });

  const stats = await getUserLoginStats();
  assert.equal(stats.registeredUsers, 40);
  assert.equal(stats.registeredUsers, trueRegisteredCount());
  assert.equal(stats.loggedInUsers, 12);
  assert.equal(stats.neverLoggedInUsers, 28);
  assert.equal(stats.registeredUsers, stats.loggedInUsers + stats.neverLoggedInUsers);
  assert.equal(stats.readFailures, 0);
});

test('a partially unreadable population is reported as a failure, never as a smaller user base', async () => {
  reset();
  for (let i = 0; i < 10; i += 1) await seedUser(`q${i}`, { hasLoggedIn: true });
  storeFor(AUTH_STORE).failKeys.add('user:email:q3@example.com');

  const stats = await getUserLoginStats();
  // The COUNT is still the truth — 10 accounts exist and 10 are reported.
  assert.equal(stats.registeredUsers, 10);
  assert.equal(stats.readFailures, 1);
  // …and because one record could not be bucketed, the halves no longer sum,
  // which is what makes the endpoint refuse rather than quietly under-report.
  assert.notEqual(stats.registeredUsers, stats.loggedInUsers + stats.neverLoggedInUsers);

  const res = await get({ section: 'users' });
  assert.equal(res.statusCode, 500);
  assert.match(parse(res).message, /consistency check/);
  assert.equal(parse(res).detail.readFailures, 1);
});

// ── The endpoint serves the right count ──────────────────────────────────────

test('the users slice serves a count that matches the store', async () => {
  reset();
  for (let i = 0; i < 23; i += 1) await seedUser(`r${i}`, { hasLoggedIn: i % 2 === 0 });

  const body = parse(await get({ section: 'users' }));
  assert.equal(body.userAnalytics.registeredUsers, 23);
  assert.equal(body.userAnalytics.registeredUsers, trueRegisteredCount());
  assert.equal(body.userAnalytics.registeredTotal, 23, 'the legacy alias still resolves');
  assert.equal(
    body.userAnalytics.registeredUsers,
    body.userAnalytics.loggedInUsers + body.userAnalytics.neverLoggedInUsers,
  );
});

test('the events slice derives avgScansPerUser from the COUNT, without reading a single user record', async () => {
  reset();
  for (let i = 0; i < 10; i += 1) await seedUser(`s${i}`);
  for (let i = 0; i < 40; i += 1) {
    await appendEvent({ type: 'token_scan', timestamp: new Date().toISOString(), projectId: 'p1', trustScore: 50 });
  }
  resetIo();

  const body = parse(await get({ section: 'events' }));

  // 40 scans / 10 accounts.
  assert.equal(body.userAnalytics.avgScansPerUser, 4);
  assert.equal(io.byStore[AUTH_STORE].get, 0, 'the events slice must never fan out over user records');
  assert.equal(io.byStore[AUTH_STORE].list, 1);
});

// ── Slices are independent, and read in parallel ─────────────────────────────

test('a broken user store does not stop the events or verification slices', async () => {
  reset();
  for (let i = 0; i < 5; i += 1) await seedUser(`t${i}`);
  await appendEvent({ type: 'token_scan', timestamp: new Date().toISOString(), projectId: 'p1', trustScore: 70 });
  storeFor(AUTH_STORE).failList = true;

  // The expensive slice fails on its own…
  assert.equal((await get({ section: 'users' })).statusCode, 500);

  // …while every other card group is served normally. This is the whole point:
  // one dead source used to blank the entire Admin Panel.
  const events = await get({ section: 'events' });
  assert.equal(events.statusCode, 200);
  assert.equal(parse(events).overview.totalScans, 1);

  const verification = await get({ section: 'verification' });
  assert.equal(verification.statusCode, 200);
  assert.equal(parse(verification).overview.verifiedProjects, 0);
});

test('a full request reads its three sources in parallel, not one after another', async () => {
  reset();
  for (let i = 0; i < 6; i += 1) await seedUser(`v${i}`);
  await appendEvent({ type: 'page_view', timestamp: new Date().toISOString(), visitorId: 'v1' });
  resetIo();

  assert.equal((await get({ refresh: '1' })).statusCode, 200);

  // Serial reads never overlap, so a sequential implementation peaks at 1.
  assert.ok(io.peakInFlight > 1, `expected overlapping reads, peaked at ${io.peakInFlight}`);
});

// ── The cache ────────────────────────────────────────────────────────────────

test('a repeat request is served from cache without touching the store', async () => {
  reset();
  for (let i = 0; i < 12; i += 1) await seedUser(`w${i}`);

  const first = parse(await get({ section: 'users' }));
  assert.equal(first.userAnalytics.registeredUsers, 12);

  resetIo();
  const second = parse(await get({ section: 'users' }));
  assert.equal(second.userAnalytics.registeredUsers, 12);
  assert.equal(io.get, 0, 'a cached slice must cost no round trips');
  assert.equal(io.list, 0);
});

test('manual refresh always sees a change the cache has not expired for', async () => {
  reset();
  for (let i = 0; i < 3; i += 1) await seedUser(`x${i}`);
  assert.equal(parse(await get({ section: 'users' })).userAnalytics.registeredUsers, 3);

  // Two more accounts appear while the cached figure is still inside its TTL.
  await seedUser('x3');
  await seedUser('x4');

  // The poll is allowed to be briefly stale…
  assert.equal(parse(await get({ section: 'users' })).userAnalytics.registeredUsers, 3);
  // …but Refresh is not. An operator pressing it must get the truth.
  const refreshed = parse(await get({ section: 'users', refresh: '1' }));
  assert.equal(refreshed.userAnalytics.registeredUsers, 5);
  assert.equal(refreshed.userAnalytics.registeredUsers, trueRegisteredCount());

  // And the refreshed value REPLACES the cached one, so the next poll does not
  // fall back to the figure the operator just proved wrong.
  assert.equal(parse(await get({ section: 'users' })).userAnalytics.registeredUsers, 5);
});

test('concurrent requests for the same slice coalesce onto one computation', async () => {
  reset();
  for (let i = 0; i < 20; i += 1) await seedUser(`y${i}`);
  resetIo();

  const results = await Promise.all([
    get({ section: 'users' }),
    get({ section: 'users' }),
    get({ section: 'users' }),
  ]);
  results.forEach((res) => assert.equal(parse(res).userAnalytics.registeredUsers, 20));

  // One LIST, not three: the 30s poll overlapping a Refresh must not triple the
  // most expensive read on the platform.
  assert.equal(io.byStore[AUTH_STORE].list, 1);
  assert.equal(io.byStore[AUTH_STORE].get, 20);
});

// ── The existing contract ────────────────────────────────────────────────────

test('the default (no-section) payload still carries every key it always did', async () => {
  reset();
  for (let i = 0; i < 4; i += 1) await seedUser(`z${i}`, { hasLoggedIn: i < 2 });
  await appendEvent({ type: 'token_scan', timestamp: new Date().toISOString(), projectId: 'p1', ticker: 'P1', contract: '0xabc', trustScore: 61 });
  await appendEvent({ type: 'page_view', timestamp: new Date().toISOString(), visitorId: 'v1' });
  await appendEvent({ type: 'search', timestamp: new Date().toISOString(), query: 'hello' });

  const body = parse(await get());

  for (const key of [
    'generatedAt', 'eventCount', 'overview', 'scanAnalytics', 'mostScannedTokens',
    'projectAnalytics', 'trustScoreAnalytics', 'visitorAnalytics', 'verificationAnalytics',
    'userAnalytics', 'popularSearches', 'topActivity', 'projectsAddedCount',
  ]) {
    assert.ok(key in body, `missing top-level key: ${key}`);
  }

  for (const key of [
    'totalScans', 'totalUsers', 'totalProjects',
    'verifiedProjects', 'pendingVerification', 'rejectedVerification',
  ]) {
    assert.ok(key in body.overview, `missing overview key: ${key}`);
  }

  // Both halves of userAnalytics — the record-derived and the event-derived —
  // are merged back into one object, as they were before the split.
  for (const key of [
    'registeredUsers', 'loggedInUsers', 'neverLoggedInUsers', 'activeToday', 'activeLast7Days',
    'registeredToday', 'returningUsers', 'avgScansPerUser', 'topActiveUsers',
    'registeredTotal', 'activeUsersToday', 'loggedInVisitors',
  ]) {
    assert.ok(key in body.userAnalytics, `missing userAnalytics key: ${key}`);
  }

  assert.equal(body.userAnalytics.registeredUsers, 4);
  assert.equal(body.userAnalytics.registeredUsers, trueRegisteredCount());
});

test('generatedAt reports the OLDEST slice, so a fresh stamp can never cover a stale figure', async () => {
  reset();
  await seedUser('g0');

  // Warm every slice, then force ONLY the events slice to recompute. The three
  // now carry different ages, which is exactly the situation a single
  // response-time timestamp would misrepresent.
  const first = parse(await get());
  await new Promise((resolve) => setTimeout(resolve, 20));
  await get({ section: 'events', refresh: '1' });

  const second = parse(await get());
  const stamps = Object.values(second.sectionsGeneratedAt);
  assert.equal(stamps.length, 3);
  assert.ok(second.sectionsGeneratedAt.events > first.sectionsGeneratedAt.events, 'the refreshed slice moved');
  assert.equal(second.sectionsGeneratedAt.users, first.sectionsGeneratedAt.users, 'the cached slices did not');
  assert.equal(second.generatedAt, stamps.slice().sort()[0], 'generatedAt must be the oldest slice on screen');
  assert.ok(second.generatedAt < second.sectionsGeneratedAt.events, 'a refreshed slice must not make the page look newer than it is');
});

test('an unknown or empty section falls back to the full payload rather than serving nothing', async () => {
  reset();
  await seedUser('k0');
  for (const section of ['', 'nonsense', 'users,nonsense']) {
    invalidateAggregate();
    const body = parse(await get(section ? { section } : {}));
    assert.ok(body.userAnalytics, `section=${section || '(absent)'} served no user analytics`);
  }
});

test('the endpoint still refuses anyone without a valid admin token', async () => {
  reset();
  await seedUser('a0');
  const res = await analyticsSummary({ httpMethod: 'GET', headers: {}, queryStringParameters: { section: 'users' } });
  assert.equal(res.statusCode, 401);

  const wrongMethod = await analyticsSummary({
    httpMethod: 'POST',
    headers: { authorization: `Bearer ${issueAdmin()}` },
    queryStringParameters: {},
  });
  assert.equal(wrongMethod.statusCode, 405);
});
