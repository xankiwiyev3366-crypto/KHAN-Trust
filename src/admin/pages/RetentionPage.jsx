import React from 'react';
import { Users } from 'lucide-react';

import { SectionTitle, EmptyState, StatCard, ConfidenceChip, DataTable } from '../ui/primitives.jsx';
import { useWarehouse, formatRate } from '../lib/useGrowthData.js';

function horizonCell(horizon) {
  if (!horizon.matured) return <span className="metric-insufficient">not yet due</span>;
  const rate = horizon.eligible ? horizon.retained / horizon.eligible : null;
  return `${formatRate(rate)} (${horizon.retained}/${horizon.eligible})`;
}

export default function RetentionPage({ token }) {
  const { data, state } = useWarehouse(token, 90);

  if (state.status === 'loading') return <SectionTitle icon={Users} eyebrow="Growth OS" title="Loading retention…" />;
  if (state.status === 'error') return <EmptyState title="Could not load" text={state.message} />;
  if (!data) return null;

  const { retention } = data;

  return (
    <>
      <SectionTitle icon={Users} eyebrow="Growth OS" title="Cohort retention" />
      <p className="console-page-intro">
        Real cohort retention: users are grouped by the day they registered, then measured on
        whether they came back on day 1, 7 and 30. This is not the old “returning users” number,
        which counted anyone who ever logged in on two different days — that figure has no time
        dimension, can only ever go up, and cannot reveal that retention is getting worse.
      </p>

      <div className="console-callout">
        <strong>Users whose horizon has not elapsed are excluded, not counted as churned.</strong>
        <p>
          Someone who signed up two days ago has not failed D7 — their D7 has not happened yet.
          Counting them as a failure is the most common way retention dashboards understate reality.
        </p>
      </div>

      <div className="analytics-stat-grid">
        {['d1', 'd7', 'd30'].map((horizon) => {
          const metric = retention.summary[horizon];
          return (
            <StatCard
              key={horizon}
              label={`${horizon.toUpperCase()} retention`}
              value={formatRate(metric.value)}
              sublabel={metric.confidence.level === 'insufficient'
                ? 'not enough data'
                : `${metric.retained}/${metric.eligible} users`}
            />
          );
        })}
      </div>

      <div className="console-confidence-row">
        {['d1', 'd7', 'd30'].map((horizon) => (
          <span key={horizon}>
            <strong>{horizon.toUpperCase()}</strong> <ConfidenceChip confidence={retention.summary[horizon].confidence} />
          </span>
        ))}
      </div>

      <h4 className="console-h4">By signup cohort</h4>
      <DataTable
        columns={['Signup day', 'Users', 'D1', 'D7', 'D30']}
        rows={retention.cohorts.map((cohort) => ([
          cohort.day,
          cohort.size,
          horizonCell(cohort.horizons.d1),
          horizonCell(cohort.horizons.d7),
          horizonCell(cohort.horizons.d30),
        ]))}
        emptyText={retention.note}
      />
    </>
  );
}
