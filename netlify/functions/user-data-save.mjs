// POST /.netlify/functions/user-data-save - mutates a caller's saved
// reports / synced watchlist. Gated server-side: the caller must have a
// Premium or Early Supporter entitlement - either a paid wallet entitlement OR
// an admin-granted manual grant (see _premiumAccess.mjs) - resolved here
// directly rather than trusting the client's own claim of its plan. The same
// resolver decides which storage key the data lives under.
import { resolveVerifiedPremiumAccess } from './_premiumAccess.mjs';
import { getUserData, setUserData, jsonResponse } from './_userDataStore.mjs';

const MAX_SAVED_REPORTS = 100;
const MAX_WATCHLIST = 200;

function sanitizeText(value, maxLength) {
  return String(value || '').replace(/<[^>]*>/g, '').trim().slice(0, maxLength);
}

export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { message: 'Method not allowed' });
    }

    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { message: 'Invalid request body' });
    }

    const access = await resolveVerifiedPremiumAccess(event);
    if (!access.entitled) {
      return jsonResponse(403, { message: 'This account does not have an active Premium or KHAN Founding Member entitlement.' });
    }

    const data = await getUserData(access.storageKey);

    switch (payload.action) {
      case 'save_report': {
        const report = payload.report || {};
        if (!report.projectId) return jsonResponse(400, { message: 'report.projectId is required' });
        const entry = {
          id: `sr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          projectId: sanitizeText(report.projectId, 100),
          name: sanitizeText(report.name, 150),
          ticker: sanitizeText(report.ticker, 30),
          contract: sanitizeText(report.contract, 100),
          trustScore: Number(report.trustScore) || 0,
          riskLevel: sanitizeText(report.riskLevel, 30),
          savedAt: new Date().toISOString(),
        };
        data.savedReports = [entry, ...(data.savedReports || []).filter((item) => item.projectId !== entry.projectId)].slice(0, MAX_SAVED_REPORTS);
        break;
      }
      case 'remove_report': {
        data.savedReports = (data.savedReports || []).filter((item) => item.id !== payload.reportId);
        break;
      }
      case 'toggle_watch': {
        const projectId = sanitizeText(payload.projectId, 100);
        if (!projectId) return jsonResponse(400, { message: 'projectId is required' });
        const current = data.watchlist || [];
        data.watchlist = current.includes(projectId)
          ? current.filter((id) => id !== projectId)
          : [...current, projectId].slice(0, MAX_WATCHLIST);
        break;
      }
      default:
        return jsonResponse(400, { message: 'Unknown action.' });
    }

    const saved = await setUserData(access.storageKey, data);
    return jsonResponse(200, { ok: true, data: saved });
  } catch (error) {
    return jsonResponse(500, { message: `user-data-save crashed: ${error.message}` });
  }
}
