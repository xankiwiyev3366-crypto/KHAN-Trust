import React, { useState } from 'react';
import { Youtube } from 'lucide-react';

import { SectionTitle, EmptyState, DataTable, ConfidenceChip } from '../ui/primitives.jsx';
import { RecommendationCard, DataVerdict, FabricationNotice } from '../ui/RecommendationCard.jsx';
import { useT } from '../i18n/ConsoleI18nProvider.jsx';
import { useWarehouse, useAdminResource, formatDate } from '../lib/useGrowthData.js';
import { adminFetch } from '../lib/adminSession.js';

export default function ContentEnginePage({ token }) {
  const { t, lang } = useT();
  const { data: warehouse, state } = useWarehouse(token, 30);
  const { data: reports } = useAdminResource('growth-reports', token);
  const [accepting, setAccepting] = useState(null);
  const [accepted, setAccepted] = useState([]);

  if (state.status === 'loading') return <SectionTitle icon={Youtube} eyebrow={t('common.eyebrow')} title={t('common.loading')} />;
  if (state.status === 'error') return <EmptyState title={t('common.couldNotLoad')} text={state.message} />;
  if (!warehouse) return null;

  const demand = warehouse.contentDemand;
  const strategist = reports?.report?.analyses?.find((a) => a.role === 'content_strategist');

  const trackInitiative = async (recommendation) => {
    setAccepting(recommendation.title);
    try {
      await adminFetch('growth-initiatives', {
        token,
        method: 'POST',
        body: {
          action: 'create',
          recommendation,
          sourceReportId: reports?.report?.id,
          sourceRole: 'content_strategist',
        },
      });
      setAccepted((prev) => [...prev, recommendation.title]);
    } catch (error) {
      alert(error.message);
    } finally {
      setAccepting(null);
    }
  };

  return (
    <>
      <SectionTitle icon={Youtube} eyebrow={t('common.eyebrow')} title={t('content.title')} />
      <p className="console-page-intro">{t('content.intro')}</p>

      <div className="console-callout">
        <strong>{t('content.calloutTitle')}</strong>
        <p>{t('content.calloutBody')}</p>
      </div>

      <h4 className="console-h4">{t('content.whatScanning')}</h4>
      <DataTable
        columns={[
          t('content.colToken'), t('content.colTicker'), t('content.colDemand'),
          t('content.colScans'), t('content.colPeople'), t('content.colTrustScore'),
          t('content.colLastScanned'), t('content.colSignal'),
        ]}
        rows={demand.map((token_) => ([
          token_.name,
          token_.ticker || '—',
          token_.demandScore,
          token_.scans,
          token_.uniqueVisitors,
          token_.avgTrustScore ?? '—',
          formatDate(token_.lastScannedAt, lang),
          <ConfidenceChip confidence={token_.confidence} />,
        ]))}
        emptyText={t('content.noScans')}
      />

      <h4 className="console-h4">{t('content.strategist')}</h4>
      {!strategist ? (
        <EmptyState title={t('content.noPlanTitle')} text={t('content.noPlanBody')} />
      ) : (
        <>
          {/* The analyst's own words, composed in the language selected when the
              report was run. Rendered as stored. */}
          <p className="console-page-intro"><strong>{strategist.headline}</strong></p>
          <DataVerdict verdict={strategist.dataVerdict} />
          <FabricationNotice rejected={strategist.rejectedForFabrication} />

          <div className="rec-list">
            {strategist.recommendations.map((rec) => (
              <RecommendationCard
                key={rec.title}
                recommendation={rec}
                accepting={accepting === rec.title}
                onAccept={accepted.includes(rec.title) ? null : trackInitiative}
              />
            ))}
          </div>

          {strategist.openQuestions?.length > 0 && (
            <>
              <h4 className="console-h4">{t('content.openQuestions')}</h4>
              <ul className="console-list">
                {strategist.openQuestions.map((question, index) => <li key={index}>{question}</li>)}
              </ul>
            </>
          )}
        </>
      )}
    </>
  );
}
