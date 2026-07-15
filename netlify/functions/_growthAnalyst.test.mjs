// Tests for the fact pack — the AI layer's input filter.
//
// This is the boundary where statistical honesty becomes an AI-safety property.
// If an `insufficient` metric leaks into the fact pack, the model WILL reason
// about it and produce a confident, well-written, worthless conclusion. These
// tests pin the filter shut.
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFactPack } from './_growthAnalyst.mjs';
import { buildWarehouse } from './_growthWarehouse.mjs';
import { CONFIDENCE } from './_growthConfidence.mjs';

// Minimal warehouse-shaped fixture. Built by hand rather than through
// buildWarehouse so each test can pin one exact confidence state.
function warehouseWith(overrides = {}) {
  const insufficient = (reason) => ({ level: CONFIDENCE.INSUFFICIENT, sampleSize: 3, reason });
  return {
    windowDays: 30,
    generatedAt: '2026-07-15T12:00:00.000Z',
    funnel: {
      totalVisitors: 3,
      stages: [
        { id: 'visited', label: 'Visited', count: 3 },
        {
          id: 'activated',
          label: 'Scanned a token',
          count: 1,
          rate: { value: 0.333, confidence: insufficient('Only 3 observations — below the 30 needed.') },
        },
      ],
    },
    bottleneck: { stage: null, reason: 'No funnel step has enough data to identify a bottleneck yet.' },
    instrumentationGaps: [],
    retention: {
      summary: {
        d1: { value: null, confidence: insufficient('No registrations recorded in this window.') },
        d7: { value: null, confidence: insufficient('No registrations recorded in this window.') },
        d30: { value: null, confidence: insufficient('No registrations recorded in this window.') },
      },
      cohorts: [],
    },
    channels: [],
    contentDemand: [],
    conversionBlockers: [],
    dataHealth: { totalEvents: 9, distinctVisitors: 3, note: 'thin' },
    signupTrend: { change: { significant: false, reason: 'One or both periods have too little data to compare.' } },
    ...overrides,
  };
}

test('an insufficient funnel rate never reaches the model', () => {
  // 1 of 3 visitors scanning is "33.3%". If that number reaches the model it
  // will explain what it means and what to do about it, fluently and wrongly.
  const pack = buildFactPack(warehouseWith());
  const serialised = JSON.stringify(pack.known);

  assert.ok(!serialised.includes('0.333'), 'the untrustworthy rate must be stripped');
  assert.ok(!serialised.includes('conversionRate'), 'no rate at all should survive here');
  assert.ok(
    pack.unknowns.some((u) => /Scanned a token/.test(u)),
    'and it must instead be declared an explicit unknown'
  );
});

test('an unknowable bottleneck is passed as a question, not a guess', () => {
  const pack = buildFactPack(warehouseWith());
  assert.equal(pack.known.bottleneck, undefined);
  assert.ok(pack.unknowns.some((u) => /bottleneck/i.test(u)));
});

test('unmeasurable retention is an unknown, never a zero', () => {
  // "0% D7 retention" would read as a catastrophe. "We have not measured it" is
  // the truth. These are wildly different inputs to a strategy.
  const pack = buildFactPack(warehouseWith());
  assert.equal(pack.known.retention, undefined);
  for (const horizon of ['D1', 'D7', 'D30']) {
    assert.ok(pack.unknowns.some((u) => u.startsWith(horizon)), `${horizon} must be declared unknown`);
  }
});

test('a trustworthy rate DOES reach the model', () => {
  // The filter must not be uselessly strict, or the AI layer never has anything
  // to work with and gets switched off.
  const pack = buildFactPack(warehouseWith({
    funnel: {
      totalVisitors: 1000,
      stages: [
        { id: 'visited', label: 'Visited', count: 1000 },
        {
          id: 'activated',
          label: 'Scanned a token',
          count: 800,
          rate: { value: 0.8, confidence: { level: CONFIDENCE.SUFFICIENT, sampleSize: 1000, reason: 'n=1000.' } },
        },
      ],
    },
  }));

  const activated = pack.known.funnel.find((s) => s.stage === 'Scanned a token');
  assert.equal(activated.conversionRate, 0.8);
  assert.equal(activated.confidence, CONFIDENCE.SUFFICIENT);
});

test('instrumentation gaps are given to the model as actionable facts', () => {
  // A missing event is not an unknown to be tolerated — it is an engineering
  // task with a known fix, and recommending it is high-value.
  const pack = buildFactPack(warehouseWith({
    instrumentationGaps: [{ stage: 'pricing', label: 'Viewed pricing', upstreamCount: 400, reason: 'Not one of the 400 visitors registered a "Viewed pricing" event.' }],
  }));
  assert.equal(pack.known.instrumentationGaps.length, 1);
  assert.equal(pack.known.instrumentationGaps[0].step, 'Viewed pricing');
});

test('an unproven trend is declared unknown rather than reported as a change', () => {
  const pack = buildFactPack(warehouseWith());
  assert.ok(pack.unknowns.some((u) => /trending up or down/i.test(u)));
});

test('the fact pack survives a real warehouse built from zero events', () => {
  // The literal state on the day this ships: the data plane is live and empty.
  // It must produce an honest, non-crashing fact pack rather than a wall of
  // zeros that reads like a collapsing business.
  const emptyWarehouse = {
    ...warehouseWith(),
    funnel: { totalVisitors: 0, stages: [{ id: 'visited', label: 'Visited', count: 0 }] },
  };
  const pack = buildFactPack(emptyWarehouse);
  assert.equal(pack.known.totalVisitors, 0);
  assert.ok(pack.unknowns.length > 0, 'an empty platform is all unknowns, and must say so');
});
