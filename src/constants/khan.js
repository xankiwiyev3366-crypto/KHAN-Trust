// KHAN app identity + official-token search matching, extracted verbatim from
// src/main.jsx. Payment/wallet/link constants, the official $KHAN mint identity
// (OFFICIAL_KHAN_*), and the tiny pure search-term matchers that resolve
// "khan"/"$khan" queries to that mint. Self-contained (no app state).
export const CRYPTO_PAYMENT_WALLET = import.meta.env.VITE_KHAN_PAYMENT_WALLET || '';
export const WALLET_DOWNLOAD_URLS = { Phantom: 'https://phantom.com/download', Solflare: 'https://solflare.com/download' };
export const OFFICIAL_KHAN_LINKS = {
  website: 'https://khantrust.net',
  x: 'https://x.com/KhanPortall',
  telegram: 'https://t.me/+RXCuwpSNwikzNTE0',
};
// Token creation has no fee of its own - it is a Premium feature (see
// LaunchpadPage's Premium gate). Mainnet minting still costs real Solana
// network gas, paid by the connected wallet directly to the network; that is
// unrelated to any KHAN Trust charge.
// The public RPC is heavily rate-limited and frequently rejects requests
// from browser-origin traffic. Setting VITE_SOLANA_RPC_URL to a dedicated
// provider (Helius, QuickNode, Alchemy, ...) makes holder counts, mint
// authority checks, and mint-creation lookups dramatically more reliable.

// Official $KHAN mint. Dexscreener's general search index doesn't always
// pick up new tokens right away, so exact KHAN/GKHAN searches are resolved
// to this address directly instead of depending on third-party indexing.
export const OFFICIAL_KHAN_CONTRACT = '6bSHkoMYqzyCZdWPQ45nUv73dvdfx4yEd4yEemefpump';
export const OFFICIAL_KHAN_EXACT_TERMS = ['khan', 'gkhan', '$khan'];
export const OFFICIAL_KHAN_MATCH = {
  address: OFFICIAL_KHAN_CONTRACT,
  chainId: 'solana',
  chain: 'Solana',
  name: 'KHAN',
  symbol: 'KHAN',
  marketCap: 0,
  logoUrl: '',
  verified: true,
  isOfficial: true,
};

export function normalizeSearchTerm(term) {
  return term.trim().toLowerCase().replace(/^\$/, '');
}

export function isExactOfficialKhanQuery(term) {
  return OFFICIAL_KHAN_EXACT_TERMS.includes(normalizeSearchTerm(term));
}

export function mentionsKhan(term) {
  return normalizeSearchTerm(term).includes('khan');
}
