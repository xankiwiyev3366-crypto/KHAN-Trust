// Phase 3 — Analyst Attention: deterministic risk-change alerts computed by
// comparing the two most recent score-history snapshots for a token (see
// scoreHistory.js / Phase 1). Purely a read of already-stored data - no
// extra network calls beyond fetching that history, and no thresholds tuned
// to be alarming, just the same plain-language voice as the rest of the
// analyst layer. Messages are translated via the standalone `translate()`
// mirror (see i18n/en.js `watchlist.alerts` and its az/tr/ru mirrors).
import { useEffect, useState } from 'react';
import { translate as t } from './i18n/index.js';
import { historyKeyFor, fetchScoreHistory } from './scoreHistory.js';
import { diffSnapshots } from './riskHistory.js';

const SCORE_DROP_THRESHOLD = 8;
const HOLDER_CONCENTRATION_INCREASE_THRESHOLD = 5; // percentage points
const LIQUIDITY_DROP_RATIO_THRESHOLD = 0.25; // 25% drop
// Phase 5: a category (contract security, community, social, ...) must move by
// at least this much to raise a dedicated smart alert - higher than the
// history-timeline threshold so the watchlist surfaces only significant drift.
const ALERT_CATEGORY_DROP_THRESHOLD = 8; // points

// Phase 5 smart alerts, layered ON TOP of the three original signal alerts
// above without changing any of their thresholds or messages. Uses the shared
// diffSnapshots() brain so the watchlist, the on-page history timeline, and the
// email digest all agree on what counts as a change. Each entry maps a detected
// category/social drop or risk-level increase to a localized, prev->new alert.
const CATEGORY_ALERT_KEYS = {
  contractSecurity: 'contractSecurity',
  community: 'community',
  social: 'social',
  marketActivity: 'marketActivity',
  holderHealth: 'holderHealth',
};

export function detectRiskAlerts(history) {
  if (!Array.isArray(history) || history.length < 2) return [];
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const latest = sorted[sorted.length - 1];
  const previous = sorted[sorted.length - 2];
  const alerts = [];

  const scoreDrop = previous.score - latest.score;
  if (scoreDrop >= SCORE_DROP_THRESHOLD) {
    alerts.push({
      type: 'score_drop',
      severity: 'high',
      message: t('watchlist.alerts.scoreDrop', { points: scoreDrop, previous: previous.score, latest: latest.score }),
    });
  }

  if (typeof latest.topHolderPercent === 'number' && typeof previous.topHolderPercent === 'number') {
    const increase = latest.topHolderPercent - previous.topHolderPercent;
    if (increase >= HOLDER_CONCENTRATION_INCREASE_THRESHOLD) {
      alerts.push({
        type: 'holder_concentration',
        severity: 'medium',
        message: t('watchlist.alerts.holderConcentration', { points: increase.toFixed(1) }),
      });
    }
  }

  if (typeof latest.liquidityUsd === 'number' && typeof previous.liquidityUsd === 'number' && previous.liquidityUsd > 0) {
    const ratio = (latest.liquidityUsd - previous.liquidityUsd) / previous.liquidityUsd;
    if (ratio <= -LIQUIDITY_DROP_RATIO_THRESHOLD) {
      alerts.push({
        type: 'liquidity_drop',
        severity: 'high',
        message: t('watchlist.alerts.liquidityDrop', { percent: Math.round(Math.abs(ratio) * 100) }),
      });
    }
  }

  // --- Phase 5 additive smart alerts (category, social, risk level) ---
  const RISK_ORDER = { Low: 0, Medium: 1, High: 2 };
  if (latest.riskLevel && previous.riskLevel && (RISK_ORDER[latest.riskLevel] ?? 1) > (RISK_ORDER[previous.riskLevel] ?? 1)) {
    alerts.push({
      type: 'risk_level_up',
      severity: 'high',
      message: t('watchlist.alerts.riskLevelUp', {
        from: t(`common.${previous.riskLevel.toLowerCase()}`),
        to: t(`common.${latest.riskLevel.toLowerCase()}`),
      }),
    });
  }

  for (const change of diffSnapshots(previous, latest)) {
    const alertKey = CATEGORY_ALERT_KEYS[change.key];
    if (!alertKey || !change.worse) continue;
    if (Math.abs(change.delta) < ALERT_CATEGORY_DROP_THRESHOLD) continue;
    alerts.push({
      type: `category_${change.key}`,
      severity: 'medium',
      message: t(`watchlist.alerts.${alertKey}Drop`, {
        points: Math.abs(Math.round(change.delta)),
        previous: Math.round(change.previous),
        latest: Math.round(change.current),
      }),
    });
  }

  return alerts;
}

// Total active alert count across every watched token - powers the
// sidebar's "Alerts" badge. Same fetch as WatchlistPage's own effect; the
// duplication is cheap (localStorage/dev-fallback reads) and keeps this
// hook independent of whether the Watchlist page itself is mounted.
export function useWatchlistAlertCount(projects, watchlist) {
  const [count, setCount] = useState(0);
  const watchedIds = watchlist.join(',');

  useEffect(() => {
    let cancelled = false;
    const watched = projects.filter((project) => watchlist.includes(project.id));
    Promise.all(
      watched.map(async (project) => {
        const key = historyKeyFor(project);
        const history = key ? await fetchScoreHistory(key).catch(() => []) : [];
        return detectRiskAlerts(history).length;
      })
    ).then((counts) => {
      if (!cancelled) setCount(counts.reduce((total, value) => total + value, 0));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedIds, projects.length]);

  return count;
}
