// The re-scan worker. This is the function whose absence broke retention.
//
// Refreshes every watched token's risk snapshot on a schedule, with no browser
// and no user present, then writes it to the authoritative watch lane so
// alerts-run has something fresh to compare. Before this existed a token's
// snapshot only refreshed when a human viewed it, so the alert loop could never
// fire for a dormant token — the product promised "we watch for you" and
// structurally could not.
//
// WHY A BACKGROUND FUNCTION, NOT A SCHEDULED ONE
//
// Netlify's execution caps (see netlify.toml for the full topology):
//   synchronous ~10s | scheduled 30s | background 15min (-background suffix)
//
// Re-scanning N tokens at 2 HTTP calls each blows 30s the moment N is more than
// a handful, and it would blow it SILENTLY, every hour. So the same split the
// Growth OS already uses applies here: watch-rescan-cron fires this and returns
// instantly; the real work runs with the 15-minute budget.
//
// A scheduled function is also not invocable over HTTP, so the two roles cannot
// share one function.
import { verifyToken, bearerToken } from './_adminAuth.mjs';
import { listSubscriptions } from './_alertsStore.mjs';
import { putWatchSnapshot } from './_watchSnapshotStore.mjs';
import { distinctWatchedTokens, rescanAll } from './_rescanEngine.mjs';

export async function handler(event) {
  // Same posture as growth-analyze-background: this does real network work and
  // writes durable state, so an unauthenticated caller must not be able to
  // trigger it (or to hammer two public APIs on our behalf).
  if (!verifyToken(bearerToken(event))) {
    console.warn('[watch-rescan] unauthorised invocation ignored; no work done.');
    return { statusCode: 202 };
  }

  const startedAt = Date.now();
  try {
    const subscriptions = await listSubscriptions();
    // Ten users watching BONK is ONE re-scan. Work scales with tokens watched,
    // not users watching — which is what keeps this affordable as we grow.
    const tokens = distinctWatchedTokens(subscriptions);

    if (!tokens.length) {
      console.log('[watch-rescan] no watched tokens; nothing to observe.');
      return { statusCode: 200 };
    }

    const { results, observed, declined } = await rescanAll(tokens);

    // Persist only genuine observations. A declined token keeps its previous
    // snapshot, so the next comparison is still like-for-like against a real
    // past observation rather than against a hole.
    let written = 0;
    for (const result of results) {
      if (!result.ok) continue;
      try {
        await putWatchSnapshot(result.identity, result.snapshot);
        written += 1;
      } catch (error) {
        // One unwritable blob must not lose the rest of the run.
        console.warn(`[watch-rescan] failed to store ${result.identity}: ${error.message}`);
      }
    }

    // Declines are logged loudly and in aggregate. A worker that quietly
    // declines everything looks identical to a healthy one from the outside —
    // which is precisely how the original loop stayed broken without anyone
    // noticing. If `declined` is high, alerting is degraded even though this
    // function returns 200.
    if (declined) {
      const reasons = {};
      for (const r of results.filter((x) => !x.ok)) {
        reasons[r.reason] = (reasons[r.reason] || 0) + 1;
      }
      console.warn(`[watch-rescan] declined ${declined}/${tokens.length}: ${JSON.stringify(reasons)}`);
    }

    console.log(
      `[watch-rescan] ${tokens.length} watched tokens, observed ${observed}, wrote ${written}, `
      + `declined ${declined} in ${Date.now() - startedAt}ms.`
    );
    return { statusCode: 200 };
  } catch (error) {
    console.error(`[watch-rescan] crashed after ${Date.now() - startedAt}ms: ${error.message}`);
    return { statusCode: 500 };
  }
}
