// POST /.netlify/functions/report-submit - creates a new project
// "Report / Suggest Update" submission. Public endpoint (no auth) -
// validates, sanitizes, rate-limits, stores, and (if configured) emails a
// confirmation to the reporter and a notification to the KHAN Trust admin.
// Mirrors support-submit.mjs so the two systems behave consistently.
import { readReports, writeReports, checkAndRecordRateLimit, jsonResponse } from './_reportStore.mjs';
import { isEmailConfigured, getAdminNotifyEmail, sendEmail } from './_email.mjs';

const VALID_CATEGORIES = new Set([
  'incorrect_info',
  'missing_info',
  'security_concern',
  'broken_link',
  'duplicate_project',
  'other',
]);
const ALLOWED_ATTACHMENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf']);
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const MAX_ATTACHMENTS = 3;
const MAX_TOTAL_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const MAX_LENGTHS = {
  name: 100,
  email: 200,
  wallet: 64,
  projectId: 200,
  projectName: 200,
  subject: 150,
  message: 5000,
};

function sanitizeText(value, maxLength) {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .trim()
    .slice(0, maxLength);
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function base64ByteLength(base64) {
  const clean = (base64 || '').split(',').pop() || '';
  return Math.ceil((clean.length * 3) / 4);
}

function validateAttachments(attachments) {
  if (!Array.isArray(attachments) || !attachments.length) return { ok: true, attachments: [] };
  if (attachments.length > MAX_ATTACHMENTS) {
    return { ok: false, reason: 'too_many', message: `Maximum ${MAX_ATTACHMENTS} attachments allowed.` };
  }
  let totalBytes = 0;
  const cleaned = [];
  for (const file of attachments) {
    if (!ALLOWED_ATTACHMENT_TYPES.has(file?.type)) {
      return { ok: false, reason: 'unsupported_type', message: `Unsupported attachment type: ${file?.type || 'unknown'}.` };
    }
    const dataUrl = String(file?.data || '');
    if (!dataUrl.startsWith('data:')) {
      return { ok: false, reason: 'invalid_data', message: 'Invalid attachment data.' };
    }
    const byteLength = base64ByteLength(dataUrl);
    if (byteLength > MAX_ATTACHMENT_BYTES) {
      return { ok: false, reason: 'too_large', message: `Attachment "${file?.name || ''}" exceeds 4MB.` };
    }
    totalBytes += byteLength;
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      return { ok: false, reason: 'total_too_large', message: 'Total attachment size exceeds 10MB.' };
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

function generateReportId() {
  const stamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `RPT-${stamp}-${random}`;
}

export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { reason: 'method_not_allowed', message: 'Method not allowed' });
    }

    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { reason: 'invalid_body', message: 'Invalid request body' });
    }

    // Honeypot: a hidden field real users never fill in. Respond as if
    // successful (don't tip off the bot) but never actually store it.
    if (String(payload.company || '').trim()) {
      return jsonResponse(200, { ok: true, reportId: generateReportId() });
    }

    const projectId = sanitizeText(payload.projectId, MAX_LENGTHS.projectId);
    const projectName = sanitizeText(payload.projectName, MAX_LENGTHS.projectName);
    const subject = sanitizeText(payload.subject, MAX_LENGTHS.subject);
    const message = sanitizeText(payload.message, MAX_LENGTHS.message);
    const category = String(payload.category || '').trim();
    const email = sanitizeText(payload.email, MAX_LENGTHS.email);

    if (!projectId) {
      return jsonResponse(400, { reason: 'project_required', message: 'A project reference is required.' });
    }
    if (!VALID_CATEGORIES.has(category)) {
      return jsonResponse(400, { reason: 'invalid_category', message: 'A valid category is required.' });
    }
    if (!subject) {
      return jsonResponse(400, { reason: 'subject_required', message: 'Subject is required.' });
    }
    if (!message) {
      return jsonResponse(400, { reason: 'message_required', message: 'Message is required.' });
    }
    if (email && !EMAIL_PATTERN.test(email)) {
      return jsonResponse(400, { reason: 'invalid_email', message: 'Please enter a valid email address.' });
    }

    const ip = getClientIp(event);
    const allowed = await checkAndRecordRateLimit(ip);
    if (!allowed) {
      return jsonResponse(429, { reason: 'rate_limited', message: 'Too many submissions. Please try again later.' });
    }

    const attachmentResult = validateAttachments(payload.attachments);
    if (!attachmentResult.ok) {
      return jsonResponse(400, { reason: attachmentResult.reason, message: attachmentResult.message });
    }

    const now = new Date().toISOString();
    const report = {
      id: generateReportId(),
      projectId,
      projectName,
      wallet: sanitizeText(payload.wallet, MAX_LENGTHS.wallet),
      name: sanitizeText(payload.name, MAX_LENGTHS.name),
      email,
      category,
      subject,
      message,
      attachments: attachmentResult.attachments,
      status: 'new',
      adminNotes: '',
      createdAt: now,
      updatedAt: now,
    };

    const reports = await readReports();
    await writeReports([report, ...reports]);

    if (isEmailConfigured()) {
      if (email) {
        await sendEmail({
          to: email,
          subject: `KHAN Trust - Report received (${report.id})`,
          text: `Thanks for helping improve KHAN Trust.\n\nWe received your report for "${projectName || projectId}".\n\nReport ID: ${report.id}\nSubject: ${subject}\n\nOur team will review it and follow up if needed.`,
        });
      }
      const adminEmail = getAdminNotifyEmail();
      if (adminEmail) {
        await sendEmail({
          to: adminEmail,
          subject: `New KHAN Trust report: ${report.id}`,
          text: `New report submitted.\n\nProject: ${projectName || projectId} (${projectId})\nCategory: ${category}\nSubject: ${subject}\nFrom: ${email || 'anonymous'} ${report.wallet ? `/ wallet ${report.wallet}` : ''}\n\n${message}`,
        });
      }
    }

    return jsonResponse(200, {
      ok: true,
      reportId: report.id,
      report: { id: report.id, status: report.status, createdAt: report.createdAt },
    });
  } catch (error) {
    return jsonResponse(500, { reason: 'server_error', message: `report-submit crashed: ${error.message}`, stack: error.stack });
  }
}
