import React, { useState } from 'react';
import { AlertTriangle, Filter } from 'lucide-react';

import { SectionTitle, EmptyState, StatCard, ConfidenceChip, DataTable } from '../ui/primitives.jsx';
import { useT } from '../i18n/ConsoleI18nProvider.jsx';
import { useWarehouse, formatRate } from '../lib/useGrowthData.js';

const WINDOWS = [7, 30, 90];

export default function FunnelPage({ token }) {
  const { t } = useT();
  const [days, setDays] = useState(30);
  const { data, state } = useWarehouse(token, days);

  if (state.status === 'loading') return <SectionTitle icon={Filter} eyebrow={t('common.eyebrow')} title={t('common.loading')} />;
  if (state.status === 'error') return <EmptyState title={t('common.couldNotLoad')} text={state.message} />;
  if (!data) return null;

  const { funnel, bottleneck, instrumentationGaps, conversionBlockers } = data;

  return (
    <>
      <SectionTitle icon={Filter} eyebrow={t('common.eyebrow')} title={t('funnel.title')} />
      <p className="console-page-intro">{t('funnel.intro')}</p>

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
          behaviour. It has to be the first thing the operator sees.
          `gap.reason` is generated server-side and stays in English. */}
      {instrumentationGaps?.length > 0 && (
        <div className="console-callout">
          <strong><AlertTriangle size={15} /> {t('funnel.trackingGap')}</strong>
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
            sublabel={stage.countIsEvents ? t('funnel.events') : t('common.visitors')}
          />
        ))}
      </div>

      <h4 className="console-h4">{t('funnel.stepConversion')}</h4>
      <DataTable
        columns={[t('funnel.colStep'), t('funnel.colReached'), t('funnel.colConversion'), t('confidence.canWeTrust')]}
        rows={funnel.stages.filter((stage) => stage.rate).map((stage) => ([
          stage.label,
          stage.count,
          <span className={stage.rate.confidence.level === 'insufficient' ? 'metric-insufficient' : ''}>
            {formatRate(stage.rate.value)}
          </span>,
          <ConfidenceChip confidence={stage.rate.confidence} />,
        ]))}
        emptyText={t('funnel.noSteps')}
      />

      <h4 className="console-h4">{t('funnel.bottleneck')}</h4>
      {bottleneck.stage ? (
        <div className="console-callout">
          <strong>{bottleneck.label}</strong>
          <p>{bottleneck.reason}</p>
          <ConfidenceChip confidence={bottleneck.confidence} />
        </div>
      ) : (
        <EmptyState title={t('funnel.notAnswerable')} text={bottleneck.reason} />
      )}

      <h4 className="console-h4">{t('funnel.blockers')}</h4>
      <p className="console-page-intro">{t('funnel.blockersIntro')}</p>
      <DataTable
        columns={[t('funnel.colReason'), t('funnel.colCount')]}
        rows={conversionBlockers.map((blocker) => [blocker.reason, blocker.count])}
        emptyText={t('funnel.noBlockers')}
      />
    </>
  );
}
