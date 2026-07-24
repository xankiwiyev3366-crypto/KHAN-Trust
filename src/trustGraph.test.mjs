// Tests for the pure Trust Graph model (src/trustGraph.js). The SVG/React
// rendering is not exercised here — only the score→band mapping, the range
// filter, the extent maths, and the marker/point derivation, all of which are
// pure and DOM-free.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreBand,
  TRUST_BANDS,
  TRUST_GRAPH_RANGES,
  markersForEvent,
  buildTrustGraph,
  filterPointsByRange,
  scoreExtent,
} from './trustGraph.js';

const dayMs = 86400000;
const isoDaysAgo = (n, now = Date.now()) => new Date(now - n * dayMs).toISOString().slice(0, 10);

// A recordable snapshot the validHistory filter accepts (finite score, not demo).
const snap = (date, score, extra = {}) => ({
  date,
  score,
  riskLevel: 'Low',
  complete: true,
  ...extra,
});

test('scoreBand: maps each band boundary to the right colour', () => {
  assert.equal(scoreBand(100).key, 'green');
  assert.equal(scoreBand(80).key, 'green');
  assert.equal(scoreBand(79).key, 'yellow');
  assert.equal(scoreBand(60).key, 'yellow');
  assert.equal(scoreBand(59).key, 'orange');
  assert.equal(scoreBand(40).key, 'orange');
  assert.equal(scoreBand(39).key, 'red');
  assert.equal(scoreBand(0).key, 'red');
});

test('scoreBand: non-finite score clamps to red rather than throwing', () => {
  assert.equal(scoreBand(undefined).key, 'red');
  assert.equal(scoreBand(NaN).key, 'red');
  assert.equal(scoreBand(null).color, TRUST_BANDS[TRUST_BANDS.length - 1].color);
});

test('markersForEvent: derives markers from change keys, dedupes social/community', () => {
  const event = {
    changes: [
      { key: 'liquidity', worse: false },
      { key: 'holderConcentration', worse: true },
      { key: 'contractSecurity', worse: false },
      { key: 'social', worse: false },
      { key: 'community', worse: false },
    ],
  };
  assert.deepEqual(markersForEvent(event), ['liquidity', 'holder', 'contract', 'social']);
});

test('markersForEvent: social marker suppressed when social got worse', () => {
  const event = { changes: [{ key: 'social', worse: true }] };
  assert.deepEqual(markersForEvent(event), []);
});

test('markersForEvent: tolerant of a malformed event', () => {
  assert.deepEqual(markersForEvent({}), []);
  assert.deepEqual(markersForEvent(null), []);
});

test('buildTrustGraph: empty when there is no valid history', () => {
  const model = buildTrustGraph([], 'en');
  assert.equal(model.hasHistory, false);
  assert.deepEqual(model.points, []);
});

test('buildTrustGraph: builds coloured points in ascending date order', () => {
  const history = [
    snap(isoDaysAgo(10), 85),
    snap(isoDaysAgo(5), 55),
  ];
  const model = buildTrustGraph(history, 'en');
  assert.equal(model.hasHistory, true);
  assert.equal(model.points.length, 2);
  assert.equal(model.points[0].band, 'green');
  assert.equal(model.points[1].band, 'orange');
  // Ascending by date.
  assert.ok(model.points[0].dateMs < model.points[1].dateMs);
});

test('buildTrustGraph: attaches an AI explanation + markers on a change day', () => {
  // A big liquidity drop between two days produces a change event whose date is
  // the newer snapshot; that point should carry an explanation and a marker.
  const older = isoDaysAgo(9);
  const newer = isoDaysAgo(2);
  const history = [
    snap(older, 88, { liquidityUsd: 1_000_000, topHolderPercent: 10 }),
    snap(newer, 88, { liquidityUsd: 300_000, topHolderPercent: 10 }),
  ];
  const model = buildTrustGraph(history, 'en');
  const changed = model.points.find((point) => point.date === newer);
  assert.ok(changed.explanation && changed.explanation.length > 0);
  assert.ok(changed.markers.includes('liquidity'));
});

test('filterPointsByRange: "all" and unknown keys keep everything', () => {
  const points = [{ dateMs: 1 }, { dateMs: 2 }, { dateMs: 3 }];
  assert.equal(filterPointsByRange(points, 'all').length, 3);
  assert.equal(filterPointsByRange(points, 'nope').length, 3);
});

test('filterPointsByRange: 7d drops older points but always keeps the newest', () => {
  const now = Date.now();
  const points = [
    { dateMs: now - 30 * dayMs },
    { dateMs: now - 3 * dayMs },
    { dateMs: now - 40 * dayMs }, // out of window but is the newest array entry
  ];
  // Newest-by-array-position is the last element; it is kept even though it is
  // outside the 7d window (guards the 24H-on-daily-data blank-chart case).
  const filtered = filterPointsByRange(points, '7d', now);
  assert.ok(filtered.includes(points[1]));
  assert.ok(filtered.includes(points[2]));
  assert.ok(!filtered.includes(points[0]));
});

test('TRUST_GRAPH_RANGES: exposes the five required windows', () => {
  assert.deepEqual(TRUST_GRAPH_RANGES.map((r) => r.key), ['24h', '7d', '30d', '90d', 'all']);
});

test('scoreExtent: pads and clamps to [0, 100]', () => {
  assert.deepEqual(scoreExtent([]), { min: 0, max: 100 });
  const { min, max } = scoreExtent([{ score: 95 }, { score: 90 }]);
  assert.ok(min >= 0 && min < 90);
  assert.equal(max, 100); // clamped
});
