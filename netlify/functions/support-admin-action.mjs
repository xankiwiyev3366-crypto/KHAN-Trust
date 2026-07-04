// POST /.netlify/functions/support-admin-action - every admin mutation on a
// ticket (reply, status/priority change, assignment, internal notes,
// archive, delete) goes through this one endpoint with an `action` field,
// to keep the function count manageable as more actions are added later.
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { readTickets, writeTickets, jsonResponse } from './_supportStore.mjs';

const VALID_STATUSES = new Set(['new', 'open', 'in_progress', 'waiting_for_user', 'resolved', 'closed']);
const VALID_PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);

function sanitizeText(value, maxLength) {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .trim()
    .slice(0, maxLength);
}

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

    const tickets = await readTickets();
    const index = tickets.findIndex((item) => item.id === payload.ticketId);
    if (index === -1) {
      return jsonResponse(404, { message: 'Ticket not found.' });
    }
    const ticket = tickets[index];
    const now = new Date().toISOString();

    switch (payload.action) {
      case 'reply': {
        const message = sanitizeText(payload.message, 5000);
        if (!message) return jsonResponse(400, { message: 'Reply message is required.' });
        ticket.replies = [...(ticket.replies || []), { message, createdAt: now, by: sanitizeText(payload.adminName, 100) || 'KHAN Trust Team' }];
        if (!ticket.firstResponseAt) ticket.firstResponseAt = now;
        if (ticket.status === 'new') ticket.status = 'open';
        if (payload.setStatus && VALID_STATUSES.has(payload.setStatus)) ticket.status = payload.setStatus;
        break;
      }
      case 'set_status': {
        if (!VALID_STATUSES.has(payload.status)) return jsonResponse(400, { message: 'Invalid status.' });
        ticket.status = payload.status;
        break;
      }
      case 'set_priority': {
        if (!VALID_PRIORITIES.has(payload.priority)) return jsonResponse(400, { message: 'Invalid priority.' });
        ticket.priority = payload.priority;
        break;
      }
      case 'assign': {
        ticket.assignedTo = sanitizeText(payload.assignedTo, 100);
        break;
      }
      case 'set_notes': {
        ticket.adminNotes = sanitizeText(payload.adminNotes, 5000);
        break;
      }
      case 'archive': {
        ticket.archived = true;
        break;
      }
      case 'unarchive': {
        ticket.archived = false;
        break;
      }
      case 'delete': {
        const remaining = tickets.filter((item) => item.id !== payload.ticketId);
        await writeTickets(remaining);
        return jsonResponse(200, { ok: true, deleted: true });
      }
      default:
        return jsonResponse(400, { message: 'Unknown action.' });
    }

    ticket.updatedAt = now;
    tickets[index] = ticket;
    await writeTickets(tickets);

    return jsonResponse(200, { ok: true, ticket });
  } catch (error) {
    return jsonResponse(500, { message: `support-admin-action crashed: ${error.message}` });
  }
}
