// Hourly trigger for the re-scan worker. Scheduled, so it is NOT HTTP-routable
// and has a hard 30-second execution limit.
//
// It therefore does NOT do the work — same split, and for the same reason, as
// growth-analyze-cron: re-scanning N watched tokens at two HTTP calls each
// blows 30s as soon as N is more than a handful, and it would blow it SILENTLY,
// every hour, with the only symptom being that alerts quietly stopped firing.
// Which is exactly the class of failure this whole workstream exists to end.
// So this fires watch-rescan-background (15-minute limit) and returns.
//
// Runs every 30 minutes, at :00 and :30 — the Premium observation cadence (see
// OBSERVE_INTERVAL_MS in _watchTiers.mjs). This is the tick rate, NOT the rate
// any given token is observed at: the worker selects only the tokens actually
// due, so a free-tier token still gets looked at every 12 hours while a
// Premium-watched one gets every tick.
//
// alerts-run is pinned to :15 and :45 for this reason: the two are a pipeline
// (observe, then notify), so they must not share a cron minute. At the same
// minute they would race and alerts would read stale snapshots — for a
// liquidity drain, the difference between a warning and a post-mortem.
//
// THE GAP SHRANK FROM 30 MINUTES TO 15, AND THAT IS THE ONE THING TO WATCH.
// The background worker has a 15-minute cap, so a run that uses its full budget
// could in principle still be writing when alerts-run fires. That is safe
// rather than merely unlikely: alerts-run compares whatever snapshot IS stored,
// and a token whose fresh snapshot has not landed yet is compared against its
// previous one — the same like-for-like comparison it would have made anyway.
// It is never compared against a half-written or partial observation, because
// _rescanEngine only ever emits a snapshot from a COMPLETE fetch. The worst
// case is that one token's alert arrives one tick later, which is exactly the
// trade the per-run cap is tuned to avoid in the first place.
import { issueToken } from './_adminAuth.mjs';

export const config = { schedule: '0,30 * * * *' };

export async function handler() {
  const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (!siteUrl) {
    console.error('[watch-rescan-cron] no site URL in env; cannot reach the background function.');
    return { statusCode: 200, body: 'no site url' };
  }

  let token;
  try {
    // Runs server-side and already has KHAN_ADMIN_PASSCODE, so it can mint the
    // short-lived HMAC token directly. No passcode is transmitted.
    token = issueToken();
  } catch (error) {
    console.error(`[watch-rescan-cron] cannot issue an admin token: ${error.message}`);
    return { statusCode: 200, body: 'admin not configured' };
  }

  try {
    // Fire-and-forget: the background function answers 202 immediately and
    // keeps running long after this scheduled invocation has exited.
    const response = await fetch(`${siteUrl}/.netlify/functions/watch-rescan-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ trigger: 'scheduled' }),
    });

    if (response.status !== 202) {
      console.warn(`[watch-rescan-cron] background function answered ${response.status}, expected 202.`);
    }
    return { statusCode: 200, body: `triggered (${response.status})` };
  } catch (error) {
    console.error(`[watch-rescan-cron] could not trigger the worker: ${error.message}`);
    return { statusCode: 200, body: 'trigger failed' };
  }
}
