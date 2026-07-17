// POST /.netlify/functions/notifications-read
//
// Marks the CALLER's notifications read - specific ids via { ids: [...] }, or
// all of them when `ids` is omitted. Returns the updated list so the client
// renders from this response instead of issuing a follow-up GET.
//
// The user id comes from the verified JWT, so `ids` can only ever select within
// the caller's own bell: an id belonging to someone else simply matches nothing.
// There is no path here that takes a user identifier from the request.
//
// markRead() skips the write when nothing was actually unread, which matters
// because opening the bell is the most frequent action in this feature.
import { verifyJwt, bearerToken } from './_authStore.mjs';
import { markRead, listNotifications, unreadCount, jsonResponse } from './_notificationStore.mjs';

const MAX_IDS = 200;

export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return jsonResponse(405, { message: 'Method not allowed' });

    const payload = verifyJwt(bearerToken(event));
    if (!payload?.sub) return jsonResponse(401, { message: 'Unauthorized' });

    let body = {};
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { message: 'Invalid JSON' });
    }

    // Absent `ids` means "mark all read". An explicitly EMPTY array means "mark
    // these zero notifications" - a no-op that must NOT be promoted to mark-all,
    // which would wipe a user's unread state on a buggy call.
    //
    // markRead() treats an empty list as mark-all by design (that is what the
    // bell's "mark all read" button sends), so the distinction is resolved HERE,
    // where the caller's intent is still visible: an empty array returns the
    // list untouched rather than reaching the write path at all.
    if (Array.isArray(body.ids)) {
      const ids = body.ids.filter((id) => typeof id === 'string').slice(0, MAX_IDS);
      if (!ids.length) {
        const current = await listNotifications(payload.sub);
        return jsonResponse(200, { ok: true, notifications: current, unread: unreadCount(current) });
      }
      const marked = await markRead(payload.sub, ids);
      return jsonResponse(200, { ok: true, notifications: marked, unread: unreadCount(marked) });
    }

    const notifications = await markRead(payload.sub);
    return jsonResponse(200, { ok: true, notifications, unread: unreadCount(notifications) });
  } catch (error) {
    return jsonResponse(500, { message: `notifications-read crashed: ${error.message}` });
  }
}
