// GET /.netlify/functions/support-admin-list - admin-only inbox listing plus
// summary stats (new/open/resolved counts, average first-response time).
// Reuses the same shared admin passcode/token as the verification review and
// analytics dashboards (see _adminAuth.mjs).
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { readTickets, jsonResponse } from './_supportStore.mjs';

function averageResponseMinutes(tickets) {
  const responded = tickets.filter((ticket) => ticket.firstResponseAt);
  if (!responded.length) return null;
  const totalMinutes = responded.reduce((sum, ticket) => {
    return sum + (new Date(ticket.firstResponseAt) - new Date(ticket.createdAt)) / 60000;
  }, 0);
  return Math.round(totalMinutes / responded.length);
}

export async function handler(event) {
  try {
    if (event.httpMethod !== 'GET') {
      return jsonResponse(405, { message: 'Method not allowed' });
    }
    if (!verifyToken(bearerToken(event))) {
      return jsonResponse(401, { message: 'Unauthorized' });
    }

    const tickets = await readTickets();
    const status = event.queryStringParameters?.status || 'all';
    const category = event.queryStringParameters?.category || 'all';

    let filtered = tickets.filter((ticket) => !ticket.archived);
    if (status === 'archived') filtered = tickets.filter((ticket) => ticket.archived);
    else if (status !== 'all') filtered = filtered.filter((ticket) => ticket.status === status);
    if (category !== 'all') filtered = filtered.filter((ticket) => ticket.category === category);

    filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const active = tickets.filter((ticket) => !ticket.archived);
    const stats = {
      total: active.length,
      new: active.filter((ticket) => ticket.status === 'new').length,
      open: active.filter((ticket) => ['open', 'in_progress', 'waiting_for_user'].includes(ticket.status)).length,
      resolved: active.filter((ticket) => ['resolved', 'closed'].includes(ticket.status)).length,
      avgResponseMinutes: averageResponseMinutes(active),
    };

    const list = filtered.map((ticket) => ({ ...ticket, attachments: (ticket.attachments || []).map((a) => ({ name: a.name, type: a.type, size: a.size })) }));

    return jsonResponse(200, { tickets: list, stats });
  } catch (error) {
    return jsonResponse(500, { message: `support-admin-list crashed: ${error.message}` });
  }
}
