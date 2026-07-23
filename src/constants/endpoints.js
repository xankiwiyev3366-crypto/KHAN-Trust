// Public API endpoint constants, extracted verbatim from src/main.jsx.
//
// Read-only, no-key public endpoints used by the token-lookup fan-out. Pure
// data (plus one derived devnet URL). No app state.
import { clusterApiUrl } from '@solana/web3.js';

export const SOLANA_RPC_URL = import.meta.env?.VITE_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
export const SOLANA_DEVNET_RPC_URL = clusterApiUrl('devnet');
export const DEXSCREENER_TOKEN_PAIRS_BASE_URL = 'https://api.dexscreener.com/token-pairs/v1';
export const DEXSCREENER_SEARCH_URL = 'https://api.dexscreener.com/latest/dex/search';
export const JUPITER_TOKEN_SEARCH_URL = 'https://lite-api.jup.ag/tokens/v2/search';
// Free, no-key public APIs used to widen coverage beyond Dexscreener/Jupiter:
// CoinGecko's contract lookup gives an authoritative circulating market cap,
// a real genesis_date for established assets, and curated social links.
// GeckoTerminal fills in pool/liquidity data for chains or pairs Dexscreener
// hasn't indexed yet. Both are read-only public endpoints with no API key.
export const COINGECKO_API_BASE = 'https://api.coingecko.com/api/v3';
export const GECKOTERMINAL_API_BASE = 'https://api.geckoterminal.com/api/v2';
// GoPlus Security - free, no-key public token-security API. Used only as a
// fallback for holder count / concentration when our existing sources
// (Solana RPC scan, Jupiter index, EVM block explorers) have nothing, so it
// never overrides a real on-chain/indexed measurement that's already present.
export const GOPLUS_API_BASE = 'https://api.gopluslabs.io/api/v1';
