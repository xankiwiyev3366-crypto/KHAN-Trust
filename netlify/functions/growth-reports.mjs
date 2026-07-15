// Reads stored executive reports. Free — no AI call, no spend.
//
// Separate from growth-analyze so that opening the console never costs money.
// If reading and generating shared an endpoint, every page load would risk a
// spend, which is exactly the kind of accident the budget cap exists to make
// impossible.
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { listReports, latestReport, jsonResponse } from './_growthReportStore.mjs';
import { budgetStatus } from './_aiBudget.mjs';
import { isAiConfigured } from './_aiClient.mjs';

export async function handler(event) {
  try {
    if (event.httpMethod !== 'GET') return jsonResponse(405, { message: 'Method not allowed' });
    if (!verifyToken(bearerToken(event))) return jsonResponse(401, { message: 'Unauthorized' });

    const wantsList = event.queryStringParameters?.list === 'true';

    return jsonResponse(200, {
      aiConfigured: isAiConfigured(),
      budget: await budgetStatus().catch(() => null),
      ...(wantsList
        ? { reports: await listReports(20) }
        : { report: await latestReport() }),
    });
  } catch (error) {
    return jsonResponse(500, { message: `growth-reports failed: ${error.message}` });
  }
}
