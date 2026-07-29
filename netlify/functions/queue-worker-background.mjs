// POST /.netlify/functions/queue-worker-background
// Authorization: Bearer <admin HMAC token>
//
// Drains the durable outbox. A BACKGROUND function (the `-background` suffix is
// what Netlify keys on), so it gets 15 minutes rather than the 10 seconds a
// synchronous function gets and the 30 a scheduled one gets.
//
// The same split, for the same reason, as watch-rescan-cron/-background and
// growth-analyze-cron/-background: a scheduled function cannot be reached over
// HTTP and is capped at 30 seconds, so it fires this and returns. Draining a
// backlog of email sends at ~1s each blows 30 seconds at thirty jobs, and it
// would blow it SILENTLY — the only symptom being that receipts quietly stopped
// arriving.
//
// ── WHY IT IS AUTHENTICATED ─────────────────────────────────────────────────
//
// This endpoint sends email and Telegram messages on the platform's behalf. Left
// open, anyone could invoke it in a loop; the jobs are idempotent so nothing
// would be duplicated, but the invocation cost and the provider rate limits are
// real. It takes the same short-lived HMAC admin token the other internal
// workers use (_adminAuth.mjs), minted server-side by the cron with no passcode
// on the wire.
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import {
  listJobs,
  dueJobs,
  claimLease,
  markProcessing,
  markCompleted,
  markFailed,
  enqueue,
  JOB_STATUS,
} from './_eventQueue.mjs';
import { runJob, JOB_TYPES } from './_queueHandlers.mjs';
import { jsonResponse } from './_blobsClient.mjs';
import crypto from 'node:crypto';

// Per-run ceiling. Bounded so one run always finishes inside its budget and a
// backlog drains over successive ticks rather than one run timing out and
// completing none of what it started.
const MAX_JOBS_PER_RUN = 60;

// Leave headroom under the 15-minute cap. A run that is still working at this
// point stops claiming NEW jobs and exits cleanly, so its in-flight job is
// completed and recorded rather than killed mid-write by the platform.
const RUN_BUDGET_MS = 12 * 60 * 1000;

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { message: 'Method not allowed' });
  }
  if (!verifyToken(bearerToken(event))) {
    return jsonResponse(401, { message: 'Unauthorized' });
  }

  // Identifies THIS run for the lease. A random id per invocation is what makes
  // "did I win the lease?" answerable — two concurrent runs would otherwise both
  // see their own worker id and both believe they hold every job.
  const workerId = `w-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const startedAt = Date.now();

  const summary = { claimed: 0, completed: 0, failed: 0, deadLettered: 0, skipped: 0, leaseLost: 0 };

  try {
    const all = await listJobs({ limit: 400 });
    const due = dueJobs(all).slice(0, MAX_JOBS_PER_RUN);

    for (const job of due) {
      if (Date.now() - startedAt > RUN_BUDGET_MS) {
        console.warn(`[queue-worker] run budget reached; ${due.length - summary.claimed} job(s) left for the next tick`);
        break;
      }

      const lease = await claimLease(job.id, workerId);
      if (!lease.won) {
        summary.leaseLost += 1;
        continue;
      }

      const running = await markProcessing(job, workerId);
      summary.claimed += 1;

      let result;
      try {
        result = await runJob(running);
      } catch (error) {
        // An UNEXPECTED throw is retryable by default. A handler that means
        // "do not retry" says so in its return value; anything that escapes as
        // an exception is a fault we do not understand, and the safe reading of
        // a fault we do not understand is that it might be transient.
        result = { ok: false, retryable: true, reason: error.message };
      }

      if (result.ok) {
        await markCompleted(running);
        summary.completed += 1;
        continue;
      }

      if (!result.retryable) {
        // Terminal. Sent straight to the shelf rather than burning four more
        // attempts on something that cannot succeed — an operator looking at the
        // dead-letter list should see the reason, not a delay.
        const dead = await markFailed({ ...running, attempts: 999 }, result.reason);
        summary.deadLettered += 1;
        await escalate(dead);
        continue;
      }

      const next = await markFailed(running, result.reason);
      if (next.status === JOB_STATUS.DEAD_LETTER) {
        summary.deadLettered += 1;
        await escalate(next);
      } else {
        summary.failed += 1;
      }
    }

    console.log(`[queue-worker] ${workerId} — ${JSON.stringify(summary)}`);
    // 202, matching the contract watch-rescan-cron already expects from its own
    // background worker.
    return { statusCode: 202, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, workerId, ...summary }) };
  } catch (error) {
    console.error(`[queue-worker] run failed: ${error.stack || error.message}`);
    return jsonResponse(500, { message: 'queue worker failed' });
  }
}

// A dead letter is escalated to the operator through the queue itself.
//
// Enqueueing rather than sending inline is deliberate: the reason this job died
// may well be that Telegram is down, and calling Telegram synchronously from the
// dead-letter path would fail too — losing the one notification whose entire
// purpose is to tell somebody the queue is losing things. As a job it retries
// with the same backoff as everything else.
//
// The dedup key is the dead job's id, so an operator gets exactly one message
// per dead job no matter how many times the worker re-reads the shelf.
async function escalate(job) {
  if (job.type === JOB_TYPES.ADMIN_ALERT) {
    // Do not enqueue an alert about a failed alert. That is how a queue builds
    // an infinite loop out of an outage.
    console.error(`[queue-worker] admin alert job ${job.id} dead-lettered; not escalating to avoid a loop`);
    return;
  }
  await enqueue({
    type: JOB_TYPES.ADMIN_ALERT,
    dedupKey: `dead:${job.id}`,
    payload: {
      kind: 'dead_letter',
      ctx: {
        type: job.type,
        jobId: job.id,
        attempts: job.attempts,
        lastError: job.lastError,
      },
    },
  }).catch((error) => {
    console.error(`[queue-worker] could not escalate dead letter ${job.id}: ${error.message}`);
  });
}
