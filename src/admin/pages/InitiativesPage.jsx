import React, { useState } from 'react';
import { ListChecks } from 'lucide-react';

import { SectionTitle, EmptyState, StatCard } from '../ui/primitives.jsx';
import { useAdminResource, formatDate } from '../lib/useGrowthData.js';
import { adminFetch } from '../lib/adminSession.js';

// Mirrors the server's state machine (_growthInitiatives.mjs). The server is
// authoritative and rejects illegal moves; this only decides which buttons to
// draw, so an out-of-date copy is a cosmetic bug, never a data-integrity one.
const NEXT_STATUS = {
  proposed: [['accepted', 'Accept'], ['rejected', 'Reject']],
  accepted: [['shipped', 'Mark shipped'], ['rejected', 'Drop']],
  shipped: [['measured', 'Record outcome']],
  measured: [],
  rejected: [],
};

const OUTCOMES = [
  ['worked', 'It worked'],
  ['no_effect', 'No effect'],
  ['inconclusive', 'Inconclusive'],
  ['backfired', 'It backfired'],
];

export default function InitiativesPage({ token }) {
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

  if (state.status === 'loading') return <SectionTitle icon={ListChecks} eyebrow="Growth OS" title="Loading initiatives…" />;
  if (state.status === 'error') return <EmptyState title="Could not load" text={state.message} />;

  const { initiatives = [], summary } = data || {};

  return (
    <>
      <SectionTitle icon={ListChecks} eyebrow="Growth OS" title="Initiatives" />
      <p className="console-page-intro">
        This is what makes the system an executive team rather than an idea generator: every
        recommendation you accept is tracked through to a measured outcome, so the team learns
        whether its own advice was any good.
      </p>

      <div className="console-callout">
        <strong>Accepting an initiative snapshots your current metrics.</strong>
        <p>
          That baseline is captured at accept time and can never be reconstructed afterwards — it is
          the only thing that makes “did this work?” answerable later, once the metric has moved for
          a dozen unrelated reasons.
        </p>
      </div>

      {summary && (
        <div className="analytics-stat-grid">
          <StatCard label="Tracked" value={summary.total} />
          <StatCard label="In flight" value={summary.byStatus.accepted + summary.byStatus.shipped} />
          <StatCard label="Measured" value={summary.measuredCount} />
          <StatCard
            label="Hit rate"
            value={summary.hitRate === null ? '—' : `${Math.round(summary.hitRate * 100)}%`}
            sublabel={summary.hitRate === null ? 'nothing measured yet' : 'of measured initiatives'}
          />
        </div>
      )}

      {summary?.hitRateNote && (
        <div className="console-callout"><p>{summary.hitRateNote}</p></div>
      )}

      {!initiatives.length ? (
        <EmptyState
          title="Nothing tracked yet"
          text="Accept a recommendation from the Executive Brief or Content Engine to start tracking it here."
        />
      ) : (
        <div className="rec-list">
          {initiatives.map((initiative) => (
            <article key={initiative.id} className="rec-card">
              <header>
                <span className={`rec-status rec-status-${initiative.status}`}>{initiative.status}</span>
                <h4>{initiative.recommendation.title}</h4>
              </header>

              <dl className="rec-detail">
                <dt>Why</dt><dd>{initiative.recommendation.reasoning}</dd>
                <dt>Proposed</dt><dd>{formatDate(initiative.createdAt)} by {initiative.sourceRole || 'you'}</dd>
                {initiative.baseline && (
                  <>
                    <dt>Baseline at accept</dt>
                    <dd>
                      {initiative.baseline.totalVisitors} visitors · captured {formatDate(initiative.baseline.at)}
                    </dd>
                  </>
                )}
                {initiative.outcome && (
                  <>
                    <dt>Outcome</dt>
                    <dd>
                      <strong>{initiative.outcome.replace('_', ' ')}</strong>
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
                    placeholder="What actually happened? Be honest — 'inconclusive' is usually the correct answer at this scale, and recording it as a win teaches the system the wrong lesson."
                    rows={3}
                  />
                  <div className="rec-actions">
                    {OUTCOMES.map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        className="ghost-button"
                        disabled={busy === initiative.id}
                        onClick={() => move(initiative.id, 'measured', value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rec-actions">
                  {NEXT_STATUS[initiative.status].map(([status, label]) => (
                    <button
                      key={status}
                      type="button"
                      className="ghost-button"
                      disabled={busy === initiative.id}
                      onClick={() => (status === 'measured'
                        ? setMeasuring(initiative.id)
                        : move(initiative.id, status))}
                    >
                      {label}
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
