// Volatile risk signals — the server-side data acquisition layer for the
// re-scan worker.
//
// WHY ONLY "VOLATILE" SIGNALS
//
// A trust score blends ~17 inputs, but most of them are CONSTANTS between two
// hourly runs: a token's website, X account, founder status, roadmap and
// description do not change while you are watching it. Re-fetching all 18 of
// the client's providers every hour would spend most of its budget
// recomputing things that cannot have moved.
//
// What actually moves — and what actually rugs a holder — is a small set:
//
//   liquidity        the pool being pulled IS the rug
//   holder concentration   a whale accumulating to dump
//   mint/freeze authority  re-enabled = the supply rules just changed under you
//   24h volume       activity collapsing or spiking
//
// Those come from exactly two free, keyless HTTP calls per token (DexScreener
// + GoPlus). That is what makes an hourly worker affordable at scale, and it
// detects a rug FASTER than a blended score would: liquidity going to zero is
// unambiguous, where a trust score moving 72 -> 61 is a lagging abstraction of
// the same event.
//
// THE RULE THIS MODULE EXISTS TO ENFORCE: A FAILED FETCH IS NOT AN OBSERVATION
//
// tests/trustScore.test.mjs pins the hazard: a provider outage alone drops a
// healthy token from 91 to 72 — past alerts-run's 10-point threshold. So if
// this module ever quietly returned "no liquidity" when it actually meant "the
// request failed", the worker would email "your token got riskier" because an
// HTTP call timed out. In a trust product that is worse than silence.
//
// So every provider here reports one of THREE states, never two:
//
//   { ok: true,  value }   we asked and got an answer
//   { ok: true,  value: <empty> }  we asked; the answer is genuinely "nothing"
//                                  (no pools left — which may itself BE the rug)
//   { ok: false, reason }  we could not ask. NOT a data point. Never scored.
//
// This mirrors the platform's existing "absence is not zero" posture (see the
// Confidence Engine in _growthConfidence.mjs) and is the same distinction the
// scoring engine makes by returning null rather than 0 for unknown signals.

const DEXSCREENER_TOKEN_PAIRS_BASE_URL = 'https://api.dexscreener.com/token-pairs/v1';
const GOPLUS_API_BASE = 'https://api.gopluslabs.io/api/v1';

// Mirrors GOPLUS_EVM_CHAIN_IDS in src/main.jsx. Solana is handled by its own
// GoPlus endpoint and is intentionally absent here.
const GOPLUS_EVM_CHAIN_IDS = {
  ethereum: '1',
  bsc: '56',
  polygon: '137',
  base: '8453',
  arbitrum: '42161',
  avalanche: '43114',
  optimism: '10',
};

export const SUPPORTED_CHAINS = new Set(['solana', ...Object.keys(GOPLUS_EVM_CHAIN_IDS)]);

const DEFAULT_TIMEOUT_MS = 8000;

// Matches roundPercent() in src/main.jsx so server-computed concentration is
// expressed identically to the client's.
function roundPercent(ratio) {
  return Math.round(ratio * 10000) / 100;
}

// GoPlus returns boolean-ish flags as "1"/"0", or omits them when unknown.
// Normalizes to real true/false, or null when GoPlus has no answer — so an
// unknown flag stays unknown rather than becoming a fabricated pass/fail.
function goPlusFlag(value) {
  if (value === '1' || value === 1) return true;
  if (value === '0' || value === 0) return false;
  return null;
}

// A fetch that can only ever resolve to "we got JSON" or "we did not".
// Distinguishing those two is the entire point of this module, so this never
// returns a bare null that a caller could mistake for data.
async function getJson(url, { fetchImpl, timeoutMs }) {
  // Belt and braces on the timeout. The AbortSignal asks the transport to stop
  // (real fetch honours it, and it frees the socket); the race GUARANTEES this
  // resolves regardless of whether the transport cooperates. Relying on abort
  // alone means any implementation that ignores the signal wedges the worker
  // forever — and this runs on a cron with a hard runtime cap, so one hung
  // request would eat the budget for every other watched token.
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ ok: false, reason: 'timeout' });
    }, timeoutMs);
  });

  const attempt = (async () => {
    try {
      const response = await fetchImpl(url, { signal: controller.signal });
      if (!response.ok) return { ok: false, reason: `http_${response.status}` };
      return { ok: true, json: await response.json() };
    } catch (error) {
      return { ok: false, reason: error?.name === 'AbortError' ? 'timeout' : `network_${error?.message || 'error'}` };
    }
  })();

  try {
    return await Promise.race([attempt, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// ── DexScreener: liquidity, volume, pair age ──────────────────────────────────

// NOTE the critical branch: an empty pairs array is a SUCCESSFUL observation
// that the token has no liquidity pools. For a token someone is watching,
// that is not missing data — that is very possibly the rug itself, and it must
// reach the scorer as a real zero rather than being mistaken for a failure.
export async function fetchDexLiquidity(address, chain, opts) {
  const result = await getJson(`${DEXSCREENER_TOKEN_PAIRS_BASE_URL}/${chain}/${address}`, opts);
  if (!result.ok) return result;

  const pairs = Array.isArray(result.json) ? result.json : [];
  const normalized = address.toLowerCase();
  const matching = pairs
    .filter((pair) => pair.chainId === chain)
    .filter((pair) => (
      pair.baseToken?.address?.toLowerCase() === normalized
      || pair.quoteToken?.address?.toLowerCase() === normalized
    ));

  const totalLiquidityUsd = matching.reduce((total, pair) => total + Number(pair?.liquidity?.usd || 0), 0);
  const volume24hUsd = matching.reduce((total, pair) => total + Number(pair?.volume?.h24 || 0), 0);
  const oldestPairCreatedAt = matching
    .map((pair) => pair.pairCreatedAt)
    .filter(Boolean)
    .sort((a, b) => a - b)[0] || null;

  return {
    ok: true,
    value: {
      poolCount: matching.length,
      // A genuine 0 when there are no pools. The scoring engine maps 0 to null
      // (unknown) via scoreLiquidity, but liveDataPenalty and the rug detector
      // in the worker read the raw number, where 0 is meaningful.
      totalLiquidityUsd,
      volume24hUsd,
      oldestPairCreatedAt,
    },
  };
}

// ── GoPlus: holders, concentration, authorities ───────────────────────────────

function parseGoPlusHolders(result) {
  const holders = Array.isArray(result.holders) ? result.holders : [];
  const holderCount = result.holder_count !== undefined && result.holder_count !== null
    ? Number(result.holder_count)
    : (holders.length || null);
  const percents = holders.map((holder) => Number(holder.percent || 0)).filter((value) => !Number.isNaN(value));
  return {
    holderCount: holderCount || null,
    // GoPlus percents arrive as a 0-1 ratio string; roundPercent matches how
    // the client renders the same field.
    topHolderPercent: percents.length ? roundPercent(percents[0]) : null,
    topTenHolderPercent: percents.length ? roundPercent(percents.slice(0, 10).reduce((total, value) => total + value, 0)) : null,
  };
}

// ── Developer wallet observation ─────────────────────────────────────────────
//
// Extracted from the SAME GoPlus response the worker already fetches — these
// fields were previously parsed away. No new provider, no new key, no added
// latency, no change to the two-calls-per-token economics.
//
// THE TWO CHAINS EXPOSE GENUINELY DIFFERENT THINGS, AND WE RECORD ONLY WHAT
// EACH ACTUALLY GIVES:
//
//   EVM     creator_address / creator_percent  — the deployer's remaining stake.
//           owner_address / owner_percent      — the privileged owner's stake.
//           A deployer's stake SHRINKING is the earliest honest rug signal
//           there is: it precedes the liquidity pull rather than following it.
//
//   Solana  has no creator balance at all. What it does expose is the SET OF
//           AUTHORITY ADDRESSES (mint, freeze, balance-mutable, metadata
//           upgrade) plus the declared creators. A change in WHO holds an
//           authority is the Solana-equivalent high-signal event: the same
//           powers, in a different wallet, is a transfer of control the holder
//           was never told about.
//
// Verified against live responses for both chains before this was written —
// guessing at field names would have produced a monitor that silently reported
// null forever, which is worse than not shipping it.
//
// Every field is null when GoPlus omits it. Null means "not observed" and can
// never be diffed into a change (see _watchSignals.mjs) — an absent value must
// never read as "the developer sold".
function num(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function addressList(value) {
  if (!Array.isArray(value)) return null;
  const addresses = value
    .map((entry) => (typeof entry === 'string' ? entry : entry?.address))
    .filter((address) => typeof address === 'string' && address.length > 0);
  // Sorted so the comparison is order-insensitive: GoPlus does not promise a
  // stable ordering, and an array reshuffle must never read as a control change.
  return addresses.sort();
}

function parseDevWallet(entry, chain) {
  if (chain === 'solana') {
    return {
      // Who currently holds each privileged authority. Empty array is a REAL
      // observation ("renounced — nobody holds it"), distinct from null
      // ("GoPlus did not tell us").
      mintAuthorities: addressList(entry.mintable?.authority),
      freezeAuthorities: addressList(entry.freezable?.authority),
      balanceAuthorities: addressList(entry.balance_mutable_authority?.authority),
      metadataAuthorities: addressList(entry.metadata_mutable?.metadata_upgrade_authority),
      creators: addressList(entry.creators),
      // Not available on Solana. Recorded as null rather than omitted so the
      // shape is uniform across chains and a consumer never has to ask which
      // chain it is looking at to know whether a field is meaningful.
      creatorAddress: null,
      creatorPercent: null,
      ownerAddress: null,
      ownerPercent: null,
    };
  }

  return {
    mintAuthorities: null,
    freezeAuthorities: null,
    balanceAuthorities: null,
    metadataAuthorities: null,
    creators: null,
    creatorAddress: typeof entry.creator_address === 'string' ? entry.creator_address : null,
    creatorPercent: num(entry.creator_percent),
    ownerAddress: typeof entry.owner_address === 'string' ? entry.owner_address : null,
    ownerPercent: num(entry.owner_percent),
  };
}

export async function fetchTokenSecurity(address, chain, opts) {
  const url = chain === 'solana'
    ? `${GOPLUS_API_BASE}/solana/token_security?contract_addresses=${address}`
    : `${GOPLUS_API_BASE}/token_security/${GOPLUS_EVM_CHAIN_IDS[chain]}?contract_addresses=${address.toLowerCase()}`;

  const result = await getJson(url, opts);
  if (!result.ok) return result;

  // GoPlus keys its result map by the address, casing per chain.
  const map = result.json?.result || {};
  const entry = map[address] || map[address.toLowerCase()] || null;

  // No entry means GoPlus has never indexed this token. That is "we cannot
  // answer", NOT "this token is clean" and not "this token is dangerous".
  if (!entry) return { ok: false, reason: 'not_indexed' };

  const holders = parseGoPlusHolders(entry);
  return {
    ok: true,
    value: {
      ...holders,
      // Observed alongside the scored signals, never scored. See the note on
      // `devWallet` in fetchVolatileSignals().
      devWallet: parseDevWallet(entry, chain),
      // Solana exposes these directly; EVM exposes analogous flags. An absent
      // flag stays null so scoreSecurity() reports "unknown" rather than "safe".
      mintAuthorityEnabled: chain === 'solana'
        ? goPlusFlag(entry.mintable?.status ?? entry.mintable)
        : goPlusFlag(entry.is_mintable),
      freezeAuthorityEnabled: chain === 'solana'
        ? goPlusFlag(entry.freezable?.status ?? entry.freezable)
        : goPlusFlag(entry.transfer_pausable),
      upgradeable: chain === 'solana'
        ? goPlusFlag(entry.closable?.status ?? entry.closable)
        : goPlusFlag(entry.is_proxy),
    },
  };
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

// Both providers are REQUIRED. This is deliberate and is the whole safety
// property: a snapshot built from one provider is a snapshot with a different
// input set than the last one, and a changed input set is indistinguishable
// from a changed token. Rather than write a score we cannot compare, we decline
// to observe and try again next hour. A missed hour costs nothing; a false rug
// alert costs the user's trust permanently.
export async function fetchVolatileSignals({ contract, chain = 'solana' }, options = {}) {
  const opts = {
    fetchImpl: options.fetchImpl || globalThis.fetch,
    timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
  };

  if (!contract || typeof contract !== 'string') {
    return { ok: false, reason: 'no_contract', failures: ['no_contract'] };
  }
  if (!SUPPORTED_CHAINS.has(chain)) {
    return { ok: false, reason: 'unsupported_chain', failures: [`unsupported_chain:${chain}`] };
  }

  const [liquidity, security] = await Promise.all([
    fetchDexLiquidity(contract, chain, opts),
    fetchTokenSecurity(contract, chain, opts),
  ]);

  const failures = [];
  if (!liquidity.ok) failures.push(`dexscreener:${liquidity.reason}`);
  if (!security.ok) failures.push(`goplus:${security.reason}`);
  if (failures.length) {
    return { ok: false, reason: 'incomplete', failures };
  }

  const tokenAgeDays = liquidity.value.oldestPairCreatedAt
    ? Math.floor((Date.now() - liquidity.value.oldestPairCreatedAt) / 86400000)
    : null;

  return {
    ok: true,
    // Shaped to slot straight into calculateLiveScores(project, data) as `data`.
    //
    // `devWallet` RIDES ALONG BUT IS NEVER SCORED. calculateLiveScores reads
    // only the fields it knows; an extra key is inert to it. That is the whole
    // reason developer-wallet monitoring could be added without bumping
    // RESCAN_ENGINE_VERSION: the SCORE's input set is byte-for-byte what it was,
    // so every snapshot written before this change stays comparable to every one
    // written after, and no existing subscriber goes blind for a period while
    // baselines re-establish.
    //
    // The new dimension is diffed on its own terms in _watchSignals.mjs. Old
    // snapshots simply lack the key, and an absent side is never a change.
    value: {
      totalLiquidityUsd: liquidity.value.totalLiquidityUsd,
      liquidityUsd: liquidity.value.totalLiquidityUsd,
      poolCount: liquidity.value.poolCount,
      volume24hUsd: liquidity.value.volume24hUsd,
      tokenAgeDays,
      holderCount: security.value.holderCount,
      topHolderPercent: security.value.topHolderPercent,
      topTenHolderPercent: security.value.topTenHolderPercent,
      mintAuthorityEnabled: security.value.mintAuthorityEnabled,
      freezeAuthorityEnabled: security.value.freezeAuthorityEnabled,
      upgradeable: security.value.upgradeable,
      devWallet: security.value.devWallet,
    },
    sources: ['dexscreener', 'goplus'],
  };
}
