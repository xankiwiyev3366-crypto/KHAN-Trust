// The Grounded AI Analyst — the only user-facing LLM in KHAN Trust.
//
// WHAT CHANGED, AND WHAT DID NOT
//
// The Premium research cards used to compose their prose from string templates
// (src/premiumResearch.js). Every number in them was real, but the SENTENCES
// were fixed, so a reader comparing three tokens saw the same paragraph with
// different numbers substituted in. This module replaces that prose layer, and
// only that layer.
//
// THE DETERMINISTIC ENGINE REMAINS THE SOLE SOURCE OF EVERY NUMBER.
//
// The model is never asked what a token scores, whether it is risky, or what
// its liquidity is. All of that is computed before this module is reached and
// handed to it as fixed facts. The model's entire job is to say, in the
// reader's language, what those facts MEAN — to explain, prioritise, connect
// and contextualise. It writes sentences about arithmetic somebody else did.
//
// THREE MECHANICAL GUARANTEES, NOT THREE PROMISES
//
// A prompt saying "only use the numbers provided" is an instruction, and
// instructions are followed probabilistically. On a platform named Trust, the
// guarantee cannot rest on the model choosing to comply:
//
//   1. STRUCTURED OUTPUT ONLY. askForJson refuses to run without a schema, so
//      there is no free-text path and no regex parsing of prose.
//   2. EVERY NUMBER IS VERIFIED. Each generated field is checked against the
//      facts the model was given (_aiValidator). A field citing a number that
//      cannot be traced to the engine's own output is DISCARDED, and the
//      deterministic template for that field is used instead. The model is not
//      trusted with arithmetic and never has been.
//   3. THE SCORES ARE NOT IN THE MODEL'S GIFT. The rendered Trust Score, risk
//      level, confidence and signal lists come from the engine payload, not
//      from this response. Even a fully hallucinated reply cannot change a
//      single number the user sees — at worst it produces prose that gets
//      rejected and falls back.
//
// FAILING IS NORMAL AND MUST BE SILENT
//
// No API key, budget exhausted, a refusal, a timeout: all of these are expected
// operating states, not incidents. Every one of them falls back to the existing
// deterministic prose, which is complete and accurate on its own. A Premium
// user must never see a broken card because an LLM was unavailable.
import { askForJson, isAiConfigured } from './_aiClient.mjs';
import { rejectFabricatedFindings } from './_aiValidator.mjs';
import { computeScoreDrivers } from '../../src/lib/trustScore.js';
import {
  scoreLiquidityQuality,
  scoreVolumeLiquidityConsistency,
  scoreVolatility,
  scoreMarketMaturity,
  detectSignalConflicts,
  severityForSignalKey,
} from '../../src/scoringEngine.js';

// Haiku, per the operator's cheap-by-default standing instruction. This task is
// explanation over pre-computed facts — judgement and wording, not open-ended
// reasoning — which is what Haiku is good at, at a fraction of the price.
const MODEL = 'claude-haiku-4-5';

// The languages the platform ships. The model writes directly in the reader's
// language rather than writing English and translating, which reads better and
// costs one call instead of two.
export const SUPPORTED_LANGUAGES = new Set(['en', 'az', 'tr', 'ru']);

const LANGUAGE_NAMES = {
  en: 'English',
  az: 'Azerbaijani',
  tr: 'Turkish',
  ru: 'Russian',
};

// The fields the model writes. Each maps 1:1 onto a field the templates already
// produce, so a rejected or missing field falls back cleanly and independently —
// one bad sentence never costs the whole card.
export const ANALYST_FIELDS = [
  'liquidity',
  'holders',
  'communitySignals',
  'contractSecurity',
  'outlook',
  'conclusion',
  'explanation',
];

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [...ANALYST_FIELDS, 'recommendations'],
  properties: {
    liquidity: { type: 'string', maxLength: 400 },
    holders: { type: 'string', maxLength: 400 },
    communitySignals: { type: 'string', maxLength: 400 },
    contractSecurity: { type: 'string', maxLength: 400 },
    outlook: { type: 'string', maxLength: 600 },
    conclusion: { type: 'string', maxLength: 600 },
    explanation: { type: 'string', maxLength: 900 },
    recommendations: {
      type: 'array',
      maxItems: 4,
      items: { type: 'string', maxLength: 300 },
    },
  },
};

const SYSTEM = `You are the senior risk researcher at KHAN Trust, a crypto risk-intelligence platform. You write the analyst read that a careful buyer relies on before committing money. Your reputation is for being right and for showing your work — not for sounding confident.

You are given the COMPLETE output of a deterministic scoring engine for one token: the raw observations, the engine's interpreted layers (deep scores, score drivers, the asset-type ceiling, severity-ranked risks, detected conflicts), and its final verdict. Your job is to turn that evidence into reasoning a professional would respect.

ABSOLUTE RULES — enforced mechanically after you reply; violations cause the offending text to be discarded:

1. NEVER state a number that is not present in the facts you were given. Do not compute, estimate, extrapolate, annualise, or convert. Do not cite industry averages, benchmarks, other tokens, or historical figures — you were given none, so any such number is fabricated.
2. NEVER contradict the engine. If it says the risk level is Medium and the score is 61, they are Medium and 61. You explain that verdict; you never revise it.
3. NEVER assert a fact not in the data — nothing about the team, roadmap, partnerships, audits, exchange listings, or future plans unless it appears in the facts.
4. Treat a null/missing value as UNKNOWN, never as zero and never as reassuring. Say plainly when something could not be observed.

HOW TO REASON (this is what separates you from a generic summary):

- EXPLAIN THE SCORE, DON'T DESCRIBE IT. The facts include scoreDrivers.negatives and scoreDrivers.positives — the signals that actually pushed the score down and up, ranked by their weighted impact. Name them. If assetTypeCap.capApplied is true, the ceiling — not the raw data — is often the real reason the score is where it is; say so (e.g. a memecoin whose data earned rawScore but is capped at cap because its category cannot credibly exceed that).
- WEIGHT BY SEVERITY. rankedRiskSignals is ordered most-serious first with a severity tag. Lead with 'high' items; do not give a cosmetic 'medium' concern the same weight as an acute one. A long risk list where everything is minor is a calmer picture than a short list with one severe item — reflect that.
- RESOLVE CONFLICTS EXPLICITLY. signalConflicts lists places where the evidence points in opposite directions (e.g. deep liquidity but a dominant holder; multi-year age but live mint authority). Do not average them away. State the tension and say which side should govern a cautious reader's decision, and why.
- CROSS-REFERENCE. Read the deep scores and ratios together with the raw figures — volumeToLiquidityRatio against liquidity, liquidityToMarketCapPercent against market cap, holder count against concentration. Corroborated signals are stronger than isolated ones; note when sources agree or disagree.
- CALIBRATE CONFIDENCE TO THE DATA. confidenceScore/confidenceLabel and missingDataFields tell you how much is actually known. When confidence is Low or key fields are missing, hedge in proportion and name what would resolve the uncertainty. Prefer honest uncertainty over false precision. Never manufacture certainty the data does not support — and never manufacture alarm the data does not support either.

STYLE:
- Write like an experienced researcher briefing a client: direct, calm, specific, economical. No hype, no marketing, no emoji, no filler.
- Never give financial advice or tell the reader to buy, sell, or hold.
- Prefer the concrete signal over the abstract score: "the largest holder controls 38% of supply" beats "concentration is elevated".
- Vary with the situation — two different tokens must never produce the same paragraph. A boring token gets a short, boring, honest read, not manufactured drama.`;

// The facts the model is allowed to see. Built explicitly rather than by
// passing the whole project, for two reasons: the model cannot leak a field it
// was never shown, and _aiValidator derives its set of legitimate numbers from
// exactly this object — so anything not listed here is, correctly, treated as
// fabricated if it appears in the output.
// Rounds a proportion to a stated number of places, or returns null so the
// model is told "not observed" rather than shown a fabricated 0.
function ratio(numerator, denominator, places = 2) {
  const n = Number(numerator);
  const d = Number(denominator);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0 || n < 0) return null;
  const factor = 10 ** places;
  return Math.round((n / d) * factor) / factor;
}

// Qualitative reads of the engine's 0-100 deep scores. Deliberately NOT the raw
// numbers: an internal sub-score like "88" is meaningless to a reader and, if
// exposed, both invites the model to cite a number that means nothing AND widens
// the fabrication validator's accepted-number set. A word carries the meaning
// without either cost. null stays "unknown" — never silently reassuring.
function band(score, tiers) {
  if (score === null || score === undefined) return 'unknown';
  for (const [floor, label] of tiers) if (score >= floor) return label;
  return tiers[tiers.length - 1][1];
}

function deepReads(scores) {
  return {
    liquidityQuality: band(scores.liquidityQualityScore, [[78, 'deep'], [60, 'adequate'], [40, 'shallow'], [0, 'very thin']]),
    volumeVsLiquidity: band(scores.volumeConsistencyScore, [[88, 'organic'], [55, 'plausible'], [30, 'out of line with liquidity (possible wash trading)'], [0, 'severely wash-shaped']]),
    priceStability: band(scores.volatilityScore, [[74, 'stable'], [52, 'moderately volatile'], [28, 'volatile'], [0, 'extremely volatile']]),
    marketMaturity: band(scores.marketMaturityScore, [[80, 'seasoned across multiple cycles'], [62, 'established'], [40, 'young'], [0, 'brand-new / unproven']]),
  };
}

// Pairs each detected risk signal with its severity and orders them so the most
// serious sits first — the analyst is explicitly told to lead with these. Text
// and key arrays are parallel (same detection order upstream), so index zips
// them; anything without a key defaults to 'medium' via severityForSignalKey.
function rankRiskSignals(project = {}) {
  const texts = project.hiddenRiskSignals || [];
  const keys = project.hiddenRiskSignalKeys || [];
  const order = { high: 0, medium: 1, low: 2 };
  return texts
    .map((text, index) => ({ text, severity: severityForSignalKey(keys[index]) }))
    .sort((a, b) => order[a.severity] - order[b.severity]);
}

export function buildFacts(project = {}) {
  const data = project.realData || {};
  const pick = (value) => (value === undefined ? null : value);
  const liquidity = data.totalLiquidityUsd ?? data.liquidityUsd;

  // Recompute the deep scores server-side from the raw observations rather than
  // trusting whatever the client posted — the same pure engine functions the
  // browser used, so the evidence the analyst reasons over is authoritative and
  // consistent with the numbers already on the reader's screen.
  const deepScores = {
    liquidityQualityScore: scoreLiquidityQuality(liquidity, data.marketCapUsd, data.poolCount),
    volumeConsistencyScore: scoreVolumeLiquidityConsistency(data.volume24hUsd, liquidity),
    volatilityScore: scoreVolatility(data.priceChange1h, data.priceChange24h, data.priceChange7d),
    marketMaturityScore: scoreMarketMaturity(data.tokenAgeDays, data.priceChange30d, data.ath, data.priceUsd),
  };

  // Why the score landed where it did, from the engine's own weighted table.
  // Exposed as LABELS only (not the raw weighted contributions, which are
  // internal): "largest-holder concentration" pushed it down, and the model
  // ties that to the real percentage which lives elsewhere in the facts.
  const drivers = computeScoreDrivers(project.scoreBreakdown || {});
  const scoreDrivers = {
    pushedDown: drivers.negatives.map((entry) => entry.label),
    heldUp: drivers.positives.map((entry) => entry.label),
  };

  // The asset-type ceiling: often the single biggest reason a score is what it
  // is (a memecoin capped at 35, a blue-chip allowed 95). Passed so the analyst
  // can explain a cap instead of leaving it unexplained.
  const modifier = project.assetTypeRiskModifier || null;
  const assetTypeCap = modifier ? {
    label: pick(modifier.label),
    cap: pick(modifier.cap),
    rawScore: pick(modifier.rawScore),
    adjustedScore: pick(modifier.adjustedScore),
    capApplied: Boolean(modifier.capApplied),
    isSpeculative: Boolean(modifier.isSpeculative),
  } : null;

  return {
    name: pick(project.name),
    ticker: pick(project.ticker),
    chain: pick(project.chain),
    assetCategory: pick(project.assetCategory),

    // The engine's verdict. The model explains these; it never revises them.
    trustScore: pick(project.trustScore),
    riskLevel: pick(project.riskLevel),
    confidenceScore: pick(project.confidenceScore),
    confidenceLabel: pick(project.confidenceLabel),

    // Raw observed signals.
    marketCapUsd: pick(data.marketCapUsd),
    totalLiquidityUsd: pick(liquidity),
    volume24hUsd: pick(data.volume24hUsd),
    poolCount: pick(data.poolCount),
    holderCount: pick(data.holderCount ?? project.holders),
    topHolderPercent: pick(data.topHolderPercent),
    topTenHolderPercent: pick(data.topTenHolderPercent),
    tokenAgeDays: pick(data.tokenAgeDays),
    mintAuthorityEnabled: pick(data.mintAuthorityEnabled),
    freezeAuthorityEnabled: pick(data.freezeAuthorityEnabled),
    upgradeable: pick(data.upgradeable),
    coingeckoListed: pick(data.coingeckoListed),
    holderGrowthPercent: pick(data.holderGrowthPercent),
    communitySize: pick(project.communitySize),

    // Derived ratios — the raw evidence behind the qualitative signals. Exposed
    // so the analyst can cite the actual figure ("volume is 23x liquidity")
    // instead of a vague adjective, and so the validator accepts that figure.
    volumeToLiquidityRatio: ratio(data.volume24hUsd, liquidity, 1),
    liquidityToMarketCapPercent: (() => {
      const r = ratio(liquidity, data.marketCapUsd, 4);
      return r === null ? null : Math.round(r * 1000) / 10; // percent, 1 dp
    })(),

    // The engine's interpreted layers — this is what turns "numbers" into
    // "reasoning". Qualitative deep reads, the score drivers, the asset-type
    // ceiling, the severity-ranked risks, and the detected conflicts are all
    // engine output; the model interprets them, it does not compute them.
    deepReads: deepReads(deepScores),
    scoreDrivers,
    assetTypeCap,
    rankedRiskSignals: rankRiskSignals(project),
    signalConflicts: detectSignalConflicts(project, data, deepScores).map((conflict) => conflict.text),

    // The engine's own detected signals, already de-duplicated and translated
    // upstream. These are the substance the analyst reasons over.
    positiveSignals: project.positiveSignals || [],
    riskSignals: project.hiddenRiskSignals || [],
    scamRiskReasons: project.scamRiskReasons || [],
    missingDataFields: project.missingDataFields || [],
    scoreBreakdown: project.scoreBreakdown || {},
  };
}

function buildPrompt(facts, language) {
  const languageName = LANGUAGE_NAMES[language] || LANGUAGE_NAMES.en;
  return `Write the analyst read for this token, in ${languageName}.

Every number below is the deterministic engine's own output. You may reference these numbers and no others. A null value means NOT OBSERVED — say so plainly rather than treating it as zero. Where the facts include interpreted layers (scoreDrivers, assetTypeCap, rankedRiskSignals, signalConflicts, deepReads), reason FROM them — that is the difference between analysis and a data dump.

FACTS:
${JSON.stringify(facts, null, 2)}

Produce (be concise — every field earns its length with insight, not padding):
- liquidity: what the liquidity picture means for someone trying to EXIT a position. Read totalLiquidityUsd, liquidityToMarketCapPercent, poolCount and volumeToLiquidityRatio together; call out thin or wash-shaped liquidity concretely.
- holders: what the holder distribution implies about concentration risk. Tie topHolderPercent / topTenHolderPercent to holderCount — a large base with a dominant wallet is not well-distributed.
- communitySignals: what the community/social footprint indicates, or that it is unknown. Do not overstate a social presence you cannot see.
- contractSecurity: what the on-chain authorities mean for the holder. An ENABLED mint or freeze authority is real, present risk (the deployer can still mint supply or freeze balances); a DISABLED/renounced authority is good news; an upgradeable contract can change after deploy. If a flag is null it was NOT observed — say so; never read a missing flag as safe.
- outlook: the longer-term read, grounded in the score, risk level, and marketMaturityScore — not a price prediction.
- conclusion: the verdict in two or three sentences, leading with the highest-severity signal or the governing conflict.
- explanation: the CENTREPIECE. Explain WHY the Trust Score is ${facts.trustScore}: name the specific signals in scoreDrivers.pushedDown that dragged it down and scoreDrivers.heldUp that held it up, resolve any signalConflicts, and — if assetTypeCap.capApplied is true — explain that the ${facts.assetTypeCap?.label || 'asset type'} ceiling of ${facts.assetTypeCap?.cap ?? 'the cap'} is capping a raw score of ${facts.assetTypeCap?.rawScore ?? 'the raw value'}. Close by calibrating to confidence (${facts.confidenceLabel || 'unknown'}).
- recommendations: up to 4 concrete things THIS reader should watch or verify, drawn from the actual risks and missing data. Never advice to buy or sell.`;
}

// Generates the analyst prose. Returns { ok: true, fields, rejected, spend } or
// { ok: false, reason } — and a false is ALWAYS a normal outcome the caller
// handles by using the deterministic templates.
export async function generateAnalysis({ project, language = 'en' }) {
  if (!isAiConfigured()) return { ok: false, reason: 'ai_not_configured' };
  const lang = SUPPORTED_LANGUAGES.has(language) ? language : 'en';

  const facts = buildFacts(project);

  let result;
  try {
    result = await askForJson({
      system: SYSTEM,
      prompt: buildPrompt(facts, lang),
      schema: SCHEMA,
      purpose: 'premium_token_analysis',
      model: MODEL,
    });
  } catch (error) {
    // Budget exhaustion, refusal, truncation and transport failures all land
    // here and are all the same thing to the caller: no AI this time.
    return { ok: false, reason: error?.code || 'ai_failed', message: error?.message };
  }

  const data = result.data || {};

  // Numeric grounding. Each text field is validated INDEPENDENTLY so one
  // sentence citing a fabricated figure costs only that sentence — the rest of
  // the analysis, which is fine, still reaches the reader.
  //
  // rejectFabricatedFindings takes a list of findings; each field is wrapped as
  // a one-field finding so the existing validator is reused exactly rather than
  // re-implemented with subtly different rounding rules.
  const candidates = ANALYST_FIELDS
    .filter((field) => typeof data[field] === 'string' && data[field].trim())
    .map((field) => ({ field, text: data[field].trim() }));

  const { kept, rejected } = rejectFabricatedFindings(candidates, facts, ['text']);

  const fields = {};
  for (const entry of kept) fields[entry.field] = entry.text;

  // Recommendations are validated as a group and kept individually.
  const recCandidates = Array.isArray(data.recommendations)
    ? data.recommendations
        .filter((rec) => typeof rec === 'string' && rec.trim())
        .map((rec, index) => ({ field: `rec${index}`, text: rec.trim() }))
    : [];
  const recResult = rejectFabricatedFindings(recCandidates, facts, ['text']);
  if (recResult.kept.length) {
    fields.recommendations = recResult.kept.map((entry) => entry.text);
  }

  return {
    ok: true,
    fields,
    // Surfaced, never swallowed: a model that starts fabricating is a signal
    // worth seeing, and hiding it would hide a regression in the prompt.
    rejected: [...rejected, ...recResult.rejected].map((entry) => ({
      field: entry.finding.field,
      numbers: entry.unverifiedNumbers,
    })),
    spend: result.spend,
    model: result.model,
  };
}
