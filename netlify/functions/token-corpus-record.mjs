// POST /.netlify/functions/token-corpus-record
// Records/updates one token's latest snapshot into the shared Trust Graph
// Corpus (see _tokenCorpusStore.mjs). Public write - same posture as
// score-history-record.mjs, since the app computes scores client-side and
// there is no server-side recomputation to check against yet. Because it is
// public, every field is strictly validated, clamped, length-capped, and
// HTML-stripped here so a malicious caller cannot poison the corpus with
// arbitrary or oversized data. Provenance is stored as source:'client_scan'
// so a later hardening (authoritative server-side re-scoring - a deliberately
// deferred slice) can distinguish submitted snapshots from verified ones.
import { upsertCorpusToken, jsonResponse } from './_tokenCorpusStore.mjs';

const MAX_STR = 120;
const VALID_RISK_LEVELS = new Set(['Low', 'Medium', 'High']);
// Matches the two identity shapes historyKeyFor() produces in
// src/scoreHistory.js: "c:<contract>" or "id:<projectId>".
// `c:<contract>` (Solana, backward compatible) or `c:<chainId>:<contract>`
// (EVM/Move, chain-prefixed so the same address on two chains never collides).
const IDENTITY_PATTERN = /^(c:([a-z0-9]+:)?[a-z0-9]{6,90}|id:[a-z0-9-]{3,80})$/i;

function cleanStr(value, max = MAX_STR) {
  return String(value == null ? '' : value).replace(/<[^>]*>/g, '').trim().slice(0, max);
}

// A finite number within [min, max], or null. Rejects rather than coerces
// garbage so a public caller cannot poison a scored input with NaN/Infinity or
// an out-of-range value that would skew a rebuilt score.
function boundedNum(value, min, max) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

// Tri-state boolean: true / false / null (unknown). Preserves the "provider had
// no social data" state, which scores differently from "missing" (see
// src/lib/monitoredScore.js).
function triBool(value) {
  if (value === true) return true;
  if (value === false) return false;
  return null;
}

// The STABLE half of a token's scoring inputs, persisted so the re-scan worker
// can rebuild a full-methodology score-history point without a browser (see
// src/lib/monitoredScore.js). Public write, so every field is strictly bounded
// here — a caller can only ever store a value the scorer would accept anyway.
// Returns null when absent, so older clients simply omit it and the corpus row
// is unchanged.
function cleanScoreInputs(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    website: Boolean(raw.website),
    twitter: Boolean(raw.twitter),
    telegram: Boolean(raw.telegram),
    github: Boolean(raw.github),
    socialMetadataAvailable: triBool(raw.socialMetadataAvailable),
    founderStatus: cleanStr(raw.founderStatus, 60),
    hasRoadmap: Boolean(raw.hasRoadmap),
    hasDescription: Boolean(raw.hasDescription),
    communitySize: boundedNum(raw.communitySize, 0, 1e15),
    riskNotes: cleanStr(raw.riskNotes, 500),
    marketCapUsd: boundedNum(raw.marketCapUsd, 0, 1e15),
    marketCapRank: boundedNum(raw.marketCapRank, 0, 1e7),
    coingeckoListed: Boolean(raw.coingeckoListed),
    supply: boundedNum(raw.supply, 0, 1e21),
    holderGrowthPercent: boundedNum(raw.holderGrowthPercent, -100, 1e7),
    isNativeAsset: Boolean(raw.isNativeAsset),
    confidenceScore: boundedNum(raw.confidenceScore, 0, 100),
  };
}

export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { message: 'Method not allowed' });
    }

    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { message: 'Invalid request body' });
    }

    const identity = cleanStr(payload.identity, 100);
    if (!IDENTITY_PATTERN.test(identity)) {
      return jsonResponse(400, { message: 'invalid identity' });
    }

    const trustScore = Number(payload.trustScore);
    if (!Number.isFinite(trustScore) || trustScore < 0 || trustScore > 100) {
      return jsonResponse(400, { message: 'trustScore must be a number between 0 and 100' });
    }

    const riskLevel = VALID_RISK_LEVELS.has(payload.riskLevel) ? payload.riskLevel : 'Medium';

    const record = {
      identity,
      contract: cleanStr(payload.contract),
      chain: cleanStr(payload.chain, 40),
      name: cleanStr(payload.name),
      ticker: cleanStr(payload.ticker, 40),
      trustScore: Math.round(trustScore),
      riskLevel,
      category: cleanStr(payload.category, 60),
      confidenceLabel: cleanStr(payload.confidenceLabel, 20),
      source: 'client_scan',
      updatedAt: new Date().toISOString(),
    };

    // The stable scoring inputs, when the client sends them. Stored only when
    // present so an older client (or a caller that omits it) leaves the row's
    // other fields exactly as before — purely additive.
    const scoreInputs = cleanScoreInputs(payload.scoreInputs);
    if (scoreInputs) record.scoreInputs = scoreInputs;

    await upsertCorpusToken(identity, record);
    return jsonResponse(200, { ok: true });
  } catch (error) {
    return jsonResponse(500, { message: `token-corpus-record crashed: ${error.message}` });
  }
}
