import { appendEvent, jsonResponse } from './_analyticsStore.mjs';

// Public ingestion endpoint for client-originated events. Verification
// lifecycle events (submitted/approved/rejected) are recorded directly by
// verification-request.mjs / verification-admin-review.mjs instead of going
// through this endpoint, so there is exactly one place each of those is
// ever written - no risk of the client double-reporting them.
const ALLOWED_TYPES = new Set(['page_view', 'token_scan', 'project_view', 'project_added', 'compare_used', 'search']);
const MAX_STRING_LENGTH = 200;

function clampString(value) {
  return String(value ?? '').slice(0, MAX_STRING_LENGTH);
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

    if (!ALLOWED_TYPES.has(payload.type)) {
      return jsonResponse(400, { message: `Unknown event type "${payload.type}"` });
    }

    const record = {
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: payload.type,
      timestamp: new Date().toISOString(),
      visitorId: clampString(payload.visitorId),
      isNewVisitor: Boolean(payload.isNewVisitor),
      device: payload.device === 'mobile' ? 'mobile' : 'desktop',
      trafficSource: ['direct', 'google', 'x', 'telegram', 'other'].includes(payload.trafficSource)
        ? payload.trafficSource
        : 'other',
      path: clampString(payload.path),
      projectId: clampString(payload.projectId),
      projectName: clampString(payload.projectName),
      ticker: clampString(payload.ticker),
      contract: clampString(payload.contract),
      trustScore: Number.isFinite(payload.trustScore) ? Math.max(0, Math.min(100, Math.round(payload.trustScore))) : null,
      query: clampString(payload.query),
    };

    const total = await appendEvent(record);
    return jsonResponse(200, { ok: true, total });
  } catch (error) {
    return jsonResponse(500, { message: `analytics-track crashed: ${error.message}` });
  }
}
