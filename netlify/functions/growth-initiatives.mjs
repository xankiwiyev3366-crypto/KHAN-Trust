// Initiative CRUD for the Growth Loop. Admin-only. No AI, no spend.
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { buildWarehouse } from './_growthWarehouse.mjs';
import {
  createInitiative, listInitiatives, updateInitiative, summarise,
  snapshotBaseline, STATUS, jsonResponse,
} from './_growthInitiatives.mjs';

export async function handler(event) {
  try {
    if (!verifyToken(bearerToken(event))) return jsonResponse(401, { message: 'Unauthorized' });

    if (event.httpMethod === 'GET') {
      const initiatives = await listInitiatives();
      return jsonResponse(200, { initiatives, summary: summarise(initiatives) });
    }

    if (event.httpMethod !== 'POST') return jsonResponse(405, { message: 'Method not allowed' });

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { message: 'Invalid JSON' });
    }

    if (body.action === 'create') {
      if (!body.recommendation?.title) {
        return jsonResponse(400, { message: 'A recommendation with a title is required.' });
      }
      return jsonResponse(201, {
        initiative: await createInitiative({
          recommendation: body.recommendation,
          sourceReportId: body.sourceReportId,
          sourceRole: body.sourceRole,
        }),
      });
    }

    if (body.action === 'update') {
      if (!body.id) return jsonResponse(400, { message: 'An initiative id is required.' });

      // Accepting is the ONLY moment the baseline can be captured — before any
      // work happens. Reconstructing it later is impossible at any price, so
      // the snapshot is taken here rather than trusted to the client.
      const baseline = body.status === STATUS.ACCEPTED
        ? snapshotBaseline(await buildWarehouse({ days: 30 }))
        : undefined;

      return jsonResponse(200, {
        initiative: await updateInitiative(body.id, {
          status: body.status,
          outcome: body.outcome,
          outcomeNote: body.outcomeNote,
          baseline,
        }),
      });
    }

    return jsonResponse(400, { message: `Unknown action "${body.action}"` });
  } catch (error) {
    if (error.code === 'NOT_FOUND') return jsonResponse(404, { message: error.message });
    if (error.code === 'INVALID_TRANSITION' || error.code === 'INVALID_OUTCOME') {
      return jsonResponse(400, { message: error.message, code: error.code });
    }
    return jsonResponse(500, { message: `growth-initiatives failed: ${error.message}` });
  }
}
