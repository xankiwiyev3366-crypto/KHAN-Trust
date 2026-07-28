// The methodology screen answers "how is this calculated?", so it is the one
// place in the product where being out of date is worse than being absent.
//
// It used to list a submission points table — "Website +10, X/Twitter +10,
// GitHub +15" — which described ONE of the five scoring categories as if it
// were the whole score, and read as a checklist to game. A user who compared it
// against a real report found two different products.
//
// It is now derived from TRUST_CATEGORIES and renders the same
// profileSections.category* strings the report itself uses. These tests pin
// that the derivation cannot silently produce a hole.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRUST_CATEGORIES } from '../src/lib/snapshotDiff.js';
import en from '../src/i18n/en.js';
import az from '../src/i18n/az.js';
import tr from '../src/i18n/tr.js';
import ru from '../src/i18n/ru.js';

const LOCALES = [['en', en], ['az', az], ['tr', tr], ['ru', ru]];

// If a category is ever added to the engine, the modal renders it immediately —
// so its copy has to exist, in every language, or the screen shows a raw key.
test('every scoring category has a name and an explanation in all four locales', () => {
  for (const [code, dict] of LOCALES) {
    const labels = dict.profileSections.categoryLabels;
    const explainers = dict.profileSections.categoryExplainers;
    for (const category of TRUST_CATEGORIES) {
      assert.ok(labels[category.labelKey], `${code}: no label for ${category.labelKey}`);
      assert.ok(explainers[category.labelKey], `${code}: no explainer for ${category.labelKey}`);
    }
  }
});

test('the methodology screen states its limits in all four locales', () => {
  for (const [code, dict] of LOCALES) {
    for (const key of ['title', 'eyebrow', 'body', 'categoriesTitle', 'ceilingTitle', 'ceiling', 'unknownTitle', 'unknown', 'limitsTitle', 'limits']) {
      assert.ok(dict.methodology[key], `${code}: methodology.${key} is missing`);
    }
  }
});

// THE REGRESSION THIS PREVENTS. The old copy advertised a points-per-link table,
// which is precisely the behaviour the scoring engine had to be hardened
// against when faked social links were found inflating scores. Publishing the
// tariff invites the gaming.
test('no locale advertises a points-per-link tariff', () => {
  for (const [code, dict] of LOCALES) {
    const blob = JSON.stringify(dict.methodology);
    assert.doesNotMatch(blob, /\+\s?\d{1,2}\b/, `${code}: methodology still lists a points table`);
  }
});

// The obsolete keys are gone rather than left behind to be re-rendered by
// accident.
test('the superseded points-table keys no longer exist', () => {
  for (const [code, dict] of LOCALES) {
    assert.equal(dict.methodology.items, undefined, `${code}: methodology.items survived`);
    assert.equal(dict.methodology.itemNote, undefined, `${code}: methodology.itemNote survived`);
  }
});

// A methodology that omits the caps is describing a different, more flattering
// algorithm than the one that runs: a live mint authority caps the score at 45
// no matter how good everything else looks.
test('the hard-ceiling explanation names an actual ceiling value', () => {
  assert.match(en.methodology.ceiling, /\b45\b/, 'the mint-authority cap should be stated, not implied');
  assert.match(en.methodology.ceiling, /\b55\b/);
  assert.match(en.methodology.ceiling, /\b60\b/);
});

test('the methodology still says the score is not financial advice', () => {
  assert.match(en.methodology.limits, /not financial advice/i);
});
