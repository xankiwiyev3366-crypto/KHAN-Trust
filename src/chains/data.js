// Chain metadata + chain-specific public lookups, extracted verbatim from
// src/main.jsx. Pure data maps (chain labels, provider platform slugs, native
// asset ids / liquidity proxies, explorer support) plus two no-key, CORS-safe
// fetchers keyed off them. Only global deps (fetch, Object) — no app state.

export const GOPLUS_EVM_CHAIN_IDS = {
  ethereum: '1',
  bsc: '56',
  polygon: '137',
  base: '8453',
  arbitrum: '42161',
  avalanche: '43114',
  optimism: '10',
};
export const CHAIN_LABELS = {
  solana: 'Solana',
  ethereum: 'Ethereum',
  bsc: 'BSC',
  base: 'Base',
  arbitrum: 'Arbitrum',
  polygon: 'Polygon',
  avalanche: 'Avalanche',
  optimism: 'Optimism',
  sui: 'Sui',
  aptos: 'Aptos',
};

export const CHAIN_TO_COINGECKO_PLATFORM = {
  solana: 'solana',
  ethereum: 'ethereum',
  bsc: 'binance-smart-chain',
  base: 'base',
  arbitrum: 'arbitrum-one',
  polygon: 'polygon-pos',
  avalanche: 'avalanche',
  optimism: 'optimistic-ethereum',
  sui: 'sui',
  aptos: 'aptos',
};

export const CHAIN_TO_GECKOTERMINAL_NETWORK = {
  solana: 'solana',
  ethereum: 'eth',
  bsc: 'bsc',
  base: 'base',
  arbitrum: 'arbitrum',
  polygon: 'polygon_pos',
  avalanche: 'avax',
  optimism: 'optimism',
  sui: 'sui',
  aptos: 'aptos',
};

export const COINGECKO_PLATFORM_TO_CHAIN = Object.fromEntries(
  Object.entries(CHAIN_TO_COINGECKO_PLATFORM).map(([chainId, platform]) => [platform, chainId])
);

// Native chain coins (BTC, ETH, BNB, SOL, ...) have no on-chain contract of
// their own - they can only be resolved through CoinGecko's coin id, never
// through a token-pairs/contract lookup. Keyed by the ticker users actually
// type, mapped to the CoinGecko coin id used for /coins/{id}.
export const NATIVE_ASSET_COINGECKO_IDS = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  BNB: 'binancecoin',
  SOL: 'solana',
  SUI: 'sui',
  DOGE: 'dogecoin',
  LTC: 'litecoin',
  XRP: 'ripple',
  AVAX: 'avalanche-2',
  MATIC: 'matic-network',
  TRX: 'tron',
  ADA: 'cardano',
  DOT: 'polkadot',
};

// A native chain coin (ETH, BNB, SOL, AVAX, SUI) has no contract of its own,
// but it does trade on its own chain's DEXs via a canonical 1:1 wrapped/native
// representation - WETH, WBNB, wSOL, WAVAX, and Sui's own native coin type
// are the SAME asset for liquidity purposes, not an estimate or a different
// token. Used only to source real DEX liquidity depth for the native asset;
// never used for holder count/concentration, since wrapped-token holders are
// a small DeFi subset and would misrepresent true native-asset distribution.
export const NATIVE_LIQUIDITY_PROXY = {
  ethereum: { chainId: 'ethereum', address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' },
  binancecoin: { chainId: 'bsc', address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' },
  solana: { chainId: 'solana', address: 'So11111111111111111111111111111111111111112' },
  'avalanche-2': { chainId: 'avalanche', address: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7' },
  sui: { chainId: 'sui', address: '0x2::sui::SUI' },
};

// Blockchair exposes a real, CORS-enabled, no-key "hodling_addresses" stat -
// the number of on-chain addresses currently holding a balance - which is a
// genuine holder count for a native chain asset (not a wrapped-token proxy).
// Maps our CoinGecko ids to Blockchair's chain slugs for the chains it covers;
// chains it doesn't cover fall back to the CoinGecko market-rank distribution
// signal below. Best-effort: any failure just drops to the next provider.
export const BLOCKCHAIR_NATIVE_CHAINS = {
  bitcoin: 'bitcoin',
  ethereum: 'ethereum',
  litecoin: 'litecoin',
  dogecoin: 'dogecoin',
  ripple: 'ripple',
  cardano: 'cardano',
  'bitcoin-cash': 'bitcoin-cash',
  dash: 'dash',
  zcash: 'zcash',
  stellar: 'stellar',
};

// Best-effort native holder count from Blockchair's public stats endpoint.
// CORS-enabled and key-free; returns null on any failure (unsupported chain,
// rate limit, network) so the caller cleanly falls through to the next signal.
export async function fetchBlockchairNativeStats(coingeckoId) {
  const slug = BLOCKCHAIR_NATIVE_CHAINS[coingeckoId];
  if (!slug) return null;
  try {
    const response = await fetch(`https://api.blockchair.com/${slug}/stats`);
    if (!response.ok) return null;
    const payload = await response.json();
    const data = payload?.data || {};
    const holderCount = Number(data.hodling_addresses || 0) || null;
    if (!holderCount) return null;
    return { holderCount, source: `Blockchair ${slug} on-chain address count` };
  } catch {
    return null;
  }
}

// Block-explorer "contract creation timestamp" + "is proxy/upgradeable"
// lookups. The Etherscan-family API keys used to live here as VITE_* env vars,
// which meant they were bundled into the browser and publicly readable. They
// now live server-side and are reached through the evm-explorer proxy function
// (see netlify/functions/evm-explorer.mjs); this list only records which chains
// the proxy supports so unsupported chains short-circuit without a round trip.
// Without a key configured server-side the chain still falls back to "Unknown"
// rather than guessing, exactly as before.
export const EXPLORER_SUPPORTED_CHAINS = new Set(['ethereum', 'bsc', 'base', 'polygon']);

export async function fetchExplorerProxy(chainId, action, address) {
  if (!EXPLORER_SUPPORTED_CHAINS.has(chainId)) return null;
  const response = await fetch(
    `/.netlify/functions/evm-explorer?chain=${encodeURIComponent(chainId)}&action=${action}&address=${encodeURIComponent(address)}`,
  );
  if (!response.ok) return null;
  const data = await response.json();
  return data?.result ?? null;
}

export function chainLabelFor(chainId) {
  return CHAIN_LABELS[chainId] || (chainId ? chainId.charAt(0).toUpperCase() + chainId.slice(1) : 'Unknown');
}
