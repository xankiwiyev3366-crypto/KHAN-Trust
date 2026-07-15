import React, { useState } from 'react';
import { ListChecks } from 'lucide-react';

import { SectionTitle, EmptyState, StatCard } from '../ui/primitives.jsx';
import { useT } from '../i18n/ConsoleI18nProvider.jsx';
import { useAdminResource, formatDate } from '../lib/useGrowthData.js';
import { adminFetch } from '../lib/adminSession.js';

// Mirrors the server's state machine (_growthInitiatives.mjs). The server is
// authoritative and rejects illegal moves; this only decides which buttons to
// draw, so an out-of-date copy is a cosmetic bug, never a data-integrity one.
const NEXT_STATUS = {
  proposed: [['accepted', 'accept'], ['rejected', 'reject']],
  accepted: [['shipped', 'markShipped'], ['rejected', 'drop']],
  shipped: [['measured', 'recordOutcome']],
  measured: [],
  rejected: [],
};

const OUTCOMES = ['worked', 'no_effect', 'inconclusive', 'backfired'];

export default function InitiativesPage({ token }) {
  const { t, lang } = useT();
  const { data, state, reload } = useAdminResource('growth-initiatives', token);
  const [busy, setBusy] = useState(null);
  const [measuring, setMeasuring] = useState(null);
  const [note, setNote] = useState('');

  const move = async (id, status, outcome) => {
    setBusy(id);
    try {
      await adminFetch('growth-initiatives', {
        token,
        method: 'POST',
        body: { action: 'update', id, status, outcome, outcomeNote: outcome ? note : undefined },
      });
      setMeasuring(null);
      setNote('');
      await reload();
    } catch (error) {
      alert(error.message);
    } finally {
      setBusy(null);
    }
  };

  if (state.status === 'loading') return <SectionTitle icon={ListChecks} eyebrow={t('common.eyebrow')} title={t('common.loading')} />;
  if (state.status === 'error') return <EmptyState title={t('common.couldNotLoad')} text={state.message} />;

  const { initiatives = [], summary } = data || {};

  return (
    <>
      <SectionTitle icon={ListChecks} eyebrow={t('common.eyebrow')} title={t('initiatives.title')} />
      <p className="console-page-intro">{t('initiatives.intro')}</p>

      <div className="console-callout">
        <strong>{t('initiatives.calloutTitle')}</strong>
        <p>{t('initiatives.calloutBody')}</p>
      </div>

      {summary && (
        <div className="analytics-stat-grid">
          <StatCard label={t('initiatives.tracked')} value={summary.total} />
          <StatCard label={t('initiatives.inFlight')} value={summary.byStatus.accepted + summary.byStatus.shipped} />
          <StatCard label={t('initiatives.measured')} value={summary.measuredCount} />
          <StatCard
            label={t('initiatives.hitRate')}
            value={summary.hitRate === null ? t('common.notMeasured') : `${Math.round(summary.hitRate * 100)}%`}
            sublabel={summary.hitRate === null ? t('initiatives.nothingMeasured') : t('initiatives.ofMeasured')}
          />
        </div>
      )}

      {/* Server-generated caveat; stays in English like other warehouse prose. */}
      {summary?.hitRateNote && (
        <div className="console-callout"><p>{summary.hitRateNote}</p></div>
      )}

      {!initiatives.length ? (
        <EmptyState title={t('initiatives.nothingTrackedTitle')} text={t('initiatives.nothingTrackedBody')} />
      ) : (
        <div className="rec-list">
          {initiatives.map((initiative) => (
            <article key={initiative.id} className="rec-card">
              <header>
                <span className={`rec-status rec-status-${initiative.status}`}>
                  {t(`status.${initiative.status}`)}
                </span>
                {/* The recommendation's own text — written by the analysts. */}
                <h4>{initiative.recommendation.title}</h4>
              </header>

              <dl className="rec-detail">
                <dt>{t('rec.why')}</dt><dd>{initiative.recommendation.reasoning}</dd>
                <dt>{t('initiatives.proposedBy')}</dt>
                <dd>
                  {t('initiatives.proposedByLine', {
                    at: formatDate(initiative.createdAt, lang),
                    who: initiative.sourceRole ? t(`roles.${initiative.sourceRole}`) : t('initiatives.you'),
                  })}
                </dd>
                {initiative.baseline && (
                  <>
                    <dt>{t('initiatives.baselineAtAccept')}</dt>
                    <dd>
                      {t('initiatives.baselineLine', {
                        visitors: initiative.baseline.totalVisitors,
                        at: formatDate(initiative.baseline.at, lang),
                      })}
                    </dd>
                  </>
                )}
                {initiative.outcome && (
                  <>
                    <dt>{t('initiatives.outcome')}</dt>
                    <dd>
                      <strong>{t(`outcomes.${initiative.outcome}`)}</strong>
                      {initiative.outcomeNote ? ` — ${initiative.outcomeNote}` : ''}
                    </dd>
                  </>
                )}
              </dl>

              {measuring === initiative.id ? (
                <div className="rec-measure">
                  <textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder={t('initiatives.measurePlaceholder')}
                    rows={3}
                  />
                  <div className="rec-actions">
                    {OUTCOMES.map((value) => (
                      <button
                        key={value}
                        type="button"
                        className="ghost-button"
                        disabled={busy === initiative.id}
                        onClick={() => move(initiative.id, 'measured', value)}
                      >
                        {t(`outcomes.${value}`)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rec-actions">
                  {NEXT_STATUS[initiative.status].map(([status, actionKey]) => (
                    <button
                      key={status}
                      type="button"
                      className="ghost-button"
                      disabled={busy === initiative.id}
                      onClick={() => (status === 'measured'
                        ? setMeasuring(initiative.id)
                        : move(initiative.id, status))}
                    >
                      {t(`actions.${actionKey}`)}
                    </button>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </>
  );
}
