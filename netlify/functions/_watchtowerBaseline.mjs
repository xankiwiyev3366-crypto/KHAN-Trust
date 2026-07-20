// One definition of "is this stored baseline safe to compare against?", shared
// by the alert worker and the Watchtower Report.
//
// WHY THIS IS ITS OWN MODULE
//
// The rule lived in alerts-run.mjs. The report needs the identical rule, but
// importing alerts-run.mjs would drag in the email client, the notification
// store and the whole re-scan engine — for one boolean. It is also the single
// most safety-critical predicate in the watch lane, so it earns a file where it
// can be read, tested and reasoned about on its own.
//
// WHAT IT PROTECTS AGAINST
//
// A baseline is only comparable if it came from the same LANE and the same
// ENGINE VERSION.
//
//   - LANE: the corpus is scored from the client's full 18-provider input set;
//     the watch lane from the volatile subset. Measured on live data, BONK is 35
//     (High) in one and 76 (Medium) in the other AT THE SAME INSTANT. Comparing
//     across lanes reads that methodology gap as a 41-point risk collapse and
//     tells every watcher their token is rugging — from a product whose only
//     asset is trust. Legacy baselines carry no `source`, so they are correctly
//     rejected here.
//
//   - ENGINE VERSION: if the volatile input set ever changes, snapshots either
//     side of that change are not comparable either, for exactly the same
//     reason. RESCAN_ENGINE_VERSION is bumped whenever it does.
//
// Rejecting a baseline is always SAFE: the caller re-baselines silently and
// reports from the next period. A missed comparison costs one quiet period. A
// wrong comparison costs a false alarm about someone's money.
//
// The version is duplicated as a literal rather than imported from
// _rescanEngine.mjs on purpose — that module pulls in every data provider, and
// this predicate is used by request-path code that must stay light. The
// duplication is pinned by tests/watchtower.test.mjs, which asserts the two
// constants are equal, so they cannot drift silently.
export const COMPARABLE_ENGINE_VERSION = 1;
export const COMPARABLE_SOURCE = 'server_rescan';

export function isComparableBaseline(prev) {
  if (!prev) return false;
  if (prev.source !== COMPARABLE_SOURCE) return false;
  return prev.engineVersion === COMPARABLE_ENGINE_VERSION;
}
