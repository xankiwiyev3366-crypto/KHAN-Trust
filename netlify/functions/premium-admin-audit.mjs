// GET /.netlify/functions/premium-admin-audit
// Admin-only. Returns the append-only audit log of every manual-premium
// action. History is never deleted (see _premiumStore.mjs). Read-only.
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { readAudit, jsonResponse } from './_premiumStore.mjs';

export async function handler(event) {
  if (event.httpMethod !== 'GET') return jsonResponse(405, { message: 'Method not allowed' });
  if (!verifyToken(bearerToken(event))) return jsonResponse(401, { message: 'Unauthorized' });

  const limit = Math.min(Number(event.queryStringParameters?.limit) || 500, 2000);
  const entries = await readAudit();
  return jsonResponse(200, { total: entries.length, entries: entries.slice(0, limit) });
}
