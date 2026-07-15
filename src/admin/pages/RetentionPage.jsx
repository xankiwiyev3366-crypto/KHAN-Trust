import React from 'react';
import { Users } from 'lucide-react';

import { SectionTitle, EmptyState, StatCard, ConfidenceChip, DataTable } from '../ui/primitives.jsx';
import { useT } from '../i18n/ConsoleI18nProvider.jsx';
import { useWarehouse, formatRate } from '../lib/useGrowthData.js';

const HORIZONS = ['d1', 'd7', 'd30'];

export default function RetentionPage({ token }) {
  const { t } = useT();
  const { data, state } = useWarehouse(token, 90);

  if (state.status === 'loading') return <SectionTitle icon={Users} eyebrow={t('common.eyebrow')} title={t('common.loading')} />;
  if (state.status === 'error') return <EmptyState title={t('common.couldNotLoad')} text={state.message} />;
  if (!data) return null;

  const { retention } = data;

  const horizonCell = (horizon) => {
    if (!horizon.matured) return <span className="metric-insufficient">{t('retention.notDue')}</span>;
    const rate = horizon.eligible ? horizon.retained / horizon.eligible : null;
    return `${formatRate(rate)} (${horizon.retained}/${horizon.eligible})`;
  };

  return (
    <>
      <SectionTitle icon={Users} eyebrow={t('common.eyebrow')} title={t('retention.title')} />
      <p className="console-page-intro">{t('retention.intro')}</p>

      <div className="console-callout">
        <strong>{t('retention.calloutTitle')}</strong>
        <p>{t('retention.calloutBody')}</p>
      </div>

      <div className="analytics-stat-grid">
        {HORIZONS.map((horizon) => {
          const metric = retention.summary[horizon];
          return (
            <StatCard
              key={horizon}
              label={t('retention.horizon', { horizon: horizon.toUpperCase() })}
              value={formatRate(metric.value)}
              sublabel={metric.confidence.level === 'insufficient'
                ? t('retention.notEnough')
                : t('retention.ofUsers', { retained: metric.retained, eligible: metric.eligible })}
            />
          );
        })}
      </div>

      <div className="console-confidence-row">
        {HORIZONS.map((horizon) => (
          <span key={horizon}>
            <strong>{horizon.toUpperCase()}</strong> <ConfidenceChip confidence={retention.summary[horizon].confidence} />
          </span>
        ))}
      </div>

      <h4 className="console-h4">{t('retention.byCohort')}</h4>
      <DataTable
        columns={[t('retention.colSignupDay'), t('retention.colUsers'), 'D1', 'D7', 'D30']}
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
