// SINGLE SOURCE OF TRUTH for the headline risk verdict.
//
// WHY THIS EXISTS
//
// The headline risk label and the evidence beneath it were derived
// independently: the label came from `scoreToRisk(trustScore)`, while the scam
// probability, the per-factor severities and the hidden-risk signals were each
// computed from the raw data by different functions. Nothing checked that they
// agreed, and on production they routinely did not. A real scan of BONK showed,
// on one screen:
//
//     Headline .................. HIGH RISK
//     Scam Risk Indicators ...... Low, 0/100 ("no indicators were found")
//     Simple Risk Summary ....... 8 of 10 factors "Low", none "High"
//     Trust Score by Category ... 18/20, 18/20, 18/20, 14/20, 13/20
//
// A user reading that concludes the tool is broken — and they are right to.
// A risk product that contradicts itself in one viewport has no remaining
// claim on anyone's trust, and no amount of depth sold on top of it recovers.
//
// So the verdict is no longer READ from the score. It is RESOLVED here, from
// the score AND the evidence together, and it is the only value the UI renders.
//
// THIS GUARD CUTS BOTH WAYS, AND THE SECOND DIRECTION IS THE IMPORTANT ONE
//
// Softening a verdict that the evidence does not support is the fix for the
// bug above. But a guard that could ONLY soften would itself be a safety
// defect: it would quietly talk down warnings on genuinely dangerous tokens,
// which is the one failure this product must never have. So the hardening
// direction is enforced first and unconditionally — a confirmed high-severity
// signal can never be presented under a "Low Risk" headline, whatever the
// numeric score says.
//
// This file must stay PURE — no import.meta.env, no Node/Vite-only APIs — so it
// bundles into a Netlify Function and into the Vite client alike. Same
// cross-boundary contract as src/lib/pricing.js and src/lib/features.js.

export const RISK = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High' };

const RANK = { Low: 0, Medium: 1, High: 2 };

function rank(level) {
  return RANK[level] ?? RANK.Medium;
}

function levelAtLeast(level, floor) {
  return rank(level) >= rank(floor) ? level : floor;
}

// Does the evidence contain anything a user would recognise as a serious,
// confirmed warning? Only CONFIRMED severity counts — "we could not determine
// this" is not a warning, it is a gap, and gaps are reported as low confidence
// rather than as danger.
export function hasHighSeverityEvidence({ scamRisk, riskFactors = [], hiddenRiskSignalKeys = [], severityForSignalKey } = {}) {
  if (scamRisk?.level === RISK.HIGH) return true;
  if (riskFactors.some((factor) => factor?.severity === RISK.HIGH)) return true;
  if (typeof severityForSignalKey === 'function') {
    if (hiddenRiskSignalKeys.some((key) => severityForSignalKey(key) === 'high')) return true;
  }
  return false;
}

// The inverse: is the evidence affirmatively clean? Note this is NOT
// `!hasHighSeverityEvidence` — an absence of high-severity findings is not the
// same as a positive all-clear. This requires the scam model to have actually
// run and returned Low, and no medium-or-worse factor to be outstanding.
export function hasCleanEvidence({ scamRisk, riskFactors = [], hiddenRiskSignalKeys = [], severityForSignalKey } = {}) {
  if (!scamRisk || scamRisk.level !== RISK.LOW) return false;
  if (riskFactors.some((factor) => factor?.severity === RISK.HIGH || factor?.severity === RISK.MEDIUM)) return false;
  if (typeof severityForSignalKey === 'function') {
    if (hiddenRiskSignalKeys.some((key) => severityForSignalKey(key) === 'high')) return false;
  }
  return true;
}

// THE resolver. `scoreLevel` is what the numeric score alone implies; the
// returned `riskLevel` is what the product actually says.
//
// `speculativeCeiling` is passed when an asset-type ceiling is in force (a
// memecoin). It is why the clean-evidence path stops at Medium and never
// reaches Low: a token whose score is held down by an asset-class ceiling is
// not low-risk just because its individual checks came back clean. Saying
// "Low Risk" over a memecoin would be the same category of lie as the original
// bug, pointed the other way.
export function resolveVerdict({
  scoreLevel,
  scamRisk = null,
  riskFactors = [],
  hiddenRiskSignalKeys = [],
  severityForSignalKey = null,
  speculativeCeiling = false,
} = {}) {
  const evidence = { scamRisk, riskFactors, hiddenRiskSignalKeys, severityForSignalKey };
  const base = scoreLevel || RISK.MEDIUM;

  // 1. HARDENING — runs first and is never overridden. A confirmed
  //    high-severity finding always carries at least a Medium headline, and a
  //    High scam verdict always carries a High headline.
  if (scamRisk?.level === RISK.HIGH) {
    return { riskLevel: RISK.HIGH, adjusted: base !== RISK.HIGH, reason: 'scamRiskHigh' };
  }
  if (hasHighSeverityEvidence(evidence)) {
    const hardened = levelAtLeast(base, RISK.MEDIUM);
    return { riskLevel: hardened, adjusted: hardened !== base, reason: 'highSeverityEvidence' };
  }

  // 2. SOFTENING — a High headline over affirmatively clean evidence is the
  //    self-contradiction this module exists to prevent. Resolve to Medium,
  //    never to Low: the score is still low for a reason (usually an
  //    asset-class ceiling), and Medium is the honest reading of "nothing
  //    alarming found, but this is not a safe asset".
  if (base === RISK.HIGH && hasCleanEvidence(evidence)) {
    return { riskLevel: RISK.MEDIUM, adjusted: true, reason: 'cleanEvidence' };
  }

  // 3. A speculative asset never presents as Low Risk regardless of score.
  //    The ceiling band tops out at 82, above scoreToRisk's Low threshold, so
  //    the strongest memecoins would otherwise be labelled "Low Risk" — which
  //    is precisely the claim the asset-type ceiling exists to prevent.
  if (speculativeCeiling) {
    const floored = levelAtLeast(base, RISK.MEDIUM);
    return { riskLevel: floored, adjusted: floored !== base, reason: floored !== base ? 'speculativeFloor' : null };
  }

  return { riskLevel: base, adjusted: false, reason: null };
}
