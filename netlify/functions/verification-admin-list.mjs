import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { readRequests, jsonResponse } from './_verificationStore.mjs';

export async function handler(event) {
  try {
    if (event.httpMethod !== 'GET') {
      return jsonResponse(405, { message: 'Method not allowed' });
    }
    if (!verifyToken(bearerToken(event))) {
      return jsonResponse(401, { message: 'Unauthorized' });
    }
    const requests = await readRequests();
    const status = event.queryStringParameters?.status || 'pending';
    const filtered = status === 'all' ? requests : requests.filter((item) => item.status === status);
    return jsonResponse(200, { requests: filtered });
  } catch (error) {
    return jsonResponse(500, { message: `verification-admin-list crashed: ${error.message}` });
  }
}
