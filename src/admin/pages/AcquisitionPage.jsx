import React from 'react';
import { Target } from 'lucide-react';

import { SectionTitle, EmptyState, ConfidenceChip, DataTable, MiniBarChart } from '../ui/primitives.jsx';
import { useWarehouse, formatRate } from '../lib/useGrowthData.js';

// The two channels the operator actually works. Highlighted so they are
// findable at a glance in a table that also lists channels they don't market on
// (which exist so YouTube/TikTok have something to be compared against).
const OWNED_CHANNELS = new Set(['youtube', 'tiktok']);

const CHANNEL_LABELS = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  google: 'Google',
  direct: 'Direct',
  referral: 'Other referral',
  x: 'X',
  telegram: 'Telegram',
  reddit: 'Reddit',
  internal: 'Internal',
};

export default function AcquisitionPage({ token }) {
  const { data, state } = useWarehouse(token, 30);

  if (state.status === 'loading') return <SectionTitle icon={Target} eyebrow="Growth OS" title="Loading acquisition…" />;
  if (state.status === 'error') return <EmptyState title="Could not load" text={state.message} />;
  if (!data) return null;

  const { channels } = data;
  const owned = channels.filter((row) => OWNED_CHANNELS.has(row.channel));

  return (
    <>
      <SectionTitle icon={Target} eyebrow="Growth OS" title="Acquisition by channel" />
      <p className="console-page-intro">
        Attributed on <strong>first touch</strong>, not last. Someone who found KHAN Trust through a
        TikTok, left, and came back later by typing the URL is a TikTok acquisition — last-touch
        would file them under “Direct” and you would conclude, wrongly, that TikTok does not work.
      </p>

      <div className="console-callout">
        <strong>This page could not exist before the Growth Data Plane shipped.</strong>
        <p>
          The old traffic detector recognised five sources: direct, Google, X, Telegram and “other”.
          YouTube and TikTok — the only two channels you market on — both landed in “other”. Their
          performance was not merely unmeasured; it was unmeasurable.
        </p>
      </div>

      {owned.length === 0 && (
        <EmptyState
          title="No YouTube or TikTok traffic recorded yet"
          text="Tag your links with ?utm_source=youtube or ?utm_source=tiktok. UTM tags matter more than you'd expect: both platforms strip the referrer on most in-app taps, so untagged traffic from them arrives looking like Direct."
        />
      )}

      {owned.length > 0 && (
        <MiniBarChart
          data={owned.map((row) => ({ label: CHANNEL_LABELS[row.channel], value: row.visitors }))}
        />
      )}

      <h4 className="console-h4">All channels</h4>
      <DataTable
        columns={['Channel', 'Visitors', 'Signups', 'Signup rate', 'Can we trust it?']}
        rows={channels.map((row) => ([
          <strong className={OWNED_CHANNELS.has(row.channel) ? 'channel-owned' : ''}>
            {CHANNEL_LABELS[row.channel] || row.channel}
          </strong>,
          row.visitors,
          row.signups,
          <span className={row.signupRate.confidence.level === 'insufficient' ? 'metric-insufficient' : ''}>
            {formatRate(row.signupRate.value)}
          </span>,
          <ConfidenceChip confidence={row.signupRate.confidence} />,
        ]))}
        emptyText="No attributed traffic recorded yet. The data plane only started collecting when it was deployed — earlier visits cannot be backfilled."
      />
    </>
  );
}
