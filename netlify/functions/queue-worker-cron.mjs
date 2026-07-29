// Fires the outbox worker. Scheduled, so NOT reachable over HTTP and hard-capped
// at 30 seconds — hence the fire-and-return split documented in
// watch-rescan-cron.mjs and growth-analyze-cron.mjs.
//
// EVERY FIVE MINUTES. Chosen against two constraints pulling in opposite
// directions:
//
//   - The slowest thing on this queue is a receipt email for a purchase that has
//     just completed. Five minutes is well inside what a buyer reads as
//     "immediate" for a receipt, and the activation response itself already told
//     them the badge is live — the email is confirmation, not the product.
//   - The first retry backoff is 30 seconds and the second is two minutes, so a
//     tighter cadence would mostly re-read jobs that are not due yet, paying a
//     full blob listing per tick for nothing.
//
// Deliberately NOT sharing a minute with alerts-run (:15/:45) or watch-rescan
// (:00/:30). Those are a pipeline whose ordering matters to each other; this
// worker is independent, but three functions listing blobs in the same second
// is avoidable contention for no benefit.
import { issueToken } from './_adminAuth.mjs';

export const config = { schedule: '2,7,12,17,22,27,32,37,42,47,52,57 * * * *' };

export async function handler() {
  const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (!siteUrl) {
    console.error('[queue-worker-cron] no site URL in env; cannot reach the background worker.');
    return { statusCode: 200, body: 'no site url' };
  }

  let token;
  try {
    // Runs server-side and already holds KHAN_ADMIN_PASSCODE, so it mints the
    // short-lived HMAC directly. No passcode is ever transmitted.
    token = issueToken();
  } catch (error) {
    console.error(`[queue-worker-cron] cannot issue an admin token: ${error.message}`);
    return { statusCode: 200, body: 'admin not configured' };
  }

  try {
    const response = await fetch(`${siteUrl}/.netlify/functions/queue-worker-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ trigger: 'scheduled' }),
    });
    if (response.status !== 202) {
      console.warn(`[queue-worker-cron] background worker answered ${response.status}, expected 202.`);
    }
    return { statusCode: 200, body: `triggered (${response.status})` };
  } catch (error) {
    // Returning 200 on a failed trigger is deliberate: a non-200 from a
    // scheduled function is retried by the platform on its own schedule, and a
    // retry storm against an already-struggling site helps nobody. The next tick
    // is five minutes away and the jobs are still on the queue.
    console.error(`[queue-worker-cron] could not trigger the worker: ${error.message}`);
    return { statusCode: 200, body: 'trigger failed' };
  }
}
