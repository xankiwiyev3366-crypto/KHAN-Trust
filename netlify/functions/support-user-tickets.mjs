// GET /.netlify/functions/support-user-tickets?email=&wallet= - lets a user
// look up their own ticket history without an account, matched by email or
// connected wallet. Public, but only returns user-facing fields - never
// internal admin notes.
import { readTickets, jsonResponse } from './_supportStore.mjs';

function toPublicTicket(ticket) {
  return {
    id: ticket.id,
    subject: ticket.subject,
    category: ticket.category,
    status: ticket.status,
    priority: ticket.priority,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    message: ticket.message,
    replies: (ticket.replies || []).map((reply) => ({
      from: 'team',
      message: reply.message,
      createdAt: reply.createdAt,
    })),
  };
}

export async function handler(event) {
  try {
    if (event.httpMethod !== 'GET') {
      return jsonResponse(405, { message: 'Method not allowed' });
    }
    const email = (event.queryStringParameters?.email || '').trim().toLowerCase();
    const wallet = (event.queryStringParameters?.wallet || '').trim();
    if (!email && !wallet) {
      return jsonResponse(400, { message: 'email or wallet query parameter is required' });
    }

    const tickets = await readTickets();
    const matched = tickets.filter(
      (ticket) => (email && ticket.email.toLowerCase() === email) || (wallet && ticket.wallet === wallet)
    );
    matched.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return jsonResponse(200, { tickets: matched.map(toPublicTicket) });
  } catch (error) {
    return jsonResponse(500, { message: `support-user-tickets crashed: ${error.message}` });
  }
}
