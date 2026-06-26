// Project "Report / Suggest Update" feature - client module. Mirrors
// support.js exactly: real calls go to netlify/functions/report-*; when
// those functions are unreachable (plain `vite dev`, no Netlify Functions
// server) calls transparently fall back to a localStorage-backed mock with
// the same shape, so the full flow is still testable end-to-end in dev.

export const REPORT_CATEGORIES = [
  { id: 'incorrect_info', label: 'Incorrect Information' },
  { id: 'missing_info', label: 'Missing Information' },
  { id: 'security_concern', label: 'Security Concern' },
  { id: 'broken_link', label: 'Broken Link' },
  { id: 'duplicate_project', label: 'Duplicate Project' },
  { id: 'other', label: 'Other' },
];

export const REPORT_STATUSES = ['new', 'under_review', 'resolved', 'rejected'];

export const MAX_ATTACHMENTS = 3;
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf']);

const FALLBACK_KEY = 'khan-trust-report-fallback-v1';
const ADMIN_TOKEN_KEY = 'khan-trust-admin-token-v1';

function readFallbackStore() {
  try {
    const raw = localStorage.getItem(FALLBACK_KEY);
    return raw ? JSON.parse(raw) : { reports: [] };
  } catch {
    return { reports: [] };
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
    error.reason = body.reason;
    throw error;
  }
  return response.json();
}

function generateReportId() {
  const stamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `RPT-${stamp}-${random}`;
}

// Errors carry a `code` + `params` instead of a hardcoded English message so
// the report form can render them through the i18n system regardless of
// site language (see report.form.attachmentErrors.* in src/i18n/*.js).
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

export async function submitReport(payload) {
  try {
    return await callFunction('report-submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    if (!isFunctionUnavailable(error)) throw error;
    const store = readFallbackStore();
    const now = new Date().toISOString();
    const report = {
      id: generateReportId(),
      projectId: payload.projectId,
      projectName: payload.projectName || '',
      wallet: payload.wallet || '',
      name: payload.name || '',
      email: payload.email || '',
      category: payload.category,
      subject: payload.subject,
      message: payload.message,
      attachments: payload.attachments || [],
      status: 'new',
      adminNotes: '',
      createdAt: now,
      updatedAt: now,
    };
    store.reports = [report, ...store.reports];
    writeFallbackStore(store);
    return { ok: true, reportId: report.id, report: { id: report.id, status: report.status, createdAt: report.createdAt }, fallback: true };
  }
}

export function getStoredAdminToken() {
  return sessionStorage.getItem(ADMIN_TOKEN_KEY) || '';
}

export async function fetchReports(token, { status = 'all', category = 'all', projectId = '', search = '', dateFrom = '', dateTo = '' } = {}) {
  const params = new URLSearchParams({ status, category });
  if (projectId) params.set('projectId', projectId);
  if (search) params.set('search', search);
  if (dateFrom) params.set('dateFrom', dateFrom);
  if (dateTo) params.set('dateTo', dateTo);
  try {
    return await callFunction(`report-admin-list?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (error) {
    if (!isFunctionUnavailable(error) || !token.startsWith('dev-fallback-')) throw error;
    const store = readFallbackStore();
    let reports = store.reports;
    if (status !== 'all') reports = reports.filter((report) => report.status === status);
    if (category !== 'all') reports = reports.filter((report) => report.category === category);
    if (projectId) reports = reports.filter((report) => report.projectId === projectId);
    if (search) {
      const needle = search.toLowerCase();
      reports = reports.filter((report) =>
        [report.subject, report.message, report.projectName, report.projectId, report.email, report.wallet, report.id]
          .filter(Boolean)
          .some((field) => field.toLowerCase().includes(needle))
      );
    }
    reports = [...reports].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const stats = {
      total: store.reports.length,
      new: store.reports.filter((r) => r.status === 'new').length,
      under_review: store.reports.filter((r) => r.status === 'under_review').length,
      resolved: store.reports.filter((r) => r.status === 'resolved').length,
      rejected: store.reports.filter((r) => r.status === 'rejected').length,
    };
    const projects = [...new Set(store.reports.map((r) => r.projectId).filter(Boolean))];
    return { reports, stats, projects };
  }
}

export async function fetchReportDetail(token, id) {
  try {
    const data = await callFunction(`report-admin-detail?id=${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return data.report;
  } catch (error) {
    if (!isFunctionUnavailable(error) || !token.startsWith('dev-fallback-')) throw error;
    const store = readFallbackStore();
    return store.reports.find((report) => report.id === id) || null;
  }
}

async function performAdminAction(token, body) {
  try {
    return await callFunction('report-admin-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (!isFunctionUnavailable(error) || !token.startsWith('dev-fallback-')) throw error;
    const store = readFallbackStore();
    const index = store.reports.findIndex((report) => report.id === body.reportId);
    if (index === -1) throw new Error('Report not found.');
    const report = store.reports[index];
    const now = new Date().toISOString();
    if (body.action === 'set_status') report.status = body.status;
    else if (body.action === 'set_notes') report.adminNotes = body.adminNotes;
    else if (body.action === 'delete') {
      store.reports = store.reports.filter((item) => item.id !== body.reportId);
      writeFallbackStore(store);
      return { ok: true, deleted: true };
    }
    report.updatedAt = now;
    store.reports[index] = report;
    writeFallbackStore(store);
    return { ok: true, report };
  }
}

export const setReportStatus = (token, reportId, status) => performAdminAction(token, { action: 'set_status', reportId, status });
export const setReportNotes = (token, reportId, adminNotes) => performAdminAction(token, { action: 'set_notes', reportId, adminNotes });
export const deleteReport = (token, reportId) => performAdminAction(token, { action: 'delete', reportId });
