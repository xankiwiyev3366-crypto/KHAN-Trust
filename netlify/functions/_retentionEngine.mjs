// The retention engine: every rule that decides what a user's return history
// MEANS. Pure functions only - no I/O, no store, no clock of its own (the
// caller passes `now`). _retentionStore.mjs handles persistence; this decides
// the semantics, and is unit-tested directly (tests/retentionEngine.test.mjs).
//
// DERIVED, NOT COUNTED
//
// A streak is computed from the recorded day set on every read, never kept as a
// counter that a visit increments. Same discipline _analyticsStore applies to
// the event log, for the same reason: two writers to one counter drift, and a
// drifted streak is worse than no streak - it tells a user who showed up for 30
// days that they showed up for 12. The day set is append-only and idempotent, so
// a double-recorded visit cannot corrupt it.
//
// ABSENCE IS NOT ZERO
//
// A user with no recorded activity has `current: 0` but `started: false`, and
// callers MUST render those differently. "0-day streak" is a judgement on
// someone who may have signed up ninety seconds ago; "not started yet" is the
// truth. This mirrors the Confidence Engine rule the growth console already
// enforces (_growthConfidence.mjs) - never let a missing measurement present as
// a bad one.
//
// UTC THROUGHOUT
//
// Day keys are UTC (`dayKey`), identical to _userActivity.mjs, so a streak
// agrees with the admin activity metrics derived from the same events. A user in
// UTC+4 therefore rolls over at 04:00 local. That is a real cost, accepted
// deliberately: the alternative is storing a per-user timezone and having a
// streak change length when someone travels, which is a worse failure than a
// predictable, consistent boundary.

export const DAY_MS = 86400000;

// How many day keys we retain per user. ~14 months: long enough that a
// longest-streak claim is honest for any plausible account age, small enough
// that the blob stays a few KB.
export const MAX_RETAINED_DAYS = 400;

// Streak lengths worth telling someone about. Deliberately short: these mark a
// habit forming (3), a full week of it (7), and a month (30). There is no
// 100-day badge because a risk scanner is not a game - a milestone that does not
// correspond to real accumulated value is a dark pattern wearing a trophy.
export const STREAK_MILESTONES = [3, 7, 30];

export function dayKey(iso) {
  if (typeof iso === 'string') return iso.slice(0, 10);
  if (iso instanceof Date) return iso.toISOString().slice(0, 10);
  if (typeof iso === 'number') return new Date(iso).toISOString().slice(0, 10);
  return '';
}

// Day key `offset` days away from `key`. Parsed as UTC midnight so a local DST
// transition cannot shift the arithmetic and silently break a streak.
export function shiftDay(key, offset) {
  const ts = Date.parse(`${key}T00:00:00.000Z`);
  if (Number.isNaN(ts)) return '';
  return new Date(ts + offset * DAY_MS).toISOString().slice(0, 10);
}

// Normalises a stored day list: valid keys only, unique, ascending, capped to
// the most recent MAX_RETAINED_DAYS. Every write goes through this, so the blob
// cannot accumulate duplicates or junk regardless of what a caller passes.
export function normalizeDays(days) {
  if (!Array.isArray(days)) return [];
  const valid = days.filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d));
  const unique = [...new Set(valid)].sort();
  return unique.length > MAX_RETAINED_DAYS ? unique.slice(unique.length - MAX_RETAINED_DAYS) : unique;
}

// Adds today to the day set. Returns an equal-length array when the day is
// already present, which is how callers detect "nothing changed" and skip the
// write entirely - the cheapest database request is the one not made, and this
// is the hot path (every returning user, every day).
export function recordDay(days, now = Date.now()) {
  const normalized = normalizeDays(days);
  const today = dayKey(now);
  if (!today || normalized.includes(today)) return normalized;
  return normalizeDays([...normalized, today]);
}

// The current streak: consecutive days ending today, or ending yesterday.
//
// Yesterday counts because a streak is only broken once a whole day has been
// MISSED. Ending it at midnight would show a broken streak to a user who simply
// has not opened the app yet today - punishing them for the hours before they
// arrive, at the exact moment they might have returned. The streak dies when a
// day is genuinely skipped, not when the clock ticks.
export function computeStreak(days, now = Date.now()) {
  const normalized = normalizeDays(days);
  if (!normalized.length) {
    return { current: 0, longest: 0, lastActiveDay: null, activeToday: false, started: false };
  }

  const set = new Set(normalized);
  const today = dayKey(now);
  const yesterday = shiftDay(today, -1);
  const lastActiveDay = normalized[normalized.length - 1];
  const activeToday = set.has(today);

  // Anchor on today if present, else yesterday if present, else the streak is
  // over and current is 0 - with lastActiveDay still telling the caller when it
  // ended, so the UI can say "last seen 5 days ago" rather than nothing.
  let anchor = null;
  if (activeToday) anchor = today;
  else if (set.has(yesterday)) anchor = yesterday;

  let current = 0;
  if (anchor) {
    let cursor = anchor;
    while (set.has(cursor)) {
      current += 1;
      cursor = shiftDay(cursor, -1);
    }
  }

  let longest = 0;
  let run = 0;
  let prev = null;
  for (const day of normalized) {
    run = prev && shiftDay(prev, 1) === day ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = day;
  }

  return { current, longest, lastActiveDay, activeToday, started: true };
}

// Active-day counts over the trailing windows the dashboard shows. Each window
// is inclusive of today, so last-7 spans today plus the previous six days.
export function activityWindows(days, now = Date.now()) {
  const normalized = normalizeDays(days);
  const today = dayKey(now);
  const countWithin = (span) => {
    const cutoff = shiftDay(today, -(span - 1));
    return normalized.filter((day) => day >= cutoff && day <= today).length;
  };
  return {
    activeDaysLast7: countWithin(7),
    activeDaysLast30: countWithin(30),
    totalActiveDays: normalized.length,
    // totalActiveDays cannot exceed MAX_RETAINED_DAYS, so a caller must not
    // present it as lifetime truth for a very old account.
    truncated: normalized.length >= MAX_RETAINED_DAYS,
  };
}

// Which streak milestones this user has newly earned and not yet been told
// about. `awarded` is the stored map of milestone id -> ISO awarded-at, so a
// milestone is announced exactly once for the life of the account: this is the
// dedup guarantee, and it is why the map is persisted rather than recomputed.
//
// Re-earning a streak (30 days, a lapse, another 30) does NOT re-announce. The
// second notification would be identical to the first and carry no new
// information, which is the definition of spam.
export function dueStreakMilestones(currentStreak, awarded = {}) {
  return STREAK_MILESTONES
    .filter((threshold) => currentStreak >= threshold)
    .map((threshold) => `streak_${threshold}`)
    .filter((id) => !awarded || !awarded[id]);
}

// A "continue where you left off" context is only worth showing while it is
// still plausibly what the user was doing. Older than this and resuming it is
// noise, not help - they have moved on, and a stale resume card is a worse first
// impression than an empty one.
export const CONTEXT_TTL_MS = 7 * DAY_MS;

export function isContextFresh(context, now = Date.now()) {
  if (!context || !context.at) return false;
  const ts = Date.parse(context.at);
  if (Number.isNaN(ts)) return false;
  return now - ts <= CONTEXT_TTL_MS && now - ts >= 0;
}

// Whitelist + clamp for a client-supplied resume context. The client sends this,
// so it is untrusted input that gets persisted and later rendered: anything not
// named here is dropped, and strings are length-capped so a hostile or buggy
// caller cannot inflate the blob or smuggle fields into storage.
const CONTEXT_MAX_LEN = 200;
const CONTEXT_TYPES = new Set(['project', 'report', 'compare']);

function cleanString(value) {
  return typeof value === 'string' ? value.trim().slice(0, CONTEXT_MAX_LEN) : '';
}

export function sanitizeContext(input, now = Date.now()) {
  if (!input || typeof input !== 'object') return null;
  const type = cleanString(input.type);
  if (!CONTEXT_TYPES.has(type)) return null;
  const projectId = cleanString(input.projectId);
  if (!projectId) return null;
  return {
    type,
    projectId,
    name: cleanString(input.name),
    ticker: cleanString(input.ticker),
    contract: cleanString(input.contract),
    chain: cleanString(input.chain),
    at: new Date(now).toISOString(),
  };
}

// True when the new context is materially different from the stored one - used
// to skip a pointless write when a user re-opens the project they were already
// on. Timestamps are ignored on purpose: refreshing the clock is not worth a
// blob write on every page view.
export function contextChanged(previous, next) {
  if (!next) return false;
  if (!previous) return true;
  return previous.type !== next.type || previous.projectId !== next.projectId;
}
