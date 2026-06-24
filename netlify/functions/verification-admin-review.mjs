import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { readRequests, writeRequests, readStatuses, writeStatuses, jsonResponse } from './_verificationStore.mjs';

const VALID_DECISIONS = new Set(['verified', 'rejected']);

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

    if (!VALID_DECISIONS.has(payload.decision)) {
      return jsonResponse(400, { message: 'Decision must be "verified" or "rejected".' });
    }

    const requests = await readRequests();
    const request = requests.find((item) => item.id === payload.requestId);
    if (!request) {
      return jsonResponse(404, { message: 'Verification request not found.' });
    }

    const reviewedAt = new Date().toISOString();
    request.status = payload.decision;
    request.adminNote = payload.adminNote || '';
    request.reviewedAt = reviewedAt;
    await writeRequests(requests);

    const statuses = await readStatuses();
    statuses[request.projectId] = { status: payload.decision, updatedAt: reviewedAt, adminNote: request.adminNote };
    await writeStatuses(statuses);

    return jsonResponse(200, { ok: true, request });
  } catch (error) {
    return jsonResponse(500, { message: `verification-admin-review crashed: ${error.message}`, stack: error.stack });
  }
}
