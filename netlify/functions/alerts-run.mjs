// Scheduled worker (Direction 3): the engine of the retention loop. Runs on a
// cron, and for every user's alert subscriptions compares each watched token's
// CURRENT trust snapshot (from the shared corpus, Direction 1) against what it
// was at the previous run. When a token gets meaningfully riskier, the user
// gets an email digest (via the now-verified khantrust.net sender). This is
// the single strongest reason to return to KHAN Trust: it watches for you.
//
// Additive and self-contained. If email isn't configured or the corpus is
// empty it simply no-ops. Server-side authoritative re-scoring is a deferred
// slice; today it reacts to corpus updates (which happen whenever anyone views
// a token), so actively-tracked tokens are covered now and coverage widens
// automatically once the corpus re-scan worker lands.
import { listSubscriptions, saveSubscription } from './_alertsStore.mjs';
import { getCorpusToken } from './_tokenCorpusStore.mjs';
import { getHistory } from './_scoreHistoryStore.mjs';
import { sendEmail, isEmailConfigured } from './_email.mjs';

// Runs hourly. Netlify reads this exported config to schedule the function.
export const config = { schedule: '@hourly' };

const RISK_ORDER = { Low: 0, Medium: 1, High: 2 };
const SCORE_DROP_THRESHOLD = 10;

// Pure and exported for unit testing. "Worsened" = the risk LEVEL went up, or
// the score dropped by at least the threshold, versus the previous snapshot.
// No previous snapshot means this is the first observation - we establish a
// baseline and never alert on it, so a user is never spammed the moment they
// subscribe.
export function riskWorsened(prev, current) {
  if (!prev || !current) return false;
  const prevRisk = RISK_ORDER[prev.riskLevel] ?? 1;
  const currRisk = RISK_ORDER[current.riskLevel] ?? 1;
  if (currRisk > prevRisk) return true;
  const prevScore = Number.isFinite(prev.score) ? prev.score : null;
  const currScore = Number.isFinite(current.trustScore) ? current.trustScore : null;
  if (prevScore === null || currScore === null) return false;
  return prevScore - currScore >= SCORE_DROP_THRESHOLD;
}

// Phase 5: derive plain-language WHY reasons from the two most recent score
// snapshots (platform memory). Server-local and dependency-free on purpose -
// the client's riskHistory.js pulls in the i18n bundle, which doesn't belong in
// a Netlify Function; the email is English-only, so a small self-contained
// mirror of the same thresholds is the right seam (same pattern as the
// server-local riskWorsened() above). Tolerant of old/thin snapshots.
function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function changeReasons(prevSnap, currSnap) {
  const reasons = [];
  if (!prevSnap || !currSnap) return reasons;

  const prevLiq = num(prevSnap.liquidityUsd);
  const currLiq = num(currSnap.liquidityUsd);
  if (prevLiq !== null && currLiq !== null && prevLiq > 0) {
    const ratio = (currLiq - prevLiq) / prevLiq;
    if (ratio <= -0.1) reasons.push(`liquidity dropped ${Math.round(Math.abs(ratio) * 100)}%`);
  }

  const prevHolder = num(prevSnap.topHolderPercent);
  const currHolder = num(currSnap.topHolderPercent);
  if (prevHolder !== null && currHolder !== null && currHolder - prevHolder >= 3) {
    reasons.push(`holder concentration increased ${Math.round(currHolder - prevHolder)} pts`);
  }

  const catLabels = {
    contractSecurity: 'contract security',
    holderHealth: 'holder health',
    marketActivity: 'market activity',
    community: 'community score',
  };
  const prevCats = prevSnap.categories || {};
  const currCats = currSnap.categories || {};
  for (const [key, label] of Object.entries(catLabels)) {
    const prevVal = num(prevCats[key]);
    const currVal = num(currCats[key]);
    if (prevVal !== null && currVal !== null && prevVal - currVal >= 8) {
      reasons.push(`${label} weakened ${Math.round(prevVal - currVal)} pts`);
    }
  }

  const prevSocial = num(prevSnap.socialScore);
  const currSocial = num(currSnap.socialScore);
  if (prevSocial !== null && currSocial !== null && prevSocial - currSocial >= 8) {
    reasons.push(`social score decreased ${Math.round(prevSocial - currSocial)} pts`);
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
        const current = await getCorpusToken(token.identity);
        if (!current) continue;
        const prev = lastNotified[token.identity];
        if (riskWorsened(prev, current)) {
          // Enrich with the specific WHY from the token's score history (last
          // two snapshots). Best-effort: a history read failure just omits the
          // reasons, the alert itself still sends.
          let reasons = [];
          try {
            const history = await getHistory(token.identity);
            if (Array.isArray(history) && history.length >= 2) {
              const sorted = [...history].sort((a, b) => String(a.date).localeCompare(String(b.date)));
              reasons = changeReasons(sorted[sorted.length - 2], sorted[sorted.length - 1]);
            }
          } catch {
            // history is optional context for the digest; ignore failures
          }
          changes.push({ token, current, prev, reasons });
        }
        // Re-baseline to the latest each run so we compare run-over-run and
        // never re-send the same worsening twice.
        lastNotified[token.identity] = {
          score: current.trustScore,
          riskLevel: current.riskLevel,
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
