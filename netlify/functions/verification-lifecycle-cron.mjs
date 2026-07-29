// Fires the verification lifecycle sweep. Scheduled, so not HTTP-routable and
// capped at 30 seconds — hence the fire-and-return split this codebase uses for
// every scheduled worker (see watch-rescan-cron.mjs for the full reasoning).
//
// ONCE A DAY, at 07:10 UTC.
//
// Daily rather than hourly because everything it decides is measured in DAYS —
// "30 days before expiry", "expired", "7 days after". An hourly sweep would do
// the same work 24 times to produce the same answer, and the reminder ladder's
// windows (see REMINDERS in the background function) already make a missed run
// self-correcting on the next one.
//
// 07:10 UTC rather than midnight for two reasons. Midnight UTC is when every
// naively-scheduled job on the internet fires, and an expiry email that lands
// mid-morning in Europe / early evening in Asia is read on the day it arrives —
// which for a message whose entire purpose is to prompt a renewal before a
// deadline is the difference between working and not. The :10 keeps it off the
// hour, away from growth-compact (03:15) and the queue worker's five-minute
// grid.
import { issueToken } from './_adminAuth.mjs';

export const config = { schedule: '10 7 * * *' };

export async function handler() {
  const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (!siteUrl) {
    console.error('[verify-lifecycle-cron] no site URL in env; cannot reach the background function.');
    return { statusCode: 200, body: 'no site url' };
  }

  let token;
  try {
    token = issueToken();
  } catch (error) {
    console.error(`[verify-lifecycle-cron] cannot issue an admin token: ${error.message}`);
    return { statusCode: 200, body: 'admin not configured' };
  }

  try {
    const response = await fetch(`${siteUrl}/.netlify/functions/verification-lifecycle-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ trigger: 'scheduled' }),
    });
    if (response.status !== 202) {
      console.warn(`[verify-lifecycle-cron] background function answered ${response.status}, expected 202.`);
    }
    return { statusCode: 200, body: `triggered (${response.status})` };
  } catch (error) {
    console.error(`[verify-lifecycle-cron] could not trigger the sweep: ${error.message}`);
    return { statusCode: 200, body: 'trigger failed' };
  }
}
