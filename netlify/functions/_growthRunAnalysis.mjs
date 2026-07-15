// The analyst run itself, shared by the manual endpoint and the cron job.
//
// WHY THIS IS A SEPARATE MODULE
//
// A Netlify function that declares a `schedule` is NOT invocable over HTTP —
// Netlify serves it a 404. So a single dual-purpose endpoint cannot be both the
// weekly cron and the console's "Run analysis now" button: adding the schedule
// silently kills the button, and the failure looks like a routing bug rather
// than a design error.
//
// Trying to tell the two apart inside one handler (sniffing for absent headers,
// or a `next_run` field in the body) is worse than useless: it is a guess about
// an undocumented invocation shape, and every version of that guess is either
// an auth hole (anyone can trigger a paid AI run by faking the marker) or a
// silent failure (the cron gets 401'd forever and no one notices the reports
// stopped).
//
// So: two thin, unambiguous entry points around one runner.
//   growth-analyze.mjs      HTTP,   admin-gated, no schedule  -> the button
//   growth-analyze-cron.mjs schedule, not routable            -> the weekly run
import { buildWarehouse } from './_growthWarehouse.mjs';
import { buildFactPack, contentStrategist, growthAnalyst, productAnalyst, executiveBrief } from './_growthAnalyst.mjs';
import { saveReport } from './_growthReportStore.mjs';
import { budgetStatus } from './_aiBudget.mjs';

export async function runAnalysis({ trigger }) {
  const warehouse = await buildWarehouse({ days: 30 });
  const factPack = buildFactPack(warehouse);

  // The three specialists run in PARALLEL — they are independent reads of the
  // same facts and share no state, so there is no reason to pay three
  // sequential round trips.
  //
  // allSettled, not all: one analyst failing (a refusal, a truncation) must not
  // discard the other two, which have already been paid for.
  const settled = await Promise.allSettled([
    contentStrategist(factPack),
    growthAnalyst(factPack),
    productAnalyst(factPack),
  ]);

  const analyses = settled.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  const failures = settled
    .filter((r) => r.status === 'rejected')
    .map((r) => ({ error: r.reason?.message || String(r.reason), code: r.reason?.code || null }));

  if (!analyses.length) {
    const error = new Error('Every analyst failed; no report was produced.');
    error.code = 'ALL_ANALYSTS_FAILED';
    error.failures = failures;
    throw error;
  }

  // The brief runs LAST and reads the specialists' output rather than the raw
  // metrics — that dependency is what makes this a team rather than three
  // parallel opinions. Its own failure is tolerated: three specialist reports
  // with no synthesis still beat nothing.
  let brief = null;
  try {
    brief = await executiveBrief(factPack, analyses);
  } catch (error) {
    failures.push({ error: `Executive brief failed: ${error.message}`, code: error.code || null });
  }

  return saveReport({
    generatedAt: new Date().toISOString(),
    trigger,
    windowDays: warehouse.windowDays,
    brief,
    analyses,
    failures,
    // Stored alongside the report so a future reader can see exactly what the
    // team knew — and did not know — at the time it gave this advice.
    factPack,
    dataHealth: warehouse.dataHealth,
    budget: await budgetStatus().catch(() => null),
  });
}
