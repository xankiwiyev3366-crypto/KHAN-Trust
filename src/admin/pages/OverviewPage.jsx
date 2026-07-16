import React, { useState } from 'react';
import { BrainCircuit, RefreshCw } from 'lucide-react';

import { SectionTitle, EmptyState, StatCard } from '../ui/primitives.jsx';
import { RecommendationCard, DataVerdict, FabricationNotice } from '../ui/RecommendationCard.jsx';
import { useT } from '../i18n/ConsoleI18nProvider.jsx';
import { useAdminResource, useWarehouse, formatUsd, formatDate } from '../lib/useGrowthData.js';
import { adminFetch } from '../lib/adminSession.js';
import { renderNote } from '../lib/reason.js';

// The analyst run is a BACKGROUND function: it answers 202 with an empty body
// immediately and keeps working for another 20-40s. It can never hand us the
// report, so the only way to observe the result is to poll growth-reports and
// watch for a report id we have not seen before.
const POLL_INTERVAL_MS = 4000;
const POLL_TIMEOUT_MS = 240000; // 4 min: past a slow run, far under the 15-min function limit.

export default function OverviewPage({ token }) {
  const { t, lang } = useT();
  const { data: warehouse } = useWarehouse(token, 30);
  const { data, state, reload } = useAdminResource('growth-reports', token);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');
  // The run takes 20-40s behind a 202, so without a progress line the button
  // just looks hung and the operator clicks it again — paying twice.
  const [progress, setProgress] = useState('');

  const runAnalysis = async () => {
    setRunning(true);
    setRunError('');
    setProgress(t('overview.progressStarting'));

    const idBefore = data?.report?.id || null;

    try {
      await adminFetch('growth-analyze-background', {
        token,
        method: 'POST',
        // The analysts write in whatever language the console is currently in,
        // so the brief matches the UI around it.
        body: { trigger: 'manual', language: lang },
      });

      setProgress(t('overview.progressWorking'));
      const startedAt = Date.now();

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
          setRunError(t('overview.pollTimeout'));
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

  if (state.status === 'loading') return <SectionTitle icon={BrainCircuit} eyebrow={t('common.eyebrow')} title={t('common.loading')} />;
  if (state.status === 'error') return <EmptyState title={t('common.couldNotLoad')} text={state.message} />;

  const report = data?.report;
  const brief = report?.brief;
  const budget = data?.budget;

  return (
    <>
      <SectionTitle icon={BrainCircuit} eyebrow={t('common.eyebrow')} title={t('overview.title')} />

      {/* The bill, shown before anything else. The operator approved AI on a
          strict budget; a budget you cannot see is not a budget. */}
      {budget && (
        <div className="analytics-stat-grid">
          <StatCard
            label={t('overview.aiSpend')}
            value={formatUsd(budget.spentUsd)}
            sublabel={t('overview.ofCap', { cap: formatUsd(budget.budgetUsd) })}
          />
          <StatCard
            label={t('overview.budgetUsed')}
            value={`${budget.percentUsed}%`}
            sublabel={t('overview.calls', { count: budget.calls })}
          />
          <StatCard
            label={t('overview.remaining')}
            value={formatUsd(budget.remainingUsd)}
            sublabel={t('overview.hardCap')}
          />
          {warehouse && (
            <StatCard
              label={t('overview.eventsRecorded')}
              value={warehouse.eventCount}
              sublabel={t('overview.lastDays', { days: warehouse.windowDays })}
            />
          )}
        </div>
      )}

      {!data?.aiConfigured && (
        <div className="console-callout">
          <strong>{t('overview.aiOffTitle')}</strong>
          <p>{t('overview.aiOffBody')}</p>
        </div>
      )}

      {warehouse?.dataHealth?.note && (
        <div className="console-callout">
          <strong>{t('overview.dataHealth')}</strong>
          <p>{renderNote(lang, warehouse.dataHealth)}</p>
        </div>
      )}

      <div className="console-actions">
        <button type="button" className="primary-button" onClick={runAnalysis} disabled={running || !data?.aiConfigured}>
          <RefreshCw size={15} /> {running ? t('overview.running') : t('overview.runNow')}
        </button>
        <span className="console-hint">{progress || t('overview.runHint')}</span>
      </div>
      {runError && <p className="lookup-message error">{runError}</p>}

      {!report ? (
        <EmptyState title={t('overview.noBriefTitle')} text={t('overview.noBriefBody')} />
      ) : (
        <>
          {/* A report's prose is immutable. If it was written in another
              language, say so plainly rather than showing English under an
              Azerbaijani UI and leaving the operator to wonder whether the
              switcher is broken. */}
          {report.language && report.language !== lang && (
            <div className="console-callout">
              <p>
                {t('overview.langMismatch', {
                  reportLang: t(`overview.lang${report.language === 'az' ? 'Az' : 'En'}`),
                  currentLang: t(`overview.lang${lang === 'az' ? 'Az' : 'En'}`),
                })}
              </p>
            </div>
          )}

          <p className="console-hint">
            {t('overview.generatedAt', {
              at: formatDate(report.generatedAt, lang),
              trigger: t(report.trigger === 'scheduled' ? 'overview.triggerScheduled' : 'overview.triggerManual'),
              days: report.windowDays,
            })}
          </p>

          {brief ? (
            <>
              {/* Everything below that is the model's own words — headline,
                  verdict, recommendations — is data and renders as written. */}
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
            <EmptyState title={t('overview.noSynthesisTitle')} text={t('overview.noSynthesisBody')} />
          )}

          <h4 className="console-h4">{t('overview.analystReports')}</h4>
          {report.analyses.map((analysis) => (
            <details key={analysis.role} className="console-details">
              <summary>
                <strong>{t(`roles.${analysis.role}`)}</strong> — {analysis.headline}
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
              <strong>{t('overview.someFailed')}</strong>
              <ul>
                {report.failures.map((failure, index) => <li key={index}>{failure.error}</li>)}
              </ul>
            </div>
          )}

          {report.factPack?.unknowns?.length > 0 && (
            <>
              <h4 className="console-h4">{t('overview.unknownsTitle')}</h4>
              <p className="console-page-intro">{t('overview.unknownsIntro')}</p>
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
