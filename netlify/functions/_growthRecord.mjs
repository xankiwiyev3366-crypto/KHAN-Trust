// Server-side event recording for facts only the backend can vouch for:
// a real registration, a real login, a real completed payment.
//
// Kept separate from growth-track.mjs so these types are physically
// unreachable from the public ingestion endpoint - the browser cannot forge a
// registration or a conversion, which is what makes the funnel's denominator
// and numerator both trustworthy.
//
// Every function here is FAIL-SOFT by contract. Recording a growth event must
// never turn a successful signup or payment into an error response: the user's
// action already happened, and losing one analytics row is strictly better than
// failing the action that produced it.
import { putEvent } from './_growthEvents.mjs';
import { buildEvent, EVENT_TYPES, CHANNELS } from './_growthSchema.mjs';

async function safePut(type, payload) {
  try {
    await putEvent(buildEvent(type, payload));
  } catch {
    // Intentionally swallowed - see the fail-soft contract above.
  }
}

export function recordRegistration({ userId, attribution, device } = {}) {
  return safePut(EVENT_TYPES.SIGNUP_COMPLETED, { userId, attribution, device });
}

export function recordLogin({ userId, attribution, device } = {}) {
  return safePut(EVENT_TYPES.LOGIN, { userId, attribution, device });
}

export function recordCheckoutCompleted({ userId, plan, attribution } = {}) {
  return safePut(EVENT_TYPES.CHECKOUT_COMPLETED, { userId, plan, attribution });
}

// ── Lifecycle mail ───────────────────────────────────────────────────────────
//
// These originate in a cron and an emailed link, not in a browsing session, so
// there is no visit to attribute them to. They are explicitly INTERNAL rather
// than allowed to take buildEvent's `direct` default: a nightly mailer left on
// the default would quietly add a row of "direct traffic" for every message it
// sent, inflating the one channel that is already the dumping ground for
// unknowns and corrupting acquisition numbers that have nothing to do with it.
const INTERNAL = { attribution: { channel: CHANNELS.INTERNAL, firstTouchChannel: CHANNELS.INTERNAL } };

export function recordLifecycleEmailSent({ userId, stage } = {}) {
  return safePut(EVENT_TYPES.LIFECYCLE_EMAIL_SENT, { userId, stage, ...INTERNAL });
}

// The cost side of the sequence. Recorded per event, not as a user flag, so it
// can be read as a rate against the sends that caused it.
export function recordLifecycleUnsubscribed({ userId, stage } = {}) {
  return safePut(EVENT_TYPES.LIFECYCLE_UNSUBSCRIBED, { userId, stage, ...INTERNAL });
}

export function recordLifecycleResubscribed({ userId } = {}) {
  return safePut(EVENT_TYPES.LIFECYCLE_RESUBSCRIBED, { userId, ...INTERNAL });
}
