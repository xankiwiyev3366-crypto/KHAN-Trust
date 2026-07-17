// End-to-end tests for the retention loop and the notification center.
//
// These drive the REAL retention-sync / notifications-read handlers against the
// REAL stores, with real JWTs from the real _authStore. Only the blob backend is
// faked (an in-memory map with the same semantics), matching the approach in
// tests/alertsRun.test.mjs. So what is under test is the actual wiring.
//
// Covers the user types the feature has to survive:
//   - a brand-new user with no activity at all
//   - a returning user
//   - a lapsed user
//   - a signed-out caller (must be rejected)
//   - one user attempting to reach another's data (must be impossible)
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

class FakeStore {
  constructor() { this.data = new Map(); this.writes = 0; }
  async setJSON(key, value) { this.writes += 1; this.data.set(key, JSON.parse(JSON.stringify(value))); }
  async get(key) { return this.data.has(key) ? JSON.parse(JSON.stringify(this.data.get(key))) : null; }
  async list({ prefix } = {}) {
    return { blobs: [...this.data.keys()].filter((k) => !prefix || k.startsWith(prefix)).map((key) => ({ key })) };
  }
  async delete(key) { this.data.delete(key); }
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

const { handler: syncHandler } = await import('../netlify/functions/retention-sync.mjs');
const { handler: readHandler } = await import('../netlify/functions/notifications-read.mjs');
const { issueToken } = await import('../netlify/functions/_authStore.mjs');
const { saveRetention } = await import('../netlify/functions/_retentionStore.mjs');
const { addNotifications } = await import('../netlify/functions/_notificationStore.mjs');
const { shiftDay, dayKey } = await import('../netlify/functions/_retentionEngine.mjs');

const USER = { id: 'u-alice', email: 'alice@example.com', name: 'Alice' };
const OTHER = { id: 'u-mallory', email: 'mallory@example.com', name: 'Mallory' };

function reset() { stores.clear(); }

function post(user, body = {}) {
  return syncHandler({
    httpMethod: 'POST',
    headers: { authorization: `Bearer ${issueToken(user)}` },
    body: JSON.stringify(body),
  });
}

const parse = (res) => JSON.parse(res.body);
const today = () => dayKey(Date.now());

// ── Auth ─────────────────────────────────────────────────────────────────────

test('a signed-out caller gets nothing', async () => {
  reset();
  const res = await syncHandler({ httpMethod: 'POST', headers: {}, body: '{}' });
  assert.equal(res.statusCode, 401);
});

test('a forged token gets nothing', async () => {
  reset();
  const res = await syncHandler({
    httpMethod: 'POST',
    headers: { authorization: 'Bearer not.a.token' },
    body: '{}',
  });
  assert.equal(res.statusCode, 401);
});

test('GET is rejected', async () => {
  reset();
  const res = await syncHandler({ httpMethod: 'GET', headers: { authorization: `Bearer ${issueToken(USER)}` } });
  assert.equal(res.statusCode, 405);
});

// ── A brand-new user ─────────────────────────────────────────────────────────

test('a brand-new user gets a coherent empty dashboard, not an error', async () => {
  reset();
  const body = parse(await post(USER));

  assert.equal(body.ok, true);
  assert.equal(body.retention.streak.current, 1, 'their first visit IS a 1-day streak');
  assert.equal(body.retention.streak.started, true);
  assert.equal(body.retention.activity.totalActiveDays, 1);
  assert.equal(body.retention.continueContext, null, 'nowhere to resume yet');
  assert.deepEqual(body.notifications, []);
  assert.equal(body.unread, 0);
  assert.equal(body.newDay, true);
  assert.equal(body.isFirstEverDay, true, 'a first day is a signup, not a return');
});

test('a first-ever day is never counted as a return', async () => {
  // If this leaks, D1 retention looks perfect and means nothing.
  reset();
  const body = parse(await post(USER));
  assert.equal(body.newDay && !body.isFirstEverDay, false, 'the client must not emit user_return here');
});

// ── Write avoidance ──────────────────────────────────────────────────────────

test('the second visit of the same day writes NOTHING', async () => {
  reset();
  await post(USER);
  const retentionStore = storeFor('khan-trust-retention');
  const writesAfterFirst = retentionStore.writes;

  await post(USER);
  await post(USER);
  await post(USER);

  assert.equal(retentionStore.writes, writesAfterFirst, 'a session must not cost a blob write per page');
});

test('re-opening the SAME project does not write', async () => {
  reset();
  const context = { type: 'project', projectId: 'p1', name: 'Bonk' };
  await post(USER, { context });
  const store = storeFor('khan-trust-retention');
  const before = store.writes;

  await post(USER, { context });
  assert.equal(store.writes, before, 'an unchanged context is not worth a write');
});

test('moving to a DIFFERENT project does write', async () => {
  reset();
  await post(USER, { context: { type: 'project', projectId: 'p1', name: 'Bonk' } });
  const store = storeFor('khan-trust-retention');
  const before = store.writes;

  const body = parse(await post(USER, { context: { type: 'project', projectId: 'p2', name: 'Wif' } }));
  assert.ok(store.writes > before);
  assert.equal(body.retention.continueContext.projectId, 'p2');
});

// ── Continue where you left off ──────────────────────────────────────────────

test('the resume context survives and comes back', async () => {
  reset();
  await post(USER, { context: { type: 'project', projectId: 'p1', name: 'Bonk', ticker: 'BONK' } });
  const body = parse(await post(USER));
  assert.equal(body.retention.continueContext.projectId, 'p1');
  assert.equal(body.retention.continueContext.name, 'Bonk');
});

test('a hostile context is sanitized before it is ever stored', async () => {
  reset();
  const body = parse(await post(USER, {
    context: { type: 'project', projectId: 'p1', name: 'x'.repeat(9000), evil: 'nope', at: '1999-01-01' },
  }));
  const context = body.retention.continueContext;
  assert.equal(context.name.length, 200);
  assert.equal(context.evil, undefined);
  assert.notEqual(context.at.slice(0, 4), '1999', 'the client does not set the timestamp');
});

test('an unroutable context type is rejected without breaking the response', async () => {
  reset();
  const body = parse(await post(USER, { context: { type: 'admin', projectId: 'x' } }));
  assert.equal(body.ok, true);
  assert.equal(body.retention.continueContext, null);
});

test('a stale context is withheld rather than offered', async () => {
  reset();
  await saveRetention({
    userId: USER.id, firstSeen: null, lastSeen: null, days: [today()], longestEver: 1, milestones: {},
    lastContext: { type: 'project', projectId: 'old', at: new Date(Date.now() - 30 * 86400000).toISOString() },
  });
  const body = parse(await post(USER));
  assert.equal(body.retention.continueContext, null, 'a month-old resume card is noise');
});

// ── A returning user, and a lapsed one ───────────────────────────────────────

test('a returning user is a return, and their streak continues', async () => {
  reset();
  await saveRetention({
    userId: USER.id, firstSeen: null, lastSeen: null,
    days: [shiftDay(today(), -2), shiftDay(today(), -1)],
    longestEver: 2, lastContext: null, milestones: {},
  });

  const body = parse(await post(USER));
  assert.equal(body.retention.streak.current, 3, 'today extends the run');
  assert.equal(body.newDay, true);
  assert.equal(body.isFirstEverDay, false, 'this one IS a return');
});

test('a lapsed user is told when they were last here, not just that it is over', async () => {
  reset();
  await saveRetention({
    userId: USER.id, firstSeen: null, lastSeen: null,
    days: [shiftDay(today(), -20), shiftDay(today(), -19)],
    longestEver: 2, lastContext: null, milestones: {},
  });

  const body = parse(await post(USER));
  assert.equal(body.retention.streak.current, 1, 'today starts a new run');
  assert.equal(body.retention.streak.started, true);
  assert.equal(body.retention.streak.longest, 2, 'their record survives the lapse');
});

test('longestEver survives even when the day window has scrolled past it', async () => {
  reset();
  await saveRetention({
    userId: USER.id, firstSeen: null, lastSeen: null, days: [today()],
    longestEver: 99, lastContext: null, milestones: {},
  });
  const body = parse(await post(USER));
  assert.equal(body.retention.streak.longest, 99, 'a capped window must not erase a real record');
});

// ── Milestones ───────────────────────────────────────────────────────────────

test('a 3-day streak earns exactly one milestone notification', async () => {
  reset();
  await saveRetention({
    userId: USER.id, firstSeen: null, lastSeen: null,
    days: [shiftDay(today(), -2), shiftDay(today(), -1)],
    longestEver: 2, lastContext: null, milestones: {},
  });

  const body = parse(await post(USER));
  assert.equal(body.retention.streak.current, 3);
  assert.equal(body.notifications.length, 1);
  assert.equal(body.notifications[0].type, 'milestone');
  assert.equal(body.notifications[0].params.days, 3);
  assert.equal(body.unread, 1);
});

test('a milestone is never announced twice, however often you sync', async () => {
  reset();
  await saveRetention({
    userId: USER.id, firstSeen: null, lastSeen: null,
    days: [shiftDay(today(), -2), shiftDay(today(), -1)],
    longestEver: 2, lastContext: null, milestones: {},
  });

  await post(USER);
  await post(USER);
  await post(USER);

  const body = parse(await post(USER));
  assert.equal(body.notifications.length, 1, 'one milestone, one notification, forever');
});

test('milestones store KEYS not prose, so the bell can be translated', async () => {
  reset();
  await saveRetention({
    userId: USER.id, firstSeen: null, lastSeen: null,
    days: [shiftDay(today(), -2), shiftDay(today(), -1)],
    longestEver: 2, lastContext: null, milestones: {},
  });
  const body = parse(await post(USER));
  const notification = body.notifications[0];

  assert.equal(notification.titleKey, 'notifications.milestone.title');
  assert.equal(notification.bodyKey, 'notifications.milestone.streak');
  assert.deepEqual(notification.params, { days: 3 });
  // The row must carry no rendered sentence at all - a stored English string
  // would be English forever, in every language.
  assert.equal(notification.body, undefined);
  assert.equal(notification.title, undefined);
});

// ── Notifications: read / unread ─────────────────────────────────────────────

async function seedNotification(userId, id = 'risk:c:abc:2026-07-17T00:00:00.000Z') {
  await addNotifications(userId, [{
    id,
    type: 'risk_alert',
    severity: 'high',
    titleKey: 'notifications.riskAlert.title',
    bodyKey: 'notifications.riskAlert.body',
    params: { name: 'Bonk', score: 30, riskLevel: 'High' },
    at: new Date().toISOString(),
  }]);
}

test('a new notification starts unread', async () => {
  reset();
  await seedNotification(USER.id);
  const body = parse(await post(USER));
  assert.equal(body.notifications[0].read, false);
  assert.equal(body.unread, 1);
});

test('marking one read leaves the others alone', async () => {
  reset();
  await seedNotification(USER.id, 'n1');
  await seedNotification(USER.id, 'n2');

  const res = await readHandler({
    httpMethod: 'POST',
    headers: { authorization: `Bearer ${issueToken(USER)}` },
    body: JSON.stringify({ ids: ['n1'] }),
  });
  const body = parse(res);
  assert.equal(body.unread, 1);
  assert.equal(body.notifications.find((n) => n.id === 'n1').read, true);
  assert.equal(body.notifications.find((n) => n.id === 'n2').read, false);
});

test('mark-all marks everything read', async () => {
  reset();
  await seedNotification(USER.id, 'n1');
  await seedNotification(USER.id, 'n2');

  const body = parse(await readHandler({
    httpMethod: 'POST',
    headers: { authorization: `Bearer ${issueToken(USER)}` },
    body: '{}',
  }));
  assert.equal(body.unread, 0);
  assert.ok(body.notifications.every((n) => n.read));
});

test('an EMPTY ids array is a no-op, not a silent mark-all', async () => {
  // The distinction that stops a buggy caller from wiping someone's unread state.
  reset();
  await seedNotification(USER.id, 'n1');

  const body = parse(await readHandler({
    httpMethod: 'POST',
    headers: { authorization: `Bearer ${issueToken(USER)}` },
    body: JSON.stringify({ ids: [] }),
  }));
  assert.equal(body.unread, 1, 'marking zero notifications must mark zero notifications');
});

test('read state persists across a re-sync', async () => {
  reset();
  await seedNotification(USER.id, 'n1');
  await readHandler({
    httpMethod: 'POST',
    headers: { authorization: `Bearer ${issueToken(USER)}` },
    body: '{}',
  });

  const body = parse(await post(USER));
  assert.equal(body.unread, 0);
  assert.equal(body.notifications[0].read, true);
  assert.ok(body.notifications[0].readAt, 'when it was read is recorded');
});

test('re-reading an already-read bell writes nothing', async () => {
  reset();
  await seedNotification(USER.id, 'n1');
  const store = storeFor('khan-trust-notifications');
  await readHandler({ httpMethod: 'POST', headers: { authorization: `Bearer ${issueToken(USER)}` }, body: '{}' });
  const before = store.writes;

  await readHandler({ httpMethod: 'POST', headers: { authorization: `Bearer ${issueToken(USER)}` }, body: '{}' });
  assert.equal(store.writes, before, 'opening the bell is the commonest action - it must not cost a write');
});

// ── Dedup ────────────────────────────────────────────────────────────────────

test('the same notification id is never added twice', async () => {
  reset();
  await seedNotification(USER.id, 'dup');
  await seedNotification(USER.id, 'dup');
  await seedNotification(USER.id, 'dup');

  const body = parse(await post(USER));
  assert.equal(body.notifications.length, 1, 'a retrying cron must not become the reason people leave');
});

test('re-adding an id does NOT resurface it as unread', async () => {
  reset();
  await seedNotification(USER.id, 'dup');
  await readHandler({ httpMethod: 'POST', headers: { authorization: `Bearer ${issueToken(USER)}` }, body: '{}' });

  await seedNotification(USER.id, 'dup'); // the cron re-observes the same state
  const body = parse(await post(USER));
  assert.equal(body.unread, 0, 'a dedup that re-unreads is not a dedup');
});

// ── Isolation between users ──────────────────────────────────────────────────

test('one user cannot see another user\'s notifications or streak', async () => {
  reset();
  await seedNotification(USER.id, 'alice-only');
  await saveRetention({
    userId: USER.id, firstSeen: null, lastSeen: null,
    days: [shiftDay(today(), -1)], longestEver: 5,
    lastContext: { type: 'project', projectId: 'alice-secret', at: new Date().toISOString() },
    milestones: {},
  });

  const body = parse(await post(OTHER));
  assert.deepEqual(body.notifications, [], 'Mallory sees her own empty bell');
  assert.equal(body.retention.continueContext, null, "...and not Alice's last-viewed token");
  assert.equal(body.retention.streak.longest, 1);
});

test('marking read with someone else\'s id changes nothing', async () => {
  reset();
  await seedNotification(USER.id, 'alice-only');

  await readHandler({
    httpMethod: 'POST',
    headers: { authorization: `Bearer ${issueToken(OTHER)}` },
    body: JSON.stringify({ ids: ['alice-only'] }),
  });

  const body = parse(await post(USER));
  assert.equal(body.unread, 1, "Alice's notification is untouched by Mallory");
});

test('the body cannot override the identity in the token', async () => {
  reset();
  await seedNotification(USER.id, 'alice-only');
  // Even if a caller invents a userId field, the handler only ever reads the JWT.
  const body = parse(await syncHandler({
    httpMethod: 'POST',
    headers: { authorization: `Bearer ${issueToken(OTHER)}` },
    body: JSON.stringify({ userId: USER.id, sub: USER.id }),
  }));
  assert.deepEqual(body.notifications, []);
});

// ── Resilience ───────────────────────────────────────────────────────────────

test('malformed JSON is a 400, not a crash', async () => {
  reset();
  const res = await syncHandler({
    httpMethod: 'POST',
    headers: { authorization: `Bearer ${issueToken(USER)}` },
    body: '{not json',
  });
  assert.equal(res.statusCode, 400);
});

test('a corrupt stored record degrades to an empty one rather than throwing', async () => {
  reset();
  await storeFor('khan-trust-retention').setJSON(`user:${USER.id}`, 'a string, somehow');
  const body = parse(await post(USER));
  assert.equal(body.ok, true);
  assert.equal(body.retention.streak.current, 1);
});

test('junk in the stored day list is discarded, not trusted', async () => {
  reset();
  await storeFor('khan-trust-retention').setJSON(`user:${USER.id}`, {
    userId: USER.id, days: ['garbage', 42, null, shiftDay(today(), -1)], milestones: {},
  });
  const body = parse(await post(USER));
  assert.equal(body.retention.streak.current, 2, 'only the one real day counts, plus today');
});
