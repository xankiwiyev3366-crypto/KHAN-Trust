// ChainAdapter layer (requirements 2, 3, 6).
//
// THE INTERFACE. Every chain exposes the SAME nine methods:
//   getToken, getMarketData, getLiquidity, getHolders, getTopHolders,
//   getDeveloperWallet, getContractSecurity, getTransactions, getRiskInputs
//
// Each method is a PROJECTION over the normalised `realData` a lookup already
// produced (the fetch itself lives in the provider functions in main.jsx — the
// scoring engine runs client-side, so re-fetching here would duplicate RPC
// calls, which requirement 9 forbids). The adapter's job is to present that
// normalised data through one uniform, capability-gated interface.
//
// WHY THIS KEEPS THE RISK ENGINE CHAIN-AGNOSTIC (requirement 3)
//
// getRiskInputs() returns a flat, chain-neutral bag of inputs. It contains a key
// ONLY when the chain genuinely supports that metric AND the value was observed;
// an unsupported metric is ABSENT, never 0 and never a marker the engine would
// have to special-case. So the engine sees the same shape for a Solana token and
// an Aptos token and never asks which chain it is — the only chain-specific code
// is here, in the adapters, exactly as required.
//
// WHY EVM IS ONE ADAPTER (requirement 6)
//
// All six EVM chains (Ethereum, Base, BNB, Arbitrum, Optimism, Polygon) — plus
// Avalanche — resolve to the SAME evmAdapter instance. Solana, Sui and Aptos
// each get their own. The projections are largely shared through makeAdapter();
// a family adapter only overrides what is genuinely chain-specific.

import { chainSupports, chainFamily, getChain } from './registry.js';

// The sentinel a capability-gated getter returns when the chain cannot provide
// the metric. Distinct from null (observed-as-absent) so the UI can render
// "Not supported on this chain" (requirement 5) rather than "unknown".
export const NOT_SUPPORTED = Object.freeze({ supported: false, reason: 'not_supported_on_chain' });

export function isNotSupported(value) {
  return value === NOT_SUPPORTED;
}

const realData = (project) => project?.realData || {};

// Builds an adapter for one chain. `overrides` lets a family supply genuinely
// chain-specific extraction; everything else is shared, so adding a chain to an
// existing family is free.
function makeAdapter(chainId, overrides = {}) {
  const gate = (capability, produce) => (project) =>
    (chainSupports(chainId, capability) ? produce(project) : NOT_SUPPORTED);

  const base = {
    chainId,
    family: chainFamily(chainId),
    meta: getChain(chainId),
    supports: (capability) => chainSupports(chainId, capability),

    // Always available: identity of the token itself.
    getToken(project = {}) {
      return {
        name: project.name ?? null,
        ticker: project.ticker ?? null,
        chain: project.chain ?? getChain(chainId)?.label ?? null,
        chainId,
        contract: project.contract ?? null,
        logoUrl: project.logoUrl || realData(project).logoUrl || null,
      };
    },

    getMarketData: gate('marketData', (project) => {
      const d = realData(project);
      return {
        marketCapUsd: d.marketCapUsd ?? null,
        marketCapIsFdv: d.marketCapIsFdv ?? null,
        priceUsd: d.priceUsd ?? null,
        volume24hUsd: d.volume24hUsd ?? null,
        priceChange24h: d.priceChange24h ?? null,
        supply: d.supply ?? d.totalSupply ?? null,
      };
    }),

    getLiquidity: gate('liquidity', (project) => {
      const d = realData(project);
      return {
        totalLiquidityUsd: d.totalLiquidityUsd ?? d.liquidityUsd ?? null,
        poolCount: d.poolCount ?? null,
        topPoolConcentrationPercent: d.topPoolConcentrationPercent ?? null,
      };
    }),

    getHolders: gate('holders', (project) => {
      const d = realData(project);
      return {
        holderCount: d.holderCount ?? project.holders ?? null,
        holderGrowthPercent: d.holderGrowthPercent ?? null,
        source: d.holderSource ?? null,
      };
    }),

    getTopHolders: gate('topHolders', (project) => {
      const d = realData(project);
      return {
        topHolderPercent: d.topHolderPercent ?? null,
        topTenHolderPercent: d.topTenHolderPercent ?? null,
        distribution: Array.isArray(d.topHolders) ? d.topHolders : null,
      };
    }),

    getDeveloperWallet: gate('developerWallet', (project) => {
      const d = realData(project);
      return {
        devWallet: d.devWallet ?? null,
        creatorAddress: d.creatorAddress ?? null,
      };
    }),

    getContractSecurity: gate('contractSecurity', (project) => {
      const d = realData(project);
      return {
        mintAuthorityEnabled: d.mintAuthorityEnabled ?? null,
        freezeAuthorityEnabled: d.freezeAuthorityEnabled ?? null,
        upgradeable: d.upgradeable ?? null,
      };
    }),

    getTransactions: gate('transactions', (project) => {
      const d = realData(project);
      return {
        buys24h: d.buys24h ?? null,
        sells24h: d.sells24h ?? null,
      };
    }),

    // The chain-agnostic input bag the risk engine consumes. A metric the chain
    // does not support is OMITTED entirely (never 0), so the engine treats it as
    // unknown — its existing "unknown ≠ bad" rule then applies uniformly across
    // every chain with no chain-specific branch.
    getRiskInputs(project = {}) {
      const inputs = {};
      const merge = (result) => {
        if (result !== NOT_SUPPORTED && result && typeof result === 'object') Object.assign(inputs, result);
      };
      merge(this.getMarketData(project));
      merge(this.getLiquidity(project));
      merge(this.getHolders(project));
      merge(this.getTopHolders(project));
      merge(this.getDeveloperWallet(project));
      merge(this.getContractSecurity(project));
      merge(this.getTransactions(project));
      const d = realData(project);
      inputs.tokenAgeDays = d.tokenAgeDays ?? null;
      return inputs;
    },
  };

  return { ...base, ...overrides };
}

// ── Family adapters ───────────────────────────────────────────────────────────
// EVM: ONE shared adapter, reused for every EVM chain id (requirement 6). Cached
// per chain id so the same object is returned each call (the test relies on it).
const evmAdapterCache = new Map();
function evmAdapter(chainId) {
  if (!evmAdapterCache.has(chainId)) evmAdapterCache.set(chainId, makeAdapter(chainId));
  return evmAdapterCache.get(chainId);
}

const solanaAdapter = makeAdapter('solana');
const suiAdapter = makeAdapter('sui');
const aptosAdapter = makeAdapter('aptos');

// The single dispatch point. Returns the adapter for a chain id, or null for an
// unknown chain (caller must handle — never a silent wrong-chain adapter).
export function getAdapter(chainId) {
  const family = chainFamily(chainId);
  if (!family) return null;
  switch (family) {
    case 'solana': return solanaAdapter;
    case 'sui': return suiAdapter;
    case 'aptos': return aptosAdapter;
    case 'evm': return evmAdapter(chainId);
    default: return null;
  }
}
