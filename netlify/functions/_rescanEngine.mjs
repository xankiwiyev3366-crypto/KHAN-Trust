// The re-scan engine — the thing that makes the retention loop actually loop.
//
// WHAT WAS BROKEN
//
// alerts-run.mjs describes itself as "the single strongest reason to return to
// KHAN Trust: it watches for you." It could not. It compared snapshots from the
// token corpus, and the ONLY writer to that corpus was a client-side call fired
// when a human viewed a token (src/tokenCorpus.js, throttled to once/day/token
// in localStorage). So the watchtower could only ever see tokens someone was
// already standing in front of. A dormant token's snapshot was frozen forever,
// riskWorsened(prev, current) was permanently false, and no alert could fire.
// Retention was a function of the traffic it existed to create.
//
// This module refreshes watched tokens on a schedule, with no browser and no
// user present. That is the entire fix.
//
// WHY A SEPARATE LANE, NOT THE CORPUS
//
// The corpus is the CLIENT's lane: what users have scanned, powering discovery,
// SEO pages and leaderboards, computed from all 18 providers. This engine
// computes from the volatile subset only (see _volatileSignals.mjs), which is a
// different input set and therefore a different number — measured, not
// theorised: at the same moment BONK scores 35 (High) from the client's inputs
// and 76 (Medium) from these. Both are internally consistent; neither is wrong;
// they are simply not comparable.
//
// Two consequences, and they are the whole design:
//
//  1. These snapshots live in their own store (_watchSnapshotStore.mjs), so a
//     server re-scan never overwrites what a user sees on a token page. If it
//     did, discovery would show 76 while the scanner showed 35 and the site
//     would contradict itself.
//
//  2. alerts-run compares server snapshots ONLY to server snapshots. Comparing
//     across lanes would read that 41-point methodology gap as a real risk
//     collapse and email every watcher on the first tick — from a product whose
//     only asset is trust. The lanes must never touch.
//
// A snapshot is written only from a COMPLETE fetch. A partial fetch is not a
// cheap observation, it is a false one: tests/trustScore.test.mjs pins that an
// outage alone moves a healthy token 91 -> 72, past the 10-point alert
// threshold. A missed hour costs nothing. A false rug alert costs the user.
import { fetchVolatileSignals, SUPPORTED_CHAINS } from './_volatileSignals.mjs';
import { calculateLiveScores, scoreToRisk } from '../../src/lib/trustScore.js';

// The engine version. Stamped on every snapshot so that if the volatile input
// set ever changes, alerts-run can refuse to compare snapshots produced by
// different methodologies — the same lane-separation rule, enforced across
// time rather than across systems. Bump this whenever the inputs to
// fetchVolatileSignals change in a way that could move a score.
export const RESCAN_ENGINE_VERSION = 1;

// Subscriptions store `chain` as a DISPLAY LABEL ("Solana", "BSC") because
// that is what chainLabelFor() produced on the client. The providers key off
// lowercase chain ids. Without this every watched token would be declined as
// unsupported_chain and the worker would appear to run perfectly while doing
// absolutely nothing — the exact failure mode this whole module exists to end.
// Accepts a label or an id, case-insensitively.
export function normalizeChain(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  if (SUPPORTED_CHAINS.has(raw)) return raw;
  // "BSC" -> bsc, "Solana" -> solana, "BNB Chain" -> bsc
  const byLabel = {
    solana: 'solana',
    ethereum: 'ethereum',
    eth: 'ethereum',
    bsc: 'bsc',
    'bnb chain': 'bsc',
    binance: 'bsc',
    base: 'base',
    arbitrum: 'arbitrum',
    polygon: 'polygon',
    avalanche: 'avalanche',
    optimism: 'optimism',
  };
  return byLabel[raw] || null;
}

// Builds the `project` half of the scoring call. The volatile lane deliberately
// carries NO profile data (no website/twitter/founder/roadmap): those cannot
// change between hourly runs, and including them for some tokens and not others
// would make snapshots incomparable to each other. Every snapshot in this lane
// is therefore scored from the same input set, which is what makes the
// run-over-run comparison meaningful.
function projectFor(token) {
  return { name: token.name || '', ticker: token.ticker || '' };
}

// Scores one watched token. Returns a snapshot, or a reason it declined to
// observe. Never throws — one bad token must not abort the run for everyone.
export async function rescanToken(token, options = {}) {
  const chain = normalizeChain(token.chain);
  if (!chain) {
    return { ok: false, identity: token.identity, reason: `unsupported_chain:${token.chain || 'none'}` };
  }
  if (!token.contract) {
    // 'id:'-style identities are manually-added projects with no contract to
    // observe on-chain. Nothing to re-scan; not an error.
    return { ok: false, identity: token.identity, reason: 'no_contract' };
  }

  let signals;
  try {
    signals = await fetchVolatileSignals({ contract: token.contract, chain }, options);
  } catch (error) {
    return { ok: false, identity: token.identity, reason: `crashed:${error?.message || 'unknown'}` };
  }

  if (!signals.ok) {
    return { ok: false, identity: token.identity, reason: signals.reason, failures: signals.failures };
  }

  const scores = calculateLiveScores(projectFor(token), signals.value);
  const trustScore = scores.finalTrustScore;

  return {
    ok: true,
    identity: token.identity,
    snapshot: {
      identity: token.identity,
      contract: token.contract,
      chain,
      name: token.name || '',
      ticker: token.ticker || '',
      trustScore,
      riskLevel: scoreToRisk(trustScore),
      // The raw signals travel with the snapshot so alerts-run can explain WHY
      // in plain language ("liquidity dropped 80%") without re-fetching, and so
      // a future change to the score cannot erase the evidence behind an alert
      // already sent.
      signals: {
        totalLiquidityUsd: signals.value.totalLiquidityUsd,
        poolCount: signals.value.poolCount,
        volume24hUsd: signals.value.volume24hUsd,
        holderCount: signals.value.holderCount,
        topHolderPercent: signals.value.topHolderPercent,
        topTenHolderPercent: signals.value.topTenHolderPercent,
        mintAuthorityEnabled: signals.value.mintAuthorityEnabled,
        freezeAuthorityEnabled: signals.value.freezeAuthorityEnabled,
        upgradeable: signals.value.upgradeable,
      },
      source: 'server_rescan',
      engineVersion: RESCAN_ENGINE_VERSION,
      observedAt: new Date().toISOString(),
    },
  };
}

// Collapses every subscription's token list into the DISTINCT set of tokens to
// observe. Ten users watching BONK is one re-scan, not ten — the work scales
// with tokens watched, not with users, which is what lets this stay affordable
// as the user base grows.
export function distinctWatchedTokens(subscriptions) {
  const byIdentity = new Map();
  for (const sub of subscriptions) {
    if (!sub || !Array.isArray(sub.tokens)) continue;
    for (const token of sub.tokens) {
      if (!token?.identity || byIdentity.has(token.identity)) continue;
      byIdentity.set(token.identity, token);
    }
  }
  return Array.from(byIdentity.values());
}

// Runs the tokens in bounded-concurrency batches. Netlify caps a scheduled
// function at 30s, so this is called from a *-background function (15min cap)
// — but bounded anyway, because firing hundreds of parallel requests at two
// free public APIs is how you get rate-limited into a global outage of your own
// alerting.
export async function rescanAll(tokens, options = {}) {
  const concurrency = options.concurrency || 4;
  const results = [];
  for (let i = 0; i < tokens.length; i += concurrency) {
    const batch = tokens.slice(i, i + concurrency);
    results.push(...await Promise.all(batch.map((token) => rescanToken(token, options))));
  }
  return {
    results,
    observed: results.filter((r) => r.ok).length,
    declined: results.filter((r) => !r.ok).length,
  };
}
