// The only place in KHAN Trust that talks to an LLM.
//
// Everything else in this platform is deterministic by design - the token
// scoring engine and "Ask KHAN" compose their answers from computed data and
// structurally cannot hallucinate about a token (see src/khanAnalyst.js). That
// property is a product asset and is NOT weakened here: this client is
// admin-only, reads only pre-computed warehouse metrics, and nothing it
// produces is ever shown to a user.
//
// Three hard rules, enforced in code below:
//   1. No call happens without a budget check first (_aiBudget.mjs).
//   2. Every call returns STRUCTURED JSON against a schema - never free prose
//      that a caller would have to parse with a regex.
//   3. Every response is validated for fabricated numbers before it is
//      returned (_aiValidator.mjs). The model is not trusted with arithmetic.
import Anthropic from '@anthropic-ai/sdk';
import { assertWithinBudget, recordSpend } from './_aiBudget.mjs';

// Haiku 4.5 by default: the operator approved AI on a strict budget, and every
// task here is extraction and prioritisation over metrics that have ALREADY
// been computed deterministically by the warehouse. The hard thinking is done
// in _growthWarehouse.mjs; the model's job is judgement and wording, which
// Haiku does well at 1/5th the price of Opus.
export const DEFAULT_MODEL = 'claude-haiku-4-5';

// Haiku 4.5 predates the effort parameter and adaptive thinking. Passing
// `output_config.effort` or `thinking: {type: 'adaptive'}` to it is a 400 - it
// takes `thinking: {type: 'enabled', budget_tokens: N}` instead. We send
// neither: these are short structured-extraction calls where thinking would add
// latency and cost for no gain. If DEFAULT_MODEL is ever raised to Opus 4.8,
// revisit this: that model takes `thinking: {type: 'adaptive'}` and REJECTS
// budget_tokens, so the two are not interchangeable.
const MAX_OUTPUT_TOKENS = 4096;

let client = null;

export function isAiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function getClient() {
  if (!isAiConfigured()) {
    const error = new Error(
      'ANTHROPIC_API_KEY is not set. The Growth OS runs fully without it — every ' +
      'warehouse metric is deterministic and needs no AI. Only the analyst layer is unavailable.'
    );
    error.code = 'AI_NOT_CONFIGURED';
    throw error;
  }
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

// Rough token estimate for the pre-flight budget check only.
//
// Deliberately NOT count_tokens: that is a network round trip on every call to
// price a call we may refuse anyway. ~3.5 chars/token is a conservative
// (over-)estimate for English JSON, and over-estimating is the safe direction
// for a budget guard — it refuses slightly early rather than slightly late.
// The true cost is reconciled from the API's own usage numbers afterwards.
function estimateTokens(text) {
  return Math.ceil(text.length / 3.5);
}

// Single entry point. `schema` is required — there is no free-text mode, so no
// caller can accidentally introduce prose parsing.
export async function askForJson({ system, prompt, schema, purpose, model = DEFAULT_MODEL }) {
  if (!schema) throw new Error('askForJson requires a JSON schema — free-text LLM output is not permitted here.');
  if (!purpose) throw new Error('askForJson requires a purpose — every spend must be attributable in the ledger.');

  const anthropic = getClient();

  await assertWithinBudget({
    model,
    estimatedInputTokens: estimateTokens(system + prompt),
    estimatedOutputTokens: MAX_OUTPUT_TOKENS,
  });

  const response = await anthropic.messages.create({
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system,
    messages: [{ role: 'user', content: prompt }],
    // Structured outputs: the model is constrained to this schema, so the
    // response is guaranteed parseable. This replaces the older "please reply
    // with JSON only" prompt-and-pray pattern, which fails intermittently and
    // always at the worst time.
    output_config: {
      format: { type: 'json_schema', schema },
    },
  });

  const spend = await recordSpend({ model, usage: response.usage, purpose });

  // A safety refusal or a token cutoff both mean the payload is not
  // trustworthy. Surfaced explicitly rather than returned as partial data.
  if (response.stop_reason === 'refusal') {
    const error = new Error('The model declined this request.');
    error.code = 'AI_REFUSAL';
    throw error;
  }
  if (response.stop_reason === 'max_tokens') {
    const error = new Error('The model response was cut off before it completed. Nothing usable was returned.');
    error.code = 'AI_TRUNCATED';
    throw error;
  }

  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock) throw new Error('The model returned no text content.');

  let parsed;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch (error) {
    throw new Error(`The model returned unparseable JSON despite the schema: ${error.message}`);
  }

  return { data: parsed, spend, model };
}
