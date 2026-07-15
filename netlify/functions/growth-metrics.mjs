// Admin-only read of the Growth Warehouse.
//
// Deliberately has no public counterpart: these numbers are the operator's
// private view of the business (funnel health, channel performance, what is
// broken), and are gated behind the same admin token as every other console
// endpoint.
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { buildWarehouse } from './_growthWarehouse.mjs';
import { jsonResponse } from './_growthEvents.mjs';

const ALLOWED_WINDOWS = [7, 30, 90];

export async function handler(event) {
  try {
    if (event.httpMethod !== 'GET') {
      return jsonResponse(405, { message: 'Method not allowed' });
    }
    if (!verifyToken(bearerToken(event))) {
      return jsonResponse(401, { message: 'Unauthorized' });
    }

    // Allow-listed rather than free-form: `days` drives how many day-blobs are
    // fetched, so an unbounded value would let one request fan out into
    // thousands of blob reads.
    const requested = Number(event.queryStringParameters?.days);
    const days = ALLOWED_WINDOWS.includes(requested) ? requested : 30;

    return jsonResponse(200, await buildWarehouse({ days }));
  } catch (error) {
    return jsonResponse(500, { message: `growth-metrics failed: ${error.message}` });
  }
}
