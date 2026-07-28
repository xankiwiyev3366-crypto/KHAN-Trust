// WHICH lifecycle email, if any, is due for one user right now.
//
// Pure and side-effect free: it takes the user, their retention record, and the
// log of what has already been sent, and returns at most ONE stage. Every
// decision this system makes lives here so it can be tested without a mail
// provider, a clock, or a blob store.
//
// WHY THIS EXISTS
//
// The only email KHAN Trust has ever sent a new account is "verify your email
// address". There is no welcome, no day-1, no day-7, no re-engagement. For a
// product with no mobile app and no push channel, outbound email is not a
// growth tactic, it is the ENTIRE retention system — a user who does not come
// back on their own is currently never contacted again.
//
// THE FIVE RULES, AND WHY EACH IS LOAD-BEARING
//
// 1. ONE EMAIL PER USER PER RUN. Never a backlog flush. A user who has been
//    away must not open their inbox to four staged nudges at once; that is how
//    a lifecycle system gets marked as spam in a single send.
//
// 2. A MINIMUM GAP BETWEEN ANY TWO. Without it, an account created before this
//    feature existed is instantly "due" for day1, day3, day5 AND day7, and
//    rule 1 would only spread them across four consecutive cron ticks —
//    minutes apart. The gap is what makes the sequence a sequence.
//
// 3. STAGES EXPIRE. A user who registered 200 days ago must never receive
//    "welcome to your first day". Each stage has a window, and a stage whose
//    window has passed is marked skipped rather than sent late — a nudge that
//    arrives months out of context reads as broken software, not as care.
//
// 4. RELEVANCE IS CHECKED AT SEND TIME, NOT AT SCHEDULE TIME. "You have not
//    watched a token yet" must not go to someone who watched one an hour ago.
//    Each stage carries a predicate over the user's CURRENT state.
//
// 5. WRITE-ONCE PER STAGE. Dedup is keyed on (userId, stage) and is checked
//    before every send, so a retried cron, an overlapping run, or a replayed
//    invocation cannot double-send. Same discipline as the referral store's
//    write-once attribution.
//
// UNSUBSCRIBE IS ABSOLUTE. It is checked first, before any stage logic, and it
// is never overridden by a stage's importance. Transactional mail (verification,
// password reset, and a risk alert the user explicitly asked for by watching a
// token) does not route through here at all.

const DAY_MS = 24 * 60 * 60 * 1000;

// Minimum gap between any two lifecycle emails to one person (rule 2).
export const MIN_GAP_MS = 20 * 60 * 60 * 1000; // 20h — comfortably under a day

export const STAGES = [
  {
    id: 'welcome',
    // Sent on the first run after registration. `minAgeMs` 0 means "as soon as
    // we see them"; the window keeps it from reaching a long-dormant account
    // when this feature is first switched on.
    minAgeMs: 0,
    windowMs: 3 * DAY_MS,
    // Always relevant — it is the first thing anyone should receive.
    isRelevant: () => true,
  },
  {
    id: 'day1',
    minAgeMs: 1 * DAY_MS,
    windowMs: 4 * DAY_MS,
    // Only for someone who has not yet watched anything: its whole job is to
    // get the first token onto a watchlist, which is the retention hook.
    isRelevant: (ctx) => ctx.watchedCount === 0,
  },
  {
    id: 'day3',
    minAgeMs: 3 * DAY_MS,
    windowMs: 6 * DAY_MS,
    // "Here is what we caught this week." Goes to everyone still on free,
    // because its job is to prove the engine works, not to sell.
    isRelevant: (ctx) => !ctx.hasPremium,
  },
  {
    id: 'day5',
    minAgeMs: 5 * DAY_MS,
    windowMs: 8 * DAY_MS,
    // The wallet/approval scan. Highest-value free action in the product, and
    // pointless to pitch to someone who has already connected a wallet.
    isRelevant: (ctx) => !ctx.hasWallet,
  },
  {
    id: 'day7',
    minAgeMs: 7 * DAY_MS,
    windowMs: 14 * DAY_MS,
    isRelevant: (ctx) => !ctx.hasPremium,
  },
  {
    id: 'premiumOffer',
    minAgeMs: 14 * DAY_MS,
    windowMs: 30 * DAY_MS,
    // Only to someone who has demonstrably got value already: they watch
    // something, or they have come back on more than one day. Pitching a paid
    // plan to an account that never used the free product is what makes an
    // upgrade prompt feel like spam rather than an offer.
    isRelevant: (ctx) => !ctx.hasPremium && (ctx.watchedCount > 0 || ctx.activeDays > 1),
  },
  {
    id: 'nothingChanged',
    // The reassurance send. Deliberately LAST in priority and recurring rather
    // than one-shot: "we checked your tokens and nothing changed" is the email
    // that teaches what the product is actually for, and it can only be sent
    // to someone who is genuinely being monitored.
    minAgeMs: 7 * DAY_MS,
    windowMs: Infinity,
    repeatMs: 7 * DAY_MS,
    // ...and only when it is TRUE. This email asserts a fact about the period
    // it covers ("nothing crossed a risk threshold"), so it must not follow a
    // risk alert for the same window — a user who was warned on Tuesday and
    // told on Friday that nothing happened learns that one of the two emails
    // is lying, and has no way to tell which. That single contradiction
    // discredits the alert channel, which is the whole product.
    //
    // `recentRiskAlerts` is null when the alert history could not be read.
    // Null is NOT zero: an unreadable history means we do not know the period
    // was quiet, and the only honest response to not knowing is to say
    // nothing. Same absence-is-not-zero rule the growth warehouse follows.
    isRelevant: (ctx) => ctx.watchedCount > 0 && ctx.recentRiskAlerts === 0,
  },
];

const STAGE_BY_ID = new Map(STAGES.map((stage) => [stage.id, stage]));

export function getStage(id) {
  return STAGE_BY_ID.get(id) || null;
}

// The per-user send log: { [stageId]: timestampMs }. Kept as a plain map so a
// new stage added later simply has no entry and is treated as never sent.
function lastSentAt(sentLog, stageId) {
  const value = Number(sentLog?.[stageId]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function mostRecentSend(sentLog) {
  const times = Object.values(sentLog || {})
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  return times.length ? Math.max(...times) : null;
}

// Has this stage's opportunity passed? A one-shot stage is expired once the
// account is older than minAge + window. Recurring stages never expire.
export function isExpired(stage, ageMs) {
  if (!Number.isFinite(stage.windowMs)) return false;
  return ageMs > stage.minAgeMs + stage.windowMs;
}

// THE decision. Returns { stage, reason } — `stage` is null when nothing should
// be sent, and `reason` always explains why, so the cron can log a skip that is
// actually diagnosable instead of silently doing nothing.
export function nextStageFor(ctx, now = Date.now()) {
  if (!ctx || !ctx.userId) return { stage: null, reason: 'no_user' };
  if (!ctx.email) return { stage: null, reason: 'no_email' };

  // Rule: unsubscribe wins over everything, checked before any stage logic.
  if (ctx.unsubscribed) return { stage: null, reason: 'unsubscribed' };

  if (!Number.isFinite(ctx.createdAt)) return { stage: null, reason: 'no_created_at' };
  const ageMs = now - ctx.createdAt;
  if (ageMs < 0) return { stage: null, reason: 'created_in_future' };

  // Rule 2: minimum gap since the last lifecycle email of any kind.
  const previous = mostRecentSend(ctx.sentLog);
  if (previous !== null && now - previous < MIN_GAP_MS) {
    return { stage: null, reason: 'min_gap' };
  }

  // Stages whose moment has passed. Collected rather than returned early: an
  // expired stage must NOT abort the search, or an account older than the
  // welcome window (3 days) would be permanently blocked from every later
  // stage too — the eight-day-old signup would never receive day7 because
  // welcome expired first. They are reported so the caller can mark them
  // skipped once and stop reconsidering them on every future run.
  const expiredStages = [];

  for (const stage of STAGES) {
    if (ageMs < stage.minAgeMs) continue;

    const sentAt = lastSentAt(ctx.sentLog, stage.id);
    if (sentAt !== null) {
      // Rule 5: one-shot stages are write-once.
      if (!Number.isFinite(stage.repeatMs)) continue;
      if (now - sentAt < stage.repeatMs) continue;
    } else if (isExpired(stage, ageMs)) {
      expiredStages.push(stage.id);
      continue;
    }

    // Rule 4: relevance against CURRENT state, at send time.
    if (!stage.isRelevant(ctx)) continue;

    return { stage, reason: 'due', expiredStages };
  }

  if (expiredStages.length) {
    return { stage: null, reason: 'expired', expiredStages, expiredStage: expiredStages[0] };
  }
  return { stage: null, reason: 'nothing_due', expiredStages };
}

// Builds the decision context from the raw records the cron already has. Kept
// here (rather than in the cron) so the shape the engine reasons about is
// defined next to the rules that read it.
export function buildContext({ user, retention, sentLog, watchedCount, hasPremium, hasWallet, recentRiskAlerts }) {
  const createdAt = Date.parse(user?.createdAt || '');
  const days = Array.isArray(retention?.days) ? retention.days : [];
  return {
    userId: user?.id || '',
    email: user?.email || '',
    name: user?.name || '',
    createdAt: Number.isFinite(createdAt) ? createdAt : NaN,
    emailVerified: Boolean(user?.emailVerified),
    unsubscribed: Boolean(user?.emailOptOut),
    sentLog: sentLog || {},
    watchedCount: Number(watchedCount || 0),
    activeDays: days.length,
    lastSeen: retention?.lastSeen || null,
    hasPremium: Boolean(hasPremium),
    hasWallet: Boolean(hasWallet),
    // Deliberately NOT coerced to 0. Only a real count of zero may license the
    // "nothing changed" claim; unknown stays null and suppresses it.
    recentRiskAlerts: Number.isFinite(recentRiskAlerts) ? Number(recentRiskAlerts) : null,
  };
}

// How far back "nothing changed" looks when checking that it is true. Derived
// from the stage's own repeat interval so the claim always covers exactly the
// period since the last such email, and cannot drift apart from it.
export const REASSURANCE_LOOKBACK_MS = STAGE_BY_ID.get('nothingChanged').repeatMs;

export { DAY_MS };
