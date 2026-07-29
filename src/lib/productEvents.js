// THE PRODUCT EVENT VOCABULARY, and the rules about what an event may carry.
//
// PURE MODULE — no import.meta.env, no Node APIs — so the browser and the
// Netlify Functions emit the same names from one definition. Enforced by
// scripts/verify-functions.mjs.
//
// ── WHY A CLOSED VOCABULARY ─────────────────────────────────────────────────
//
// Every analytics system that accepts free-form event names ends up with
// `scan_complete`, `scanCompleted`, `scan_completed` and `Scan Completed` in the
// same table, at which point the funnel is unmeasurable and nobody notices,
// because a wrong number looks exactly like a right one. The names below are the
// only ones that exist. An unknown name is REJECTED at the door rather than
// stored — a dropped event you can see in a log is recoverable; a mis-spelled
// event silently inflating a denominator is not.
//
// These names are also PERMANENT. They are written into stored records and into
// funnel queries; renaming one orphans history.
export const PRODUCT_EVENTS = {
  SCAN_STARTED: 'scan_started',
  SCAN_COMPLETED: 'scan_completed',
  SCAN_FAILED: 'scan_failed',
  WALLET_CONNECTED: 'wallet_connected',
  PROJECT_PROFILE_VIEWED: 'project_profile_viewed',
  BADGE_IMPRESSION: 'badge_impression',
  VERIFICATION_QUOTE_CREATED: 'verification_quote_created',
  VERIFICATION_ORDER_CREATED: 'verification_order_created',
  VERIFICATION_PAYMENT_DETECTED: 'verification_payment_detected',
  VERIFICATION_PAYMENT_CONFIRMED: 'verification_payment_confirmed',
  VERIFICATION_OWNERSHIP_STARTED: 'verification_ownership_started',
  VERIFICATION_OWNERSHIP_COMPLETED: 'verification_ownership_completed',
  VERIFICATION_ACTIVATED: 'verification_activated',
  VERIFICATION_EXPIRED: 'verification_expired',
  VERIFICATION_REVOKED: 'verification_revoked',
  VERIFICATION_REFUNDED: 'verification_refunded',
  ALERT_FIRED: 'alert_fired',
  PAYWALL_HIT: 'paywall_hit',
  UPGRADE_CLICKED: 'upgrade_clicked',
};

export const PRODUCT_EVENT_NAMES = Object.values(PRODUCT_EVENTS);
const NAME_SET = new Set(PRODUCT_EVENT_NAMES);

export function isProductEvent(name) {
  return NAME_SET.has(name);
}

// The subset a BROWSER is allowed to emit. Everything else is server-authored.
//
// This is not a formality. `verification_activated` is the event the revenue
// funnel's conversion rate is computed from; if a page could post it, the
// conversion rate would be a number anyone on the internet could set. The rule
// is the same one the score floor, the tier price and the badge state all
// follow: a claim the client can author is a claim that means nothing.
export const CLIENT_EMITTABLE = new Set([
  PRODUCT_EVENTS.SCAN_STARTED,
  PRODUCT_EVENTS.SCAN_COMPLETED,
  PRODUCT_EVENTS.SCAN_FAILED,
  PRODUCT_EVENTS.WALLET_CONNECTED,
  // badge_impression is NOT here. It is recorded server-side by
  // verify-badge-status.mjs, the endpoint the embedded widget actually calls, so
  // the count is of real badge fetches rather than of whatever a third-party page
  // chose to report. That page is, by definition, not under our control — the
  // whole security model of the badge (see _badgeState.mjs) is that nothing the
  // embedding site sends can influence what the badge says, and letting it
  // author the impression count would carve an exception into exactly that rule.
  PRODUCT_EVENTS.PAYWALL_HIT,
  PRODUCT_EVENTS.UPGRADE_CLICKED,
]);

export function isClientEmittable(name) {
  return CLIENT_EMITTABLE.has(name);
}

// ── What must never be stored on an event ───────────────────────────────────
//
// Analytics is the least-guarded, longest-lived, most-widely-read store in any
// system: it is queried by dashboards, exported to spreadsheets, and kept long
// after the record it describes is gone. So it is the worst possible place for a
// secret, and the easiest place for one to arrive by accident — somebody passes
// the whole order object into `metadata` because it was convenient.
//
// These keys are stripped from metadata unconditionally, by name, at write time.
// A denylist rather than an allowlist is chosen deliberately: an allowlist on a
// free-form metadata bag would silently drop the useful half of every new event
// and the loss would be invisible. This list is enforced in one place
// (sanitizeMetadata) so it cannot be bypassed by a new call site.
export const FORBIDDEN_METADATA_KEYS = new Set([
  'signature', 'paymentsignature', 'transactionhash', 'txhash', 'txsignature',
  'nonce', 'token', 'accesstoken', 'authtoken', 'badgetoken', 'jwt', 'bearer',
  'password', 'passcode', 'secret', 'apikey', 'privatekey', 'seed', 'mnemonic',
  'email', 'emailaddress', 'ip', 'ipaddress', 'buyersubject', 'ownerwallet',
  'wallet', 'walletaddress', 'authorization', 'cookie', 'adminnote',
]);

const MAX_METADATA_KEYS = 20;
const MAX_STRING = 200;

// Returns a metadata object that is safe to keep forever.
//
// Three separate protections, because they fail differently:
//   - forbidden keys are DROPPED (the secret problem)
//   - values are flattened to primitives and length-capped (the "someone passed
//     the whole API response" problem, which is how a secret arrives nested)
//   - the key count is capped (the unbounded-growth problem)
export function sanitizeMetadata(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  let count = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (count >= MAX_METADATA_KEYS) break;
    const cleanKey = String(key).slice(0, 40);
    // Normalised comparison: `paymentSignature`, `payment_signature` and
    // `PAYMENT-SIGNATURE` are all the same field with the same problem.
    if (FORBIDDEN_METADATA_KEYS.has(cleanKey.toLowerCase().replace(/[^a-z0-9]/g, ''))) continue;
    if (value == null) continue;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) continue;
      out[cleanKey] = value;
    } else if (typeof value === 'boolean') {
      out[cleanKey] = value;
    } else if (typeof value === 'string') {
      out[cleanKey] = value.replace(/<[^>]*>/g, '').slice(0, MAX_STRING);
    } else {
      // Objects and arrays are NOT recursed into. A nested bag is exactly how an
      // unreviewed payload — and the secret inside it — gets past a key check.
      continue;
    }
    count += 1;
  }
  return out;
}

// ── Deduplication ───────────────────────────────────────────────────────────
//
// Every event carries a dedup key, and events that describe a STATE TRANSITION
// derive theirs from the thing that transitioned rather than from the clock.
//
// The difference matters at exactly the moment it is hardest to test: a retried
// activation, a re-run cron, a user double-clicking. A timestamp-based key makes
// each of those a new event and the activation count drifts above the number of
// activations that happened. An order-derived key makes the retry a no-op.
//
// This is the same event-derived rule the retention engine follows, for the same
// reason it was written down there: "derived from the event, not from when the
// code happened to run".
export function defaultDedupKey({ name, orderId, projectId, chain, contract, sessionId, timestamp }) {
  if (orderId) return `${name}:order:${orderId}`;
  if (projectId) return `${name}:project:${projectId}`;
  if (chain && contract) {
    // Impression- and view-style events are legitimately repeatable, so they are
    // bucketed by session and day rather than collapsed to one forever: two
    // views by two people are two facts, two views by one person in one session
    // are one.
    const day = String(timestamp || '').slice(0, 10);
    return `${name}:${chain}:${contract}:${sessionId || 'anon'}:${day}`;
  }
  return '';
}
