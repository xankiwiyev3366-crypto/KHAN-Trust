// POST /.netlify/functions/support-submit - creates a new support ticket.
// Public endpoint (no auth) - validates, sanitizes, rate-limits, and stores.
import { readTickets, writeTickets, checkAndRecordRateLimit, jsonResponse } from './_supportStore.mjs';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_CATEGORIES = new Set([
  'general',
  'bug',
  'feature_request',
  'partnership',
  'verification_support',
  'billing',
  'other',
]);
const ALLOWED_ATTACHMENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf']);
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const MAX_ATTACHMENTS = 3;
const MAX_TOTAL_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const MAX_LENGTHS = { name: 100, email: 200, wallet: 64, subject: 150, message: 5000 };

function sanitizeText(value, maxLength) {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .trim()
    .slice(0, maxLength);
}

function base64ByteLength(base64) {
  const clean = (base64 || '').split(',').pop() || '';
  return Math.ceil((clean.length * 3) / 4);
}

function validateAttachments(attachments) {
  if (!Array.isArray(attachments) || !attachments.length) return { ok: true, attachments: [] };
  if (attachments.length > MAX_ATTACHMENTS) {
    return { ok: false, message: `Maximum ${MAX_ATTACHMENTS} attachments allowed.` };
  }
  let totalBytes = 0;
  const cleaned = [];
  for (const file of attachments) {
    if (!ALLOWED_ATTACHMENT_TYPES.has(file?.type)) {
      return { ok: false, message: `Unsupported attachment type: ${file?.type || 'unknown'}.` };
    }
    const dataUrl = String(file?.data || '');
    if (!dataUrl.startsWith('data:')) {
      return { ok: false, message: 'Invalid attachment data.' };
    }
    const byteLength = base64ByteLength(dataUrl);
    if (byteLength > MAX_ATTACHMENT_BYTES) {
      return { ok: false, message: `Attachment "${file?.name || ''}" exceeds 4MB.` };
    }
    totalBytes += byteLength;
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      return { ok: false, message: 'Total attachment size exceeds 10MB.' };
    }
    cleaned.push({
      name: sanitizeText(file.name, 200) || 'attachment',
      type: file.type,
      size: byteLength,
      data: dataUrl,
    });
  }
  return { ok: true, attachments: cleaned };
}

function getClientIp(event) {
  return (
    event.headers?.['x-nf-client-connection-ip'] ||
    event.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
    'unknown'
  );
}

function generateTicketId() {
  const stamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `KT-${stamp}-${random}`;
}

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

    // Honeypot: a hidden field real users never fill in. Bots that
    // autofill every field trip this. Respond as if successful (don't tip
    // off the bot) but never actually store the ticket.
    if (String(payload.company || '').trim()) {
      return jsonResponse(200, { ok: true, ticketId: generateTicketId() });
    }

    const email = sanitizeText(payload.email, MAX_LENGTHS.email);
    const subject = sanitizeText(payload.subject, MAX_LENGTHS.subject);
    const message = sanitizeText(payload.message, MAX_LENGTHS.message);
    const category = String(payload.category || '').trim();

    if (!email || !EMAIL_PATTERN.test(email)) {
      return jsonResponse(400, { message: 'A valid email address is required.' });
    }
    if (!subject) {
      return jsonResponse(400, { message: 'Subject is required.' });
    }
    if (!VALID_CATEGORIES.has(category)) {
      return jsonResponse(400, { message: 'A valid category is required.' });
    }
    if (!message) {
      return jsonResponse(400, { message: 'Message is required.' });
    }

    const ip = getClientIp(event);
    const allowed = await checkAndRecordRateLimit(ip);
    if (!allowed) {
      return jsonResponse(429, { message: 'Too many submissions. Please try again later.' });
    }

    const attachmentResult = validateAttachments(payload.attachments);
    if (!attachmentResult.ok) {
      return jsonResponse(400, { message: attachmentResult.message });
    }

    const now = new Date().toISOString();
    const ticket = {
      id: generateTicketId(),
      name: sanitizeText(payload.name, MAX_LENGTHS.name),
      email,
      wallet: sanitizeText(payload.wallet, MAX_LENGTHS.wallet),
      subject,
      category,
      message,
      attachments: attachmentResult.attachments,
      status: 'new',
      priority: 'medium',
      assignedTo: '',
      adminNotes: '',
      replies: [],
      createdAt: now,
      updatedAt: now,
      firstResponseAt: null,
    };

    const tickets = await readTickets();
    await writeTickets([ticket, ...tickets]);

    return jsonResponse(200, {
      ok: true,
      ticketId: ticket.id,
      ticket: { id: ticket.id, status: ticket.status, createdAt: ticket.createdAt },
    });
  } catch (error) {
    return jsonResponse(500, { message: `support-submit crashed: ${error.message}`, stack: error.stack });
  }
}
