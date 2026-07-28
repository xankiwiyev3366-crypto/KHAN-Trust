// SINGLE SOURCE OF TRUTH for "how old is this token?".
//
// WHY THIS EXISTS
//
// Age was previously resolved inline in three separate lookup lanes in
// main.jsx (Solana, EVM, CoinGecko-only), each with its own priority list and
// its own source string. All three shared one rule:
//
//     "A DEX pair's first-liquidity date is never used."
//
// That rule is methodologically pure and was operationally catastrophic.
// CoinGecko's `genesis_date` is null for essentially every SPL token, and the
// on-chain fallback walks the mint's signature history — which cannot complete
// for a token with millions of signatures. The observed result on production:
// BONK and WIF, two of the most mature tokens on Solana, both reported
// "Token age: Not available".
//
// Age is not a cosmetic field. `isTokenMature()` in scoringEngine.js reads it,
// so an unresolved age silently reclassified a 3-year-old, billion-dollar-volume
// asset as "new and unproven" and drove its Trust Score to the floor. A missing
// data point was being treated as evidence of risk.
//
// WHAT CHANGED — AND WHY IT IS STILL NOT AN ESTIMATE
//
// The oldest observed liquidity pool is now a fourth-priority source. Crucially
// it is recorded as a LOWER BOUND, not as the launch date:
//
//     A token cannot be younger than its oldest liquidity pool.
//
// That is a proven fact about the token, not an approximation of one. So this
// does not breach the "never estimate, say unavailable instead" principle the
// rest of the engine holds to — it reports a floor and labels it as a floor.
// Consumers that need certainty can check `confidence === AGE_CONFIDENCE.EXACT`;
// consumers that only need "is this thing demonstrably old" (the scoring
// ceiling) can safely use a lower bound, because a lower bound can only ever
// UNDERSTATE maturity. It can never make a new token look old.
//
// This file must stay PURE — no import.meta.env, no Node/Vite-only APIs — so it
// bundles into a Netlify Function (CJS, via ../../src/lib/tokenAge.js) and into
// the Vite client alike. Same cross-boundary contract as src/lib/pricing.js and
// src/lib/features.js; enforced by scripts/verify-functions.mjs.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// EXACT      — the source states when the asset itself came into existence.
// LOWER_BOUND — the source proves the asset already existed by this date, but
//               the asset may be older. Never treat as a launch date.
export const AGE_CONFIDENCE = {
  EXACT: 'exact',
  LOWER_BOUND: 'lower_bound',
};

// Source identifiers. `labelKey` resolves through the i18n dictionaries
// (`tokenAge.sources.*`) so the provenance line is translated like everything
// else; `label` is the untranslated fallback for non-React consumers (the PDF
// report, the server-side watch lane, the token-page SEO surface).
export const AGE_SOURCES = {
  coingeckoGenesis: {
    key: 'coingeckoGenesis',
    label: 'CoinGecko genesis date',
    labelKey: 'tokenAge.sources.coingeckoGenesis',
    confidence: AGE_CONFIDENCE.EXACT,
  },
  mintGenesis: {
    key: 'mintGenesis',
    label: 'Solana mint genesis transaction',
    labelKey: 'tokenAge.sources.mintGenesis',
    confidence: AGE_CONFIDENCE.EXACT,
  },
  explorerGenesis: {
    key: 'explorerGenesis',
    label: 'Block explorer contract creation',
    labelKey: 'tokenAge.sources.explorerGenesis',
    confidence: AGE_CONFIDENCE.EXACT,
  },
  dexPair: {
    key: 'dexPair',
    label: 'Earliest observed liquidity pool',
    labelKey: 'tokenAge.sources.dexPair',
    confidence: AGE_CONFIDENCE.LOWER_BOUND,
  },
};

// A timestamp is usable only if it is a finite number, in the past, and not
// absurdly old. The epoch-0 guard matters: several providers return 0 or null
// for "unknown", and `new Date(0)` would otherwise present as 1970 — i.e. the
// oldest, most trustworthy token in existence. Failing that check open is how a
// missing field becomes a maximum-maturity signal.
const EARLIEST_PLAUSIBLE_MS = Date.parse('2009-01-03T00:00:00Z'); // Bitcoin genesis

export function isUsableTimestamp(value, now = Date.now()) {
  const ms = Number(value);
  if (!Number.isFinite(ms)) return false;
  if (ms < EARLIEST_PLAUSIBLE_MS) return false;
  // Small tolerance for provider clock skew; anything meaningfully in the
  // future is a bad record, not a token that has not launched yet.
  if (ms > now + MS_PER_DAY) return false;
  return true;
}

// Coerce the assorted shapes providers hand us (ISO date string, epoch ms,
// Date) into epoch milliseconds, or null.
function toTimestamp(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

// THE resolution. Priority order, highest-trust first:
//
//   1. coingeckoGenesisDate  — authoritative for listed assets, no RPC needed
//   2. mintCreatedAt         — the Solana mint's own genesis transaction
//   3. explorerCreatedAt     — the EVM contract-deployment block
//   4. oldestPairCreatedAt   — earliest observed liquidity (LOWER BOUND)
//
// Every input is optional; callers pass whatever their lane actually fetched.
// Returns a stable shape with nulls when nothing resolved, so callers never
// need to null-check the result object itself.
export function resolveTokenAge(inputs = {}, now = Date.now()) {
  const candidates = [
    [AGE_SOURCES.coingeckoGenesis, toTimestamp(inputs.coingeckoGenesisDate)],
    [AGE_SOURCES.mintGenesis, toTimestamp(inputs.mintCreatedAt)],
    [AGE_SOURCES.explorerGenesis, toTimestamp(inputs.explorerCreatedAt)],
    [AGE_SOURCES.dexPair, toTimestamp(inputs.oldestPairCreatedAt)],
  ];

  for (const [source, timestamp] of candidates) {
    if (!isUsableTimestamp(timestamp, now)) continue;
    return {
      createdAt: timestamp,
      tokenAgeDays: Math.max(0, Math.floor((now - timestamp) / MS_PER_DAY)),
      source: source.key,
      sourceLabel: source.label,
      sourceLabelKey: source.labelKey,
      confidence: source.confidence,
      isLowerBound: source.confidence === AGE_CONFIDENCE.LOWER_BOUND,
    };
  }

  return {
    createdAt: null,
    tokenAgeDays: null,
    source: null,
    sourceLabel: null,
    sourceLabelKey: null,
    confidence: null,
    isLowerBound: false,
  };
}

// `launchDate` (YYYY-MM-DD) is written onto the project record and shown as
// "Launch date" in the profile. A LOWER BOUND is not a launch date and must not
// be presented as one — a token whose oldest pool opened months after it was
// minted would otherwise display a launch date that is simply wrong. So this
// returns '' for lower-bound resolutions: the age line still shows the proven
// floor, but the profile says the launch date is unknown, which is true.
export function exactLaunchDate(age) {
  if (!age || !age.createdAt) return '';
  if (age.confidence !== AGE_CONFIDENCE.EXACT) return '';
  return new Date(age.createdAt).toISOString().slice(0, 10);
}
