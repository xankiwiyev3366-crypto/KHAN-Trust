// Manual "Run analysis now" from the console. Admin-gated, HTTP-invocable.
//
// Deliberately has NO `schedule` in netlify.toml — a scheduled function is not
// routable over HTTP, so declaring one here would 404 this button. The weekly
// run lives in growth-analyze-cron.mjs. See _growthRunAnalysis.mjs.
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { runAnalysis } from './_growthRunAnalysis.mjs';
import { isAiConfigured } from './_aiClient.mjs';
import { jsonResponse } from './_growthEvents.mjs';

export async function handler(event) {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { message: 'Method not allowed' });
  if (!verifyToken(bearerToken(event))) return jsonResponse(401, { message: 'Unauthorized' });

  if (!isAiConfigured()) {
    return jsonResponse(503, {
      message: 'ANTHROPIC_API_KEY is not configured. Every deterministic metric in the console still works — only the analyst layer is unavailable.',
      code: 'AI_NOT_CONFIGURED',
    });
  }

  try {
    return jsonResponse(200, await runAnalysis({ trigger: 'manual' }));
  } catch (error) {
    // A budget refusal is an expected, correct outcome — not a server fault.
    if (error.code === 'BUDGET_EXCEEDED') {
      return jsonResponse(429, { message: error.message, code: 'BUDGET_EXCEEDED' });
    }
    if (error.code === 'ALL_ANALYSTS_FAILED') {
      return jsonResponse(502, { message: error.message, failures: error.failures });
    }
    return jsonResponse(500, { message: `growth-analyze failed: ${error.message}` });
  }
}
