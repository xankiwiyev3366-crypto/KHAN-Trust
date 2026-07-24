// Monitored Score — how continuous server monitoring writes a Trust Score
// HISTORY point without a browser present.
//
// THE PROBLEM THIS SOLVES
//
// The Trust Graph reads score-history (src/scoreHistory.js), which was only ever
// written client-side when a human opened a token page. So a token you MONITOR
// but never open produced an empty graph — "we watch for you" could not fill the
// one chart that shows what the watching found. The re-scan worker observed the
// token every cycle and wrote a WATCH-lane snapshot (for alerts), but nothing
// carried that into the score-history series the graph draws.
//
// WHY NOT JUST WRITE THE WATCH-LANE (VOLATILE) SCORE
//
// The watch lane scores from the volatile subset only (two providers) and is,
// by design, a DIFFERENT NUMBER from the full 18-provider score the client
// computes for the same token — measured, not theorised: BONK reads 35 from the
// client's inputs and 76 from the volatile subset at the same instant (see
// _rescanEngine.mjs and _volatileSignals.mjs). Appending the volatile number to
// the same key the client fills with full-methodology points would draw a line
// that jumps 35 <-> 76 purely by WHERE the observation came from — manufacturing
// the exact false swings score-history's quality gate exists to prevent.
//
// THE APPROACH: RECONSTRUCT THE FULL SCORE, NOT A SECOND METHODOLOGY
//
// The full score's inputs split cleanly in two:
//   * VOLATILE — liquidity, holders, concentration, authorities, volume, age.
//     These move between runs and the worker already fetches them fresh.
//   * STABLE — the profile (website/X/founder/roadmap/description/community),
//     market cap, CoinGecko listing, supply. These do not change hour to hour,
//     so the client persists them once (extractScoreInputs, stored on the token
//     corpus) and the worker reuses them.
//
// The worker then recomputes with the SAME calculateLiveScores the browser uses
// — one scorer, not two — over {persisted stable} + {fresh volatile}. The result
// is a genuine full-methodology point that is comparable to the client's own
// points, so the graph fills from monitoring with no methodology seam.
//
// THE ACCEPTED CAVEAT: market cap is the last value the client observed (the
// server has no CoinGecko fetch). Its weight is small (6) and it moves slowly;
// the score still tracks every volatile change — which is what a rug is made of.
import {
  calculateLiveScores,
  scoreToRisk,
  socialPresenceState,
  hasRoadmap,
  hasValue,
} from './trustScore.js';

function numOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Whether one social channel counts as PRESENT under the exact rule
// calculateLiveScores uses, collapsed to a boolean the corpus can store cheaply.
function presentBool(kind, project, data) {
  return socialPresenceState(kind, project, data).state === 'Present';
}

// The compact, STABLE half of a token's scoring inputs — everything the full
// score needs that the volatile re-scan does NOT refetch. Produced on the client
// (which has the full project + realData in hand) and persisted on the corpus
// record so the server can later rebuild a full-methodology score. Deliberately
// primitive and bounded: booleans, short strings and a handful of numbers, so a
// public write endpoint can validate every field (see token-corpus-record.mjs).
export function extractScoreInputs(project = {}) {
  const data = project.realData || {};
  return {
    // Profile presence, as the score sees it (Present -> a real contribution).
    website: presentBool('website', project, data),
    twitter: presentBool('twitter', project, data),
    telegram: presentBool('telegram', project, data),
    github: presentBool('github', project, data),
    // Tri-state: false means "we looked and the provider had no social data"
    // (scores 44, not 26). Preserved so an outage day is not read as "missing".
    socialMetadataAvailable: data.socialMetadataAvailable === true
      ? true
      : (data.socialMetadataAvailable === false ? false : null),
    founderStatus: typeof project.founderStatus === 'string' ? project.founderStatus : '',
    hasRoadmap: hasRoadmap(project),
    hasDescription: hasValue(project.description),
    communitySize: numOrNull(project.communitySize),
    // The raw notes string feeds riskPenalty by substring match; kept verbatim.
    riskNotes: typeof project.riskNotes === 'string' ? project.riskNotes : '',
    // Stable market inputs (the server has no CoinGecko fetch of its own).
    marketCapUsd: numOrNull(data.marketCapUsd),
    marketCapRank: numOrNull(data.marketCapRank),
    coingeckoListed: Boolean(data.coingeckoListed),
    supply: numOrNull(data.supply),
    holderGrowthPercent: numOrNull(data.holderGrowthPercent),
    isNativeAsset: Boolean(data.isNativeAsset),
    // The data-completeness stamp the client already computed. Stable because it
    // is dominated by profile completeness (the volatile half is always complete
    // — both providers are required, see _volatileSignals.mjs), so reusing it is
    // faithful rather than a guess.
    confidenceScore: numOrNull(project.confidenceScore),
  };
}

// Rebuilds the { project, data } pair calculateLiveScores expects from the
// persisted stable inputs plus the FRESH volatile signals the worker just
// observed. Presence booleans become placeholder URL values because the scorer
// keys only off PRESENT/MISSING/UNAVAILABLE, never the URL itself — so a boolean
// reproduces the identical sub-score.
export function reconstructForScoring(scoreInputs = {}, freshSignals = {}) {
  const si = scoreInputs || {};
  const fresh = freshSignals || {};
  const project = {
    communitySize: si.communitySize ?? undefined,
    founderStatus: si.founderStatus || '',
    description: si.hasDescription ? 'x' : '',
    roadmapText: si.hasRoadmap ? 'x' : '',
    riskNotes: si.riskNotes || '',
  };
  const data = {
    // Stable half (persisted from the client's last full scan).
    marketCapUsd: si.marketCapUsd ?? null,
    marketCapRank: si.marketCapRank ?? null,
    coingeckoListed: Boolean(si.coingeckoListed),
    supply: si.supply ?? null,
    holderGrowthPercent: si.holderGrowthPercent ?? null,
    isNativeAsset: Boolean(si.isNativeAsset),
    socialMetadataAvailable: si.socialMetadataAvailable,
    websiteUrl: si.website ? 'x' : '',
    twitterUrl: si.twitter ? 'x' : '',
    telegramUrl: si.telegram ? 'x' : '',
    githubUrl: si.github ? 'x' : '',
    // Volatile half (fresh from this observation) — overrides any stale value.
    totalLiquidityUsd: fresh.totalLiquidityUsd ?? null,
    liquidityUsd: fresh.totalLiquidityUsd ?? null,
    volume24hUsd: fresh.volume24hUsd ?? null,
    holderCount: fresh.holderCount ?? null,
    topHolderPercent: fresh.topHolderPercent ?? null,
    topTenHolderPercent: fresh.topTenHolderPercent ?? null,
    tokenAgeDays: fresh.tokenAgeDays ?? null,
    mintAuthorityEnabled: fresh.mintAuthorityEnabled ?? null,
    freezeAuthorityEnabled: fresh.freezeAuthorityEnabled ?? null,
    upgradeable: fresh.upgradeable ?? null,
  };
  return { project, data };
}

// Data-quality gate, matching assessSnapshot() in src/scoreHistory.js: a scan
// that observed NO market (neither market cap nor liquidity) is almost always a
// transient outage, and its degraded score must never be committed to history as
// a real decline. A monitored point that cannot pass this is skipped, not faked.
function observedMarket(data) {
  return Number(data.marketCapUsd || 0) > 0
    || Number(data.totalLiquidityUsd ?? data.liquidityUsd ?? 0) > 0;
}

// Builds the score-history point for one monitored observation, or explains why
// it declined to. Pure and total: every input is supplied, nothing is fetched.
//
//   scoreInputs  — the stable half, persisted on the corpus record (may be null)
//   freshSignals — the volatile half, from this cycle's snapshot
//   date         — the UTC day key (YYYY-MM-DD) to stamp
//
// Returns { recordable: true, snapshot } or { recordable: false, reason }.
export function buildMonitoredHistoryPoint({ scoreInputs, freshSignals, date } = {}) {
  if (!scoreInputs || typeof scoreInputs !== 'object') {
    // No persisted profile means we cannot reconstruct the FULL score, only the
    // volatile one — which must never be written to this series. Honest skip.
    return { recordable: false, reason: 'no_score_inputs' };
  }
  const { project, data } = reconstructForScoring(scoreInputs, freshSignals);
  if (!observedMarket(data)) {
    return { recordable: false, reason: 'no_market_observed' };
  }
  const scores = calculateLiveScores(project, data);
  const score = scores.finalTrustScore;
  if (typeof score !== 'number' || !Number.isFinite(score)) {
    return { recordable: false, reason: 'no_score' };
  }
  return {
    recordable: true,
    snapshot: {
      date,
      score: Math.round(score),
      riskLevel: scoreToRisk(score),
      // Reuse the client's completeness stamp (stable, see extractScoreInputs).
      // Null when unknown — which never suppresses a real change downstream.
      confidence: numOrNull(scoreInputs.confidenceScore),
      complete: true,
      topHolderPercent: numOrNull(data.topHolderPercent),
      liquidityUsd: numOrNull(data.totalLiquidityUsd ?? data.liquidityUsd),
      // Provenance, so a later reader can tell a monitored point from a viewed
      // one. Inert to the graph (which plots score/date) but honest.
      source: 'server_rescan',
    },
  };
}
