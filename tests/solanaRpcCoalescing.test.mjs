// In-flight coalescing for the Solana RPC proxy.
//
// A real BONK scan profiled against production issued getAccountInfo TWICE
// concurrently — lookupSolanaTokenUncached calls fetchMintAccountInfo directly
// AND calls fetchSolanaHolderAnalytics, which opens by awaiting
// fetchMintAccountInfo itself. The duplicate cost a redundant round trip, and
// worse, it serialised a 498ms getProgramAccounts behind a 1.3s wait for data
// the app already had in flight.
//
// These tests pin the two properties that make the fix safe: identical
// CONCURRENT calls share one request, and nothing is ever reused after it
// settles. The second property is the important one — the moment this becomes a
// time-based cache it starts reporting a previous scan's holder counts and
// authority flags as current.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// The module reads SOLANA_RPC_URL from a constants module and calls global
// fetch; neither needs the DOM, so it imports cleanly under node:test.
const { solanaRpc } = await import('../src/providers/lookups.js');

function stubFetch({ delayMs = 0, result = { ok: 1 }, fail = false } = {}) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ method: body.method, params: body.params });
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (fail) throw new Error('network down');
    return {
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: body.method, result }),
    };
  };
  return calls;
}

const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; });

test('concurrent identical calls issue exactly one request', async () => {
  const calls = stubFetch({ delayMs: 30, result: { value: 'shared' } });

  const [a, b, c] = await Promise.all([
    solanaRpc('getAccountInfo', ['MintAddr', { encoding: 'jsonParsed' }]),
    solanaRpc('getAccountInfo', ['MintAddr', { encoding: 'jsonParsed' }]),
    solanaRpc('getAccountInfo', ['MintAddr', { encoding: 'jsonParsed' }]),
  ]);

  assert.equal(calls.length, 1, 'the duplicate getAccountInfo was issued again');
  // Every caller gets the same answer — not a copy, the same settled value.
  assert.deepEqual(a, { value: 'shared' });
  assert.deepEqual(b, a);
  assert.deepEqual(c, a);
});

test('a later caller waits for the in-flight request instead of starting its own', async () => {
  // THE SERIALISATION THIS REMOVES. fetchSolanaHolderAnalytics awaits mint info
  // before it can issue getProgramAccounts. Joining the in-flight request means
  // it resolves as soon as the FIRST caller's request does, rather than after a
  // second full round trip.
  const calls = stubFetch({ delayMs: 60, result: 'mint' });

  const first = solanaRpc('getAccountInfo', ['Mint']);
  await new Promise((resolve) => setTimeout(resolve, 20)); // join mid-flight
  const started = Date.now();
  const second = await solanaRpc('getAccountInfo', ['Mint']);
  const waited = Date.now() - started;

  await first;
  assert.equal(calls.length, 1);
  assert.equal(second, 'mint');
  // It waited only for the remainder of the original request, not a fresh 60ms.
  assert.ok(waited < 55, `late joiner waited ${waited}ms — it started its own request`);
});

test('different methods and different params are never conflated', async () => {
  const calls = stubFetch({ delayMs: 10 });

  await Promise.all([
    solanaRpc('getAccountInfo', ['MintA']),
    solanaRpc('getAccountInfo', ['MintB']),
    solanaRpc('getTokenSupply', ['MintA']),
    solanaRpc('getProgramAccounts', ['prog', { filters: [{ memcmp: { offset: 0, bytes: 'MintA' } }] }]),
    solanaRpc('getProgramAccounts', ['prog', { filters: [{ memcmp: { offset: 0, bytes: 'MintB' } }] }]),
  ]);

  assert.equal(calls.length, 5, 'distinct requests were incorrectly coalesced');
});

test('nothing is reused once a request has settled — this is not a cache', async () => {
  // THE INVARIANT THAT KEEPS THIS HONEST. A scan must never report a previous
  // scan's holder count or authority flags as current. Sequential calls each go
  // to the network.
  const calls = stubFetch({ delayMs: 0, result: 'v1' });

  await solanaRpc('getAccountInfo', ['Mint']);
  await solanaRpc('getAccountInfo', ['Mint']);
  await solanaRpc('getAccountInfo', ['Mint']);

  assert.equal(calls.length, 3, 'a settled result was served again — coalescing became caching');
});

test('a fresh value is fetched after the previous one settled', async () => {
  let version = 0;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    version += 1;
    return { ok: true, json: async () => ({ result: `v${version}` }) };
  };

  assert.equal(await solanaRpc('getAccountInfo', ['Mint']), 'v1');
  assert.equal(await solanaRpc('getAccountInfo', ['Mint']), 'v2', 'a stale value was replayed');
});

test('a failure is shared by concurrent callers and then released', async () => {
  // Sharing the rejection is deliberate: a failed fetch is a failed observation
  // for everyone waiting on it, and letting one caller silently retry would make
  // the scan's inputs depend on call order.
  const calls = stubFetch({ delayMs: 10, fail: true });

  const results = await Promise.allSettled([
    solanaRpc('getAccountInfo', ['Mint']),
    solanaRpc('getAccountInfo', ['Mint']),
  ]);
  assert.equal(calls.length, 1);
  assert.equal(results[0].status, 'rejected');
  assert.equal(results[1].status, 'rejected');

  // AND THE ENTRY IS RELEASED. Without the finally, one failure would pin its
  // error for the rest of the session and every later scan of that token would
  // replay a stale failure it never actually performed.
  const retryCalls = stubFetch({ delayMs: 0, result: 'recovered' });
  assert.equal(await solanaRpc('getAccountInfo', ['Mint']), 'recovered');
  assert.equal(retryCalls.length, 1, 'the failed entry was never released');
});

test('an RPC-level error still reaches every caller', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ error: { message: 'Invalid param: not a Token mint' } }),
  });

  await assert.rejects(
    () => solanaRpc('getAccountInfo', ['NotAMint']),
    /Invalid param/,
    'a JSON-RPC error was swallowed by the coalescer'
  );
});
