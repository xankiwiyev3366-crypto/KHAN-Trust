// Background discovery worker (Phase 2). Runs the provider registry through
// the engine and refreshes the discovered-projects cache. This is the ONLY
// place that does network fetching for discovery, and it runs off the request
// path (on a schedule, or on explicit admin trigger), so the public list
// endpoint stays a fast single blob read and page loads are never blocked.
//
// Invocation modes:
//   - Scheduled (Netlify cron below): refresh the cache.
//   - POST + admin bearer: force a refresh now (admin "Refresh discovery").
//   - GET: return current discovery status/meta (no network work).
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { readEarlyStageProjects, isPubliclyVisible, jsonResponse } from './_earlyStageStore.mjs';
import {
  readDiscoveredProjects,
  writeDiscoveredProjects,
  readDiscoveryMeta,
  writeDiscoveryMeta,
} from './_discoveryStore.mjs';
import { runDiscovery } from './_discoveryEngine.mjs';

// Refresh every 6 hours. Netlify reads this exported config to schedule it.
export const config = { schedule: '0 */6 * * *' };

async function refresh() {
  const [manualAll, existingDiscovered] = await Promise.all([
    readEarlyStageProjects(),
    readDiscoveredProjects(),
  ]);
  // Only dedupe discovered projects against PUBLIC manual ones (approved +
  // visible); pending/rejected submissions shouldn't suppress a discovery.
  const manualVisible = manualAll.filter(isPubliclyVisible);
  const { projects, stats } = await runDiscovery({
    manualProjects: manualVisible,
    existingDiscovered,
  });
  await writeDiscoveredProjects(projects);

  const prevMeta = await readDiscoveryMeta();
  const runs = [...(prevMeta.runs || []), { at: stats.lastRunAt, discovered: stats.discoveredCount }].slice(-10);
  await writeDiscoveryMeta({ lastRunAt: stats.lastRunAt, lastRun: stats, runs });
  return stats;
}

export async function handler(event) {
  try {
    const method = event?.httpMethod;

    // GET -> status only, no network work.
    if (method === 'GET') {
      const [meta, discovered] = await Promise.all([readDiscoveryMeta(), readDiscoveredProjects()]);
      return jsonResponse(200, { ok: true, lastRunAt: meta.lastRunAt || null, count: discovered.length, lastRun: meta.lastRun || null });
    }

    // Netlify invokes SCHEDULED functions as a POST whose JSON body carries a
    // `next_run` timestamp (there is no unauthenticated-vs-scheduled header),
    // so detect the cron invocation by that body. The `!method` case is kept
    // as a defensive fallback in case the runtime ever omits it.
    let body = {};
    if (event?.body) {
      try { body = JSON.parse(event.body); } catch { body = {}; }
    }
    const isScheduled = !method || Boolean(body?.next_run);

    // Admin can force a refresh on demand with a valid bearer token.
    const isAdmin = method === 'POST' && verifyToken(bearerToken(event));

    if (isScheduled || isAdmin) {
      const stats = await refresh();
      return jsonResponse(200, { ok: true, mode: isAdmin ? 'manual' : 'scheduled', stats });
    }

    if (method === 'POST') {
      return jsonResponse(401, { message: 'Unauthorized' });
    }

    return jsonResponse(405, { message: 'Method not allowed' });
  } catch (error) {
    return jsonResponse(500, { message: `early-stage-discover-run crashed: ${error.message}`, stack: error.stack });
  }
}
