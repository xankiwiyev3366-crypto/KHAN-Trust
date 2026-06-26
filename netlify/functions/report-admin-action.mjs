// POST /.netlify/functions/report-admin-action - every admin mutation on a
// report (status change, internal notes, delete) goes through this one
// endpoint with an `action` field, mirroring support-admin-action.mjs.
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { readReports, writeReports, jsonResponse } from './_reportStore.mjs';

const VALID_STATUSES = new Set(['new', 'under_review', 'resolved', 'rejected']);

function sanitizeText(value, maxLength) {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .trim()
    .slice(0, maxLength);
}

export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { message: 'Method not allowed' });
    }
    if (!verifyToken(bearerToken(event))) {
      return jsonResponse(401, { message: 'Unauthorized' });
    }

    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { message: 'Invalid request body' });
    }

    const reports = await readReports();
    const index = reports.findIndex((item) => item.id === payload.reportId);
    if (index === -1) {
      return jsonResponse(404, { message: 'Report not found.' });
    }
    const report = reports[index];
    const now = new Date().toISOString();

    switch (payload.action) {
      case 'set_status': {
        if (!VALID_STATUSES.has(payload.status)) return jsonResponse(400, { message: 'Invalid status.' });
        report.status = payload.status;
        break;
      }
      case 'set_notes': {
        report.adminNotes = sanitizeText(payload.adminNotes, 5000);
        break;
      }
      case 'delete': {
        const remaining = reports.filter((item) => item.id !== payload.reportId);
        await writeReports(remaining);
        return jsonResponse(200, { ok: true, deleted: true });
      }
      default:
        return jsonResponse(400, { message: 'Unknown action.' });
    }

    report.updatedAt = now;
    reports[index] = report;
    await writeReports(reports);

    return jsonResponse(200, { ok: true, report });
  } catch (error) {
    return jsonResponse(500, { message: `report-admin-action crashed: ${error.message}`, stack: error.stack });
  }
}
