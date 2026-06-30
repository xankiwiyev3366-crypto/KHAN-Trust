// Internal Analytics Dashboard - client tracking module.
//
// Single source of truth: every call here posts one event to the
// analytics-track Netlify Function, which appends to one shared event log
// in Netlify Blobs (see netlify/functions/_analyticsStore.mjs). The admin
// dashboard (analytics-summary) derives every metric from that same log, so
// desktop and mobile clients - and every page that calls trackEvent() -
// feed the exact same backend with no separate counters to drift out of
// sync. Verification submitted/approved/rejected events are recorded
// server-side instead (see verification-request.mjs /
// verification-admin-review.mjs) so they are never double-counted here.
//
// Tracking calls are fire-and-forget: a failure here must never block or
// surface in the UI, since analytics is observability, not a feature the
// user is blocked on.

const VISITOR_ID_KEY = 'khan-trust-visitor-id-v1';
const VISITOR_SEEN_KEY = 'khan-trust-visitor-seen-v1';

let _currentUserId = null;

export function setAnalyticsUserId(userId) {
  _currentUserId = userId || null;
}

function randomId() {
  return `v-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getOrCreateVisitorId() {
  try {
    let id = localStorage.getItem(VISITOR_ID_KEY);
    if (!id) {
      id = randomId();
      localStorage.setItem(VISITOR_ID_KEY, id);
    }
    return id;
  } catch {
    return randomId();
  }
}

function isNewVisitor() {
  try {
    const seen = localStorage.getItem(VISITOR_SEEN_KEY);
    if (seen) return false;
    localStorage.setItem(VISITOR_SEEN_KEY, '1');
    return true;
  } catch {
    return true;
  }
}

function detectDevice() {
  if (typeof window === 'undefined') return 'desktop';
  const isNarrow = window.innerWidth <= 768;
  const isMobileUA = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  return isNarrow || isMobileUA ? 'mobile' : 'desktop';
}

function detectTrafficSource() {
  if (typeof document === 'undefined' || !document.referrer) return 'direct';
  try {
    const host = new URL(document.referrer).hostname.toLowerCase();
    if (host.includes('google.')) return 'google';
    if (host.includes('x.com') || host.includes('twitter.com')) return 'x';
    if (host.includes('t.me') || host.includes('telegram')) return 'telegram';
    if (host.includes('khantrust')) return 'direct';
    return 'other';
  } catch {
    return 'direct';
  }
}

const visitorContext = {
  visitorId: '',
  isNewVisitor: false,
  device: 'desktop',
  trafficSource: 'direct',
};

export function initAnalyticsContext() {
  visitorContext.visitorId = getOrCreateVisitorId();
  visitorContext.isNewVisitor = isNewVisitor();
  visitorContext.device = detectDevice();
  visitorContext.trafficSource = detectTrafficSource();
  return visitorContext;
}

export function trackEvent(type, payload = {}) {
  try {
    const body = JSON.stringify({
      type,
      visitorId: visitorContext.visitorId || getOrCreateVisitorId(),
      isNewVisitor: visitorContext.isNewVisitor,
      device: visitorContext.device || detectDevice(),
      trafficSource: visitorContext.trafficSource || detectTrafficSource(),
      ...(_currentUserId ? { userId: _currentUserId } : {}),
      ...payload,
    });
    fetch('/.netlify/functions/analytics-track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Tracking must never break the app.
  }
}

export function trackPageViewEvent(path) {
  trackEvent('page_view', { path });
}

export function trackTokenScanEvent(project) {
  trackEvent('token_scan', {
    projectId: project.id,
    projectName: project.name,
    ticker: project.ticker,
    contract: project.contract,
    trustScore: project.trustScore,
  });
}

export function trackProjectViewEvent(project) {
  trackEvent('project_view', {
    projectId: project.id,
    projectName: project.name,
    ticker: project.ticker,
    contract: project.contract,
    trustScore: project.trustScore,
  });
}

export function trackProjectAddedEvent(project) {
  trackEvent('project_added', {
    projectId: project.id,
    projectName: project.name,
    ticker: project.ticker,
    contract: project.contract,
    trustScore: project.trustScore,
  });
}

export function trackCompareUsedEvent(first, second) {
  trackEvent('compare_used', {
    projectId: first?.id || '',
    projectName: first?.name || '',
    ticker: second?.ticker || '',
    contract: second?.id || '',
  });
}

export function trackSearchEvent(query) {
  if (!query || !query.trim()) return;
  trackEvent('search', { query: query.trim() });
}

export async function fetchAnalyticsSummary(token) {
  const response = await fetch('/.netlify/functions/analytics-summary', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.message || `Request to analytics-summary failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export function downloadAsFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function summaryToCsv(summary) {
  const rows = [['Metric', 'Value']];
  const flatten = (prefix, value) => {
    if (value === null || value === undefined) {
      rows.push([prefix, '']);
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => flatten(`${prefix}[${index}]`, item));
    } else if (typeof value === 'object') {
      Object.entries(value).forEach(([key, nested]) => flatten(prefix ? `${prefix}.${key}` : key, nested));
    } else {
      rows.push([prefix, String(value)]);
    }
  };
  flatten('', summary);
  return rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
}
