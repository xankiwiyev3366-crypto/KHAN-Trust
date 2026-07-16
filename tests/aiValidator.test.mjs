// Tests for the numeric grounding validator.
//
// The scenario each test encodes is a real LLM failure mode, not a hypothetical.
// A fluent invented statistic is the single most dangerous output this system
// could produce, because it is indistinguishable from a real one at a glance
// and it shapes decisions.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectSourceNumbers, findUnverifiedNumbers, rejectFabricatedFindings,
} from '../netlify/functions/_aiValidator.mjs';

test('a fabricated industry benchmark is caught', () => {
  // THE case this module exists for. Both numbers are inventions; the sentence
  // is fluent and decision-shaping.
  const facts = { activationRate: 0.0316, visitors: 400 };
  const numbers = collectSourceNumbers(facts);
  const offenders = findUnverifiedNumbers(
    'Your 3.2% activation rate is well below the 8.5% industry benchmark.',
    numbers
  );
  assert.ok(offenders.includes(8.5), 'the invented benchmark must be caught');
  assert.ok(!offenders.includes(3.2), 'the real rate, reformatted as a percent, must be accepted');
});

test('legitimate reformatting of a source number is accepted', () => {
  // The model is given 0.0316 and writes "3.2%". Rejecting that would make the
  // validator unusable, and an unusable validator gets switched off.
  const numbers = collectSourceNumbers({ rate: 0.0316 });
  assert.deepEqual(findUnverifiedNumbers('The rate is 3.2%.', numbers), []);
  assert.deepEqual(findUnverifiedNumbers('The rate is 0.032.', numbers), []);
});

test('numbers nested anywhere in the source facts are found', () => {
  const facts = {
    funnel: { stages: [{ label: 'Scanned', count: 320, rate: { value: 0.8 } }] },
    note: 'derived from 400 visitors',
  };
  const numbers = collectSourceNumbers(facts);
  assert.deepEqual(findUnverifiedNumbers('320 of 400 visitors scanned, or 80%.', numbers), []);
});

test('ordinals and small counts are never challenged', () => {
  const numbers = collectSourceNumbers({});
  assert.deepEqual(
    findUnverifiedNumbers('There are 3 steps and 2 channels; this is priority 1.', numbers),
    []
  );
});

test('years are never challenged', () => {
  const numbers = collectSourceNumbers({});
  assert.deepEqual(findUnverifiedNumbers('Since 2026 the trend held.', numbers), []);
});

test('rejectFabricatedFindings drops the bad finding and keeps the good one', () => {
  const facts = { signups: 115, visitors: 400 };
  const findings = [
    { title: 'Real', reasoning: 'Only 115 of 400 visitors registered.' },
    { title: 'Invented', reasoning: 'Competitors convert at 22.5%, far above yours.' },
  ];

  const { kept, rejected } = rejectFabricatedFindings(findings, facts, ['title', 'reasoning']);

  assert.equal(kept.length, 1);
  assert.equal(kept[0].title, 'Real');
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].finding.title, 'Invented');
  assert.ok(rejected[0].unverifiedNumbers.includes(22.5));
  assert.match(rejected[0].reason, /fabricated/i);
});

test('rejections are reported, not silently swallowed', () => {
  // A model that starts fabricating is a regression worth seeing. Hiding the
  // rejection would hide it.
  const { rejected } = rejectFabricatedFindings(
    [{ title: 'X', reasoning: 'Churn is 47.3% this quarter.' }],
    { churn: null },
    ['title', 'reasoning']
  );
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0].reason.length > 0);
});

// ── Azerbaijani number formatting ────────────────────────────────────────────
//
// Once the analysts write in Azerbaijani they write 3,2% rather than 3.2%. A
// period-only parser turns that into the integers 3 and 2, and a legitimate
// figure like 22,5 becomes an unverifiable "22" — deleting a correct finding.
// The validator must not punish correct Azerbaijani.

test('an Azerbaijani comma-decimal traced to source is accepted', () => {
  const numbers = collectSourceNumbers({ rate: 0.225, visitors: 400 });
  // "22,5%" is the az rendering of the source proportion 0.225.
  assert.deepEqual(findUnverifiedNumbers('Nisbət 22,5% təşkil edir.', numbers), []);
});

test('a fabricated comma-decimal is STILL caught', () => {
  // The comma tolerance must not become a hole to smuggle invented stats through.
  const numbers = collectSourceNumbers({ rate: 0.0316 });
  const offenders = findUnverifiedNumbers('Sənaye ortalaması 8,5%-dir.', numbers);
  assert.ok(offenders.includes(8.5), 'an invented az-formatted benchmark must still be caught');
});

test('an English thousands separator is not mistaken for a decimal', () => {
  // "1,234" groups three digits — a thousands separator, not a decimal. If it
  // were rewritten to 1.234 the real value 1234 would look unverifiable.
  const numbers = collectSourceNumbers({ visitors: 1234 });
  assert.deepEqual(findUnverifiedNumbers('There were 1,234 visitors.', numbers), []);
});

test('mixed az prose and code identifiers validate correctly', () => {
  const numbers = collectSourceNumbers({ failures: 7, rate: 0.075 });
  assert.deepEqual(
    findUnverifiedNumbers('wallet_required 7 dəfə baş verdi, yəni 7,5% hal.', numbers),
    []
  );
});

test('a finding with no numbers at all passes', () => {
  const { kept, rejected } = rejectFabricatedFindings(
    [{ title: 'Publish more', reasoning: 'The channel has no content yet.' }],
    {},
    ['title', 'reasoning']
  );
  assert.equal(kept.length, 1);
  assert.equal(rejected.length, 0);
});
