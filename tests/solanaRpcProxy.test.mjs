// The proxy exists to keep a provider credential off the client. That is only
// worth anything if the proxy itself cannot be used as a free relay, so these
// tests pin the refusal surface rather than the happy path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRpcRequest, ALLOWED_METHODS } from '../netlify/functions/solana-rpc.mjs';

test('accepts exactly the read-only methods the scanner calls', () => {
  for (const method of ['getTokenSupply', 'getTokenLargestAccounts', 'getAccountInfo', 'getProgramAccounts', 'getSignaturesForAddress']) {
    assert.equal(validateRpcRequest({ method, params: [] }).ok, true, method);
  }
});

test('refuses transaction submission and any other unlisted method', () => {
  for (const method of ['sendTransaction', 'requestAirdrop', 'simulateTransaction', 'signatureSubscribe', 'getBlock', '']) {
    assert.equal(validateRpcRequest({ method }).ok, false, `${method || '<empty>'} must be refused`);
  }
});

test('the allowlist contains no write method', () => {
  for (const method of ALLOWED_METHODS) {
    assert.ok(method.startsWith('get'), `${method} is not a read method`);
  }
});

test('refuses batched requests — one call must not fan out upstream', () => {
  const batch = [{ method: 'getTokenSupply', params: [] }, { method: 'getTokenSupply', params: [] }];
  assert.equal(validateRpcRequest(batch).ok, false);
});

test('refuses malformed bodies without throwing', () => {
  assert.equal(validateRpcRequest(null).ok, false);
  assert.equal(validateRpcRequest(undefined).ok, false);
  assert.equal(validateRpcRequest('getTokenSupply').ok, false);
  assert.equal(validateRpcRequest({}).ok, false);
  assert.equal(validateRpcRequest({ method: 123 }).ok, false);
});

test('refuses non-array params', () => {
  assert.equal(validateRpcRequest({ method: 'getTokenSupply', params: { address: 'x' } }).ok, false);
  assert.equal(validateRpcRequest({ method: 'getTokenSupply' }).ok, true, 'omitted params is fine');
});
