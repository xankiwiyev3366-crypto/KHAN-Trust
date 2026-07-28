// Route alias resolution.
//
// The defect these pin is not subtle once seen: #/dashboard and #/comparison
// were live URLs that rendered a completely empty page, while the sidebar lit
// up the item the user had just failed to reach. One half of the app believed
// the alias existed; the other had never heard of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRoute, ROUTE_ALIASES } from '../src/lib/routes.js';

test('the aliases that used to render a blank page now resolve', () => {
  assert.equal(resolveRoute('#/dashboard'), 'home');
  assert.equal(resolveRoute('#/comparison'), 'compare');
});

// This one is linked from outside the app — the notification bell and the
// alert emails point at it. It must keep working after the nav entry was
// merged away, or every alert link already sent goes nowhere.
test('#/alerts still resolves after the nav entry was merged into Watchlist', () => {
  assert.equal(resolveRoute('#/alerts'), 'watchlist');
});

test('a canonical route resolves to itself', () => {
  for (const id of ['home', 'explore', 'compare', 'watchlist', 'watchtower', 'approvals', 'pricing', 'about']) {
    assert.equal(resolveRoute(`#/${id}`), id);
  }
});

test('every alias points at a different page than its own name', () => {
  for (const [alias, target] of Object.entries(ROUTE_ALIASES)) {
    assert.notEqual(alias, target, `${alias} aliases itself`);
    // An alias whose target is itself an alias would resolve in one hop and
    // silently land on the wrong page.
    assert.ok(!ROUTE_ALIASES[target], `${alias} -> ${target} chains to another alias`);
  }
});

test('the hash prefix is optional, so a bare id works too', () => {
  assert.equal(resolveRoute('dashboard'), 'home');
  assert.equal(resolveRoute('/dashboard'), 'home');
  assert.equal(resolveRoute('#/dashboard'), 'home');
});

test('an empty or missing hash is the home page, not a blank one', () => {
  for (const empty of ['', '#', '#/', '/', null, undefined]) {
    assert.equal(resolveRoute(empty), 'home', `${String(empty)} should be home`);
  }
});

// Deep-link shapes the app builds itself. These carry an id in the path and
// must survive untouched — an alias table that mangled them would break every
// shared report link.
test('parameterised deep links pass through unchanged', () => {
  for (const route of ['project/abc123', 'report/abc123', 'early-stage/xyz', 'verify-email/tok', 'reset-password/tok']) {
    assert.equal(resolveRoute(`#/${route}`), route);
  }
});

test('an unknown route is returned as-is rather than silently becoming home', () => {
  // The app decides what to do with an unrecognised page; swallowing it here
  // would hide a genuine broken link behind a redirect to the homepage.
  assert.equal(resolveRoute('#/nope'), 'nope');
});
