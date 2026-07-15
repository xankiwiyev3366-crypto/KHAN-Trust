// Integration tests for the event store's blob I/O.
//
// This is the highest-risk code in the data plane and the only part the pure
// warehouse tests cannot reach: the read/write/compact path is where events are
// actually kept or actually lost. The whole design exists to fix two specific
// defects in the old store (lost concurrent writes, a hard 20k ceiling), so the
// tests below prove those defects are gone rather than assuming it.
//
// Run with: node --experimental-test-module-mocks --test (see npm test).
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// An in-memory stand-in for Netlify Blobs. Only the four operations the store
// actually uses, with the same semantics: keys are opaque, list() is prefix
// filtered, and a missing key resolves null rather than throwing.
class FakeStore {
  constructor() {
    this.data = new Map();
  }

  async setJSON(key, value) {
    this.data.set(key, JSON.parse(JSON.stringify(value)));
  }

  async get(key) {
    return this.data.has(key) ? JSON.parse(JSON.stringify(this.data.get(key))) : null;
  }

  async list({ prefix } = {}) {
    const blobs = Array.from(this.data.keys())
      .filter((key) => !prefix || key.startsWith(prefix))
      .map((key) => ({ key }));
    return { blobs };
  }

  async delete(key) {
    this.data.delete(key);
  }
}

const fake = new FakeStore();

mock.module('../netlify/functions/_blobsClient.mjs', {
  namedExports: {
    getNamedStore: () => fake,
    jsonResponse: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
  },
});

const { putEvent, readDay, readWindow, compactDay, listRawDays, dayRange } =
  await import('../netlify/functions/_growthEvents.mjs');

function evt(id, day, type = 'page_view') {
  return { id, type, timestamp: `${day}T12:00:00.000Z`, visitorId: `v-${id}` };
}

test('concurrent writes do not clobber each other', async () => {
  // THE defect this store exists to fix. The old store read the whole array,
  // pushed, and wrote it back — two simultaneous visitors meant last-write-wins
  // and one event vanished forever, silently, and more often the busier the
  // platform got. One key per event makes the race structurally impossible.
  fake.data.clear();

  await Promise.all(
    Array.from({ length: 50 }, (_, i) => putEvent(evt(`e${i}`, '2026-07-15')))
  );

  const events = await readDay('2026-07-15');
  assert.equal(events.length, 50, 'every concurrent write must survive');
  assert.equal(new Set(events.map((e) => e.id)).size, 50, 'and none may be duplicated');
});

test('history is unbounded — there is no 20k cliff', async () => {
  // The old store silently dropped the oldest events past a cap, destroying the
  // long history that cohort retention depends on right when it finally existed.
  fake.data.clear();
  for (let i = 0; i < 100; i += 1) await putEvent(evt(`e${i}`, '2026-07-15'));
  assert.equal((await readDay('2026-07-15')).length, 100);
});

test('compaction preserves every event and removes the raw keys', async () => {
  fake.data.clear();
  for (let i = 0; i < 10; i += 1) await putEvent(evt(`e${i}`, '2026-07-14'));

  const before = await fake.list({ prefix: 'raw/2026-07-14/' });
  assert.equal(before.blobs.length, 10);

  const result = await compactDay('2026-07-14');
  assert.equal(result.compacted, 10);

  const after = await fake.list({ prefix: 'raw/2026-07-14/' });
  assert.equal(after.blobs.length, 0, 'raw keys must be cleaned up');
  assert.equal((await readDay('2026-07-14')).length, 10, 'and the day must read back intact');
});

test('compaction is idempotent', async () => {
  // A retry after a partial failure must never duplicate or lose events.
  fake.data.clear();
  for (let i = 0; i < 5; i += 1) await putEvent(evt(`e${i}`, '2026-07-13'));

  await compactDay('2026-07-13');
  await compactDay('2026-07-13');

  assert.equal((await readDay('2026-07-13')).length, 5);
});

test('a read mid-compaction sees each event exactly once', async () => {
  // Compaction writes the daily blob BEFORE deleting the raw keys it consumed,
  // so a day can legitimately hold both at once. readDay must dedupe that
  // overlap rather than double-count it.
  fake.data.clear();
  for (let i = 0; i < 5; i += 1) await putEvent(evt(`e${i}`, '2026-07-12'));

  // Simulate the window: daily blob written, raw keys not yet deleted.
  const raw = await readDay('2026-07-12');
  await fake.setJSON('daily/2026-07-12', raw);

  const events = await readDay('2026-07-12');
  assert.equal(events.length, 5, 'the overlap must be deduped, not double-counted');
});

test('a late write after compaction is not lost', async () => {
  // An event arriving for a day that was already compacted lands as a new raw
  // key. The union read is what keeps it.
  fake.data.clear();
  await putEvent(evt('early', '2026-07-11'));
  await compactDay('2026-07-11');
  await putEvent(evt('late', '2026-07-11'));

  const ids = (await readDay('2026-07-11')).map((e) => e.id).sort();
  assert.deepEqual(ids, ['early', 'late']);
});

test('readWindow spans days and returns chronological order', async () => {
  fake.data.clear();
  const now = Date.parse('2026-07-15T18:00:00.000Z');
  await putEvent(evt('a', '2026-07-13'));
  await putEvent(evt('b', '2026-07-14'));
  await putEvent(evt('c', '2026-07-15'));

  const events = await readWindow(3, now);
  assert.deepEqual(events.map((e) => e.id), ['a', 'b', 'c']);
});

test('readWindow excludes days outside the window', async () => {
  fake.data.clear();
  const now = Date.parse('2026-07-15T18:00:00.000Z');
  await putEvent(evt('old', '2026-06-01'));
  await putEvent(evt('recent', '2026-07-15'));

  assert.deepEqual((await readWindow(3, now)).map((e) => e.id), ['recent']);
});

test('listRawDays reports only days with uncompacted events', async () => {
  fake.data.clear();
  await putEvent(evt('a', '2026-07-10'));
  await putEvent(evt('b', '2026-07-11'));
  await compactDay('2026-07-10');

  assert.deepEqual(await listRawDays(), ['2026-07-11']);
});

test('dayRange is inclusive of today and correctly ordered', async () => {
  const now = Date.parse('2026-07-15T18:00:00.000Z');
  assert.deepEqual(dayRange(3, now), ['2026-07-13', '2026-07-14', '2026-07-15']);
});

test('an empty day is an empty list, not a crash', async () => {
  fake.data.clear();
  assert.deepEqual(await readDay('2026-01-01'), []);
});
