// Tests for the re-scan worker's data acquisition layer.
//
// The centre of gravity here is one distinction: a provider that FAILED versus
// a provider that answered "nothing". Get that wrong in either direction and
// the retention loop becomes a liability:
//
//   failure read as zero  -> "your token got riskier" because an API timed out
//   zero read as failure  -> a real rug is silently skipped
//
// So most of these tests are about the failure taxonomy, not the happy path.
import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchVolatileSignals, fetchDexLiquidity, fetchTokenSecurity, SUPPORTED_CHAINS } from '../netlify/functions/_volatileSignals.mjs';

const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

// A fetch stub driven by a URL->response map, so no test touches the network.
function stubFetch(routes) {
  return async (url) => {
    for (const [pattern, responder] of Object.entries(routes)) {
      if (url.includes(pattern)) return responder(url);
    }
    throw new Error(`unstubbed url: ${url}`);
  };
}

const json = (body, status = 200) => () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const httpError = (status) => () => ({ ok: false, status, json: async () => ({}) });
const networkError = (message = 'ECONNRESET') => () => { throw new Error(message); };

const DEX_OK = json([
  {
    chainId: 'solana',
    baseToken: { address: BONK },
    liquidity: { usd: 500000 },
    volume: { h24: 2000000 },
    pairCreatedAt: Date.parse('2022-12-25T00:00:00Z'),
  },
  {
    chainId: 'solana',
    baseToken: { address: BONK },
    liquidity: { usd: 268592 },
    volume: { h24: 900000 },
    pairCreatedAt: Date.parse('2023-02-01T00:00:00Z'),
  },
]);

const GOPLUS_OK = json({
  result: {
    [BONK]: {
      holder_count: 1005204,
      holders: [{ percent: '0.0617' }, ...Array.from({ length: 9 }, () => ({ percent: '0.01' }))],
      mintable: { status: '0' },
      freezable: { status: '0' },
      closable: { status: '0' },
    },
  },
});

// ── Happy path ────────────────────────────────────────────────────────────────

test('a complete fetch produces data shaped for the scoring engine', async () => {
  const result = await fetchVolatileSignals(
    { contract: BONK, chain: 'solana' },
    { fetchImpl: stubFetch({ 'dexscreener': DEX_OK, 'gopluslabs': GOPLUS_OK }) },
  );

  assert.equal(result.ok, true);
  // Liquidity is SUMMED across pools, matching the client's fetchDexscreenerToken.
  assert.equal(result.value.totalLiquidityUsd, 768592);
  assert.equal(result.value.volume24hUsd, 2900000);
  assert.equal(result.value.poolCount, 2);
  assert.equal(result.value.holderCount, 1005204);
  assert.equal(result.value.topHolderPercent, 6.17);
  assert.equal(result.value.mintAuthorityEnabled, false);
  assert.equal(result.value.freezeAuthorityEnabled, false);
  assert.deepEqual(result.sources, ['dexscreener', 'goplus']);
});

test('token age is derived from the OLDEST pool, not the newest', async () => {
  // A rugger can spin up a fresh pool on an old token; taking the newest pair
  // would make an established token look newborn and vice versa.
  const result = await fetchVolatileSignals(
    { contract: BONK, chain: 'solana' },
    { fetchImpl: stubFetch({ 'dexscreener': DEX_OK, 'gopluslabs': GOPLUS_OK }) },
  );
  const expected = Math.floor((Date.now() - Date.parse('2022-12-25T00:00:00Z')) / 86400000);
  assert.equal(result.value.tokenAgeDays, expected);
});

// ── THE core distinction: empty vs failed ─────────────────────────────────────

test('no liquidity pools is a real observation of zero, not a failure', async () => {
  // This IS the rug signal. A watched token whose pools have all been pulled
  // must produce liquidity 0 and reach the scorer — if this were treated as a
  // failed fetch, the worker would skip the token and never fire the single
  // most important alert it exists to send.
  const result = await fetchVolatileSignals(
    { contract: BONK, chain: 'solana' },
    { fetchImpl: stubFetch({ 'dexscreener': json([]), 'gopluslabs': GOPLUS_OK }) },
  );

  assert.equal(result.ok, true, 'an empty pool list must NOT be an error');
  assert.equal(result.value.totalLiquidityUsd, 0, 'zero liquidity is a real, scoreable zero');
  assert.equal(result.value.poolCount, 0);
});

test('a failed liquidity fetch is NOT zero liquidity', async () => {
  // The inverse, and the dangerous one. If this ever returned ok:true with
  // liquidity 0, every watcher gets a rug alert the next time DexScreener has
  // a bad minute.
  for (const [label, responder] of [['http 500', httpError(500)], ['network', networkError()]]) {
    const result = await fetchVolatileSignals(
      { contract: BONK, chain: 'solana' },
      { fetchImpl: stubFetch({ 'dexscreener': responder, 'gopluslabs': GOPLUS_OK }) },
    );
    assert.equal(result.ok, false, `${label}: must decline to observe`);
    assert.equal(result.reason, 'incomplete');
    assert.ok(result.failures.some((f) => f.startsWith('dexscreener:')), `${label}: must name the failed provider`);
    assert.equal(result.value, undefined, `${label}: must not hand back partial data`);
  }
});

test('a failed security fetch also blocks the whole observation', async () => {
  const result = await fetchVolatileSignals(
    { contract: BONK, chain: 'solana' },
    { fetchImpl: stubFetch({ 'dexscreener': DEX_OK, 'gopluslabs': httpError(429) }) },
  );
  assert.equal(result.ok, false);
  assert.ok(result.failures.includes('goplus:http_429'), 'rate limiting must be reported, not swallowed');
});

test('a token GoPlus has never indexed is unknown, not clean', async () => {
  // An empty result map means "no data about this token". Scoring that as
  // "no mint authority, no freeze authority" would invent a safety claim.
  const result = await fetchVolatileSignals(
    { contract: BONK, chain: 'solana' },
    { fetchImpl: stubFetch({ 'dexscreener': DEX_OK, 'gopluslabs': json({ result: {} }) }) },
  );
  assert.equal(result.ok, false);
  assert.ok(result.failures.includes('goplus:not_indexed'));
});

test('both providers failing reports both, not just the first', async () => {
  const result = await fetchVolatileSignals(
    { contract: BONK, chain: 'solana' },
    { fetchImpl: stubFetch({ 'dexscreener': httpError(503), 'gopluslabs': httpError(503) }) },
  );
  assert.equal(result.failures.length, 2, 'diagnosing a bad run needs the full picture');
});

// ── Unknown stays unknown ─────────────────────────────────────────────────────

test('an omitted authority flag is null, never false', async () => {
  // scoreSecurity(null,null,null) returns null (unknown). scoreSecurity(false,
  // false,false) returns 92 (clean). Turning "GoPlus didn't say" into "clean"
  // would be a fabricated all-clear on the single most security-relevant field.
  const goplus = json({ result: { [BONK]: { holder_count: 100, holders: [{ percent: '0.5' }] } } });
  const result = await fetchVolatileSignals(
    { contract: BONK, chain: 'solana' },
    { fetchImpl: stubFetch({ 'dexscreener': DEX_OK, 'gopluslabs': goplus }) },
  );
  assert.equal(result.ok, true);
  assert.equal(result.value.mintAuthorityEnabled, null, 'unknown authority must stay null');
  assert.equal(result.value.freezeAuthorityEnabled, null);
});

test('a live mint authority is reported as true', async () => {
  const goplus = json({
    result: { [BONK]: { holder_count: 100, holders: [{ percent: '0.5' }], mintable: { status: '1' }, freezable: { status: '1' } } },
  });
  const result = await fetchVolatileSignals(
    { contract: BONK, chain: 'solana' },
    { fetchImpl: stubFetch({ 'dexscreener': DEX_OK, 'gopluslabs': goplus }) },
  );
  assert.equal(result.value.mintAuthorityEnabled, true);
  assert.equal(result.value.freezeAuthorityEnabled, true);
});

// ── Timeouts ──────────────────────────────────────────────────────────────────

test('a hanging provider times out rather than wedging the worker', async () => {
  // The worker iterates every watched token on a cron with a hard runtime cap.
  // One hanging request must not consume the whole budget.
  const hang = () => new Promise(() => {});
  const result = await fetchVolatileSignals(
    { contract: BONK, chain: 'solana' },
    { fetchImpl: stubFetch({ 'dexscreener': hang, 'gopluslabs': GOPLUS_OK }), timeoutMs: 40 },
  );
  assert.equal(result.ok, false);
  assert.ok(result.failures.includes('dexscreener:timeout'));
});

// ── Input guards ──────────────────────────────────────────────────────────────

test('unsupported chains are declined, not guessed at', async () => {
  const result = await fetchVolatileSignals({ contract: BONK, chain: 'dogechain' }, { fetchImpl: stubFetch({}) });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unsupported_chain');
});

test('a missing contract is declined', async () => {
  const result = await fetchVolatileSignals({ contract: '', chain: 'solana' }, { fetchImpl: stubFetch({}) });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no_contract');
});

test('solana and the GoPlus EVM chains are supported', () => {
  for (const chain of ['solana', 'ethereum', 'bsc', 'base', 'arbitrum', 'polygon']) {
    assert.ok(SUPPORTED_CHAINS.has(chain), `${chain} must be watchable`);
  }
});

// ── Provider-level detail ─────────────────────────────────────────────────────

test('liquidity only counts pools for the requested chain and token', async () => {
  // DexScreener can return pools for a same-address token on another chain, and
  // pools where our token is neither side. Counting those would inflate
  // liquidity and mask a real drain.
  const noisy = json([
    { chainId: 'solana', baseToken: { address: BONK }, liquidity: { usd: 1000 }, volume: { h24: 10 } },
    { chainId: 'ethereum', baseToken: { address: BONK }, liquidity: { usd: 999999 }, volume: { h24: 10 } },
    { chainId: 'solana', baseToken: { address: 'SOMETHINGELSE' }, quoteToken: { address: 'OTHER' }, liquidity: { usd: 555555 }, volume: { h24: 10 } },
  ]);
  const result = await fetchDexLiquidity(BONK, 'solana', { fetchImpl: stubFetch({ 'dexscreener': noisy }), timeoutMs: 1000 });
  assert.equal(result.value.totalLiquidityUsd, 1000, 'only this token, on this chain');
  assert.equal(result.value.poolCount, 1);
});

test('the token is matched whether it is the base or the quote side', async () => {
  const asQuote = json([
    { chainId: 'solana', baseToken: { address: 'OTHER' }, quoteToken: { address: BONK }, liquidity: { usd: 4200 }, volume: { h24: 5 } },
  ]);
  const result = await fetchDexLiquidity(BONK, 'solana', { fetchImpl: stubFetch({ 'dexscreener': asQuote }), timeoutMs: 1000 });
  assert.equal(result.value.totalLiquidityUsd, 4200);
});

test('EVM security uses the lowercased address and the right chain id', async () => {
  const addr = '0xAbCdEf0000000000000000000000000000000123';
  let captured = '';
  const capture = (url) => { captured = url; return { ok: true, status: 200, json: async () => ({ result: { [addr.toLowerCase()]: { holder_count: 5, holders: [], is_mintable: '1' } } }) }; };
  const result = await fetchTokenSecurity(addr, 'bsc', { fetchImpl: stubFetch({ 'gopluslabs': capture }), timeoutMs: 1000 });
  assert.match(captured, /token_security\/56/, 'bsc must map to GoPlus chain id 56');
  assert.match(captured, /0xabcdef/, 'EVM addresses are lowercased for GoPlus');
  assert.equal(result.value.mintAuthorityEnabled, true);
});
