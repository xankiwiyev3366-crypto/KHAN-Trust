// POST /.netlify/functions/admin-login-backfill
//
// Admin-only. Runs the one-time legacy login-state migration described in
// _loginBackfill.mjs, which reclassifies accounts that provably authenticated
// before login tracking existed.
//
//   { "dryRun": true }   inspect what WOULD change — writes nothing
//   { "dryRun": false }  apply it (idempotent; refuses a second run)
//   { "force": true }    re-run after it has already been applied
//
// Defaults to dryRun:true. A migration that mutates every user record in
// production should require an explicit, deliberate "no, really" rather than
// running because someone curled the URL to see what it did.
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { jsonResponse } from './_blobsClient.mjs';
import { runLoginBackfill, backfillStatus } from './_loginBackfill.mjs';

export async function handler(event) {
  try {
    if (!verifyToken(bearerToken(event))) {
      return jsonResponse(401, { message: 'Unauthorized' });
    }

    // GET reports whether the migration has run, without doing anything.
    if (event.httpMethod === 'GET') {
      return jsonResponse(200, { ok: true, status: await backfillStatus() });
    }

    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { message: 'Method not allowed' });
    }

    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch {
      return jsonResponse(400, { message: 'Invalid JSON' });
    }

    // Opt-IN to writing. `dryRun` is only false when explicitly sent as false.
    const dryRun = body.dryRun !== false;
    const result = await runLoginBackfill({ dryRun, force: body.force === true });

    return jsonResponse(200, { ok: true, ...result });
  } catch (error) {
    return jsonResponse(500, { message: `admin-login-backfill crashed: ${error.message}` });
  }
}
