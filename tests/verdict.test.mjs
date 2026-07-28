// The verdict must never contradict the evidence rendered beneath it, in
// either direction. The softening direction fixes the observed production bug
// (BONK: "High Risk" headline over a 0/100 scam score and eight Low factors);
// the hardening direction is the safety property that must survive it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveVerdict, hasCleanEvidence, hasHighSeverityEvidence, RISK } from '../src/lib/verdict.js';

const sev = (key) => ({ washTrade: 'high', thinLiquidity: 'medium', noGithub: 'low' }[key] || 'medium');

const CLEAN = { scamRisk: { level: RISK.LOW, riskScore: 0 }, riskFactors: [{ severity: 'Low' }, { severity: 'Low' }], hiddenRiskSignalKeys: [], severityForSignalKey: sev };

test('softening: a High headline over affirmatively clean evidence resolves to Medium', () => {
  const out = resolveVerdict({ scoreLevel: RISK.HIGH, ...CLEAN });
  assert.equal(out.riskLevel, RISK.MEDIUM);
  assert.equal(out.adjusted, true);
  assert.equal(out.reason, 'cleanEvidence');
});

test('softening never reaches Low — clean checks do not make a capped asset safe', () => {
  const out = resolveVerdict({ scoreLevel: RISK.HIGH, ...CLEAN, speculativeCeiling: true });
  assert.equal(out.riskLevel, RISK.MEDIUM, 'must stop at Medium, never claim Low');
});

test('hardening: a High scam verdict forces a High headline whatever the score says', () => {
  const out = resolveVerdict({
    scoreLevel: RISK.LOW,
    scamRisk: { level: RISK.HIGH, riskScore: 70 },
    riskFactors: [],
    severityForSignalKey: sev,
  });
  assert.equal(out.riskLevel, RISK.HIGH);
  assert.equal(out.adjusted, true);
  assert.equal(out.reason, 'scamRiskHigh');
});

test('hardening: a confirmed high-severity factor can never sit under a Low headline', () => {
  const out = resolveVerdict({
    scoreLevel: RISK.LOW,
    scamRisk: { level: RISK.LOW },
    riskFactors: [{ severity: 'High' }],
    severityForSignalKey: sev,
  });
  assert.equal(out.riskLevel, RISK.MEDIUM);
  assert.equal(out.reason, 'highSeverityEvidence');
});

test('hardening: a high-severity hidden signal also blocks a Low headline', () => {
  const out = resolveVerdict({
    scoreLevel: RISK.LOW,
    scamRisk: { level: RISK.LOW },
    riskFactors: [],
    hiddenRiskSignalKeys: ['washTrade'],
    severityForSignalKey: sev,
  });
  assert.equal(out.riskLevel, RISK.MEDIUM);
});

test('hardening takes precedence over softening when both could apply', () => {
  // High score-level AND a high-severity signal: the guard must not soften.
  const out = resolveVerdict({
    scoreLevel: RISK.HIGH,
    scamRisk: { level: RISK.LOW },
    riskFactors: [{ severity: 'High' }],
    severityForSignalKey: sev,
  });
  assert.equal(out.riskLevel, RISK.HIGH, 'a real warning is never talked down');
});

test('a speculative asset never presents as Low Risk', () => {
  const out = resolveVerdict({ scoreLevel: RISK.LOW, ...CLEAN, speculativeCeiling: true });
  assert.equal(out.riskLevel, RISK.MEDIUM);
  assert.equal(out.reason, 'speculativeFloor');
});

test('a non-speculative asset with a genuinely low-risk score keeps its Low verdict', () => {
  const out = resolveVerdict({ scoreLevel: RISK.LOW, ...CLEAN });
  assert.equal(out.riskLevel, RISK.LOW);
  assert.equal(out.adjusted, false);
});

test('hasCleanEvidence: absence of high severity is NOT the same as an all-clear', () => {
  // No high-severity findings, but the scam model never returned Low.
  assert.equal(hasCleanEvidence({ scamRisk: null, riskFactors: [] }), false);
  assert.equal(hasCleanEvidence({ scamRisk: { level: RISK.MEDIUM }, riskFactors: [] }), false);
  // An outstanding Medium factor is not clean either.
  assert.equal(hasCleanEvidence({ scamRisk: { level: RISK.LOW }, riskFactors: [{ severity: 'Medium' }] }), false);
  assert.equal(hasCleanEvidence({ scamRisk: { level: RISK.LOW }, riskFactors: [{ severity: 'Low' }] }), true);
});

test('hasHighSeverityEvidence: a data gap is not a warning', () => {
  // "Limited"/unknown severities must not read as confirmed danger.
  assert.equal(hasHighSeverityEvidence({ scamRisk: { level: RISK.LOW }, riskFactors: [{ severity: 'Limited' }] }), false);
  assert.equal(hasHighSeverityEvidence({ scamRisk: { level: RISK.LOW }, riskFactors: [{ severity: 'High' }] }), true);
});

test('the resolver is total — missing inputs never throw', () => {
  assert.doesNotThrow(() => resolveVerdict());
  assert.doesNotThrow(() => resolveVerdict({}));
  assert.equal(resolveVerdict({}).riskLevel, RISK.MEDIUM);
});
