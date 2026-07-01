// Retention alerts (Direction 3): which tokens each user wants to be emailed
// about when trust degrades. Keyed per-user ("sub:<userId>") as its own blob
// so concurrent subscribers never collide (no whole-file last-writer-wins).
// This is the durable backbone of the retention loop - the reason a user
// comes back: "KHAN warned me before it rugged."
import { getNamedStore, jsonResponse } from './_blobsClient.mjs';

const STORE_NAME = 'khan-trust-alerts';
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
export async function toggleToken(userId, email, token) {
  const sub = await getSubscription(userId);
  sub.userId = userId;
  if (email) sub.email = email;
  if (!Array.isArray(sub.tokens)) sub.tokens = [];
  const already = sub.tokens.some((entry) => entry.identity === token.identity);
  sub.tokens = already
    ? sub.tokens.filter((entry) => entry.identity !== token.identity)
    : [token, ...sub.tokens].slice(0, MAX_TOKENS_PER_USER);
  await saveSubscription(sub);
  return { subscribed: !already, tokens: sub.tokens };
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
