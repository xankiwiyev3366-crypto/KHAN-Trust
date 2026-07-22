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

    await upsertCorpusToken(identity, record);
    return jsonResponse(200, { ok: true });
  } catch (error) {
    return jsonResponse(500, { message: `token-corpus-record crashed: ${error.message}` });
  }
}
