// Hard spend ceiling for the AI layer.
//
// The operator approved AI on the explicit condition of a strict budget cap, so
// the cap is enforced in code rather than by intention. An LLM loop with a bug
// (a retry storm, a scheduler firing hourly instead of weekly, a prompt that
// grows without bound) can spend real money quickly and silently; this module
// is the thing that makes that impossible rather than unlikely.
//
// Design decisions:
//   - FAIL CLOSED. Every other store in this platform fails open, because
//     losing an analytics row is better than breaking a user's action. Money is
//     the opposite: if the ledger cannot be read, no spend is authorised. An
//     unavailable ledger must never be an unlimited budget.
//   - PRE-FLIGHT + RECONCILE. Cost is estimated and checked BEFORE the call,
//     then the true cost from the API's own usage numbers is recorded after.
//     Checking only afterwards would let a single huge call blow the cap.
//   - The ledger is the source of truth for what was actually spent, and it is
//     surfaced in the console: an operator must be able to see the bill.
import { getNamedStore } from './_blobsClient.mjs';

const STORE_NAME = 'khan-trust-ai-budget';

// USD per 1M tokens. Must match the model actually used in _aiClient.mjs.
// Haiku 4.5 is the default because the operator asked for cheap-by-default, and
// because every task in this system is extraction and summarisation over
// pre-computed metrics - not open-ended reasoning that would justify Opus.
export const PRICING = {
  'claude-haiku-4-5': { input: 1.00, output: 5.00 },
  'claude-opus-4-8': { input: 5.00, output: 25.00 },
};

const DEFAULT_MONTHLY_BUDGET_USD = 10;

export function monthlyBudgetUsd() {
  const configured = Number(process.env.KHAN_AI_MONTHLY_BUDGET_USD);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MONTHLY_BUDGET_USD;
}

function store() {
  return getNamedStore(STORE_NAME);
}

function monthKey(now = new Date()) {
  return `spend/${now.toISOString().slice(0, 7)}.json`;
}

export function costOf({ model, inputTokens, outputTokens }) {
  const price = PRICING[model];
  if (!price) throw new Error(`No pricing configured for model "${model}" - refusing to spend blind.`);
  return (inputTokens / 1e6) * price.input + (outputTokens / 1e6) * price.output;
}

export async function readLedger(now = new Date()) {
  const data = await store().get(monthKey(now), { type: 'json' });
  return data && typeof data === 'object'
    ? data
    : { month: now.toISOString().slice(0, 7), spentUsd: 0, calls: 0, byPurpose: {} };
}

// Throws when the call must not proceed. The caller does not get to decide -
// there is no "force" flag, deliberately.
export async function assertWithinBudget({ model, estimatedInputTokens, estimatedOutputTokens }) {
  let ledger;
  try {
    ledger = await readLedger();
  } catch (error) {
    // Fail closed. See the header - an unreadable ledger is not a free pass.
    throw new Error(`AI budget ledger unavailable, refusing to spend: ${error.message}`);
  }

  const budget = monthlyBudgetUsd();
  const estimate = costOf({
    model,
    inputTokens: estimatedInputTokens,
    outputTokens: estimatedOutputTokens,
  });

  if (ledger.spentUsd + estimate > budget) {
    const error = new Error(
      `Monthly AI budget reached: $${ledger.spentUsd.toFixed(4)} spent of $${budget.toFixed(2)}; ` +
      `this call would add about $${estimate.toFixed(4)}. No AI call was made. ` +
      `Raise KHAN_AI_MONTHLY_BUDGET_USD to continue this month.`
    );
    error.code = 'BUDGET_EXCEEDED';
    throw error;
  }

  return { ledger, budget, estimate };
}

// Records TRUE cost from the API's own usage numbers, not the estimate.
//
// Read-modify-write on a single key: acceptable here and nowhere else in this
// codebase, because AI calls are scheduled weekly and admin-triggered, so
// concurrency is effectively zero. The event log made the opposite choice for
// exactly the opposite reason (see _growthEvents.mjs).
export async function recordSpend({ model, usage, purpose }) {
  const inputTokens = (usage?.input_tokens || 0)
    + (usage?.cache_creation_input_tokens || 0)
    + (usage?.cache_read_input_tokens || 0);
  const outputTokens = usage?.output_tokens || 0;
  const cost = costOf({ model, inputTokens, outputTokens });

  try {
    const ledger = await readLedger();
    ledger.spentUsd = Math.round((ledger.spentUsd + cost) * 1e6) / 1e6;
    ledger.calls += 1;
    ledger.byPurpose[purpose] = Math.round(((ledger.byPurpose[purpose] || 0) + cost) * 1e6) / 1e6;
    ledger.lastCallAt = new Date().toISOString();
    await store().setJSON(monthKey(), ledger);
  } catch {
    // The spend already happened; failing the caller now would waste it. The
    // under-recording is the lesser harm and is bounded by the pre-flight check
    // on the next call.
  }

  return { cost, inputTokens, outputTokens };
}

export async function budgetStatus() {
  const ledger = await readLedger();
  const budget = monthlyBudgetUsd();
  return {
    month: ledger.month,
    spentUsd: ledger.spentUsd,
    budgetUsd: budget,
    remainingUsd: Math.max(0, budget - ledger.spentUsd),
    percentUsed: budget ? Math.round((ledger.spentUsd / budget) * 100) : 0,
    calls: ledger.calls,
    byPurpose: ledger.byPurpose,
    lastCallAt: ledger.lastCallAt || null,
  };
}
