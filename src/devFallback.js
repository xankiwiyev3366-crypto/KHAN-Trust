// THE ONE PREDICATE THAT DECIDES WHETHER A DEV-ONLY LOCALSTORAGE FALLBACK MAY RUN.
//
// WHAT WAS WRONG
//
// Six client modules (earlyStage, report, support, verification, userData,
// scoreHistory) each carried their own copy of:
//
//   function isFunctionUnavailable(error) {
//     return Boolean(error) && (error.status === undefined || error.status === 404);
//   }
//
// Every one of them documented itself as a fallback for "plain `vite dev` with
// no Netlify Functions server". None of them actually checked whether it was in
// development. `error.status === undefined` is ANY network-layer failure — a
// dropped connection, a DNS blip, an offline phone, a Netlify incident — all of
// which happen constantly in production.
//
// So in production the fallbacks fired, and each one lied differently:
//
//   verification.js  wrote a "pending verification request" into the visitor's
//                    own localStorage and reported SUCCESS. The user believes
//                    they have applied for verification. No server ever saw it.
//                    With Phase 2 this becomes a paid product — the same bug
//                    would take someone's intent to pay and drop it on the floor
//                    while showing a confirmation.
//   report.js        same shape: a fake "report submitted" confirmation for an
//                    abuse report nobody will ever read.
//   support.js       same shape: a support ticket that does not exist.
//   earlyStage.js    served a localStorage store, and previously a set of
//                    invented projects, as though it were the site's data.
//   userData.js      served an empty saved-reports/watchlist to a paying
//                    customer, which is indistinguishable from data loss.
//   scoreHistory.js  served an empty Trust Graph as though the token had no
//                    history.
//
// Every one of those is the same failure: a transient error presented as a
// quieter, wronger truth instead of as an error.
//
// WHY `import.meta.env.DEV` AND NOT A RUNTIME CHECK
//
// Vite statically replaces `import.meta.env.DEV` with the literal `false` when
// building for production. `if (!false) return false;` collapses, the branch
// becomes unreachable, and Rollup drops every fallback body behind it from the
// bundle. The guarantee is therefore not "we remembered to check at runtime" —
// it is that the dev fixture code is not present in the artefact a real visitor
// downloads. tests/noFabricatedData.test.mjs asserts exactly that against
// dist/, so the guarantee is verified against the build rather than trusted.
//
// In development the behaviour is byte-for-byte what it always was.

// Is this error the "there is no Functions server" case a dev fallback exists
// for — and are we actually running in development?
//
// A network-level failure (no `status` at all) or a 404 means the function was
// never reached. Any other status (400/401/402/500/502…) means the function DID
// run and returned a real answer, which must always surface to the caller.
export function isDevFunctionUnavailable(error) {
  if (!import.meta.env?.DEV) return false;
  return Boolean(error) && (error.status === undefined || error.status === 404);
}
