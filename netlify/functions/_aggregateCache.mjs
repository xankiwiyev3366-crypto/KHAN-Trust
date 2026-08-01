// A short-lived, in-instance cache for expensive READ-ONLY aggregates.
//
// WHAT THIS IS FOR, AND WHAT IT IS DELIBERATELY NOT
//
// The admin dashboard's user metrics cost one blob LIST plus one GET per
// registered account — 207 HTTP round trips at 206 accounts — and the screen
// re-polls every 30 seconds for as long as the tab is open. Nothing about the
// answer changes second to second, so paying that on every poll is pure waste.
//
// It is NOT a store, and nothing is ever read from here that could not be
// recomputed from the source of truth on the next miss:
//
//   - Memory only. No blob writes, no second copy of any fact on disk, so there
//     is no new lane that can drift out of agreement with the user records.
//   - Per function INSTANCE. A cold start, a scale-out, or a redeploy simply
//     recomputes. That makes the cache a latency optimisation and never a
//     correctness dependency.
//   - Short TTL, and every entry is bypassable. A manual Refresh always
//     recomputes (see `bypass`), so an operator who has just granted Premium or
//     approved a verification can always force the true current value.
//
// FAILURES ARE NOT CACHED. If the producer throws, the rejection propagates to
// every waiter and nothing is stored, so the next request retries against the
// real store rather than being served a remembered error for the whole TTL.

const DEFAULT_TTL_MS = 60000;

// key -> { expiresAt, value }
const entries = new Map();
// key -> Promise, for requests that arrive while a recompute is already running.
const inFlight = new Map();

// Returns the cached value for `key`, or computes it with `produce()`.
//
// Concurrent callers COALESCE onto one computation. This matters as much as the
// TTL does: the dashboard's 30-second poll and a manual refresh can overlap, and
// without coalescing two 207-round-trip scans run against the blob store at
// once. With it, the second caller awaits the first's result.
//
// `bypass: true` forces a fresh computation AND replaces the cached value, so a
// manual refresh leaves the cache holding the fresh figure rather than an entry
// that is about to be served stale to the next poll.
export async function cachedAggregate(key, produce, { ttlMs = DEFAULT_TTL_MS, bypass = false, now = Date.now() } = {}) {
  if (!bypass) {
    const hit = entries.get(key);
    if (hit && hit.expiresAt > now) return hit.value;
    // An identical computation already running is a valid answer for a
    // non-bypassing caller — it is at most milliseconds older than its own
    // would be.
    const pending = inFlight.get(key);
    if (pending) return pending;
  }

  const promise = (async () => {
    const value = await produce();
    entries.set(key, { expiresAt: Date.now() + ttlMs, value });
    return value;
  })();

  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    // Only clear the slot if it is still ours; a bypassing caller may have
    // replaced it while we were awaiting.
    if (inFlight.get(key) === promise) inFlight.delete(key);
  }
}

// Drops a key (or everything). Used by tests, and available to any write path
// that wants the next read to be authoritative rather than waiting out the TTL.
export function invalidateAggregate(key) {
  if (key === undefined) {
    entries.clear();
    inFlight.clear();
    return;
  }
  entries.delete(key);
  inFlight.delete(key);
}

export { DEFAULT_TTL_MS };
