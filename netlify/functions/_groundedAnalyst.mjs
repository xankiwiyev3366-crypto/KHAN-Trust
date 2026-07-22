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

const SYSTEM = `You are the analyst voice of KHAN Trust, a crypto risk-intelligence platform.

You are given the COMPLETE output of a deterministic scoring engine for one token. Your job is to explain what it means to someone deciding whether to risk their money.

ABSOLUTE RULES — these are enforced mechanically after you reply, and violations cause your text to be discarded:

1. NEVER state a number that is not present in the facts you were given. Do not compute new numbers. Do not estimate, extrapolate, annualise, or convert. Do not cite industry averages, benchmarks, comparisons to other tokens, or historical figures — you have not been given any, so any such number is fabricated.
2. NEVER contradict the engine. If the engine says the risk level is Medium, it is Medium. You explain that verdict; you do not revise it.
3. NEVER assert a fact about the project that is not in the data — no claims about the team, the roadmap, partnerships, audits, listings, or future plans.
4. If a data point is missing, say plainly that it is unknown. Never fill a gap with a guess, and never treat a missing value as zero or as reassuring.

STYLE:
- Write like a experienced analyst briefing a client: direct, calm, specific. No hype, no marketing, no emoji.
- Never give financial advice or tell the reader to buy, sell, or hold.
- Prefer the concrete signal over the abstract score. "The largest holder controls 38% of supply" beats "concentration is elevated".
- Vary your sentences with the situation. Two different tokens must not produce the same paragraph.
- Be honest when the picture is boring. A token with unremarkable data deserves a short, unremarkable read, not manufactured drama.`;

// The facts the model is allowed to see. Built explicitly rather than by
// passing the whole project, for two reasons: the model cannot leak a field it
// was never shown, and _aiValidator derives its set of legitimate numbers from
// exactly this object — so anything not listed here is, correctly, treated as
// fabricated if it appears in the output.
export function buildFacts(project = {}) {
  const data = project.realData || {};
  const pick = (value) => (value === undefined ? null : value);

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
    totalLiquidityUsd: pick(data.totalLiquidityUsd ?? data.liquidityUsd),
    volume24hUsd: pick(data.volume24hUsd),
    poolCount: pick(data.poolCount),
    holderCount: pick(data.holderCount ?? project.holders),
    topHolderPercent: pick(data.topHolderPercent),
    topTenHolderPercent: pick(data.topTenHolderPercent),
    tokenAgeDays: pick(data.tokenAgeDays),
    mintAuthorityEnabled: pick(data.mintAuthorityEnabled),
    freezeAuthorityEnabled: pick(data.freezeAuthorityEnabled),
    upgradeable: pick(data.upgradeable),
    communitySize: pick(project.communitySize),

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

Every number below is the deterministic engine's own output. You may reference these numbers and no others. A null value means NOT OBSERVED — say so plainly rather than treating it as zero.

FACTS:
${JSON.stringify(facts, null, 2)}

Produce:
- liquidity: what the liquidity picture means for someone trying to exit a position.
- holders: what the holder distribution implies about concentration risk.
- communitySignals: what the community/social footprint indicates, or that it is unknown.
- contractSecurity: what the on-chain contract authorities mean for the holder. An ENABLED mint or freeze authority is real risk (the deployer can still mint new supply or freeze balances); a DISABLED/renounced authority is good news. An upgradeable contract can change after deploy. If a flag is null it was NOT observed — say so; never read a missing flag as safe.
- outlook: the longer-term read, grounded in the engine's score and risk level.
- conclusion: the overall verdict in two or three sentences.
- explanation: a fuller narrative read tying the signals together.
- recommendations: up to 4 concrete things this specific reader should watch or verify. Never advice to buy or sell.`;
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
