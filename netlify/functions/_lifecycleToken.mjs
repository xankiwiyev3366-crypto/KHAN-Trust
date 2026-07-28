// Unsubscribe tokens.
//
// An unsubscribe link is clicked from an email client, so it cannot carry a JWT
// or require a session — it has to work with nothing but the URL. That makes it
// a capability, and the two failure modes are opposite and both serious:
//
//   - guessable  → anyone can unsubscribe anyone else from their alerts;
//   - reversible → the token would leak the user's id or email into every mail
//                  client, proxy and link-scanner that touches the message.
//
// So it is an HMAC of the user id under a server-only secret. It is
// deterministic (the same user always gets the same link, so an old email still
// works), it cannot be forged without the secret, and it reveals nothing about
// the account on its own. Verification recomputes the tag for a candidate user
// id rather than decoding anything out of the token.
//
// The token is deliberately NOT a session: it authorises exactly one action —
// opting out of lifecycle email — and nothing else.
import crypto from 'node:crypto';

// Read LAZILY, not at module load. ESM evaluates imports before any importing
// module's body, so a module-level constant would capture the environment as it
// was before the caller could configure it — which is both a real hazard in a
// function runtime and the reason this was untestable.
//
// Falls back to the JWT secret so a deployment that has not set a dedicated one
// still produces unguessable tokens. Never defaults to a literal: with no
// secret at all the feature reports itself unconfigured rather than issuing
// forgeable tokens.
function secret() {
  return process.env.LIFECYCLE_UNSUBSCRIBE_SECRET || process.env.JWT_SECRET || '';
}

export function isUnsubscribeConfigured() {
  return Boolean(secret());
}

function tag(userId) {
  return crypto.createHmac('sha256', secret()).update(`unsub:${userId}`).digest('hex').slice(0, 32);
}

// `<userId>.<tag>`. The id is in the clear because the endpoint needs to know
// WHO to unsubscribe; the tag is what makes it unforgeable. A user id is not a
// secret — it is not a credential and grants nothing on its own.
export function unsubscribeTokenFor(user) {
  if (!secret() || !user?.id) return '';
  return `${user.id}.${tag(user.id)}`;
}

// Returns the verified user id, or '' if the token is malformed or forged.
// Uses a timing-safe comparison: this is a small surface, but a tag oracle is
// exactly the kind of thing that is cheap to close now and awkward later.
export function verifyUnsubscribeToken(token) {
  if (!secret() || typeof token !== 'string') return '';
  const separator = token.lastIndexOf('.');
  if (separator <= 0) return '';
  const userId = token.slice(0, separator);
  const provided = token.slice(separator + 1);
  const expected = tag(userId);
  if (provided.length !== expected.length) return '';
  try {
    if (!crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) return '';
  } catch {
    return '';
  }
  return userId;
}
