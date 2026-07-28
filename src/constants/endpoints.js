// Public API endpoint constants, extracted verbatim from src/main.jsx.
//
// Read-only, no-key public endpoints used by the token-lookup fan-out. Pure
// data (plus one derived devnet URL). No app state.
import { clusterApiUrl } from '@solana/web3.js';

// The SCANNER's Solana RPC endpoint.
//
// This is our own server-side proxy (netlify/functions/solana-rpc.mjs), NOT a
// provider URL. It used to be `import.meta.env.VITE_SOLANA_RPC_URL`, which Vite
// inlines into the browser bundle — so pointing it at a keyed provider (as the
// deploy notes recommend, since the public endpoint throttles browser traffic)
// shipped that provider's API key to every visitor. The credential now lives in
// the server-only `SOLANA_RPC_URL` and never reaches the client.
//
// Nothing that submits a transaction uses this; see SOLANA_PUBLIC_RPC_URL.
export const SOLANA_RPC_URL = '/.netlify/functions/solana-rpc';

// The WALLET's Solana RPC endpoint — wallet connection, payment verification
// and Launchpad minting.
//
// These submit transactions and confirm them over a websocket subscription,
// neither of which survives a stateless 10-second function, so they keep
// talking to a provider directly. THIS VALUE IS PUBLIC: it is inlined into the
// browser bundle, so it must never carry an API key. Leave it unset to use the
// public endpoint, or set it to a provider URL whose credential is safe to
// expose (a domain-restricted or otherwise public-scoped key).
export const SOLANA_PUBLIC_RPC_URL = import.meta.env?.VITE_SOLANA_PUBLIC_RPC_URL || 'https://api.mainnet-beta.solana.com';
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
