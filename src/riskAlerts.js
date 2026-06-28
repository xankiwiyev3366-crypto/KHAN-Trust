// Phase 3 — Analyst Attention: deterministic risk-change alerts computed by
// comparing the two most recent score-history snapshots for a token (see
// scoreHistory.js / Phase 1). Purely a read of already-stored data - no
// extra network calls beyond fetching that history, and no thresholds tuned
// to be alarming, just the same plain-language voice as the rest of the
// analyst layer.
const SCORE_DROP_THRESHOLD = 8;
const HOLDER_CONCENTRATION_INCREASE_THRESHOLD = 5; // percentage points
const LIQUIDITY_DROP_RATIO_THRESHOLD = 0.25; // 25% drop

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
      message: `Trust Score dropped ${scoreDrop} points (from ${previous.score} to ${latest.score}) since the last check.`,
    });
  }

  if (typeof latest.topHolderPercent === 'number' && typeof previous.topHolderPercent === 'number') {
    const increase = latest.topHolderPercent - previous.topHolderPercent;
    if (increase >= HOLDER_CONCENTRATION_INCREASE_THRESHOLD) {
      alerts.push({
        type: 'holder_concentration',
        severity: 'medium',
        message: `The largest holder's share of supply grew by ${increase.toFixed(1)} percentage points - concentration risk is increasing.`,
      });
    }
  }

  if (typeof latest.liquidityUsd === 'number' && typeof previous.liquidityUsd === 'number' && previous.liquidityUsd > 0) {
    const ratio = (latest.liquidityUsd - previous.liquidityUsd) / previous.liquidityUsd;
    if (ratio <= -LIQUIDITY_DROP_RATIO_THRESHOLD) {
      alerts.push({
        type: 'liquidity_drop',
        severity: 'high',
        message: `Public liquidity fell by ${Math.round(Math.abs(ratio) * 100)}% since the last check - exits could move the price more than before.`,
      });
    }
  }

  return alerts;
}
