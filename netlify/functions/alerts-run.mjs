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
import { addNotifications, riskAlertId } from './_notificationStore.mjs';

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

// The reason detection itself, as structured CODES rather than sentences:
// [{ code, params }]. Two consumers render these, and they must never disagree
// about what happened:
//
//   - the email digest, in English, via changeReasons() below;
//   - the in-app notification center, in the reader's own language, by passing
//     the code to the client's i18n at RENDER time (see _notificationStore.mjs).
//
// Splitting detection from wording is what makes the second one possible. A
// sentence built here is frozen in English forever; a code is late-bound. The
// email stays English because an email is delivered once, at write time, with no
// reader context - the in-app bell has both, so it gets the better treatment.
export function changeReasonCodes(prev, current) {
  const codes = [];
  const before = prev?.signals;
  const after = current?.signals;
  if (!before || !after) return codes;

  const prevLiq = num(before.totalLiquidityUsd);
  const currLiq = num(after.totalLiquidityUsd);
  if (prevLiq !== null && currLiq !== null && prevLiq > 0) {
    const ratio = (currLiq - prevLiq) / prevLiq;
    // A total drain is the headline event, named as what it is rather than as
    // "liquidity dropped 100%".
    if (currLiq === 0) codes.push({ code: 'liquidityRemoved', params: {} });
    else if (ratio <= -0.1) codes.push({ code: 'liquidityDropped', params: { percent: Math.round(Math.abs(ratio) * 100) } });
  }

  const prevHolder = num(before.topHolderPercent);
  const currHolder = num(after.topHolderPercent);
  if (prevHolder !== null && currHolder !== null && currHolder - prevHolder >= 3) {
    codes.push({ code: 'topHolderGrew', params: { from: prevHolder, to: currHolder } });
  }

  // An authority flipping back on is a categorical change, not a gradual one:
  // someone can now mint or freeze supply that they previously could not.
  if (before.mintAuthorityEnabled === false && after.mintAuthorityEnabled === true) {
    codes.push({ code: 'mintReenabled', params: {} });
  }
  if (before.freezeAuthorityEnabled === false && after.freezeAuthorityEnabled === true) {
    codes.push({ code: 'freezeReenabled', params: {} });
  }

  const prevHolders = num(before.holderCount);
  const currHolders = num(after.holderCount);
  if (prevHolders !== null && currHolders !== null && prevHolders > 0) {
    const ratio = (currHolders - prevHolders) / prevHolders;
    if (ratio <= -0.2) codes.push({ code: 'holdersFell', params: { percent: Math.round(Math.abs(ratio) * 100) } });
  }

  return codes;
}

// English renderings for the email digest. The wording is unchanged from when
// this function did the detecting itself - the email is a delivered artefact and
// its exact text is pinned by tests/alertsRun.test.mjs.
const REASON_TEXT = {
  liquidityRemoved: () => 'all liquidity has been removed',
  liquidityDropped: ({ percent }) => `liquidity dropped ${percent}%`,
  topHolderGrew: ({ from, to }) => `largest holder grew from ${from}% to ${to}% of supply`,
  mintReenabled: () => 'mint authority has been re-enabled — new supply can be created',
  freezeReenabled: () => 'freeze authority has been re-enabled — your balance can be frozen',
  holdersFell: ({ percent }) => `holder count fell ${percent}%`,
};

export function changeReasons(prev, current) {
  return changeReasonCodes(prev, current).map(({ code, params }) => REASON_TEXT[code](params));
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

// One risk change -> one in-app notification row. Carries KEYS AND PARAMS, never
// a sentence, so the bell renders in the reader's language (see
// _notificationStore.mjs). The id is derived from the token plus the exact
// observation, so this cron re-running over unchanged state writes nothing.
//
// No `link`: the alert knows the token's IDENTITY, but a project id is a
// client-side notion (projects live in the browser's storage - see
// findStoredProject in main.jsx), so the server cannot build a correct URL. The
// client resolves identity -> project at render time, where that mapping exists.
function toNotification(change) {
  const { token, current, prev, codes } = change;
  // High severity for the categorical events - an authority re-enabled or the
  // liquidity gone are not "your score moved", they are "act now".
  const isCritical =
    current.riskLevel === 'High' ||
    codes.some(({ code }) => code === 'liquidityRemoved' || code === 'mintReenabled' || code === 'freezeReenabled');

  return {
    id: riskAlertId(token.identity, current.observedAt),
    type: 'risk_alert',
    severity: isCritical ? 'high' : 'medium',
    titleKey: 'notifications.riskAlert.title',
    bodyKey: 'notifications.riskAlert.body',
    params: {
      identity: token.identity,
      contract: token.contract || '',
      chain: token.chain || '',
      name: token.name || token.ticker || token.contract || '',
      ticker: token.ticker || '',
      score: current.trustScore,
      riskLevel: current.riskLevel,
      previousScore: prev?.score ?? null,
      previousRiskLevel: prev?.riskLevel ?? null,
      reasons: codes,
    },
    at: current.observedAt || new Date().toISOString(),
  };
}

export async function handler() {
  try {
    // Email is OPTIONAL to this loop, not a precondition for it.
    //
    // This used to return early when email was unconfigured, which was correct
    // when an email WAS the only delivery. Now the in-app notification center is
    // the other half, and it must not inherit email's dependencies: a site with
    // no SMTP configured would otherwise have a permanently empty bell AND a
    // frozen baseline - i.e. the retention loop dead again, for a reason nobody
    // would think to look for. Observation and baselining now always run; each
    // delivery channel opts in for itself.
    const emailReady = isEmailConfigured();

    const subscriptions = await listSubscriptions();
    let notified = 0;
    let inApp = 0;

    for (const sub of subscriptions) {
      // userId, not email, is the requirement now - the bell is addressed by
      // account. An address is only needed by the email channel below.
      if (!sub?.userId || !Array.isArray(sub.tokens) || !sub.tokens.length) continue;
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
          changes.push({
            token,
            current,
            prev,
            reasons: changeReasons(prev, current),      // English, for the email digest
            codes: changeReasonCodes(prev, current),    // structured, for the localized bell
          });
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
        // In-app first, and unconditionally. It is the channel that always
        // exists, needs no address, and cannot bounce. One write per user per
        // run, deduped by id inside the store.
        const written = await addNotifications(sub.userId, changes.map(toNotification));
        inApp += written.length;

        if (emailReady && sub.email) {
          await sendEmail({
            to: sub.email,
            subject: `KHAN Trust alert: ${changes.length} watched token${changes.length > 1 ? 's' : ''} got riskier`,
            text: buildDigest(changes),
          });
          notified += 1;
        }
      }

      sub.lastNotified = lastNotified;
      await saveSubscription(sub);
    }

    return {
      statusCode: 200,
      body: `alerts-run: processed ${subscriptions.length} subscriptions, notified ${notified}, in-app ${inApp}`,
    };
  } catch (error) {
    return { statusCode: 500, body: `alerts-run crashed: ${error.message}` };
  }
}
