// The durable outbox, seen from the outside: what is waiting, what is retrying,
// what died, why, and one button to put a dead letter back.
//
// ── WHY A DEAD-LETTER SCREEN IS NOT OPTIONAL ────────────────────────────────
//
// A queue with retries but no visible shelf is worse than no queue at all: it
// converts a loud failure (the email threw, somebody noticed) into a silent one
// (the email retried five times over half an hour and then stopped existing).
// The whole reason receipts and expiry notices go through the outbox is that
// they must not be lost — and "not lost" only means something if a human can see
// what is stuck and act on it.
import React, { useCallback, useEffect, useState } from 'react';
import { ListChecks, AlertTriangle } from 'lucide-react';

import { SectionTitle, EmptyState, StatCard, DataTable } from '../ui/primitives.jsx';
import { useT } from '../i18n/ConsoleI18nProvider.jsx';
import { adminFetch } from '../lib/adminSession.js';

function short(value, max = 22) {
  const clean = String(value || '');
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

export default function QueuePage({ token }) {
  const { t } = useT();
  const [data, setData] = useState(null);
  const [state, setState] = useState({ status: 'loading', message: '' });
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setState({ status: 'loading', message: '' });
    try {
      setData(await adminFetch('queue-admin', { token }));
      setState({ status: 'ready', message: '' });
    } catch (error) {
      setState({ status: 'error', message: error.message });
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // Requeue is NOT destructive — it creates work, it does not destroy any — so
  // it needs no confirmation. It is also idempotent by construction: a dead
  // letter that has already been requeued is off the shelf, so a second click
  // gets a 404 rather than a second copy of the job.
  const requeue = useCallback(async (id) => {
    setBusy(id);
    try {
      await adminFetch('queue-admin', { token, method: 'POST', body: { action: 'requeue', id } });
      await load();
    } catch (error) {
      setState({ status: 'error', message: error.message });
    } finally {
      setBusy('');
    }
  }, [token, load]);

  if (state.status === 'loading') {
    return <SectionTitle icon={ListChecks} eyebrow={t('common.eyebrow')} title={t('common.loading')} />;
  }
  if (state.status === 'error') {
    return <EmptyState title={t('common.couldNotLoad')} text={state.message} />;
  }
  if (!data) return null;

  const counts = data.counts || {};

  return (
    <>
      <SectionTitle icon={ListChecks} eyebrow={t('common.eyebrow')} title={t('queue.title')} />
      <p className="console-page-intro">{t('queue.intro')}</p>

      <div className="analytics-stat-grid">
        <StatCard label={t('queue.stats.pending')} value={counts.pending || 0} />
        <StatCard label={t('queue.stats.dueNow')} value={data.dueNow || 0} />
        <StatCard label={t('queue.stats.processing')} value={counts.processing || 0} />
        <StatCard label={t('queue.stats.failed')} value={counts.failed || 0} tone={counts.failed ? 'warn' : undefined} />
        <StatCard label={t('queue.stats.deadLetter')} value={counts.dead_letter || 0} tone={counts.dead_letter ? 'bad' : undefined} />
      </div>

      {counts.dead_letter > 0 && (
        <div className="console-callout">
          <strong><AlertTriangle size={15} /> {t('queue.deadTitle')}</strong>
          <p>{t('queue.deadBody', { count: counts.dead_letter })}</p>
        </div>
      )}

      <h4 className="console-h4">{t('queue.deadTitle')}</h4>
      <DataTable
        columns={[t('queue.colType'), t('queue.colAttempts'), t('queue.colError'), t('queue.colUpdated'), t('queue.colActions')]}
        rows={(data.deadLetters || []).map((job) => ([
          <span title={job.id}>{job.type}</span>,
          job.attempts,
          // The error is shown in full in the title attribute and truncated in
          // the cell. It is already capped at 500 characters where it is STORED,
          // so there is no unbounded string to leak into this screen.
          <span title={job.lastError}>{short(job.lastError, 60)}</span>,
          String(job.updatedAt || '').slice(0, 16).replace('T', ' '),
          <button type="button" className="range-button" disabled={busy === job.id} onClick={() => requeue(job.id)}>
            {t('queue.requeue')}
          </button>,
        ]))}
        emptyText={t('queue.noDead')}
      />

      <h4 className="console-h4">{t('queue.liveTitle')}</h4>
      <DataTable
        columns={[t('queue.colType'), t('queue.colStatus'), t('queue.colAttempts'), t('queue.colDue'), t('queue.colError')]}
        rows={(data.jobs || []).map((job) => ([
          <span title={job.id}>{job.type}</span>,
          t(`queue.status.${job.status}`),
          job.attempts,
          // "Waiting on backoff" and "stuck" look identical without this: a queue
          // full of jobs correctly sleeping for two minutes reads exactly like a
          // queue that has stopped draining.
          job.due ? t('queue.dueNow') : String(job.runAfter || '').slice(11, 16),
          <span title={job.lastError}>{short(job.lastError, 48)}</span>,
        ]))}
        emptyText={t('queue.noJobs')}
      />

      <p className="console-page-intro">{t('queue.workerNote')}</p>
    </>
  );
}
