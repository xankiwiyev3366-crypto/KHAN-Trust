import React, { useState } from 'react';
import { BrainCircuit, RefreshCw } from 'lucide-react';

import { SectionTitle, EmptyState, StatCard } from '../ui/primitives.jsx';
import { RecommendationCard, DataVerdict, FabricationNotice } from '../ui/RecommendationCard.jsx';
import { useAdminResource, useWarehouse, formatUsd, formatDate } from '../lib/useGrowthData.js';
import { adminFetch } from '../lib/adminSession.js';

const ROLE_LABELS = {
  content_strategist: 'Acquisition & Content Strategist',
  growth_analyst: 'Growth Analyst',
  product_analyst: 'Product & UX Analyst',
  executive_brief: 'Chief of Staff',
};

export default function OverviewPage({ token }) {
  const { data: warehouse } = useWarehouse(token, 30);
  const { data, state, reload } = useAdminResource('growth-reports', token);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');
  // The run takes 20-40s behind a 202, so without a progress line the button
  // just looks hung and the operator clicks it again — paying twice.
  const [progress, setProgress] = useState('');

  // The analyst run is a BACKGROUND function: it answers 202 with an empty body
  // immediately and keeps working for another 20-40s. It can never hand us the
  // report, so the only way to observe the result is to poll growth-reports and
  // watch for a report id we have not seen before.
  //
  // (It has to be a background function — four Claude calls take far longer
  // than the ~10s a synchronous Netlify function is allowed, which is why the
  // old direct-POST version could only ever return a 504.)
  const POLL_INTERVAL_MS = 4000;
  const POLL_TIMEOUT_MS = 240000; // 4 min: comfortably past a slow run, far under the 15-min function limit.

  const runAnalysis = async () => {
    setRunning(true);
    setRunError('');
    setProgress('Starting the team…');

    const idBefore = data?.report?.id || null;

    try {
      await adminFetch('growth-analyze-background', {
        token,
        method: 'POST',
        body: { trigger: 'manual' },
      });

      setProgress('Analysts are working. This usually takes under a minute…');
      const startedAt = Date.now();

      // Poll until a NEW report appears, or we give up waiting.
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

        const latest = await adminFetch('growth-reports', { token }).catch(() => null);
        if (latest?.report?.id && latest.report.id !== idBefore) {
          await reload();
          setProgress('');
          return;
        }

        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          // The run may still be going — we simply stopped watching. Say that
          // rather than claiming it failed, which would be a guess.
          setRunError(
            'No report appeared within 4 minutes. The run may still be in progress — reload shortly. ' +
            'If nothing shows up, check the growth-analyze-background function logs in Netlify.'
          );
          setProgress('');
          return;
        }
      }
    } catch (error) {
      setRunError(error.message);
      setProgress('');
    } finally {
      setRunning(false);
    }
  };

  if (state.status === 'loading') return <SectionTitle icon={BrainCircuit} eyebrow="Growth OS" title="Loading…" />;
  if (state.status === 'error') return <EmptyState title="Could not load" text={state.message} />;

  const report = data?.report;
  const brief = report?.brief;
  const budget = data?.budget;

  return (
    <>
      <SectionTitle icon={BrainCircuit} eyebrow="Growth OS" title="Executive brief" />

      {/* The bill, shown before anything else. The operator approved AI on a
          strict budget; a budget you cannot see is not a budget. */}
      {budget && (
        <div className="analytics-stat-grid">
          <StatCard label="AI spend this month" value={formatUsd(budget.spentUsd)} sublabel={`of ${formatUsd(budget.budgetUsd)} cap`} />
          <StatCard label="Budget used" value={`${budget.percentUsed}%`} sublabel={`${budget.calls} calls`} />
          <StatCard label="Remaining" value={formatUsd(budget.remainingUsd)} sublabel="hard cap — calls refuse past it" />
          {warehouse && (
            <StatCard label="Events recorded" value={warehouse.eventCount} sublabel={`last ${warehouse.windowDays} days`} />
          )}
        </div>
      )}

      {!data?.aiConfigured && (
        <div className="console-callout">
          <strong>The analyst layer is switched off.</strong>
          <p>
            <code>ANTHROPIC_API_KEY</code> is not set. Everything else in this console is fully
            deterministic and needs no AI — the funnel, retention, attribution and content-demand
            pages all work exactly as they do with it enabled.
          </p>
        </div>
      )}

      {warehouse?.dataHealth?.note && (
        <div className="console-callout">
          <strong>Data health</strong>
          <p>{warehouse.dataHealth.note}</p>
        </div>
      )}

      <div className="console-actions">
        <button type="button" className="primary-button" onClick={runAnalysis} disabled={running || !data?.aiConfigured}>
          <RefreshCw size={15} /> {running ? 'Running the team…' : 'Run analysis now'}
        </button>
        <span className="console-hint">
          {progress || 'Runs automatically every Monday. A manual run costs roughly a cent.'}
        </span>
      </div>
      {runError && <p className="lookup-message error">{runError}</p>}

      {!report ? (
        <EmptyState
          title="No brief yet"
          text="The team has not run. It will run automatically on Monday, or you can trigger it above. With an empty event log it will correctly report that it has nothing to work from rather than inventing a strategy."
        />
      ) : (
        <>
          <p className="console-hint">
            Generated {formatDate(report.generatedAt)} · {report.trigger} · {report.windowDays}-day window
          </p>

          {brief ? (
            <>
              <h3 className="console-h3">{brief.headline}</h3>
              <DataVerdict verdict={brief.dataVerdict} />
              <FabricationNotice rejected={brief.rejectedForFabrication} />
              <div className="rec-list">
                {brief.recommendations.map((rec) => (
                  <RecommendationCard key={rec.title} recommendation={rec} />
                ))}
              </div>
            </>
          ) : (
            <EmptyState title="No synthesis" text="The Chief of Staff did not complete; the individual analyst reports below still stand on their own." />
          )}

          <h4 className="console-h4">Individual analyst reports</h4>
          {report.analyses.map((analysis) => (
            <details key={analysis.role} className="console-details">
              <summary>
                <strong>{ROLE_LABELS[analysis.role] || analysis.role}</strong> — {analysis.headline}
              </summary>
              <DataVerdict verdict={analysis.dataVerdict} />
              <FabricationNotice rejected={analysis.rejectedForFabrication} />
              <div className="rec-list">
                {analysis.recommendations.map((rec) => (
                  <RecommendationCard key={rec.title} recommendation={rec} />
                ))}
              </div>
            </details>
          ))}

          {report.failures?.length > 0 && (
            <div className="console-callout console-callout-warn">
              <strong>Some analysts failed on this run.</strong>
              <ul>
                {report.failures.map((failure, index) => <li key={index}>{failure.error}</li>)}
              </ul>
            </div>
          )}

          {report.factPack?.unknowns?.length > 0 && (
            <>
              <h4 className="console-h4">What the team could not know</h4>
              <p className="console-page-intro">
                These were withheld from the analysts because the data cannot support a conclusion.
                They are the highest-value things to go and make measurable.
              </p>
              <ul className="console-list">
                {report.factPack.unknowns.map((unknown, index) => <li key={index}>{unknown}</li>)}
              </ul>
            </>
          )}
        </>
      )}
    </>
  );
}
