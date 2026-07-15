import React from 'react';
import { Target } from 'lucide-react';

import { SectionTitle, EmptyState, ConfidenceChip, DataTable, MiniBarChart } from '../ui/primitives.jsx';
import { useT } from '../i18n/ConsoleI18nProvider.jsx';
import { useWarehouse, formatRate } from '../lib/useGrowthData.js';

// The two channels the operator actually works. Highlighted so they are
// findable at a glance in a table that also lists channels they don't market on
// (which exist so YouTube/TikTok have something to be compared against).
const OWNED_CHANNELS = new Set(['youtube', 'tiktok']);

export default function AcquisitionPage({ token }) {
  const { t } = useT();
  const { data, state } = useWarehouse(token, 30);

  if (state.status === 'loading') return <SectionTitle icon={Target} eyebrow={t('common.eyebrow')} title={t('common.loading')} />;
  if (state.status === 'error') return <EmptyState title={t('common.couldNotLoad')} text={state.message} />;
  if (!data) return null;

  const { channels } = data;
  const owned = channels.filter((row) => OWNED_CHANNELS.has(row.channel));
  // An unrecognised channel falls back to its raw id rather than rendering
  // blank — a new channel added server-side should look odd, not invisible.
  const channelName = (code) => t(`channels.${code}`) === `channels.${code}` ? code : t(`channels.${code}`);

  return (
    <>
      <SectionTitle icon={Target} eyebrow={t('common.eyebrow')} title={t('acquisition.title')} />
      <p className="console-page-intro">{t('acquisition.intro')}</p>

      <div className="console-callout">
        <strong>{t('acquisition.calloutTitle')}</strong>
        <p>{t('acquisition.calloutBody')}</p>
      </div>

      {owned.length === 0 && (
        <EmptyState title={t('acquisition.noOwnedTitle')} text={t('acquisition.noOwnedBody')} />
      )}

      {owned.length > 0 && (
        <MiniBarChart data={owned.map((row) => ({ label: channelName(row.channel), value: row.visitors }))} />
      )}

      <h4 className="console-h4">{t('acquisition.allChannels')}</h4>
      <DataTable
        columns={[
          t('acquisition.colChannel'),
          t('acquisition.colVisitors'),
          t('acquisition.colSignups'),
          t('acquisition.colSignupRate'),
          t('confidence.canWeTrust'),
        ]}
        rows={channels.map((row) => ([
          <strong className={OWNED_CHANNELS.has(row.channel) ? 'channel-owned' : ''}>
            {channelName(row.channel)}
          </strong>,
          row.visitors,
          row.signups,
          <span className={row.signupRate.confidence.level === 'insufficient' ? 'metric-insufficient' : ''}>
            {formatRate(row.signupRate.value)}
          </span>,
          <ConfidenceChip confidence={row.signupRate.confidence} />,
        ]))}
        emptyText={t('acquisition.noTraffic')}
      />
    </>
  );
}
