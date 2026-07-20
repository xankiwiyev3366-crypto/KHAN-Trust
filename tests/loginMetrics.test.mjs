// Admin Analytics user-metric correctness.
//
// Drives the REAL auth endpoints and the REAL analytics-summary handler against
// a faked blob backend, so what is under test is the actual production wiring:
// which flows record a login, which must not, and whether the five headline
// numbers can ever disagree with each other.
//
// THE INVARIANT THESE EXIST TO PROTECT
//
//   registeredUsers === loggedInUsers + neverLoggedInUsers
//
// It failed in production (206 registered, 206 "logged in", 166 "never logged
// in") because the two halves came from different endpoints, over different
// data sources, with different denominators — neither of which was the user
// record. Every test below re-checks the invariant after whatever it does.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

class FakeStore {
  constructor() { this.data = new Map(); }
  async setJSON(key, value) { this.data.set(key, JSON.parse(JSON.stringify(value))); }
  async set(key, value) { this.data.set(key, value); }
  async get(key, opts) {
    if (!this.data.has(key)) return null;
    const raw = this.data.get(key);
    if (opts?.type === 'text') return typeof raw === 'string' ? raw : JSON.stringify(raw);
    return JSON.parse(JSON.stringify(raw));
  }
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

// Email sending is a side effect we neither want nor need here.
mock.module('../netlify/functions/_email.mjs', {
  namedExports: {
    sendVerificationEmail: async () => ({ ok: true }),
    sendPasswordResetEmail: async () => ({ ok: true }),
    sendEmail: async () => ({ ok: true }),
  },
});

const authStore = await import('../netlify/functions/_authStore.mjs');
const { handler: login } = await import('../netlify/functions/auth-login.mjs');
const { handler: register } = await import('../netlify/functions/auth-register.mjs');
const { handler: me } = await import('../netlify/functions/auth-me.mjs');
const { handler: verifyEmail } = await import('../netlify/functions/auth-verify-email.mjs');
const { handler: analyticsSummary } = await import('../netlify/functions/analytics-summary.mjs');
const { runLoginBackfill } = await import('../netlify/functions/_loginBackfill.mjs');
const { appendEvent } = await import('../netlify/functions/_analyticsStore.mjs');

const {
  getUserLoginStats, recordSuccessfulAuth, AUTH_METHOD, issueToken, getUserByEmail, saveUser, hashPassword,
} = authStore;

function reset() { stores.clear(); }
const parse = (res) => JSON.parse(res.body);

const post = (handler, body, headers = {}) =>
  handler({ httpMethod: 'POST', headers: { 'x-nf-client-connection-ip': '1.2.3.4', ...headers }, body: JSON.stringify(body) });

// Registers a real account through the real endpoint.
async function registerUser(email, password = 'correct-horse-battery') {
  const res = await post(register, { email, password, name: email.split('@')[0] });
  return parse(res);
}

// Creates an account DIRECTLY in the store, bypassing the register endpoint —
// i.e. exactly the shape of a legacy row written before login tracking existed:
// no hasLoggedIn, no firstLoginAt, no lastActiveAt.
async function seedLegacyUser(id, email) {
  await saveUser({
    id,
    email,
    name: email.split('@')[0],
    passwordHash: hashPassword('correct-horse-battery'),
    createdAt: '2025-01-01T00:00:00.000Z',
    emailVerified: true,
  });
}

async function assertInvariant(label = '') {
  const s = await getUserLoginStats();
  assert.equal(
    s.registeredUsers,
    s.loggedInUsers + s.neverLoggedInUsers,
    `invariant broken ${label}: ${s.registeredUsers} !== ${s.loggedInUsers} + ${s.neverLoggedInUsers}`
  );
  return s;
}

// ── Never logged in ──────────────────────────────────────────────────────────

test('a legacy account with no evidence counts as never logged in', async () => {
  reset();
  await seedLegacyUser('u1', 'never@example.com');
  const s = await assertInvariant('legacy-no-evidence');
  assert.equal(s.registeredUsers, 1);
  assert.equal(s.loggedInUsers, 0);
  assert.equal(s.neverLoggedInUsers, 1);
  assert.equal(s.activeToday, 0);
  assert.equal(s.activeLast7Days, 0);
});

// ── Registration auto-login ──────────────────────────────────────────────────

test('registration auto-login counts as a login — the biggest source of the bug', async () => {
  reset();
  // Registration issues a token and lands the user signed in without ever
  // calling auth-login. This recorded nothing before, so anyone who signed up
  // and stayed signed in read as "Never Logged In" forever.
  await registerUser('new@example.com');
  const s = await assertInvariant('after-register');
  assert.equal(s.registeredUsers, 1);
  assert.equal(s.loggedInUsers, 1);
  assert.equal(s.neverLoggedInUsers, 0);
  assert.equal(s.activeToday, 1);
});

// ── Password login ───────────────────────────────────────────────────────────

test('a single successful login sets hasLoggedIn, firstLoginAt and lastLoginAt', async () => {
  reset();
  await seedLegacyUser('u2', 'once@example.com');
  const res = await post(login, { email: 'once@example.com', password: 'correct-horse-battery' });
  assert.equal(res.statusCode, 200);

  const user = await getUserByEmail('once@example.com');
  assert.equal(user.hasLoggedIn, true);
  assert.ok(user.firstLoginAt);
  assert.ok(user.lastLoginAt);
  assert.equal(user.lastAuthMethod, AUTH_METHOD.PASSWORD);
  await assertInvariant('after-login');
});

test('multiple logins count the user ONCE and never move firstLoginAt', async () => {
  reset();
  await seedLegacyUser('u3', 'many@example.com');
  await post(login, { email: 'many@example.com', password: 'correct-horse-battery' });
  const afterFirst = await getUserByEmail('many@example.com');

  await post(login, { email: 'many@example.com', password: 'correct-horse-battery' });
  await post(login, { email: 'many@example.com', password: 'correct-horse-battery' });
  const afterThird = await getUserByEmail('many@example.com');

  // firstLoginAt is a floor: overwriting it would turn "first seen" into "last
  // seen" and destroy every cohort/retention calculation built on it.
  assert.equal(afterThird.firstLoginAt, afterFirst.firstLoginAt);

  const s = await assertInvariant('multi-login');
  assert.equal(s.loggedInUsers, 1, 'three logins is still one logged-in user');
  assert.equal(s.activeToday, 1, 'DISTINCT users, not login count');
});

// ── Failed login ─────────────────────────────────────────────────────────────

test('a FAILED login records nothing at all', async () => {
  reset();
  await seedLegacyUser('u4', 'wrongpw@example.com');
  const res = await post(login, { email: 'wrongpw@example.com', password: 'not-the-password' });
  assert.equal(res.statusCode, 401);

  const user = await getUserByEmail('wrongpw@example.com');
  assert.notEqual(user.hasLoggedIn, true);
  assert.equal(user.firstLoginAt, undefined);
  assert.equal(user.lastLoginAt, undefined);
  assert.equal(user.lastActiveAt, undefined);

  const s = await assertInvariant('failed-login');
  assert.equal(s.loggedInUsers, 0);
  assert.equal(s.neverLoggedInUsers, 1);
  assert.equal(s.activeToday, 0, 'a failed attempt must not make an account active');
});

test('a failed login for an unknown email creates nothing', async () => {
  reset();
  const res = await post(login, { email: 'ghost@example.com', password: 'whatever' });
  assert.equal(res.statusCode, 401);
  const s = await assertInvariant('unknown-email');
  assert.equal(s.registeredUsers, 0);
});

// ── Session restoration ──────────────────────────────────────────────────────

test('session restoration marks activity but does NOT move lastLoginAt', async () => {
  reset();
  await seedLegacyUser('u5', 'session@example.com');
  await post(login, { email: 'session@example.com', password: 'correct-horse-battery' });
  const afterLogin = await getUserByEmail('session@example.com');

  await new Promise((r) => setTimeout(r, 5));
  const token = issueToken({ id: 'u5', email: 'session@example.com', name: 'session' });
  const res = await me({ httpMethod: 'GET', headers: { authorization: `Bearer ${token}` } });
  assert.equal(res.statusCode, 200);

  const afterRestore = await getUserByEmail('session@example.com');
  // Activity moved forward; the login timestamp did not. Collapsing these would
  // make "logged in today" indistinguishable from "had the tab open today".
  assert.equal(afterRestore.lastLoginAt, afterLogin.lastLoginAt, 'lastLoginAt must not move on a session restore');
  assert.notEqual(afterRestore.lastActiveAt, undefined);
  await assertInvariant('session-restore');
});

test('a restored session reclassifies a legacy user — the self-healing path', async () => {
  reset();
  await seedLegacyUser('u6', 'legacy-session@example.com');
  let s = await getUserLoginStats();
  assert.equal(s.neverLoggedInUsers, 1);

  // A validly signed, unexpired JWT can only exist because this account
  // authenticated at some point, so presenting one is proof.
  const token = issueToken({ id: 'u6', email: 'legacy-session@example.com', name: 'legacy' });
  await me({ httpMethod: 'GET', headers: { authorization: `Bearer ${token}` } });

  s = await assertInvariant('legacy-self-heal');
  assert.equal(s.loggedInUsers, 1);
  assert.equal(s.neverLoggedInUsers, 0);
});

test('an INVALID or expired token records nothing', async () => {
  reset();
  await seedLegacyUser('u7', 'forged@example.com');
  for (const bad of ['', 'not-a-token', 'a.b.c']) {
    const res = await me({ httpMethod: 'GET', headers: { authorization: `Bearer ${bad}` } });
    assert.equal(res.statusCode, 401);
  }
  const user = await getUserByEmail('forged@example.com');
  assert.notEqual(user.hasLoggedIn, true);
  const s = await assertInvariant('forged-token');
  assert.equal(s.loggedInUsers, 0);
});

// ── Email verification auto-login ────────────────────────────────────────────

test('email-verification auto-login counts as a login', async () => {
  reset();
  await registerUser('verify@example.com');
  // Registration already logged them in; clear it so we test verify in isolation.
  const before = await getUserByEmail('verify@example.com');
  await saveUser({ ...before, hasLoggedIn: false, firstLoginAt: undefined, lastLoginAt: undefined, lastActiveAt: undefined });

  const token = await authStore.createVerifyToken('verify@example.com');
  const res = await post(verifyEmail, { token });
  assert.equal(res.statusCode, 200);

  const after = await getUserByEmail('verify@example.com');
  assert.equal(after.hasLoggedIn, true);
  await assertInvariant('email-verify');
});

test('an invalid verification token records nothing', async () => {
  reset();
  await seedLegacyUser('u8', 'badverify@example.com');
  const res = await post(verifyEmail, { token: 'not-a-real-token' });
  assert.equal(res.statusCode, 400);
  const s = await assertInvariant('bad-verify-token');
  assert.equal(s.loggedInUsers, 0);
});

// ── Duplicate sessions / duplicate events ────────────────────────────────────

test('duplicate sessions and repeated activity count the user once', async () => {
  reset();
  await registerUser('dup@example.com');
  const user = await getUserByEmail('dup@example.com');
  const token = issueToken({ id: user.id, email: user.email, name: user.name });

  // Same user, ten concurrent "sessions" hammering auth-me.
  await Promise.all(Array.from({ length: 10 }, () =>
    me({ httpMethod: 'GET', headers: { authorization: `Bearer ${token}` } })
  ));

  const s = await assertInvariant('duplicate-sessions');
  assert.equal(s.registeredUsers, 1);
  assert.equal(s.loggedInUsers, 1);
  assert.equal(s.activeToday, 1, 'ten sessions is one active user');
  assert.equal(s.activeLast7Days, 1);
});

test('duplicate analytics events never inflate the user metrics', async () => {
  reset();
  await registerUser('events@example.com');
  const user = await getUserByEmail('events@example.com');
  // Fifty attributed events for one account.
  for (let i = 0; i < 50; i += 1) {
    await appendEvent({ type: 'token_scan', userId: user.id, timestamp: new Date().toISOString() });
  }
  const s = await assertInvariant('duplicate-events');
  assert.equal(s.loggedInUsers, 1, 'metrics come from user records, not event volume');
  assert.equal(s.activeToday, 1);
});

// ── Day / week boundaries ────────────────────────────────────────────────────

test('Active Today is the UTC calendar day, and yesterday does not count', async () => {
  reset();
  await seedLegacyUser('u9', 'boundary@example.com');
  const now = Date.parse('2026-07-21T12:00:00Z');

  // Active late yesterday (UTC).
  await recordSuccessfulAuth('u9', { method: AUTH_METHOD.PASSWORD, now: Date.parse('2026-07-20T23:59:59Z') });
  let s = await getUserLoginStats({ now });
  assert.equal(s.activeToday, 0, 'yesterday 23:59 UTC is not today');
  assert.equal(s.activeLast7Days, 1, 'but it is inside the rolling week');

  // Active just after the UTC midnight boundary.
  await recordSuccessfulAuth('u9', { method: AUTH_METHOD.PASSWORD, now: Date.parse('2026-07-21T00:00:01Z') });
  s = await getUserLoginStats({ now });
  assert.equal(s.activeToday, 1);
  await assertInvariant('day-boundary');
});

test('Active This Week is a ROLLING 7 days, not a sum of daily counts', async () => {
  reset();
  const now = Date.parse('2026-07-21T12:00:00Z');
  await seedLegacyUser('w1', 'inside@example.com');
  await seedLegacyUser('w2', 'edge@example.com');
  await seedLegacyUser('w3', 'outside@example.com');

  // Comfortably inside, and active on three separate days.
  await recordSuccessfulAuth('w1', { now: Date.parse('2026-07-17T10:00:00Z') });
  await recordSuccessfulAuth('w1', { now: Date.parse('2026-07-18T10:00:00Z') });
  await recordSuccessfulAuth('w1', { now: Date.parse('2026-07-19T10:00:00Z') });
  // Just inside the 7-day edge.
  await recordSuccessfulAuth('w2', { now: now - 6.9 * 86400000 });
  // Just outside it.
  await recordSuccessfulAuth('w3', { now: now - 7.5 * 86400000 });

  const s = await getUserLoginStats({ now });
  // w1 active on three days still counts ONCE — summing daily actives would
  // give 4 here, which is the classic double-count this metric must not do.
  assert.equal(s.activeLast7Days, 2);
  assert.equal(s.loggedInUsers, 3, 'all three authenticated at some point');
  await assertInvariant('week-boundary');
});

test('activeToday can never exceed activeLast7Days, which can never exceed loggedIn', async () => {
  reset();
  for (let i = 0; i < 5; i += 1) await seedLegacyUser(`n${i}`, `n${i}@example.com`);
  const now = Date.now();
  await recordSuccessfulAuth('n0', { now });
  await recordSuccessfulAuth('n1', { now });
  await recordSuccessfulAuth('n2', { now: now - 3 * 86400000 });
  await recordSuccessfulAuth('n3', { now: now - 30 * 86400000 });

  const s = await getUserLoginStats({ now });
  assert.ok(s.activeToday <= s.activeLast7Days, `${s.activeToday} <= ${s.activeLast7Days}`);
  assert.ok(s.activeLast7Days <= s.loggedInUsers, `${s.activeLast7Days} <= ${s.loggedInUsers}`);
  assert.ok(s.loggedInUsers <= s.registeredUsers);
  assert.equal(s.loggedInUsers, 4);
  assert.equal(s.neverLoggedInUsers, 1);
  await assertInvariant('ordering');
});

// ── Legacy backfill ──────────────────────────────────────────────────────────

test('backfill marks a legacy user who has a surviving login event', async () => {
  reset();
  await seedLegacyUser('L1', 'evt@example.com');
  await appendEvent({ type: 'user_login', userId: 'L1', timestamp: '2025-06-01T10:00:00.000Z' });

  const result = await runLoginBackfill({ dryRun: false });
  assert.equal(result.markedFromEvidence, 1);

  const user = await getUserByEmail('evt@example.com');
  assert.equal(user.hasLoggedIn, true);
  assert.equal(user.firstLoginAt, '2025-06-01T10:00:00.000Z');
  // Flagged as reconstructed, not observed.
  assert.equal(user.loginStateSource, 'backfill-v1');
  await assertInvariant('backfill-login-event');
});

test('backfill marks a legacy user from an attributed non-login event', async () => {
  reset();
  await seedLegacyUser('L2', 'scan@example.com');
  // A scan stamped with a userId can only come from a signed-in client.
  await appendEvent({ type: 'token_scan', userId: 'L2', timestamp: '2025-05-02T10:00:00.000Z' });

  await runLoginBackfill({ dryRun: false });
  const user = await getUserByEmail('scan@example.com');
  assert.equal(user.hasLoggedIn, true);
});

test('backfill does NOT treat registration or email verification as a login', async () => {
  reset();
  await seedLegacyUser('L3', 'signedup@example.com'); // emailVerified: true
  // A user_registered event is stamped with a userId at signup — it must not
  // qualify, or every account that ever existed would count as logged in.
  await appendEvent({ type: 'user_registered', userId: 'L3', timestamp: '2025-01-01T00:00:00.000Z' });

  const result = await runLoginBackfill({ dryRun: false });
  assert.equal(result.markedFromEvidence, 0);
  assert.equal(result.noEvidence, 1);

  const user = await getUserByEmail('signedup@example.com');
  assert.notEqual(user.hasLoggedIn, true);
  const s = await assertInvariant('backfill-no-false-positive');
  assert.equal(s.neverLoggedInUsers, 1);
});

test('backfill is idempotent and never clobbers a real login', async () => {
  reset();
  await seedLegacyUser('L4', 'idem@example.com');
  await appendEvent({ type: 'user_login', userId: 'L4', timestamp: '2025-06-01T10:00:00.000Z' });
  await runLoginBackfill({ dryRun: false });

  // A genuine login happens afterwards.
  await post(login, { email: 'idem@example.com', password: 'correct-horse-battery' });
  const afterRealLogin = await getUserByEmail('idem@example.com');

  // Re-running must change nothing.
  const second = await runLoginBackfill({ dryRun: false });
  assert.equal(second.skipped, true);
  assert.equal(second.reason, 'already_run');

  const afterRerun = await getUserByEmail('idem@example.com');
  assert.equal(afterRerun.lastLoginAt, afterRealLogin.lastLoginAt);
  assert.equal(afterRerun.firstLoginAt, '2025-06-01T10:00:00.000Z');
});

test('a dry run reports what would change and writes nothing', async () => {
  reset();
  await seedLegacyUser('L5', 'dry@example.com');
  await appendEvent({ type: 'user_login', userId: 'L5', timestamp: '2025-06-01T10:00:00.000Z' });

  const result = await runLoginBackfill({ dryRun: true });
  assert.equal(result.markedFromEvidence, 1);

  const user = await getUserByEmail('dry@example.com');
  assert.notEqual(user.hasLoggedIn, true, 'dry run must not write');
});

// ── The API contract ─────────────────────────────────────────────────────────

test('analytics-summary returns internally consistent user metrics', async () => {
  reset();
  process.env.KHAN_ADMIN_PASSCODE = 'test-admin-passcode';
  const { issueToken: issueAdmin } = await import('../netlify/functions/_adminAuth.mjs');

  await registerUser('a@example.com');
  await registerUser('b@example.com');
  await seedLegacyUser('c1', 'c@example.com'); // never logged in

  const res = await analyticsSummary({
    httpMethod: 'GET',
    headers: { authorization: `Bearer ${issueAdmin()}` },
    queryStringParameters: {},
  });
  assert.equal(res.statusCode, 200);
  const { userAnalytics } = parse(res);

  assert.equal(userAnalytics.registeredUsers, 3);
  assert.equal(userAnalytics.loggedInUsers, 2);
  assert.equal(userAnalytics.neverLoggedInUsers, 1);
  assert.equal(
    userAnalytics.registeredUsers,
    userAnalytics.loggedInUsers + userAnalytics.neverLoggedInUsers,
    'the API must never serve figures that do not add up'
  );
  assert.equal(userAnalytics.activeToday, 2);
  assert.equal(userAnalytics.activeLast7Days, 2);

  // Legacy aliases still resolve, and now carry the CORRECT values.
  assert.equal(userAnalytics.registeredTotal, userAnalytics.registeredUsers);
  assert.equal(userAnalytics.loggedInVisitors, userAnalytics.loggedInUsers);
  assert.equal(userAnalytics.activeUsersToday, userAnalytics.activeToday);
});

test('the production symptom cannot recur: loggedIn never equals registered while neverLoggedIn > 0', async () => {
  reset();
  // Reproduces the exact reported shape — a population where most accounts
  // registered and only some ever came back.
  for (let i = 0; i < 40; i += 1) await seedLegacyUser(`p${i}`, `p${i}@example.com`);
  const now = Date.now();
  for (let i = 0; i < 12; i += 1) await recordSuccessfulAuth(`p${i}`, { now });

  const s = await getUserLoginStats({ now });
  assert.equal(s.registeredUsers, 40);
  assert.equal(s.loggedInUsers, 12);
  assert.equal(s.neverLoggedInUsers, 28);
  // The reported bug was 206 = 206 logged in AND 166 never logged in.
  assert.ok(
    !(s.loggedInUsers === s.registeredUsers && s.neverLoggedInUsers > 0),
    'loggedIn === registered while neverLoggedIn > 0 is arithmetically impossible'
  );
  await assertInvariant('production-shape');
});
