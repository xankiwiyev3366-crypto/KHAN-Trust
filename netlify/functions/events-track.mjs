// POST /.netlify/functions/events-track
// { name, sessionId?, chain?, contract?, source?, metadata? }
//
// The browser's door into the product event store. Public and unauthenticated,
// because the events it accepts (a scan starting, a paywall being hit, an
// upgrade button being clicked) happen to signed-out visitors and are the top of
// the funnel — requiring auth would measure only the people who already
// converted.
//
// Being public is exactly why it is narrow:
//
//   1. ONLY CLIENT-EMITTABLE NAMES. isClientEmittable() is a small allowlist.
//      `verification_activated` is not on it and never will be: it is the
//      numerator of the conversion rate, and an endpoint that let a browser
//      author it would let anyone on the internet set the platform's reported
//      revenue funnel. Server-authored events are authored by the server.
//   2. NO IDENTITY FROM THE BODY. `userId` is taken from a verified JWT when one
//      is present and IGNORED otherwise — a caller cannot attribute activity to
//      someone else's account.
//   3. RATE LIMITED per IP, failing open like every other policy here.
//   4. METADATA IS SANITISED by the store (sanitizeMetadata), so a caller cannot
//      push a secret or an unbounded blob into permanent analytics storage.
//
// Always answers 204. A tracking endpoint that returns errors to a browser
// teaches the client to retry, and a retrying analytics beacon is a
// self-inflicted traffic problem; it also leaks which names are valid, which is
// a free map of the funnel for anyone probing it.
import { verifyJwt, bearerToken } from './_authStore.mjs';
import { recordEvent } from './_productEvents.mjs';
import { enforce, getClientIp } from './_rateLimit.mjs';
import { isProductEvent, isClientEmittable } from '../../src/lib/productEvents.js';

const NO_CONTENT = { statusCode: 204, headers: { 'Cache-Control': 'no-store' }, body: '' };

export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers: { 'Content-Type': 'text/plain' }, body: 'Method not allowed' };
    }

    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return NO_CONTENT;
    }

    const name = String(payload.name || '').trim();
    if (!isProductEvent(name) || !isClientEmittable(name)) {
      // Logged, not answered. An unknown name from a browser is either a stale
      // deploy or a probe, and both are worth seeing in the logs; neither is
      // worth telling the caller about.
      console.warn(`[events-track] refused name from client: ${name.slice(0, 60)}`);
      return NO_CONTENT;
    }

    // The ceiling itself lives in RATE_POLICIES, not here — that module is
    // explicit that "named policies so limits live in one place and stay
    // consistent" is the rule.
    const limit = await enforce('events_track_ip', getClientIp(event));
    if (!limit.allowed) return NO_CONTENT;

    // Identity comes from the verified token or not at all.
    const auth = verifyJwt(bearerToken(event));

    await recordEvent({
      name,
      userId: auth?.sub || '',
      sessionId: String(payload.sessionId || '').slice(0, 64),
      chain: String(payload.chain || '').slice(0, 40),
      contract: String(payload.contract || '').slice(0, 128),
      source: String(payload.source || '').slice(0, 300),
      metadata: payload.metadata,
    });

    return NO_CONTENT;
  } catch (error) {
    console.warn(`[events-track] failed (non-fatal): ${error.message}`);
    return NO_CONTENT;
  }
}
