// Two Admin Panel pages: Paid Verification and Jobs & Delivery.
//
// ── WHY THEY ARE HERE AND NOT IN /console ───────────────────────────────────
//
// Both screens started life in the private operator console at /console. They
// are moved because /console is a STRATEGY surface — funnels, cohorts, the
// weekly AI brief, read and acted on once a week — while refunding a duplicate
// sale and requeueing a dead letter are OPERATIONS, done the moment something
// breaks, beside the ownership review queue and the Premium management screen
// that already live in the Admin Panel. Splitting the operator's daily work
// across two applications with two sign-ins was the actual defect.
//
// They could not simply be imported across: scripts/verify-boundary.mjs fails
// the build if anything reachable from src/main.jsx touches src/admin/, because
// one stray import hoists console code into the bundle every visitor downloads.
// So these are native Admin Panel pages calling the SAME endpoints through
// src/verificationOps.js — no server change, and no second copy of any rule.
//
// ── AUTHORIZATION ───────────────────────────────────────────────────────────
//
// Identical to every other admin-* page: the shared KHAN_ADMIN_PASSCODE, the
// token in sessionStorage (verification.js), and the server verifying it on
// every call. There is no client-side-only gate here — rendering is gated so an
// operator sees a login form instead of an empty screen, but the data is
// withheld by the endpoints, which answer 401 to anyone without a token.
//
// ── NO DEV FALLBACK ─────────────────────────────────────────────────────────
//
// These screens report revenue, refunds and whether a queue is losing work. A
// fabricated answer to "is the outbox draining?" is worse than an error, so a
// failed call renders the failure. Same rule as src/verificationOps.js.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowRight, BadgeCheck, BarChart3, Crown, Database,
  Layers3, ListFilter, Lock, RefreshCw, Shield,
} from 'lucide-react';

import { useTranslation } from './i18n/I18nContext.jsx';
import { adminLogin, getStoredAdminToken, clearAdminToken } from './verification.js';
import {
  fetchVerificationOrders,
  fetchVerificationFunnel,
  submitVerificationOrderAction,
  fetchQueueState,
  requeueDeadLetterJob,
} from './verificationOps.js';
import {
  SectionTitle, EmptyState, FormField, StatCard, RankTable,
} from './ui/adminPrimitives.jsx';

// An absent measurement, not zero. 0/0 conversion and a missing expiry date are
// both "we did not measure this", and rendering either as 0 would show a red
// failure where there is no observation at all. Not translated: an em dash
// reads the same in every language this product ships.
const NOT_MEASURED = '—';

const FUNNEL_WINDOWS = [7, 30, 90];

// Two different shortenings, because ids and prose fail differently. The full
// value is always in the cell's `title`, so nothing is hidden — only wrapped.

// An order id or a contract address: BOTH ends carry meaning (the tail is what
// an operator compares against an explorer), so the middle goes.
function shortId(value) {
  const clean = String(value || '');
  return clean.length <= 14 ? clean : `${clean.slice(0, 6)}…${clean.slice(-4)}`;
}

// An error message: it reads left to right and the front is the informative
// part, so the tail goes. Middle-eliding a stack trace would cut out the one
// sentence that says what failed.
function truncate(value, max) {
  const clean = String(value || '');
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

function money(value) {
  return `$${Number(value || 0).toLocaleString('en-US')}`;
}

// ── The shared admin shell ──────────────────────────────────────────────────
//
// The passcode form, the token lifecycle and the cross-link toolbar are the
// same on both pages and on every other admin-* screen. Written once here so
// the two new pages cannot drift from each other, and so signing out of one
// signs out of all of them (one shared sessionStorage token).
function useAdminToken() {
  const [token, setToken] = useState(() => getStoredAdminToken());
  const signOut = useCallback(() => {
    clearAdminToken();
    setToken('');
  }, []);
  return { token, setToken, signOut };
}

function AdminLoginGate({ icon, title, onAuthenticated }) {
  const { t } = useTranslation();
  const [passcode, setPasscode] = useState('');
  const [authState, setAuthState] = useState({ status: 'idle', message: '' });

  const login = async (event) => {
    event.preventDefault();
    setAuthState({ status: 'loading', message: t('adminVerify.checkingPasscode') });
    try {
      onAuthenticated(await adminLogin(passcode));
      setAuthState({ status: 'idle', message: '' });
    } catch (error) {
      setAuthState({ status: 'error', message: error.message || t('adminVerify.loginFailed') });
    }
  };

  return (
    <section className="page-section">
      <SectionTitle icon={icon} eyebrow={t('adminVerify.eyebrow')} title={title} />
      <form className="add-form admin-login-form" onSubmit={login}>
        <FormField label={t('adminVerify.passcodeLabel')} type="password" value={passcode} onChange={setPasscode} required />
        <button className="primary-button wide-button" type="submit" disabled={authState.status === 'loading'}>
          {t('common.signIn')} <ArrowRight size={18} />
        </button>
        {authState.message && (
          <p className={authState.status === 'error' ? 'lookup-message error' : 'lookup-message'}>{authState.message}</p>
        )}
      </form>
    </section>
  );
}

// Navigation between admin screens. The Admin Panel has no sidebar of its own —
// every admin page carries this toolbar, and that IS the panel's navigation, so
// the two new pages appear in it exactly like the existing ones.
function goto(route) {
  window.location.hash = `/${route}`;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

function AdminCallout({ tone = 'warn', icon: Icon, title, children }) {
  return (
    <div className={`admin-callout${tone === 'bad' ? ' danger' : ''}`}>
      <Icon size={16} aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
    </div>
  );
}

// ── Paid Verification ───────────────────────────────────────────────────────
//
// The commercial view of verification: what sold, what is live, what expires
// soon, and the three operator actions that change a paying customer's product.
//
// Deliberately SEPARATE from the ownership review queue at #/admin-verify.
// Those are two jobs done at two different times: reviewing a pending ownership
// proof is a daily five-item task; auditing what was sold is a periodic one over
// the whole history. Merging them would make the review screen load every
// historical order to render five rows.
export function AdminPaidVerificationPage() {
  const { t, language } = useTranslation();
  const { token, setToken, signOut } = useAdminToken();
  const [days, setDays] = useState(30);
  const [statusFilter, setStatusFilter] = useState('all');
  const [orders, setOrders] = useState(null);
  const [funnel, setFunnel] = useState(null);
  const [state, setState] = useState({ status: 'idle', message: '' });
  const [busy, setBusy] = useState('');

  const load = useCallback(async (activeToken) => {
    if (!activeToken) return;
    setState({ status: 'loading', message: t('adminPaidVerification.loading') });
    try {
      // Both at once. Sequential would leave the operator on a half-rendered
      // screen for as long as the slower of the two takes.
      const [ordersData, funnelData] = await Promise.all([
        fetchVerificationOrders(activeToken, statusFilter),
        fetchVerificationFunnel(activeToken, days),
      ]);
      setOrders(ordersData);
      setFunnel(funnelData);
      setState({ status: 'idle', message: '' });
    } catch (error) {
      setState({ status: 'error', message: error.message || t('adminPaidVerification.loadFailed') });
    }
  }, [days, statusFilter, t]);

  useEffect(() => { load(token); }, [token, load]);

  // All three actions echo the order id back as `confirm`, which is what the
  // endpoint requires. The confirm() dialog is the operator-facing half of the
  // same guard — a mis-click on a dense table row must not be able to revoke a
  // live customer's badge.
  const act = useCallback(async (order, action) => {
    const label = t(`adminPaidVerification.actions.${action}`);
    if (!window.confirm(t('adminPaidVerification.confirmAction', { action: label, id: order.id }))) return;
    const reason = window.prompt(t('adminPaidVerification.reasonPrompt')) || '';
    setBusy(order.id);
    try {
      await submitVerificationOrderAction(token, { orderId: order.id, action, reason, confirm: order.id });
      await load(token);
    } catch (error) {
      setState({ status: 'error', message: error.message || t('adminPaidVerification.actionFailed') });
    } finally {
      setBusy('');
    }
  }, [token, load, t]);

  const orderRows = useMemo(() => (orders?.orders || []).map((order) => ([
    <span title={order.id}>{shortId(order.id)}</span>,
    <span title={`${order.contract} (${order.chain})`}>
      {shortId(order.contract)}<br /><small className="muted-cell">{order.chain}</small>
    </span>,
    `${order.tier} · ${money(order.usd)}`,
    <span className={order.status === 'active' ? 'status-badge verified' : 'status-badge'}>
      {t(`adminPaidVerification.status.${order.status}`)}
    </span>,
    order.expiresAt
      ? (
        <span title={order.expiresAt}>
          {order.expiresAt.slice(0, 10)}
          {order.daysToExpiry != null && order.daysToExpiry >= 0 && (
            <><br /><small className="muted-cell">{t('adminPaidVerification.daysLeft', { days: order.daysToExpiry })}</small></>
          )}
        </span>
      )
      : NOT_MEASURED,
    <span className="row-actions">
      <button type="button" className="filter-chip" disabled={busy === order.id} onClick={() => act(order, 'resend_receipt')}>
        {t('adminPaidVerification.actions.resend_receipt')}
      </button>
      {order.status === 'active' && (
        <button type="button" className="filter-chip" disabled={busy === order.id} onClick={() => act(order, 'revoke')}>
          {t('adminPaidVerification.actions.revoke')}
        </button>
      )}
      {order.paymentSignature && order.status !== 'refunded' && (
        <button type="button" className="filter-chip" disabled={busy === order.id} onClick={() => act(order, 'mark_refunded')}>
          {t('adminPaidVerification.actions.mark_refunded')}
        </button>
      )}
    </span>,
  ])), [orders, busy, act, t]);

  if (!token) {
    return <AdminLoginGate icon={Lock} title={t('adminPaidVerification.title')} onAuthenticated={setToken} />;
  }

  const counts = orders?.counts || {};
  const f = funnel?.funnel || {};
  // From the endpoint's own status vocabulary, not from whatever happens to be
  // present today, so a status with zero orders still offers its (empty) filter
  // instead of silently vanishing.
  const statuses = orders?.statuses || [];

  return (
    <section className="page-section analytics-dashboard">
      <SectionTitle icon={BadgeCheck} eyebrow={t('adminVerify.eyebrow')} title={t('adminPaidVerification.title')} />
      <div className="analytics-toolbar">
        <button className="secondary-button" type="button" onClick={() => load(token)}>
          <RefreshCw size={16} /> {t('common.refresh')}
        </button>
        <button className="secondary-button admin-cross-link" type="button" onClick={() => goto('admin-jobs')}>
          <Layers3 size={16} /> {t('adminJobs.title')}
        </button>
        <button className="secondary-button admin-cross-link" type="button" onClick={() => goto('admin-verify')}>
          <Shield size={16} /> {t('adminAnalytics.verificationReview')}
        </button>
        <button className="secondary-button admin-cross-link" type="button" onClick={() => goto('admin-analytics')}>
          <BarChart3 size={16} /> {t('adminAnalytics.title')}
        </button>
        <button className="secondary-button admin-cross-link" type="button" onClick={() => goto('admin-premium')}>
          <Crown size={16} /> {t('adminPremium.title')}
        </button>
        <button className="ghost-button" type="button" onClick={signOut}>{t('common.signOut')}</button>
      </div>
      <p className="inline-note">{t('adminPaidVerification.intro')}</p>

      {/* Only over data that is already on screen — a failed REFRESH. With
          nothing loaded the same message is the empty state at the bottom, and
          printing it twice reads like two separate failures. */}
      {state.status === 'error' && orders && funnel && <p className="lookup-message error">{state.message}</p>}
      {state.status === 'loading' && <p className="lookup-message">{state.message}</p>}

      {/* The screen keeps rendering the last good data while a refresh is in
          flight. A blank page on every poll is worse than slightly stale
          numbers, and the loading line above says which one you are looking at. */}
      {orders && funnel && (
        <>
          <div className="analytics-stat-grid">
            <StatCard icon={BadgeCheck} label={t('adminPaidVerification.stats.active')} numericValue={counts.active || 0} />
            <StatCard icon={AlertTriangle} label={t('adminPaidVerification.stats.expiringSoon')} numericValue={orders.expiringSoon || 0} />
            <StatCard icon={ListFilter} label={t('adminPaidVerification.stats.expired')} numericValue={counts.expired || 0} />
            <StatCard icon={Shield} label={t('adminPaidVerification.stats.revoked')} numericValue={counts.revoked || 0} />
            <StatCard
              icon={Crown}
              label={t('adminPaidVerification.stats.paid')}
              numericValue={counts.paid || 0}
              sublabel={t('adminPaidVerification.stats.awaitingReview')}
            />
            <StatCard icon={RefreshCw} label={t('adminPaidVerification.stats.refunded')} numericValue={counts.refunded || 0} />
            <StatCard icon={BarChart3} label={t('adminPaidVerification.stats.revenue')} value={money(orders.revenue)} />
          </div>

          {/* A duplicate sale is money taken for something that cannot be
              delivered. It sits above everything else because until a human
              refunds it, a real customer is out of pocket and nothing else on
              this page is more urgent. */}
          {counts.duplicate > 0 && (
            <AdminCallout tone="bad" icon={AlertTriangle} title={t('adminPaidVerification.duplicateTitle')}>
              {t('adminPaidVerification.duplicateBody', { count: counts.duplicate })}
            </AdminCallout>
          )}

          <h3 className="admin-section-heading">{t('adminPaidVerification.funnelTitle')}</h3>
          <div className="admin-filter-row">
            {FUNNEL_WINDOWS.map((option) => (
              <button
                key={option}
                type="button"
                className={option === days ? 'filter-chip active' : 'filter-chip'}
                aria-pressed={option === days}
                onClick={() => setDays(option)}
              >
                {t('adminPaidVerification.windowDays', { days: option })}
              </button>
            ))}
          </div>

          <div className="analytics-stat-grid">
            <StatCard icon={BarChart3} label={t('adminPaidVerification.funnel.quotes')} numericValue={f.quotes || 0} />
            <StatCard icon={BarChart3} label={t('adminPaidVerification.funnel.orders')} numericValue={f.orders || 0} />
            <StatCard icon={BarChart3} label={t('adminPaidVerification.funnel.payments')} numericValue={f.paymentsConfirmed || 0} />
            <StatCard icon={Shield} label={t('adminPaidVerification.funnel.ownership')} numericValue={f.ownershipCompleted || 0} />
            <StatCard icon={BadgeCheck} label={t('adminPaidVerification.funnel.activations')} numericValue={f.activations || 0} />
            {/* null, not 0%. With no quotes in the window this is 0/0 — an
                absent measurement, not a conversion rate of zero. Rendering it
                as 0% would show a failure on a quiet week. */}
            <StatCard
              icon={BarChart3}
              label={t('adminPaidVerification.funnel.conversion')}
              value={f.conversionRate == null ? NOT_MEASURED : `${(f.conversionRate * 100).toFixed(1)}%`}
            />
            <StatCard icon={BarChart3} label={t('adminPaidVerification.funnel.profileViews')} numericValue={f.profileViews || 0} />
            <StatCard icon={BadgeCheck} label={t('adminPaidVerification.funnel.badgeImpressions')} numericValue={f.badgeImpressions || 0} />
            <StatCard icon={Lock} label={t('adminPaidVerification.funnel.paywallHits')} numericValue={f.paywallHits || 0} />
            <StatCard icon={Crown} label={t('adminPaidVerification.funnel.upgradeClicks')} numericValue={f.upgradeClicks || 0} />
            <StatCard icon={BarChart3} label={t('adminPaidVerification.funnel.scansStarted')} numericValue={f.scansStarted || 0} />
            <StatCard icon={BarChart3} label={t('adminPaidVerification.funnel.scansCompleted')} numericValue={f.scansCompleted || 0} />
            <StatCard icon={AlertTriangle} label={t('adminPaidVerification.funnel.scansFailed')} numericValue={f.scansFailed || 0} />
          </div>

          <RankTable
            title={t('adminPaidVerification.revenueByTier')}
            columns={[t('adminPaidVerification.colTier'), t('adminPaidVerification.colRevenue')]}
            rows={Object.entries(f.revenueByTier || {}).map(([tier, usd]) => [tier, money(usd)])}
            emptyText={t('adminPaidVerification.noRevenue')}
          />

          <h3 className="admin-section-heading">{t('adminPaidVerification.ordersTitle')}</h3>
          <div className="admin-filter-row">
            <button
              type="button"
              className={statusFilter === 'all' ? 'filter-chip active' : 'filter-chip'}
              aria-pressed={statusFilter === 'all'}
              onClick={() => setStatusFilter('all')}
            >
              {t('adminPaidVerification.filterAll', { count: orders.total || 0 })}
            </button>
            {statuses.map((status) => (
              <button
                key={status}
                type="button"
                className={statusFilter === status ? 'filter-chip active' : 'filter-chip'}
                aria-pressed={statusFilter === status}
                onClick={() => setStatusFilter(status)}
              >
                {t(`adminPaidVerification.status.${status}`)} {counts[status] || 0}
              </button>
            ))}
          </div>

          <RankTable
            wide
            title={t('adminPaidVerification.ordersTitle')}
            columns={[
              t('adminPaidVerification.colOrder'),
              t('adminPaidVerification.colToken'),
              t('adminPaidVerification.colTier'),
              t('adminPaidVerification.colStatus'),
              t('adminPaidVerification.colExpiry'),
              t('adminPaidVerification.colActions'),
            ]}
            rows={orderRows}
            emptyText={statusFilter === 'all' ? t('adminPaidVerification.noOrders') : t('adminPaidVerification.noOrdersForStatus')}
          />

          <p className="inline-note">
            {t('adminPaidVerification.eventNote', { count: (funnel.eventCount || 0).toLocaleString(language === 'en' ? 'en-US' : language) })}
          </p>
        </>
      )}

      {/* Only when the very first load failed and there is nothing to show. A
          failed refresh keeps the previous data on screen with the error line
          above it, which is more useful than an empty page. */}
      {!(orders && funnel) && state.status === 'error' && (
        <EmptyState title={t('adminPaidVerification.loadFailed')} text={state.message} />
      )}
    </section>
  );
}

// ── Jobs & Delivery ─────────────────────────────────────────────────────────
//
// The durable outbox, seen from the outside: what is waiting, what is retrying,
// what died, why, and one button to put a dead letter back.
//
// A queue with retries but no visible shelf is worse than no queue at all: it
// converts a loud failure (the email threw, somebody noticed) into a silent one
// (it retried five times over half an hour and then stopped existing). Receipts
// and expiry notices go through the outbox precisely because they must not be
// lost — and "not lost" only means something if a human can see what is stuck.
export function AdminJobsPage() {
  const { t } = useTranslation();
  const { token, setToken, signOut } = useAdminToken();
  const [data, setData] = useState(null);
  const [state, setState] = useState({ status: 'idle', message: '' });
  const [busy, setBusy] = useState('');

  const load = useCallback(async (activeToken) => {
    if (!activeToken) return;
    setState({ status: 'loading', message: t('adminJobs.loading') });
    try {
      setData(await fetchQueueState(activeToken));
      setState({ status: 'idle', message: '' });
    } catch (error) {
      setState({ status: 'error', message: error.message || t('adminJobs.loadFailed') });
    }
  }, [t]);

  useEffect(() => { load(token); }, [token, load]);

  // Requeue is NOT destructive — it creates work, it does not destroy any — so
  // it needs no confirmation. It is also idempotent by construction: a dead
  // letter already requeued is off the shelf, so a second click answers 404
  // rather than creating a second copy of the job.
  const requeue = useCallback(async (id) => {
    setBusy(id);
    try {
      await requeueDeadLetterJob(token, id);
      await load(token);
    } catch (error) {
      setState({ status: 'error', message: error.message || t('adminJobs.requeueFailed') });
    } finally {
      setBusy('');
    }
  }, [token, load, t]);

  if (!token) {
    return <AdminLoginGate icon={Lock} title={t('adminJobs.title')} onAuthenticated={setToken} />;
  }

  const counts = data?.counts || {};
  const db = data?.database || {};

  return (
    <section className="page-section analytics-dashboard">
      <SectionTitle icon={Layers3} eyebrow={t('adminVerify.eyebrow')} title={t('adminJobs.title')} />
      <div className="analytics-toolbar">
        <button className="secondary-button" type="button" onClick={() => load(token)}>
          <RefreshCw size={16} /> {t('common.refresh')}
        </button>
        <button className="secondary-button admin-cross-link" type="button" onClick={() => goto('admin-paid-verification')}>
          <BadgeCheck size={16} /> {t('adminPaidVerification.title')}
        </button>
        <button className="secondary-button admin-cross-link" type="button" onClick={() => goto('admin-analytics')}>
          <BarChart3 size={16} /> {t('adminAnalytics.title')}
        </button>
        <button className="ghost-button" type="button" onClick={signOut}>{t('common.signOut')}</button>
      </div>
      <p className="inline-note">{t('adminJobs.intro')}</p>

      {/* Only over data that is already on screen — see the same note on the
          Paid Verification page above. */}
      {state.status === 'error' && data && <p className="lookup-message error">{state.message}</p>}
      {state.status === 'loading' && <p className="lookup-message">{state.message}</p>}

      {data && (
        <>
          {/* WHICH DATABASE, AND DID THE MIGRATION LAND IN IT.
              Netlify Managed Database never reveals its production connection
              string, so migrations are applied by the deploy rather than by
              hand — and if DATABASE_URL points at a different Postgres than the
              one the deploy migrates, everything reports success while the
              app's database stays empty. This block is the only place that
              failure is visible. */}
          {db.configured === false && (
            <AdminCallout icon={Database} title={t('adminJobs.db.notConfigured')}>
              {t('adminJobs.db.notConfiguredBody')}
            </AdminCallout>
          )}
          {db.configured && db.reachable === false && (
            <AdminCallout tone="bad" icon={AlertTriangle} title={t('adminJobs.db.unreachable')}>
              {t('adminJobs.db.unreachableBody')}
            </AdminCallout>
          )}
          {db.reachable && (
            <>
              {!db.migrationsApplied && (
                <AdminCallout tone="bad" icon={AlertTriangle} title={t('adminJobs.db.notMigrated')}>
                  {t('adminJobs.db.notMigratedBody', { missing: (db.missing || []).join(', ') })}
                </AdminCallout>
              )}
              <RankTable
                title={t('adminJobs.db.title')}
                columns={[t('adminJobs.db.colFact'), t('adminJobs.db.colValue')]}
                rows={[
                  [t('adminJobs.db.host'), db.host || NOT_MEASURED],
                  [t('adminJobs.db.name'), db.database || NOT_MEASURED],
                  [t('adminJobs.db.migrated'), db.migrationsApplied ? t('common.yes') : t('common.no')],
                  [t('adminJobs.db.lease'), db.leaseEnforcedByPostgres ? t('adminJobs.db.leasePostgres') : t('adminJobs.db.leaseBlobs')],
                ]}
                emptyText={t('adminJobs.db.noHealth')}
              />
            </>
          )}

          <div className="analytics-stat-grid">
            <StatCard icon={Layers3} label={t('adminJobs.stats.pending')} numericValue={counts.pending || 0} />
            <StatCard icon={ArrowRight} label={t('adminJobs.stats.dueNow')} numericValue={data.dueNow || 0} />
            <StatCard icon={RefreshCw} label={t('adminJobs.stats.processing')} numericValue={counts.processing || 0} />
            <StatCard icon={AlertTriangle} label={t('adminJobs.stats.failed')} numericValue={counts.failed || 0} />
            <StatCard icon={AlertTriangle} label={t('adminJobs.stats.deadLetter')} numericValue={counts.dead_letter || 0} />
          </div>

          {counts.dead_letter > 0 && (
            <AdminCallout tone="bad" icon={AlertTriangle} title={t('adminJobs.deadTitle')}>
              {t('adminJobs.deadBody', { count: counts.dead_letter })}
            </AdminCallout>
          )}

          <RankTable
            wide
            title={t('adminJobs.deadTitle')}
            columns={[
              t('adminJobs.colType'),
              t('adminJobs.colAttempts'),
              t('adminJobs.colError'),
              t('adminJobs.colUpdated'),
              t('adminJobs.colActions'),
            ]}
            rows={(data.deadLetters || []).map((job) => ([
              <span title={job.id}>{job.type}</span>,
              job.attempts,
              // Shown in full in the title attribute and truncated in the cell.
              // It is already capped at 500 characters where it is STORED, so
              // there is no unbounded string reaching this screen.
              <span title={job.lastError}>{truncate(job.lastError, 60)}</span>,
              String(job.updatedAt || '').slice(0, 16).replace('T', ' '),
              <button type="button" className="filter-chip" disabled={busy === job.id} onClick={() => requeue(job.id)}>
                {t('adminJobs.requeue')}
              </button>,
            ]))}
            emptyText={t('adminJobs.noDead')}
          />

          <RankTable
            wide
            title={t('adminJobs.liveTitle')}
            columns={[
              t('adminJobs.colType'),
              t('adminJobs.colStatus'),
              t('adminJobs.colAttempts'),
              t('adminJobs.colDue'),
              t('adminJobs.colError'),
            ]}
            rows={(data.jobs || []).map((job) => ([
              <span title={job.id}>{job.type}</span>,
              t(`adminJobs.status.${job.status}`),
              job.attempts,
              // "Waiting on backoff" and "stuck" look identical without this: a
              // queue full of jobs correctly sleeping for two minutes reads
              // exactly like a queue that has stopped draining.
              job.due ? t('adminJobs.dueNow') : String(job.runAfter || '').slice(11, 16),
              <span title={job.lastError}>{truncate(job.lastError, 48)}</span>,
            ]))}
            emptyText={t('adminJobs.noJobs')}
          />

          <p className="inline-note">{t('adminJobs.workerNote')}</p>
        </>
      )}

      {/* Only when the very first load failed and there is nothing to show. A
          failed refresh keeps the previous data on screen with the error line
          above it, which is more useful than an empty page. */}
      {!data && state.status === 'error' && (
        <EmptyState title={t('adminJobs.loadFailed')} text={state.message} />
      )}
    </section>
  );
}
