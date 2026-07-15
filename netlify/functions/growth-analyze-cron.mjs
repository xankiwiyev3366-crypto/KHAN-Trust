// The weekly analyst run. Scheduled only — Netlify does not route HTTP to a
// function that declares a schedule, so this needs no auth check: it is not
// reachable by anyone.
//
// Failures are logged rather than returned. Nothing reads this function's
// response, so a silent throw would mean the reports simply stop appearing and
// nobody finds out until someone wonders why the console looks stale.
import { runAnalysis } from './_growthRunAnalysis.mjs';
import { isAiConfigured } from './_aiClient.mjs';
import { jsonResponse } from './_growthEvents.mjs';

export async function handler() {
  if (!isAiConfigured()) {
    console.warn('[growth-analyze-cron] skipped: ANTHROPIC_API_KEY is not configured.');
    return jsonResponse(200, { skipped: true, reason: 'AI_NOT_CONFIGURED' });
  }

  try {
    const report = await runAnalysis({ trigger: 'scheduled' });
    console.log(`[growth-analyze-cron] report ${report.id} saved.`);
    return jsonResponse(200, { ok: true, reportId: report.id });
  } catch (error) {
    // Hitting the monthly cap is correct behaviour, not an incident.
    const level = error.code === 'BUDGET_EXCEEDED' ? 'warn' : 'error';
    console[level](`[growth-analyze-cron] ${error.code || 'failed'}: ${error.message}`);
    return jsonResponse(200, { ok: false, code: error.code || null, message: error.message });
  }
}
