// Tests for the peer-benchmark ranking (Phase 2 coverage). Pure/synchronous.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePeerBenchmark } from './peerBenchmark.js';

const peers = (category, scores) => scores.map((trustScore, i) => ({ id: `${category}-${i}`, assetCategory: category, trustScore }));

test('computePeerBenchmark: null when there are too few peers (< 4)', () => {
  const project = { assetCategory: 'DeFi', trustScore: 70 };
  assert.equal(computePeerBenchmark(project, peers('DeFi', [40, 60, 80])), null);
});

test('computePeerBenchmark: null when the project has no asset category', () => {
  assert.equal(computePeerBenchmark({ trustScore: 70 }, peers('DeFi', [40, 60, 80, 90])), null);
});

test('computePeerBenchmark: percentile, median and comparison for a known set', () => {
  const project = { assetCategory: 'DeFi', trustScore: 70 };
  const result = computePeerBenchmark(project, peers('DeFi', [30, 50, 60, 80, 90]));
  assert.equal(result.peerCount, 5);
  assert.equal(result.median, 60);        // middle of [30,50,60,80,90]
  assert.equal(result.percentile, 60);    // 3 of 5 peers below 70
  assert.equal(result.comparison, 'above');
  assert.equal(result.category, 'DeFi');
});

test('computePeerBenchmark: only counts peers in the SAME category', () => {
  const project = { assetCategory: 'DeFi', trustScore: 70 };
  const mixed = [...peers('DeFi', [40, 60, 80, 90]), ...peers('Meme Token', [10, 20, 95, 99])];
  const result = computePeerBenchmark(project, mixed);
  assert.equal(result.peerCount, 4, 'meme peers are excluded from a DeFi benchmark');
});

test('computePeerBenchmark: comparison is "below" when under the median', () => {
  const project = { assetCategory: 'Layer 1', trustScore: 40 };
  const result = computePeerBenchmark(project, peers('Layer 1', [50, 60, 70, 80]));
  assert.equal(result.comparison, 'below');
});
