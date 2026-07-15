// Nightly compaction of the event store. Scheduled only, so not HTTP-routable
// and needing no auth check. See _growthRunAnalysis.mjs for why the scheduled
// and manual paths are separate functions rather than one dual-purpose handler.
//
// Safety property: only ever touches days strictly BEFORE today (UTC), so it
// can never race a live write. Compaction is idempotent — a retry after a
// partial failure merges by event id rather than duplicating.
import { listRawDays, compactDay, jsonResponse } from './_growthEvents.mjs';

// A scheduled function is killed at 30 seconds, and compacting one day costs a
// list plus one blob read per event plus a delete per event. A backlog — the
// function disabled for a month, or a deploy gap — would mean thousands of
// sequential blob operations and a guaranteed timeout.
//
// So each run compacts at most a handful of days, oldest first. A backlog
// drains over successive nights instead of failing every night forever.
// Compaction is idempotent and only touches days already in the past, so
// stopping early is always safe: nothing is half-done, and the next run simply
// picks up the days still listed as raw.
const MAX_DAYS_PER_RUN = 5;

export async function handler() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    // listRawDays returns sorted ascending, so slicing takes the OLDEST days —
    // the ones most likely to be read as history and least likely to still be
    // receiving late writes.
    const pending = (await listRawDays()).filter((day) => day < today);
    const days = pending.slice(0, MAX_DAYS_PER_RUN);

    const results = [];
    // Sequential on purpose: running days in parallel would multiply peak
    // memory and blob API pressure for no benefit, and the work is bounded
    // above anyway.
    for (const day of days) {
      results.push(await compactDay(day));
    }

    const remaining = pending.length - days.length;
    console.log(
      `[growth-compact-cron] compacted ${results.length} day(s)` +
      (remaining > 0 ? `; ${remaining} still pending, will drain on the next runs.` : '.')
    );
    return jsonResponse(200, { ok: true, compactedDays: results.length, remaining, results });
  } catch (error) {
    // Logged, not thrown: nothing reads this response, and an un-compacted day
    // is a cost/performance issue, never data loss (readDay falls back to the
    // raw keys and dedupes).
    console.error(`[growth-compact-cron] failed: ${error.message}`);
    return jsonResponse(200, { ok: false, message: error.message });
  }
}
