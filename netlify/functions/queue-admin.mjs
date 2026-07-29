// GET  /.netlify/functions/queue-admin              — jobs, dead letters, counts
// POST /.netlify/functions/queue-admin  { action: 'requeue', id }
// Authorization: Bearer <admin HMAC token>
//
// The operator's window into the durable outbox: what is waiting, what failed,
// what died, why, and a button to put a dead letter back.
//
// ── ERROR DETAIL IS SHOWN, AND IT IS BOUNDED ────────────────────────────────
//
// A dead-letter shelf whose entries say only "failed" is a shelf nobody can act
// on, so `lastError` is surfaced. It is capped at 500 characters at the point it
// is STORED (markFailed), not merely here — provider errors routinely echo the
// whole request back, and an unbounded error string is how a payload ends up
// pasted into a support ticket. The job PAYLOAD is returned too, because it is
// what an operator needs to judge whether a requeue is safe; it never contains a
// secret, because the things that would be secret (signatures, wallets, tokens)
// are referenced by order id and looked up by the handler rather than carried.
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import {
  listJobs,
  listDeadLetters,
  queueStats,
  requeueDeadLetter,
  dueJobs,
} from './_eventQueue.mjs';
import { jsonResponse } from './_blobsClient.mjs';

function publicJob(job, now) {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    attempts: job.attempts,
    lastError: job.lastError || '',
    runAfter: job.runAfter,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    // Whether this job is actually waiting on its backoff rather than stuck.
    // Without it, a queue full of jobs correctly waiting two minutes looks
    // identical to a queue that has stopped draining — and an operator who
    // cannot tell those apart will either panic or ignore both.
    due: Date.parse(job.runAfter || job.createdAt) <= now,
    payload: job.payload || {},
  };
}

export async function handler(event) {
  try {
    if (!verifyToken(bearerToken(event))) return jsonResponse(401, { message: 'Unauthorized' });

    if (event.httpMethod === 'POST') {
      let payload;
      try {
        payload = JSON.parse(event.body || '{}');
      } catch {
        return jsonResponse(400, { message: 'Invalid request body' });
      }
      if (payload.action !== 'requeue') return jsonResponse(400, { message: 'Unknown action' });

      const id = String(payload.id || '').trim();
      if (!id) return jsonResponse(400, { message: 'id is required' });

      // Idempotent by construction: a dead letter that has already been
      // requeued is no longer on the shelf, so a second click gets
      // 'not_found' rather than a second copy of the job.
      const result = await requeueDeadLetter(id);
      if (!result.ok) {
        return jsonResponse(404, { message: 'That dead-letter job is no longer on the shelf.', reason: result.reason });
      }
      console.log(`[queue-admin] dead letter ${id} requeued as ${result.id}`);
      return jsonResponse(200, { ok: true, id: result.id });
    }

    if (event.httpMethod !== 'GET') return jsonResponse(405, { message: 'Method not allowed' });

    const now = Date.now();
    const [jobs, dead, counts] = await Promise.all([
      listJobs({ limit: 200 }),
      listDeadLetters({ limit: 100 }),
      queueStats(),
    ]);

    return jsonResponse(200, {
      counts,
      // How much of the live queue is actually actionable right now — the number
      // that says whether the worker is keeping up.
      dueNow: dueJobs(jobs, now).length,
      jobs: jobs.map((job) => publicJob(job, now)),
      deadLetters: dead.map((job) => publicJob(job, now)),
    });
  } catch (error) {
    console.error(`[queue-admin] failed: ${error.stack || error.message}`);
    return jsonResponse(500, { message: 'Could not load the queue.' });
  }
}
