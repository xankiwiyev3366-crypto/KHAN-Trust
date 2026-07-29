// GET /.netlify/functions/verification-admin-funnel?days=30
// Authorization: Bearer <admin HMAC token>
//
// The verification funnel, computed from the product event store.
//
// ── WHY THIS IS COMPUTED AT READ TIME AND NOT KEPT AS COUNTERS ──────────────
//
// The obvious alternative is to increment a counter per stage. It is faster and
// it is wrong for the same reason _analyticsStore.mjs already records for the
// internal dashboard: separately-maintained aggregates drift from the events
// they summarise, and a drifted counter is indistinguishable from a real number.
// Deriving every figure from one immutable event log means the funnel cannot
// disagree with itself, and a bug in the derivation is fixable retroactively —
// a bug in a counter has already destroyed the data.
//
// computeFunnel() is a PURE function over the event list (see _productEvents.mjs)
// so the arithmetic is unit-tested without a store, a clock or a network.
//
// ── THE CONVERSION RATE CAN BE null, AND MUST BE ────────────────────────────
//
// With no quotes in the window, activations/quotes is 0/0. That is not a
// conversion rate of 0% — it is the absence of a measurement, and rendering it
// as 0% would show a red "0% conversion" on a quiet week and prompt somebody to
// fix a funnel that is not broken. `conversionRate: null` is the honest value
// and the console renders it as "—".
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { readEventWindow, computeFunnel } from './_productEvents.mjs';
import { jsonResponse } from './_blobsClient.mjs';

const MAX_DAYS = 180;
const DEFAULT_DAYS = 30;

export async function handler(event) {
  try {
    if (event.httpMethod !== 'GET') return jsonResponse(405, { message: 'Method not allowed' });
    if (!verifyToken(bearerToken(event))) return jsonResponse(401, { message: 'Unauthorized' });

    const raw = Number(event.queryStringParameters?.days);
    // Clamped rather than rejected: an out-of-range window is an operator typing
    // in a box, not an attack, and 180 days of events is the point past which
    // the Blob fallback path stops fitting in one function invocation.
    const days = Number.isFinite(raw) && raw > 0 ? Math.min(Math.round(raw), MAX_DAYS) : DEFAULT_DAYS;

    const now = Date.now();
    const events = await readEventWindow(days, now);
    const funnel = computeFunnel(events);

    // A per-day series so the console can draw a trend rather than a single
    // number. Built from the same event list, so it can never disagree with the
    // totals above.
    const byDay = {};
    for (const e of events) {
      const day = String(e.timestamp).slice(0, 10);
      byDay[day] = byDay[day] || { day, quotes: 0, orders: 0, activations: 0, profileViews: 0 };
      if (e.name === 'verification_quote_created') byDay[day].quotes += 1;
      else if (e.name === 'verification_order_created') byDay[day].orders += 1;
      else if (e.name === 'verification_activated') byDay[day].activations += 1;
      else if (e.name === 'project_profile_viewed') byDay[day].profileViews += 1;
    }

    return jsonResponse(200, {
      days,
      // Stated so the console can say "computed from N events" rather than
      // implying a precision the window does not have. An empty window is
      // reported as empty, never as a set of zeroes that look like measurements.
      eventCount: events.length,
      funnel,
      series: Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day)),
    });
  } catch (error) {
    console.error(`[verify-admin-funnel] failed: ${error.stack || error.message}`);
    return jsonResponse(500, { message: 'Could not load the funnel.' });
  }
}
