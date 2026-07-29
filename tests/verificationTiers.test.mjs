// The pure rules behind paid verification: pricing, the score floor, expiry.
//
// These are the decisions that survive contact with a customer's money, and
// every one of them has a failure direction that is much worse than the other.
// The tests are written around those asymmetries rather than around the happy
// path.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  VERIFICATION_TIERS,
  getVerificationTier,
  verificationTierUsd,
  tierIncludes,
  meetsScoreFloor,
  isVerificationActive,
  expiryFromNow,
  premiumBonusExpiry,
  DEFAULT_VERIFY_MIN_SCORE,
} from '../src/lib/verificationTiers.js';

// ── Pricing ─────────────────────────────────────────────────────────────────

test('an unknown tier has no price — it does not fall back to the cheapest one', () => {
  // planUsdAmount() in pricing.js defaults an unknown plan to Premium, which is
  // safe at $9. Defaulting here would sell the $399 product for $149 to anyone
  // who mistyped a tier id, so this returns null and the sale fails instead.
  assert.equal(verificationTierUsd('verified'), 149);
  assert.equal(verificationTierUsd('verified_pro'), 399);
  assert.equal(verificationTierUsd('nonsense'), null);
  assert.equal(verificationTierUsd(''), null);
  assert.equal(verificationTierUsd(undefined), null);
  assert.equal(getVerificationTier('nonsense'), null);
});

test('every tier is priced, dated and non-empty', () => {
  for (const tier of Object.values(VERIFICATION_TIERS)) {
    assert.ok(tier.usd > 0, `${tier.id} has no price`);
    assert.ok(tier.durationDays > 0, `${tier.id} never expires`);
    assert.ok(tier.includes.length > 0, `${tier.id} promises nothing`);
  }
});

test('the more expensive tier is a superset of the cheaper one', () => {
  // A buyer paying 2.7x must not silently lose a capability. Without this it is
  // entirely possible to reorganise the lists and drop one from the top tier.
  for (const capability of VERIFICATION_TIERS.verified.includes) {
    assert.ok(tierIncludes('verified_pro', capability),
      `verified_pro is missing "${capability}", which the cheaper tier includes`);
  }
  assert.ok(VERIFICATION_TIERS.verified_pro.usd > VERIFICATION_TIERS.verified.usd);
});

// ── The score floor ─────────────────────────────────────────────────────────

test('the score floor fails CLOSED on a missing or unusable score', () => {
  // THE ASYMMETRY. Refusing a sale we should have made costs one customer.
  // Making a sale we should have refused puts a KHAN Trust verified badge on a
  // token nothing measured — which is the entire reason the floor exists.
  // Absence must therefore never read as a pass.
  assert.equal(meetsScoreFloor(null), false);
  assert.equal(meetsScoreFloor(undefined), false);
  assert.equal(meetsScoreFloor(NaN), false);
  assert.equal(meetsScoreFloor(Infinity), false);
  assert.equal(meetsScoreFloor('80'), false, 'a string score is not a score');
  assert.equal(meetsScoreFloor({}), false);
});

test('the floor is inclusive at the boundary and rejects just below it', () => {
  assert.equal(meetsScoreFloor(DEFAULT_VERIFY_MIN_SCORE), true);
  assert.equal(meetsScoreFloor(DEFAULT_VERIFY_MIN_SCORE - 1), false);
  assert.equal(meetsScoreFloor(39, 40), false);
  assert.equal(meetsScoreFloor(40, 40), true);
  assert.equal(meetsScoreFloor(100, 40), true);
});

test('a custom floor is honoured, so the operator override is real', () => {
  assert.equal(meetsScoreFloor(60, 75), false);
  assert.equal(meetsScoreFloor(80, 75), true);
});

// ── Expiry ──────────────────────────────────────────────────────────────────

const NOW = Date.parse('2026-07-29T12:00:00.000Z');

test('a verification with no expiry is permanent, not instantly expired', () => {
  // Every admin-approved verification predating this system has no expiresAt.
  // Treating a missing expiry as "expired at epoch" would revoke, in one
  // deploy, every badge the platform had ever granted.
  assert.equal(isVerificationActive({ status: 'verified' }, NOW), true);
  assert.equal(isVerificationActive({ status: 'verified', expiresAt: '' }, NOW), true);
  // An unparseable timestamp is corrupt data, not evidence of expiry. It errs
  // towards keeping something already granted.
  assert.equal(isVerificationActive({ status: 'verified', expiresAt: 'not-a-date' }, NOW), true);
});

test('an expired or revoked verification is not active', () => {
  assert.equal(isVerificationActive({ status: 'verified', expiresAt: '2026-07-28T00:00:00.000Z' }, NOW), false);
  assert.equal(isVerificationActive({ status: 'verified', expiresAt: '2026-07-30T00:00:00.000Z' }, NOW), true);
  // Revocation beats an unexpired term — an admin withdrawing a badge must not
  // be overridden by the clock.
  assert.equal(isVerificationActive({ status: 'verified', expiresAt: '2027-01-01T00:00:00.000Z', revokedAt: '2026-07-01T00:00:00.000Z' }, NOW), false);
});

test('only a verified record can be active', () => {
  for (const status of ['pending', 'rejected', 'unverified', 'expired', '', undefined]) {
    assert.equal(isVerificationActive({ status, expiresAt: '2099-01-01T00:00:00.000Z' }, NOW), false,
      `status "${status}" read as an active verification`);
  }
  assert.equal(isVerificationActive(null, NOW), false);
});

test('expiry and the Premium bonus are computed from the tier, not guessed', () => {
  const expires = expiryFromNow('verified', NOW);
  assert.equal(Date.parse(expires) - NOW, 365 * 86400000);
  assert.equal(expiryFromNow('nonsense', NOW), null);

  // 3 months for the entry tier, 12 for the pro tier.
  assert.equal(premiumBonusExpiry('verified', NOW), '2026-10-29T12:00:00.000Z');
  assert.equal(premiumBonusExpiry('verified_pro', NOW), '2027-07-29T12:00:00.000Z');
  assert.equal(premiumBonusExpiry('nonsense', NOW), null);
});
