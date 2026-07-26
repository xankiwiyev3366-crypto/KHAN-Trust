// Trust Movers — the pure intelligence core.
//
// This module turns a set of {current, previous} Trust Score observations into
// the four ranked Trust Movers sections. It is PURE (no DB, no fetch, no i18n,
// no React) and lives in src/lib/ so BOTH the Netlify Function
// (_trustMoversStore.mjs) and any future client can import it — the same
// cross-boundary rule that governs trustScore.js and snapshotDiff.js.
//
// GROUNDED EXPLANATIONS, NEVER GENERIC AI TEXT
//
// The "why the score changed" line is not an LLM guess. It is derived from the
// SAME structured change detector the risk timeline and the alert lane use —
// diffSnapshots() in snapshotDiff.js — so every reason a card shows is backed by
// a real, measured movement in a specific score component (liquidity, holder
// concentration, contract security, social, market activity). If no component
// change is detectable, the card falls back to the literal score delta, which is
// itself a fact. It never invents a cause.
//
// NEVER INVENT HISTORY
//
// A token with no snapshot before the selected period has previous === null.
// Such a token can only ever appear in the "new" sections (first high-confidence
// / first high-risk observation); it is never given a fabricated previous score
// or a made-up delta. Missing history is surfaced honestly by the caller as
// "Not enough historical data yet."
import { diffSnapshots } from './snapshotDiff.js';
import { scoreToRisk } from './trustScore.js';

// The four supported windows and their length in days. observed_date is a daily
// series (one point per token per UTC day), so a window is a whole number of
// days back from today.
export const PERIODS = {
  '24H': 1,
  '7D': 7,
  '30D': 30,
  '90D': 90,
};

export const DEFAULT_PERIOD = '7D';

export function isValidPeriod(period) {
  return Object.prototype.hasOwnProperty.call(PERIODS, period);
}

export function periodDays(period) {
  return PERIODS[period] ?? PERIODS[DEFAULT_PERIOD];
}

// The four section keys, in display order.
export const SECTIONS = ['rising', 'falling', 'newHighConfidence', 'newlyHighRisk'];

// ── Thresholds (documented, aligned with the scorer's own risk boundaries) ────
// A "mover" must have moved at least this many points to make the rising/falling
// lists — below this is day-to-day jitter, not a story worth surfacing.
const MIN_MOVE = 1;
// "High confidence" = the scorer's Low-risk band (score ≥ 78, see scoreToRisk)
// AND a confidence stamp of at least this. Both must hold: a high score computed
// on thin data is not a high-CONFIDENCE project.
const HIGH_CONFIDENCE_MIN = 70;
// How many grounded reasons a single card shows at most (strongest first).
const MAX_REASONS = 3;

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// Signed percentage change, or null when it cannot be honestly computed (no
// previous, or a zero/absent baseline that would divide by zero).
export function percentChange(previousScore, currentScore) {
  const prev = num(previousScore);
  const curr = num(currentScore);
  if (prev === null || curr === null || prev <= 0) return null;
  return Math.round(((curr - prev) / prev) * 1000) / 10; // one decimal place
}

// 'up' | 'down' | 'flat' from a signed delta; 'new' when there is no baseline.
export function trendOf(absoluteChange) {
  if (absoluteChange === null || absoluteChange === undefined) return 'new';
  if (absoluteChange > 0) return 'up';
  if (absoluteChange < 0) return 'down';
  return 'flat';
}

// Whether a snapshot qualifies as a high-confidence project on its own terms.
function isHighConfidence(snapshot) {
  const score = num(snapshot?.score);
  const confidence = num(snapshot?.confidence);
  if (score === null) return false;
  return scoreToRisk(score) === 'Low' && confidence !== null && confidence >= HIGH_CONFIDENCE_MIN;
}

function isHighRisk(snapshot) {
  const score = num(snapshot?.score);
  if (score === null) return false;
  // Prefer the stored level, fall back to deriving it from the score so a row
  // with a null risk_level is still classified honestly.
  return (snapshot.riskLevel || scoreToRisk(score)) === 'High';
}

// ── Grounded reason wording ───────────────────────────────────────────────────
// Maps one structured change (from diffSnapshots) to a short, factual phrase.
// `worse` is the change detector's own risk-direction flag, so the wording can
// never contradict the colour of the card.
function reasonFor(change) {
  switch (change.key) {
    case 'liquidity':
      return change.worse ? 'Liquidity decreased' : 'Liquidity increased';
    case 'holderConcentration':
      return change.worse ? 'Large holder accumulation detected' : 'Holder concentration improved';
    case 'contractSecurity':
      return change.worse ? 'Contract risk increased' : 'Contract risk decreased';
    case 'social':
      return change.worse ? 'Social verification weakened' : 'Social verification improved';
    case 'marketActivity':
      return change.worse ? 'Trading activity became suspicious' : 'Trading activity strengthened';
    case 'holderHealth':
      return change.worse ? 'Holder health weakened' : 'Holder health improved';
    case 'community':
      return change.worse ? 'Community signals weakened' : 'Community signals strengthened';
    default:
      return null;
  }
}

// Comparable magnitude for ranking reasons. Liquidity carries a `percent` swing;
// everything else is a point delta. Both land on a roughly 0-100 scale.
function changeMagnitude(change) {
  if (change.unit === 'percent') return Math.abs(num(change.percent) ?? 0);
  return Math.abs(num(change.delta) ?? 0);
}

// The grounded "why" for one mover. Returns an ordered list of short phrases,
// strongest movement first, capped at MAX_REASONS. Derived entirely from
// diffSnapshots — real component deltas — with a factual score-delta fallback so
// a card is never left with an empty explanation when the score genuinely moved
// but no single component crossed its own threshold.
export function explainMovement(previous, current) {
  if (!previous || !current) return [];
  const changes = diffSnapshots(previous, current)
    // The trustScore change is the headline number already shown on the card;
    // the explanation is about the components BEHIND it.
    .filter((change) => change.key !== 'trustScore')
    // Strongest movement first. Liquidity is reported as a percentage swing while
    // every other component is in points, so normalise to a comparable 0-100-ish
    // magnitude before ranking — otherwise a raw liquidity RATIO (~1.0) always
    // loses to point deltas and gets cut by the reason cap.
    .sort((a, b) => changeMagnitude(b) - changeMagnitude(a));

  const reasons = [];
  for (const change of changes) {
    const text = reasonFor(change);
    if (text && !reasons.includes(text)) reasons.push(text);
    if (reasons.length >= MAX_REASONS) break;
  }

  if (reasons.length) return reasons;

  // Fallback: no component crossed its threshold, but the score itself moved.
  // Stating that literal movement is grounded — it is the observed fact — and is
  // never a fabricated cause.
  const prevScore = num(previous.score);
  const currScore = num(current.score);
  if (prevScore !== null && currScore !== null && prevScore !== currScore) {
    const delta = currScore - prevScore;
    const points = Math.abs(Math.round(delta));
    return [delta > 0 ? `Trust Score rose ${points} pts` : `Trust Score fell ${points} pts`];
  }
  return [];
}

// ── Movement object ───────────────────────────────────────────────────────────
// Builds the full, UI-ready mover object for one token from its row. Pure and
// total: a null `previous` yields null deltas and a 'new' trend, never a guess.
export function toMovement(row) {
  const current = row.current || null;
  const previous = row.previous || null;
  const currentScore = num(current?.score);
  const previousScore = num(previous?.score);
  const absoluteChange = (currentScore !== null && previousScore !== null)
    ? Math.round(currentScore - previousScore)
    : null;

  return {
    identity: row.identity,
    name: row.name || row.ticker || row.identity,
    ticker: row.ticker || '',
    chain: row.chain || '',
    contract: row.contract || '',
    currentScore,
    previousScore,
    absoluteChange,
    percentChange: percentChange(previousScore, currentScore),
    trend: trendOf(absoluteChange),
    riskLevel: current?.riskLevel || (currentScore !== null ? scoreToRisk(currentScore) : null),
    previousRiskLevel: previous?.riskLevel || (previousScore !== null ? scoreToRisk(previousScore) : null),
    confidence: num(current?.confidence),
    lastUpdated: row.lastUpdated || current?.date || null,
    reasons: explainMovement(previous, current),
  };
}

// Deterministic ordering. Primary: magnitude of the absolute score change
// (largest movement first — the product's core promise). Ties broken by
// magnitude of percentage change, then by most-recent update, then by identity
// so the order is fully stable and reproducible (important for caching and for
// tests). Rows without an absolute change sort last.
function byMovementDesc(a, b) {
  const am = a.absoluteChange === null ? -1 : Math.abs(a.absoluteChange);
  const bm = b.absoluteChange === null ? -1 : Math.abs(b.absoluteChange);
  if (bm !== am) return bm - am;
  const ap = a.percentChange === null ? -1 : Math.abs(a.percentChange);
  const bp = b.percentChange === null ? -1 : Math.abs(b.percentChange);
  if (bp !== ap) return bp - ap;
  const at = a.lastUpdated || '';
  const bt = b.lastUpdated || '';
  if (bt !== at) return String(bt).localeCompare(String(at));
  return String(a.identity).localeCompare(String(b.identity));
}

// For the "new" sections, rank by current score (highest confidence / clearest
// signal first), then recency, then identity.
function byCurrentScore(direction) {
  return (a, b) => {
    const as = a.currentScore === null ? -1 : a.currentScore;
    const bs = b.currentScore === null ? -1 : b.currentScore;
    if (bs !== as) return direction === 'desc' ? bs - as : as - bs;
    const at = a.lastUpdated || '';
    const bt = b.lastUpdated || '';
    if (bt !== at) return String(bt).localeCompare(String(at));
    return String(a.identity).localeCompare(String(b.identity));
  };
}

// ── The four sections ─────────────────────────────────────────────────────────
// Given the per-token rows, produce the four ranked sections. Each section is
// independently sliced to `limit`. Classification is grounded in the actual
// current/previous observations; a token can legitimately appear in more than
// one section (e.g. a big drop that also crosses into High risk).
export function buildTrustMovers(rows, { limit = 20 } = {}) {
  const movements = (Array.isArray(rows) ? rows : []).map(toMovement);

  const rising = movements
    .filter((m) => m.absoluteChange !== null && m.absoluteChange >= MIN_MOVE)
    .sort(byMovementDesc)
    .slice(0, limit);

  const falling = movements
    .filter((m) => m.absoluteChange !== null && m.absoluteChange <= -MIN_MOVE)
    .sort(byMovementDesc)
    .slice(0, limit);

  // A NEWLY high-confidence project: high confidence now, and either brand new
  // (no prior observation) or not high-confidence at the start of the window.
  const newHighConfidence = movements
    .filter((m) => {
      const row = rows.find((r) => r.identity === m.identity);
      if (!isHighConfidence(row?.current)) return false;
      return !row?.previous || !isHighConfidence(row.previous);
    })
    .sort(byCurrentScore('desc'))
    .slice(0, limit);

  // A NEWLY high-risk project: High risk now, and either brand new or not High
  // at the start of the window — i.e. it crossed INTO high risk.
  const newlyHighRisk = movements
    .filter((m) => {
      const row = rows.find((r) => r.identity === m.identity);
      if (!isHighRisk(row?.current)) return false;
      return !row?.previous || !isHighRisk(row.previous);
    })
    .sort(byCurrentScore('asc'))
    .slice(0, limit);

  return { rising, falling, newHighConfidence, newlyHighRisk };
}

// True when every section is empty — the signal the caller turns into the
// honest "Not enough historical data yet." message rather than an empty grid.
export function isEmptyResult(sections) {
  return SECTIONS.every((key) => !sections[key] || sections[key].length === 0);
}
