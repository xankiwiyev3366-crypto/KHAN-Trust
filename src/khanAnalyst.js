// Phase 2 — Score Voice: a token-specific "Ask KHAN" analyst. Deliberately
// NOT a general chatbot - there is no free-text input and no external LLM
// call. Every answer is composed deterministically from data the rest of
// the engine already computed (scoreBreakdown, deepAnalysis signals, the
// asset-type risk modifier, Phase 1's score history, and Phase 4's peer
// benchmark), so nothing here can say anything the underlying data doesn't
// actually support.
//
// All templates are translated (see i18n/en.js `askKhan.answers` and its
// az/tr/ru mirrors) via the standalone `translate()` mirror - the same
// pattern the rest of the app uses for plain (non-component) modules - so
// this module never needs `t` threaded through it from a component.
import { translate as t } from './i18n/index.js';
import { computeScoreDelta } from './scoreHistory.js';
import { peerLabelFor } from './peerBenchmark.js';

function joinSignals(signals, max = 2) {
  return signals.slice(0, max).join('; ');
}

function whyRisky(project) {
  const parts = [];
  const modifier = project.assetTypeRiskModifier;
  if (modifier?.explanation) parts.push(modifier.explanation);
  const risks = project.hiddenRiskSignals || [];
  if (risks.length) {
    parts.push(t('askKhan.answers.whyRiskyConcerns', { signals: joinSignals(risks, 3) }));
  } else {
    parts.push(t('askKhan.answers.whyRiskyNoConcerns'));
  }
  const positives = project.positiveSignals || [];
  if (positives.length) {
    parts.push(t('askKhan.answers.whyRiskyPositives', { signals: joinSignals(positives, 2) }));
  }
  parts.push(t('askKhan.answers.whyRiskySummary', {
    riskLevel: t(`common.${(project.riskLevel || 'medium').toLowerCase()}`),
    confidence: t(`common.${(project.confidenceLabel || 'medium').toLowerCase()}`),
  }));
  return parts.join(' ');
}

function whatChanged(project, history) {
  const delta = computeScoreDelta(history, project.trustScore);
  if (!delta) {
    return t('askKhan.answers.notEnoughHistory');
  }
  const direction = delta.delta > 0 ? 'improved' : delta.delta < 0 ? 'declined' : 'steady';
  const period = delta.label === 'thisWeek' ? 'thisWeek' : 'sinceLaunch';
  const driverFallbackKey = delta.delta < 0 ? 'driverRiskFallback' : 'driverPositiveFallback';
  const driver = (delta.delta < 0 ? project.hiddenRiskSignals?.[0] : project.positiveSignals?.[0])
    || t(`askKhan.answers.${driverFallbackKey}`);
  return t('askKhan.answers.whatChangedSummary', {
    direction: t(`askKhan.answers.direction.${direction}`),
    points: Math.abs(delta.delta),
    period: t(`askKhan.answers.period.${period}`),
    score: project.trustScore,
    driver,
  });
}

function howCompare(project, peerBenchmark) {
  if (peerBenchmark) {
    const { comparison, peerCount, category } = peerBenchmark;
    return t('askKhan.answers.compareWithPeers', {
      peerCount,
      category: peerLabelFor(category),
      comparison: t(`riskSummary.peerComparison.${comparison}`),
      modifierNote: project.assetTypeRiskModifier?.explanation || '',
    }).trim();
  }
  if (project.assetTypeRiskModifier?.explanation) {
    return t('askKhan.answers.compareNoPeersWithModifier', { explanation: project.assetTypeRiskModifier.explanation });
  }
  return t('askKhan.answers.compareNoPeers');
}

function whatToWatch(project) {
  const risks = project.hiddenRiskSignals || [];
  if (risks.length) {
    return t('askKhan.answers.watchWithRisks', { signals: joinSignals(risks, 3) });
  }
  return t('askKhan.answers.watchNoRisks');
}

export const ANALYST_QUESTIONS = [
  { id: 'why_risky', labelKey: 'askKhan.questions.whyRisky' },
  { id: 'what_changed', labelKey: 'askKhan.questions.whatChanged' },
  { id: 'how_compare', labelKey: 'askKhan.questions.howCompare' },
  { id: 'what_to_watch', labelKey: 'askKhan.questions.whatToWatch' },
];

export function answerQuestion(questionId, project, history, peerBenchmark) {
  switch (questionId) {
    case 'why_risky':
      return whyRisky(project);
    case 'what_changed':
      return whatChanged(project, history);
    case 'how_compare':
      return howCompare(project, peerBenchmark);
    case 'what_to_watch':
      return whatToWatch(project);
    default:
      return '';
  }
}
