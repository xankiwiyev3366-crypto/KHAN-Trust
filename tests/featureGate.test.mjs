// Tests for the Free/Premium enforcement layer.
//
// TWO THINGS ARE UNDER TEST, and the second one is the reason this file exists:
//
//   1. The shared registry (src/lib/features.js) — pure tier logic.
//   2. The SERVER gate actually refusing a free caller on a real endpoint.
//
// (2) matters because the failure mode being guarded against is silent and
// invisible from the UI: a feature can look perfectly locked — crown, overlay,
// disabled button — while its endpoint happily serves the data to anyone who
// asks. Testing the client gate would prove nothing about that. So these drive
// the REAL score-history-get handler against a faked blob backend, the same
// approach tests/scanQuota.test.mjs uses.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

class FakeStore {
  constructor() { this.data = new Map(); }
  async setJSON(key, value) { this.data.set(key, JSON.parse(JSON.stringify(value))); }
  async get(key) { return this.data.has(key) ? JSON.parse(JSON.stringify(this.data.get(key))) : null; }
  async delete(key) { this.data.delete(key); }
  async list({ prefix } = {}) {
    return { blobs: [...this.data.keys()].filter((k) => !prefix || k.startsWith(prefix)).map((key) => ({ key })) };
  }
}

const stores = new Map();

// Simulates a Blobs outage. node:test allows a module to be mocked only ONCE
// per process, so the outage cannot be a second mock.module() call — it is a
// flag the single mock below honours, flipped for the duration of one test.
let outage = false;

const storeFor = (name) => {
  // Matches the real _blobsClient.getNamedStore, which THROWS when the store
  // cannot be reached. That throw is what lets _featureGate tell an outage
  // apart from a genuine "not entitled", so faking the outage any other way
  // (e.g. returning an empty store) would test the wrong thing entirely — an
  // empty store looks exactly like a user with no entitlement.
  if (outage) throw new Error('Netlify Blobs getStore("' + name + '") failed: unreachable');
  if (!stores.has(name)) stores.set(name, new FakeStore());
  return stores.get(name);
};

mock.module('../netlify/functions/_blobsClient.mjs', {
  namedExports: {
    getNamedStore: (name) => storeFor(name),
    jsonResponse: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
  },
});

const {
  FEATURES, FREE_DAILY_SCAN_LIMIT, canUseFeature, isPremiumFeature, isTeasable,
  featuresForTier, featuresByGroup, featureTier,
} = await import('../src/lib/features.js');
const { requireFeature, resolveTier } = await import('../netlify/functions/_featureGate.mjs');
const { handler: scoreHistoryGet } = await import('../netlify/functions/score-history-get.mjs');
const { issueToken } = await import('../netlify/functions/_authStore.mjs');
const { setGrant } = await import('../netlify/functions/_premiumStore.mjs');

function reset() { stores.clear(); }
const parse = (res) => JSON.parse(res.body);

const anonEvent = (overrides = {}) => ({ httpMethod: 'GET', headers: {}, queryStringParameters: {}, ...overrides });
const userEvent = (user, overrides = {}) => ({
  httpMethod: 'GET',
  headers: { authorization: `Bearer ${issueToken(user)}` },
  queryStringParameters: {},
  ...overrides,
});

// ── The registry ──────────────────────────────────────────────────────────────

test('the free tier covers the whole core scan', () => {
  // These are the capabilities a free user is PROMISED on the pricing page. If
  // any of them silently becomes premium, the product stops being usable
  // without paying and the pricing page becomes a lie — so they are pinned.
  for (const key of [
    'trustScore', 'scamProbability', 'projectOverview', 'aiSummary',
    'basicRiskIndicators', 'basicHolders', 'basicContractSecurity', 'priceChart',
  ]) {
    assert.equal(isPremiumFeature(key), false, `${key} must stay free`);
    assert.equal(canUseFeature(key, { hasPremium: false }), true);
  }
});

test('every advertised premium feature is actually gated', () => {
  for (const key of [
    'fullAiAnalysis', 'detailedRiskBreakdown', 'aiRecommendations', 'holderAnalytics',
    'securityAnalysis', 'scoreHistory', 'compareProjects', 'watchlist',
    'continuousMonitoring', 'realtimeAlerts', 'pdfReports', 'advancedAnalytics',
  ]) {
    assert.equal(isPremiumFeature(key), true, `${key} must be premium`);
    assert.equal(canUseFeature(key, { hasPremium: false }), false);
    assert.equal(canUseFeature(key, { hasPremium: true }), true);
  }
});

test('an unknown feature key fails CLOSED, not open', () => {
  // A typo in a gate call, or a feature wired up before its registry entry
  // exists, must lock rather than give paid functionality away silently. The
  // cost of this default is a support ticket; the cost of the opposite is
  // unpriced revenue leaking with no error anywhere to notice it by.
  assert.equal(featureTier('doesNotExist'), 'premium');
  assert.equal(isPremiumFeature('typoedKey'), true);
  assert.equal(canUseFeature('typoedKey', { hasPremium: false }), false);
  assert.equal(canUseFeature('typoedKey', { hasPremium: true }), true);
});

test('a missing or malformed premium flag is not premium', () => {
  // canUseFeature requires === true, so no truthy-ish value sneaks through.
  for (const value of [undefined, null, 0, '', 'yes', 1, {}]) {
    assert.equal(canUseFeature('watchlist', { hasPremium: value }), false, `hasPremium=${JSON.stringify(value)}`);
  }
  assert.equal(canUseFeature('watchlist', {}), false);
  assert.equal(canUseFeature('watchlist'), false);
});

test('free features are always teasable; premium ones follow their flag', () => {
  assert.equal(isTeasable('trustScore'), true);
  assert.equal(isTeasable('watchlist'), true);
  // unlimitedScans has no panel to tease — it is a limit, not a surface.
  assert.equal(isTeasable('unlimitedScans'), false);
});

test('every registry entry has a label and a group so the pricing table is complete', () => {
  // The comparison table and the upgrade modal are GENERATED from the registry.
  // An entry missing labelKey renders a raw key at the user; one missing
  // `group` silently vanishes from the pricing table while still being
  // enforced — a feature users pay for but are never told about.
  const grouped = new Set(featuresByGroup().flatMap(([, items]) => items.map(([key]) => key)));
  for (const [key, def] of Object.entries(FEATURES)) {
    assert.ok(def.labelKey, `${key} is missing labelKey`);
    assert.ok(def.group, `${key} is missing group`);
    assert.ok(grouped.has(key), `${key} would not appear in the pricing comparison table`);
  }
});

test('the free daily limit is 5 and is the single source both sides read', async () => {
  assert.equal(FREE_DAILY_SCAN_LIMIT, 5);
  const store = await import('../netlify/functions/_scanQuotaStore.mjs');
  const client = await import('../src/scanQuota.js');
  assert.equal(store.FREE_DAILY_SCAN_LIMIT, FREE_DAILY_SCAN_LIMIT);
  assert.equal(client.FREE_DAILY_SCAN_LIMIT, FREE_DAILY_SCAN_LIMIT);
});

test('free and premium tiers partition the registry with no overlap', () => {
  const free = featuresForTier('free').map(([key]) => key);
  const premium = featuresForTier('premium').map(([key]) => key);
  assert.equal(free.length + premium.length, Object.keys(FEATURES).length);
  assert.equal(free.filter((key) => premium.includes(key)).length, 0);
});

// ── requireFeature ────────────────────────────────────────────────────────────

test('requireFeature refuses an anonymous caller with 402, not 403', async () => {
  reset();
  const gate = await requireFeature(anonEvent(), 'holderAnalytics');
  assert.equal(gate.allowed, false);
  // 402 Payment Required, because the request was well-formed and the only
  // thing missing is payment. The client renders 402 as the upgrade modal and
  // 403 as an error, so the distinction is load-bearing.
  assert.equal(gate.response.statusCode, 402);
  const body = parse(gate.response);
  assert.equal(body.error, 'premium_required');
  assert.equal(body.feature, 'holderAnalytics');
});

test('requireFeature lets a granted premium account through', async () => {
  reset();
  const user = { id: 'u-premium-gate', email: 'vip@example.com' };
  await setGrant(user.id, { status: 'active', plan: 'premium', expiresAt: null });
  const gate = await requireFeature(userEvent(user), 'holderAnalytics');
  assert.equal(gate.allowed, true);
  assert.equal(gate.premium, true);
});

test('requireFeature never refuses a free feature', async () => {
  reset();
  const gate = await requireFeature(anonEvent(), 'trustScore');
  assert.equal(gate.allowed, true);
  assert.equal(gate.premium, false); // allowed, but honestly reported as free
});

test('a signed-in NON-premium account is still refused', async () => {
  reset();
  // Being logged in is not the same as having paid — an easy conflation to
  // make, and it would hand every registered user the entire paid product.
  const gate = await requireFeature(userEvent({ id: 'u-free-gate', email: 'free@example.com' }), 'pdfReports');
  assert.equal(gate.allowed, false);
  assert.equal(gate.response.statusCode, 402);
});

test('an entitlement-store OUTAGE fails OPEN so paying customers are not stranded', async () => {
  // getNamedStore throws on a real Blobs outage (see _blobsClient.mjs), which
  // is what makes an outage distinguishable from a denial. Failing closed here
  // would lock every paying customer out of what they bought the moment
  // storage hiccups — and from their side that is indistinguishable from
  // being cheated. Free users briefly seeing premium panels is the cheaper
  // failure, so that is the one we choose.
  reset();
  const user = { id: 'u-outage', email: 'paid@example.com' };
  outage = true;
  try {
    const gate = await requireFeature(userEvent(user), 'holderAnalytics');
    assert.equal(gate.allowed, true);
    assert.equal(gate.degraded, true);
    assert.equal(gate.premium, true);

    // resolveTier takes the same posture, so a redacting endpoint serves the
    // FULL payload during an outage rather than silently redacting a paying
    // customer's report.
    const tier = await resolveTier(userEvent(user));
    assert.equal(tier.premium, true);
    assert.equal(tier.degraded, true);
  } finally {
    outage = false;
  }

  // And recovery is clean: once the store is back, this same (unpaid) account
  // is refused again. The outage grants nothing durable.
  const recovered = await requireFeature(userEvent(user), 'holderAnalytics');
  assert.equal(recovered.allowed, false);
});

test('an ANONYMOUS caller is still refused during an outage', async () => {
  // The fail-open above is scoped to callers who HAVE an identity, and that is
  // not a detail — it falls out of the resolver never reading the store for a
  // caller with no JWT and no proven wallet. Someone who cannot possibly hold
  // an entitlement is refused even mid-incident, so an outage cannot be used
  // as a way to browse the paid product anonymously.
  reset();
  outage = true;
  try {
    const gate = await requireFeature(anonEvent(), 'holderAnalytics');
    assert.equal(gate.allowed, false);
    assert.equal(gate.response.statusCode, 402);
  } finally {
    outage = false;
  }
});

// ── The gate on a real endpoint ───────────────────────────────────────────────

test('score-history-get refuses a free caller — the UI lock is not the only lock', async () => {
  reset();
  const res = await scoreHistoryGet(anonEvent({ queryStringParameters: { key: 'sol:abc' } }));
  assert.equal(res.statusCode, 402);
  const body = parse(res);
  assert.equal(body.error, 'premium_required');
  // Critically: no history payload leaks alongside the refusal.
  assert.equal(body.history, undefined);
});

test('score-history-get serves a premium caller', async () => {
  reset();
  const user = { id: 'u-history', email: 'history@example.com' };
  await setGrant(user.id, { status: 'active', plan: 'premium', expiresAt: null });
  const res = await scoreHistoryGet(userEvent(user, { queryStringParameters: { key: 'sol:abc' } }));
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(parse(res).history));
});

test('the gate runs BEFORE input validation, so a refusal never depends on the payload', async () => {
  reset();
  // A free caller with a missing `key` must still get 402, not 400. If
  // validation ran first, the error text would differ by input and turn the
  // endpoint into an oracle for which keys exist.
  const res = await scoreHistoryGet(anonEvent({ queryStringParameters: {} }));
  assert.equal(res.statusCode, 402);
});

// ── resolveTier (the redaction path) ─────────────────────────────────────────

test('resolveTier reports tier without ever refusing', async () => {
  reset();
  const anonTier = await resolveTier(anonEvent());
  assert.equal(anonTier.premium, false);

  const user = { id: 'u-tier', email: 'tier@example.com' };
  await setGrant(user.id, { status: 'active', plan: 'premium', expiresAt: null });
  const premiumTier = await resolveTier(userEvent(user));
  assert.equal(premiumTier.premium, true);
});

test('early_supporter (Lifetime) is honored everywhere premium is', async () => {
  reset();
  // Lifetime is a SUPERSET of Premium. A Founding Member being told a Premium
  // feature is locked is the single worst possible entitlement bug: they paid
  // the most and got refused.
  const user = { id: 'u-lifetime', email: 'lifetime@example.com' };
  await setGrant(user.id, { status: 'active', plan: 'early_supporter', expiresAt: null });
  const gate = await requireFeature(userEvent(user), 'advancedAnalytics');
  assert.equal(gate.allowed, true);
  assert.equal((await resolveTier(userEvent(user))).premium, true);
});
