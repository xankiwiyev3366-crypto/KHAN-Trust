// Tests for the Referral & Invite System store (_referralStore.mjs).
//
// Covers the guarantees the product depends on:
//   - a code is minted once and is stable (idempotent);
//   - clicks accumulate;
//   - a referral edge is written once and can never be reassigned;
//   - the abuse guards (self-referral, duplicate, 2-cycle loop) are hard no-ops;
//   - funnel milestones are monotonic, idempotent, and cascade correctly
//     (premium ⇒ active; lifetime ⇒ premium ⇒ active), but never regress or
//     imply email verification;
//   - aggregation (foldEdges) counts cumulatively by furthest stage reached.
//
// Only the blob backend is faked; all referral logic is the real module.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';

class FakeStore {
  constructor() { this.data = new Map(); }
  async setJSON(key, value) { this.data.set(key, JSON.parse(JSON.stringify(value))); }
  async get(key) { return this.data.has(key) ? JSON.parse(JSON.stringify(this.data.get(key))) : null; }
  async set(key, value) { this.data.set(key, value); }
  async delete(key) { this.data.delete(key); }
  async list({ prefix } = {}) {
    return { blobs: Array.from(this.data.keys()).filter((k) => !prefix || k.startsWith(prefix)).map((key) => ({ key })) };
  }
}

const stores = new Map();
const storeFor = (name) => {
  if (!stores.has(name)) stores.set(name, new FakeStore());
  return stores.get(name);
};

mock.module('../netlify/functions/_blobsClient.mjs', {
  namedExports: {
    getNamedStore: (name) => storeFor(name),
    jsonResponse: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
  },
});

const R = await import('../netlify/functions/_referralStore.mjs');

function reset() {
  stores.clear();
}

test('ensureOwnerRecord mints a stable, idempotent code', async () => {
  reset();
  const a = await R.ensureOwnerRecord('u-owner');
  assert.ok(a.code && a.code.length >= 7, 'a code is issued');
  const b = await R.ensureOwnerRecord('u-owner');
  assert.equal(b.code, a.code, 'the same code is returned on re-read');
  assert.equal(await R.resolveCodeOwner(a.code), 'u-owner', 'code resolves to the owner');
  assert.equal(await R.resolveCodeOwner(a.code.toLowerCase()), 'u-owner', 'resolution is case-insensitive');
});

test('recordClick accumulates and ignores unknown codes', async () => {
  reset();
  const owner = await R.ensureOwnerRecord('u1');
  assert.equal(await R.recordClick(owner.code), true);
  assert.equal(await R.recordClick(owner.code), true);
  assert.equal(await R.recordClick('NOSUCHCODE'), false);
  const view = await R.getPromoterView('u1');
  assert.equal(view.stats.clicks, 2);
});

test('attachReferral writes a one-referrer, permanent edge', async () => {
  reset();
  const owner = await R.ensureOwnerRecord('inviter');
  const res = await R.attachReferral({ referredUserId: 'newbie', code: owner.code });
  assert.equal(res.ok, true);
  assert.equal(res.referrerUserId, 'inviter');

  const edges = await R.listReferralsForPromoter('inviter');
  assert.equal(edges.length, 1);
  assert.equal(edges[0].referredUserId, 'newbie');
  assert.equal(edges[0].status, 'registered');
});

test('attachReferral refuses self-referral, duplicates, and loops', async () => {
  reset();
  const a = await R.ensureOwnerRecord('A');
  // self-referral
  assert.equal((await R.attachReferral({ referredUserId: 'A', code: a.code })).reason, 'self_referral');

  // A refers B
  assert.equal((await R.attachReferral({ referredUserId: 'B', code: a.code })).ok, true);
  // duplicate: B already referred, a second (different) inviter cannot claim B
  const c = await R.ensureOwnerRecord('C');
  assert.equal((await R.attachReferral({ referredUserId: 'B', code: c.code })).reason, 'already_referred');

  // loop: B (referred by A) tries to refer A back
  const b = await R.ensureOwnerRecord('B');
  assert.equal((await R.attachReferral({ referredUserId: 'A', code: b.code })).reason, 'loop');

  // still only one referral for A
  assert.equal((await R.listReferralsForPromoter('A')).length, 1);
});

test('attachReferral is a silent no-op for blank/unknown codes', async () => {
  reset();
  assert.equal((await R.attachReferral({ referredUserId: 'x', code: '' })).reason, 'no_code');
  assert.equal((await R.attachReferral({ referredUserId: 'x', code: 'ZZZZZZZ' })).reason, 'unknown_code');
});

test('markMilestone is monotonic, idempotent, and stamps verified only when told', async () => {
  reset();
  const owner = await R.ensureOwnerRecord('P');
  await R.attachReferral({ referredUserId: 'R', code: owner.code });

  await R.markMilestone('R', 'verified', '2026-01-01T00:00:00.000Z');
  const first = (await R.listReferralsForPromoter('P'))[0];
  assert.equal(first.verifiedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(first.status, 'verified');

  // idempotent: a second verified with a different time does not overwrite
  await R.markMilestone('R', 'verified', '2026-02-02T00:00:00.000Z');
  const second = (await R.listReferralsForPromoter('P'))[0];
  assert.equal(second.verifiedAt, '2026-01-01T00:00:00.000Z', 'timestamp not overwritten');
});

test('premium cascades to active; lifetime cascades to premium+active; verified is independent', async () => {
  reset();
  const owner = await R.ensureOwnerRecord('P2');
  await R.attachReferral({ referredUserId: 'buyer', code: owner.code });

  await R.markMilestone('buyer', 'premium');
  let edge = (await R.listReferralsForPromoter('P2'))[0];
  assert.ok(edge.premiumAt, 'premium stamped');
  assert.ok(edge.activeAt, 'active cascaded from premium');
  assert.equal(edge.verifiedAt, null, 'verified NOT implied by premium');
  assert.equal(edge.lifetimeAt, null);

  await R.markMilestone('buyer', 'lifetime');
  edge = (await R.listReferralsForPromoter('P2'))[0];
  assert.ok(edge.lifetimeAt, 'lifetime stamped');
  assert.equal(edge.status, 'lifetime');
});

test('markMilestone is a no-op for users who were never referred', async () => {
  reset();
  const res = await R.markMilestone('nobody', 'premium');
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'not_referred');
});

test('foldEdges counts cumulatively by furthest stage', () => {
  const edges = [
    { registeredAt: 'a', verifiedAt: null, activeAt: null, premiumAt: null, lifetimeAt: null },
    { registeredAt: 'b', verifiedAt: 'b', activeAt: 'b', premiumAt: null, lifetimeAt: null },
    { registeredAt: 'c', verifiedAt: 'c', activeAt: 'c', premiumAt: 'c', lifetimeAt: 'c' },
  ];
  const stats = R.foldEdges(edges);
  assert.equal(stats.signups, 3);
  assert.equal(stats.verified, 2);
  assert.equal(stats.active, 2);
  assert.equal(stats.premium, 1);
  assert.equal(stats.lifetime, 1);
});

test('conversionRate is one-decimal and division-safe', () => {
  assert.equal(R.conversionRate(0, 0), 0);
  assert.equal(R.conversionRate(200, 50), 25);
  assert.equal(R.conversionRate(3, 1), 33.3);
});

test('regenerateCode issues a new primary code while the old one still resolves', async () => {
  reset();
  const first = await R.ensureOwnerRecord('u-regen');
  const regen = await R.regenerateCode('u-regen');
  assert.notEqual(regen.code, first.code, 'a new code is issued');
  assert.equal(await R.resolveCodeOwner(regen.code), 'u-regen', 'new code resolves');
  assert.equal(await R.resolveCodeOwner(first.code), 'u-regen', 'old code still resolves (no dead links)');
});

test('listAllPromoters aggregates every promoter with their downline', async () => {
  reset();
  const p1 = await R.ensureOwnerRecord('promoter-1');
  const p2 = await R.ensureOwnerRecord('promoter-2');
  await R.recordClick(p1.code);
  await R.attachReferral({ referredUserId: 'ref-1', code: p1.code });
  await R.markMilestone('ref-1', 'premium');
  await R.attachReferral({ referredUserId: 'ref-2', code: p2.code });

  const rows = await R.listAllPromoters();
  const byId = new Map(rows.map((r) => [r.userId, r]));
  assert.equal(byId.get('promoter-1').signups, 1);
  assert.equal(byId.get('promoter-1').premium, 1);
  assert.equal(byId.get('promoter-1').clicks, 1);
  assert.equal(byId.get('promoter-2').signups, 1);
  assert.equal(byId.get('promoter-2').premium, 0);
});

test('buildReferralLink produces a /signup?ref= URL', () => {
  const link = R.buildReferralLink('ABC2345', 'https://khantrust.net');
  assert.equal(link, 'https://khantrust.net/signup?ref=ABC2345');
});
