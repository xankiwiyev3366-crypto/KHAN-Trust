// Scheduled tick for the KHAN Holder Analytics indexer - every 10 minutes.
//
// THE SCHEDULE LIVES IN netlify.toml. The `export const config` below is kept
// for readers, but for these Lambda-compatible `handler(event)` functions
// Netlify does not register it: from 2026-06-29 until 2026-09-26 this function
// was never scheduled at all (the deploy's function_schedules listed only the
// netlify.toml entries), so the ledger only moved when an admin pressed
// "Refresh now" - last on 2026-07-11 - and the page quietly went stale.
//
// It does no Blob work itself. Same split as queue-worker-cron: it mints the
// short-lived admin HMAC and fires khan-holders-sync-background, which gets 15
// minutes instead of 30 seconds and is an ordinary HTTP invocation - the kind
// that always carries Netlify's per-request Blobs credential. So the sync never
// depends on what a scheduled invocation's event does or does not carry, and
// never on the NETLIFY_BLOBS_TOKEN fallback.
import { connectBlobs } from './_blobsConnect.mjs';
import { issueToken } from './_adminAuth.mjs';

export const config = { schedule: '*/10 * * * *' };

export async function handler(event) {
  const hasInvocationBlobs = connectBlobs(event);
  const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (!siteUrl) {
    console.error('[khan-holders-sync] no site URL in env; cannot reach the background worker.');
    return { statusCode: 200, body: 'no site url' };
  }

  let token;
  try {
    token = issueToken();
  } catch (error) {
    console.error(`[khan-holders-sync] cannot issue an admin token: ${error.message}`);
    return { statusCode: 200, body: 'admin not configured' };
  }

  try {
    const response = await fetch(`${siteUrl}/.netlify/functions/khan-holders-sync-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ trigger: 'scheduled' }),
    });
    if (response.status !== 202) {
      console.warn(`[khan-holders-sync] background worker answered ${response.status}, expected 202.`);
    }
    console.log(`[khan-holders-sync] triggered background sync (${response.status}); scheduled event carried Blobs context: ${hasInvocationBlobs}`);
    return { statusCode: 200, body: `triggered (${response.status})` };
  } catch (error) {
    // 200 on a failed trigger, as in queue-worker-cron: the next tick is ten
    // minutes away and the cursor has not moved, so nothing is lost.
    console.error(`[khan-holders-sync] could not trigger the worker: ${error.message}`);
    return { statusCode: 200, body: 'trigger failed' };
  }
}
