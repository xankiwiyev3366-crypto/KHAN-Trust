// GET /.netlify/functions/report-admin-list - admin-only inbox listing for
// project reports, with search/filter support. Reuses the same shared admin
// passcode/token as the verification and support admin dashboards.
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

    const reports = await readReports();
    const status = event.queryStringParameters?.status || 'all';
    const category = event.queryStringParameters?.category || 'all';
    const projectId = event.queryStringParameters?.projectId || '';
    const dateFrom = event.queryStringParameters?.dateFrom || '';
    const dateTo = event.queryStringParameters?.dateTo || '';
    const search = (event.queryStringParameters?.search || '').trim().toLowerCase();

    let filtered = reports;
    if (status !== 'all') filtered = filtered.filter((report) => report.status === status);
    if (category !== 'all') filtered = filtered.filter((report) => report.category === category);
    if (projectId) filtered = filtered.filter((report) => report.projectId === projectId);
    if (dateFrom) filtered = filtered.filter((report) => report.createdAt >= dateFrom);
    if (dateTo) filtered = filtered.filter((report) => report.createdAt <= `${dateTo}T23:59:59.999Z`);
    if (search) {
      filtered = filtered.filter((report) =>
        [report.subject, report.message, report.projectName, report.projectId, report.email, report.wallet, report.id]
          .filter(Boolean)
          .some((field) => field.toLowerCase().includes(search))
      );
    }

    filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const stats = {
      total: reports.length,
      new: reports.filter((report) => report.status === 'new').length,
      under_review: reports.filter((report) => report.status === 'under_review').length,
      resolved: reports.filter((report) => report.status === 'resolved').length,
      rejected: reports.filter((report) => report.status === 'rejected').length,
    };

    const projects = [...new Set(reports.map((report) => report.projectId).filter(Boolean))];

    const list = filtered.map((report) => ({
      ...report,
      attachments: (report.attachments || []).map((file) => ({ name: file.name, type: file.type, size: file.size })),
    }));

    return jsonResponse(200, { reports: list, stats, projects });
  } catch (error) {
    return jsonResponse(500, { message: `report-admin-list crashed: ${error.message}`, stack: error.stack });
  }
}
