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
// REAL vs MOCK: real network providers (CoinGecko, GitHub, ...) only activate
// when EARLY_STAGE_DISCOVERY_REAL=1 AND any key they need is present. Otherwise
// the mock providers run, so the whole system is fully functional end-to-end
// with zero paid plans or API keys. Swapping in a real source later never
// touches the UI - it just starts returning live records from fetch().

const REAL_ENABLED = String(process.env.EARLY_STAGE_DISCOVERY_REAL || '') === '1';

// ---- Mock data -----------------------------------------------------------
// Deterministic sample projects per source. Kept small and realistic so the
// merged list, filters, sorting, search, and autocomplete all have discovered
// data to exercise even with no external APIs connected.
const MOCK = {
  coingecko: [
    { name: 'Lumen Protocol', symbol: 'LMN', chain: 'Ethereum', category: 'DeFi', stage: 'launching_soon', launchStatus: 'Newly Listed', description: 'Cross-margin lending protocol newly listed on aggregators.', website: 'https://lumenprotocol.io', twitter: 'https://x.com/lumenprotocol', communitySize: 4200, contractAddress: '0xLUMEN00000000000000000000000000000000abcd' },
    { name: 'Zephyr Finance', symbol: 'ZPH', chain: 'Arbitrum', category: 'Perps', stage: 'mainnet_live', launchStatus: 'Recently Added', description: 'On-chain perpetuals exchange with community-owned liquidity.', website: 'https://zephyr.fi', twitter: 'https://x.com/zephyrfi', communitySize: 8800 },
  ],
  github: [
    { name: 'Solstice SDK', symbol: '', chain: 'Solana', category: 'Infrastructure', stage: 'building', launchStatus: 'Active development', description: 'Open-source Rust SDK for building Solana programs faster.', github: 'https://github.com/solstice-labs/solstice', website: 'https://solstice.dev', communitySize: 1300 },
    { name: 'Helios Bridge', symbol: '', chain: 'Ethereum', category: 'Bridge', stage: 'testnet', launchStatus: 'Testnet live', description: 'Trust-minimized messaging bridge, currently in public testnet.', github: 'https://github.com/helios-bridge/helios', twitter: 'https://x.com/heliosbridge' },
  ],
  solana: [
    { name: 'Nova Markets', symbol: 'NOVA', chain: 'Solana', category: 'DEX', stage: 'pre_sale', launchStatus: 'Presale', description: 'High-throughput orderbook DEX built for the Solana ecosystem.', website: 'https://novamarkets.xyz', telegram: 'https://t.me/novamarkets', communitySize: 5600 },
  ],
  ethereum: [
    { name: 'Aether Vaults', symbol: 'AETH', chain: 'Ethereum', category: 'Yield', stage: 'testnet', launchStatus: 'Testnet', description: 'Automated ETH-native yield vaults with risk tranching.', website: 'https://aethervaults.xyz', communitySize: 2100 },
  ],
  base: [
    { name: 'Coral Social', symbol: 'CORAL', chain: 'Base', category: 'SocialFi', stage: 'launching_soon', launchStatus: 'Launching soon', description: 'Onchain social graph and creator monetization on Base.', website: 'https://coral.social', twitter: 'https://x.com/coralsocial', communitySize: 3400 },
  ],
  bnb: [
    { name: 'Pangolin Pay', symbol: 'PGP', chain: 'BNB Chain', category: 'Payments', stage: 'building', launchStatus: 'In development', description: 'Merchant crypto payments rail on BNB Chain.', website: 'https://pangolinpay.io' },
  ],
  arbitrum: [
    { name: 'Orbit Options', symbol: 'ORB', chain: 'Arbitrum', category: 'Options', stage: 'testnet', launchStatus: 'Incentivized testnet', description: 'Decentralized options AMM on Arbitrum Orbit.', website: 'https://orbitoptions.xyz', communitySize: 1900 },
  ],
  optimism: [
    { name: 'Beacon ID', symbol: '', chain: 'Optimism', category: 'Identity', stage: 'public_beta', launchStatus: 'Public beta', description: 'Privacy-preserving onchain identity on the OP Stack.', website: 'https://beaconid.xyz', github: 'https://github.com/beacon-id/beacon' },
  ],
  avalanche: [
    { name: 'Frostbyte Games', symbol: 'FRB', chain: 'Avalanche', category: 'Gaming', stage: 'pre_sale', launchStatus: 'Whitelist open', description: 'On-chain strategy game running on an Avalanche subnet.', website: 'https://frostbyte.gg', telegram: 'https://t.me/frostbyte', communitySize: 7200 },
  ],
  polygon: [
    { name: 'Verdant RWA', symbol: 'VRD', chain: 'Polygon', category: 'RWA', stage: 'launching_soon', launchStatus: 'Launching soon', description: 'Tokenized carbon and real-world assets on Polygon.', website: 'https://verdant.finance', communitySize: 2600 },
  ],
  launchpad: [
    { name: 'Ignition Pad', symbol: 'IGN', chain: 'Solana', category: 'Launchpad', stage: 'pre_sale', launchStatus: 'IDO live', description: 'Community launchpad running its own IDO round.', website: 'https://ignitionpad.xyz', twitter: 'https://x.com/ignitionpad', communitySize: 4800 },
  ],
  testnet: [
    { name: 'Cascade Rollup', symbol: '', chain: 'Ethereum', category: 'Layer 2', stage: 'testnet', launchStatus: 'Devnet', description: 'ZK rollup for high-frequency apps, currently on public testnet.', website: 'https://cascade.build', github: 'https://github.com/cascade-rollup/node' },
  ],
  presale: [
    { name: 'Halo Wallet', symbol: 'HALO', chain: 'Multichain', category: 'Wallet', stage: 'pre_sale', launchStatus: 'Presale round 1', description: 'Smart-account wallet running a community presale.', website: 'https://halowallet.app', communitySize: 3100 },
  ],
  hackathon: [
    { name: 'QuickProof', symbol: '', chain: 'Base', category: 'ZK', stage: 'idea', launchStatus: 'Hackathon winner', description: 'ZK attestation demo that won a recent onchain hackathon.', github: 'https://github.com/quickproof/demo', website: 'https://quickproof.xyz' },
  ],
};

function mockProvider(id, label, kind) {
  return {
    id,
    label,
    kind,
    enabled: true,
    real: false,
    async fetch() {
      return (MOCK[id] || []).map((p) => ({ ...p }));
    },
  };
}

// ---- Real provider scaffolds --------------------------------------------
// These show exactly how a live source plugs in. They stay dormant unless
// REAL_ENABLED is on; each fetch() is wrapped so a failing/blocked/paid API
// simply yields [] (the mock for that slot still runs), never breaking a run.

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
  enabled: REAL_ENABLED,
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

const realGitHub = {
  id: 'github',
  label: 'GitHub',
  kind: 'github',
  enabled: REAL_ENABLED,
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
// To add a source later: append a provider here (mock and/or real). Order is
// only cosmetic; the engine dedupes across all of them.
const MOCK_PROVIDERS = [
  mockProvider('coingecko', 'CoinGecko', 'listing'),
  mockProvider('github', 'GitHub', 'github'),
  mockProvider('solana', 'Solana Ecosystem', 'ecosystem'),
  mockProvider('ethereum', 'Ethereum Ecosystem', 'ecosystem'),
  mockProvider('base', 'Base Ecosystem', 'ecosystem'),
  mockProvider('bnb', 'BNB Chain Ecosystem', 'ecosystem'),
  mockProvider('arbitrum', 'Arbitrum Ecosystem', 'ecosystem'),
  mockProvider('optimism', 'Optimism Ecosystem', 'ecosystem'),
  mockProvider('avalanche', 'Avalanche Ecosystem', 'ecosystem'),
  mockProvider('polygon', 'Polygon Ecosystem', 'ecosystem'),
  mockProvider('launchpad', 'Public Launchpads', 'launchpad'),
  mockProvider('testnet', 'Testnet Projects', 'testnet'),
  mockProvider('presale', 'Presale Projects', 'presale'),
  mockProvider('hackathon', 'Hackathon / Demo', 'hackathon'),
];

const REAL_PROVIDERS = [realCoinGecko, realGitHub];

// Returns the providers that should run.
//   - Flag OFF (default): every mock provider runs, so the feature is fully
//     functional with no keys.
//   - Flag ON (EARLY_STAGE_DISCOVERY_REAL=1): ONLY real providers run, so the
//     cache holds exclusively real discovery. Mock providers stay registered
//     as scaffolds/fallback; as more real providers are implemented, coverage
//     grows just by adding them to REAL_PROVIDERS - no other change.
// The engine's reconciliation (see _discoveryEngine) then prunes any cached
// records whose provider is no longer running, so flipping the flag on cleanly
// removes the mock/orphaned entries on the next run.
export function getProviders() {
  if (!REAL_ENABLED) return MOCK_PROVIDERS.filter((p) => p.enabled);
  return REAL_PROVIDERS.filter((p) => p.enabled);
}
