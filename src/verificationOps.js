// Client helpers for the two Admin Panel pages that run the paid-verification
// business: Paid Verification (orders, funnel, revenue) and Jobs & Delivery
// (the durable outbox and database health).
//
// ── WHY THIS LIVES HERE AND NOT IN src/admin/ ───────────────────────────────
//
// These screens used to be in the private operator console at /console. They
// belong in the main Admin Panel instead: /console is a STRATEGY surface —
// funnels, cohorts, the AI brief — while refunding a duplicate sale and
// requeueing a dead letter are OPERATIONS, done beside the ownership review
// queue and the Premium management screen that already live in the Admin Panel.
//
// They could not simply be imported across. scripts/verify-boundary.mjs fails
// the build if anything reachable from src/main.jsx touches src/admin/, because
// one stray import silently hoists console code into the bundle every visitor
// downloads. So this is a native Admin Panel module that calls the SAME
// endpoints — no server change, no second copy of any rule.
//
// Every call reuses the shared admin token from sessionStorage (see
// getStoredAdminToken in verification.js), exactly as premiumAdmin.js does, so
// an operator signed into one admin page is signed into all of them.
//
// NO DEV FALLBACK. verification.js and premiumAdmin.js carry localStorage
// fallbacks for running `vite dev` without a Functions server. Nothing here may:
// these screens report revenue, refunds and whether a queue is losing work, and
// a fabricated answer to "is the outbox draining?" is worse than an error. The
// honest failure is an error the operator can see — the same rule
// src/verifyOrders.js states for the paid flow it fronts.

async function callAdmin(path, token, options = {}) {
  const res = await fetch(`/.netlify/functions/${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });

  // A 200 carrying something that is not JSON is a FAILURE, not an empty
  // answer — the same defect src/verifyOrders.js documents. `vite dev` serves
  // index.html with status 200 for an unknown function path, and any proxy or
  // captive portal reproduces it in production. Swallowing that into `{}` makes
  // the page render as though the queue were empty.
  const raw = await res.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw Object.assign(
      new Error(`${path} returned ${res.status} but the body was not JSON. The function is probably not running.`),
      { status: res.status, reason: 'bad_response' },
    );
  }

  if (!res.ok) {
    throw Object.assign(new Error(data.message || `Request to ${path} failed (${res.status})`), {
      status: res.status,
      reason: data.reason || '',
    });
  }
  return data;
}

// ── Paid verification ───────────────────────────────────────────────────────

// Orders plus the derived counts, expiring-soon total and gross revenue. The
// server derives every status through isVerificationActive(), so an order whose
// term lapsed reads as expired here even before the nightly sweep rewrites it.
export async function fetchVerificationOrders(token, status = 'all') {
  return callAdmin(`verification-admin-orders?status=${encodeURIComponent(status)}`, token);
}

// The funnel over a window, computed from the product event store.
// `conversionRate` may be null — that is 0/0, an absent measurement, and the UI
// must render it as "—" rather than 0%.
export async function fetchVerificationFunnel(token, days = 30) {
  return callAdmin(`verification-admin-funnel?days=${encodeURIComponent(days)}`, token);
}

// action: 'mark_refunded' | 'revoke' | 'resend_receipt'
//
// The destructive two require `confirm` to echo the order id back; the server
// answers 428 without it. That is deliberate and this client does not paper over
// it — a mis-click on a dense table row must not be able to revoke a paying
// customer's badge.
export async function submitVerificationOrderAction(token, { orderId, action, reason = '', confirm = '' }) {
  return callAdmin('verification-admin-order-action', token, {
    method: 'POST',
    body: JSON.stringify({ orderId, action, reason, confirm }),
  });
}

// ── Jobs & delivery ─────────────────────────────────────────────────────────

// Queue counts, live jobs, dead letters, and the database health block that
// says whether the migration actually reached the database THIS APP uses.
export async function fetchQueueState(token) {
  return callAdmin('queue-admin', token);
}

// Puts a dead letter back on the queue. Idempotent by construction: a job
// already requeued is off the shelf, so a second click answers 404 rather than
// creating a duplicate.
export async function requeueDeadLetterJob(token, id) {
  return callAdmin('queue-admin', token, {
    method: 'POST',
    body: JSON.stringify({ action: 'requeue', id }),
  });
}
