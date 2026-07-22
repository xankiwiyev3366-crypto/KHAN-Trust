// Multi-chain identity safety for token history / watch / alerts.
//
// The bug this pins: the same address (e.g. an 0x… token) can be deployed on
// several EVM chains. If the identity ignores the chain, their score history,
// watch snapshots and alerts collide onto one key and corrupt each other.
// Solana must stay on its original bare key so no pre-multichain record orphans.
import test from 'node:test';
import assert from 'node:assert/strict';

import { historyKeyFor } from '../src/scoreHistory.js';

test('Solana keeps its original bare identity (backward compatible)', () => {
  const key = historyKeyFor({ chainId: 'solana', contract: 'So11111111111111111111111111111111111111112' });
  assert.equal(key, 'c:so11111111111111111111111111111111111111112');
});

test('a project with no chainId still produces the legacy bare key', () => {
  // Pre-multichain stored records had no chainId — they must not shift keys.
  const key = historyKeyFor({ contract: 'So11111111111111111111111111111111111111112' });
  assert.equal(key.startsWith('c:'), true);
  assert.equal(key.includes(':', 2), false, 'no chain prefix for a chainless (legacy) record');
});

test('the SAME EVM address on two chains gets DIFFERENT identities', () => {
  const addr = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
  const eth = historyKeyFor({ chainId: 'ethereum', contract: addr });
  const base = historyKeyFor({ chainId: 'base', contract: addr });
  assert.notEqual(eth, base, 'must not collide across chains');
  assert.equal(eth, 'c:ethereum:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2');
  assert.equal(base, 'c:base:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2');
});

test('the chain-prefixed identity is accepted by the server IDENTITY_PATTERN', () => {
  const PATTERN = /^(c:([a-z0-9]+:)?[a-z0-9]{6,90}|id:[a-z0-9-]{3,80})$/i;
  assert.match(historyKeyFor({ chainId: 'ethereum', contract: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' }), PATTERN);
  assert.match(historyKeyFor({ chainId: 'aptos', contract: '0x1::aptos_coin::AptosCoin'.toLowerCase() }), /^c:aptos:/);
  assert.match(historyKeyFor({ chainId: 'solana', contract: 'So11111111111111111111111111111111111111112' }), PATTERN);
});
