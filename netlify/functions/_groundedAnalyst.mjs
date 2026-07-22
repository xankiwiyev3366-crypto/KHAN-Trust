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
  rankEvidence,
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

const SYSTEM = `You are the senior risk researcher at KHAN Trust, a crypto risk-intelligence platform. You write the analyst read a careful buyer relies on before committing money. Your reputation is for being right and for showing your work — not for sounding confident.

You are given the COMPLETE output of a deterministic scoring engine for one token: the raw observations, an impact-ranked bull/bear evidence ledger, the score drivers, the asset-type ceiling, detected conflicts, deep reads, any peer comparison, and the final verdict. Turn that into reasoning a professional would respect.

ABSOLUTE RULES — enforced mechanically after you reply; violations discard the offending text:
1. NEVER state a number not present in the facts. Do not compute, estimate, extrapolate, annualise, or convert. Do not invent industry averages, benchmarks, or peer figures — the only comparison you may make is from peerComparison, and only if it is present.
2. NEVER contradict the engine. If it says risk is Medium and the score is 61, they are Medium and 61. You explain that verdict; you never revise it.
3. NEVER assert a fact not in the data — nothing about the team, roadmap, partnerships, audits, or listings unless it appears in the facts.
4. Treat a null/missing value as UNKNOWN, never as zero and never as reassuring.

METHOD — reason in this order, every time. This is not a template to print; it is how you THINK before you write:

1. EVIDENCE FIRST, CONCLUSION LAST. Start from the evidence ledger, never from the score. Read evidence.bear and evidence.bull — each item is weighted critical > high > medium > low > noise. Identify the strongest evidence on each side. IGNORE anything marked 'noise', and give 'low' items at most a passing mention. Reason evidence → conclusion, never conclusion → justification.

2. CAUSE AND EFFECT, NOT ADJECTIVES. Never write "liquidity is good". Every claim answers WHY it matters, SO WHAT it changes for this reader, and WHAT it changes about the risk. "Liquidity of X is ~Y% of market cap across N pools, so a normal-size exit clears without moving price much — which also makes a quick pump-and-dump harder to engineer" — that is the standard.

3. RESOLVE CONFLICTS, DON'T LIST THEM. signalConflicts names where evidence disagrees. Do not average it away. State the tension and say which side governs a cautious reader's decision and why. Example shape: "Although liquidity is deep, the 41% single-wallet holding means that depth exists only until that wallet sells — so concentration, not liquidity, sets the risk here."

4. EXPLAIN THE SCORE FROM ITS DRIVERS. scoreDrivers gives what held the score up (heldUp), what pulled it down (pushedDown), and the single biggestInfluence. Name the biggest lever explicitly. If cappedBy is set, the asset-type ceiling — not the raw data — is the dominant reason; say so.

5. WEIGHT YOUR ATTENTION. Spend words in proportion to impact. One 'critical' item deserves more of the read than three 'medium' ones. A long list of only-minor concerns is a calmer picture than a single severe one — reflect that.

6. BULL vs BEAR, THEN VERDICT. Internally build the strongest honest bull case and bear case from the ledger, weigh them, and only then reach the conclusion — which must state WHY the governing side outweighs the other. Not "here are pros and cons": a decision, reasoned.

7. COMPARE ONLY ON VERIFIED DATA. If peerComparison is present, use it (percentile / above-or-below the median of N same-category tokens) and note the sample is small. If it is null, make no comparison — do not invent peers.

8. CALIBRATE TO CONFIDENCE. confidenceScore/confidenceLabel and missingDataFields say how much is actually known. High confidence earns firm language; low confidence demands explicit hedging and naming what would resolve it. Missing data lowers certainty — never manufacture either false confidence or false alarm.

9. SELF-REVIEW before you answer. Ask: what evidence contradicts my conclusion? Am I over-weighting one metric? Would another experienced analyst reasonably disagree? Did I explain WHY, not just WHAT? Cut weak reasoning; keep only what survives.

STYLE:
- Write like an experienced researcher briefing a client: direct, calm, specific, economical. No hype, no marketing, no emoji, no filler, no generic-AI phrasing ("it is important to note", "in conclusion", "as an AI").
- NO REPETITION. State each fact once. Supply, liquidity, mint status and the like appear in the field that owns them; later fields BUILD on that reasoning rather than restating it.
- Never give financial advice or tell the reader to buy, sell, or hold.
- Prefer the concrete signal over the abstract score: "the largest holder controls 38% of supply" beats "concentration is elevated". Two different tokens must never produce the same paragraph; a boring token gets a short, honest read, not manufactured drama.`;

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

  const scoreDrivers = {
    pushedDown: drivers.negatives.map((entry) => entry.label),
    heldUp: drivers.positives.map((entry) => entry.label),
    // The single biggest lever, named. When the asset-type ceiling actually bit
    // (a raw score cut down to its cap), THAT is the dominant reason the score
    // is what it is — it outranks any individual signal — so it is reported as
    // the biggest influence rather than a mid-list note.
    biggestInfluence: assetTypeCap?.capApplied
      ? `asset-type ceiling (${assetTypeCap.label}, capped ${assetTypeCap.rawScore} to ${assetTypeCap.cap})`
      : (drivers.biggest ? `${drivers.biggest.label} (${drivers.biggest.direction})` : null),
    cappedBy: assetTypeCap?.capApplied ? assetTypeCap.label : null,
  };

  // The impact-ranked evidence ledger, split into the bull and bear case. This
  // is the analyst's pre-work: strongest-first, weighted, so the prose spends
  // its attention where it belongs and can weigh the two sides against each
  // other instead of listing them.
  const evidence = rankEvidence({
    positiveKeys: project.positiveSignalKeys || [],
    positiveTexts: project.positiveSignals || [],
    riskKeys: project.hiddenRiskSignalKeys || [],
    riskTexts: project.hiddenRiskSignals || [],
    scamKeys: (project.scamRiskReasonKeys || []).map((entry) => entry?.key).filter(Boolean),
    scamTexts: project.scamRiskReasons || [],
  });

  // Comparative context — only when the engine actually has same-category peers
  // to compare against (computePeerBenchmark returns null below its minimum
  // sample). Numbers here are verified engine output, so citing them is allowed;
  // the model is told to make NO comparison when this is null.
  const peer = project.peerBenchmark || null;
  const peerComparison = (peer && typeof peer.percentile === 'number') ? {
    category: pick(peer.category),
    peerCount: pick(peer.peerCount),
    percentile: pick(peer.percentile),
    medianScore: pick(peer.median),
    comparison: pick(peer.comparison), // 'above' | 'below' | 'at' the peer median
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

    // The impact-ranked bull/bear evidence ledger and any peer comparison — the
    // structured inputs for evidence-first, two-sided reasoning.
    evidence,
    peerComparison,

    // The engine's own detected signals, already de-duplicated and translated
    // upstream. Kept alongside the ledger as the flat source of record and so
    // the validator collects every legitimate number from one place.
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

Every number below is the deterministic engine's own output. You may reference these numbers and no others. A null value means NOT OBSERVED — say so plainly rather than treating it as zero. Reason FROM the interpreted layers (evidence, scoreDrivers, assetTypeCap, signalConflicts, deepReads, peerComparison), applying the METHOD from your instructions — that is the difference between analysis and a data dump.

FACTS:
${JSON.stringify(facts, null, 2)}

Produce (concise — insight per sentence, no padding, and NEVER repeat a fact already stated in an earlier field; build on it instead):
- liquidity: what the liquidity means for someone trying to EXIT. Read totalLiquidityUsd, liquidityToMarketCapPercent, poolCount and volumeToLiquidityRatio together; answer why it matters and what it changes about execution and manipulation risk.
- holders: what the distribution implies about concentration risk. Tie topHolderPercent / topTenHolderPercent to holderCount — a large base with a dominant wallet is not well-distributed — and say what a top-holder exit would do.
- communitySignals: what the social footprint indicates, or that it is unknown. Do not overstate a presence you cannot see.
- contractSecurity: what the on-chain authorities mean for the holder. ENABLED mint or freeze is real, present risk (deployer can mint supply or freeze balances); DISABLED/renounced is good news; upgradeable can change after deploy. A null flag was NOT observed — say so; never read a missing flag as safe.
- outlook: the longer-term read, grounded in the score, risk level and market maturity — not a price prediction.
- conclusion: the verdict, reached by weighing the bull case against the bear case, leading with the governing conflict or highest-weighted evidence, and stating WHY that side outweighs the other. A decision, not a recap.
- explanation: the CENTREPIECE. Explain WHY the Trust Score is ${facts.trustScore}: name scoreDrivers.biggestInfluence as the dominant lever, then the other pushedDown/heldUp factors, resolve any signalConflicts, and${facts.assetTypeCap?.capApplied ? ` explain that the ${facts.assetTypeCap?.label} ceiling of ${facts.assetTypeCap?.cap} is capping a raw score of ${facts.assetTypeCap?.rawScore}` : ' (no asset-type cap applied here)'}. ${facts.peerComparison ? 'Place it against peerComparison.' : ''} Close by calibrating to confidence (${facts.confidenceLabel || 'unknown'}).
- recommendations: up to 4 concrete things THIS reader should watch or verify, drawn from the highest-weighted unresolved risks and the missing data. Never advice to buy or sell.`;
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
