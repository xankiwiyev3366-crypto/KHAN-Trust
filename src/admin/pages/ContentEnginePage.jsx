import React, { useState } from 'react';
import { Youtube } from 'lucide-react';

import { SectionTitle, EmptyState, DataTable, ConfidenceChip } from '../ui/primitives.jsx';
import { RecommendationCard, DataVerdict, FabricationNotice } from '../ui/RecommendationCard.jsx';
import { useWarehouse, useAdminResource, formatDate } from '../lib/useGrowthData.js';
import { adminFetch } from '../lib/adminSession.js';

export default function ContentEnginePage({ token }) {
  const { data: warehouse, state } = useWarehouse(token, 30);
  const { data: reports } = useAdminResource('growth-reports', token);
  const [accepting, setAccepting] = useState(null);
  const [accepted, setAccepted] = useState([]);

  if (state.status === 'loading') return <SectionTitle icon={Youtube} eyebrow="Growth OS" title="Loading content engine…" />;
  if (state.status === 'error') return <EmptyState title="Could not load" text={state.message} />;
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
      <SectionTitle icon={Youtube} eyebrow="Growth OS" title="Content engine" />
      <p className="console-page-intro">
        Your scan log is a content-demand signal nobody else has. Every scan is a real person
        telling you, unprompted, which token they are worried enough to check — a direct readout of
        what crypto users are anxious about this week. The tokens people already search for are the
        videos that already have an audience.
      </p>

      <div className="console-callout">
        <strong>Demand is recency-weighted (7-day half-life).</strong>
        <p>
          Crypto attention decays in days, so a token scanned 30 times last month ranks below one
          scanned 8 times this week. A heavily-scanned token that scored <em>low</em> on trust is the
          strongest hook you have: real demand, a real warning, and a natural demonstration of what
          the product does.
        </p>
      </div>

      <h4 className="console-h4">What people are scanning</h4>
      <DataTable
        columns={['Token', 'Ticker', 'Demand', 'Scans', 'People', 'Trust score you gave it', 'Last scanned', 'Signal strength']}
        rows={demand.map((token) => ([
          token.name,
          token.ticker || '—',
          token.demandScore,
          token.scans,
          token.uniqueVisitors,
          token.avgTrustScore ?? '—',
          formatDate(token.lastScannedAt),
          <ConfidenceChip confidence={token.confidence} />,
        ]))}
        emptyText="No scans recorded in this window yet. This table fills as real users scan tokens — it cannot be backfilled from before the data plane shipped."
      />

      <h4 className="console-h4">Content strategist</h4>
      {!strategist ? (
        <EmptyState
          title="No content plan yet"
          text="The analyst team runs every Monday, or on demand from the Executive Brief page. It needs scan data to be specific — with an empty scan log it will correctly tell you it has nothing to work from."
        />
      ) : (
        <>
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
              <h4 className="console-h4">What would make the next plan better</h4>
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
