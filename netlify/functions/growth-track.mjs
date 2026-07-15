// Public ingestion for the Growth Data Plane.
//
// Fire-and-forget from the browser: analytics is observability, never something
// a user's experience should depend on, so every failure path here still
// returns quickly and the client ignores the response entirely.
//
// This endpoint accepts ONLY the client-assertable event types (see
// CLIENT_EVENT_TYPES). Registrations, logins and completed checkouts are
// recorded server-side by the functions that actually perform them, so no
// caller can inflate the numbers the Growth OS reasons about.
import { putEvent, jsonResponse } from './_growthEvents.mjs';
import { buildEvent, CLIENT_EVENT_TYPES } from './_growthSchema.mjs';

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

    if (!CLIENT_EVENT_TYPES.has(payload.type)) {
      return jsonResponse(400, { message: `Unknown or non-client event type "${payload.type}"` });
    }

    await putEvent(buildEvent(payload.type, payload));
    return jsonResponse(200, { ok: true });
  } catch (error) {
    return jsonResponse(500, { message: `growth-track failed: ${error.message}` });
  }
}
