import React, { useState } from 'react';
import { AlertTriangle, Filter } from 'lucide-react';

import { SectionTitle, EmptyState, StatCard, ConfidenceChip, DataTable } from '../ui/primitives.jsx';
import { useWarehouse, formatRate } from '../lib/useGrowthData.js';

const WINDOWS = [7, 30, 90];

export default function FunnelPage({ token }) {
  const [days, setDays] = useState(30);
  const { data, state } = useWarehouse(token, days);

  if (state.status === 'loading') return <SectionTitle icon={Filter} eyebrow="Growth OS" title="Loading funnel…" />;
  if (state.status === 'error') return <EmptyState title="Could not load" text={state.message} />;
  if (!data) return null;

  const { funnel, bottleneck, instrumentationGaps, conversionBlockers } = data;

  return (
    <>
      <SectionTitle icon={Filter} eyebrow="Growth OS" title="Conversion funnel" />
      <p className="console-page-intro">
        Measured in <strong>visitors, not events</strong> — one person scanning forty tokens is one
        activated visitor, not forty. Every rate carries its statistical standing; a rate marked
        “Not enough data” is not a small number, it is an unknown one.
      </p>

      <div className="console-range">
        {WINDOWS.map((option) => (
          <button
            key={option}
            type="button"
            className={`range-button${option === days ? ' is-active' : ''}`}
            onClick={() => setDays(option)}
          >
            {option}d
          </button>
        ))}
      </div>

      {/* Instrumentation doubt outranks every other reading on this page: if an
          event is not firing, the funnel below it describes tracking, not
          behaviour. It has to be the first thing the operator sees. */}
      {instrumentationGaps?.length > 0 && (
        <div className="console-callout">
          <strong><AlertTriangle size={15} /> Possible tracking gap — read this first.</strong>
          <ul>
            {instrumentationGaps.map((gap) => (
              <li key={gap.stage}>{gap.reason}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="analytics-stat-grid">
        {funnel.stages.map((stage) => (
          <StatCard
            key={stage.id}
            label={stage.label}
            value={stage.count}
            sublabel={stage.countIsEvents ? 'events (wallet-keyed, not people)' : 'visitors'}
          />
        ))}
      </div>

      <h4 className="console-h4">Step-to-step conversion</h4>
      <DataTable
        columns={['Step', 'Reached', 'Conversion', 'Can we trust it?']}
        rows={funnel.stages.filter((stage) => stage.rate).map((stage) => ([
          stage.label,
          stage.count,
          <span className={stage.rate.confidence.level === 'insufficient' ? 'metric-insufficient' : ''}>
            {formatRate(stage.rate.value)}
          </span>,
          <ConfidenceChip confidence={stage.rate.confidence} />,
        ]))}
        emptyText="No funnel steps recorded yet."
      />

      <h4 className="console-h4">Bottleneck</h4>
      {bottleneck.stage ? (
        <div className="console-callout">
          <strong>{bottleneck.label}</strong>
          <p>{bottleneck.reason}</p>
          <ConfidenceChip confidence={bottleneck.confidence} />
        </div>
      ) : (
        <EmptyState title="Not answerable yet" text={bottleneck.reason} />
      )}

      <h4 className="console-h4">Why checkouts failed</h4>
      <p className="console-page-intro">
        Recorded first-party with the reason attached. <code>wallet_required</code> is product
        friction you can fix; <code>missing_config</code> means checkout is broken and revenue is
        being lost silently. Google Analytics cannot tell these two apart.
      </p>
      <DataTable
        columns={['Reason', 'Count']}
        rows={conversionBlockers.map((blocker) => [blocker.reason, blocker.count])}
        emptyText="No failed checkouts recorded in this window."
      />
    </>
  );
}
