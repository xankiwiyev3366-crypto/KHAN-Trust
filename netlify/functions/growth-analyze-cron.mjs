// Weekly trigger for the analyst run. Scheduled, so it is NOT HTTP-routable
// and has a hard 30-second execution limit.
//
// It therefore does NOT do the work. Four Claude calls take 20-40s and would
// blow the 30s cap — silently, every Monday, with the only symptom being that
// reports quietly stopped appearing. Instead this fires the background function
// (15-minute limit) and returns immediately, which is Netlify's documented
// pattern for scheduled work that outlives the scheduler.
//
// The self-call needs an admin token, which this can mint directly: it runs
// server-side and already has KHAN_ADMIN_PASSCODE, the same secret
// verification-admin-auth signs with. No passcode is transmitted — only the
// short-lived HMAC token.
import { issueToken } from './_adminAuth.mjs';
import { jsonResponse } from './_growthEvents.mjs';

export async function handler() {
  // process.env.URL is injected by Netlify and is the site's primary URL.
  const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (!siteUrl) {
    console.error('[growth-analyze-cron] no site URL in env; cannot reach the background function.');
    return jsonResponse(200, { ok: false, reason: 'NO_SITE_URL' });
  }

  let token;
  try {
    token = issueToken();
  } catch (error) {
    // issueToken throws when KHAN_ADMIN_PASSCODE is unset in production. That
    // is the same fail-closed posture the rest of admin auth takes.
    console.error(`[growth-analyze-cron] cannot issue an admin token: ${error.message}`);
    return jsonResponse(200, { ok: false, reason: 'ADMIN_NOT_CONFIGURED' });
  }

  try {
    // Fire-and-forget by design: the background function answers 202
    // immediately and keeps running long after this scheduled invocation has
    // exited. Awaiting anything more than the 202 would defeat the point.
    const response = await fetch(`${siteUrl}/.netlify/functions/growth-analyze-background`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      // The weekly run has no operator present to read a language preference
      // from, so it takes one from the environment. Defaults to English.
      // Set KHAN_AI_REPORT_LANG=az to have the Monday brief arrive in
      // Azerbaijani.
      body: JSON.stringify({
        trigger: 'scheduled',
        language: process.env.KHAN_AI_REPORT_LANG === 'az' ? 'az' : 'en',
      }),
    });

    if (response.status !== 202) {
      // 202 is the contract for a background function. Anything else means the
      // function is missing or misnamed (a `-background` suffix typo silently
      // turns it back into a 10s synchronous function), which is worth shouting
      // about rather than discovering weeks later.
      console.error(`[growth-analyze-cron] expected 202 from the background function, got ${response.status}.`);
      return jsonResponse(200, { ok: false, status: response.status });
    }

    console.log('[growth-analyze-cron] weekly analysis triggered.');
    return jsonResponse(200, { ok: true });
  } catch (error) {
    console.error(`[growth-analyze-cron] failed to trigger: ${error.message}`);
    return jsonResponse(200, { ok: false, message: error.message });
  }
}
