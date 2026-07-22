// Chain registry — the single source of truth for every blockchain KHAN Trust
// supports. Pure data + pure helpers, no fetching and no import.meta.env, so it
// bundles into a Netlify Function (via ../../src/chains/registry.js) exactly
// like src/lib/features.js and src/lib/pricing.js.
//
// WHY A REGISTRY (and the CAPABILITIES map in particular)
//
// The scoring engine is chain-agnostic: it consumes a normalised `realData`
// shape and never asks what chain produced it. Chain-specific knowledge lives
// in exactly two places — the per-family ADAPTERS (which fetch) and THIS
// registry (which describes). The `capabilities` flags are how the product
// keeps requirement 5 honest: a metric a chain genuinely cannot provide is
// marked unsupported here, and the UI renders "Not supported on this chain"
// instead of a fabricated value. A capability is `true` only when a real public
// data source for that metric exists on that chain today.
//
// `family` decides which adapter handles the chain:
//   'solana' -> SolanaAdapter        (dedicated)
//   'evm'    -> EvmAdapter           (SHARED across all six EVM chains)
//   'sui'    -> SuiAdapter           (dedicated)
//   'aptos'  -> AptosAdapter         (dedicated)

// The nine metric capabilities every adapter is asked about. Kept as an ordered
// list so a new capability is added in one place and every consumer stays in
// sync.
export const CAPABILITY_KEYS = [
  'token',
  'marketData',
  'liquidity',
  'holders',
  'topHolders',
  'developerWallet',
  'contractSecurity',
  'transactions',
];

// Full EVM support: Dexscreener (market/liquidity/tx) + GoPlus token-security
// (holders, top holders, creator/developer wallet, contract security) + the
// server-side block-explorer proxy (contract age, proxy/upgradeable flag).
const EVM_CAPABILITIES = {
  token: true,
  marketData: true,
  liquidity: true,
  holders: true,
  topHolders: true,
  developerWallet: true,
  contractSecurity: true,
  transactions: true,
};

// Move chains (Sui, Aptos): Dexscreener + GeckoTerminal give real market and
// liquidity data, but there is no CORS-free, key-free public equivalent of
// GoPlus token-security or a Solana-style holder fan-out for these chains today.
// Those metrics are marked unsupported rather than guessed. Raise a flag here
// only when a real source is wired into the adapter — never to look complete.
const MOVE_CAPABILITIES = {
  token: true,
  marketData: true,
  liquidity: true,
  holders: false,
  topHolders: false,
  developerWallet: false,
  contractSecurity: false,
  transactions: true,
};

export const CHAINS = {
  solana: {
    id: 'solana',
    label: 'Solana',
    shortLabel: 'SOL',
    family: 'solana',
    color: '#14f195',
    explorerName: 'Solscan',
    explorerToken: (address) => `https://solscan.io/token/${address}`,
    explorerTx: (hash) => `https://solscan.io/tx/${hash}`,
    explorerAddress: (address) => `https://solscan.io/account/${address}`,
    capabilities: {
      token: true,
      marketData: true,
      liquidity: true,
      holders: true,
      topHolders: true,
      developerWallet: true,
      contractSecurity: true,
      transactions: true,
    },
  },
  ethereum: {
    id: 'ethereum', label: 'Ethereum', shortLabel: 'ETH', family: 'evm', color: '#627eea',
    explorerName: 'Etherscan',
    explorerToken: (a) => `https://etherscan.io/token/${a}`,
    explorerTx: (h) => `https://etherscan.io/tx/${h}`,
    explorerAddress: (a) => `https://etherscan.io/address/${a}`,
    capabilities: EVM_CAPABILITIES,
  },
  base: {
    id: 'base', label: 'Base', shortLabel: 'BASE', family: 'evm', color: '#0052ff',
    explorerName: 'BaseScan',
    explorerToken: (a) => `https://basescan.org/token/${a}`,
    explorerTx: (h) => `https://basescan.org/tx/${h}`,
    explorerAddress: (a) => `https://basescan.org/address/${a}`,
    capabilities: EVM_CAPABILITIES,
  },
  bsc: {
    id: 'bsc', label: 'BNB Chain', shortLabel: 'BNB', family: 'evm', color: '#f0b90b',
    explorerName: 'BscScan',
    explorerToken: (a) => `https://bscscan.com/token/${a}`,
    explorerTx: (h) => `https://bscscan.com/tx/${h}`,
    explorerAddress: (a) => `https://bscscan.com/address/${a}`,
    capabilities: EVM_CAPABILITIES,
  },
  arbitrum: {
    id: 'arbitrum', label: 'Arbitrum', shortLabel: 'ARB', family: 'evm', color: '#28a0f0',
    explorerName: 'Arbiscan',
    explorerToken: (a) => `https://arbiscan.io/token/${a}`,
    explorerTx: (h) => `https://arbiscan.io/tx/${h}`,
    explorerAddress: (a) => `https://arbiscan.io/address/${a}`,
    capabilities: EVM_CAPABILITIES,
  },
  optimism: {
    id: 'optimism', label: 'Optimism', shortLabel: 'OP', family: 'evm', color: '#ff0420',
    explorerName: 'Optimistic Etherscan',
    explorerToken: (a) => `https://optimistic.etherscan.io/token/${a}`,
    explorerTx: (h) => `https://optimistic.etherscan.io/tx/${h}`,
    explorerAddress: (a) => `https://optimistic.etherscan.io/address/${a}`,
    capabilities: EVM_CAPABILITIES,
  },
  polygon: {
    id: 'polygon', label: 'Polygon', shortLabel: 'POL', family: 'evm', color: '#8247e5',
    explorerName: 'PolygonScan',
    explorerToken: (a) => `https://polygonscan.com/token/${a}`,
    explorerTx: (h) => `https://polygonscan.com/tx/${h}`,
    explorerAddress: (a) => `https://polygonscan.com/address/${a}`,
    capabilities: EVM_CAPABILITIES,
  },
  // Avalanche predates the multi-chain formalisation and already works through
  // the same EVM path — kept supported so no existing scan regresses, even
  // though it is outside the headline nine.
  avalanche: {
    id: 'avalanche', label: 'Avalanche', shortLabel: 'AVAX', family: 'evm', color: '#e84142',
    explorerName: 'SnowTrace',
    explorerToken: (a) => `https://snowtrace.io/token/${a}`,
    explorerTx: (h) => `https://snowtrace.io/tx/${h}`,
    explorerAddress: (a) => `https://snowtrace.io/address/${a}`,
    capabilities: EVM_CAPABILITIES,
  },
  sui: {
    id: 'sui', label: 'Sui', shortLabel: 'SUI', family: 'sui', color: '#4da2ff',
    explorerName: 'SuiVision',
    explorerToken: (a) => `https://suivision.xyz/coin/${a}`,
    explorerTx: (h) => `https://suivision.xyz/txblock/${h}`,
    explorerAddress: (a) => `https://suivision.xyz/account/${a}`,
    capabilities: MOVE_CAPABILITIES,
  },
  aptos: {
    id: 'aptos', label: 'Aptos', shortLabel: 'APT', family: 'aptos', color: '#06f7c4',
    explorerName: 'Aptos Explorer',
    explorerToken: (a) => `https://explorer.aptoslabs.com/coin/${a}?network=mainnet`,
    explorerTx: (h) => `https://explorer.aptoslabs.com/txn/${h}?network=mainnet`,
    explorerAddress: (a) => `https://explorer.aptoslabs.com/account/${a}?network=mainnet`,
    capabilities: MOVE_CAPABILITIES,
  },
};

// The nine chains that are the product's headline supported set, in display
// order. Avalanche is supported but intentionally not listed here.
export const SUPPORTED_CHAIN_IDS = [
  'solana', 'ethereum', 'base', 'bsc', 'arbitrum', 'optimism', 'polygon', 'sui', 'aptos',
];

export const EVM_CHAIN_IDS = Object.values(CHAINS)
  .filter((c) => c.family === 'evm')
  .map((c) => c.id);

export function getChain(chainId) {
  return CHAINS[chainId] || null;
}

export function isSupportedChain(chainId) {
  return Boolean(CHAINS[chainId]);
}

export function chainFamily(chainId) {
  return CHAINS[chainId]?.family || null;
}

// The single predicate the report uses to decide between rendering a metric and
// rendering "Not supported on this chain". An unknown chain or capability is
// unsupported — fail closed, never invent support the adapter cannot back.
export function chainSupports(chainId, capability) {
  const chain = CHAINS[chainId];
  if (!chain) return false;
  return chain.capabilities?.[capability] === true;
}

export function explorerTokenUrl(chainId, address) {
  const chain = CHAINS[chainId];
  if (!chain || !address) return null;
  return chain.explorerToken(address);
}

export function explorerTxUrl(chainId, hash) {
  const chain = CHAINS[chainId];
  if (!chain || !hash) return null;
  return chain.explorerTx(hash);
}

export function chainLabel(chainId) {
  return CHAINS[chainId]?.label
    || (chainId ? chainId.charAt(0).toUpperCase() + chainId.slice(1) : 'Unknown');
}
