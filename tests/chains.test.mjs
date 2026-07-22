// Tests for the multi-chain registry + detection.
//
// Two invariants matter most and are each pinned below:
//   1. Detection can never be WRONG about the family from an address format,
//      and it must refuse (null) rather than guess when nothing matches — a
//      guessed chain would scan the wrong network and fabricate a verdict.
//   2. `chainSupports` fails CLOSED — an unknown chain or an unknown capability
//      is unsupported, so the UI shows "Not supported on this chain" rather
//      than inventing a metric the adapter cannot back (requirement 5).
import test from 'node:test';
import assert from 'node:assert/strict';

import { detectChain, looksLikeContractAddress, isResolvedChain } from '../src/chains/detect.js';
import {
  CHAINS, SUPPORTED_CHAIN_IDS, EVM_CHAIN_IDS, CAPABILITY_KEYS,
  chainSupports, explorerTokenUrl, chainFamily, isSupportedChain,
} from '../src/chains/registry.js';

test('a real Solana mint resolves to Solana, certainly', () => {
  const d = detectChain('6bSHkoMYqzyCZdWPQ45nUv73dvdfx4yEd4yEemefpump');
  assert.equal(d.family, 'solana');
  assert.deepEqual(d.candidates, ['solana']);
  assert.equal(d.resolved, true, 'Solana is the one format detection is certain about');
});

test('an EVM address resolves to the EVM family but NOT a single chain', () => {
  const d = detectChain('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
  assert.equal(d.family, 'evm');
  assert.equal(d.resolved, false, 'the same 20-byte address exists on every EVM chain');
  assert.ok(d.candidates.includes('ethereum') && d.candidates.includes('base'));
});

test('a Move 32-byte address is ambiguous between Sui and Aptos', () => {
  const d = detectChain('0x' + 'a'.repeat(64));
  assert.equal(d.family, 'move');
  assert.deepEqual(d.candidates, ['sui', 'aptos']);
  assert.equal(d.resolved, false);
});

test('a Move coin type is detected', () => {
  assert.equal(detectChain('0x2::sui::SUI').family, 'move');
  assert.equal(detectChain('0x1::aptos_coin::AptosCoin').family, 'move');
});

test('garbage input is refused, never guessed', () => {
  assert.equal(detectChain('not-an-address'), null);
  assert.equal(detectChain(''), null);
  assert.equal(detectChain(null), null);
  assert.equal(looksLikeContractAddress('hello world'), false);
  assert.equal(isResolvedChain('0xabc'), false);
});

test('every supported chain exists in the registry with a full capability map', () => {
  for (const id of SUPPORTED_CHAIN_IDS) {
    assert.ok(CHAINS[id], `${id} must be registered`);
    for (const cap of CAPABILITY_KEYS) {
      assert.equal(typeof CHAINS[id].capabilities[cap], 'boolean', `${id}.${cap} must be an explicit boolean`);
    }
  }
});

test('all six headline EVM chains share the SAME capability object (one adapter)', () => {
  const evm = SUPPORTED_CHAIN_IDS.filter((id) => CHAINS[id].family === 'evm');
  assert.ok(evm.length >= 6, 'ethereum, base, bsc, arbitrum, optimism, polygon');
  const ref = CHAINS.ethereum.capabilities;
  for (const id of evm) {
    assert.equal(CHAINS[id].capabilities, ref, `${id} must reuse the shared EVM capability object`);
  }
});

test('chainSupports fails closed for unknown chain and unknown capability', () => {
  assert.equal(chainSupports('ethereum', 'holders'), true);
  assert.equal(chainSupports('sui', 'holders'), false, 'no public holder source for Sui today');
  assert.equal(chainSupports('aptos', 'contractSecurity'), false);
  assert.equal(chainSupports('dogechain', 'holders'), false, 'unknown chain → unsupported');
  assert.equal(chainSupports('ethereum', 'teleport'), false, 'unknown capability → unsupported');
});

test('Solana keeps full capabilities (no regression)', () => {
  for (const cap of CAPABILITY_KEYS) {
    assert.equal(chainSupports('solana', cap), true, `Solana must still support ${cap}`);
  }
});

test('explorer links point at the right explorer per chain', () => {
  assert.match(explorerTokenUrl('ethereum', '0xabc'), /etherscan\.io\/token\/0xabc/);
  assert.match(explorerTokenUrl('base', '0xabc'), /basescan\.org\/token\/0xabc/);
  assert.match(explorerTokenUrl('bsc', '0xabc'), /bscscan\.com\/token\/0xabc/);
  assert.match(explorerTokenUrl('solana', 'Mint111'), /solscan\.io\/token\/Mint111/);
  assert.match(explorerTokenUrl('aptos', '0x1::a::A'), /aptoslabs\.com\/coin\//);
  assert.equal(explorerTokenUrl('nope', '0xabc'), null);
});

test('registry helpers agree on families', () => {
  assert.equal(chainFamily('bsc'), 'evm');
  assert.equal(chainFamily('sui'), 'sui');
  assert.equal(isSupportedChain('optimism'), true);
  assert.equal(isSupportedChain('cardano'), false);
  assert.ok(EVM_CHAIN_IDS.includes('polygon'));
});
