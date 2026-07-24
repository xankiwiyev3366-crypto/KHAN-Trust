// Trust Graph — the interactive historical Trust Score visualization.
//
// This is the PURE model behind the <TrustGraphCard> rendered on the token
// report page (src/main.jsx). It owns every decision the SVG chart makes —
// which points to draw, what colour the line is at each point, which day gets
// an event marker, and what the hover tooltip says — so the component stays a
// thin renderer and the logic is unit-testable without a DOM.
//
// WHY IT OWNS NO DATA OF ITS OWN
//
// Exactly like riskHistory.js, this module NEVER stores anything. It derives
// the whole graph from the snapshot stream already persisted by scoreHistory.js
// (the platform-memory store) and the change events already computed by
// buildRiskHistory(). There is no second source of truth to keep in sync, and a
// token that has never been monitored simply produces an empty model — which is
// what drives the premium "start monitoring" empty state, not a fabricated line.
//
// Snapshots are recorded at most once per UTC day (see scoreHistory.js), so the
// timeline's native resolution is daily. The time filters below narrow the
// window; they never invent sub-day points.
import { buildRiskHistory, validHistory } from './riskHistory.js';

// The five score bands from the product spec, high → low. `min` is inclusive.
// The colour is what tints the line while it sits in that band (a per-point
// gradient stop in the component) and what fills the point's dot. Values are
// literal hex rather than CSS vars so this module stays pure and its output can
// be asserted in a test with no stylesheet loaded — they mirror --success /
// --warning / --danger from styles.css, with a distinct orange between.
export const TRUST_BANDS = [
  { key: 'green', min: 80, color: '#67d39c' },
  { key: 'yellow', min: 60, color: '#f7be52' },
  { key: 'orange', min: 40, color: '#f5934a' },
  { key: 'red', min: 0, color: '#ff756e' },
];

// The band (and therefore the colour) a given Trust Score falls into. A missing
// or out-of-range score clamps to the nearest end rather than throwing, so the
// chart can never be handed a colour of `undefined`.
export function scoreBand(score) {
  const value = Number(score);
  if (!Number.isFinite(value)) return TRUST_BANDS[TRUST_BANDS.length - 1];
  return TRUST_BANDS.find((band) => value >= band.min) || TRUST_BANDS[TRUST_BANDS.length - 1];
}

// The selectable time windows, in the order the filter buttons render. `days`
// is the look-back in days; `null` means "everything we have". These keys are
// also i18n keys under `trustGraph.ranges.*`.
export const TRUST_GRAPH_RANGES = [
  { key: '24h', days: 1 },
  { key: '7d', days: 7 },
  { key: '30d', days: 30 },
  { key: '90d', days: 90 },
  { key: 'all', days: null },
];

// The event-marker vocabulary (requirement 6). Each entry maps one or more
// detected change keys (from diffSnapshots, via buildRiskHistory) onto a single
// marker shown on the day it happened. `improvingOnly` markers are emitted only
// when the change is in the good direction — "social activity INCREASED" would
// be a lie on a day social activity fell, so a worsening social change gets no
// marker here (it is still fully described in the tooltip explanation).
//
// `verification` has no change key: a completed verification is not something
// the snapshot stream records today, so it is defined here for completeness and
// simply never emits rather than being faked from an unrelated signal.
export const MARKER_TYPES = {
  liquidity: { changeKeys: ['liquidity'] },
  holder: { changeKeys: ['holderConcentration'] },
  contract: { changeKeys: ['contractSecurity'] },
  social: { changeKeys: ['social', 'community'], improvingOnly: true },
  verification: { changeKeys: [] },
};

// The marker keys a single history event earns, de-duplicated and in
// MARKER_TYPES order so two social changes (social + community) collapse to one
// "social" marker and the row is stable. Pure: reads only `event.changes`.
export function markersForEvent(event) {
  const changes = (event && Array.isArray(event.changes)) ? event.changes : [];
  const markers = [];
  for (const [markerKey, def] of Object.entries(MARKER_TYPES)) {
    const hit = changes.find((change) => {
      if (!def.changeKeys.includes(change.key)) return false;
      if (def.improvingOnly && change.worse) return false;
      return true;
    });
    if (hit) markers.push(markerKey);
  }
  return markers;
}

function dateToMs(dateStr) {
  // Snapshots are stamped `YYYY-MM-DD` (UTC day). Anchor at UTC midnight so the
  // range maths is stable regardless of the viewer's timezone.
  const ms = new Date(`${dateStr}T00:00:00Z`).getTime();
  return Number.isFinite(ms) ? ms : null;
}

// Builds the full graph model from the raw snapshot stream. Reuses the exact
// same VALID-snapshot filter and change-event derivation the timeline already
// uses (validHistory / buildRiskHistory), so the graph and the Risk History
// list can never disagree about what moved or why. `language` is threaded only
// so each event's AI explanation is localized.
//
// Returns { points, hasHistory } where each point carries everything a dot and
// its tooltip need: the score, the risk level, the colour band, the localized
// "why it changed" explanation (null on a day nothing meaningfully changed) and
// its event markers.
export function buildTrustGraph(history, language) {
  const valid = validHistory(history);
  const points = valid
    .map((snapshot) => {
      const dateMs = dateToMs(snapshot.date);
      if (dateMs === null) return null;
      const band = scoreBand(snapshot.score);
      return {
        date: snapshot.date,
        dateMs,
        score: Math.round(Number(snapshot.score)),
        riskLevel: snapshot.riskLevel || null,
        band: band.key,
        color: band.color,
        explanation: null,
        markers: [],
      };
    })
    .filter(Boolean);

  // Attach the change narrative + markers to the day they happened. Events are
  // keyed by date; a day with no meaningful change simply keeps explanation
  // null and an empty markers list.
  const events = buildRiskHistory(history, language);
  const byDate = new Map(points.map((point) => [point.date, point]));
  for (const event of events) {
    const point = byDate.get(event.date);
    if (!point) continue;
    point.explanation = event.explanation || null;
    point.markers = markersForEvent(event);
  }

  return { points, hasHistory: points.length > 0 };
}

// Narrows a built point list to a time window. Pure and total: an unknown range
// key or `all` returns every point; a range with fewer than the whole set keeps
// only points at or after the cutoff. `now` is injectable for deterministic
// tests. The newest point is always kept even if it sits outside a very short
// window, so 24H on daily data still shows the latest reading rather than going
// blank.
export function filterPointsByRange(points, rangeKey, now = Date.now()) {
  const list = Array.isArray(points) ? points : [];
  const range = TRUST_GRAPH_RANGES.find((entry) => entry.key === rangeKey);
  if (!range || range.days === null || list.length === 0) return list;
  const cutoff = now - range.days * 86400000;
  const newest = list[list.length - 1];
  return list.filter((point) => point.dateMs >= cutoff || point === newest);
}

// The min/max score span used to scale the Y axis. Padded a little and clamped
// to [0, 100] so a flat line doesn't collapse to zero height and a near-100
// score still leaves headroom for its dot. Returns whole numbers.
//
// Uses a single reduce rather than Math.min(...scores) / Math.max(...scores):
// the spread form passes every score as a function ARGUMENT, which throws
// "Maximum call stack size exceeded" once the array is large (tens of
// thousands of points) — a hard freeze. The loop is O(n) and allocation-free.
export function scoreExtent(points) {
  const list = Array.isArray(points) ? points : [];
  let rawMin = Infinity;
  let rawMax = -Infinity;
  for (const point of list) {
    const score = point?.score;
    if (!Number.isFinite(score)) continue;
    if (score < rawMin) rawMin = score;
    if (score > rawMax) rawMax = score;
  }
  if (rawMin === Infinity) return { min: 0, max: 100 };
  // Always show at least a 20-point window so small real movements are visible
  // without exaggerating noise into a cliff.
  const pad = Math.max(6, Math.round((rawMax - rawMin) * 0.2));
  return {
    min: Math.max(0, rawMin - pad),
    max: Math.min(100, rawMax + pad),
  };
}

// The earliest/latest timestamp across the points, via a loop for the same
// large-array-safety reason as scoreExtent (never Math.min(...times)).
export function timeExtent(points) {
  const list = Array.isArray(points) ? points : [];
  let minMs = Infinity;
  let maxMs = -Infinity;
  for (const point of list) {
    const ms = point?.dateMs;
    if (!Number.isFinite(ms)) continue;
    if (ms < minMs) minMs = ms;
    if (ms > maxMs) maxMs = ms;
  }
  if (minMs === Infinity) return { minMs: 0, maxMs: 0 };
  return { minMs, maxMs };
}

// Caps how many points the chart actually draws. A token monitored for years
// could accumulate thousands of daily snapshots; rendering an SVG node (plus an
// invisible hit target) for every one makes the DOM huge and every hover
// re-render O(n) — the difference between a crisp chart and a frozen tab. The
// human eye cannot resolve more than ~1 point per horizontal pixel anyway, so a
// wider series is downsampled to `maxPoints` WITHOUT losing the story:
//
//   * the first and last points are always kept (the line spans the full range);
//   * every point that carries an event marker is kept, so no "liquidity
//     changed" / "contract updated" moment silently disappears;
//   * the remaining budget is filled with an even time-stride.
//
// Pure and order-preserving. Returns the input untouched when it already fits.
export function downsamplePoints(points, maxPoints = 160) {
  const list = Array.isArray(points) ? points : [];
  const n = list.length;
  if (n <= maxPoints) return list;
  const keep = new Set([0, n - 1]);
  for (let i = 0; i < n && keep.size < maxPoints; i += 1) {
    if (list[i]?.markers?.length) keep.add(i);
  }
  const remaining = maxPoints - keep.size;
  if (remaining > 0) {
    const stride = n / (remaining + 1);
    for (let s = 1; s <= remaining; s += 1) {
      keep.add(Math.min(n - 1, Math.round(s * stride)));
    }
  }
  return Array.from(keep).sort((a, b) => a - b).map((index) => list[index]);
}
