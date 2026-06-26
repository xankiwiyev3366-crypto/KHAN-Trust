// GET /.netlify/functions/support-admin-ticket?id=KT-... - admin-only single
// ticket detail, including full attachment data (the list endpoint strips
// attachment payloads to keep the inbox response small).
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { readTickets, jsonResponse } from './_supportStore.mjs';

export async function handler(event) {
  try {
    if (event.httpMethod !== 'GET') {
      return jsonResponse(405, { message: 'Method not allowed' });
    }
    if (!verifyToken(bearerToken(event))) {
      return jsonResponse(401, { message: 'Unauthorized' });
    }

    const id = event.queryStringParameters?.id || '';
    const tickets = await readTickets();
    const ticket = tickets.find((item) => item.id === id);
    if (!ticket) {
      return jsonResponse(404, { message: 'Ticket not found.' });
    }

    return jsonResponse(200, { ticket });
  } catch (error) {
    return jsonResponse(500, { message: `support-admin-ticket crashed: ${error.message}`, stack: error.stack });
  }
}
