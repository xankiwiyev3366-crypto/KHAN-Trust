// Growth Data Plane — client half.
//
// This file runs in the USER app (it has to; it observes users) and contains no
// strategy, no metrics and no admin vocabulary — only the mechanics of
// recording what happened. Everything it collects is first-party and stays on
// KHAN Trust's own backend.
//
// It replaces nothing yet: src/analytics.js (Google Analytics) keeps running
// alongside it. The difference is that these events land somewhere the
// platform's own backend can actually read and reason about, which GA never
// could.
//
// Three jobs, in order of importance:
//   1. ATTRIBUTION  — remember which channel first brought this person here, so
//                     a signup can be credited to the video that caused it.
//   2. SESSIONS     — group events into visits, so retention is measurable.
//   3. IDENTITY     — stitch the anonymous visitor to their account at signup,
//                     which is what connects a channel to a real registration.

const VISITOR_KEY = 'khan-growth-visitor-v1';
const SEEN_KEY = 'khan-growth-seen-v1';
const FIRST_TOUCH_KEY = 'khan-growth-first-touch-v1';
const SESSION_KEY = 'khan-growth-session-v1';

// 30 minutes of inactivity ends a session. This is the near-universal analytics
// convention (GA uses it too); matching it means these numbers can be sanity-
// checked against GA rather than silently disagreeing with it.
const SESSION_IDLE_MS = 30 * 60 * 1000;

function readJson(storage, key) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(storage, key, value) {
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode / full quota. Tracking degrades, the app does not.
  }
}

function randomId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ── Channel classification ────────────────────────────────────────────────────
//
// Mirrors netlify/functions/_growthSchema.mjs. The duplication is deliberate:
// the browser and the Lambda runtime share no module system here, and the
// alternative (shipping the server module to the client) would drag server-only
// concerns into the user bundle. The server re-derives nothing — it stores what
// this sends — so the two only need to agree on the vocabulary, which is
// covered by src/growth.test.mjs.

const UTM_SOURCE_CHANNELS = [
  [/^(youtube|yt|you-?tube)/i, 'youtube'],
  [/^(tiktok|tt|tik-?tok)/i, 'tiktok'],
  [/^(google|adwords|gads)/i, 'google'],
  [/^(x|twitter)/i, 'x'],
  [/^(telegram|tg)/i, 'telegram'],
  [/^reddit/i, 'reddit'],
];

const HOST_CHANNELS = [
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'youtube'],
  [/(^|\.)(tiktok\.com|vm\.tiktok\.com)$/, 'tiktok'],
  [/(^|\.)google\./, 'google'],
  [/(^|\.)(x\.com|twitter\.com|t\.co)$/, 'x'],
  [/(^|\.)(t\.me|telegram\.org|telegram\.me)$/, 'telegram'],
  [/(^|\.)reddit\.com$/, 'reddit'],
  [/(^|\.)khantrust\./, 'internal'],
];

export function classifyChannel({ utmSource, referrerHost }) {
  if (utmSource) {
    for (const [pattern, channel] of UTM_SOURCE_CHANNELS) {
      if (pattern.test(utmSource.trim())) return channel;
    }
  }
  if (referrerHost) {
    const host = referrerHost.toLowerCase().replace(/^www\./, '');
    for (const [pattern, channel] of HOST_CHANNELS) {
      if (pattern.test(host)) return channel;
    }
    return 'referral';
  }
  return 'direct';
}

// ── Attribution ───────────────────────────────────────────────────────────────

function readCurrentAttribution() {
  let utm = {};
  let referrerHost = null;

  try {
    const params = new URLSearchParams(window.location.search);
    utm = {
      utmSource: params.get('utm_source'),
      utmMedium: params.get('utm_medium'),
      utmCampaign: params.get('utm_campaign'),
      utmContent: params.get('utm_content'),
    };
  } catch {
    utm = {};
  }

  try {
    if (document.referrer) referrerHost = new URL(document.referrer).hostname;
  } catch {
    referrerHost = null;
  }

  return {
    ...utm,
    referrerHost,
    channel: classifyChannel({ utmSource: utm.utmSource, referrerHost }),
    landingPath: (() => {
      try {
        return window.location.pathname + window.location.hash;
      } catch {
        return null;
      }
    })(),
  };
}

// First touch is written ONCE and never overwritten.
//
// This is the single most valuable field in the whole data plane. A user
// typically discovers KHAN Trust through a video, leaves, and comes back later
// by typing the URL — by which time last-touch attribution says "direct" and
// the video gets no credit. Without an immutable first touch the operator
// cannot tell which YouTube or TikTok content actually acquires users, which is
// the primary question this system is being built to answer.
//
// An internal referrer is never treated as a first touch: navigating in from
// the platform's own pages is not a discovery.
function resolveFirstTouch(current) {
  const stored = readJson(localStorage, FIRST_TOUCH_KEY);
  if (stored?.channel) return stored;

  if (current.channel === 'internal') return null;

  const firstTouch = {
    channel: current.channel,
    utmSource: current.utmSource || null,
    utmCampaign: current.utmCampaign || null,
    utmContent: current.utmContent || null,
    referrerHost: current.referrerHost || null,
    landingPath: current.landingPath || null,
    at: new Date().toISOString(),
  };
  writeJson(localStorage, FIRST_TOUCH_KEY, firstTouch);
  return firstTouch;
}

// ── Sessions ──────────────────────────────────────────────────────────────────

function currentSessionId() {
  const now = Date.now();
  const session = readJson(sessionStorage, SESSION_KEY);

  if (session?.id && typeof session.lastSeen === 'number' && now - session.lastSeen < SESSION_IDLE_MS) {
    writeJson(sessionStorage, SESSION_KEY, { id: session.id, lastSeen: now });
    return session.id;
  }

  const id = randomId('s');
  writeJson(sessionStorage, SESSION_KEY, { id, lastSeen: now });
  return id;
}

// ── Visitor ───────────────────────────────────────────────────────────────────

function visitorId() {
  try {
    let id = localStorage.getItem(VISITOR_KEY);
    if (!id) {
      id = randomId('v');
      localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch {
    return randomId('v');
  }
}

function isNewVisitor() {
  try {
    if (localStorage.getItem(SEEN_KEY)) return false;
    localStorage.setItem(SEEN_KEY, '1');
    return true;
  } catch {
    return true;
  }
}

function detectDevice() {
  try {
    const narrow = window.innerWidth <= 768;
    const mobileUa = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
    return narrow || mobileUa ? 'mobile' : 'desktop';
  } catch {
    return 'desktop';
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

const context = {
  visitorId: '',
  isNewVisitor: false,
  device: 'desktop',
  attribution: null,
  userId: null,
};

export function initGrowth() {
  const current = readCurrentAttribution();
  const firstTouch = resolveFirstTouch(current);

  context.visitorId = visitorId();
  context.isNewVisitor = isNewVisitor();
  context.device = detectDevice();
  context.attribution = {
    channel: current.channel,
    firstTouchChannel: firstTouch?.channel || current.channel,
    utmSource: current.utmSource || null,
    utmMedium: current.utmMedium || null,
    utmCampaign: current.utmCampaign || null,
    utmContent: current.utmContent || null,
    referrerHost: current.referrerHost || null,
    landingPath: current.landingPath || null,
  };
  return context;
}

// Called on login/registration. Attaching the account id to the SAME visitorId
// that carried the first-touch channel is the join that lets the warehouse
// answer "which video produced this paying user".
export function setGrowthUserId(userId) {
  context.userId = userId || null;
}

export function getGrowthContext() {
  return {
    visitorId: context.visitorId || visitorId(),
    sessionId: currentSessionId(),
    isNewVisitor: context.isNewVisitor,
    device: context.device || detectDevice(),
    attribution: context.attribution || {},
    ...(context.userId ? { userId: context.userId } : {}),
  };
}

export function track(type, payload = {}) {
  try {
    const body = JSON.stringify({ type, ...getGrowthContext(), ...payload });
    // keepalive so events fired during navigation (a checkout redirect, an
    // outbound share click) still reach the server after the page is gone.
    fetch('/.netlify/functions/growth-track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Tracking must never break the app.
  }
}

// Named helpers for every client-assertable event. Callers use these rather
// than raw track() so the event vocabulary stays greppable and typo-proof.
export const growth = {
  pageView: (path) => track('page_view', { path }),
  scanStarted: (query) => track('scan_started', { query }),
  scanCompleted: (project) => track('token_scan', {
    projectId: project?.id,
    projectName: project?.name,
    ticker: project?.ticker,
    contract: project?.contract,
    chain: project?.chain,
    trustScore: project?.trustScore,
  }),
  projectView: (project) => track('project_view', {
    projectId: project?.id,
    projectName: project?.name,
    ticker: project?.ticker,
    contract: project?.contract,
    trustScore: project?.trustScore,
  }),
  projectAdded: (project) => track('project_added', {
    projectId: project?.id,
    projectName: project?.name,
    ticker: project?.ticker,
    contract: project?.contract,
  }),
  compareUsed: (a, b) => track('compare_used', { projectId: a?.id, contract: b?.id }),
  search: (query) => (query?.trim() ? track('search', { query: query.trim() }) : undefined),
  watchlistAdd: (project) => track('watchlist_add', {
    projectId: project?.id,
    projectName: project?.name,
    ticker: project?.ticker,
  }),
  pdfDownload: (project) => track('pdf_download', {
    projectId: project?.id,
    projectName: project?.name,
    ticker: project?.ticker,
  }),
  signupStarted: () => track('signup_started'),
  pricingView: () => track('pricing_view'),
  premiumClick: () => track('premium_click'),
  checkoutStarted: (plan) => track('checkout_started', { plan }),
  checkoutFailed: (plan, reason) => track('checkout_failed', { plan, reason }),
  shareClick: (channel, projectName) => track('share_click', { query: channel, projectName }),
  socialClick: (network) => track('social_click', { query: network }),
};
