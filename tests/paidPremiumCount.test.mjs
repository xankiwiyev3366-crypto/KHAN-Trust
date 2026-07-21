// Tests for the "Paid Premium Users" count that backs the new admin analytics
// card. The whole point of the metric is that it counts ONLY real purchases and
// NOTHING else, so the failure modes are: counting a manual/promo grant as paid
// (overstates revenue), or double-counting one buyer whose purchase is copied to
// two keys (also overstates). Both are covered here.
//
// countActivePaidPremium / isEntitlementActivePremium are pure functions over a
// plain entitlements map, so no blob backend is faked — they are exercised
// directly with the exact record shapes the payment paths write.
import test from 'node:test';
import assert from 'node:assert/strict';

const { countActivePaidPremium, isEntitlementActivePremium } =
  await import('../netlify/functions/_entitlementsStore.mjs');

const WALLET = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

// Record shapes exactly as written by stripe-webhook / verify-solana-payment.
const stripePaid = (over = {}) => ({ plan: 'premium', currency: 'card', provider: 'stripe', transactionHash: 'cs_1', verifiedAt: '2026-01-01T00:00:00.000Z', ...over });
const solPaid = (over = {}) => ({ plan: 'premium', currency: 'SOL', transactionHash: 'sig_1', verifiedAt: '2026-01-01T00:00:00.000Z', ...over });

test('an empty store is zero paid users — the current expected value', () => {
  assert.equal(countActivePaidPremium({}), 0);
  assert.equal(countActivePaidPremium(undefined), 0);
});

test('one paid premium entitlement counts as one', () => {
  assert.equal(countActivePaidPremium({ 'u:user-1': stripePaid() }), 1);
});

test('early_supporter is a paid premium plan and counts', () => {
  assert.equal(countActivePaidPremium({ [WALLET]: solPaid({ plan: 'early_supporter' }) }), 1);
});

test('a non-premium (free/expired) plan is never counted', () => {
  assert.equal(countActivePaidPremium({ 'u:user-1': stripePaid({ plan: 'free' }) }), 0);
});

test('one account purchase copied to BOTH wallet and account keys counts once', () => {
  // verify-solana-payment writes the SAME purchase to the wallet key and the
  // "u:<id>" account key; both carry the same transactionHash. Counting keys
  // would double-count a single human — dedup by transactionHash prevents it.
  const hash = 'sig_shared';
  const map = {
    [WALLET]: solPaid({ transactionHash: hash }),
    'u:user-1': solPaid({ transactionHash: hash, wallet: WALLET }),
  };
  assert.equal(countActivePaidPremium(map), 1);
});

test('two genuinely different purchases count as two', () => {
  const map = {
    'u:user-1': stripePaid({ transactionHash: 'cs_a' }),
    'u:user-2': stripePaid({ transactionHash: 'cs_b' }),
  };
  assert.equal(countActivePaidPremium(map), 2);
});

test('records with no transactionHash fall back to the subject key, not collapsed together', () => {
  const map = {
    'u:user-1': { plan: 'premium' },
    'u:user-2': { plan: 'premium' },
  };
  assert.equal(countActivePaidPremium(map), 2, 'two distinct subjects must not dedupe to one');
});

test('an expired time-boxed entitlement is not counted', () => {
  const map = { 'u:user-1': stripePaid({ expiresAt: '2020-01-01T00:00:00.000Z' }) };
  assert.equal(countActivePaidPremium(map, Date.parse('2026-01-01T00:00:00.000Z')), 0);
  assert.equal(isEntitlementActivePremium(map['u:user-1'], Date.parse('2026-01-01T00:00:00.000Z')), false);
});

test('a future-dated expiry is still active', () => {
  const rec = stripePaid({ expiresAt: '2030-01-01T00:00:00.000Z' });
  assert.equal(isEntitlementActivePremium(rec, Date.parse('2026-01-01T00:00:00.000Z')), true);
});
