// Manual compaction, for investigating storage from the console.
// Admin-gated and HTTP-invocable; the nightly run is growth-compact-cron.mjs.
//
// Kept separate from the cron for the reason in _growthRunAnalysis.mjs: a
// function that declares a schedule is not routable over HTTP, so one handler
// cannot be both.
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { listRawDays, compactDay, jsonResponse } from './_growthEvents.mjs';

export async function handler(event) {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { message: 'Method not allowed' });
  if (!verifyToken(bearerToken(event))) return jsonResponse(401, { message: 'Unauthorized' });

  try {
    // Only days before today: compacting the live day could race an in-flight
    // write.
    const today = new Date().toISOString().slice(0, 10);
    const days = (await listRawDays()).filter((day) => day < today);

    const results = [];
    for (const day of days) {
      results.push(await compactDay(day));
    }

    return jsonResponse(200, { ok: true, compactedDays: results.length, results });
  } catch (error) {
    return jsonResponse(500, { message: `growth-compact failed: ${error.message}` });
  }
}
