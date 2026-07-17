// The in-app notification center, one blob per user (`notif:<userId>`), same
// contention rule as _retentionStore.mjs: never one shared object.
//
// WE STORE KEYS AND PARAMS, NOT SENTENCES
//
// A notification is persisted as { bodyKey, params } - a translation key plus
// its numbers - and rendered by the client through the existing i18n `t()`. It
// is never stored as English prose.
//
// This is the whole reason the notification center can be in four languages. The
// alternative writes the sentence at alert time, on the server, in whatever
// language the worker happens to speak (the email digest is English-only for
// exactly this reason - see alerts-run.mjs). A notification written in English
// in March is still English in an Azerbaijani user's bell in June: storage is
// permanent, so a language choice made at write time is permanent too. Keys are
// late-bound - the same stored row renders in whatever language the reader has
// selected right now, including one added after the row was written.
//
// It also means a copy fix improves every notification already sitting in every
// user's bell, instead of only the ones written after the deploy.
//
// DEDUP IS THE PRODUCT
//
// Every notification carries a caller-supplied stable `id`. Writing an id that
// already exists is a no-op that does NOT resurface or re-unread the row. The
// alert worker is a cron that retries, re-observes the same state hourly, and
// can run twice; without this, the retention feature becomes the reason people
// leave. `addNotifications` is therefore idempotent by contract, and every
// producer derives its id from the EVENT (token + observation), never from a
// timestamp or a random value.
import { getNamedStore, jsonResponse } from './_blobsClient.mjs';

const STORE_NAME = 'khan-trust-notifications';

// Per-user cap. Oldest dropped first. High enough that an engaged user with a
// big watchlist never loses an unread alert between visits, low enough that the
// blob stays small and readable in one shot.
const MAX_NOTIFICATIONS = 100;

// `risk_alert` is the one that matters - the reason to come back. `milestone` is
// deliberately the only other one: nothing here exists to manufacture a reason
// to ping someone.
export const NOTIFICATION_TYPES = new Set(['risk_alert', 'milestone']);

function store() {
  return getNamedStore(STORE_NAME);
}

function userKey(userId) {
  return `notif:${userId}`;
}

export async function listNotifications(userId) {
  try {
    const data = await store().get(userKey(userId), { type: 'json' });
    return Array.isArray(data) ? data : [];
  } catch {
    // Fails open: an unreadable bell shows as empty, never as an error page.
    return [];
  }
}

async function persist(userId, items) {
  const capped = items.length > MAX_NOTIFICATIONS ? items.slice(0, MAX_NOTIFICATIONS) : items;
  await store().setJSON(userKey(userId), capped);
  return capped;
}

// Stable id for a risk alert: the token plus the exact observation it came from.
// Re-running the worker over the same snapshot yields the same id and is
// therefore deduped; a genuinely NEW observation yields a new id and is
// delivered. Never includes Date.now() - that would defeat the whole mechanism.
export function riskAlertId(identity, observedAt) {
  return `risk:${identity}:${observedAt}`;
}

export function milestoneId(userId, milestone) {
  return `milestone:${userId}:${milestone}`;
}

// Adds notifications, skipping any id already present. Returns the ids actually
// written. Newest first. One blob write for the whole batch, so the alert worker
// issues one write per user per run rather than one per token.
export async function addNotifications(userId, incoming) {
  const candidates = (incoming || []).filter((n) => n && n.id && NOTIFICATION_TYPES.has(n.type));
  if (!candidates.length) return [];

  const existing = await listNotifications(userId);
  const seen = new Set(existing.map((n) => n.id));

  // Dedup within the incoming batch too, not just against storage - a caller
  // could legitimately derive the same id twice in one run.
  const fresh = [];
  for (const item of candidates) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    fresh.push({
      id: item.id,
      type: item.type,
      severity: item.severity || 'info',
      titleKey: item.titleKey || '',
      bodyKey: item.bodyKey || '',
      params: item.params && typeof item.params === 'object' ? item.params : {},
      link: item.link || '',
      at: item.at || new Date().toISOString(),
      read: false,
      readAt: null,
    });
  }
  if (!fresh.length) return [];

  try {
    await persist(userId, [...fresh, ...existing]);
  } catch {
    return [];
  }
  return fresh.map((n) => n.id);
}

// Marks specific ids read, or all of them when `ids` is omitted/empty. Returns
// the updated list so the client can render from the response without a second
// GET.
export async function markRead(userId, ids) {
  const existing = await listNotifications(userId);
  if (!existing.length) return [];
  const target = ids && ids.length ? new Set(ids) : null;
  const nowIso = new Date().toISOString();
  let touched = false;

  const updated = existing.map((n) => {
    if (n.read) return n;
    if (target && !target.has(n.id)) return n;
    touched = true;
    return { ...n, read: true, readAt: nowIso };
  });

  // Nothing was unread - skip the write rather than rewrite an identical blob.
  // Opening the bell is the most common action in this feature; it must not cost
  // a write every time.
  if (!touched) return existing;

  try {
    return await persist(userId, updated);
  } catch {
    return existing;
  }
}

export function unreadCount(items) {
  return (items || []).filter((n) => !n.read).length;
}

export { jsonResponse, MAX_NOTIFICATIONS };
