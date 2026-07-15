// Nightly compaction of the event store. Scheduled only, so not HTTP-routable
// and needing no auth check. See _growthRunAnalysis.mjs for why the scheduled
// and manual paths are separate functions rather than one dual-purpose handler.
//
// Safety property: only ever touches days strictly BEFORE today (UTC), so it
// can never race a live write. Compaction is idempotent — a retry after a
// partial failure merges by event id rather than duplicating.
import { listRawDays, compactDay, jsonResponse } from './_growthEvents.mjs';

export async function handler() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const days = (await listRawDays()).filter((day) => day < today);

    const results = [];
    // Sequential on purpose: this is a background chore with no deadline, and
    // running days in parallel would multiply peak memory and blob API pressure
    // for no benefit.
    for (const day of days) {
      results.push(await compactDay(day));
    }

    console.log(`[growth-compact-cron] compacted ${results.length} day(s).`);
    return jsonResponse(200, { ok: true, compactedDays: results.length, results });
  } catch (error) {
    // Logged, not thrown: nothing reads this response, and an un-compacted day
    // is a cost/performance issue, never data loss (readDay falls back to the
    // raw keys and dedupes).
    console.error(`[growth-compact-cron] failed: ${error.message}`);
    return jsonResponse(200, { ok: false, message: error.message });
  }
}
