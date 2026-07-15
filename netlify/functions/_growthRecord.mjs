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
import { buildEvent, EVENT_TYPES } from './_growthSchema.mjs';

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
