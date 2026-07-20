// Continuous Watch tiers — how often we observe, how often we tell, and how
// many tokens each plan may watch.
//
// WHAT IS ACTUALLY BEING SOLD
//
// Not access to a feature: access to FREQUENCY. Premium buys observation every
// 30 minutes instead of every 12 hours. For a liquidity drain that is the
// difference between a warning and a post-mortem, and it is an honest thing to
// charge for because it is a real recurring cost we incur on the user's behalf
// rather than a capability withheld out of spite.
//
// Free is deliberately NOT zero. A free tier with no monitoring would leave the
// Watchtower Report with nothing to report, which would break the one surface
// that demonstrates the value before asking anyone to pay for it. Free users
// must experience the vigilance; Premium users get it fast enough to act on.
//
// TWO CADENCES, AND THEY ARE NOT THE SAME THING
//
//   OBSERVATION is a property of the TOKEN. A token is observed on the fastest
//   cadence of anyone watching it (see bestTierForToken). This preserves the
//   dedup property that makes the whole system affordable — ten users watching
//   BONK is one re-scan, not ten — and it means we never deliberately hold back
//   data we already have.
//
//   NOTIFICATION is a property of the USER. Each user is told at their own
//   plan's cadence. This is what stops a free user piggybacking on a token that
//   a Premium user happens to also watch: the snapshot underneath may be fresh,
//   but being TOLD promptly is the thing that was paid for.
//
// The alternative — artificially staling an observation we already made, purely
// to make the free tier feel worse — is the kind of decision that reads as
// contempt the moment a user works it out. We do not do it.
//
// ACCURACY IS NOT A TIER. Every tier gets the same complete-fetch-only rule
// (see _rescanEngine.mjs). A faster cadence buys more CHANCES to observe, never
// a lower bar for what counts as an observation. A Premium user must never
// receive a snapshot scored on thinner data than a free user's.
import { getAccountEntitlement, isPremiumPlan } from './_entitlementsStore.mjs';
import { getGrant, isGrantActive } from './_premiumStore.mjs';

export const TIER = { FREE: 'free', PREMIUM: 'premium' };

// How often a token watched by this tier is OBSERVED.
export const OBSERVE_INTERVAL_MS = {
  [TIER.PREMIUM]: 30 * 60 * 1000,        // 30 minutes
  [TIER.FREE]: 12 * 60 * 60 * 1000,      // 12 hours
};

// How often a user of this tier is NOTIFIED. Matched to the observation
// cadence: telling someone more often than we look would be noise, and telling
// them less often than we look would waste the observation.
export const NOTIFY_INTERVAL_MS = {
  [TIER.PREMIUM]: 30 * 60 * 1000,
  [TIER.FREE]: 12 * 60 * 60 * 1000,
};

// How many tokens a plan may watch. The free cap is what bounds the free tier's
// contribution to provider load; without it a handful of users could make the
// worker's cost unbounded while paying nothing.
export const MAX_WATCHED_TOKENS = {
  [TIER.PREMIUM]: 100,
  [TIER.FREE]: 5,
};

// Is this account Premium? The worker has no HTTP request and therefore no JWT,
// so it cannot use resolvePremiumAccess() — this is the userId-only equivalent,
// composed from the same two account-side stores that resolver checks.
//
// A KNOWN GAP, STATED PLAINLY: the third source that resolver checks is a
// LEGACY entitlement keyed by WALLET ADDRESS. There is no way to reach it from
// a userId — _walletLinkStore is explicitly telemetry that "cannot grant, gate,
// or revoke anything". So a legacy wallet-paid user who has never run
// premium-claim-wallet resolves to FREE here, and would be monitored on the
// slow cadence while paying.
//
// Rather than guess, the worker COUNTS these (see watch-rescan-background) so
// the population is visible before it becomes a support ticket. The real fix is
// claiming, which already exists; if the count is ever non-zero this should
// become a prompt to claim rather than a silent downgrade.
//
// FAILS TO FREE, DELIBERATELY. An unreadable entitlement store must not hand
// out Premium cadence to everyone — that would make a storage outage into an
// unbounded provider bill. Free is the safe direction to fail: the user still
// gets monitored, just slower, and the next run recovers.
export async function resolveUserTier(userId) {
  if (!userId) return TIER.FREE;

  try {
    const entitlement = await getAccountEntitlement(userId);
    if (entitlement && isPremiumPlan(entitlement.plan)) return TIER.PREMIUM;
  } catch {
    // fall through to the grant check; one unreadable store is not a verdict
  }

  try {
    const grant = await getGrant(userId);
    if (isGrantActive(grant)) return TIER.PREMIUM;
  } catch {
    // fall through
  }

  return TIER.FREE;
}

// Resolves every subscriber's tier in one pass, returning { [userId]: tier }.
// Bounded concurrency for the same reason rescanAll is bounded: this is N blob
// reads and firing them all at once is how a large user base turns into a
// thundering herd against the blob store.
export async function resolveTiers(userIds, concurrency = 8) {
  const unique = [...new Set(userIds.filter(Boolean))];
  const out = {};
  for (let i = 0; i < unique.length; i += concurrency) {
    const batch = unique.slice(i, i + concurrency);
    const tiers = await Promise.all(batch.map((id) => resolveUserTier(id)));
    batch.forEach((id, index) => { out[id] = tiers[index]; });
  }
  return out;
}

// The fastest tier among a token's watchers — the cadence the token is observed
// on. PREMIUM wins whenever any watcher has it.
export function bestTier(tiers = []) {
  return tiers.includes(TIER.PREMIUM) ? TIER.PREMIUM : TIER.FREE;
}

// Is this token due for observation?
//
// A token with NO previous observation is ALWAYS due. That is the correct
// reading of absence: never observed is not the same as recently observed, and
// treating a missing snapshot as "not due yet" would mean a newly watched token
// is never picked up at all.
//
// The 60-second slack absorbs cron jitter. Without it a run firing a few seconds
// early leaves every token one second short of due, and the whole cycle silently
// slips by one interval — an off-by-a-little that compounds into monitoring
// running at half the advertised rate.
const DUE_SLACK_MS = 60 * 1000;

export function isDue(lastObservedAt, tier, now = Date.now()) {
  if (!lastObservedAt) return true;
  const last = Date.parse(lastObservedAt);
  if (!Number.isFinite(last)) return true;
  const interval = OBSERVE_INTERVAL_MS[tier] ?? OBSERVE_INTERVAL_MS[TIER.FREE];
  return (now - last) >= (interval - DUE_SLACK_MS);
}

// Has this user waited long enough to be told again?
export function isNotifyDue(lastNotifiedAt, tier, now = Date.now()) {
  if (!lastNotifiedAt) return true;
  const last = Date.parse(lastNotifiedAt);
  if (!Number.isFinite(last)) return true;
  const interval = NOTIFY_INTERVAL_MS[tier] ?? NOTIFY_INTERVAL_MS[TIER.FREE];
  return (now - last) >= (interval - DUE_SLACK_MS);
}
