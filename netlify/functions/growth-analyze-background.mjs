// The analyst run. A BACKGROUND function — the `-background` suffix is what
// buys the 15-minute execution limit.
//
// WHY THIS IS NOT A NORMAL FUNCTION
//
// A synchronous Netlify function is killed at ~10 seconds. This job makes four
// Claude calls (three specialists in parallel, then the brief) and takes
// 20-40s, so as a synchronous endpoint it could only ever return a 504 — which
// is exactly what it did. The work was not slow or broken; it was in the wrong
// kind of function.
//
// A scheduled function is no better: those cap at 30 seconds, so the weekly
// cron would have died the same way, silently, every Monday. Hence the
// separate thin trigger in growth-analyze-cron.mjs.
//
// CONSEQUENCES OF BEING A BACKGROUND FUNCTION — both load-bearing:
//
//   1. The caller gets an immediate 202 with an EMPTY body and never sees this
//      function's return value. Nothing here can report to the client, so every
//      outcome is logged instead. The console discovers the result by polling
//      growth-reports for a new report id.
//   2. Because the response is fixed at 202, an unauthorised caller gets a 202
//      too. That is not a hole: the token is still checked below and no work
//      (and no spend) happens without it. It also means this endpoint is not an
//      oracle — a probe cannot distinguish a valid token from an invalid one.
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { runAnalysis } from './_growthRunAnalysis.mjs';
import { isAiConfigured } from './_aiClient.mjs';

export async function handler(event) {
  if (!verifyToken(bearerToken(event))) {
    console.warn('[growth-analyze-background] unauthorised invocation ignored; no work done.');
    return { statusCode: 401 };
  }

  if (!isAiConfigured()) {
    console.warn('[growth-analyze-background] skipped: ANTHROPIC_API_KEY is not configured.');
    return { statusCode: 200 };
  }

  let trigger = 'manual';
  try {
    trigger = JSON.parse(event.body || '{}').trigger === 'scheduled' ? 'scheduled' : 'manual';
  } catch {
    // Body is optional; default to manual.
  }

  try {
    const report = await runAnalysis({ trigger });
    console.log(`[growth-analyze-background] ${trigger} run complete — report ${report.id} saved.`);
    return { statusCode: 200 };
  } catch (error) {
    // Hitting the monthly cap is correct behaviour, not an incident.
    const level = error.code === 'BUDGET_EXCEEDED' ? 'warn' : 'error';
    console[level](`[growth-analyze-background] ${trigger} run failed (${error.code || 'unknown'}): ${error.message}`);
    if (error.failures) console[level]('[growth-analyze-background] analyst failures:', error.failures);
    // A thrown error would make Netlify retry this (1 min, then 2 min), which
    // for a budget refusal or a bad prompt means paying twice more to fail
    // twice more. The failure is logged; swallow it.
    return { statusCode: 200 };
  }
}
