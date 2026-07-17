// POST /.netlify/functions/retention-sync
//
// The single endpoint the personalized dashboard and the notification bell both
// read. Records that the caller is here (and optionally what they were last
// doing), awards any newly-earned milestone, and returns the whole retention
// view in ONE response.
//
// WHY ONE ENDPOINT AND NOT THREE
//
// A dashboard that fetches streak, activity and notifications separately is
// three round trips and three blob reads for one screen, on the hot path, for
// every user, on every visit. This is two reads and - in the overwhelmingly
// common case - zero writes.
//
// WHY A POST THAT MOSTLY DOESN'T WRITE
//
// It is a POST because the first call of a user's day genuinely records
// something. Every call after that is effectively a read: recordVisit() compares
// before it writes and returns `changed: false` when today is already recorded
// and the context has not moved. So a user navigating around for an hour costs
// one write, not one per page.
//
// IDENTITY IS THE ACCOUNT, AND ONLY THE ACCOUNT
//
// The user id comes from the verified JWT and nowhere else - never the body,
// never a query param. There is no wallet path here at all: retention is not
// entitlement-gated, so there is nothing to resolve and no wallet-keyed data to
// reach. This endpoint therefore cannot be used to read another user's
// notifications, streak, or last-viewed token, because it takes no identifier it
// could be confused by.
import { verifyJwt, bearerToken } from './_authStore.mjs';
import { enforce, getClientIp } from './_rateLimit.mjs';
import {
  recordVisit,
  summarize,
  dueStreakMilestones,
  claimMilestones,
  jsonResponse,
} from './_retentionStore.mjs';
import {
  listNotifications,
  addNotifications,
  milestoneId,
  unreadCount,
} from './_notificationStore.mjs';

// One notification per earned streak milestone. Keys + params, never prose, so
// it renders in the reader's language like every other row in the bell.
function milestoneNotification(userId, id, now) {
  const days = Number(id.split('_')[1]) || 0;
  return {
    id: milestoneId(userId, id),
    type: 'milestone',
    severity: 'info',
    titleKey: 'notifications.milestone.title',
    bodyKey: 'notifications.milestone.streak',
    params: { days },
    link: 'watchlist',
    at: new Date(now).toISOString(),
  };
}

export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return jsonResponse(405, { message: 'Method not allowed' });

    const payload = verifyJwt(bearerToken(event));
    if (!payload?.sub) return jsonResponse(401, { message: 'Unauthorized' });

    // Defence in depth only: the client already sends this at most once per day
    // plus once per context change. A buggy or hostile loop must not be able to
    // hammer the blob store, but the ceiling sits well above any real session.
    const limit = await enforce('retention_sync_ip', getClientIp(event));
    if (!limit.allowed) {
      return jsonResponse(429, { message: 'Too many requests', retryAfterMs: limit.retryAfterMs });
    }

    let body = {};
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { message: 'Invalid JSON' });
    }

    const now = Date.now();
    const userId = payload.sub;

    // sanitizeContext (in _retentionEngine) whitelists and length-caps this -
    // anything unrecognised becomes null rather than reaching storage.
    const { record, dayAdded } = await recordVisit(userId, body.context, now);
    const summary = summarize(record, now);

    // Award milestones AFTER the visit is recorded, so today counts toward the
    // streak that earns them.
    //
    // Order matters: notify first, claim second. addNotifications is idempotent
    // on a stable id, so a claim that fails leads to a re-add next visit which
    // dedups to nothing - the user sees the milestone once. The reverse order
    // would lose the notification permanently if the add failed after the claim
    // succeeded.
    const due = dueStreakMilestones(summary.streak.current, record.milestones);
    if (due.length) {
      await addNotifications(userId, due.map((id) => milestoneNotification(userId, id, now)));
      await claimMilestones(userId, due, now);
    }

    const notifications = await listNotifications(userId);

    return jsonResponse(200, {
      ok: true,
      retention: summary,
      notifications,
      unread: unreadCount(notifications),
      // Server-authoritative: true only on the visit that actually recorded
      // today. The client emits its `user_return` analytics event off this, so
      // the event fires once per day per USER rather than once per device.
      newDay: dayAdded,
      // A first-ever day is not a "return". Lets the client tell them apart
      // without a second call.
      isFirstEverDay: dayAdded && summary.activity.totalActiveDays === 1,
    });
  } catch (error) {
    return jsonResponse(500, { message: `retention-sync crashed: ${error.message}` });
  }
}
