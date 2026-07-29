// Client half of product event tracking.
//
// ── WHY THIS IS NOT src/analytics.js ────────────────────────────────────────
//
// analytics.js sends to Google Analytics and the Meta Pixel — third-party ad and
// measurement platforms. This sends to KHAN Trust's own event store, and the two
// are not interchangeable:
//
//   - GA is sampled, aggregated, delayed, and gone if a visitor blocks it. That
//     is fine for "how many people saw the pricing page" and useless for "did
//     this order convert", which has to be exact.
//   - The verification funnel is a REVENUE report. It cannot depend on an ad
//     network's retention policy or on the visitor not running an ad blocker.
//   - Nothing here is sent to a third party, so it carries no advertising
//     identifiers and needs no consent banner beyond what the site already has.
//
// Both are kept. They answer different questions to different audiences.
//
// ── EVERYTHING HERE IS BEST-EFFORT AND SILENT ───────────────────────────────
//
// Every call site is on a path the user cares about — starting a scan, hitting a
// paywall, clicking upgrade. A tracking failure must never surface as a failed
// scan, and must never delay one. So: no awaits at the call sites, no retries,
// no error surfaces. Events that MUST NOT be lost (payment, activation, expiry)
// are server-authored and go through the durable queue instead; this endpoint
// deliberately carries only the ones where a small loss rate is acceptable.
import { PRODUCT_EVENTS, isClientEmittable } from './lib/productEvents.js';

const AUTH_TOKEN_KEY = 'khan-trust-auth-token-v1';
const SESSION_KEY = 'khan-trust-event-session';

// An anonymous, per-tab-session id. sessionStorage rather than localStorage on
// purpose: this exists to group one visit's events, NOT to track a person across
// visits. It dies with the tab, it is never sent to a third party, and it is not
// derived from anything about the device.
function sessionId() {
  try {
    let id = window.sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      window.sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    // Private mode, or storage disabled. An event with no session is still a
    // real event and is sent anyway — the funnel counts events, and dropping
    // them would silently under-report exactly the privacy-conscious users this
    // product is for.
    return '';
  }
}

function authHeaders() {
  try {
    const token = window.localStorage.getItem(AUTH_TOKEN_KEY);
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

// NO DEV FALLBACK, deliberately. src/devFallback.js documents what happened the
// last time a client module invented a local success for a server call it could
// not make. There is nothing to fabricate here: an event that did not reach the
// server did not happen, and pretending otherwise would corrupt the one report
// revenue decisions are made from.
export function trackProductEvent(name, payload = {}) {
  if (typeof window === 'undefined') return;
  if (!isClientEmittable(name)) {
    // The server refuses these too — this is the client-side half of the same
    // rule, so a mistake shows up in development instead of being silently
    // dropped by a 204 in production.
    if (import.meta.env.DEV) console.warn(`[events] "${name}" is not client-emittable`);
    return;
  }

  const body = JSON.stringify({
    name,
    sessionId: sessionId(),
    chain: payload.chain || '',
    contract: payload.contract || '',
    source: payload.source || (typeof document !== 'undefined' ? document.referrer : ''),
    metadata: payload.metadata || {},
  });

  try {
    // keepalive so an event fired during navigation (an upgrade click that
    // leaves for Stripe) still leaves the browser. sendBeacon would do the same
    // but cannot carry the Authorization header, and losing the user id on
    // exactly the events that precede a purchase is the wrong trade.
    fetch('/.netlify/functions/events-track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Never load-bearing.
  }
}

// Named helpers so call sites read as intent rather than as string literals, and
// so a renamed event is one edit here instead of a grep across 13 000 lines.
export function trackScanStarted({ contract, chain } = {}) {
  trackProductEvent(PRODUCT_EVENTS.SCAN_STARTED, { contract, chain });
}

export function trackScanCompleted({ contract, chain, trustScore, riskLevel } = {}) {
  trackProductEvent(PRODUCT_EVENTS.SCAN_COMPLETED, {
    contract,
    chain,
    metadata: { trustScore, riskLevel },
  });
}

export function trackScanFailed({ contract, chain, reason } = {}) {
  trackProductEvent(PRODUCT_EVENTS.SCAN_FAILED, { contract, chain, metadata: { reason } });
}

export function trackWalletConnected(provider) {
  // The provider NAME only. Never the address — see FORBIDDEN_METADATA_KEYS in
  // lib/productEvents.js: a wallet address in a permanent analytics store is a
  // durable public identifier for a person.
  trackProductEvent(PRODUCT_EVENTS.WALLET_CONNECTED, { metadata: { provider: String(provider || '') } });
}

export function trackPaywallHit(feature) {
  trackProductEvent(PRODUCT_EVENTS.PAYWALL_HIT, { metadata: { feature: String(feature || '') } });
}

export function trackUpgradeClicked(plan, placement) {
  trackProductEvent(PRODUCT_EVENTS.UPGRADE_CLICKED, {
    metadata: { plan: String(plan || ''), placement: String(placement || '') },
  });
}
