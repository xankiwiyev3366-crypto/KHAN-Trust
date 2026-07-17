// One shared retention state for the whole app.
//
// A context rather than a hook per consumer, because the notification bell (in
// the Header) and the personalized dashboard (on HomePage) need the SAME data.
// Two independent hooks would mean two syncs per page load and two sources of
// truth for the unread count - a bell showing 3 next to a panel listing 2.
//
// WHEN IT SYNCS
//
//   - once when a user signs in / a session restores (we need the data to render)
//   - on navigation, via a call that no-ops unless the UTC day has rolled over
//   - when the user opens a different project (the resume context moved)
//
// The day-rollover case is not hypothetical: a tab left open across midnight
// would otherwise never record day 2, and the user's streak would break while
// they were actively using the app. syncRetention() makes that check locally, so
// normal navigation costs zero requests.
//
// FAILURE IS INVISIBLE
//
// `status: 'error'` renders as "no retention data", never as an error surface.
// This layer remembers things; nothing depends on it. A user must always be able
// to scan a token with the retention store on fire.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './auth/AuthContext.jsx';
import { syncRetention, markNotificationsRead } from './retention.js';
import { trackEvent } from './platformAnalytics.js';

const RetentionContext = createContext(null);

const EMPTY = { status: 'idle', retention: null, notifications: [], unread: 0 };

export function RetentionProvider({ children }) {
  const { user } = useAuth();
  const [state, setState] = useState(EMPTY);

  // Guards setState after an await - a user signing out mid-request must not
  // have the previous account's streak land in the new (empty) view.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Identifies which user a response belongs to, so a slow request for user A
  // cannot populate the bell after a switch to user B.
  const userRef = useRef(null);
  useEffect(() => { userRef.current = user?.id || null; }, [user?.id]);

  const apply = useCallback((result, forUserId) => {
    if (!mounted.current || userRef.current !== forUserId) return false;
    if (!result?.ok) return false;
    setState({
      status: 'ready',
      retention: result.retention,
      notifications: result.notifications || [],
      unread: result.unread || 0,
    });
    return true;
  }, []);

  // Emits the retention analytics events off the SERVER's verdict, never a local
  // guess - see `newDay` in retention-sync.mjs. A first-ever day is a signup,
  // not a return, and conflating them would make D1 retention look perfect.
  const emitReturnEvents = useCallback((result) => {
    if (!result?.newDay) return;
    if (result.isFirstEverDay) return;
    const streak = result.retention?.streak || {};
    trackEvent('user_return', {
      streakDays: streak.current || 0,
      longestStreak: streak.longest || 0,
      activeDaysLast7: result.retention?.activity?.activeDaysLast7 || 0,
      activeDaysLast30: result.retention?.activity?.activeDaysLast30 || 0,
    });
  }, []);

  const run = useCallback(async ({ context = null, force = false } = {}) => {
    const userId = user?.id;
    if (!userId) return null;
    const result = await syncRetention({ userId, context, force });
    // null means "not sent" (already synced today, or signed out) OR "failed".
    // Both are non-events for the UI: keep whatever is already on screen.
    if (!result) return null;
    if (apply(result, userId)) emitReturnEvents(result);
    return result;
  }, [user?.id, apply, emitReturnEvents]);

  // Initial load / session restore. Forced, because the dashboard and bell need
  // the data even when today's visit was already recorded from another device.
  useEffect(() => {
    if (!user?.id) {
      setState(EMPTY);
      return;
    }
    setState((s) => ({ ...s, status: 'loading' }));
    let cancelled = false;
    const userId = user.id;
    syncRetention({ userId, force: true }).then((result) => {
      if (cancelled || !mounted.current || userRef.current !== userId) return;
      if (result?.ok) {
        apply(result, userId);
        emitReturnEvents(result);
      } else {
        setState({ ...EMPTY, status: 'error' });
      }
    });
    return () => { cancelled = true; };
  }, [user?.id, apply, emitReturnEvents]);

  // Cheap: no-ops unless the UTC day rolled over while the tab stayed open.
  const touch = useCallback(() => { run(); }, [run]);

  // Called when the user opens a project. The client skips the request when the
  // project has not changed, and the server skips the write for the same reason.
  const lastContextId = useRef(null);
  const recordContext = useCallback((context) => {
    if (!context?.projectId || context.projectId === lastContextId.current) return;
    lastContextId.current = context.projectId;
    run({ context });
  }, [run]);

  const markRead = useCallback(async (ids) => {
    // Optimistic: the bell responds instantly and the server confirms. A failed
    // mark-read reverts on the next sync rather than blocking the interaction.
    setState((s) => {
      const target = ids && ids.length ? new Set(ids) : null;
      const notifications = s.notifications.map((n) =>
        n.read || (target && !target.has(n.id)) ? n : { ...n, read: true }
      );
      return { ...s, notifications, unread: notifications.filter((n) => !n.read).length };
    });
    trackEvent('notification_read', { count: ids ? ids.length : 'all' });
    const result = await markNotificationsRead(ids);
    if (!mounted.current || !result?.ok) return;
    setState((s) => ({ ...s, notifications: result.notifications || [], unread: result.unread || 0 }));
  }, []);

  return (
    <RetentionContext.Provider value={{ ...state, touch, recordContext, markRead, refresh: () => run({ force: true }) }}>
      {children}
    </RetentionContext.Provider>
  );
}

// Returns a null-safe empty view when used outside the provider, so a component
// can read retention without every call site having to guard. Retention is
// additive - nothing should crash because it is absent.
export function useRetention() {
  return useContext(RetentionContext) || { ...EMPTY, touch: () => {}, recordContext: () => {}, markRead: async () => {}, refresh: async () => {} };
}
