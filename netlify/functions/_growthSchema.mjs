// The Growth OS event contract: what may be recorded, and how a visit is
// attributed to a channel.
//
// This module is the ONLY place the event vocabulary is defined. Both the
// ingestion endpoint and every warehouse metric import from here, so a metric
// can never quietly depend on an event type that ingestion rejects.

// ── Taxonomy ──────────────────────────────────────────────────────────────────
//
// Grouped by the funnel stage each event proves. The critical addition over the
// legacy analytics store is the CONVERSION stage: those events currently exist
// ONLY as Google Analytics calls (src/analytics.js), which means the platform's
// own backend cannot see a single conversion and no AI could reason about the
// funnel the operator most wants to improve. Bringing them first-party is what
// makes "increase conversion rates" a measurable objective rather than a wish.

export const EVENT_TYPES = {
  // Acquisition — a person arrived.
  PAGE_VIEW: 'page_view',

  // Activation — they used the core product (scanning a token).
  SCAN_STARTED: 'scan_started',
  SCAN_COMPLETED: 'token_scan',
  PROJECT_VIEW: 'project_view',
  PROJECT_ADDED: 'project_added',
  COMPARE_USED: 'compare_used',
  SEARCH: 'search',
  WATCHLIST_ADD: 'watchlist_add',
  PDF_DOWNLOAD: 'pdf_download',

  // Registration — they became an account.
  SIGNUP_STARTED: 'signup_started',
  SIGNUP_COMPLETED: 'user_registered',
  LOGIN: 'user_login',

  // Conversion — they moved toward paying.
  PRICING_VIEW: 'pricing_view',
  PREMIUM_CLICK: 'premium_click',
  CHECKOUT_STARTED: 'checkout_started',
  CHECKOUT_COMPLETED: 'checkout_completed',
  CHECKOUT_FAILED: 'checkout_failed',

  // Advocacy — they pulled other people in.
  SHARE_CLICK: 'share_click',
  SOCIAL_CLICK: 'social_click',
};

// Types the PUBLIC ingestion endpoint will accept from a browser.
//
// Deliberately excludes the events a client must not be able to assert:
// user_registered / user_login are written server-side by the auth functions,
// and checkout_completed is written by the Stripe webhook. If the browser could
// post those, anyone could inflate registrations or fake a conversion with a
// single curl - corrupting the exact numbers this system exists to protect.
export const CLIENT_EVENT_TYPES = new Set([
  EVENT_TYPES.PAGE_VIEW,
  EVENT_TYPES.SCAN_STARTED,
  EVENT_TYPES.SCAN_COMPLETED,
  EVENT_TYPES.PROJECT_VIEW,
  EVENT_TYPES.PROJECT_ADDED,
  EVENT_TYPES.COMPARE_USED,
  EVENT_TYPES.SEARCH,
  EVENT_TYPES.WATCHLIST_ADD,
  EVENT_TYPES.PDF_DOWNLOAD,
  EVENT_TYPES.SIGNUP_STARTED,
  EVENT_TYPES.PRICING_VIEW,
  EVENT_TYPES.PREMIUM_CLICK,
  EVENT_TYPES.CHECKOUT_STARTED,
  EVENT_TYPES.CHECKOUT_FAILED,
  EVENT_TYPES.SHARE_CLICK,
  EVENT_TYPES.SOCIAL_CLICK,
]);

export const SERVER_EVENT_TYPES = new Set([
  EVENT_TYPES.SIGNUP_COMPLETED,
  EVENT_TYPES.LOGIN,
  EVENT_TYPES.CHECKOUT_COMPLETED,
]);

// ── Channels ──────────────────────────────────────────────────────────────────
//
// YOUTUBE and TIKTOK are the whole point of this list.
//
// The legacy detector recognised exactly five sources (direct/google/x/telegram/
// other), which means BOTH of the channels the operator actually markets on
// collapsed into "other". Marketing ROI on YouTube and TikTok was not merely
// unmeasured - it was unmeasurable by construction. Everything else is kept so
// that "where did this user come from" has an honest answer even for channels
// the operator does not work; you cannot tell that YouTube is winning without
// knowing what it is winning against.

export const CHANNELS = {
  YOUTUBE: 'youtube',
  TIKTOK: 'tiktok',
  GOOGLE: 'google',
  DIRECT: 'direct',
  X: 'x',
  TELEGRAM: 'telegram',
  REDDIT: 'reddit',
  REFERRAL: 'referral',
  INTERNAL: 'internal',
};

const HOST_CHANNELS = [
  [/(^|\.)(youtube\.com|youtu\.be|m\.youtube\.com)$/, CHANNELS.YOUTUBE],
  [/(^|\.)(tiktok\.com|vm\.tiktok\.com)$/, CHANNELS.TIKTOK],
  [/(^|\.)google\./, CHANNELS.GOOGLE],
  [/(^|\.)(x\.com|twitter\.com|t\.co)$/, CHANNELS.X],
  [/(^|\.)(t\.me|telegram\.org|telegram\.me)$/, CHANNELS.TELEGRAM],
  [/(^|\.)reddit\.com$/, CHANNELS.REDDIT],
  [/(^|\.)khantrust\./, CHANNELS.INTERNAL],
];

// utm_source values are operator-authored, so they are matched loosely - a link
// tagged "yt", "YouTube" or "youtube-short" all mean YouTube. This tolerance
// matters because a mistyped UTM otherwise silently becomes an unattributed
// visit, which looks identical to organic traffic and quietly understates the
// channel's performance.
const UTM_SOURCE_CHANNELS = [
  [/^(youtube|yt|you-?tube)/i, CHANNELS.YOUTUBE],
  [/^(tiktok|tt|tik-?tok)/i, CHANNELS.TIKTOK],
  [/^(google|adwords|gads)/i, CHANNELS.GOOGLE],
  [/^(x|twitter)/i, CHANNELS.X],
  [/^(telegram|tg)/i, CHANNELS.TELEGRAM],
  [/^reddit/i, CHANNELS.REDDIT],
];

export function channelFromUtmSource(utmSource) {
  if (!utmSource) return null;
  const value = String(utmSource).trim();
  for (const [pattern, channel] of UTM_SOURCE_CHANNELS) {
    if (pattern.test(value)) return channel;
  }
  return null;
}

export function channelFromReferrer(referrerHost) {
  if (!referrerHost) return null;
  const host = String(referrerHost).toLowerCase().replace(/^www\./, '');
  for (const [pattern, channel] of HOST_CHANNELS) {
    if (pattern.test(host)) return channel;
  }
  return CHANNELS.REFERRAL;
}

// Resolves the channel for a visit.
//
// Precedence is UTM first, then referrer, then direct. UTM wins because it is
// the operator's own deliberate tag and survives cases the referrer cannot:
// TikTok in particular strips or omits the referrer on most in-app taps, and
// YouTube app traffic frequently arrives with an empty referrer too. Trusting
// the referrer first would file most of the operator's own marketing traffic
// under "direct" - the classic reason social channels look worthless.
export function resolveChannel({ utmSource, referrerHost }) {
  return channelFromUtmSource(utmSource)
    || channelFromReferrer(referrerHost)
    || CHANNELS.DIRECT;
}

// ── Normalisation ─────────────────────────────────────────────────────────────

const MAX_STRING = 200;

export function clamp(value, max = MAX_STRING) {
  if (value === null || value === undefined) return null;
  const str = String(value).slice(0, max);
  return str.length ? str : null;
}

export function eventId() {
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// Builds the canonical stored event. Every field the warehouse relies on is
// established here, so a metric never has to guess whether a field exists.
export function buildEvent(type, payload = {}, now = new Date()) {
  const timestamp = now.toISOString();
  const attribution = payload.attribution || {};

  return {
    id: eventId(),
    type,
    timestamp,

    // Identity
    visitorId: clamp(payload.visitorId),
    sessionId: clamp(payload.sessionId),
    userId: clamp(payload.userId),
    isNewVisitor: Boolean(payload.isNewVisitor),

    // Context
    device: payload.device === 'mobile' ? 'mobile' : 'desktop',
    path: clamp(payload.path),

    // Attribution. `firstTouch` is the channel that ORIGINALLY brought this
    // visitor to the platform, carried forward on every later event by the
    // client; `channel` is this visit's own. Keeping both is what allows credit
    // for a signup to go to the video that started the relationship rather than
    // to whatever the user happened to click last.
    channel: clamp(attribution.channel) || CHANNELS.DIRECT,
    firstTouchChannel: clamp(attribution.firstTouchChannel) || CHANNELS.DIRECT,
    utmSource: clamp(attribution.utmSource),
    utmMedium: clamp(attribution.utmMedium),
    utmCampaign: clamp(attribution.utmCampaign),
    utmContent: clamp(attribution.utmContent),
    referrerHost: clamp(attribution.referrerHost),
    landingPath: clamp(attribution.landingPath),

    // Subject of the event (a token, a plan, a query...)
    projectId: clamp(payload.projectId),
    projectName: clamp(payload.projectName),
    ticker: clamp(payload.ticker),
    contract: clamp(payload.contract),
    chain: clamp(payload.chain),
    trustScore: Number.isFinite(payload.trustScore)
      ? Math.max(0, Math.min(100, Math.round(payload.trustScore)))
      : null,
    query: clamp(payload.query),
    plan: clamp(payload.plan),
    reason: clamp(payload.reason),
  };
}
