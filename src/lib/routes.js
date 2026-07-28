// Route aliases: alternative hashes that resolve to one canonical page.
//
// THE DEFECT THIS FIXES
//
// #/dashboard and #/comparison were treated as real routes by the sidebar's
// active-state check while NOTHING rendered them. Both produced a completely
// empty page, with the sidebar cheerfully highlighting the item the user had
// just failed to reach. The aliases were half-implemented: claimed in one
// place, unimplemented in the other, and nothing could catch the disagreement
// because the two halves shared no code.
//
// Resolving them HERE, once, at the point the hash is read, is what makes the
// two halves agree by construction: the active state and the rendered page now
// read the same canonical value.
//
// WHY THE URL IS NOT REWRITTEN
//
// A deep link keeps the address the user arrived on. Rewriting it would break
// the back button — back would return to the alias, which would forward again,
// trapping the user — and would silently invalidate links people have already
// shared.
//
// Every alias here is permanent. `alerts` in particular is the route this
// product's own notification emails and in-app bell have been pointing at, and
// a URL that has been sent to someone is a promise.
export const ROUTE_ALIASES = {
  dashboard: 'home',
  comparison: 'compare',
  // Alerts and the watchlist were two navigation entries rendering the
  // identical page. The entry is gone; the route stays.
  alerts: 'watchlist',
};

// Accepts a raw hash ('#/dashboard'), a bare id ('dashboard'), or junk, and
// returns the canonical page id. Empty means home, which is what a visitor
// arriving at the bare domain gets.
export function resolveRoute(raw) {
  const page = String(raw == null ? '' : raw).replace(/^#?\/?/, '');
  if (!page) return 'home';
  return ROUTE_ALIASES[page] || page;
}
