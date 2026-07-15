// The Confidence Engine — the Growth OS's defence against its own conclusions.
//
// WHY THIS IS THE MOST IMPORTANT MODULE IN THE SYSTEM
//
// KHAN Trust has ~115 registered users. At that scale almost every rate the
// platform can compute is statistically indistinguishable from noise. If two of
// four visitors sign up, "50% conversion" is arithmetically true and completely
// meaningless — the real interval spans roughly 15%-85%. A dashboard that
// prints "50%" invites the operator to make a decision on nothing, and an LLM
// handed "50%" will confidently explain WHY it is 50% and what to do about it.
// That is precisely the fabricated-insight failure this system must not have.
//
// So no rate leaves the warehouse as a bare number. Every one is wrapped with a
// verdict about whether it can be believed at all, computed from its actual
// sample size — and the AI layer is contractually forbidden from reasoning over
// anything marked `insufficient` (see _growthAnalyst.mjs).
//
// This does not make the platform's numbers better. It makes them HONEST, which
// at this stage is worth considerably more.

// Wilson score interval, used instead of the textbook normal approximation
// (p ± z·√(p(1-p)/n)) because the normal approximation is actively wrong at
// exactly the sample sizes this platform has: it produces impossible bounds
// (below 0 / above 1) and collapses to a nonsense zero-width interval when
// p = 0 or p = 1 — i.e. it would report "0% conversion, ±0%" from three
// visitors and none of them converting. Wilson stays correct for small n and
// for extreme proportions, which is the normal case here, not the edge case.
export function wilsonInterval(successes, total, z = 1.96) {
  if (!total || total <= 0) return { low: 0, high: 1, width: 1 };

  const p = successes / total;
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const centre = (p + z2 / (2 * total)) / denominator;
  const margin = (z / denominator) * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total));

  const low = Math.max(0, centre - margin);
  const high = Math.min(1, centre + margin);
  return { low, high, width: high - low };
}

// Thresholds. These are judgement calls, stated explicitly so they can be
// argued with rather than buried:
//
//   n < 30            -> insufficient. Below ~30 observations nothing about a
//                        proportion is knowable; this is the conventional floor
//                        and the platform is currently under it for most rates.
//   interval <= 20pp  -> directional. Wide, but the DIRECTION is probably real.
//                        Good enough to prioritise work, never to claim a win.
//   interval <= 10pp  -> sufficient. Roughly the ±5% margin that survey work
//                        treats as reportable (~n=384 at p≈0.5).
//
// Judging by interval WIDTH rather than n alone is deliberate: 50 conversions
// out of 100 is far less certain than 1 out of 100, even though n is identical.
// Width captures that; a bare sample-size cutoff does not.
const MIN_SAMPLE = 30;
const SUFFICIENT_WIDTH = 0.10;
const DIRECTIONAL_WIDTH = 0.20;

export const CONFIDENCE = {
  SUFFICIENT: 'sufficient',
  DIRECTIONAL: 'directional',
  INSUFFICIENT: 'insufficient',
};

// Assesses a RATE (a proportion: successes out of total).
export function assessRate(successes, total) {
  if (!total || total < MIN_SAMPLE) {
    return {
      level: CONFIDENCE.INSUFFICIENT,
      sampleSize: total || 0,
      reason: `Only ${total || 0} observations — below the ${MIN_SAMPLE} needed before a rate means anything. Not enough data to act on.`,
      interval: null,
    };
  }

  const interval = wilsonInterval(successes, total);
  const asPercent = (value) => `${(value * 100).toFixed(1)}%`;
  const range = `${asPercent(interval.low)}–${asPercent(interval.high)}`;

  if (interval.width <= SUFFICIENT_WIDTH) {
    return {
      level: CONFIDENCE.SUFFICIENT,
      sampleSize: total,
      reason: `n=${total}. True value is very likely within ${range}. Reliable enough to decide on.`,
      interval,
    };
  }

  if (interval.width <= DIRECTIONAL_WIDTH) {
    return {
      level: CONFIDENCE.DIRECTIONAL,
      sampleSize: total,
      reason: `n=${total}. True value is somewhere in ${range} — wide, so treat the direction as real but the exact figure as provisional.`,
      interval,
    };
  }

  return {
    level: CONFIDENCE.INSUFFICIENT,
    sampleSize: total,
    reason: `n=${total}. The true value could be anywhere in ${range} — too wide to support any conclusion.`,
    interval,
  };
}

// Assesses a COUNT (a raw total: scans, signups, page views).
//
// Counts need a different rule from rates. A count has no denominator, so there
// is no interval to compute — but a count of 3 is still not something to build a
// strategy on. The thresholds are lower than for rates because a count is a
// direct observation rather than an inference: 40 signups IS 40 signups.
export function assessCount(count, { minMeaningful = 10, minReliable = 50 } = {}) {
  if (count < minMeaningful) {
    return {
      level: CONFIDENCE.INSUFFICIENT,
      sampleSize: count,
      reason: `Only ${count} recorded — too few to read a pattern into.`,
      interval: null,
    };
  }
  if (count < minReliable) {
    return {
      level: CONFIDENCE.DIRECTIONAL,
      sampleSize: count,
      reason: `${count} recorded — enough to see a rough shape, not enough to be precise.`,
      interval: null,
    };
  }
  return {
    level: CONFIDENCE.SUFFICIENT,
    sampleSize: count,
    reason: `${count} recorded.`,
    interval: null,
  };
}

// Assesses whether a CHANGE between two periods is real or just noise.
//
// This exists because "signups are up 40% this week!" is the single most
// common way an early-stage dashboard lies to its owner. Going from 5 to 7
// signups IS +40% and is also completely consistent with nothing whatsoever
// having changed. Two non-overlapping Wilson intervals is a conservative, easy
// to explain test for a real difference.
export function assessChange(currentSuccesses, currentTotal, previousSuccesses, previousTotal) {
  const current = assessRate(currentSuccesses, currentTotal);
  const previous = assessRate(previousSuccesses, previousTotal);

  if (current.level === CONFIDENCE.INSUFFICIENT || previous.level === CONFIDENCE.INSUFFICIENT) {
    return {
      significant: false,
      level: CONFIDENCE.INSUFFICIENT,
      reason: 'One or both periods have too little data to compare. Any percentage change between them is noise.',
    };
  }

  const separated = current.interval.low > previous.interval.high
    || current.interval.high < previous.interval.low;

  return {
    significant: separated,
    level: separated ? CONFIDENCE.SUFFICIENT : CONFIDENCE.DIRECTIONAL,
    reason: separated
      ? 'The two periods\' confidence intervals do not overlap — this change is real, not noise.'
      : 'The two periods\' confidence intervals overlap — this apparent change is consistent with random variation.',
  };
}

// Wraps a value with its verdict. Every warehouse metric returns one of these,
// so a consumer physically cannot receive a number without its standing.
export function metric(value, confidence, extra = {}) {
  return { value, confidence, ...extra };
}

export function isTrustworthy(confidence) {
  return confidence?.level === CONFIDENCE.SUFFICIENT || confidence?.level === CONFIDENCE.DIRECTIONAL;
}
