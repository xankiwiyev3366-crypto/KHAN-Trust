// The analyst run itself. Called only from growth-analyze-background.mjs.
//
// WHY THE FUNCTION TOPOLOGY LOOKS LIKE THIS
//
// This job makes four Claude calls and takes 20-40 seconds. Netlify's three
// function types each cap execution, and only one of them is long enough:
//
//   synchronous  ~10s   -> too short. Returned a 504 and nothing else.
//   scheduled     30s   -> too short. Would have died silently every Monday.
//   background    15min -> the only one that fits.
//
// A background function cannot be scheduled and a scheduled function cannot be
// HTTP-invoked, so the work sits in a background function with two thin callers:
//
//   growth-analyze-background.mjs  15-min limit, admin-gated  <- does the work
//   growth-analyze-cron.mjs        scheduled, 30s, not routable -> fires it weekly
//   src/admin/pages/OverviewPage   the console button           -> fires it manually
//
// The background function answers 202 with an empty body and can never return
// the report to its caller, so both callers are fire-and-forget: the console
// polls growth-reports for a new report id, and the cron just logs.
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
