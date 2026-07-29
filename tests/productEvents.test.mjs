// Phase 5 — the product event vocabulary, its redaction rules, its dedup keys,
// and the funnel arithmetic derived from them.
//
// All pure: no store, no clock, no network.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PRODUCT_EVENTS,
  PRODUCT_EVENT_NAMES,
  isProductEvent,
  isClientEmittable,
  sanitizeMetadata,
  defaultDedupKey,
  FORBIDDEN_METADATA_KEYS,
} from '../src/lib/productEvents.js';
import { buildProductEvent, computeFunnel } from '../netlify/functions/_productEvents.mjs';

// ── The vocabulary ──────────────────────────────────────────────────────────

test('every event named in the Phase 5 requirement exists', () => {
  for (const name of [
    'scan_started', 'scan_completed', 'scan_failed', 'wallet_connected',
    'project_profile_viewed', 'badge_impression', 'verification_quote_created',
    'verification_order_created', 'verification_payment_detected',
    'verification_payment_confirmed', 'verification_ownership_started',
    'verification_ownership_completed', 'verification_activated',
    'verification_expired', 'verification_revoked', 'verification_refunded',
    'alert_fired', 'paywall_hit', 'upgrade_clicked',
  ]) {
    assert.ok(PRODUCT_EVENT_NAMES.includes(name), `missing event: ${name}`);
  }
});

test('the vocabulary is closed — an unknown name is refused, not stored', () => {
  assert.equal(isProductEvent('scan_completed'), true);
  for (const bad of ['scanCompleted', 'Scan Completed', 'scan_complete', '', null, undefined]) {
    assert.equal(isProductEvent(bad), false, `"${bad}" should be refused`);
  }
});

test('a browser may never author a revenue event', () => {
  // These are the numerator and denominator of the conversion rate. If a page
  // could post them, anyone could set the platform's reported funnel.
  for (const name of [
    PRODUCT_EVENTS.VERIFICATION_ACTIVATED,
    PRODUCT_EVENTS.VERIFICATION_PAYMENT_CONFIRMED,
    PRODUCT_EVENTS.VERIFICATION_ORDER_CREATED,
    PRODUCT_EVENTS.VERIFICATION_QUOTE_CREATED,
    PRODUCT_EVENTS.VERIFICATION_REVOKED,
    PRODUCT_EVENTS.VERIFICATION_REFUNDED,
    PRODUCT_EVENTS.PROJECT_PROFILE_VIEWED,
  ]) {
    assert.equal(isClientEmittable(name), false, `${name} must not be client-emittable`);
  }
});

test('badge impressions are server-recorded, never client-authored', () => {
  // The embedding page is by definition not under our control, and the badge's
  // whole security model is that nothing it sends can influence what we report.
  assert.equal(isClientEmittable(PRODUCT_EVENTS.BADGE_IMPRESSION), false);
});

test('the client may emit the top-of-funnel events it genuinely observes', () => {
  for (const name of ['scan_started', 'scan_completed', 'scan_failed', 'wallet_connected', 'paywall_hit', 'upgrade_clicked']) {
    assert.equal(isClientEmittable(name), true, `${name} should be client-emittable`);
  }
});

// ── Redaction ───────────────────────────────────────────────────────────────

test('secrets and personal identifiers are stripped from metadata by name', () => {
  const dirty = {
    signature: 'sig',
    paymentSignature: 'sig',
    payment_signature: 'sig',
    'PAYMENT-SIGNATURE': 'sig',
    transactionHash: 'hash',
    badgeToken: 'tok',
    email: 'a@b.c',
    ownerWallet: 'wallet',
    apiKey: 'k',
    adminNote: 'private',
    tier: 'verified',
    usd: 149,
  };
  const clean = sanitizeMetadata(dirty);
  assert.deepEqual(Object.keys(clean).sort(), ['tier', 'usd']);
});

test('a nested object is dropped rather than recursed into', () => {
  // A nested bag is exactly how an unreviewed payload — and the secret inside
  // it — gets past a key check.
  const clean = sanitizeMetadata({ order: { paymentSignature: 'sig' }, list: [1, 2], ok: true });
  assert.deepEqual(clean, { ok: true });
});

test('metadata values are length-capped and HTML-stripped', () => {
  const clean = sanitizeMetadata({ note: `<b>x</b>${'a'.repeat(500)}` });
  assert.ok(clean.note.length <= 200);
  assert.doesNotMatch(clean.note, /<b>/);
});

test('metadata key count is bounded', () => {
  const many = {};
  for (let i = 0; i < 100; i += 1) many[`k${i}`] = i;
  assert.ok(Object.keys(sanitizeMetadata(many)).length <= 20);
});

test('non-finite numbers are refused rather than stored as null', () => {
  assert.deepEqual(sanitizeMetadata({ a: NaN, b: Infinity, c: 1 }), { c: 1 });
});

test('the denylist covers the identifiers a wallet-based product leaks most easily', () => {
  for (const key of ['wallet', 'walletaddress', 'privatekey', 'mnemonic', 'jwt', 'cookie']) {
    assert.ok(FORBIDDEN_METADATA_KEYS.has(key), `${key} should be forbidden`);
  }
});

// ── Dedup keys ──────────────────────────────────────────────────────────────

test('a state-transition key is derived from the order, never from the clock', () => {
  const a = defaultDedupKey({ name: 'verification_activated', orderId: 'vo-1' });
  const b = defaultDedupKey({ name: 'verification_activated', orderId: 'vo-1' });
  assert.equal(a, b);
  assert.match(a, /order:vo-1/);
  // Different orders are different events.
  assert.notEqual(a, defaultDedupKey({ name: 'verification_activated', orderId: 'vo-2' }));
});

test('view-style events bucket by session and day, so two people are two facts', () => {
  const one = defaultDedupKey({ name: 'project_profile_viewed', chain: 'solana', contract: 'abc', sessionId: 's1', timestamp: '2026-07-29T10:00:00Z' });
  const same = defaultDedupKey({ name: 'project_profile_viewed', chain: 'solana', contract: 'abc', sessionId: 's1', timestamp: '2026-07-29T22:00:00Z' });
  const other = defaultDedupKey({ name: 'project_profile_viewed', chain: 'solana', contract: 'abc', sessionId: 's2', timestamp: '2026-07-29T10:00:00Z' });
  const nextDay = defaultDedupKey({ name: 'project_profile_viewed', chain: 'solana', contract: 'abc', sessionId: 's1', timestamp: '2026-07-30T10:00:00Z' });

  assert.equal(one, same, 'same session, same day = one fact');
  assert.notEqual(one, other, 'two sessions = two facts');
  assert.notEqual(one, nextDay, 'two days = two facts');
});

// ── The stored shape ────────────────────────────────────────────────────────

test('a referrer is truncated to its origin, so a query string cannot smuggle a token', () => {
  const event = buildProductEvent({
    name: 'scan_started',
    source: 'https://example.com/page?token=SECRET&email=a@b.c',
  });
  assert.equal(event.source, 'https://example.com');
  assert.doesNotMatch(event.source, /SECRET/);
});

test('a non-URL source is kept short rather than discarded', () => {
  const event = buildProductEvent({ name: 'scan_started', source: 'newsletter-july' });
  assert.equal(event.source, 'newsletter-july');
});

test('an event with no session and no user is still a real event', () => {
  // A crawler-driven profile view and a cron-fired expiry have no person
  // attached; discarding them would under-report real facts.
  const event = buildProductEvent({ name: 'project_profile_viewed', chain: 'solana', contract: 'abc' });
  assert.equal(event.name, 'project_profile_viewed');
  assert.equal(event.sessionId, '');
  assert.ok(event.dedupKey);
});

test('identifiers are HTML-stripped and length-bounded', () => {
  const event = buildProductEvent({
    name: 'scan_started',
    sessionId: `<script>${'s'.repeat(200)}`,
    contract: 'x'.repeat(300),
  });
  assert.doesNotMatch(event.sessionId, /<script>/);
  assert.ok(event.sessionId.length <= 64);
  assert.ok(event.contract.length <= 128);
});

// ── The funnel ──────────────────────────────────────────────────────────────

const evt = (name, metadata = {}) => ({ name, metadata, timestamp: '2026-07-29T10:00:00Z' });

test('the funnel counts each stage from the events themselves', () => {
  const funnel = computeFunnel([
    evt('verification_quote_created'),
    evt('verification_quote_created'),
    evt('verification_quote_created'),
    evt('verification_order_created'),
    evt('verification_order_created'),
    evt('verification_payment_confirmed'),
    evt('verification_ownership_completed'),
    evt('verification_activated', { tier: 'verified', usd: 149 }),
  ]);
  assert.equal(funnel.quotes, 3);
  assert.equal(funnel.orders, 2);
  assert.equal(funnel.paymentsConfirmed, 1);
  assert.equal(funnel.ownershipCompleted, 1);
  assert.equal(funnel.activations, 1);
  assert.equal(funnel.conversionRate, 0.3333);
});

test('a conversion rate with no quotes is null, never 0%', () => {
  // 0/0 is the absence of a measurement. Rendering it as 0% would show a red
  // failure on a quiet week and prompt somebody to fix a working funnel.
  const funnel = computeFunnel([evt('scan_started')]);
  assert.equal(funnel.conversionRate, null);
  // But a stage with no events genuinely IS zero — nobody did it.
  assert.equal(funnel.activations, 0);
});

test('revenue is read off the activation event, not recomputed from the price list', () => {
  // A future price change must not retroactively rewrite historic revenue.
  const funnel = computeFunnel([
    evt('verification_activated', { tier: 'verified', usd: 149 }),
    evt('verification_activated', { tier: 'verified', usd: 149 }),
    evt('verification_activated', { tier: 'verified_pro', usd: 399 }),
  ]);
  assert.deepEqual(funnel.revenueByTier, { verified: 298, verified_pro: 399 });
  assert.equal(funnel.revenueTotal, 697);
});

test('an activation with no recorded price is counted but adds no revenue', () => {
  const funnel = computeFunnel([evt('verification_activated', { tier: 'verified' })]);
  assert.equal(funnel.activations, 1);
  assert.equal(funnel.revenueTotal, 0);
});

test('an empty window produces zeroes and a null rate, not a crash', () => {
  const funnel = computeFunnel([]);
  assert.equal(funnel.activations, 0);
  assert.equal(funnel.conversionRate, null);
  assert.deepEqual(funnel.revenueByTier, {});
});
