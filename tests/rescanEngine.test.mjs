// Tests for the re-scan engine — the thing that makes the alert loop able to
// fire for a token nobody is looking at.
//
// The properties under test are mostly about what the engine REFUSES to do.
// A worker that observes enthusiastically is worse than no worker: every
// observation it writes becomes the baseline for an email that tells a user
// their money is in danger.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  rescanToken,
  rescanAll,
  distinctWatchedTokens,
  normalizeChain,
  RESCAN_ENGINE_VERSION,
} from '../netlify/functions/_rescanEngine.mjs';

const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

function stubFetch(routes) {
  return async (url) => {
    for (const [pattern, responder] of Object.entries(routes)) {
      if (url.includes(pattern)) return responder(url);
    }
    throw new Error(`unstubbed url: ${url}`);
  };
}
const json = (body) => () => ({ ok: true, status: 200, json: async () => body });
const httpError = (status) => () => ({ ok: false, status, json: async () => ({}) });

const DEX_HEALTHY = json([{
  chainId: 'solana', baseToken: { address: BONK },
  liquidity: { usd: 500000 }, volume: { h24: 2000000 },
  pairCreatedAt: Date.parse('2022-12-25T00:00:00Z'),
}]);
const DEX_RUGGED = json([]);
const GOPLUS_HEALTHY = json({
  result: { [BONK]: { holder_count: 500000, holders: [{ percent: '0.05' }], mintable: { status: '0' }, freezable: { status: '0' } } },
});

const WATCHED = { identity: `c:${BONK}`, contract: BONK, chain: 'Solana', name: 'Bonk', ticker: 'BONK' };
const ok = { fetchImpl: stubFetch({ dexscreener: DEX_HEALTHY, gopluslabs: GOPLUS_HEALTHY }) };

// ── Chain normalization ───────────────────────────────────────────────────────

test('watched tokens store a chain LABEL, and the engine must accept it', () => {
  // The integration bug this guards: alerts-subscribe stores whatever
  // chainLabelFor() produced — "Solana", "BSC" — while the providers key off
  // lowercase ids. Without normalization every token is declined as
  // unsupported_chain and the worker runs perfectly while doing nothing at all,
  // which is exactly the silent-failure mode this workstream exists to end.
  assert.equal(normalizeChain('Solana'), 'solana');
  assert.equal(normalizeChain('BSC'), 'bsc');
  assert.equal(normalizeChain('Ethereum'), 'ethereum');
  assert.equal(normalizeChain('Arbitrum'), 'arbitrum');
});

test('chain ids still work, and unknown chains are declined not guessed', () => {
  assert.equal(normalizeChain('solana'), 'solana');
  assert.equal(normalizeChain('bsc'), 'bsc');
  assert.equal(normalizeChain('BNB Chain'), 'bsc');
  assert.equal(normalizeChain('Dogechain'), null);
  assert.equal(normalizeChain(''), null);
  assert.equal(normalizeChain(undefined), null);
});

// ── Observing ─────────────────────────────────────────────────────────────────

test('a healthy token produces a stamped snapshot', async () => {
  const result = await rescanToken(WATCHED, ok);

  assert.equal(result.ok, true);
  assert.equal(result.snapshot.identity, `c:${BONK}`);
  assert.equal(typeof result.snapshot.trustScore, 'number');
  assert.ok(['Low', 'Medium', 'High'].includes(result.snapshot.riskLevel));
  assert.equal(result.snapshot.chain, 'solana', 'the label is normalized on the way in');

  // The provenance stamps are what keep the lanes apart.
  assert.equal(result.snapshot.source, 'server_rescan', 'must be distinguishable from a client_scan record');
  assert.equal(result.snapshot.engineVersion, RESCAN_ENGINE_VERSION);
  assert.ok(result.snapshot.observedAt);
});

test('the raw signals travel with the snapshot', async () => {
  // So alerts-run can say WHY ("liquidity dropped 80%") without re-fetching,
  // and so a later scoring change cannot retroactively erase the evidence
  // behind an alert we already sent.
  const { snapshot } = await rescanToken(WATCHED, ok);
  assert.equal(snapshot.signals.totalLiquidityUsd, 500000);
  assert.equal(snapshot.signals.holderCount, 500000);
  assert.equal(snapshot.signals.mintAuthorityEnabled, false);
});

test('a rug — every pool pulled — is observed, not skipped', async () => {
  // THE most important alert this system will ever send. Zero liquidity is a
  // real observation and must produce a snapshot with a real zero, so the next
  // comparison sees the collapse.
  const result = await rescanToken(WATCHED, {
    fetchImpl: stubFetch({ dexscreener: DEX_RUGGED, gopluslabs: GOPLUS_HEALTHY }),
  });

  assert.equal(result.ok, true, 'a rugged token must still be observed');
  assert.equal(result.snapshot.signals.totalLiquidityUsd, 0);
  assert.equal(result.snapshot.signals.poolCount, 0);
});

// ── Refusing ──────────────────────────────────────────────────────────────────

test('an incomplete fetch produces NO snapshot', async () => {
  // The core safety property. tests/trustScore.test.mjs pins that an outage
  // alone moves a healthy token 91 -> 72, past the 10-point alert threshold, so
  // a snapshot built from a partial fetch is a false alert waiting for a cron
  // tick. Declining costs one hour. Lying costs the user.
  const result = await rescanToken(WATCHED, {
    fetchImpl: stubFetch({ dexscreener: httpError(500), gopluslabs: GOPLUS_HEALTHY }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.snapshot, undefined, 'no snapshot may escape a failed fetch');
  assert.equal(result.reason, 'incomplete');
  assert.ok(result.failures.some((f) => f.includes('dexscreener')), 'the failure must be attributable');
});

test('a token with no contract is declined without a network call', async () => {
  // Manually-added projects ("id:*" identities) have nothing to observe
  // on-chain. Not an error — just nothing to do.
  const result = await rescanToken(
    { identity: 'id:my-project', chain: 'Solana', name: 'Manual' },
    { fetchImpl: () => { throw new Error('must not fetch'); } },
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no_contract');
});

test('an unsupported chain is declined without a network call', async () => {
  const result = await rescanToken(
    { identity: 'c:xyz', contract: 'xyz', chain: 'Dogechain' },
    { fetchImpl: () => { throw new Error('must not fetch'); } },
  );
  assert.equal(result.ok, false);
  assert.match(result.reason, /unsupported_chain/);
});

test('a provider throwing does not escape as an exception', async () => {
  // rescanAll iterates every watched token. One token blowing up must not
  // abort the run and strand every other user's alerts.
  const result = await rescanToken(WATCHED, {
    fetchImpl: () => { throw new Error('boom'); },
  });
  assert.equal(result.ok, false, 'must be a declined result, not a thrown error');
});

// ── Fan-out ───────────────────────────────────────────────────────────────────

test('ten users watching one token is ONE re-scan', () => {
  // Work must scale with tokens watched, not users watching, or the cost of
  // the retention loop grows with its success.
  const subs = Array.from({ length: 10 }, (_, i) => ({ userId: `u${i}`, tokens: [WATCHED] }));
  assert.equal(distinctWatchedTokens(subs).length, 1);
});

test('distinct tokens across users are all collected', () => {
  const subs = [
    { userId: 'u1', tokens: [{ identity: 'a' }, { identity: 'b' }] },
    { userId: 'u2', tokens: [{ identity: 'b' }, { identity: 'c' }] },
    { userId: 'u3', tokens: [] },
    null,
    { userId: 'u4' },
  ];
  assert.deepEqual(distinctWatchedTokens(subs).map((t) => t.identity).sort(), ['a', 'b', 'c']);
});

test('a bad token in the batch does not sink the good ones', async () => {
  const tokens = [
    WATCHED,
    { identity: 'id:manual', chain: 'Solana' },
    { identity: 'c:bad', contract: 'bad', chain: 'Dogechain' },
  ];
  const { results, observed, declined } = await rescanAll(tokens, ok);

  assert.equal(results.length, 3);
  assert.equal(observed, 1, 'the healthy token is still observed');
  assert.equal(declined, 2);
});

test('re-scanning is bounded, not a thundering herd at two free APIs', async () => {
  // Firing hundreds of parallel requests at DexScreener/GoPlus is how you get
  // rate-limited into an outage of your own alerting.
  let inFlight = 0;
  let peak = 0;
  const slow = async () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    return { ok: true, status: 200, json: async () => [] };
  };
  const tokens = Array.from({ length: 20 }, (_, i) => ({ ...WATCHED, identity: `c:t${i}` }));
  await rescanAll(tokens, { concurrency: 4, fetchImpl: stubFetch({ dexscreener: slow, gopluslabs: slow }) });

  // 4 tokens x 2 providers fired in parallel per batch.
  assert.ok(peak <= 8, `concurrency must stay bounded (peak was ${peak})`);
});
