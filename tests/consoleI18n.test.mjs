// Keeps the console's two dictionaries honest.
//
// Two dictionaries maintained by hand drift silently: a key added to en.js and
// forgotten in az.js shows an English string to an Azerbaijani operator, and
// nobody notices until they hit that exact screen. These tests turn that into a
// failed test run instead.
import test from 'node:test';
import assert from 'node:assert/strict';

import en from '../src/admin/i18n/en.js';
import az from '../src/admin/i18n/az.js';
import { translate, LANGUAGES, DEFAULT_LANG } from '../src/admin/i18n/index.js';

// Flattens to dotted paths so the two trees can be compared as key sets.
function paths(node, prefix = '') {
  const out = [];
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) out.push(...paths(value, path));
    else out.push(path);
  }
  return out.sort();
}

test('az and en have exactly the same keys', () => {
  const enPaths = paths(en);
  const azPaths = paths(az);

  const missingInAz = enPaths.filter((p) => !azPaths.includes(p));
  const extraInAz = azPaths.filter((p) => !enPaths.includes(p));

  assert.deepEqual(missingInAz, [], 'keys in en.js with no az.js translation');
  assert.deepEqual(extraInAz, [], 'keys in az.js that no longer exist in en.js');
});

test('every value is a non-empty string', () => {
  for (const [name, dict] of [['en', en], ['az', az]]) {
    for (const path of paths(dict)) {
      const value = translate(name, path);
      assert.equal(typeof value, 'string', `${name}.${path} is not a string`);
      assert.ok(value.trim().length > 0, `${name}.${path} is empty`);
    }
  }
});

test('az is actually translated, not copied English', () => {
  // Guards against a lazy `az = {...en}`. Brand names, channel names and
  // acronyms legitimately match, so those are excluded rather than the check
  // being loosened.
  const ALLOWED_IDENTICAL = new Set([
    ...paths(en.brand).map((p) => `brand.${p}`),
    ...paths(en.channels).map((p) => `channels.${p}`),
    'common.eyebrow', 'common.notMeasured',
    'login.passcode',            // "Parol" vs "Passcode" differ, but keep the set explicit
    'rec.roi', 'objectives.user_experience',
    'content.colToken', 'content.colTicker',
  ]);

  const identical = paths(en)
    .filter((p) => !ALLOWED_IDENTICAL.has(p))
    .filter((p) => translate('en', p) === translate('az', p));

  assert.deepEqual(identical, [], 'these az values are byte-identical to English');
});

test('interpolation works in both languages', () => {
  for (const { code } of LANGUAGES) {
    const rendered = translate(code, 'overview.calls', { count: 7 });
    assert.match(rendered, /7/, `${code}: {count} was not substituted`);
    assert.ok(!rendered.includes('{count}'), `${code}: placeholder left in place`);
  }
});

test('every placeholder in en has a counterpart in az', () => {
  // A dropped {var} in a translation renders a sentence missing its number —
  // subtly wrong rather than obviously broken.
  const placeholders = (value) => (value.match(/\{(\w+)\}/g) || []).sort();

  for (const path of paths(en)) {
    const enVars = placeholders(translate('en', path));
    const azVars = placeholders(translate('az', path));
    assert.deepEqual(azVars, enVars, `${path}: placeholders differ between en and az`);
  }
});

test('a missing az key falls back to English, never to blank or a raw path', () => {
  // The fallback is what keeps a half-translated console usable.
  assert.equal(translate('az', 'brand.site'), 'KHAN Trust');
  // An unknown key returns the path rather than undefined, so a mistake is
  // visible in the UI rather than rendering an empty element.
  assert.equal(translate('az', 'nope.does.not.exist'), 'nope.does.not.exist');
});

test('an unknown language falls back to the default dictionary', () => {
  assert.equal(translate('fr', 'nav.funnel'), en.nav.funnel);
  assert.equal(DEFAULT_LANG, 'en', 'English must remain the default');
});

test('only English and Azerbaijani are offered', () => {
  assert.deepEqual(LANGUAGES.map((l) => l.code), ['en', 'az']);
});

test('Azerbaijani copy uses the platform\'s established vocabulary', () => {
  // The user-facing az.js already settled on these; the console must read as
  // the same product, not a second translation of it.
  assert.match(az.content.whatScanning, /tarayır/, 'scan → tarama');
  assert.match(az.content.colTrustScore, /etibar/i, 'trust → etibar');
  assert.match(az.acquisition.colVisitors, /Ziyarətçi/, 'visitors → ziyarətçilər');
  assert.match(az.acquisition.colSignups, /Qeydiyyat/, 'signups → qeydiyyatlar');
  assert.match(az.overview.title, /hesabat/, 'report → hesabat');
});

test('code identifiers are never translated', () => {
  // These are things the operator types or greps for. Localising them makes
  // them wrong.
  assert.match(az.overview.aiOffBody, /ANTHROPIC_API_KEY/);
  assert.match(az.funnel.blockersIntro, /wallet_required/);
  assert.match(az.funnel.blockersIntro, /missing_config/);
  assert.match(az.acquisition.noOwnedBody, /utm_source=youtube/);
  assert.match(az.overview.pollTimeout, /growth-analyze-background/);
});
