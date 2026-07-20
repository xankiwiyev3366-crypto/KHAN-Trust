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
import { putWatchSnapshot, getWatchSnapshots } from './_watchSnapshotStore.mjs';
import { distinctWatchedTokens, rescanAll, selectDueTokens } from './_rescanEngine.mjs';
import { recordRun } from './_watchtowerStore.mjs';
import { resolveTiers, TIER } from './_watchTiers.mjs';

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

    // Every subscriber's plan, resolved once per run. Premium buys OBSERVATION
    // cadence, so a token's cadence is the fastest tier among its watchers —
    // see _watchTiers.mjs for why observation is a token property while
    // notification is a user property.
    const tierByUser = await resolveTiers(subscriptions.map((sub) => sub?.userId));

    // Ten users watching BONK is ONE re-scan. Work scales with tokens watched,
    // not users watching — which is what keeps this affordable as we grow, and
    // is why the tier is folded into the token rather than kept per-user here.
    const tokens = distinctWatchedTokens(subscriptions, tierByUser);

    if (!tokens.length) {
      console.log('[watch-rescan] no watched tokens; nothing to observe.');
      return { statusCode: 200 };
    }

    // A token's last observation time already lives on its snapshot, so due-ness
    // needs no new store. These reads also serve the run itself: a token that is
    // not due costs one cheap blob read instead of two provider calls.
    const existing = await getWatchSnapshots(tokens.map((token) => token.identity));
    const { dueTokens, deferred, skipped } = selectDueTokens(tokens, existing);

    if (!dueTokens.length) {
      console.log(`[watch-rescan] ${tokens.length} watched, none due this run.`);
      return { statusCode: 200 };
    }

    // A run with tokens to observe is a run the Watchtower Report can account
    // for, so the ledger entry is written even if every observation below
    // declines — "we ran, and could not see anything" is a materially different
    // report from "we did not run", and only the ledger can tell them apart.

    const { results, observed, declined } = await rescanAll(dueTokens);

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
      console.warn(`[watch-rescan] declined ${declined}/${dueTokens.length}: ${JSON.stringify(reasons)}`);
    }

    // Deferred work is logged loudly. A run that is persistently capped means
    // the watchlist has outgrown one cycle, and the symptom — monitoring
    // quietly running slower than advertised — is invisible from the outside.
    if (deferred) {
      console.warn(`[watch-rescan] ${deferred} due tokens deferred to the next run (per-run cap reached).`);
    }

    // The legacy-wallet gap made visible (see resolveUserTier in _watchTiers).
    // A subscriber whose Premium lives only in a wallet-keyed entitlement they
    // never claimed resolves to FREE and is monitored slowly while paying. This
    // cannot be detected from a userId, so it is COUNTED rather than guessed at:
    // if this is ever non-zero, those users should be prompted to claim.
    const premiumUsers = Object.values(tierByUser).filter((tier) => tier === TIER.PREMIUM).length;
    console.log(
      `[watch-rescan] ${subscriptions.length} subscribers (${premiumUsers} premium), `
      + `${tokens.length} watched, ${dueTokens.length} due, ${skipped} not yet due.`
    );

    // Coverage ledger for the Watchtower Report. Best-effort and LAST, after
    // every snapshot is durably stored: this is reporting metadata, not a
    // precondition for observing. Losing a ledger row costs one line of prose in
    // a report; letting it fail the run would cost an alert.
    try {
      await recordRun({ tokens: dueTokens.length, observed, declined });
    } catch (error) {
      console.warn(`[watch-rescan] coverage ledger write failed: ${error.message}`);
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
