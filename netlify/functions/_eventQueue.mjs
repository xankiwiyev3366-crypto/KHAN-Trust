// THE DURABLE OUTBOX. Work that must happen, but must not happen inside the
// user's request.
//
// The problem it exists to solve is concrete. verify-order-activate.mjs is the
// moment money becomes a badge. It must also send a receipt email, notify an
// admin over Telegram, and record a funnel event. Doing those inline means:
//
//   - the buyer waits on Resend and Telegram before seeing their badge, and
//   - if Resend is down, the activation either FAILS (the customer paid and got
//     nothing) or the email is LOST (the customer paid and heard nothing).
//
// Neither is acceptable, and "await it and swallow the error" — which is what
// the rest of this codebase reasonably does for genuinely optional side effects
// — quietly chooses the second one. A receipt for a $149 purchase is not an
// optional side effect.
//
// So the activation writes a JOB and returns. A worker drains it, with retries,
// backoff and a dead-letter shelf for anything that cannot be made to work.
//
// ── WHERE THE TRUTH LIVES (the same split _verificationOrders.mjs uses) ─────
//
//   Blobs      source of truth for job CONTENT. One key per job, so two writers
//              creating unrelated jobs never collide — the read-modify-write
//              pattern the older stores use would lose jobs under exactly the
//              burst a queue exists to absorb. Works with no DATABASE_URL.
//   Postgres   the LEASE, and only the lease. A key/value store cannot offer
//              compare-and-swap at any price (@netlify/blobs has no conditional
//              write), and "no two workers process this job at once" is a
//              constraint, not a convention.
//
// The lease is one tiny row per in-flight job, taken with a single atomic
// statement (see claimLease). It is modelled exactly like
// verification_active_contracts: a separate table, no foreign key to the job —
// because the job lives in Blobs and may not be mirrored anywhere.
//
// ── WITHOUT DATABASE_URL ────────────────────────────────────────────────────
//
// The lease degrades to a write-then-reread check against the job blob, which is
// racy: two workers a few hundred milliseconds apart can both believe they hold
// it. This is stated rather than papered over, and it is survivable for one
// reason that is designed in rather than hoped for:
//
//   EVERY HANDLER IS IDEMPOTENT ANYWAY.
//
// Email sends are guarded by a per-(order, stage) sent-ledger, the Premium bonus
// by grantTimedBonus's monotonic rule, payment by the shared signature ledger,
// activation by the order's own status check. Double-processing a job is
// therefore absorbed, not harmful. The lease is there to stop wasted work and
// duplicate outbound noise, not to be the last line of defence — because a lease
// never can be. Set DATABASE_URL and the window closes; the worker logs which
// mode it ran in so the difference is visible rather than assumed.
import { getNamedStore } from './_blobsClient.mjs';
import { mirror, readRows, dbConfigured } from './_db.mjs';

const STORE_NAME = 'khan-trust-queue';
const JOB_PREFIX = 'job/';
const DEAD_PREFIX = 'dead/';
const DEDUP_PREFIX = 'dedup/';

export const JOB_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  DEAD_LETTER: 'dead_letter',
};

// Five attempts over roughly half an hour, then the shelf.
//
// The backoff is EXPONENTIAL because the failures this queue actually sees are
// provider outages and rate limits, and a fixed-interval retry against a
// rate-limited provider is indistinguishable from the traffic that got you rate
// limited. It is CAPPED because an unbounded curve means a job that fails at
// hour one is next attempted next week, by which time the expiry reminder it
// carried is about an expiry that already happened.
export const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [30_000, 120_000, 600_000, 1_800_000];

export function backoffFor(attempts) {
  return BACKOFF_MS[Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1];
}

// How long a worker may hold a job before another worker may take it.
//
// Sized off the Netlify background-function ceiling (15 minutes): a lease
// shorter than the maximum possible run would let a second worker start on a job
// the first is still legitimately working on. Slightly longer, so the only way a
// lease expires is a worker that actually died.
const LEASE_MS = 16 * 60 * 1000;

function store() {
  return getNamedStore(STORE_NAME);
}

function jobKey(id) {
  return `${JOB_PREFIX}${id}`;
}

function newJobId() {
  return `job-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ── Enqueue ─────────────────────────────────────────────────────────────────

// `dedupKey` is the idempotency guarantee at the ENQUEUE boundary, distinct from
// the one each handler applies at the PROCESSING boundary. Both are needed and
// they catch different things: this one stops a retried HTTP request creating a
// second job at all; the handler's stops a job that was created twice from
// sending two emails.
//
// The marker is written BEFORE the job, so the failure mode is "a dedup marker
// with no job" (the event is dropped, loudly, and can be replayed) rather than
// "a job with no marker" (the event is delivered twice, silently). Between those
// two, the recoverable one is chosen on purpose.
export async function enqueue({ type, payload = {}, dedupKey = '', runAfter = 0 }) {
  if (!type) throw new Error('enqueue requires a type');
  const s = store();
  const now = Date.now();

  if (dedupKey) {
    const marker = `${DEDUP_PREFIX}${encodeURIComponent(dedupKey)}`;
    const existing = await s.get(marker, { type: 'json' }).catch(() => null);
    if (existing?.jobId) return { ok: true, deduplicated: true, id: existing.jobId };
    await s.setJSON(marker, { jobId: 'pending', createdAt: new Date(now).toISOString() }).catch(() => {});
    const job = buildJob({ type, payload, dedupKey, runAfter, now });
    await s.setJSON(jobKey(job.id), job);
    await s.setJSON(marker, { jobId: job.id, createdAt: job.createdAt }).catch(() => {});
    await mirrorJob(job);
    return { ok: true, deduplicated: false, id: job.id };
  }

  const job = buildJob({ type, payload, dedupKey, runAfter, now });
  await s.setJSON(jobKey(job.id), job);
  await mirrorJob(job);
  return { ok: true, deduplicated: false, id: job.id };
}

export function buildJob({ type, payload, dedupKey, runAfter = 0, now = Date.now() }) {
  return {
    id: newJobId(),
    type,
    payload,
    dedupKey: dedupKey || '',
    status: JOB_STATUS.PENDING,
    attempts: 0,
    lastError: '',
    // A scheduled job (an expiry reminder, a retry) is not due yet. Stored as an
    // absolute time rather than a delay so a worker restart cannot reset the
    // clock and fire everything at once.
    runAfter: new Date(now + Math.max(0, runAfter)).toISOString(),
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    completedAt: '',
    workerId: '',
  };
}

// Best-effort reporting projection. NEVER fails the enqueue — the Blob above is
// the record, exactly as putOrder() treats its own mirror.
async function mirrorJob(job) {
  try {
    await mirror(
      `INSERT INTO queue_jobs (id, type, status, attempts, dedup_key, last_error, run_after, created_at, updated_at, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now(), $9)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         attempts = EXCLUDED.attempts,
         last_error = EXCLUDED.last_error,
         run_after = EXCLUDED.run_after,
         completed_at = EXCLUDED.completed_at,
         updated_at = now()`,
      [
        job.id, job.type, job.status, job.attempts, job.dedupKey || null,
        (job.lastError || '').slice(0, 500) || null, job.runAfter, job.createdAt,
        job.completedAt || null,
      ],
    );
  } catch { /* non-fatal by contract */ }
}

// ── Reading ─────────────────────────────────────────────────────────────────

export async function getJob(id) {
  const data = await store().get(jobKey(id), { type: 'json' }).catch(() => null);
  return data && typeof data === 'object' ? data : null;
}

// Every job currently on the queue, newest last. Bounded by `limit` so a worker
// with a large backlog does its share and exits inside its budget rather than
// timing out and completing none of it.
export async function listJobs({ status = '', limit = 200 } = {}) {
  const s = store();
  const { blobs } = await s.list({ prefix: JOB_PREFIX }).catch(() => ({ blobs: [] }));
  const jobs = (await Promise.all(
    blobs.slice(0, Math.max(limit, 0) * 4).map((blob) => s.get(blob.key, { type: 'json' }).catch(() => null)),
  )).filter(Boolean);
  const filtered = status ? jobs.filter((job) => job.status === status) : jobs;
  return filtered
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .slice(0, limit);
}

export async function listDeadLetters({ limit = 100 } = {}) {
  const s = store();
  const { blobs } = await s.list({ prefix: DEAD_PREFIX }).catch(() => ({ blobs: [] }));
  const jobs = (await Promise.all(
    blobs.slice(0, limit).map((blob) => s.get(blob.key, { type: 'json' }).catch(() => null)),
  )).filter(Boolean);
  return jobs.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

// Jobs that are due: pending, and past their runAfter. Ordered oldest-first so a
// backlog drains in the order it arrived rather than starving its oldest items.
export function dueJobs(jobs, now = Date.now()) {
  return jobs
    .filter((job) => job.status === JOB_STATUS.PENDING || job.status === JOB_STATUS.FAILED)
    .filter((job) => Date.parse(job.runAfter || job.createdAt) <= now)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

// ── The lease ───────────────────────────────────────────────────────────────

// Returns { won, enforcedBy }. See the file header for what each mode means and
// what the degraded one actually risks.
//
// The Postgres statement is a single atomic take-or-fail. `DO UPDATE ... WHERE
// queue_leases.expires_at < now()` is the whole trick: a live lease makes the
// UPDATE match no rows, so RETURNING is empty and the caller loses. A dead lease
// (the worker crashed) is reclaimed by the same statement, so a crashed worker
// cannot wedge a job forever.
export async function claimLease(jobId, workerId, now = Date.now()) {
  if (!jobId || !workerId) return { won: false, enforcedBy: 'none' };
  const expires = new Date(now + LEASE_MS).toISOString();

  if (dbConfigured()) {
    const result = await readRows(
      `INSERT INTO queue_leases (job_id, worker_id, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (job_id) DO UPDATE
         SET worker_id = EXCLUDED.worker_id, expires_at = EXCLUDED.expires_at
         WHERE queue_leases.expires_at < now()
       RETURNING worker_id`,
      [jobId, workerId, expires],
      { label: 'queue_lease' },
    );
    if (result.ok) return { won: result.rows.length > 0, enforcedBy: 'postgres' };
    // Configured but unreachable. Fall through rather than refusing to work: a
    // database outage must not stop receipts and expiry notices going out. The
    // degradation is logged by readRows() and the double-process it admits is
    // absorbed by the handlers' own idempotency.
    console.warn('[queue] lease fell back to Blobs — Postgres unavailable');
  }

  // Degraded path: write our claim, then read it back. This does not make the
  // race impossible — nothing available here can — it makes the common case
  // (two workers seconds apart, not milliseconds) correct.
  const job = await getJob(jobId);
  if (!job) return { won: false, enforcedBy: 'blobs' };
  if (job.status === JOB_STATUS.PROCESSING && Date.parse(job.updatedAt) + LEASE_MS > now) {
    return { won: false, enforcedBy: 'blobs' };
  }
  await store().setJSON(jobKey(jobId), {
    ...job,
    status: JOB_STATUS.PROCESSING,
    workerId,
    updatedAt: new Date(now).toISOString(),
  });
  const confirmed = await getJob(jobId);
  return { won: confirmed?.workerId === workerId, enforcedBy: 'blobs' };
}

export async function releaseLease(jobId) {
  if (!dbConfigured() || !jobId) return;
  await mirror('DELETE FROM queue_leases WHERE job_id = $1', [jobId]);
}

// ── Completion, failure, dead-lettering ─────────────────────────────────────

export async function markProcessing(job, workerId, now = Date.now()) {
  const next = {
    ...job,
    status: JOB_STATUS.PROCESSING,
    workerId,
    attempts: job.attempts + 1,
    updatedAt: new Date(now).toISOString(),
  };
  await store().setJSON(jobKey(job.id), next);
  await mirrorJob(next);
  return next;
}

// Completed jobs are DELETED from the live prefix, not left as tombstones.
//
// listJobs() reads every key under job/ on every worker tick, so tombstones
// would make the queue's read cost grow forever with total historical volume —
// the exact ceiling _growthEvents.mjs was designed to escape. The audit trail
// does not depend on them: the Postgres projection keeps the completed row, and
// the receipt/email ledgers keep the outcome that actually matters.
export async function markCompleted(job, now = Date.now()) {
  const next = { ...job, status: JOB_STATUS.COMPLETED, completedAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), lastError: '' };
  await mirrorJob(next);
  await store().delete(jobKey(job.id)).catch(() => {});
  await releaseLease(job.id);
  return next;
}

// A failure that will be retried, or — once the attempt budget is spent — one
// that will not.
//
// THE DEAD LETTER IS MOVED, NOT DELETED, and it keeps its payload and its last
// error. That is the "safe recovery path": an operator can read exactly what was
// attempted and requeue it. A queue that discards what it could not deliver is a
// queue that loses a customer's receipt and cannot tell you it happened.
export async function markFailed(job, error, now = Date.now()) {
  const message = String(error?.message || error || 'unknown error').slice(0, 500);
  const s = store();

  if (job.attempts >= MAX_ATTEMPTS) {
    const dead = { ...job, status: JOB_STATUS.DEAD_LETTER, lastError: message, updatedAt: new Date(now).toISOString() };
    // Written to the shelf BEFORE being removed from the live prefix, so a
    // failure between the two leaves the job visible twice rather than not at
    // all.
    await s.setJSON(`${DEAD_PREFIX}${job.id}`, dead);
    await s.delete(jobKey(job.id)).catch(() => {});
    await mirrorJob(dead);
    await releaseLease(job.id);
    console.error(`[queue] job ${job.id} (${job.type}) dead-lettered after ${job.attempts} attempts: ${message}`);
    return dead;
  }

  const next = {
    ...job,
    status: JOB_STATUS.FAILED,
    lastError: message,
    runAfter: new Date(now + backoffFor(job.attempts)).toISOString(),
    workerId: '',
    updatedAt: new Date(now).toISOString(),
  };
  await s.setJSON(jobKey(job.id), next);
  await mirrorJob(next);
  await releaseLease(job.id);
  return next;
}

// Operator action: put a dead letter back on the queue.
//
// A NEW id, and the attempt counter reset. Reusing the id would collide with the
// Postgres projection row that records why it died, and that row is the only
// evidence of the incident.
export async function requeueDeadLetter(id, { now = Date.now() } = {}) {
  const s = store();
  const dead = await s.get(`${DEAD_PREFIX}${id}`, { type: 'json' }).catch(() => null);
  if (!dead) return { ok: false, reason: 'not_found' };
  const job = {
    ...buildJob({ type: dead.type, payload: dead.payload, dedupKey: '', now }),
    // The dedup key is deliberately DROPPED. It has already been consumed by the
    // original enqueue, so keeping it would make the requeue a silent no-op —
    // the operator would click "retry" and nothing would happen. Handler-level
    // idempotency still protects against an actual duplicate delivery.
    payload: { ...dead.payload, requeuedFrom: id },
  };
  await s.setJSON(jobKey(job.id), job);
  await mirrorJob(job);
  await s.delete(`${DEAD_PREFIX}${id}`).catch(() => {});
  return { ok: true, id: job.id };
}

export async function queueStats() {
  const [live, dead] = await Promise.all([
    listJobs({ limit: 500 }).catch(() => []),
    listDeadLetters({ limit: 500 }).catch(() => []),
  ]);
  const counts = { pending: 0, processing: 0, failed: 0, dead_letter: dead.length };
  for (const job of live) {
    if (job.status === JOB_STATUS.PENDING) counts.pending += 1;
    else if (job.status === JOB_STATUS.PROCESSING) counts.processing += 1;
    else if (job.status === JOB_STATUS.FAILED) counts.failed += 1;
  }
  return counts;
}
