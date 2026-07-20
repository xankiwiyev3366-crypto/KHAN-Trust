// Retention alerts (Direction 3): which tokens each user wants to be emailed
// about when trust degrades. Keyed per-user ("sub:<userId>") as its own blob
// so concurrent subscribers never collide (no whole-file last-writer-wins).
// This is the durable backbone of the retention loop - the reason a user
// comes back: "KHAN warned me before it rugged."
import { getNamedStore, jsonResponse } from './_blobsClient.mjs';

const STORE_NAME = 'khan-trust-alerts';

// Hard ceiling, independent of plan. The per-plan cap lives in _watchTiers.mjs
// (MAX_WATCHED_TOKENS) and is enforced by the caller, which knows the tier;
// this is the backstop that bounds the blob's size no matter what.
const MAX_TOKENS_PER_USER = 100;

function store() {
  return getNamedStore(STORE_NAME);
}

function subKey(userId) {
  return `sub:${userId}`;
}

export async function getSubscription(userId) {
  const data = await store().get(subKey(userId), { type: 'json' });
  if (data && typeof data === 'object') return data;
  return { userId, email: '', tokens: [], lastNotified: {} };
}

export async function saveSubscription(sub) {
  await store().setJSON(subKey(sub.userId), sub);
  return sub;
}

// Adds the token if absent, removes it if present. Returns the new state so
// the client can reflect the toggle immediately.
// `limit` is the caller's plan cap (see MAX_WATCHED_TOKENS in _watchTiers.mjs),
// defaulting to the hard ceiling when not supplied.
//
// REMOVAL IS NEVER BLOCKED BY THE CAP. A user who downgrades from Premium sits
// above the free cap; refusing their un-watch requests would trap them over the
// limit with no way down, which is the worst possible way to handle a
// downgrade. Only ADDING is gated.
export async function toggleToken(userId, email, token, limit = MAX_TOKENS_PER_USER) {
  const sub = await getSubscription(userId);
  sub.userId = userId;
  if (email) sub.email = email;
  if (!Array.isArray(sub.tokens)) sub.tokens = [];

  const already = sub.tokens.some((entry) => entry.identity === token.identity);
  if (already) {
    sub.tokens = sub.tokens.filter((entry) => entry.identity !== token.identity);
    await saveSubscription(sub);
    return { subscribed: false, tokens: sub.tokens, limit };
  }

  const cap = Math.min(Number(limit) || MAX_TOKENS_PER_USER, MAX_TOKENS_PER_USER);
  if (sub.tokens.length >= cap) {
    // Reported rather than silently truncated: a user who hits the cap must be
    // told, so the upgrade prompt is a fact about their account and not a
    // mysterious failure to save.
    return { subscribed: false, tokens: sub.tokens, limit: cap, limitReached: true };
  }

  sub.tokens = [token, ...sub.tokens].slice(0, cap);
  await saveSubscription(sub);
  return { subscribed: true, tokens: sub.tokens, limit: cap };
}

// Used only by the scheduled worker (alerts-run), never per-request.
export async function listSubscriptions() {
  const result = await store().list({ prefix: 'sub:' });
  const subs = await Promise.all(
    (result.blobs || []).map((blob) => store().get(blob.key, { type: 'json' }).catch(() => null))
  );
  return subs.filter(Boolean);
}

export { jsonResponse };
