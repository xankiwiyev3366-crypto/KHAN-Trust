// Scheduled: the lifecycle email worker.
//
// Runs once a day at 09:00 UTC. Daily, not hourly: every stage boundary in the
// engine is measured in days, so an hourly tick would do the same work 24 times
// to send the same messages, and the MIN_GAP rule would reject 23 of them.
//
// It is a SCHEDULED function, so it has a hard 30-second budget and is not
// HTTP-routable. That shapes the design:
//
//   - it processes a bounded slice of users per run (MAX_USERS_PER_RUN) rather
//     than the whole list, and the slice rotates by how long each user has gone
//     without a lifecycle email, so nobody is permanently starved;
//   - it sends AT MOST ONE email per user per run, which is the engine's rule 1
//     and also what keeps the per-run cost predictable;
//   - it never throws. One user's bad record must not stop the other 49.
//
// A DELIBERATE OMISSION: there is no "blast everyone" path and no way to
// trigger this over HTTP. A scheduled-only worker cannot be fired twice by an
// accidental request, which for an unattended mail sender is worth more than
// the convenience of a manual trigger.
import { listRegisteredUsers } from './_authStore.mjs';
import { getRetention } from './_retentionStore.mjs';
import { getSubscription } from './_alertsStore.mjs';
import { readWalletLinks } from './_walletLinkStore.mjs';
import { resolveUserTier, TIER } from './_watchTiers.mjs';
import { sendEmail, isEmailConfigured } from './_email.mjs';
import { listNotificationsStrict } from './_notificationStore.mjs';
import { nextStageFor, buildContext, REASSURANCE_LOOKBACK_MS } from './_lifecycleEngine.mjs';
import { getLifecycle, recordSent, recordSkipped, sentLogFor } from './_lifecycleStore.mjs';
import { buildLifecycleEmail, listUnsubscribeHeaders } from './_lifecycleTemplates.mjs';
import { unsubscribeTokenFor } from './_lifecycleToken.mjs';
import { recordLifecycleEmailSent } from './_growthRecord.mjs';

export const config = { schedule: '0 9 * * *' };

// Bounded so a growing user base cannot silently push the run past 30s. At one
// email per user per day this is also the daily send ceiling, which is a useful
// property to have by construction rather than by hope.
const MAX_USERS_PER_RUN = 50;
const USER_SCAN_LIMIT = 500;

// Users least recently touched by this system come first, so the slice rotates
// and a user near the end of the list is not permanently starved by a run that
// always processes the same first 50.
function byStalest(a, b) {
  return (a.lastTouched || 0) - (b.lastTouched || 0);
}

// How many risk alerts this user was actually sent in the reassurance window.
//
// Returns null — NOT 0 — when the history cannot be read, because the one email
// that consumes this ("nothing crossed a risk threshold") may only be sent on a
// confirmed-quiet period. An unreadable store means unknown, and the engine
// treats unknown as "do not claim it".
//
// Only called for users who watch something, since that is the only way the
// reassurance stage can be reached at all; it keeps this to one extra read for
// the users it can matter for, and none for the rest.
async function countRecentRiskAlerts(userId, now) {
  try {
    const items = await listNotificationsStrict(userId);
    if (!Array.isArray(items)) return null;
    const since = now - REASSURANCE_LOOKBACK_MS;
    return items.filter((item) => {
      if (item?.type !== 'risk_alert') return false;
      const at = Date.parse(item.at || '');
      return Number.isFinite(at) && at >= since;
    }).length;
  } catch {
    return null;
  }
}

export async function handler() {
  // Fail QUIET, not loud: with no mail provider configured this is a no-op, the
  // same contract every other email path in this codebase follows.
  if (!isEmailConfigured()) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'email_not_configured' }) };
  }

  const users = await listRegisteredUsers(USER_SCAN_LIMIT);
  if (!users.length) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, considered: 0, sent: 0 }) };
  }

  let walletLinks = {};
  try {
    walletLinks = (await readWalletLinks()) || {};
  } catch {
    walletLinks = {};
  }

  // First pass: read each user's lifecycle record so the slice can be ordered
  // by staleness. Reads are cheap and never throw (see _lifecycleStore).
  const candidates = [];
  for (const user of users) {
    if (!user?.id || !user?.email) continue;
    if (user.emailOptOut) continue;
    const record = await getLifecycle(user.id);
    candidates.push({ user, record, lastTouched: record.updatedAt || 0 });
  }

  const slice = candidates.sort(byStalest).slice(0, MAX_USERS_PER_RUN);

  const now = Date.now();
  let sent = 0;
  let skipped = 0;
  const failures = [];

  for (const { user, record } of slice) {
    try {
      const [retention, subscription, tier] = await Promise.all([
        getRetention(user.id).catch(() => null),
        getSubscription(user.id).catch(() => null),
        resolveUserTier(user.id).catch(() => TIER.FREE),
      ]);

      const watchedCount = Array.isArray(subscription?.tokens) ? subscription.tokens.length : 0;

      // Only users who watch something can reach the reassurance stage, so the
      // extra read is only paid for them.
      const recentRiskAlerts = watchedCount > 0 ? await countRecentRiskAlerts(user.id, now) : null;

      const ctx = buildContext({
        user,
        retention,
        sentLog: sentLogFor(record),
        watchedCount,
        hasPremium: tier === TIER.PREMIUM,
        hasWallet: Boolean(walletLinks[user.id]),
        recentRiskAlerts,
      });

      const decision = nextStageFor(ctx, now);

      // Record closed windows once so they are not re-derived every night.
      if (decision.expiredStages?.length) {
        await recordSkipped(user.id, decision.expiredStages, now);
        skipped += decision.expiredStages.length;
      }

      if (!decision.stage) continue;

      const unsubToken = unsubscribeTokenFor(user);
      const email = buildLifecycleEmail(decision.stage.id, ctx, unsubToken);
      if (!email) continue;

      const result = await sendEmail({
        to: ctx.email,
        subject: email.subject,
        html: email.html,
        // RFC 8058. Bulk mail without this is filtered on reputation alone.
        headers: listUnsubscribeHeaders(unsubToken),
      });
      // Recorded ONLY on provider acceptance. Recording before the send would
      // let one outage silently consume a user's single shot at that stage.
      if (result.ok) {
        await recordSent(user.id, decision.stage.id, now);
        // Fail-soft by contract: losing an analytics row must never cost the
        // user their write-once record of having been emailed, which is the
        // thing that stops a duplicate send.
        await recordLifecycleEmailSent({ userId: user.id, stage: decision.stage.id });
        sent += 1;
      } else {
        failures.push({ userId: user.id, stage: decision.stage.id, reason: result.reason });
      }
    } catch (error) {
      // One bad record must never stop the rest of the slice.
      failures.push({ userId: user.id, reason: 'exception', message: error.message });
    }
  }

  if (failures.length) {
    console.error('[lifecycle-send-cron] some sends did not complete', { count: failures.length, failures: failures.slice(0, 5) });
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, considered: slice.length, sent, skipped, failed: failures.length }),
  };
}
