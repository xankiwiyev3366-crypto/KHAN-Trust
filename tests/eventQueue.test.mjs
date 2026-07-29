// Phase 5 — the durable outbox: retries, backoff, dead-lettering, concurrency
// safety and idempotent enqueue.
//
// The whole reason receipts and expiry notices go through a queue is that they
// must not be lost. Every test here is about a way they could be lost anyway.
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

// DATABASE_URL is deliberately absent for most of these, so they exercise the
// DEGRADED Blobs-only path — the one the module's header admits is racy. That is
// the path a deployment without Postgres actually runs, so it is the one that
// most needs covering.
mock.module('../netlify/functions/_db.mjs', {
  namedExports: {
    mirror: async () => ({ ok: false, skipped: true }),
    readRows: async () => ({ ok: false, reason: 'no_database_url' }),
    dbConfigured: () => false,
  },
});

const {
  enqueue,
  getJob,
  listJobs,
  listDeadLetters,
  dueJobs,
  claimLease,
  markProcessing,
  markCompleted,
  markFailed,
  requeueDeadLetter,
  queueStats,
  backoffFor,
  buildJob,
  JOB_STATUS,
  MAX_ATTEMPTS,
} = await import('../netlify/functions/_eventQueue.mjs');

function reset() {
  stores.clear();
}

// ── Enqueue and idempotency ─────────────────────────────────────────────────

test('a job survives an enqueue and can be read back', async () => {
  reset();
  const { id } = await enqueue({ type: 'mail.send', payload: { orderId: 'vo-1', stage: 'activated' } });
  const job = await getJob(id);
  assert.equal(job.type, 'mail.send');
  assert.equal(job.status, JOB_STATUS.PENDING);
  assert.equal(job.attempts, 0);
  assert.deepEqual(job.payload, { orderId: 'vo-1', stage: 'activated' });
});

test('the same dedup key never creates a second job', async () => {
  reset();
  const first = await enqueue({ type: 'mail.send', dedupKey: 'mail:vo-1:activated', payload: { orderId: 'vo-1' } });
  const second = await enqueue({ type: 'mail.send', dedupKey: 'mail:vo-1:activated', payload: { orderId: 'vo-1' } });

  assert.equal(second.deduplicated, true);
  assert.equal(second.id, first.id);
  assert.equal((await listJobs({ limit: 50 })).length, 1);
});

test('different dedup keys create different jobs', async () => {
  reset();
  await enqueue({ type: 'mail.send', dedupKey: 'a', payload: {} });
  await enqueue({ type: 'mail.send', dedupKey: 'b', payload: {} });
  assert.equal((await listJobs({ limit: 50 })).length, 2);
});

test('a job with no dedup key is always created (repeatable work is legitimate)', async () => {
  reset();
  await enqueue({ type: 'admin.alert', payload: { kind: 'activated' } });
  await enqueue({ type: 'admin.alert', payload: { kind: 'activated' } });
  assert.equal((await listJobs({ limit: 50 })).length, 2);
});

// ── Scheduling ──────────────────────────────────────────────────────────────

test('a job scheduled for later is not due yet', async () => {
  reset();
  await enqueue({ type: 'mail.send', payload: {}, runAfter: 60_000 });
  const jobs = await listJobs({ limit: 10 });
  assert.equal(dueJobs(jobs, Date.now()).length, 0);
  assert.equal(dueJobs(jobs, Date.now() + 61_000).length, 1);
});

test('the backlog drains oldest-first so nothing starves', async () => {
  reset();
  const older = buildJob({ type: 'a', payload: {}, now: Date.parse('2026-07-01T00:00:00Z') });
  const newer = buildJob({ type: 'b', payload: {}, now: Date.parse('2026-07-02T00:00:00Z') });
  const ordered = dueJobs([newer, older], Date.parse('2026-07-03T00:00:00Z'));
  assert.deepEqual(ordered.map((j) => j.type), ['a', 'b']);
});

// ── Retries and backoff ─────────────────────────────────────────────────────

test('backoff grows and is capped', () => {
  const first = backoffFor(1);
  const second = backoffFor(2);
  const last = backoffFor(MAX_ATTEMPTS);
  assert.ok(second > first, 'backoff must grow');
  // Capped, so a job that failed at hour one is not next attempted next week —
  // by which time the expiry reminder it carried is about an expiry that
  // already happened.
  assert.ok(last <= 30 * 60 * 1000, `backoff should be capped, got ${last}ms`);
  assert.equal(backoffFor(99), last, 'past the table it must clamp, not undefined');
});

test('a retryable failure reschedules the job instead of losing it', async () => {
  reset();
  const { id } = await enqueue({ type: 'mail.send', payload: {} });
  const running = await markProcessing(await getJob(id), 'w1');
  const failed = await markFailed(running, new Error('provider down'));

  assert.equal(failed.status, JOB_STATUS.FAILED);
  assert.equal(failed.attempts, 1);
  assert.match(failed.lastError, /provider down/);
  assert.ok(Date.parse(failed.runAfter) > Date.now(), 'must wait on its backoff');
  // Still on the queue, so a later worker picks it up.
  assert.ok(await getJob(id));
});

test('a job that exhausts its attempts is dead-lettered, not deleted', async () => {
  reset();
  const { id } = await enqueue({ type: 'mail.send', payload: { orderId: 'vo-9' } });
  let job = await getJob(id);
  for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
    job = await markProcessing(job, 'w1');
    job = await markFailed(job, new Error(`attempt ${i}`));
    if (job.status === JOB_STATUS.DEAD_LETTER) break;
    job = await getJob(id);
  }

  assert.equal(job.status, JOB_STATUS.DEAD_LETTER);
  // Off the live queue...
  assert.equal(await getJob(id), null);
  // ...but on the shelf, WITH its payload and its error, so it can be acted on.
  const dead = await listDeadLetters({ limit: 10 });
  assert.equal(dead.length, 1);
  assert.deepEqual(dead[0].payload, { orderId: 'vo-9' });
  assert.ok(dead[0].lastError);
});

test('an error message is bounded, so a provider echoing the request cannot leak it', async () => {
  reset();
  const { id } = await enqueue({ type: 'mail.send', payload: {} });
  const running = await markProcessing(await getJob(id), 'w1');
  const failed = await markFailed(running, new Error('x'.repeat(5000)));
  assert.ok(failed.lastError.length <= 500, `error not truncated: ${failed.lastError.length}`);
});

// ── Completion ──────────────────────────────────────────────────────────────

test('a completed job leaves the live prefix so read cost cannot grow forever', async () => {
  reset();
  const { id } = await enqueue({ type: 'mail.send', payload: {} });
  const running = await markProcessing(await getJob(id), 'w1');
  const done = await markCompleted(running);

  assert.equal(done.status, JOB_STATUS.COMPLETED);
  assert.equal(await getJob(id), null);
  assert.equal((await listJobs({ limit: 50 })).length, 0);
});

// ── Concurrency ─────────────────────────────────────────────────────────────

test('two workers cannot both hold a job (degraded Blobs lease)', async () => {
  reset();
  const { id } = await enqueue({ type: 'mail.send', payload: {} });

  const first = await claimLease(id, 'worker-1');
  const second = await claimLease(id, 'worker-2');

  assert.equal(first.won, true);
  assert.equal(second.won, false, 'a second worker must not take a live lease');
  assert.equal(first.enforcedBy, 'blobs');
});

test('a lease on a job that does not exist is never won', async () => {
  reset();
  const result = await claimLease('job-missing', 'worker-1');
  assert.equal(result.won, false);
});

test('claiming requires both a job id and a worker id', async () => {
  reset();
  assert.equal((await claimLease('', 'w')).won, false);
  assert.equal((await claimLease('job-1', '')).won, false);
});

// ── Recovery ────────────────────────────────────────────────────────────────

test('a dead letter can be requeued, and the requeue is not silently deduped away', async () => {
  reset();
  // A job whose ORIGINAL enqueue carried a dedup key. Keeping that key on the
  // requeue would make the operator's retry a no-op — they would click and
  // nothing would happen.
  const { id } = await enqueue({ type: 'mail.send', dedupKey: 'mail:vo-1:activated', payload: { orderId: 'vo-1' } });
  let job = await getJob(id);
  for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
    job = await markProcessing(job, 'w1');
    job = await markFailed(job, new Error('nope'));
    if (job.status === JOB_STATUS.DEAD_LETTER) break;
    job = await getJob(id);
  }

  const result = await requeueDeadLetter(id);
  assert.equal(result.ok, true);
  assert.notEqual(result.id, id, 'a requeue gets a NEW id so the incident record survives');

  const requeued = await getJob(result.id);
  assert.equal(requeued.status, JOB_STATUS.PENDING);
  assert.equal(requeued.attempts, 0, 'the attempt budget is reset');
  assert.equal(requeued.dedupKey, '', 'the consumed dedup key must not block the retry');
  assert.equal(requeued.payload.requeuedFrom, id, 'provenance is kept');

  // And it is off the shelf, so a second click is a no-op rather than a copy.
  assert.equal((await listDeadLetters({ limit: 10 })).length, 0);
  assert.equal((await requeueDeadLetter(id)).ok, false);
});

test('requeueing something that was never dead-lettered fails cleanly', async () => {
  reset();
  const result = await requeueDeadLetter('job-nope');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not_found');
});

// ── Reporting ───────────────────────────────────────────────────────────────

test('queue stats separate waiting work from failed work from dead work', async () => {
  reset();
  await enqueue({ type: 'a', payload: {} });
  const { id } = await enqueue({ type: 'b', payload: {} });
  const running = await markProcessing(await getJob(id), 'w1');
  await markFailed(running, new Error('x'));

  const stats = await queueStats();
  assert.equal(stats.pending, 1);
  assert.equal(stats.failed, 1);
  assert.equal(stats.dead_letter, 0);
});
