// Scheduled worker (Direction 3): the engine of the retention loop. Runs on a
// cron, and for every user's alert subscriptions compares each watched token's
// CURRENT server-observed snapshot against what it was at the previous run.
// When a token gets meaningfully riskier, the user gets an email digest. This
// is the single strongest reason to return to KHAN Trust: it watches for you.
//
// IT NOW ACTUALLY DOES
//
// This function used to read the token corpus, whose only writer was a
// client-side call fired when a human VIEWED a token. So the watchtower could
// only see tokens someone was already standing in front of: a dormant token's
// snapshot was frozen forever, riskWorsened() was permanently false, and the
// loop could not fire. Retention depended on the traffic it existed to create.
// watch-rescan-background.mjs now refreshes watched tokens on a schedule and
// writes them to the watch lane, which is what this reads.
//
// THE LANE RULE — WHY THIS DOES NOT READ THE CORPUS
//
// The corpus is scored from the client's full 18-provider input set; the watch
// lane is scored from the volatile subset. They are different numbers for the
// same token: measured on live data, BONK is 35 (High) in the corpus and 76
// (Medium) in the watch lane, at the same instant. Neither is wrong — they are
// not comparable. Comparing across lanes would read that 41-point methodology
// gap as a risk collapse and email EVERY watcher on the first tick, from a
// product whose only asset is trust.
//
// So: watch-lane snapshots are compared only to watch-lane baselines, and only
// to baselines produced by the same engine version. Anything else is treated as
// "no baseline" — we re-baseline silently and alert from the next run. That is
// the same rule that already protects a new subscriber from being spammed the
// moment they subscribe, applied to migrations and methodology changes.
import { listSubscriptions, saveSubscription } from './_alertsStore.mjs';
import { getWatchSnapshot } from './_watchSnapshotStore.mjs';
import { RESCAN_ENGINE_VERSION } from './_rescanEngine.mjs';
import { sendEmail, isEmailConfigured } from './_email.mjs';

// Runs hourly at :30, deliberately NOT at :00 where watch-rescan-cron fires.
//
// The two are a pipeline: the worker observes, then this reads what it
// observed. At the same cron minute they would race, and this would read
// snapshots up to an hour stale — the loop would still work but every alert
// would arrive an hour late, which for a liquidity drain is the difference
// between a warning and a post-mortem. :30 gives the background worker (15min
// cap) a full half-hour to finish.
export const config = { schedule: '30 * * * *' };

const RISK_ORDER = { Low: 0, Medium: 1, High: 2 };
const SCORE_DROP_THRESHOLD = 10;

// Is this stored baseline comparable to a snapshot the current engine produced?
//
// A baseline is only comparable if it came from the same lane AND the same
// engine version. Legacy baselines (written when this function read the corpus)
// carry no `source`, so they are correctly rejected here — which is what stops
// the switch-over from emailing every existing subscriber a rug alert that is
// really just a change of methodology.
export function isComparableBaseline(prev) {
  if (!prev) return false;
  if (prev.source !== 'server_rescan') return false;
  return prev.engineVersion === RESCAN_ENGINE_VERSION;
}

// Pure and exported for unit testing. "Worsened" = the risk LEVEL went up, or
// the score dropped by at least the threshold, versus the previous snapshot.
// No comparable previous snapshot means this is the first observation - we
// establish a baseline and never alert on it, so a user is never spammed the
// moment they subscribe, nor when the engine changes underneath them.
export function riskWorsened(prev, current) {
  if (!isComparableBaseline(prev) || !current) return false;
  const prevRisk = RISK_ORDER[prev.riskLevel] ?? 1;
  const currRisk = RISK_ORDER[current.riskLevel] ?? 1;
  if (currRisk > prevRisk) return true;
  const prevScore = Number.isFinite(prev.score) ? prev.score : null;
  const currScore = Number.isFinite(current.trustScore) ? current.trustScore : null;
  if (prevScore === null || currScore === null) return false;
  return prevScore - currScore >= SCORE_DROP_THRESHOLD;
}

// Derives the plain-language WHY from the two snapshots being compared.
//
// Reads the raw signals the re-scan worker stored ON the snapshot, rather than
// re-fetching or reaching into the client's score history. Two reasons:
//
//  1. Same-lane discipline. The score history is the client's lane, written on
//     view from a different input set. Explaining a watch-lane alert with
//     corpus-lane numbers would produce reasons that contradict the score the
//     email is about.
//  2. The evidence is frozen at observation time, so a later change to the
//     engine cannot retroactively rewrite why we told someone their money was
//     at risk.
//
// Server-local and dependency-free on purpose: the client's riskHistory.js
// pulls in the i18n bundle, which doesn't belong in a Netlify Function, and the
// email is English-only.
function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function changeReasons(prev, current) {
  const reasons = [];
  const before = prev?.signals;
  const after = current?.signals;
  if (!before || !after) return reasons;

  const prevLiq = num(before.totalLiquidityUsd);
  const currLiq = num(after.totalLiquidityUsd);
  if (prevLiq !== null && currLiq !== null && prevLiq > 0) {
    const ratio = (currLiq - prevLiq) / prevLiq;
    // A total drain is the headline event, named as what it is rather than as
    // "liquidity dropped 100%".
    if (currLiq === 0) reasons.push('all liquidity has been removed');
    else if (ratio <= -0.1) reasons.push(`liquidity dropped ${Math.round(Math.abs(ratio) * 100)}%`);
  }

  const prevHolder = num(before.topHolderPercent);
  const currHolder = num(after.topHolderPercent);
  if (prevHolder !== null && currHolder !== null && currHolder - prevHolder >= 3) {
    reasons.push(`largest holder grew from ${prevHolder}% to ${currHolder}% of supply`);
  }

  // An authority flipping back on is a categorical change, not a gradual one:
  // someone can now mint or freeze supply that they previously could not.
  if (before.mintAuthorityEnabled === false && after.mintAuthorityEnabled === true) {
    reasons.push('mint authority has been re-enabled — new supply can be created');
  }
  if (before.freezeAuthorityEnabled === false && after.freezeAuthorityEnabled === true) {
    reasons.push('freeze authority has been re-enabled — your balance can be frozen');
  }

  const prevHolders = num(before.holderCount);
  const currHolders = num(after.holderCount);
  if (prevHolders !== null && currHolders !== null && prevHolders > 0) {
    const ratio = (currHolders - prevHolders) / prevHolders;
    if (ratio <= -0.2) reasons.push(`holder count fell ${Math.round(Math.abs(ratio) * 100)}%`);
  }

  return reasons;
}

function buildDigest(changes) {
  const lines = changes.map((c) => {
    const label = c.token.name || c.token.ticker || c.token.contract || 'Token';
    const now = `now ${c.current.trustScore}/100 (${c.current.riskLevel} risk)`;
    const was = c.prev ? `, was ${c.prev.score}/100 (${c.prev.riskLevel} risk)` : '';
    const why = c.reasons && c.reasons.length ? `\n    Reason: ${c.reasons.join('; ')}` : '';
    return `- ${label}: ${now}${was}${why}`;
  });
  return `Some tokens you're watching on KHAN Trust have a higher risk profile than before:\n\n${lines.join('\n')}\n\nOpen KHAN Trust for the full explainable breakdown: https://khantrust.net\n\nYou're receiving this because you enabled trust alerts on these tokens.`;
}

export async function handler() {
  try {
    if (!isEmailConfigured()) {
      return { statusCode: 200, body: 'alerts-run: email not configured, skipped' };
    }

    const subscriptions = await listSubscriptions();
    let notified = 0;

    for (const sub of subscriptions) {
      if (!sub?.email || !Array.isArray(sub.tokens) || !sub.tokens.length) continue;
      const lastNotified = sub.lastNotified || {};
      const changes = [];

      for (const token of sub.tokens) {
        // The watch lane: what the re-scan worker last OBSERVED, independent of
        // whether any human has looked at this token. Absent means the worker
        // has not managed a complete observation yet (new subscription, or it
        // declined rather than score a partial fetch) — nothing to compare, and
        // critically nothing to guess at.
        const current = await getWatchSnapshot(token.identity);
        if (!current) continue;

        const prev = lastNotified[token.identity];
        if (riskWorsened(prev, current)) {
          changes.push({ token, current, prev, reasons: changeReasons(prev, current) });
        }

        // Re-baseline to the latest each run so we compare run-over-run and
        // never re-send the same worsening twice. The lane and engine stamps
        // travel with the baseline so a future run can tell whether it is
        // comparable — without them, a methodology change silently becomes a
        // risk finding.
        lastNotified[token.identity] = {
          score: current.trustScore,
          riskLevel: current.riskLevel,
          signals: current.signals,
          source: current.source,
          engineVersion: current.engineVersion,
          at: new Date().toISOString(),
        };
      }

      if (changes.length) {
        await sendEmail({
          to: sub.email,
          subject: `KHAN Trust alert: ${changes.length} watched token${changes.length > 1 ? 's' : ''} got riskier`,
          text: buildDigest(changes),
        });
        notified += 1;
      }

      sub.lastNotified = lastNotified;
      await saveSubscription(sub);
    }

    return { statusCode: 200, body: `alerts-run: processed ${subscriptions.length} subscriptions, notified ${notified}` };
  } catch (error) {
    return { statusCode: 500, body: `alerts-run crashed: ${error.message}` };
  }
}
