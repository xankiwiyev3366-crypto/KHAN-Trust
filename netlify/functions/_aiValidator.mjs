// Numeric grounding: rejects statistics the model made up.
//
// WHY A PROMPT IS NOT ENOUGH
//
// "Only use numbers from the data provided" is an instruction, and instructions
// are followed probabilistically. This system's single hardest requirement is
// that it never fabricates business data, and a requirement that important
// cannot rest on the model choosing to comply. So every number the model emits
// is checked against the numbers it was actually given, mechanically, and a
// finding carrying an unverifiable statistic is dropped before it can ever
// reach the operator's screen.
//
// The failure this prevents is specific and dangerous: an LLM asked to analyse
// a thin funnel will confidently write "your 3.2% activation rate is below the
// 8% industry benchmark" — a fluent, plausible, decision-shaping sentence in
// which BOTH numbers are inventions. The operator has no way to tell that from
// a real finding. This module does.

// Numbers that are never statistics, so never worth challenging:
//   - 0..10 — ordinals, counts, priorities, "3 steps", "the 2 channels"
//   - years — "2026"
// Everything else must be traceable to the source facts.
const TRIVIAL_MAX = 10;

function isTrivial(value) {
  return (Number.isInteger(value) && value >= 0 && value <= TRIVIAL_MAX)
    || (Number.isInteger(value) && value >= 2000 && value <= 2100);
}

// Walks any structure and collects every number the model was actually shown.
//
// Also records common RENDERINGS of each number, because the model legitimately
// reformats what it is given: a rate of 0.0316 shown in the facts is quite
// reasonably written as "3.2%". Refusing that would make the validator
// unusable and it would be switched off - which is worse than a slightly
// permissive check. Rounding to 1 and 2 decimal places, and the percent form,
// are all accepted for any source number.
export function collectSourceNumbers(value, out = new Set()) {
  if (value === null || value === undefined) return out;

  if (typeof value === 'number' && Number.isFinite(value)) {
    out.add(round(value, 4));
    out.add(round(value, 2));
    out.add(round(value, 1));
    out.add(Math.round(value));
    // Percent renderings of a proportion.
    const asPercent = value * 100;
    out.add(round(asPercent, 2));
    out.add(round(asPercent, 1));
    out.add(Math.round(asPercent));
    return out;
  }

  if (typeof value === 'string') {
    for (const match of value.matchAll(/-?\d+(?:\.\d+)?/g)) {
      const parsed = Number(match[0]);
      if (Number.isFinite(parsed)) collectSourceNumbers(parsed, out);
    }
    return out;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectSourceNumbers(item, out);
    return out;
  }

  if (typeof value === 'object') {
    for (const item of Object.values(value)) collectSourceNumbers(item, out);
    return out;
  }

  return out;
}

function round(value, places) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

// Returns every number in `text` that cannot be traced to the source facts.
export function findUnverifiedNumbers(text, sourceNumbers) {
  if (typeof text !== 'string') return [];

  const offenders = [];
  for (const match of text.matchAll(/-?\d+(?:\.\d+)?/g)) {
    const value = Number(match[0]);
    if (!Number.isFinite(value) || isTrivial(value)) continue;

    const candidates = [
      round(value, 4), round(value, 2), round(value, 1), Math.round(value),
      // ...and the inverse of the percent rendering, so a model writing "3.2%"
      // matches a source proportion of 0.032.
      round(value / 100, 4), round(value / 100, 2),
    ];

    if (!candidates.some((candidate) => sourceNumbers.has(candidate))) {
      offenders.push(value);
    }
  }
  return offenders;
}

// Validates a list of model-authored findings against the facts it was given.
//
// Returns the surviving findings plus a rejection record. Rejections are
// surfaced to the operator rather than silently swallowed: a model that starts
// fabricating is a signal worth seeing, and hiding the rejection would hide a
// regression in the prompt or the model.
export function rejectFabricatedFindings(findings, sourceFacts, textFields) {
  const sourceNumbers = collectSourceNumbers(sourceFacts);
  const kept = [];
  const rejected = [];

  for (const finding of findings) {
    const offenders = [];
    for (const field of textFields) {
      offenders.push(...findUnverifiedNumbers(finding[field], sourceNumbers));
    }

    if (offenders.length) {
      rejected.push({
        finding,
        reason: `Dropped: cites ${offenders.map((n) => JSON.stringify(n)).join(', ')}, which do not appear in the source metrics. Treated as fabricated.`,
        unverifiedNumbers: offenders,
      });
    } else {
      kept.push(finding);
    }
  }

  return { kept, rejected };
}
