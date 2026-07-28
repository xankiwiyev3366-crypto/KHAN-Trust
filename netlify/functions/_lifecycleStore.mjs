// Per-user record of which lifecycle emails have been sent, and when.
//
// One blob per user, keyed by user id: { userId, sent: { [stageId]: ms },
// skipped: { [stageId]: ms }, updatedAt }. Same one-key-per-entity shape the
// retention store uses, for the same reason — unrelated users never contend on
// the same object, so a concurrent send cannot clobber someone else's history.
//
// `skipped` exists so an expired stage is recorded ONCE. Without it the cron
// re-derives "welcome has expired" for every dormant account on every run,
// forever. Recording it also makes the decision auditable after the fact:
// "why did this user never get the day-1 email" has an answer in the data.
import { getNamedStore } from './_blobsClient.mjs';

const STORE_NAME = 'khan-trust-lifecycle';

function store() {
  return getNamedStore(STORE_NAME);
}

function userKey(userId) {
  return `user:${userId}`;
}

export function emptyRecord(userId) {
  return { userId, sent: {}, skipped: {}, updatedAt: null };
}

// Reads never throw. A blob outage must not stop the cron from processing the
// rest of the list — it degrades to "this user looks like they have received
// nothing", and the min-gap rule plus the next successful read keep that from
// turning into a duplicate storm.
export async function getLifecycle(userId) {
  try {
    const data = await store().get(userKey(userId), { type: 'json' });
    if (!data || typeof data !== 'object') return emptyRecord(userId);
    return {
      ...emptyRecord(userId),
      ...data,
      sent: data.sent && typeof data.sent === 'object' ? data.sent : {},
      skipped: data.skipped && typeof data.skipped === 'object' ? data.skipped : {},
    };
  } catch {
    return emptyRecord(userId);
  }
}

// Records a successful send. Called ONLY after the provider has accepted the
// message, never before: recording first would mean a provider outage silently
// consumed the user's one shot at that stage.
export async function recordSent(userId, stageId, now = Date.now()) {
  const record = await getLifecycle(userId);
  record.sent = { ...record.sent, [stageId]: now };
  record.updatedAt = now;
  await store().setJSON(userKey(userId), record);
  return record;
}

// Records stages whose window closed without a send, so they are not
// re-evaluated every run.
export async function recordSkipped(userId, stageIds = [], now = Date.now()) {
  if (!stageIds.length) return null;
  const record = await getLifecycle(userId);
  const skipped = { ...record.skipped };
  for (const id of stageIds) {
    if (!skipped[id]) skipped[id] = now;
  }
  record.skipped = skipped;
  record.updatedAt = now;
  await store().setJSON(userKey(userId), record);
  return record;
}

// The engine treats a skipped stage exactly as it treats a sent one — already
// dealt with, do not reconsider. Merging them here means the engine needs no
// concept of "skipped" at all.
export function sentLogFor(record) {
  return { ...(record?.skipped || {}), ...(record?.sent || {}) };
}
