// Support & Messaging Center - client module. Mirrors the verification.js
// pattern: real calls go to netlify/functions/support-*; when those
// functions are unreachable (plain `vite dev`, no Netlify Functions server)
// calls transparently fall back to a localStorage-backed mock with the same
// shape, so the full flow is still testable end-to-end in dev.

export const TICKET_CATEGORIES = [
  { id: 'general', label: 'General Question' },
  { id: 'bug', label: 'Report a Bug' },
  { id: 'feature_request', label: 'Feature Request' },
  { id: 'partnership', label: 'Partnership' },
  { id: 'verification_support', label: 'Verification Support' },
  { id: 'billing', label: 'Billing / Payment' },
  { id: 'other', label: 'Other' },
];

export const TICKET_STATUSES = ['new', 'open', 'in_progress', 'waiting_for_user', 'resolved', 'closed'];
export const TICKET_PRIORITIES = ['low', 'medium', 'high', 'urgent'];

export const MAX_ATTACHMENTS = 3;
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf']);

const FALLBACK_KEY = 'khan-trust-support-fallback-v1';
const ADMIN_TOKEN_KEY = 'khan-trust-admin-token-v1';

function readFallbackStore() {
  try {
    const raw = localStorage.getItem(FALLBACK_KEY);
    return raw ? JSON.parse(raw) : { tickets: [] };
  } catch {
    return { tickets: [] };
  }
}

function writeFallbackStore(store) {
  try {
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(store));
  } catch {
    // ignore - dev fallback only
  }
}

function isFunctionUnavailable(error) {
  return Boolean(error) && (error.status === undefined || error.status === 404);
}

async function callFunction(path, options) {
  const response = await fetch(`/.netlify/functions/${path}`, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.message || `Request to ${path} failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function generateTicketId() {
  const stamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `KT-${stamp}-${random}`;
}

// Errors carry a `code` + `params` instead of a hardcoded English message so
// the Support page can render them through the i18n system (see
// support.form.attachmentErrors.* in src/i18n/*.js) regardless of site language.
function attachmentError(code, params) {
  const error = new Error(code);
  error.code = code;
  error.params = params;
  return error;
}

export function fileToAttachment(file) {
  return new Promise((resolve, reject) => {
    if (!ALLOWED_ATTACHMENT_TYPES.has(file.type)) {
      reject(attachmentError('unsupported_type', { type: file.type || file.name }));
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      reject(attachmentError('too_large', { name: file.name }));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, type: file.type, data: reader.result });
    reader.onerror = () => reject(attachmentError('read_failed', { name: file.name }));
    reader.readAsDataURL(file);
  });
}

export async function submitSupportTicket(payload) {
  try {
    return await callFunction('support-submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    if (!isFunctionUnavailable(error)) throw error;
    const store = readFallbackStore();
    const now = new Date().toISOString();
    const ticket = {
      id: generateTicketId(),
      name: payload.name || '',
      email: payload.email,
      wallet: payload.wallet || '',
      subject: payload.subject,
      category: payload.category,
      message: payload.message,
      attachments: payload.attachments || [],
      status: 'new',
      priority: 'medium',
      assignedTo: '',
      adminNotes: '',
      replies: [],
      createdAt: now,
      updatedAt: now,
      firstResponseAt: null,
    };
    store.tickets = [ticket, ...store.tickets];
    writeFallbackStore(store);
    return { ok: true, ticketId: ticket.id, ticket: { id: ticket.id, status: ticket.status, createdAt: ticket.createdAt }, fallback: true };
  }
}

export async function fetchMyTickets({ email, wallet }) {
  const params = new URLSearchParams();
  if (email) params.set('email', email);
  if (wallet) params.set('wallet', wallet);
  try {
    const data = await callFunction(`support-user-tickets?${params.toString()}`, { method: 'GET' });
    return data.tickets || [];
  } catch (error) {
    if (!isFunctionUnavailable(error)) throw error;
    const store = readFallbackStore();
    return store.tickets
      .filter((ticket) => (email && ticket.email?.toLowerCase() === email.toLowerCase()) || (wallet && ticket.wallet === wallet))
      .map((ticket) => ({
        id: ticket.id,
        subject: ticket.subject,
        category: ticket.category,
        status: ticket.status,
        priority: ticket.priority,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt,
        message: ticket.message,
        replies: ticket.replies || [],
      }));
  }
}

export function getStoredAdminToken() {
  return sessionStorage.getItem(ADMIN_TOKEN_KEY) || '';
}

export async function fetchSupportTickets(token, { status = 'all', category = 'all' } = {}) {
  try {
    const data = await callFunction(`support-admin-list?status=${status}&category=${category}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return data;
  } catch (error) {
    if (!isFunctionUnavailable(error) || !token.startsWith('dev-fallback-')) throw error;
    const store = readFallbackStore();
    let tickets = store.tickets.filter((ticket) => !ticket.archived);
    if (status === 'archived') tickets = store.tickets.filter((ticket) => ticket.archived);
    else if (status !== 'all') tickets = tickets.filter((ticket) => ticket.status === status);
    if (category !== 'all') tickets = tickets.filter((ticket) => ticket.category === category);
    const active = store.tickets.filter((ticket) => !ticket.archived);
    return {
      tickets,
      stats: {
        total: active.length,
        new: active.filter((t) => t.status === 'new').length,
        open: active.filter((t) => ['open', 'in_progress', 'waiting_for_user'].includes(t.status)).length,
        resolved: active.filter((t) => ['resolved', 'closed'].includes(t.status)).length,
        avgResponseMinutes: null,
      },
    };
  }
}

export async function fetchSupportTicket(token, id) {
  try {
    const data = await callFunction(`support-admin-ticket?id=${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return data.ticket;
  } catch (error) {
    if (!isFunctionUnavailable(error) || !token.startsWith('dev-fallback-')) throw error;
    const store = readFallbackStore();
    return store.tickets.find((ticket) => ticket.id === id) || null;
  }
}

async function performAdminAction(token, body) {
  try {
    return await callFunction('support-admin-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (!isFunctionUnavailable(error) || !token.startsWith('dev-fallback-')) throw error;
    const store = readFallbackStore();
    const index = store.tickets.findIndex((ticket) => ticket.id === body.ticketId);
    if (index === -1) throw new Error('Ticket not found.');
    const ticket = store.tickets[index];
    const now = new Date().toISOString();
    if (body.action === 'reply') {
      ticket.replies = [...(ticket.replies || []), { message: body.message, createdAt: now, by: body.adminName || 'KHAN Trust Team' }];
      if (!ticket.firstResponseAt) ticket.firstResponseAt = now;
      if (ticket.status === 'new') ticket.status = 'open';
      if (body.setStatus) ticket.status = body.setStatus;
    } else if (body.action === 'set_status') ticket.status = body.status;
    else if (body.action === 'set_priority') ticket.priority = body.priority;
    else if (body.action === 'assign') ticket.assignedTo = body.assignedTo;
    else if (body.action === 'set_notes') ticket.adminNotes = body.adminNotes;
    else if (body.action === 'archive') ticket.archived = true;
    else if (body.action === 'unarchive') ticket.archived = false;
    else if (body.action === 'delete') {
      store.tickets = store.tickets.filter((item) => item.id !== body.ticketId);
      writeFallbackStore(store);
      return { ok: true, deleted: true };
    }
    ticket.updatedAt = now;
    store.tickets[index] = ticket;
    writeFallbackStore(store);
    return { ok: true, ticket };
  }
}

export const replyToTicket = (token, ticketId, message, setStatus) =>
  performAdminAction(token, { action: 'reply', ticketId, message, setStatus });
export const setTicketStatus = (token, ticketId, status) => performAdminAction(token, { action: 'set_status', ticketId, status });
export const setTicketPriority = (token, ticketId, priority) => performAdminAction(token, { action: 'set_priority', ticketId, priority });
export const assignTicket = (token, ticketId, assignedTo) => performAdminAction(token, { action: 'assign', ticketId, assignedTo });
export const setTicketNotes = (token, ticketId, adminNotes) => performAdminAction(token, { action: 'set_notes', ticketId, adminNotes });
export const archiveTicket = (token, ticketId) => performAdminAction(token, { action: 'archive', ticketId });
export const unarchiveTicket = (token, ticketId) => performAdminAction(token, { action: 'unarchive', ticketId });
export const deleteTicket = (token, ticketId) => performAdminAction(token, { action: 'delete', ticketId });
