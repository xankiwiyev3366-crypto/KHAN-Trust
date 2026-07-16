// End-to-end tests for the retention loop.
//
// This is the capstone of the re-scan work, and it exists because the loop was
// broken in production for its entire life while every other signal was green.
// alerts-run.mjs had NO tests at all — which is precisely how a function can
// describe itself as "the single strongest reason to return to KHAN Trust" and
// be structurally incapable of firing.
//
// These drive the REAL alerts-run handler against the REAL _alertsStore and
// _watchSnapshotStore. Only two things are faked: the blob backend (an
// in-memory map, same semantics) and the email transport (captured, not sent).
// So what is under test is the actual wiring, not a model of it.
//
// The two properties that matter most:
//
//   1. An alert fires for a token NOBODY HAS LOOKED AT. That is the whole fix.
//      The old loop could only see tokens a human had just viewed.
//   2. Switching to the watch lane does NOT email every existing subscriber.
//      Their baselines were recorded against client-lane scores, which are a
//      different number for the same token (BONK: 35 vs 76 on live data). A
//      naive cutover would have sent a rug alert to every engaged user.
//
// Run with: node --experimental-test-module-mocks --test (see npm test).
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// In-memory stand-in for Netlify Blobs, shared by every namespace the way the
// real client hands out one store per name.
class FakeStore {
  constructor() { this.data = new Map(); }
  async setJSON(key, value) { this.data.set(key, JSON.parse(JSON.stringify(value))); }
  async get(key) { return this.data.has(key) ? JSON.parse(JSON.stringify(this.data.get(key))) : null; }
  async list({ prefix } = {}) {
    return { blobs: Array.from(this.data.keys()).filter((k) => !prefix || k.startsWith(prefix)).map((key) => ({ key })) };
  }
  async delete(key) { this.data.delete(key); }
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

const sent = [];
mock.module('../netlify/functions/_email.mjs', {
  namedExports: {
    isEmailConfigured: () => true,
    sendEmail: async (message) => { sent.push(message); return { ok: true }; },
  },
});

const { handler } = await import('../netlify/functions/alerts-run.mjs');
const { saveSubscription } = await import('../netlify/functions/_alertsStore.mjs');
const { putWatchSnapshot } = await import('../netlify/functions/_watchSnapshotStore.mjs');
const { RESCAN_ENGINE_VERSION } = await import('../netlify/functions/_rescanEngine.mjs');

const IDENTITY = 'c:DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

function reset() {
  stores.clear();
  sent.length = 0;
}

// A snapshot as the re-scan worker writes it.
function snapshot({ trustScore, riskLevel, liquidity = 500000, topHolder = 5, mint = false }) {
  return {
    identity: IDENTITY,
    contract: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    chain: 'solana',
    name: 'Bonk',
    ticker: 'BONK',
    trustScore,
    riskLevel,
    signals: {
      totalLiquidityUsd: liquidity,
      poolCount: liquidity > 0 ? 1 : 0,
      holderCount: 500000,
      topHolderPercent: topHolder,
      mintAuthorityEnabled: mint,
      freezeAuthorityEnabled: false,
    },
    source: 'server_rescan',
    engineVersion: RESCAN_ENGINE_VERSION,
    observedAt: new Date().toISOString(),
  };
}

// A baseline as alerts-run stores it after a run.
function baseline({ score, riskLevel, liquidity = 500000, topHolder = 5, mint = false, source = 'server_rescan', engineVersion = RESCAN_ENGINE_VERSION }) {
  return {
    score,
    riskLevel,
    signals: { totalLiquidityUsd: liquidity, holderCount: 500000, topHolderPercent: topHolder, mintAuthorityEnabled: mint, freezeAuthorityEnabled: false },
    source,
    engineVersion,
    at: new Date(Date.now() - 3600000).toISOString(),
  };
}

async function subscribe(lastNotified = {}) {
  await saveSubscription({
    userId: 'u1',
    email: 'watcher@example.com',
    tokens: [{ identity: IDENTITY, contract: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', chain: 'Solana', name: 'Bonk', ticker: 'BONK' }],
    lastNotified,
  });
}

// ── THE fix ───────────────────────────────────────────────────────────────────

test('an alert fires for a token nobody has looked at', async () => {
  // The entire point. No human viewed this token; the re-scan worker observed
  // it on a cron and the loop noticed. Under the old design this was
  // impossible: the corpus only updated on a client view, so a dormant token's
  // snapshot never moved and riskWorsened() was permanently false.
  reset();
  await subscribe({ [IDENTITY]: baseline({ score: 80, riskLevel: 'Low' }) });
  await putWatchSnapshot(IDENTITY, snapshot({ trustScore: 40, riskLevel: 'High', liquidity: 50000 }));

  const result = await handler();

  assert.equal(sent.length, 1, 'the watcher must be emailed');
  assert.match(sent[0].to, /watcher@example.com/);
  assert.match(sent[0].subject, /riskier/i);
  assert.match(sent[0].text, /Bonk/);
  assert.match(result.body, /notified 1/);
});

test('a rug — all liquidity pulled — is reported in plain language', async () => {
  reset();
  await subscribe({ [IDENTITY]: baseline({ score: 80, riskLevel: 'Low', liquidity: 500000 }) });
  await putWatchSnapshot(IDENTITY, snapshot({ trustScore: 20, riskLevel: 'High', liquidity: 0 }));

  await handler();

  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /all liquidity has been removed/i, 'the headline event must be named, not rendered as "dropped 100%"');
});

test('a re-enabled mint authority is explained as what it means', async () => {
  reset();
  await subscribe({ [IDENTITY]: baseline({ score: 80, riskLevel: 'Low', mint: false }) });
  await putWatchSnapshot(IDENTITY, snapshot({ trustScore: 55, riskLevel: 'Medium', mint: true }));

  await handler();

  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /mint authority has been re-enabled/i);
  assert.match(sent[0].text, /new supply can be created/i, 'a user should not need to know what "mint authority" is');
});

// ── The migration guard ───────────────────────────────────────────────────────

test('legacy client-lane baselines do NOT trigger a false alert', async () => {
  // THE cutover hazard. Every existing subscriber's lastNotified was recorded
  // against a client_scan score. On live data BONK is 35 in that lane and 76 in
  // this one — the same token, at the same instant, from a different input set.
  // Comparing them naively would read a 41-point methodology gap as a risk
  // collapse and email every engaged user a rug alert on the first tick.
  reset();
  // A legacy baseline: no source, no engineVersion, and a score from the other lane.
  await subscribe({ [IDENTITY]: { score: 76, riskLevel: 'Medium', at: new Date().toISOString() } });
  await putWatchSnapshot(IDENTITY, snapshot({ trustScore: 35, riskLevel: 'High' }));

  await handler();

  assert.equal(sent.length, 0, 'a legacy baseline is not comparable and MUST NOT alert');
});

test('after a legacy baseline is replaced, the next real drop DOES alert', async () => {
  // The guard must be a one-run re-baseline, not a permanent mute — otherwise
  // it would trade a false-alert storm for a silently dead loop, which is the
  // bug we started with.
  reset();
  await subscribe({ [IDENTITY]: { score: 76, riskLevel: 'Medium', at: new Date().toISOString() } });

  // Run 1: legacy baseline, healthy token. Silently re-baselines.
  await putWatchSnapshot(IDENTITY, snapshot({ trustScore: 80, riskLevel: 'Low' }));
  await handler();
  assert.equal(sent.length, 0, 'run 1 re-baselines without alerting');

  // Run 2: the token genuinely collapses.
  await putWatchSnapshot(IDENTITY, snapshot({ trustScore: 30, riskLevel: 'High', liquidity: 0 }));
  await handler();
  assert.equal(sent.length, 1, 'run 2 must alert — the loop is live, not muted');
});

test('a baseline from a different engine version is not comparable', async () => {
  // Same rule, applied across time. If the volatile input set changes, old
  // snapshots are a different methodology and must not be diffed against new
  // ones.
  reset();
  await subscribe({ [IDENTITY]: baseline({ score: 80, riskLevel: 'Low', engineVersion: RESCAN_ENGINE_VERSION + 1 }) });
  await putWatchSnapshot(IDENTITY, snapshot({ trustScore: 30, riskLevel: 'High' }));

  await handler();
  assert.equal(sent.length, 0, 'a methodology change must never present as a risk change');
});

// ── Not spamming ──────────────────────────────────────────────────────────────

test('a brand-new subscriber is never alerted on their first observation', async () => {
  reset();
  await subscribe({});
  await putWatchSnapshot(IDENTITY, snapshot({ trustScore: 20, riskLevel: 'High', liquidity: 0 }));

  await handler();
  assert.equal(sent.length, 0, 'the first observation is a baseline, not news');
});

test('the same worsening is not re-sent every hour', async () => {
  reset();
  await subscribe({ [IDENTITY]: baseline({ score: 80, riskLevel: 'Low' }) });
  await putWatchSnapshot(IDENTITY, snapshot({ trustScore: 40, riskLevel: 'High' }));

  await handler();
  assert.equal(sent.length, 1);

  // Nothing changed since; the worker re-observed the same state.
  await handler();
  assert.equal(sent.length, 1, 'a user must not be emailed hourly about one event');
});

test('an improving token does not alert', async () => {
  reset();
  await subscribe({ [IDENTITY]: baseline({ score: 40, riskLevel: 'High' }) });
  await putWatchSnapshot(IDENTITY, snapshot({ trustScore: 85, riskLevel: 'Low' }));

  await handler();
  assert.equal(sent.length, 0, 'good news is not an alert');
});

test('a drop below the threshold does not alert', async () => {
  // Noise discipline: an 8-point wobble is not an event worth an email.
  reset();
  await subscribe({ [IDENTITY]: baseline({ score: 80, riskLevel: 'Low' }) });
  await putWatchSnapshot(IDENTITY, snapshot({ trustScore: 73, riskLevel: 'Low' }));

  await handler();
  assert.equal(sent.length, 0);
});

// ── Absence ───────────────────────────────────────────────────────────────────

test('a token the worker has never managed to observe is skipped, not guessed at', async () => {
  // The worker declines to score partial fetches, so a watched token can have
  // no snapshot. That is "we do not know", and it must produce silence rather
  // than an invented verdict.
  reset();
  await subscribe({ [IDENTITY]: baseline({ score: 80, riskLevel: 'Low' }) });
  // No putWatchSnapshot at all.

  const result = await handler();
  assert.equal(sent.length, 0);
  assert.match(result.body, /notified 0/);
});

test('no subscriptions is a clean no-op', async () => {
  reset();
  const result = await handler();
  assert.equal(sent.length, 0);
  assert.equal(result.statusCode, 200);
});

// ── Multiple watchers ─────────────────────────────────────────────────────────

test('every watcher of a collapsing token is notified', async () => {
  reset();
  for (const id of ['u1', 'u2', 'u3']) {
    await saveSubscription({
      userId: id,
      email: `${id}@example.com`,
      tokens: [{ identity: IDENTITY, contract: 'Dez', chain: 'Solana', name: 'Bonk', ticker: 'BONK' }],
      lastNotified: { [IDENTITY]: baseline({ score: 80, riskLevel: 'Low' }) },
    });
  }
  await putWatchSnapshot(IDENTITY, snapshot({ trustScore: 20, riskLevel: 'High', liquidity: 0 }));

  await handler();

  assert.equal(sent.length, 3, 'one re-scan, three notifications');
  assert.deepEqual(sent.map((m) => m.to).sort(), ['u1@example.com', 'u2@example.com', 'u3@example.com']);
});
