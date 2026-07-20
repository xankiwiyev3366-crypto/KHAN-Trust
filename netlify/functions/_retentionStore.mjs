// Durable retention state, one blob per user.
//
// Keyed `user:<userId>` in its own store, following _alertsStore.mjs rather than
// _userDataStore.mjs: one blob per user, never a single shared object. The
// shared-object pattern is last-writer-wins, and this record is written on the
// hot path (any user, any visit, concurrently) - two users returning in the same
// second would silently erase each other's streak.
//
// KEYED BY ACCOUNT, NOT WALLET
//
// Deliberately the auth user id, never a wallet address. Retention is a property
// of a person coming back, which is exactly what an account is; a wallet is a
// payment instrument a Premium user may not even have (admin-granted Premium has
// no wallet at all - see _premiumAccess.mjs). This store therefore needs no
// entitlement check to read OR write: streaks and notifications are for every
// signed-in user, free or paid. Premium gates features, not memory.
//
// FAILS OPEN
//
// Every read degrades to the empty record and every write is best-effort. A
// retention outage must never block a scan, a login, or a page render - this is
// a layer that remembers, not a layer anything depends on. (The one store in
// this codebase that fails CLOSED is _aiBudget.mjs, because that one spends
// money. Nothing here does.)
import { getNamedStore, jsonResponse } from './_blobsClient.mjs';
import {
  recordDay,
  computeStreak,
  activityWindows,
  normalizeDays,
  sanitizeContext,
  contextChanged,
  isContextFresh,
  dueStreakMilestones,
} from './_retentionEngine.mjs';

const STORE_NAME = 'khan-trust-retention';

function store() {
  return getNamedStore(STORE_NAME);
}

function userKey(userId) {
  return `user:${userId}`;
}

export function emptyRecord(userId) {
  return {
    userId,
    firstSeen: null,
    lastSeen: null,
    days: [],
    // Monotonic high-water mark. `days` is capped at MAX_RETAINED_DAYS, so a
    // streak longer than the retained window would otherwise be forgotten. Only
    // ever raised, never lowered (see mergeLongest), which makes it drift-safe:
    // max() is idempotent, so a replayed or concurrent write cannot corrupt it.
    longestEver: 0,
    lastContext: null,
    milestones: {},
  };
}

export async function getRetention(userId) {
  try {
    const data = await store().get(userKey(userId), { type: 'json' });
    if (!data || typeof data !== 'object') return emptyRecord(userId);
    return { ...emptyRecord(userId), ...data, days: normalizeDays(data.days) };
  } catch {
    return emptyRecord(userId);
  }
}

export async function saveRetention(record) {
  await store().setJSON(userKey(record.userId), record);
  return record;
}

function mergeLongest(record, derivedLongest) {
  return Math.max(Number.isFinite(record.longestEver) ? record.longestEver : 0, derivedLongest);
}

// Records a visit, and optionally where the user was, in ONE read-modify-write.
//
// Returns { record, changed, dayAdded }.
//
// `changed: false` means the blob was NOT written: the day was already recorded
// and the context had not moved. That is the normal case for every page view
// after the first of the day, and skipping the write there is what keeps a
// returning user's session from issuing a blob write per navigation. The read
// still happens - we need the record to answer with - but reads do not contend
// and writes do.
//
// `dayAdded` is reported separately from `changed` because only the SERVER can
// know it: the client cannot tell "first visit today" from "already synced
// today" across devices, and a client that guessed would emit a `user_return`
// analytics event once per device per day instead of once per day. It is the
// difference between a retention metric and a device-count metric.
export async function recordVisit(userId, contextInput, now = Date.now()) {
  const record = await getRetention(userId);
  const nowIso = new Date(now).toISOString();

  const days = recordDay(record.days, now);
  const dayAdded = days.length !== record.days.length;

  const nextContext = sanitizeContext(contextInput, now);
  const contextMoved = contextChanged(record.lastContext, nextContext);

  if (!dayAdded && !contextMoved) {
    return { record, changed: false, dayAdded: false };
  }

  const updated = {
    ...record,
    days,
    firstSeen: record.firstSeen || nowIso,
    // The PREVIOUS lastSeen is preserved before it is overwritten. This is the
    // whole basis of "what changed since your last visit" (Phase 4): by the
    // time the client reads the summary, lastSeen is already this visit, so
    // without capturing the prior value there is nothing to measure "since"
    // against. Only advanced when a genuinely new DAY is recorded - otherwise a
    // second page-load ten minutes later would move the marker forward and
    // erase the very changes the user came back to see.
    previousSeen: dayAdded ? (record.lastSeen || record.previousSeen || null) : (record.previousSeen || null),
    lastSeen: nowIso,
    lastContext: contextMoved ? nextContext : record.lastContext,
  };
  updated.longestEver = mergeLongest(updated, computeStreak(days, now).longest);

  try {
    await saveRetention(updated);
  } catch {
    // Best-effort: hand back the in-memory view so this request still renders a
    // correct answer even if persistence blipped. dayAdded is reported as false
    // because the day was NOT durably recorded - emitting a return event for a
    // visit we failed to store would put the analytics ahead of the data.
    return { record: updated, changed: false, dayAdded: false };
  }
  return { record: updated, changed: true, dayAdded };
}

// Marks milestones as awarded so they are never announced twice. Persists the
// awarded-at stamps and returns the ids that were newly written - the caller
// turns exactly those into notifications.
export async function claimMilestones(userId, ids, now = Date.now()) {
  if (!ids || !ids.length) return [];
  const record = await getRetention(userId);
  const milestones = { ...(record.milestones || {}) };
  const claimed = ids.filter((id) => !milestones[id]);
  if (!claimed.length) return [];
  const nowIso = new Date(now).toISOString();
  for (const id of claimed) milestones[id] = nowIso;
  try {
    await saveRetention({ ...record, milestones });
  } catch {
    // If the claim could not be persisted, report nothing as claimed. Announcing
    // a milestone we failed to record would announce it again on the next visit.
    return [];
  }
  return claimed;
}

// The read model the dashboard renders. Derives everything from the day set at
// read time so there is exactly one source of truth (see _retentionEngine).
export function summarize(record, now = Date.now()) {
  const streak = computeStreak(record.days, now);
  const windows = activityWindows(record.days, now);
  return {
    streak: {
      current: streak.current,
      longest: Math.max(streak.longest, Number.isFinite(record.longestEver) ? record.longestEver : 0),
      lastActiveDay: streak.lastActiveDay,
      activeToday: streak.activeToday,
      // Lets the client tell "no streak yet" from "streak broken" - the
      // difference between a new user and a lapsed one, which must not read the
      // same. See the absence-is-not-zero note in _retentionEngine.
      started: streak.started,
    },
    activity: windows,
    firstSeen: record.firstSeen,
    lastSeen: record.lastSeen,
    // When the user was last here BEFORE this visit. Null for a first-ever
    // session, which the client must render as "welcome" rather than as "no
    // changes" - a new user has no history, which is not the same as a
    // returning user whose watchlist was quiet.
    previousSeen: record.previousSeen || null,
    // Withheld once stale rather than offered as an old suggestion.
    continueContext: isContextFresh(record.lastContext, now) ? record.lastContext : null,
    milestones: record.milestones || {},
  };
}

export { dueStreakMilestones, jsonResponse };
