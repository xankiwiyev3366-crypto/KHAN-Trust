// The AI reasoning layer — KHAN Trust's private executive team.
//
// FOUR ANALYSTS, NOT TWELVE. Each has a real job backed by data that actually
// exists. A larger roster would mean agents reasoning about things the platform
// cannot measure, which is not an executive team — it is a fiction generator
// with job titles.
//
// THE GROUNDING CONTRACT
//
// An LLM pointed at a dashboard will always produce an answer. At ~115 users
// that answer is usually invented, because the honest answer ("there isn't
// enough data yet") is not what a helpful assistant wants to say. Three
// mechanisms make the honest answer the only one it CAN give:
//
//   1. The fact pack (buildFactPack) removes every metric the Confidence Engine
//      marked `insufficient` before the model ever sees it. The model cannot
//      over-read a number it was not shown. What is unknown is passed
//      separately, as an explicit list of open questions.
//   2. The system prompt makes "we don't know yet, here is what to measure" a
//      first-class, valued answer rather than a failure.
//   3. Every number in the output is checked against the fact pack
//      (_aiValidator.mjs). Fabricated statistics are dropped mechanically,
//      regardless of what the model was asked to do.
//
// Mechanism 3 is the one that actually holds. 1 and 2 make the model's job
// easier; 3 makes failure impossible to ship.
import { askForJson } from './_aiClient.mjs';
import { rejectFabricatedFindings } from './_aiValidator.mjs';
import { CONFIDENCE } from './_growthConfidence.mjs';

// ── Fact pack ─────────────────────────────────────────────────────────────────

function usable(metric) {
  return metric && metric.value !== null && metric.confidence?.level !== CONFIDENCE.INSUFFICIENT;
}

// Reduces the warehouse to what can honestly be reasoned about, and states
// plainly what cannot. The `unknowns` list is as important as the `known` one:
// it is what turns "no insight" into "here is the specific thing to go measure".
export function buildFactPack(warehouse) {
  const known = {};
  const unknowns = [];

  const funnelStages = [];
  for (const stage of warehouse.funnel.stages) {
    if (!stage.rate) {
      funnelStages.push({ stage: stage.label, visitors: stage.count });
      continue;
    }
    if (usable(stage.rate)) {
      funnelStages.push({
        stage: stage.label,
        count: stage.count,
        conversionRate: stage.rate.value,
        confidence: stage.rate.confidence.level,
      });
    } else {
      unknowns.push(`Conversion into "${stage.label}" — ${stage.rate.confidence.reason}`);
    }
  }
  known.funnel = funnelStages;
  known.totalVisitors = warehouse.funnel.totalVisitors;

  if (warehouse.bottleneck.stage) {
    known.bottleneck = { stage: warehouse.bottleneck.label, reason: warehouse.bottleneck.reason };
  } else {
    unknowns.push(`The funnel's bottleneck — ${warehouse.bottleneck.reason}`);
  }

  // Instrumentation gaps are escalated as FACTS, not unknowns. A missing event
  // is an engineering task with a known fix, and the model should be able to
  // recommend fixing it — that is one of the most valuable things it can say
  // at this stage.
  if (warehouse.instrumentationGaps?.length) {
    known.instrumentationGaps = warehouse.instrumentationGaps.map((gap) => ({
      step: gap.label,
      problem: gap.reason,
    }));
  }

  const retention = {};
  for (const horizon of ['d1', 'd7', 'd30']) {
    const metric = warehouse.retention.summary[horizon];
    if (usable(metric)) {
      retention[horizon] = { rate: metric.value, ofUsers: metric.eligible };
    } else {
      unknowns.push(`${horizon.toUpperCase()} retention — ${metric.confidence.reason}`);
    }
  }
  if (Object.keys(retention).length) known.retention = retention;

  known.channels = warehouse.channels.map((row) => ({
    channel: row.channel,
    visitors: row.visitors,
    signups: row.signups,
    ...(usable(row.signupRate) ? { signupRate: row.signupRate.value } : {}),
    signupRateConfidence: row.signupRate.confidence.level,
  }));

  // Content demand is the operator's proprietary signal and the reason the
  // Content Strategist can be specific rather than generic. Passed with raw
  // counts so the model can weigh how thin each row is.
  known.contentDemand = warehouse.contentDemand.map((token) => ({
    token: token.name,
    ticker: token.ticker,
    scans: token.scans,
    uniquePeople: token.uniqueVisitors,
    recencyWeightedDemand: token.demandScore,
    trustScoreWeGave: token.avgTrustScore,
  }));

  known.conversionBlockers = warehouse.conversionBlockers;
  known.dataHealth = warehouse.dataHealth;

  if (!warehouse.signupTrend.change.significant) {
    unknowns.push(`Whether registrations are trending up or down — ${warehouse.signupTrend.change.reason}`);
  }

  return { known, unknowns, windowDays: warehouse.windowDays, generatedAt: warehouse.generatedAt };
}

// ── Shared contract ───────────────────────────────────────────────────────────

const GROUNDING_RULES = `
You are part of the private executive team for KHAN Trust, an AI-powered crypto
trust-intelligence platform. You report ONLY to the founder. Users never see
your output.

CONTEXT YOU MUST INTERNALISE:
KHAN Trust is early. It has roughly 115 registered users. At that scale most
rates are statistically meaningless, and the metrics you are given have already
been filtered: anything too thin to support a conclusion has been REMOVED from
the facts and listed under "unknowns" instead. This filtering already happened.
You do not need to second-guess it.

ABSOLUTE RULES — these are not style preferences:
1. Every number you write MUST come from the facts you were given. Do not
   compute new statistics. Do not cite industry benchmarks, competitor figures,
   conversion averages, or any number from your training data. There is an
   automated check that drops any recommendation containing a number that is not
   traceable to the facts, so an invented figure does not make your answer more
   persuasive — it deletes it.
2. If the facts do not support a conclusion, say so and state exactly what would
   need to be measured. "We cannot know this yet, and here is how to find out"
   is a VALUABLE answer here, not a failure. A confident answer built on thin
   data is the worst thing you can produce.
3. Never invent user research, survey results, feedback, or A/B test results.
   None exist.
4. Prefer one recommendation that is genuinely supported over five that are
   plausible. The founder has limited time and will act on what you say.

THE BUSINESS CONTEXT:
The binding constraint is TRAFFIC, not insight. 115 users is not enough people
for funnel optimisation to matter — a 20% conversion improvement on ~zero
traffic is ~zero users. Acquisition beats optimisation at this stage, and
recommendations should reflect that ordering unless the facts say otherwise.

Marketing is YouTube and TikTok ONLY. Do not propose X/Twitter, Instagram,
Facebook, Reddit, Telegram, Discord, LinkedIn, email marketing, or paid ads.
`.trim();

// ── Output language ───────────────────────────────────────────────────────────
//
// The instructions above stay in ENGLISH even when the output is Azerbaijani.
// That is deliberate: this prompt is tuned, and translating a tuned prompt is
// the fastest way to lose its behaviour. Models follow English instructions
// reliably while writing fluently in the target language, so instruct in
// English, emit in Azerbaijani.
//
// The enum carve-out below is load-bearing. `priority`, `complexity`,
// `confidence` and `objective` are machine-readable values that the console
// translates itself via t(`objectives.${rec.objective}`). If the model returned
// "Qeydiyyatlar" instead of "registrations", the schema would reject it and the
// UI lookup would miss — so the model is told plainly to leave them alone. The
// JSON schema's `enum` constraint enforces this independently, which is the
// belt to this braces.
const LANGUAGE_NAMES = {
  en: 'English',
  az: 'Azerbaijani (Azərbaycan dili)',
};

export function languageDirective(language) {
  // An unrecognised language degrades to English (no directive) rather than
  // interpolating `undefined` into a system prompt — "Write every piece of
  // PROSE in undefined" is worse than useless, and it would be paid for.
  //
  // growth-analyze-background allow-lists `language` before it reaches here, so
  // this should be unreachable. Defence in depth: this function must be safe on
  // its own terms, not because of a check somewhere else.
  if (!LANGUAGE_NAMES[language] || language === 'en') return '';

  return `
OUTPUT LANGUAGE — ${LANGUAGE_NAMES[language]}.

Write every piece of PROSE in ${LANGUAGE_NAMES[language]}: headline, dataVerdict,
and each recommendation's title, reasoning, expectedImpact, roiEstimate and
risks, plus every entry in openQuestions.

Write as a native speaker writing for a native speaker. This must read as though
it was thought and written in ${LANGUAGE_NAMES[language]} — not translated from
English. Use natural business and technical register, not literal calques.

Write numbers with a PERIOD as the decimal separator (3.2, not 3,2), exactly as
they appear in the facts you were given. This keeps them machine-checkable.

Do NOT translate any of the following — they are machine-readable values,
identifiers, or names, and translating them breaks the system or makes them
wrong:
  - the enum fields: priority (P0/P1/P2/P3), complexity (low/medium/high),
    confidence (grounded_in_data/informed_judgement/speculative), and objective
    (registrations, active_users, retention, user_experience, conversion, trust,
    brand_awareness, positioning, new_opportunity, investor_readiness,
    data_quality). Emit these in English exactly as listed.
  - token names, tickers and contract addresses (BONK, SOL, …)
  - channel names (YouTube, TikTok, Google)
  - product names (KHAN Trust, Growth OS)
  - code identifiers and event names (wallet_required, missing_config,
    pricing_view, utm_source, ANTHROPIC_API_KEY)
`.trim();
}

// Every recommendation carries the full decision record the founder asked for.
// Enums rather than free text on priority/complexity so the console can sort
// and the founder can compare across analysts.
const RECOMMENDATION_SCHEMA = {
  type: 'object',
  properties: {
    headline: {
      type: 'string',
      description: 'One sentence: the single most important thing in this analysis.',
    },
    dataVerdict: {
      type: 'string',
      description: 'Honest statement of what the data can and cannot support right now.',
    },
    recommendations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'A specific, actionable action. Not a theme.' },
          reasoning: { type: 'string', description: 'Why, citing ONLY the given facts.' },
          expectedImpact: { type: 'string', description: 'The concrete business outcome expected.' },
          objective: {
            type: 'string',
            enum: [
              'registrations', 'active_users', 'retention', 'user_experience',
              'conversion', 'trust', 'brand_awareness', 'positioning',
              'new_opportunity', 'investor_readiness', 'data_quality',
            ],
          },
          priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
          complexity: { type: 'string', enum: ['low', 'medium', 'high'] },
          roiEstimate: {
            type: 'string',
            description: 'A RANGE with its assumptions stated, or "unknown" plus what to measure. Never a fabricated precise figure.',
          },
          risks: { type: 'string', description: 'What could go wrong, or why this might not work.' },
          confidence: {
            type: 'string',
            enum: ['grounded_in_data', 'informed_judgement', 'speculative'],
            description: 'grounded_in_data = the facts directly support it. speculative = a reasoned guess; label it honestly.',
          },
        },
        required: ['title', 'reasoning', 'expectedImpact', 'objective', 'priority', 'complexity', 'roiEstimate', 'risks', 'confidence'],
        additionalProperties: false,
      },
    },
    openQuestions: {
      type: 'array',
      items: { type: 'string' },
      description: 'What you would need measured to give a better answer next time.',
    },
  },
  required: ['headline', 'dataVerdict', 'recommendations', 'openQuestions'],
  additionalProperties: false,
};

const TEXT_FIELDS = ['title', 'reasoning', 'expectedImpact', 'roiEstimate', 'risks'];

async function runAnalyst({ role, task, factPack, purpose, language = 'en' }) {
  const prompt = [
    task,
    '',
    'FACTS YOU MAY USE (nothing else):',
    JSON.stringify(factPack.known, null, 2),
    '',
    'THINGS THAT ARE CURRENTLY UNKNOWABLE FROM THE DATA:',
    factPack.unknowns.length
      ? factPack.unknowns.map((unknown) => `- ${unknown}`).join('\n')
      : '- (none)',
    '',
    `Analysis window: last ${factPack.windowDays} days.`,
  ].join('\n');

  const { data, spend, model } = await askForJson({
    system: `${GROUNDING_RULES}\n\nYOUR ROLE:\n${role}`,
    prompt,
    schema: RECOMMENDATION_SCHEMA,
    purpose,
  });

  // The mechanical backstop. Runs regardless of what the prompt asked for.
  const { kept, rejected } = rejectFabricatedFindings(
    data.recommendations || [],
    factPack.known,
    TEXT_FIELDS
  );

  return {
    role: purpose,
    language,
    headline: data.headline,
    dataVerdict: data.dataVerdict,
    recommendations: kept,
    openQuestions: data.openQuestions || [],
    // Surfaced, not hidden: a model that starts fabricating is a regression the
    // operator needs to see.
    rejectedForFabrication: rejected,
    meta: { model, costUsd: spend.cost },
  };
}

// ── The analysts ──────────────────────────────────────────────────────────────

// Priority #1. This is the analyst that attacks the actual bottleneck, and the
// only one with a genuinely proprietary input: nobody else knows which tokens
// KHAN Trust's users are anxious enough to scan this week.
export function contentStrategist(factPack, language) {
  return runAnalyst({
    purpose: 'content_strategist',
    factPack,
    language,
    role: `
Acquisition & Content Strategist. You own YouTube and TikTok, and you are the
most important analyst here because the platform's binding constraint is that
almost nobody knows it exists.

Your unfair advantage is the contentDemand data. Every scan is a real person
telling KHAN Trust, unprompted, which token they are worried enough to check.
That is a direct readout of what crypto users are anxious about right now, and
no competitor has it. Tokens people already search for are videos that already
have an audience.

Note trustScoreWeGave: a heavily-scanned token that scored LOW is the strongest
possible content hook — real demand plus a genuine warning plus a natural
demonstration of what the product does.

Be specific. "Make a video about SAFEMOON's 23 trust score and why the liquidity
lock failed" is useful. "Create engaging crypto content" is not — never write
that. Recommend concrete videos tied to specific tokens in the data.

The channels currently have almost no content. Volume and consistency matter
more than polish at this stage; say so if the data supports it.
    `.trim(),
    task: 'Produce the content plan for the next two weeks, driven by real scan demand.',
  });
}

export function growthAnalyst(factPack, language) {
  return runAnalyst({
    purpose: 'growth_analyst',
    factPack,
    language,
    role: `
Growth Analyst. You find the binding constraint on growth and say what to do
about it.

Be rigorous about the difference between "the data shows X" and "I think X". If
the funnel data is too thin to locate a bottleneck, SAY SO and recommend what to
instrument or how much traffic is needed — do not manufacture one.

If instrumentationGaps is present, treat it as urgent: an untracked funnel step
means every downstream conclusion is unreliable, and fixing it is usually higher
value than any optimisation you could propose on top of broken data.
    `.trim(),
    task: 'Identify the single biggest constraint on growth right now, and what to do about it.',
  });
}

export function productAnalyst(factPack, language) {
  return runAnalyst({
    purpose: 'product_analyst',
    factPack,
    language,
    role: `
Product & UX Analyst. You find friction that costs users, using only observed
behaviour — there is no user research, no session recording, and no survey data.
Do not invent any.

conversionBlockers is your richest input: it records WHY each checkout died.
'wallet_required' means the product demands a wallet before it will take
someone's money — a product decision costing real revenue. 'missing_config'
means checkout is broken and revenue is being lost silently, which is an
emergency, not an optimisation.
    `.trim(),
    task: 'Identify friction in the product that is measurably costing users or revenue.',
  });
}

// Runs LAST and reads the other analysts' output rather than the raw metrics.
// That is what makes this a team: the brief resolves disagreements and forces a
// single ordering, instead of handing the founder three parallel to-do lists.
export function executiveBrief(factPack, analyses, language) {
  const digest = analyses.map((analysis) => ({
    from: analysis.role,
    headline: analysis.headline,
    dataVerdict: analysis.dataVerdict,
    recommendations: analysis.recommendations.map((rec) => ({
      title: rec.title,
      priority: rec.priority,
      objective: rec.objective,
      confidence: rec.confidence,
    })),
  }));

  return runAnalyst({
    purpose: 'executive_brief',
    language,
    factPack: {
      ...factPack,
      known: { ...factPack.known, analystReports: digest },
    },
    role: `
Chief of Staff. You have read the other analysts' reports (in analystReports).
Your job is to give the founder ONE ordered plan, not a summary.

Resolve conflicts explicitly. If the Growth Analyst wants funnel work and the
Content Strategist wants videos, decide which comes first and say why — that
decision is the entire value of this brief.

Ruthlessly prioritise. Name at most THREE things to do next. The founder is one
person and will do the first item on the list; make sure it is the right one.

Be blunt about what the team does not know. Do not restate the other analysts'
reasoning at length — decide.
    `.trim(),
    task: 'Give the founder the three things to do next, in order, with the reasoning for that ordering.',
  });
}
