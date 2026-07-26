// GET /.netlify/functions/trust-movers
//
// The Trust Movers intelligence API: projects whose Trust Score moved the most
// over a selected window, split into Rising / Falling / New High Confidence /
// Newly High Risk, each with a grounded "why it moved" explanation.
//
// PUBLIC READ. This is aggregate, non-sensitive trust data (the same posture as
// token-corpus-list) and is deliberately a clean, stable JSON contract so a
// future mobile app or public API surface can consume it unchanged. All heavy
// lifting, caching and the honest insufficient-data handling live in
// _trustMoversStore.mjs; this file is only request parsing + validation.
//
// Query parameters (all optional):
//   period   24H | 7D | 30D | 90D          (default 7D)
//   chain    all | solana | ethereum | base | bsc | arbitrum | optimism |
//            polygon | avalanche | sui | aptos   (default all)
//   audience all | verified | premium      (default all; verified/premium are
//            fail-closed against the verification store)
//   section  rising | falling | newHighConfidence | newlyHighRisk
//            (optional — return only that one section)
//   limit    1..50 per section              (default 20)
import { getTrustMovers, SUPPORTED_CHAINS } from './_trustMoversStore.mjs';
import { jsonResponse } from './_blobsClient.mjs';
import { isValidPeriod, DEFAULT_PERIOD, SECTIONS } from '../../src/lib/trustMovers.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const AUDIENCES = new Set(['all', 'verified', 'premium']);

export async function handler(event) {
  try {
    if (event.httpMethod !== 'GET') {
      return jsonResponse(405, { message: 'Method not allowed' });
    }

    const q = event.queryStringParameters || {};

    const period = isValidPeriod(q.period) ? q.period : DEFAULT_PERIOD;

    const chainParam = (q.chain || 'all').toLowerCase();
    const chain = chainParam === 'all' || SUPPORTED_CHAINS.includes(chainParam) ? chainParam : 'all';

    const audienceParam = (q.audience || 'all').toLowerCase();
    const audience = AUDIENCES.has(audienceParam) ? audienceParam : 'all';

    const requested = Number(q.limit);
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number.isFinite(requested) ? Math.round(requested) : DEFAULT_LIMIT));

    const section = SECTIONS.includes(q.section) ? q.section : null;

    const result = await getTrustMovers({ period, chain, audience, limit });

    // When a single section is requested, return just that one (still under the
    // `sections` key so the contract shape is uniform for every caller).
    if (section) {
      return jsonResponse(200, {
        ...result,
        sections: { [section]: result.sections[section] || [] },
      });
    }

    return jsonResponse(200, result);
  } catch (error) {
    return jsonResponse(500, { message: `trust-movers crashed: ${error.message}` });
  }
}
