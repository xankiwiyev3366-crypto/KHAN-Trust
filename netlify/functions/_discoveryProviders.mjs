// Discovery PROVIDER registry (Phase 2). This is the extension point: a data
// source is just an object with an async `fetch()` that returns an array of
// loose "raw" project records. The engine (_discoveryEngine.mjs) normalizes,
// dedupes, and caches whatever the providers return, so adding a new source is
// a one-object change here - no engine, endpoint, or UI change required.
//
// Provider shape:
//   {
//     id:      'coingecko',                // stable unique id
//     label:   'CoinGecko',                // shown as the "Source" badge
//     kind:    'listing' | 'github' | ...  // free-form, for grouping/telemetry
//     enabled: true,
//     async fetch({ limit }) -> rawProject[]
//   }
//
// A rawProject is intentionally loose (any subset of these keys):
//   name, symbol, logoUrl, description, chain, category, website, twitter,
//   telegram, discord, github, launchStatus, stage, communitySize,
//   contractAddress, sourceUrl
//
// EVERY PROVIDER HERE IS REAL. THERE IS NO FALLBACK DATA. THIS IS LOAD-BEARING.
//
// WHAT WAS HERE BEFORE, AND WHY IT WAS THE WORST BUG IN THE REPOSITORY
//
// This module used to ship ~18 invented projects — fabricated names, tickers,
// descriptions, websites, X handles, community sizes, and contract addresses
// that were not addresses at all, just the project's fake name padded out to
// look like one. They ran by
// DEFAULT: real providers activated only when EARLY_STAGE_DISCOVERY_REAL=1, a
// variable that was not in .env.example and therefore almost certainly unset in
// production. The scheduled worker wrote them into the discovery cache every
// two hours and the public list served them merged with real community
// submissions, badged "Auto Discovered" with "Source: DexScreener" — attributing
// invented records to a named third party that had never seen them.
//
// The original justification was that it made the feature demoable with no API
// keys. That argument does not survive contact with the product: this is a
// TRUST platform, and a fabricated project record is the single worst thing it
// can emit. It is also moot — every provider below is FREE and KEYLESS, so
// there was never anything to stand in for.
//
// THE RULE, WHICH MUST NOT BE SOFTENED
//
// A provider that cannot reach its source returns [] — "we could not ask" —
// and the run simply discovers less. It never substitutes invented records for
// missing ones. An empty Early Stage list is a true statement about the world;
// a populated one built from fiction is not. This is the same "absence is not
// zero / a failed fetch is not an observation" posture that _volatileSignals.mjs
// enforces on the scanner, applied to the one surface that had escaped it.
//
// Optional keys (COINGECKO_API_KEY, GITHUB_TOKEN) only raise rate limits. Their
// absence costs coverage, never truthfulness.

// ---- Real providers ------------------------------------------------------
// Each fetch() is wrapped so a failing/blocked/rate-limited API simply yields
// [] and the run continues with whatever the other sources returned.

async function safeJson(url, options, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const realCoinGecko = {
  id: 'coingecko',
  label: 'CoinGecko',
  kind: 'listing',
  enabled: true,
  real: true,
  async fetch({ limit = 20 } = {}) {
    // Trending search: the coins users are actively looking at right now -
    // genuinely relevant, and each item carries a name, symbol, logo, and
    // market-cap rank. Free endpoint (a demo key just raises rate limits).
    // Any failure/paywall -> [] and the run continues.
    const key = process.env.COINGECKO_API_KEY;
    const headers = key ? { 'x-cg-demo-api-key': key } : {};
    const data = await safeJson('https://api.coingecko.com/api/v3/search/trending', { headers });
    const coins = data?.coins;
    if (!Array.isArray(coins)) return [];
    return coins
      .slice(0, limit)
      .map(({ item }) => {
        if (!item?.name) return null;
        const rank = Number.isFinite(item.market_cap_rank) ? item.market_cap_rank : null;
        return {
          name: item.name,
          symbol: item.symbol || '',
          logoUrl: item.large || item.thumb || '',
          description: `Trending on CoinGecko${rank ? ` · market-cap rank #${rank}` : ''}.`,
          category: 'Trending',
          chain: '',
          stage: 'mainnet_live',
          launchStatus: 'Trending',
          sourceUrl: item.id ? `https://www.coingecko.com/en/coins/${item.id}` : '',
        };
      })
      .filter(Boolean);
  },
};

// Chain id (DexScreener slug) -> friendly display label for discovered cards.
const CHAIN_LABELS = {
  solana: 'Solana', ethereum: 'Ethereum', bsc: 'BNB Chain', base: 'Base',
  arbitrum: 'Arbitrum', polygon: 'Polygon', avalanche: 'Avalanche', optimism: 'Optimism',
  sui: 'Sui', ton: 'TON', tron: 'Tron', pulsechain: 'PulseChain', blast: 'Blast', sei: 'Sei',
};
function chainLabel(id) {
  const key = String(id || '').toLowerCase();
  if (!key) return '';
  return CHAIN_LABELS[key] || (key.charAt(0).toUpperCase() + key.slice(1));
}

// DexScreener exposes links loosely across profile.links ({type|label,url}) and
// pair.info.socials/websites. Pull the first valid website/twitter/telegram/
// discord out of whichever arrays are present.
function pickLinks(profileLinks, info = {}) {
  const out = { website: '', twitter: '', telegram: '', discord: '' };
  const consider = (type, url) => {
    const u = String(url || '');
    if (!/^https?:\/\//i.test(u)) return;
    const key = String(type || '').toLowerCase();
    if ((key.includes('twitter') || key === 'x') && !out.twitter) out.twitter = u;
    else if (key.includes('telegram') && !out.telegram) out.telegram = u;
    else if (key.includes('discord') && !out.discord) out.discord = u;
    else if ((key.includes('website') || key.includes('web')) && !out.website) out.website = u;
  };
  for (const l of Array.isArray(profileLinks) ? profileLinks : []) consider(l.type || l.label, l.url);
  for (const s of Array.isArray(info.socials) ? info.socials : []) consider(s.type || s.label, s.url);
  for (const w of Array.isArray(info.websites) ? info.websites : []) if (!out.website) consider('website', w.url);
  return out;
}

// THE "newly launched" feed. DexScreener's latest token profiles are the newest
// tokens gaining an on-chain presence - exactly the "launched today/yesterday"
// projects the trending/repo sources never surface. Each profile is enriched
// via token-pairs to recover a display name, symbol, real launch timestamp
// (pairCreatedAt), and socials. Free, keyless endpoints; every network call is
// wrapped so any failure yields [] (or a thinner record) and never breaks a run.
const realDexScreener = {
  id: 'dexscreener',
  label: 'DexScreener',
  kind: 'listing',
  enabled: true,
  real: true,
  async fetch({ limit = 20 } = {}) {
    const profiles = await safeJson('https://api.dexscreener.com/token-profiles/latest/v1');
    const list = Array.isArray(profiles) ? profiles : [];
    const picked = list.filter((p) => p?.tokenAddress && p?.chainId).slice(0, limit);
    if (!picked.length) return [];
    const enriched = await Promise.all(picked.map(async (p) => {
      const pairs = await safeJson(
        `https://api.dexscreener.com/token-pairs/v1/${encodeURIComponent(p.chainId)}/${encodeURIComponent(p.tokenAddress)}`
      );
      const arr = Array.isArray(pairs) ? pairs : (Array.isArray(pairs?.pairs) ? pairs.pairs : []);
      // Earliest-created pair gives the most stable launch timestamp.
      const pair = arr.filter(Boolean).sort((a, b) => (a.pairCreatedAt || Infinity) - (b.pairCreatedAt || Infinity))[0] || null;
      const base = pair?.baseToken || {};
      const info = pair?.info || {};
      // Fall back through pair name -> profile header so a token is only dropped
      // when there is genuinely nothing renderable (requirement: don't hide new
      // projects just because some metadata is missing).
      const name = String(base.name || p.header || '').trim();
      if (!name) return null;
      const links = pickLinks(p.links, info);
      const launchedAt = Number.isFinite(pair?.pairCreatedAt) ? new Date(pair.pairCreatedAt).toISOString() : '';
      return {
        name,
        symbol: base.symbol || '',
        logoUrl: p.icon || info.imageUrl || '',
        description: String(p.description || '').slice(0, 400),
        chain: chainLabel(p.chainId),
        category: 'Newly Launched',
        stage: 'mainnet_live',
        launchStatus: 'Recently launched',
        website: links.website,
        twitter: links.twitter,
        telegram: links.telegram,
        discord: links.discord,
        contractAddress: p.tokenAddress,
        launchedAt,
        sourceUrl: p.url || '',
      };
    }));
    return enriched.filter(Boolean);
  },
};

const realGitHub = {
  id: 'github',
  label: 'GitHub',
  kind: 'github',
  enabled: true,
  real: true,
  async fetch({ limit = 20 } = {}) {
    // Active blockchain repos created recently. Unauthenticated calls are
    // heavily rate-limited; a token lifts that. On any failure -> [].
    const token = process.env.GITHUB_TOKEN;
    const headers = { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
    const q = encodeURIComponent('topic:blockchain topic:web3 stars:>25 pushed:>2025-01-01');
    const data = await safeJson(`https://api.github.com/search/repositories?q=${q}&sort=updated&per_page=${limit}`, { headers });
    const items = data?.items;
    if (!Array.isArray(items)) return [];
    return items.map((r) => ({
      name: r.name,
      description: r.description || '',
      category: 'Open Source',
      chain: '',
      stage: 'building',
      launchStatus: 'Active development',
      github: r.html_url,
      website: r.homepage || '',
      communitySize: r.stargazers_count || 0,
      sourceUrl: r.html_url,
    }));
  },
};

// ---- Registry ------------------------------------------------------------
// To add a source later: append one real provider object here. Order is only
// cosmetic; the engine dedupes across all of them.
//
// DexScreener leads: it is the source of genuinely newly-launched tokens, so it
// should populate the freshest records first each run.
const REAL_PROVIDERS = [realDexScreener, realCoinGecko, realGitHub];

// The providers that run. Every one of them fetches from a live public API;
// there is no flag, no mock mode, and no fallback registry to fall back TO.
//
// If every provider is unreachable the run discovers nothing and the engine
// writes an empty set. That is the correct outcome — see the header. Do not
// reintroduce a stand-in registry here.
export function getProviders() {
  return REAL_PROVIDERS.filter((p) => p.enabled);
}
