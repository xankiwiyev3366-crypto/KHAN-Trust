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
import { readRows, dbConfigured } from './_db.mjs';

// ── "Did the migration actually reach the database this app talks to?" ──────
//
// This exists because that question is genuinely hard to answer from outside.
// Netlify Managed Database never reveals its production connection string, so
// migrations are applied by the DEPLOY rather than by a human — and if
// DATABASE_URL happens to point at a different Postgres than the one Netlify
// migrates, the deploy succeeds, the migration reports success, and the app's
// database is still empty. A silent no-op that looks exactly like a success.
//
// So this reports what the APP sees, from inside the function runtime, using the
// same DATABASE_URL the app actually uses. If `queue_leases` is present here,
// the lease is enforced by Postgres; if it is absent, the queue is running on
// the degraded Blobs lease no matter what any deploy log said.
//
// HOST AND DATABASE NAME ONLY — never the user, never the password. The host is
// what lets an operator compare this against the Netlify Database page and
// settle whether the two are the same server.
const EXPECTED_TABLES = [
  'schema_migrations',
  'verification_orders',
  'verification_active_contracts',
  'product_events',
  'queue_jobs',
  'queue_leases',
  'verification_receipts',
];

async function databaseHealth() {
  if (!dbConfigured()) {
    return {
      configured: false,
      // Not an error. The whole platform is designed to run without Postgres —
      // this simply means the queue lease is the documented degraded one.
      note: 'DATABASE_URL is not set. The queue lease is the degraded Blobs check; every handler is idempotent, so this is survivable but not recommended.',
    };
  }

  const tables = await readRows(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    [],
    { label: 'schema_health' },
  );
  if (!tables.ok) {
    return { configured: true, reachable: false, note: 'DATABASE_URL is set but the database could not be queried.' };
  }

  const present = new Set(tables.rows.map((r) => r.table_name));
  const missing = EXPECTED_TABLES.filter((name) => !present.has(name));

  const identity = await readRows('SELECT current_database() AS db', [], { label: 'schema_identity' });

  // The host comes from the connection string, NOT from inet_server_addr():
  // that function returns NULL over a Unix socket and, through a connection
  // pooler like Neon's, returns the POOLER's address rather than the server an
  // operator would recognise. The hostname in DATABASE_URL is the thing that can
  // actually be compared against the Netlify Database page.
  //
  // Hostname only. Never the user, never the password.
  let host = null;
  try {
    host = new URL(process.env.DATABASE_URL).hostname || null;
  } catch {
    host = null;
  }

  return {
    configured: true,
    reachable: true,
    database: identity.ok ? identity.rows[0]?.db || null : null,
    host,
    tables: Object.fromEntries(EXPECTED_TABLES.map((name) => [name, present.has(name)])),
    missing,
    // The single fact that decides whether the outbox is actually safe under
    // concurrency, stated plainly rather than left to be inferred from the list.
    leaseEnforcedByPostgres: present.has('queue_leases'),
    migrationsApplied: present.has('queue_jobs') && present.has('product_events') && present.has('verification_receipts'),
  };
}

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
    const [jobs, dead, counts, database] = await Promise.all([
      listJobs({ limit: 200 }),
      listDeadLetters({ limit: 100 }),
      queueStats(),
      // Never allowed to fail the page: the queue view must still render when
      // the database is unreachable — that is precisely the condition an
      // operator opened this screen to diagnose.
      databaseHealth().catch((error) => ({ configured: true, reachable: false, note: `health check failed: ${error.message}` })),
    ]);

    return jsonResponse(200, {
      counts,
      database,
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
