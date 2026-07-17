// Unit tests for the retention engine's rules.
//
// Pure functions, no store, no mocks - _retentionEngine.mjs has no I/O by
// design, which is exactly why these can pin the semantics precisely. The
// end-to-end wiring is covered in tests/retentionSync.test.mjs.
//
// The properties worth defending here are the ones that are wrong in a way
// nobody notices until it has already insulted a user: a streak that reads 0 for
// someone who has not opened the app YET today, a streak that resets because of
// a timezone, or a milestone that congratulates the same person twice.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  dayKey,
  shiftDay,
  normalizeDays,
  recordDay,
  computeStreak,
  activityWindows,
  dueStreakMilestones,
  sanitizeContext,
  contextChanged,
  isContextFresh,
  MAX_RETAINED_DAYS,
  CONTEXT_TTL_MS,
} from '../netlify/functions/_retentionEngine.mjs';

// A fixed clock. Real Date.now() in a streak test is how you get a suite that
// passes for 23 hours a day.
const NOW = Date.parse('2026-07-17T12:00:00.000Z');
const TODAY = '2026-07-17';
const YESTERDAY = '2026-07-16';

// ── Day keys ──────────────────────────────────────────────────────────────────

test('day keys are UTC and match the format _userActivity already uses', () => {
  assert.equal(dayKey('2026-07-17T23:59:59.999Z'), '2026-07-17');
  assert.equal(dayKey(NOW), TODAY);
  assert.equal(dayKey(new Date(NOW)), TODAY);
  assert.equal(dayKey(null), '');
});

test('shiftDay crosses months and years without drifting', () => {
  assert.equal(shiftDay('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDay('2026-01-01', -1), '2025-12-31');
  assert.equal(shiftDay('2026-12-31', 1), '2027-01-01');
});

test('shiftDay is DST-proof', () => {
  // Parsed as UTC midnight, so a local DST transition cannot move the boundary.
  // If this ever parsed as local time, one day a year would be 23 or 25 hours
  // and every user in that timezone would silently lose their streak.
  assert.equal(shiftDay('2026-03-29', -1), '2026-03-28'); // EU clocks go forward
  assert.equal(shiftDay('2026-10-25', -1), '2026-10-24'); // EU clocks go back
});

// ── The day set ───────────────────────────────────────────────────────────────

test('the day set is deduped, sorted, and junk-free', () => {
  assert.deepEqual(
    normalizeDays(['2026-07-17', '2026-07-15', '2026-07-17', 'garbage', '', null, 42]),
    ['2026-07-15', '2026-07-17']
  );
});

test('normalizeDays survives a non-array', () => {
  assert.deepEqual(normalizeDays(null), []);
  assert.deepEqual(normalizeDays('2026-07-17'), []);
});

test('recording the same day twice is idempotent', () => {
  const first = recordDay([], NOW);
  const second = recordDay(first, NOW);
  assert.deepEqual(first, [TODAY]);
  assert.deepEqual(second, [TODAY], 'a second visit the same day must not duplicate it');
});

test('the day set is capped and drops the OLDEST days', () => {
  // The cap must evict from the front. Evicting the newest would make a live
  // streak vanish while preserving days nobody cares about.
  const many = Array.from({ length: MAX_RETAINED_DAYS + 50 }, (_, i) => shiftDay('2024-01-01', i));
  const days = normalizeDays(many);
  assert.equal(days.length, MAX_RETAINED_DAYS);
  assert.equal(days[days.length - 1], many[many.length - 1], 'the most recent day must survive');
  assert.equal(days[0], many[50]);
});

// ── Streaks ───────────────────────────────────────────────────────────────────

test('a brand-new user has no streak AND has not started one', () => {
  // The distinction the whole feature rests on. `current: 0` alone would let the
  // UI tell someone who signed up ninety seconds ago that their streak is zero,
  // which reads as a failure they have not had time to have.
  const streak = computeStreak([], NOW);
  assert.equal(streak.current, 0);
  assert.equal(streak.started, false, 'absence is not a zero streak');
  assert.equal(streak.lastActiveDay, null);
});

test('consecutive days ending today count', () => {
  const streak = computeStreak([shiftDay(TODAY, -2), YESTERDAY, TODAY], NOW);
  assert.equal(streak.current, 3);
  assert.equal(streak.activeToday, true);
});

test('a streak ending YESTERDAY is still alive', () => {
  // The single most important rule here. Someone active 6 days straight who
  // opens the app at 09:00 on day 7 must see 6, not 0 - their streak is not
  // broken, they just have not arrived yet. Breaking it at midnight punishes
  // people for the hours before they return, at the moment they returned.
  const streak = computeStreak([shiftDay(TODAY, -2), YESTERDAY], NOW);
  assert.equal(streak.current, 2, 'yesterday keeps the streak alive');
  assert.equal(streak.activeToday, false);
});

test('a skipped day breaks the streak but not the history', () => {
  const streak = computeStreak([shiftDay(TODAY, -5), shiftDay(TODAY, -4), shiftDay(TODAY, -3)], NOW);
  assert.equal(streak.current, 0, 'two full days missed - the streak is over');
  assert.equal(streak.started, true, 'but they HAVE been here, which is not a new user');
  assert.equal(streak.lastActiveDay, shiftDay(TODAY, -3), 'the UI can still say when they were last seen');
});

test('longest streak is found even when it is not the current one', () => {
  const streak = computeStreak([
    '2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', // a 4-day run
    '2026-07-10',                                            // a lapse, then
    YESTERDAY, TODAY,                                        // the current 2-day run
  ], NOW);
  assert.equal(streak.current, 2);
  assert.equal(streak.longest, 4);
});

test('a single day is a 1-day streak, not a 0-day one', () => {
  const streak = computeStreak([TODAY], NOW);
  assert.equal(streak.current, 1);
  assert.equal(streak.longest, 1);
});

test('a streak spanning a month boundary is unbroken', () => {
  const streak = computeStreak(['2026-06-29', '2026-06-30', '2026-07-01'], Date.parse('2026-07-01T08:00:00.000Z'));
  assert.equal(streak.current, 3);
});

// ── Activity windows ──────────────────────────────────────────────────────────

test('activity windows count only days inside them, inclusive of today', () => {
  const windows = activityWindows([
    shiftDay(TODAY, -40), // outside 30
    shiftDay(TODAY, -20), // inside 30, outside 7
    shiftDay(TODAY, -6),  // inside 7 (boundary)
    shiftDay(TODAY, -3),
    TODAY,
  ], NOW);
  assert.equal(windows.activeDaysLast7, 3, 'the -6 boundary day is inside a 7-day window');
  assert.equal(windows.activeDaysLast30, 4);
  assert.equal(windows.totalActiveDays, 5);
});

test('an empty history reports zeros for windows, not nulls', () => {
  // Unlike a streak, "0 active days in the last 7" is a true and unambiguous
  // measurement for a user with no history - there is nothing to withhold.
  const windows = activityWindows([], NOW);
  assert.equal(windows.activeDaysLast7, 0);
  assert.equal(windows.totalActiveDays, 0);
  assert.equal(windows.truncated, false);
});

test('a capped history flags itself as truncated', () => {
  const many = Array.from({ length: MAX_RETAINED_DAYS }, (_, i) => shiftDay('2024-01-01', i));
  assert.equal(activityWindows(many, NOW).truncated, true, 'a capped count is not lifetime truth');
});

// ── Milestones ────────────────────────────────────────────────────────────────

test('milestones are due once the streak reaches them', () => {
  assert.deepEqual(dueStreakMilestones(1, {}), []);
  assert.deepEqual(dueStreakMilestones(3, {}), ['streak_3']);
  assert.deepEqual(dueStreakMilestones(7, {}), ['streak_3', 'streak_7']);
  assert.deepEqual(dueStreakMilestones(30, {}), ['streak_3', 'streak_7', 'streak_30']);
});

test('an already-awarded milestone is never due again', () => {
  assert.deepEqual(dueStreakMilestones(7, { streak_3: '2026-07-01T00:00:00.000Z' }), ['streak_7']);
  assert.deepEqual(
    dueStreakMilestones(7, { streak_3: 'x', streak_7: 'x' }),
    [],
    'the dedup guarantee: a milestone is announced once per account, ever'
  );
});

test('re-earning a streak after a lapse does not re-announce', () => {
  // 30 days, a lapse, 30 more. The second notification would be identical to the
  // first and carry no new information.
  assert.deepEqual(dueStreakMilestones(30, { streak_3: 'x', streak_7: 'x', streak_30: 'x' }), []);
});

// ── Continue-where-you-left-off context ───────────────────────────────────────

test('a valid context is accepted and stamped', () => {
  const context = sanitizeContext({ type: 'project', projectId: 'p1', name: 'Bonk', ticker: 'BONK' }, NOW);
  assert.equal(context.type, 'project');
  assert.equal(context.projectId, 'p1');
  assert.equal(context.name, 'Bonk');
  assert.equal(context.at, new Date(NOW).toISOString());
});

test('an unknown context type is dropped, not stored', () => {
  assert.equal(sanitizeContext({ type: 'admin-panel', projectId: 'p1' }, NOW), null);
  assert.equal(sanitizeContext({ type: 'project' }, NOW), null, 'a context with no project is not a context');
  assert.equal(sanitizeContext(null, NOW), null);
  assert.equal(sanitizeContext('project', NOW), null);
});

test('context strings are length-capped and unknown fields are dropped', () => {
  // Untrusted client input that gets persisted and later rendered.
  const context = sanitizeContext(
    { type: 'project', projectId: 'p1', name: 'x'.repeat(5000), evil: 'dropped', at: '1999-01-01' },
    NOW
  );
  assert.equal(context.name.length, 200);
  assert.equal(context.evil, undefined, 'only whitelisted fields reach storage');
  assert.equal(context.at, new Date(NOW).toISOString(), 'the client does not get to set the timestamp');
});

test('a stale context is not offered as a resume suggestion', () => {
  const fresh = { type: 'project', projectId: 'p1', at: new Date(NOW - 1000).toISOString() };
  const stale = { type: 'project', projectId: 'p1', at: new Date(NOW - CONTEXT_TTL_MS - 1000).toISOString() };
  assert.equal(isContextFresh(fresh, NOW), true);
  assert.equal(isContextFresh(stale, NOW), false, 'resuming a week-old session is noise, not help');
  assert.equal(isContextFresh(null, NOW), false);
  assert.equal(isContextFresh({ type: 'project', at: 'nonsense' }, NOW), false);
});

test('re-opening the same project is not a context change', () => {
  // The write-avoidance rule: this is what stops a blob write on every view.
  const previous = { type: 'project', projectId: 'p1', at: '2026-07-17T10:00:00.000Z' };
  assert.equal(contextChanged(previous, { type: 'project', projectId: 'p1', at: '2026-07-17T12:00:00.000Z' }), false,
    'a fresher timestamp alone is not worth a write');
  assert.equal(contextChanged(previous, { type: 'project', projectId: 'p2', at: '2026-07-17T12:00:00.000Z' }), true);
  assert.equal(contextChanged(null, { type: 'project', projectId: 'p2' }), true, 'the first context is always a change');
  assert.equal(contextChanged(previous, null), false, 'no new context must never clear a stored one');
});
