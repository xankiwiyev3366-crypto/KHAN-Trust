// The commercial view of paid verification: orders, verified projects, the
// revenue funnel, and the two operator actions that change a customer's product.
//
// Deliberately SEPARATE from the existing ownership review queue (which lives in
// the legacy in-app admin screens and reads verification-admin-list). Those are
// two different jobs done at two different times: reviewing a pending ownership
// proof is a daily five-item task, and auditing what was sold is a weekly one
// over the whole history. Merging them would make the review screen load every
// historical order to render five rows.
import React, { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, AlertTriangle } from 'lucide-react';

import { SectionTitle, EmptyState, StatCard, DataTable } from '../ui/primitives.jsx';
import { useT } from '../i18n/ConsoleI18nProvider.jsx';
import { adminFetch } from '../lib/adminSession.js';

const WINDOWS = [7, 30, 90];

// Short forms for a dense table. The full contract is in the row's link title,
// so nothing is hidden — only wrapped.
function short(value) {
  const clean = String(value || '');
  if (clean.length <= 14) return clean;
  return `${clean.slice(0, 6)}…${clean.slice(-4)}`;
}

function money(value) {
  return `$${Number(value || 0).toLocaleString('en-US')}`;
}

export default function VerificationPage({ token }) {
  const { t, lang } = useT();
  const [days, setDays] = useState(30);
  const [orders, setOrders] = useState(null);
  const [funnel, setFunnel] = useState(null);
  const [state, setState] = useState({ status: 'loading', message: '' });
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setState({ status: 'loading', message: '' });
    try {
      // Both at once. Sequential would show the operator a half-rendered screen
      // for as long as the slower of the two takes.
      const [ordersData, funnelData] = await Promise.all([
        adminFetch('verification-admin-orders?status=all', { token }),
        adminFetch(`verification-admin-funnel?days=${days}`, { token }),
      ]);
      setOrders(ordersData);
      setFunnel(funnelData);
      setState({ status: 'ready', message: '' });
    } catch (error) {
      setState({ status: 'error', message: error.message });
    }
  }, [token, days]);

  useEffect(() => { load(); }, [load]);

  // Both destructive actions echo the order id back as `confirm`, which is what
  // the endpoint requires. The confirm() dialog is the operator-facing half of
  // the same guard — a mis-click on a dense table row must not be able to revoke
  // a live customer's badge.
  const act = useCallback(async (order, action) => {
    const label = t(`verification.actions.${action}`);
    if (!window.confirm(t('verification.confirmAction', { action: label, id: order.id }))) return;
    const reason = window.prompt(t('verification.reasonPrompt')) || '';
    setBusy(order.id);
    try {
      await adminFetch('verification-admin-order-action', {
        token,
        method: 'POST',
        body: { orderId: order.id, action, reason, confirm: order.id },
      });
      await load();
    } catch (error) {
      setState({ status: 'error', message: error.message });
    } finally {
      setBusy('');
    }
  }, [token, load, t]);

  if (state.status === 'loading') {
    return <SectionTitle icon={BadgeCheck} eyebrow={t('common.eyebrow')} title={t('common.loading')} />;
  }
  if (state.status === 'error') {
    return <EmptyState title={t('common.couldNotLoad')} text={state.message} />;
  }
  if (!orders || !funnel) return null;

  const counts = orders.counts || {};
  const f = funnel.funnel || {};

  return (
    <>
      <SectionTitle icon={BadgeCheck} eyebrow={t('common.eyebrow')} title={t('verification.title')} />
      <p className="console-page-intro">{t('verification.intro')}</p>

      <div className="analytics-stat-grid">
        <StatCard label={t('verification.stats.active')} value={counts.active || 0} tone="good" />
        <StatCard label={t('verification.stats.expiringSoon')} value={orders.expiringSoon || 0} tone={orders.expiringSoon ? 'warn' : undefined} />
        <StatCard label={t('verification.stats.expired')} value={counts.expired || 0} />
        <StatCard label={t('verification.stats.revoked')} value={counts.revoked || 0} />
        <StatCard label={t('verification.stats.paid')} value={counts.paid || 0} sublabel={t('verification.stats.awaitingReview')} />
        <StatCard label={t('verification.stats.refunded')} value={counts.refunded || 0} />
        <StatCard label={t('verification.stats.revenue')} value={money(orders.revenue)} />
      </div>

      {/* A duplicate sale is money taken for something that cannot be delivered.
          It is surfaced above everything else because until a human refunds it,
          a real customer is out $149 and nothing else on this page is more
          urgent than that. */}
      {counts.duplicate > 0 && (
        <div className="console-callout">
          <strong><AlertTriangle size={15} /> {t('verification.duplicateTitle')}</strong>
          <p>{t('verification.duplicateBody', { count: counts.duplicate })}</p>
        </div>
      )}

      <h4 className="console-h4">{t('verification.funnelTitle')}</h4>
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

      <div className="analytics-stat-grid">
        <StatCard label={t('verification.funnel.quotes')} value={f.quotes || 0} />
        <StatCard label={t('verification.funnel.orders')} value={f.orders || 0} />
        <StatCard label={t('verification.funnel.payments')} value={f.paymentsConfirmed || 0} />
        <StatCard label={t('verification.funnel.ownership')} value={f.ownershipCompleted || 0} />
        <StatCard label={t('verification.funnel.activations')} value={f.activations || 0} />
        {/* null, not 0%. With no quotes in the window this is 0/0 — an absent
            measurement, not a conversion rate of zero. Rendering it as 0% would
            show a red failure on a quiet week. */}
        <StatCard
          label={t('verification.funnel.conversion')}
          value={f.conversionRate == null ? t('common.notMeasured') : `${(f.conversionRate * 100).toFixed(1)}%`}
        />
        <StatCard label={t('verification.funnel.profileViews')} value={f.profileViews || 0} />
        <StatCard label={t('verification.funnel.badgeImpressions')} value={f.badgeImpressions || 0} />
        <StatCard label={t('verification.funnel.paywallHits')} value={f.paywallHits || 0} />
        <StatCard label={t('verification.funnel.upgradeClicks')} value={f.upgradeClicks || 0} />
        <StatCard label={t('verification.funnel.scansStarted')} value={f.scansStarted || 0} />
        <StatCard label={t('verification.funnel.scansCompleted')} value={f.scansCompleted || 0} />
        <StatCard label={t('verification.funnel.scansFailed')} value={f.scansFailed || 0} tone={f.scansFailed ? 'warn' : undefined} />
      </div>

      <h4 className="console-h4">{t('verification.revenueByTier')}</h4>
      <DataTable
        columns={[t('verification.colTier'), t('verification.colRevenue')]}
        rows={Object.entries(f.revenueByTier || {}).map(([tier, usd]) => [tier, money(usd)])}
        emptyText={t('verification.noRevenue')}
      />

      <h4 className="console-h4">{t('verification.ordersTitle')}</h4>
      <DataTable
        columns={[
          t('verification.colOrder'),
          t('verification.colToken'),
          t('verification.colTier'),
          t('verification.colStatus'),
          t('verification.colExpiry'),
          t('verification.colActions'),
        ]}
        rows={(orders.orders || []).map((order) => ([
          <span title={order.id}>{short(order.id)}</span>,
          <span title={`${order.contract} (${order.chain})`}>{short(order.contract)}<br /><small>{order.chain}</small></span>,
          `${order.tier} · ${money(order.usd)}`,
          <span className={order.status === 'active' ? 'confidence-chip confidence-sufficient' : 'confidence-chip'}>
            {t(`verification.status.${order.status}`)}
          </span>,
          order.expiresAt
            ? <span title={order.expiresAt}>
              {order.expiresAt.slice(0, 10)}
              {order.daysToExpiry != null && order.daysToExpiry >= 0 ? <><br /><small>{t('verification.daysLeft', { days: order.daysToExpiry })}</small></> : null}
            </span>
            : t('common.notMeasured'),
          <span className="console-row-actions">
            <button type="button" className="range-button" disabled={busy === order.id} onClick={() => act(order, 'resend_receipt')}>
              {t('verification.actions.resend_receipt')}
            </button>
            {order.status === 'active' && (
              <button type="button" className="range-button" disabled={busy === order.id} onClick={() => act(order, 'revoke')}>
                {t('verification.actions.revoke')}
              </button>
            )}
            {order.paymentSignature && order.status !== 'refunded' && (
              <button type="button" className="range-button" disabled={busy === order.id} onClick={() => act(order, 'mark_refunded')}>
                {t('verification.actions.mark_refunded')}
              </button>
            )}
          </span>,
        ]))}
        emptyText={t('verification.noOrders')}
      />
      <p className="console-page-intro">
        {t('verification.eventNote', { count: (funnel.eventCount || 0).toLocaleString(lang) })}
      </p>
    </>
  );
}
