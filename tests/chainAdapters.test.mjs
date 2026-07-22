// Tests for the ChainAdapter interface (requirements 2, 3, 6).
import test from 'node:test';
import assert from 'node:assert/strict';

import { getAdapter, NOT_SUPPORTED, isNotSupported } from '../src/chains/adapters.js';

const NINE_METHODS = [
  'getToken', 'getMarketData', 'getLiquidity', 'getHolders', 'getTopHolders',
  'getDeveloperWallet', 'getContractSecurity', 'getTransactions', 'getRiskInputs',
];

const evmToken = {
  name: 'Test', ticker: 'TST', chain: 'Ethereum', chainId: 'ethereum', contract: '0xabc',
  holders: 1200,
  realData: {
    marketCapUsd: 5_000_000, priceUsd: 1.2, volume24hUsd: 400_000,
    totalLiquidityUsd: 800_000, poolCount: 4,
    holderCount: 1200, topHolderPercent: 22, topTenHolderPercent: 55,
    topHolders: [{ rank: 1, pct: 22 }],
    creatorAddress: '0xdev', mintAuthorityEnabled: false, freezeAuthorityEnabled: false,
    buys24h: 300, sells24h: 250, tokenAgeDays: 120,
  },
};

const suiToken = {
  name: 'SuiTok', ticker: 'ST', chain: 'Sui', chainId: 'sui', contract: '0x2::x::Y',
  realData: { marketCapUsd: 1_000_000, totalLiquidityUsd: 90_000, poolCount: 2, tokenAgeDays: 30 },
};

test('every chain exposes the same nine methods', () => {
  for (const id of ['solana', 'ethereum', 'base', 'bsc', 'arbitrum', 'optimism', 'polygon', 'sui', 'aptos']) {
    const adapter = getAdapter(id);
    assert.ok(adapter, `${id} must have an adapter`);
    for (const m of NINE_METHODS) {
      assert.equal(typeof adapter[m], 'function', `${id}.${m} must exist`);
    }
  }
});

test('all six EVM chains share ONE adapter implementation (requirement 6)', () => {
  const eth = getAdapter('ethereum');
  // Same chain id → identical cached instance; different EVM chains → same shape.
  assert.equal(getAdapter('ethereum'), eth, 'stable instance per chain');
  for (const id of ['base', 'bsc', 'arbitrum', 'optimism', 'polygon']) {
    const a = getAdapter(id);
    assert.equal(a.family, 'evm');
    // Same prototype of methods (functions come from the same factory).
    assert.equal(a.getHolders.toString(), eth.getHolders.toString());
  }
});

test('an unsupported metric returns NOT_SUPPORTED, never a fabricated value', () => {
  const sui = getAdapter('sui');
  assert.equal(isNotSupported(sui.getHolders(suiToken)), true, 'Sui has no holder source');
  assert.equal(isNotSupported(sui.getTopHolders(suiToken)), true);
  assert.equal(isNotSupported(sui.getContractSecurity(suiToken)), true);
  assert.equal(isNotSupported(sui.getDeveloperWallet(suiToken)), true);
  // But market + liquidity ARE supported on Sui.
  assert.notEqual(sui.getMarketData(suiToken), NOT_SUPPORTED);
  assert.equal(sui.getLiquidity(suiToken).totalLiquidityUsd, 90_000);
});

test('a supported chain projects the real data through the interface', () => {
  const evm = getAdapter('ethereum');
  assert.equal(evm.getHolders(evmToken).holderCount, 1200);
  assert.equal(evm.getTopHolders(evmToken).topHolderPercent, 22);
  assert.equal(evm.getContractSecurity(evmToken).mintAuthorityEnabled, false);
  assert.equal(evm.getMarketData(evmToken).marketCapUsd, 5_000_000);
  assert.equal(evm.getToken(evmToken).contract, '0xabc');
});

test('getRiskInputs is chain-agnostic: unsupported metrics are ABSENT, not zero', () => {
  const evmInputs = getAdapter('ethereum').getRiskInputs(evmToken);
  assert.equal(evmInputs.holderCount, 1200);
  assert.equal(evmInputs.topHolderPercent, 22);
  assert.equal(evmInputs.mintAuthorityEnabled, false);

  const suiInputs = getAdapter('sui').getRiskInputs(suiToken);
  // Supported on Sui:
  assert.equal(suiInputs.totalLiquidityUsd, 90_000);
  assert.equal(suiInputs.marketCapUsd, 1_000_000);
  assert.equal(suiInputs.tokenAgeDays, 30);
  // Unsupported on Sui — the KEY must be absent, never 0 (which would read as a
  // real observation of zero holders / renounced authority).
  assert.equal('holderCount' in suiInputs, false, 'holderCount must be absent on Sui');
  assert.equal('topHolderPercent' in suiInputs, false);
  assert.equal('mintAuthorityEnabled' in suiInputs, false);
});

test('an unknown chain has no adapter (never a silent wrong-chain default)', () => {
  assert.equal(getAdapter('cardano'), null);
  assert.equal(getAdapter(undefined), null);
});
