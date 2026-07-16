// Tests for the analysts' output language and the reason-code plumbing.
//
// Two things must hold at once and they pull against each other: the PROSE must
// come out in the operator's language, while the ENUMS must stay canonical
// English. If the enums drift, the JSON schema rejects the response and the
// console's t(`objectives.${...}`) lookups miss — a translated report that
// renders as raw keys.
import test from 'node:test';
import assert from 'node:assert/strict';

import { languageDirective } from '../netlify/functions/_growthAnalyst.mjs';
import { assessRate, assessCount, assessChange, REASON } from '../netlify/functions/_growthConfidence.mjs';
import { buildFunnel, findBottleneck, findInstrumentationGaps } from '../netlify/functions/_growthWarehouse.mjs';
import { renderReason, renderNote } from '../src/admin/lib/reason.js';

// ── Language directive ────────────────────────────────────────────────────────

test('English adds no directive at all', () => {
  // English is the default and the prompt is already English — appending
  // "write in English" is noise that costs input tokens on every call.
  assert.equal(languageDirective('en'), '');
});

test('Azerbaijani directive names the language and demands native prose', () => {
  const directive = languageDirective('az');
  assert.match(directive, /Azerbaijani/);
  assert.match(directive, /native speaker/i);
  assert.match(directive, /not translated from\s+English/i);
});

test('the directive protects every enum from translation', () => {
  // The load-bearing carve-out. A translated enum breaks the schema AND the UI.
  const directive = languageDirective('az');
  for (const enumValue of [
    'P0', 'low', 'medium', 'high',
    'grounded_in_data', 'informed_judgement', 'speculative',
    'registrations', 'active_users', 'investor_readiness', 'data_quality',
  ]) {
    assert.ok(directive.includes(enumValue), `directive must name the enum value "${enumValue}"`);
  }
  assert.match(directive, /Do NOT translate/);
});

test('the directive protects identifiers and names', () => {
  const directive = languageDirective('az');
  for (const literal of ['wallet_required', 'utm_source', 'KHAN Trust', 'YouTube', 'TikTok']) {
    assert.ok(directive.includes(literal), `directive must protect "${literal}"`);
  }
});

test('the directive pins the decimal separator to a period', () => {
  // Azerbaijani would naturally write 3,2. The validator can cope (see
  // aiValidator.test.mjs) but asking for periods keeps the model's numbers
  // byte-identical to the source facts, which is the cheapest thing to verify.
  assert.match(languageDirective('az'), /PERIOD as the decimal separator/i);
});

test('an unknown language does not produce a broken directive', () => {
  // Guards against "undefined" leaking into a system prompt if a caller slips
  // past the endpoint's allow-list.
  const directive = languageDirective('klingon');
  assert.ok(!directive.includes('undefined'), 'must never interpolate undefined into the prompt');
});

// ── Reason codes ──────────────────────────────────────────────────────────────

test('every confidence verdict carries a translatable code and params', () => {
  // Without these the operator reads an English paragraph under an Azerbaijani
  // heading — which is what the first pass at this shipped.
  const insufficient = assessRate(2, 4);
  assert.equal(insufficient.reasonCode, REASON.BELOW_MIN_SAMPLE);
  assert.deepEqual(insufficient.reasonParams, { n: 4, min: 30 });

  const directional = assessRate(50, 100);
  assert.equal(directional.reasonCode, REASON.INTERVAL_WIDE);
  assert.equal(directional.reasonParams.n, 100);
  assert.ok(directional.reasonParams.range.includes('%'));

  const sufficient = assessRate(500, 1000);
  assert.equal(sufficient.reasonCode, REASON.INTERVAL_TIGHT);

  assert.equal(assessCount(3).reasonCode, REASON.COUNT_TOO_FEW);
  assert.equal(assessCount(25).reasonCode, REASON.COUNT_ROUGH);
  assert.equal(assessCount(120).reasonCode, REASON.COUNT_FINE);

  assert.equal(assessChange(7, 20, 5, 20).reasonCode, REASON.CHANGE_INSUFFICIENT);
  assert.equal(assessChange(300, 1000, 100, 1000).reasonCode, REASON.CHANGE_SEPARATED);
  assert.equal(assessChange(52, 100, 48, 100).reasonCode, REASON.CHANGE_OVERLAPPING);
});

test('the English prose is still emitted alongside the code', () => {
  // The AI's prompt is English and reads `reason`; the code is additive, not a
  // replacement. Dropping the prose would silently starve the fact pack.
  const verdict = assessRate(2, 4);
  assert.equal(typeof verdict.reason, 'string');
  assert.ok(verdict.reason.length > 0);
});

// ── Rendering ─────────────────────────────────────────────────────────────────

test('a reason renders in the requested language', () => {
  const verdict = assessRate(2, 4);
  const en = renderReason('en', verdict);
  const az = renderReason('az', verdict);

  assert.match(en, /Only 4 observations/);
  assert.match(az, /Cəmi 4 müşahidə/);
  assert.notEqual(en, az);
});

test('stage ids inside params are translated, not left in English', () => {
  // The subtle one: an otherwise-Azerbaijani sentence with "Scanned a token"
  // embedded reads as broken. The warehouse passes ids precisely so this can
  // resolve them.
  const bottleneck = {
    reason: '"Registered" converts at the lowest rate…',
    reasonCode: 'bottleneck_found',
    reasonParams: { stage: 'registered', percent: '4.0' },
  };
  const az = renderReason('az', bottleneck);
  assert.match(az, /Qeydiyyatdan keçdi/, 'the stage id must resolve to its az label');
  assert.ok(!az.includes('Registered'), 'no English stage label may survive');
  assert.match(az, /4\.0/, 'the number must survive');

  assert.match(renderReason('en', bottleneck), /Registered/);
});

test('a missing code falls back to the server prose, never to blank', () => {
  // Older stored reports have no codes. A blank explanation next to a number
  // the operator is about to act on is worse than an English one.
  const legacy = { reason: 'Some older server explanation.' };
  assert.equal(renderReason('az', legacy), 'Some older server explanation.');
  assert.equal(renderReason('en', legacy), 'Some older server explanation.');
});

test('an unknown code falls back to the server prose', () => {
  const future = { reason: 'A reason added server-side but not yet translated.', reasonCode: 'not_yet_translated' };
  assert.equal(renderReason('az', future), 'A reason added server-side but not yet translated.');
});

test('renderReason on nothing at all is empty, not a crash', () => {
  assert.equal(renderReason('az', undefined), '');
  assert.equal(renderReason('az', {}), '');
});

test('renderNote handles the note/noteCode field names', () => {
  const health = { note: 'thin', noteCode: 'data_plane_thin' };
  assert.match(renderNote('az', health), /Growth Data Plane yeni yerləşdirilib/);
  assert.match(renderNote('en', health), /newly deployed/);
});

test('an unknown stage id keeps its raw value rather than rendering a key path', () => {
  const odd = { reasonCode: 'bottleneck_found', reasonParams: { stage: 'brand_new_stage', percent: '1.0' } };
  const rendered = renderReason('az', odd);
  assert.match(rendered, /brand_new_stage/, 'odd but truthful beats "funnel.stages.brand_new_stage"');
});

// ── Real producers ────────────────────────────────────────────────────────────
//
// The tests above build their verdicts by hand, which cannot catch the mistake
// this section exists for: the warehouse naming a param `label` while the
// template asks for `{stage}`. Both sides look correct in isolation and the
// operator reads a literal "{stage}" on the Funnel page. These drive the real
// producers instead, so the param contract is verified end to end.

const NOW = Date.parse('2026-07-15T12:00:00.000Z');
const evt = (type, fields = {}) => ({ id: `e${Math.random()}`, type, timestamp: new Date(NOW).toISOString(), ...fields });

// A placeholder that survives rendering means the producer and the dictionary
// disagree about a param's name.
function assertNoUnresolvedPlaceholders(rendered, what) {
  assert.ok(!/\{\w+\}/.test(rendered), `${what} left an unresolved placeholder: ${rendered}`);
}

test('a real bottleneck renders with no unresolved placeholders, in both languages', () => {
  const events = [];
  for (let i = 0; i < 400; i += 1) {
    events.push(evt('page_view', { visitorId: `v${i}` }));
    if (i < 320) events.push(evt('token_scan', { visitorId: `v${i}`, contract: 'c1' }));
    if (i < 8) events.push(evt('user_registered', { visitorId: `v${i}`, userId: `u${i}` }));
    if (i < 100) events.push(evt('pricing_view', { visitorId: `v${i}` }));
    if (i < 20) events.push(evt('checkout_started', { visitorId: `v${i}` }));
  }
  const bottleneck = findBottleneck(buildFunnel(events));
  assert.equal(bottleneck.stage, 'registered');

  const en = renderReason('en', bottleneck);
  const az = renderReason('az', bottleneck);
  assertNoUnresolvedPlaceholders(en, 'bottleneck_found (en)');
  assertNoUnresolvedPlaceholders(az, 'bottleneck_found (az)');

  assert.match(en, /Registered/);
  assert.match(az, /Qeydiyyatdan keçdi/, 'the stage must arrive as an id the console can translate');
  assert.ok(!az.includes('Registered'), 'no English stage label may survive into the az sentence');
});

test('a real instrumentation gap renders with no unresolved placeholders, in both languages', () => {
  const events = [];
  for (let i = 0; i < 400; i += 1) {
    events.push(evt('page_view', { visitorId: `v${i}` }));
    if (i < 320) events.push(evt('token_scan', { visitorId: `v${i}`, contract: 'c1' }));
    if (i < 40) events.push(evt('user_registered', { visitorId: `v${i}`, userId: `u${i}` }));
    // ...and not a single pricing_view.
  }
  const gap = findInstrumentationGaps(buildFunnel(events)).find((g) => g.stage === 'pricing');
  assert.ok(gap, 'the untracked step must be escalated');

  const en = renderReason('en', gap);
  const az = renderReason('az', gap);
  assertNoUnresolvedPlaceholders(en, 'instrumentation_gap (en)');
  assertNoUnresolvedPlaceholders(az, 'instrumentation_gap (az)');

  // Both stage names in the sentence must be translated, not just the subject.
  // The gap is at "pricing", so its upstream step is "registered".
  assert.match(az, /Qiymətlərə baxdı/, 'the gap stage must be translated');
  assert.match(az, /Qeydiyyatdan keçdi/, 'the upstream stage must be translated too');
  assert.ok(!/Registered|Viewed pricing/.test(az), 'no English stage label may survive into the az sentence');
  assert.match(az, /40/, 'the upstream count must survive');
});

test('every confidence verdict renders cleanly from the real engine', () => {
  const verdicts = [
    assessRate(2, 4), assessRate(50, 100), assessRate(500, 1000),
    assessCount(3), assessCount(25), assessCount(120),
    assessChange(7, 20, 5, 20), assessChange(300, 1000, 100, 1000), assessChange(52, 100, 48, 100),
  ];
  for (const verdict of verdicts) {
    for (const lang of ['en', 'az']) {
      const rendered = renderReason(lang, verdict);
      assertNoUnresolvedPlaceholders(rendered, `${verdict.reasonCode} (${lang})`);
      assert.ok(rendered.length > 0, `${verdict.reasonCode} (${lang}) rendered empty`);
    }
  }
});
