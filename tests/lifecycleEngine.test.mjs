// The lifecycle engine decides who gets emailed and when. Its failure modes are
// all reputational — sending four nudges at once, sending "welcome to day one"
// to a six-month-old account, or emailing someone who opted out — so the rules
// are pinned here rather than trusted to review.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextStageFor,
  buildContext,
  isExpired,
  getStage,
  mostRecentSend,
  MIN_GAP_MS,
  DAY_MS,
} from '../netlify/functions/_lifecycleEngine.mjs';

const NOW = Date.parse('2026-07-28T12:00:00Z');
const ago = (ms) => NOW - ms;

function ctx(overrides = {}) {
  return {
    userId: 'u1',
    email: 'a@b.com',
    name: 'A',
    createdAt: ago(0),
    emailVerified: true,
    unsubscribed: false,
    sentLog: {},
    watchedCount: 0,
    activeDays: 1,
    hasPremium: false,
    hasWallet: false,
    ...overrides,
  };
}

test('a brand-new account is due the welcome email', () => {
  const out = nextStageFor(ctx(), NOW);
  assert.equal(out.stage?.id, 'welcome');
  assert.equal(out.reason, 'due');
});

test('unsubscribe wins over every stage, checked before any of them', () => {
  const out = nextStageFor(ctx({ unsubscribed: true, createdAt: ago(7 * DAY_MS) }), NOW);
  assert.equal(out.stage, null);
  assert.equal(out.reason, 'unsubscribed');
});

test('a user with no email address is never selected', () => {
  assert.equal(nextStageFor(ctx({ email: '' }), NOW).stage, null);
});

// RULE 1 + 2. The failure this prevents: an account that predates the feature
// becoming instantly due for welcome, day1, day3, day5 and day7 at once.
test('only one email is ever due at a time, and the gap holds the sequence apart', () => {
  const old = ctx({ createdAt: ago(8 * DAY_MS), watchedCount: 0 });
  const first = nextStageFor(old, NOW);
  assert.ok(first.stage, 'something should be due');

  // Immediately after sending it, nothing else may go out.
  const afterSend = nextStageFor({ ...old, sentLog: { [first.stage.id]: NOW } }, NOW);
  assert.equal(afterSend.stage, null);
  assert.equal(afterSend.reason, 'min_gap');

  // Still nothing an hour later.
  const anHourLater = nextStageFor({ ...old, sentLog: { [first.stage.id]: NOW } }, NOW + 60 * 60 * 1000);
  assert.equal(anHourLater.reason, 'min_gap');

  // The next one becomes available only after the gap.
  const afterGap = nextStageFor({ ...old, sentLog: { [first.stage.id]: NOW } }, NOW + MIN_GAP_MS + 1000);
  assert.notEqual(afterGap.reason, 'min_gap');
});

// RULE 3. "Welcome to your first day" must never reach a months-old account.
test('a stage whose window has passed is expired, not sent late', () => {
  const ancient = ctx({ createdAt: ago(200 * DAY_MS), watchedCount: 0 });
  const out = nextStageFor(ancient, NOW);
  assert.equal(out.stage, null);
  assert.equal(out.reason, 'expired');
  assert.ok(out.expiredStages.includes('welcome'));
  assert.ok(out.expiredStages.includes('day1'), 'every passed one-shot stage is reported, not just the first');
});

// The regression this prevents: an expired early stage aborting the search, so
// an account older than the 3-day welcome window could never reach ANY later
// stage — it would be silently excluded from the sequence forever.
test('an expired early stage does not block a later one that is still in window', () => {
  // 8 days old, never emailed. welcome (window closes at day 3) and day1
  // (closes at day 5) have both passed; day3 (closes at day 9) has not.
  const out = nextStageFor(ctx({ createdAt: ago(8 * DAY_MS), watchedCount: 0 }), NOW);
  assert.equal(out.stage?.id, 'day3', 'the first still-open stage should be selected');
  assert.deepEqual(out.expiredStages, ['welcome', 'day1'],
    'the passed stages are still reported so they can be marked skipped once');

  // And much later, when every one-shot stage has closed, nothing is sent at
  // all rather than something arriving wildly out of context.
  const ancient = nextStageFor(ctx({ createdAt: ago(300 * DAY_MS), watchedCount: 0 }), NOW);
  assert.equal(ancient.stage, null);
});

test('isExpired: one-shot stages expire, recurring ones never do', () => {
  assert.equal(isExpired(getStage('welcome'), 200 * DAY_MS), true);
  assert.equal(isExpired(getStage('welcome'), 1 * DAY_MS), false);
  assert.equal(isExpired(getStage('nothingChanged'), 5000 * DAY_MS), false);
});

// RULE 4. Relevance is evaluated against current state, at send time.
test('the "watch your first token" nudge is skipped once they have watched one', () => {
  const base = { createdAt: ago(1 * DAY_MS), sentLog: { welcome: ago(2 * DAY_MS) } };
  assert.equal(nextStageFor(ctx({ ...base, watchedCount: 0 }), NOW).stage?.id, 'day1');
  assert.notEqual(nextStageFor(ctx({ ...base, watchedCount: 3 }), NOW).stage?.id, 'day1');
});

test('the wallet-scan nudge is skipped for someone who already connected a wallet', () => {
  const base = { createdAt: ago(5 * DAY_MS), watchedCount: 2, sentLog: { welcome: ago(6 * DAY_MS), day3: ago(2 * DAY_MS) } };
  assert.equal(nextStageFor(ctx({ ...base, hasWallet: false }), NOW).stage?.id, 'day5');
  assert.notEqual(nextStageFor(ctx({ ...base, hasWallet: true }), NOW).stage?.id, 'day5');
});

test('premium users are never sent an upgrade pitch', () => {
  const paid = ctx({ createdAt: ago(20 * DAY_MS), hasPremium: true, watchedCount: 5, sentLog: { welcome: ago(21 * DAY_MS) } });
  const out = nextStageFor(paid, NOW);
  assert.notEqual(out.stage?.id, 'premiumOffer');
  assert.notEqual(out.stage?.id, 'day3');
  assert.notEqual(out.stage?.id, 'day7');
});

test('the upgrade pitch requires demonstrated value first', () => {
  const sent = { welcome: ago(30 * DAY_MS), day1: ago(29 * DAY_MS), day3: ago(28 * DAY_MS), day5: ago(27 * DAY_MS), day7: ago(26 * DAY_MS) };
  // Registered, never used it: no pitch.
  const idle = ctx({ createdAt: ago(20 * DAY_MS), watchedCount: 0, activeDays: 1, sentLog: sent });
  assert.notEqual(nextStageFor(idle, NOW).stage?.id, 'premiumOffer');
  // Actually uses it: pitch is fair.
  const engaged = ctx({ createdAt: ago(20 * DAY_MS), watchedCount: 2, activeDays: 4, sentLog: sent });
  assert.equal(nextStageFor(engaged, NOW).stage?.id, 'premiumOffer');
});

// RULE 5.
test('one-shot stages are write-once — a replayed run cannot double-send', () => {
  const c = ctx({ createdAt: ago(1 * DAY_MS), sentLog: { welcome: ago(25 * 60 * 60 * 1000), day1: ago(21 * 60 * 60 * 1000) } });
  const out = nextStageFor(c, NOW);
  assert.notEqual(out.stage?.id, 'welcome');
  assert.notEqual(out.stage?.id, 'day1');
});

test('the reassurance email recurs, but only for someone actually being monitored', () => {
  const sent = { welcome: ago(30 * DAY_MS), day1: ago(29 * DAY_MS), day3: ago(28 * DAY_MS), day5: ago(27 * DAY_MS), day7: ago(26 * DAY_MS), premiumOffer: ago(25 * DAY_MS) };
  const watching = ctx({ createdAt: ago(40 * DAY_MS), watchedCount: 3, sentLog: sent });
  assert.equal(nextStageFor(watching, NOW).stage?.id, 'nothingChanged');

  // Just sent: not due again yet.
  const justSent = ctx({ createdAt: ago(40 * DAY_MS), watchedCount: 3, sentLog: { ...sent, nothingChanged: ago(2 * DAY_MS) } });
  assert.equal(nextStageFor(justSent, NOW).stage, null);

  // A week later: due again.
  const weekLater = ctx({ createdAt: ago(40 * DAY_MS), watchedCount: 3, sentLog: { ...sent, nothingChanged: ago(8 * DAY_MS) } });
  assert.equal(nextStageFor(weekLater, NOW).stage?.id, 'nothingChanged');

  // Watching nothing: there is nothing to reassure them about.
  const notWatching = ctx({ createdAt: ago(40 * DAY_MS), watchedCount: 0, sentLog: sent });
  assert.notEqual(nextStageFor(notWatching, NOW).stage?.id, 'nothingChanged');
});

test('mostRecentSend ignores malformed entries rather than throwing', () => {
  assert.equal(mostRecentSend(null), null);
  assert.equal(mostRecentSend({}), null);
  assert.equal(mostRecentSend({ a: 'nope', b: 0, c: null }), null);
  assert.equal(mostRecentSend({ a: 5, b: 9, c: 'x' }), 9);
});

test('buildContext tolerates missing records without throwing', () => {
  assert.doesNotThrow(() => buildContext({}));
  const c = buildContext({ user: { id: 'u', email: 'e@x.com', createdAt: 'not a date' } });
  assert.equal(nextStageFor(c, NOW).reason, 'no_created_at');
});

test('an opted-out flag on the user record is honoured through buildContext', () => {
  const c = buildContext({
    user: { id: 'u', email: 'e@x.com', createdAt: new Date(NOW).toISOString(), emailOptOut: true },
  });
  assert.equal(nextStageFor(c, NOW).reason, 'unsubscribed');
});
