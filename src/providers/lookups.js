// Provider lookup layer — low-level token data fetchers and parsers, extracted
// verbatim from src/main.jsx. Read-only, no-key public API calls (Dexscreener,
// CoinGecko, GeckoTerminal, GoPlus, Jupiter, Solana JSON-RPC, EVM explorer
// proxy) plus their pure parsers and the top-holder builder. The higher-level
// lookup ORCHESTRATORS (which compose these with the scoring/domain layer) stay
// in main.jsx and import these back. No app state.
import { translate } from '../i18n/index.js';
import { hasValue } from '../lib/trustScore.js';
import {
  CHAIN_TO_COINGECKO_PLATFORM, CHAIN_TO_GECKOTERMINAL_NETWORK, COINGECKO_PLATFORM_TO_CHAIN,
  GOPLUS_EVM_CHAIN_IDS, chainLabelFor, fetchExplorerProxy,
} from '../chains/data.js';
import {
  COINGECKO_API_BASE, GECKOTERMINAL_API_BASE, GOPLUS_API_BASE,
  DEXSCREENER_TOKEN_PAIRS_BASE_URL, JUPITER_TOKEN_SEARCH_URL, SOLANA_RPC_URL,
} from '../constants/endpoints.js';
import { cleanLink, extractSocialLinksFromDexInfo, extractSocialLinksFromMetadata } from '../socialLinks.js';
import { roundPercent } from '../format.js';

export async function fetchDexscreenerToken(address, chainId = 'solana') {
  const response = await fetch(`${DEXSCREENER_TOKEN_PAIRS_BASE_URL}/${chainId}/${address}`);
  if (!response.ok) throw new Error('Dexscreener lookup failed.');
  const pairs = await response.json();
  if (!Array.isArray(pairs) || !pairs.length) return null;
  const normalized = address.toLowerCase();
  const isBaseToken = (pair) => pair.baseToken?.address?.toLowerCase() === normalized;
  const isQuoteToken = (pair) => pair.quoteToken?.address?.toLowerCase() === normalized;
  const solanaPairs = pairs
    .filter((pair) => pair.chainId === chainId)
    .filter((pair) => isBaseToken(pair) || isQuoteToken(pair));
  // Sorted by liquidity first, then 24h volume as a tiebreaker for near-equal
  // pools - never an arbitrary/first-returned pair. Used for aggregation.
  const sortedPairs = solanaPairs.sort((a, b) => {
    const liquidityDiff = Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0);
    if (liquidityDiff !== 0) return liquidityDiff;
    return Number(b?.volume?.h24 || 0) - Number(a?.volume?.h24 || 0);
  });
  // The PRIMARY pair also drives the live chart embed, which needs a pair the
  // embed can actually load: a real pairAddress and ACTIVE liquidity (a dead
  // pool renders as a permanent "Loading pair..."). And because the embed shows
  // the chart from the BASE token's perspective, the token should be the base;
  // a pair where it is only the quote is used for the chart only as a last
  // resort (#7). Aggregation still spans every matched pool, so metrics are
  // unchanged - this only sharpens which single pool the chart points at.
  const chartCandidates = sortedPairs.filter(
    (pair) => pair.pairAddress && Number(pair?.liquidity?.usd || 0) > 0
  );
  const primaryPair =
    chartCandidates.find(isBaseToken) ||
    chartCandidates[0] ||
    sortedPairs.find((pair) => pair.pairAddress && isBaseToken(pair)) ||
    sortedPairs.find((pair) => pair.pairAddress) ||
    sortedPairs[0] ||
    null;
  return {
    primaryPair,
    pairs: sortedPairs,
    poolCount: sortedPairs.length,
    totalLiquidityUsd: sortedPairs.reduce((total, pair) => total + Number(pair?.liquidity?.usd || 0), 0),
    oldestPairCreatedAt: sortedPairs
      .map((pair) => pair.pairCreatedAt)
      .filter(Boolean)
      .sort((a, b) => a - b)[0] || null,
  };
}

// Dexscreener's per-pool objects already include 24h volume and buy/sell
// transaction counts (dex.pairs, fetched above) - this was being discarded
// after only liquidity was summed. No new API call: just reads fields
// already present on data we fetch for every lookup.
export function aggregateDexTradingStats(dex) {
  const pairs = Array.isArray(dex?.pairs) ? dex.pairs : [];
  if (!pairs.length) return null;
  const volume24hUsd = pairs.reduce((total, pair) => total + Number(pair?.volume?.h24 || 0), 0);
  const buys24h = pairs.reduce((total, pair) => total + Number(pair?.txns?.h24?.buys || 0), 0);
  const sells24h = pairs.reduce((total, pair) => total + Number(pair?.txns?.h24?.sells || 0), 0);
  const totalLiquidity = dex.totalLiquidityUsd || 0;
  const primaryLiquidity = Number(dex.primaryPair?.liquidity?.usd || 0);
  // What share of total liquidity sits in the single largest pool - a token
  // whose liquidity is almost entirely concentrated in one pool is more
  // exposed to that pool being pulled than one spread across several.
  const topPoolConcentrationPercent = totalLiquidity > 0 ? roundPercent(primaryLiquidity / totalLiquidity) : null;
  return {
    volume24hUsd: volume24hUsd || null,
    buys24h: pairs.some((p) => p?.txns?.h24) ? buys24h : null,
    sells24h: pairs.some((p) => p?.txns?.h24) ? sells24h : null,
    topPoolConcentrationPercent,
  };
}

export function getDexTokenForAddress(pair, address) {
  const normalized = address.toLowerCase();
  if (pair?.baseToken?.address?.toLowerCase() === normalized) return pair.baseToken;
  if (pair?.quoteToken?.address?.toLowerCase() === normalized) return pair.quoteToken;
  return pair?.baseToken || {};
}

// CoinGecko's free contract-lookup endpoint. Most reliable source for real
// circulating market cap (vs. FDV) and, for established assets, a genuine
// genesis_date - the most trustworthy "real asset age" signal available
// without depending on a chain RPC. Not every token is listed, so a 404 is
// a normal "not found" result, not an error worth surfacing.
// Shared parser for CoinGecko's "coin detail" shape, returned identically
// by /coins/{platform}/contract/{address} and /coins/{id}.
export function parseCoinGeckoCoinDetail(data) {
  const links = data.links || {};
  const community = data.community_data || {};
  const market = data.market_data || {};
  const telegramHandle = links.telegram_channel_identifier;
  const discordUrl = (links.chat_url || []).find((url) => /discord/i.test(url || ''));
  return {
    listed: true,
    coingeckoId: data.id || '',
    name: data.name || '',
    symbol: data.symbol ? data.symbol.toUpperCase() : '',
    logoUrl: data.image?.large || data.image?.small || data.image?.thumb || '',
    description: cleanLink(data.description?.en)?.split(/\r?\n/)[0]?.slice(0, 280) || '',
    platforms: data.platforms || {},
    realMarketCapUsd: Number(market.market_cap?.usd || 0),
    fdvUsd: Number(market.fully_diluted_valuation?.usd || 0),
    priceUsd: Number(market.current_price?.usd || 0),
    priceChange24h: market.price_change_percentage_24h ?? null,
    priceChange7d: market.price_change_percentage_7d ?? null,
    priceChange30d: market.price_change_percentage_30d ?? null,
    ath: Number(market.ath?.usd || 0) || null,
    athDate: market.ath_date?.usd || null,
    atl: Number(market.atl?.usd || 0) || null,
    atlDate: market.atl_date?.usd || null,
    volume24hUsd: Number(market.total_volume?.usd || 0) || null,
    circulatingSupply: Number(market.circulating_supply || 0) || null,
    maxSupply: Number(market.max_supply || 0) || null,
    totalSupply: Number(market.total_supply || 0) || null,
    genesisDate: data.genesis_date || null,
    category: Array.isArray(data.categories) ? data.categories.find(hasValue) || '' : '',
    website: cleanLink(links.homepage?.find(hasValue)),
    twitter: links.twitter_screen_name ? `https://twitter.com/${links.twitter_screen_name}` : '',
    telegram: telegramHandle ? `https://t.me/${telegramHandle}` : '',
    discord: discordUrl || '',
    github: cleanLink(links.repos_url?.github?.find(hasValue)),
    twitterFollowers: Number(community.twitter_followers || 0) || null,
    telegramUsers: Number(community.telegram_channel_user_count || 0) || null,
    // Real, universal distribution signals CoinGecko returns for every listed
    // asset (including native coins that have no contract): the market-cap rank
    // and how many people track the asset. Used as an honest holder-distribution
    // proxy for native assets, which have no single on-chain "holder count" API.
    marketCapRank: Number(data.market_cap_rank || 0) || null,
    watchlistUsers: Number(community.watchlist_portfolio_users || 0) || null,
  };
}

export async function fetchCoinGeckoTokenData(chainId, address) {
  const platform = CHAIN_TO_COINGECKO_PLATFORM[chainId];
  if (!platform) return null;
  const response = await fetch(`${COINGECKO_API_BASE}/coins/${platform}/contract/${address}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('CoinGecko lookup failed.');
  const data = await response.json();
  return parseCoinGeckoCoinDetail(data);
}

export async function fetchCoinGeckoCoinDetail(coingeckoId) {
  const response = await fetch(`${COINGECKO_API_BASE}/coins/${coingeckoId}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('CoinGecko lookup failed.');
  const data = await response.json();
  return parseCoinGeckoCoinDetail(data);
}

// CoinGecko's own search index is the closest thing to a ground truth for
// "which contract is the REAL token behind this name/ticker" - Dexscreener's
// search has no concept of an official/canonical asset and will happily
// rank an unrelated higher-liquidity imitator above the real one. Only the
// top few CoinGecko search hits (by market_cap_rank) are resolved in full,
// to stay within the free, no-key rate limit.
export async function fetchCoinGeckoCanonicalMatches(term) {
  const response = await fetch(`${COINGECKO_API_BASE}/search?query=${encodeURIComponent(term)}`);
  if (!response.ok) throw new Error('CoinGecko search failed.');
  const data = await response.json();
  const coins = Array.isArray(data?.coins) ? data.coins : [];
  const ranked = coins
    .filter((coin) => coin.market_cap_rank !== null && coin.market_cap_rank !== undefined)
    .sort((a, b) => a.market_cap_rank - b.market_cap_rank)
    .slice(0, 3);
  const details = await Promise.allSettled(ranked.map((coin) => fetchCoinGeckoCoinDetail(coin.id)));

  const matches = [];
  details.forEach((result, index) => {
    if (result.status !== 'fulfilled' || !result.value) return;
    const detail = result.value;
    const coin = ranked[index];
    const platformEntries = Object.entries(detail.platforms || {}).filter(([, address]) => hasValue(address));
    if (!platformEntries.length) {
      // No on-chain contract anywhere - this is the chain's own native
      // asset (BTC, ETH, BNB, SOL, ...), not a token deployed on a chain.
      matches.push({
        address: null,
        chainId: 'native',
        chain: detail.name,
        coingeckoId: coin.id,
        name: detail.name,
        symbol: detail.symbol,
        marketCap: detail.realMarketCapUsd,
        logoUrl: detail.logoUrl,
        verified: true,
        source: 'coingecko',
      });
      return;
    }
    platformEntries.forEach(([platform, address]) => {
      const chainId = COINGECKO_PLATFORM_TO_CHAIN[platform];
      if (!chainId) return;
      matches.push({
        address,
        chainId,
        chain: chainLabelFor(chainId),
        coingeckoId: coin.id,
        name: detail.name,
        symbol: detail.symbol,
        marketCap: detail.realMarketCapUsd,
        logoUrl: detail.logoUrl,
        verified: true,
        source: 'coingecko',
      });
    });
  });
  return matches;
}

// GeckoTerminal covers the same DEX pool universe as Dexscreener but
// indexes some pairs/chains independently - used only to fill gaps when
// Dexscreener has no pair for a token, never to override it.
export async function fetchGeckoTerminalToken(chainId, address) {
  const network = CHAIN_TO_GECKOTERMINAL_NETWORK[chainId];
  if (!network) return null;
  const response = await fetch(`${GECKOTERMINAL_API_BASE}/networks/${network}/tokens/${address}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('GeckoTerminal lookup failed.');
  const data = await response.json();
  const attrs = data?.data?.attributes;
  if (!attrs) return null;
  // GeckoTerminal returns total_supply in raw base units, not decimal-
  // adjusted - dividing by 10^decimals avoids displaying an inflated
  // "fake-looking" supply (e.g. 10^27 instead of the real token count).
  const decimals = Number(attrs.decimals || 0);
  const rawSupply = Number(attrs.total_supply || 0);
  const totalSupply = decimals > 0 && rawSupply ? rawSupply / 10 ** decimals : rawSupply;
  return {
    name: attrs.name,
    symbol: attrs.symbol,
    marketCapUsd: Number(attrs.market_cap_usd || 0),
    fdvUsd: Number(attrs.fdv_usd || 0),
    totalSupply,
    priceUsd: Number(attrs.price_usd || 0),
    logoUrl: cleanLink(attrs.image_url) && !/missing_large/i.test(attrs.image_url || '') ? attrs.image_url : '',
  };
}

// EVM contract creation timestamp via the server-side evm-explorer proxy
// (Etherscan-family APIs, key held server-side). Without a key configured this
// resolves to null (Unknown), never a guess. The two-hop explorer lookup now
// happens inside the proxy function.
export async function fetchExplorerContractCreation(chainId, address) {
  const result = await fetchExplorerProxy(chainId, 'creation', address);
  const timestampMs = result?.timestampMs;
  return typeof timestampMs === 'number' ? timestampMs : null;
}

// Real contract-security signal for EVM chains: is this a proxy
// (upgradeable) contract? Same explorer API, same free key requirement.
export async function fetchExplorerContractFlags(chainId, address) {
  const result = await fetchExplorerProxy(chainId, 'flags', address);
  return result?.flags ?? null;
}

// Shared parser for GoPlus's token_security response shape (same fields on
// both the EVM and Solana endpoints): a holder_count plus a ranked holders
// list with each entry's share of supply as a 0-1 fraction.
export function parseGoPlusHolderResult(result) {
  if (!result) return null;
  const holders = Array.isArray(result.holders) ? result.holders : [];
  const holderCount = result.holder_count !== undefined && result.holder_count !== null
    ? Number(result.holder_count)
    : (holders.length || null);
  if (!holderCount && !holders.length) return null;
  const percents = holders.map((holder) => Number(holder.percent || 0)).filter((value) => !Number.isNaN(value));
  return {
    holderCount: holderCount || null,
    topHolderPercent: percents.length ? roundPercent(percents[0]) : null,
    topTenHolderPercent: percents.length ? roundPercent(percents.slice(0, 10).reduce((total, value) => total + value, 0)) : null,
  };
}

// GoPlus Security (https://gopluslabs.io) - free, no API key, public token-
// security data covering most EVM chains. Used only to fill holder count/
// concentration gaps the existing Dexscreener/CoinGecko/GeckoTerminal/
// block-explorer sources never provide for EVM tokens (those never report
// holder data at all), so it can only add real data, never override it.
// GoPlus returns its boolean-ish flags as the strings "1"/"0" (or omits them
// when unknown). Normalizes to real true/false, or null when GoPlus has no
// answer - so an unknown flag stays "unknown", never a fabricated pass/fail.
export function goPlusFlag(value) {
  if (value === '1' || value === 1) return true;
  if (value === '0' || value === 0) return false;
  return null;
}

export async function fetchGoPlusEvmTokenSecurity(chainId, address) {
  const goPlusChainId = GOPLUS_EVM_CHAIN_IDS[chainId];
  if (!goPlusChainId) return null;
  const response = await fetch(`${GOPLUS_API_BASE}/token_security/${goPlusChainId}?contract_addresses=${address.toLowerCase()}`);
  if (!response.ok) throw new Error('GoPlus token-security lookup failed.');
  const data = await response.json();
  const result = data?.result?.[address.toLowerCase()];
  const parsed = parseGoPlusHolderResult(result);
  if (!result) return parsed ? { ...parsed, source: 'GoPlus Security token holder analysis' } : null;
  // Real contract-security signals GoPlus already returns for EVM tokens (free,
  // no key): a callable mint function (is_mintable), pausable transfers
  // (transfer_pausable ~ freeze authority), and a proxy/upgradeable contract
  // (is_proxy). These fill the mint/freeze/upgrade flags that otherwise require
  // a per-chain explorer API key, so Contract Security resolves for EVM tokens
  // even without one.
  const security = {
    mintAuthorityEnabled: goPlusFlag(result.is_mintable),
    freezeAuthorityEnabled: goPlusFlag(result.transfer_pausable),
    upgradeable: goPlusFlag(result.is_proxy),
  };
  const base = parsed || { holderCount: null, topHolderPercent: null, topTenHolderPercent: null };
  const hasSecurity = Object.values(security).some((value) => value !== null);
  if (!parsed && !hasSecurity) return null;
  return { ...base, ...security, source: 'GoPlus Security token analysis' };
}

// Same GoPlus dataset, Solana-specific endpoint - used only as a fallback
// when the Solana RPC full-account scan and Jupiter's indexed holder count
// both come back empty (rate limiting, RPC outage, very new mint), never to
// replace a real RPC/Jupiter measurement that already succeeded.
export async function fetchGoPlusSolanaTokenSecurity(address) {
  const response = await fetch(`${GOPLUS_API_BASE}/solana/token_security?contract_addresses=${address}`);
  if (!response.ok) throw new Error('GoPlus Solana token-security lookup failed.');
  const data = await response.json();
  const result = data?.result?.[address];
  const parsed = parseGoPlusHolderResult(result);
  return parsed ? { ...parsed, source: 'GoPlus Security token holder analysis' } : null;
}


export async function fetchJupiterTokenData(address) {
  const response = await fetch(`${JUPITER_TOKEN_SEARCH_URL}?query=${encodeURIComponent(address)}`);
  if (!response.ok) throw new Error('Jupiter token lookup failed.');
  const tokens = await response.json();
  const token = Array.isArray(tokens)
    ? tokens.find((item) => item.id?.toLowerCase() === address.toLowerCase())
    : null;
  if (!token) return null;
  return {
    name: token.name,
    symbol: token.symbol,
    holderCount: token.holderCount === undefined || token.holderCount === null ? null : Number(token.holderCount),
    holderGrowthPercent: token.stats24h?.holderChange ?? null,
    liquidity: Number(token.liquidity || 0),
    mcap: Number(token.mcap || 0),
    fdv: Number(token.fdv || 0),
    totalSupply: Number(token.totalSupply || token.circSupply || 0),
    topHoldersPercentage: token.audit?.topHoldersPercentage ?? null,
    // Jupiter's audit flags are "disabled" booleans - invert to the
    // "enabled" framing used throughout the rest of the risk engine.
    mintAuthorityEnabled: typeof token.audit?.mintAuthorityDisabled === 'boolean' ? !token.audit.mintAuthorityDisabled : null,
    freezeAuthorityEnabled: typeof token.audit?.freezeAuthorityDisabled === 'boolean' ? !token.audit.freezeAuthorityDisabled : null,
    tokenProgram: token.tokenProgram,
    launchpad: token.launchpad,
    socialLinks: extractSocialLinksFromMetadata(token),
    rawToken: token,
  };
}

export async function fetchSolanaRpcToken(address) {
  const [supplyResult, largestResult] = await Promise.all([
    solanaRpc('getTokenSupply', [address]),
    solanaRpc('getTokenLargestAccounts', [address]),
  ]);
  const topAccounts = largestResult?.value || [];
  const supply = Number(supplyResult?.value?.uiAmount || 0);
  const topBalances = topAccounts.map((account) => Number(account.uiAmount || 0));
  // getTokenLargestAccounts only returns up to the top 20 accounts, so it is a
  // real source for largest-holder concentration but NEVER a valid holder
  // count - there is no "holderCountEstimate" here on purpose.
  const topHolderPercent = supply ? roundPercent((topBalances[0] || 0) / supply) : null;
  const topTenHolderPercent = supply ? roundPercent(topBalances.slice(0, 10).reduce((total, value) => total + value, 0) / supply) : null;
  return {
    supply,
    topHolderPercent,
    topTenHolderPercent,
    topAccountCount: topAccounts.length,
    topHolders: buildTopHolders(topAccounts, supply),
  };
}

export async function fetchSolanaHolderAnalytics(address) {
  const mintInfo = await fetchMintAccountInfo(address);
  const result = await solanaRpc('getProgramAccounts', [
    mintInfo.programId,
    {
      encoding: 'jsonParsed',
      filters: [
        { memcmp: { offset: 0, bytes: address } },
      ],
    },
  ]);
  const balances = (result || [])
    .map((account) => Number(account?.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0))
    .filter((amount) => amount > 0)
    .sort((a, b) => b - a);
  const supply = balances.reduce((total, amount) => total + amount, 0);
  return {
    holderCount: balances.length,
    topHolderPercent: supply ? roundPercent((balances[0] || 0) / supply) : null,
    topTenHolderPercent: supply ? roundPercent(balances.slice(0, 10).reduce((total, value) => total + value, 0) / supply) : null,
    topHolders: buildTopHolders(balances.map((amount) => ({ uiAmount: amount })), supply),
    source: `Solana RPC token-account scan (${mintInfo.programId === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' ? 'Token-2022' : 'SPL Token'})`,
  };
}

export async function fetchMintAccountInfo(address) {
  const accountInfo = await solanaRpc('getAccountInfo', [address, { encoding: 'jsonParsed' }]);
  const info = accountInfo?.value?.data?.parsed?.info;
  return {
    programId: accountInfo?.value?.owner || 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    // null mintAuthority/freezeAuthority means that authority has been
    // revoked (disabled) - a genuine on-chain security signal.
    mintAuthorityEnabled: info ? info.mintAuthority !== null && info.mintAuthority !== undefined : null,
    freezeAuthorityEnabled: info ? info.freezeAuthority !== null && info.freezeAuthority !== undefined : null,
  };
}

// Walks getSignaturesForAddress backwards to find the mint account's genesis
// transaction (its real creation timestamp), instead of guessing from a DEX
// pair's first-liquidity date. Bounded so it never hammers the public RPC
// indefinitely for high-traffic mints (SOL, BONK, USDC, ...) - if the mint's
// full history can't be reached within the cap, the real age is unknown and
// must be reported as such rather than estimated.
export const MINT_CREATION_LOOKUP_MAX_PAGES = 6;
export const MINT_CREATION_LOOKUP_PAGE_SIZE = 1000;

export async function fetchMintCreationTimestamp(address) {
  let before;
  let oldestBatch = null;
  for (let page = 0; page < MINT_CREATION_LOOKUP_MAX_PAGES; page += 1) {
    const params = before
      ? [address, { limit: MINT_CREATION_LOOKUP_PAGE_SIZE, before }]
      : [address, { limit: MINT_CREATION_LOOKUP_PAGE_SIZE }];
    const batch = await solanaRpc('getSignaturesForAddress', params);
    if (!Array.isArray(batch) || !batch.length) {
      return oldestBatch ? signatureTimestamp(oldestBatch[oldestBatch.length - 1]) : null;
    }
    oldestBatch = batch;
    if (batch.length < MINT_CREATION_LOOKUP_PAGE_SIZE) {
      // Reached the start of this mint's history within the page - the last
      // entry is the genesis (mint creation) transaction.
      return signatureTimestamp(batch[batch.length - 1]);
    }
    before = batch[batch.length - 1].signature;
  }
  // Hit the page cap without reaching genesis - real creation date unknown.
  return null;
}

export function signatureTimestamp(entry) {
  return entry?.blockTime ? entry.blockTime * 1000 : null;
}

export async function solanaRpc(method, params) {
  const response = await fetch(SOLANA_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params }),
  });
  if (!response.ok) throw new Error(`${method} failed.`);
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.message);
  return payload.result;
}

export function buildRealDataRiskNotes({ liquidityUsd, holderCount, tokenAgeDays, mintAuthorityEnabled, freezeAuthorityEnabled, upgradeable }) {
  const notes = [];
  if (liquidityUsd > 0 && liquidityUsd < 5000) notes.push('low liquidity');
  if (holderCount > 0 && holderCount < 500) notes.push('low holders');
  if (tokenAgeDays !== null && tokenAgeDays !== undefined && tokenAgeDays < 14) notes.push('very new project');
  // Only flagged when explicitly known true from on-chain/indexed data -
  // never inferred when the authority/proxy status is unknown.
  if (mintAuthorityEnabled === true) notes.push('mint authority enabled');
  if (freezeAuthorityEnabled === true) notes.push('freeze authority enabled');
  if (upgradeable === true) notes.push('upgradeable contract');
  return notes.length ? notes.join(', ') : translate('scoring.riskNotes.liveDataAvailable');
}

export function buildCanonicalRiskNotes(data = {}) {
  return buildRealDataRiskNotes({
    liquidityUsd: Number(data.totalLiquidityUsd ?? data.liquidityUsd ?? 0),
    holderCount: Number(data.holderCount || 0),
    tokenAgeDays: data.tokenAgeDays,
    mintAuthorityEnabled: data.mintAuthorityEnabled,
    freezeAuthorityEnabled: data.freezeAuthorityEnabled,
    upgradeable: data.upgradeable,
  });
}

export function mergeRiskNotes(...notes) {
  const unique = notes
    .flatMap((note) => String(note || '').split(','))
    .map((note) => note.trim())
    .filter(hasValue)
    .filter((note, index, items) => items.findIndex((item) => item.toLowerCase() === note.toLowerCase()) === index);
  return unique.length ? unique.join(', ') : translate('scoring.riskNotes.liveDataAvailable');
}

// Builds the real top-holder distribution used by the Holder Cluster Map. Each
// entry is a genuine observed balance as a percentage of supply — no synthetic
// holders, no invented links. `accounts` is [{ uiAmount, address? }]. Returns
// null when there is nothing real to draw, so the map stays honest about a gap.
export function buildTopHolders(accounts, supply, limit = 20) {
  const total = Number(supply) || 0;
  if (!total || !Array.isArray(accounts) || !accounts.length) return null;
  const holders = accounts
    .map((account) => ({
      amount: Number(account.uiAmount ?? account.amount ?? 0),
      address: account.address || account.owner || null,
    }))
    .filter((holder) => holder.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit)
    .map((holder, index) => ({
      rank: index + 1,
      pct: roundPercent(holder.amount / total),
      address: holder.address,
    }))
    .filter((holder) => holder.pct > 0);
  return holders.length ? holders : null;
}
