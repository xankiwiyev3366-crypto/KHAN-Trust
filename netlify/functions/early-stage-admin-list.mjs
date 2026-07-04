// GET /.netlify/functions/early-stage-admin-list - admin-only listing of ALL
// early-stage submissions (every status, including hidden/archived), with
// search + status filter. Reuses the same shared admin passcode/token as the
// verification / support / report admin dashboards.
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { readEarlyStageProjects, jsonResponse } from './_earlyStageStore.mjs';

export async function handler(event) {
  try {
    if (event.httpMethod !== 'GET') {
      return jsonResponse(405, { message: 'Method not allowed' });
    }
    if (!verifyToken(bearerToken(event))) {
      return jsonResponse(401, { message: 'Unauthorized' });
    }

    const all = await readEarlyStageProjects();
    const status = event.queryStringParameters?.status || 'all';
    const search = (event.queryStringParameters?.search || '').trim().toLowerCase();

    let filtered = all;
    if (status !== 'all') filtered = filtered.filter((p) => p.status === status);
    if (search) {
      filtered = filtered.filter((p) =>
        [p.name, p.description, p.chain, p.category, p.contactEmail, p.submittedByWallet, p.id]
          .filter(Boolean)
          .some((field) => field.toLowerCase().includes(search))
      );
    }

    filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const stats = {
      total: all.length,
      pending: all.filter((p) => p.status === 'pending').length,
      approved: all.filter((p) => p.status === 'approved').length,
      rejected: all.filter((p) => p.status === 'rejected').length,
      archived: all.filter((p) => p.status === 'archived').length,
      featured: all.filter((p) => p.featured).length,
    };

    return jsonResponse(200, { projects: filtered, stats });
  } catch (error) {
    return jsonResponse(500, { message: `early-stage-admin-list crashed: ${error.message}` });
  }
}
