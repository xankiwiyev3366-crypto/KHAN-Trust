// Tests for the provider abstraction (Phase 2). Pure/async, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withTimeout, settleProvider, firstValue, collectSources, DEFAULT_PROVIDER_TIMEOUT_MS } from './providers.js';

const delay = (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms));

test('withTimeout: resolves when the promise settles in time', async () => {
  const result = await withTimeout(delay(5, 'ok'), 100);
  assert.equal(result, 'ok');
});

test('withTimeout: rejects when the promise is too slow', async () => {
  await assert.rejects(() => withTimeout(delay(100, 'late'), 10), /provider timeout/);
});

test('settleProvider: returns the value on success', async () => {
  const r = await settleProvider(() => delay(1, { holderCount: 42 }), { label: 'Jupiter', timeoutMs: 100 });
  assert.deepEqual(r, { ok: true, value: { holderCount: 42 }, source: 'Jupiter', error: null });
});

test('settleProvider: a throwing provider degrades to null, never throws', async () => {
  const r = await settleProvider(() => { throw new Error('boom'); }, { label: 'DexScreener' });
  assert.equal(r.ok, false);
  assert.equal(r.value, null);
  assert.equal(r.source, 'DexScreener');
  assert.match(r.error, /boom/);
});

test('settleProvider: a hung provider times out to null instead of hanging', async () => {
  const r = await settleProvider(() => delay(1000, 'never-seen'), { label: 'SlowRPC', timeoutMs: 15 });
  assert.equal(r.ok, false);
  assert.equal(r.value, null);
  assert.match(r.error, /timeout/);
});

test('settleProvider: null result is ok:false but not an error', async () => {
  const r = await settleProvider(() => null, { label: 'GoPlus' });
  assert.equal(r.ok, false);
  assert.equal(r.value, null);
  assert.equal(r.error, null);
});

test('firstValue: first defined non-null candidate wins (provider priority)', () => {
  assert.equal(firstValue(null, undefined, 0, 5), 0, '0 is a valid value, not skipped');
  assert.equal(firstValue(null, undefined, 'x'), 'x');
  assert.equal(firstValue(null, undefined), null);
});

test('collectSources: dedupes and drops empties, flattening arrays', () => {
  assert.deepEqual(
    collectSources('CoinGecko', ['DexScreener', null, 'CoinGecko'], '', 'Jupiter'),
    ['CoinGecko', 'DexScreener', 'Jupiter'],
  );
});

test('DEFAULT_PROVIDER_TIMEOUT_MS is a sane bound', () => {
  assert.ok(DEFAULT_PROVIDER_TIMEOUT_MS >= 3000 && DEFAULT_PROVIDER_TIMEOUT_MS <= 20000);
});
