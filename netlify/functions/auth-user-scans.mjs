import { verifyJwt, bearerToken, jsonResponse } from './_authStore.mjs';
import { readEvents } from './_analyticsStore.mjs';

export async function handler(event) {
  if (event.httpMethod !== 'GET') return jsonResponse(405, { message: 'Method not allowed' });

  const payload = verifyJwt(bearerToken(event));
  if (!payload) return jsonResponse(401, { message: 'Unauthorized' });

  const events = await readEvents();
  const scans = events
    .filter((e) => e.type === 'token_scan' && e.userId === payload.sub)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 200);

  return jsonResponse(200, { scans, total: scans.length });
}
