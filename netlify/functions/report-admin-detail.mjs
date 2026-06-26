// GET /.netlify/functions/report-admin-detail?id=RPT-... - admin-only single
// report detail, including full attachment data (the list endpoint strips
// attachment payloads to keep the inbox response small).
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { readReports, jsonResponse } from './_reportStore.mjs';

export async function handler(event) {
  try {
    if (event.httpMethod !== 'GET') {
      return jsonResponse(405, { message: 'Method not allowed' });
    }
    if (!verifyToken(bearerToken(event))) {
      return jsonResponse(401, { message: 'Unauthorized' });
    }

    const id = event.queryStringParameters?.id || '';
    const reports = await readReports();
    const report = reports.find((item) => item.id === id);
    if (!report) {
      return jsonResponse(404, { message: 'Report not found.' });
    }

    return jsonResponse(200, { report });
  } catch (error) {
    return jsonResponse(500, { message: `report-admin-detail crashed: ${error.message}`, stack: error.stack });
  }
}
