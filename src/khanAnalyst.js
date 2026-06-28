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
  return signals.slice(0, max).join(t('askKhan.answers.signalSeparator'));
}

function translateSignalKeys(keys = [], fallbackSignals = []) {
  if (keys.length) {
    return keys.map((key) => t(`askKhan.answers.signals.${key}`));
  }
  return fallbackSignals.map((signal) => {
    const key = inferSignalKey(signal);
    return key ? t(`askKhan.answers.signals.${key}`) : signal;
  });
}

function inferSignalKey(signal = '') {
  const matchers = [
    ['Largest holder controls', 'largestHolderModerate'],
    ['Liquidity is shallow relative to market cap', 'shallowLiquidity'],
    ['Trading volume looks inconsistent', 'volumeInconsistent'],
    ['Project is very new', 'veryNewProject'],
    ['No verifiable public presence', 'noPublicPresence'],
    ['Contract security status', 'contractSecurityUnknown'],
    ['Price action has been extremely volatile', 'extremeVolatility'],
    ['Top 10 wallets hold', 'topTenCentralization'],
    ['Trading volume is far larger', 'volumeLiquidityMismatch'],
    ['Extreme short-term price swing', 'extremeSwingThinLiquidity'],
    ['Very new token with an extreme price spike', 'newTokenPriceSpike'],
    ['Supply is well distributed', 'wellDistributedSupply'],
    ['Liquidity is deep relative to market cap', 'deepLiquidity'],
    ['Project has traded for over a year', 'tradedOverYear'],
    ['Price has remained relatively stable', 'stablePrice'],
    ['Mint and freeze authority are confirmed disabled', 'authoritiesDisabled'],
    ['Team maintains an active public presence', 'activePublicPresence'],
    ['Listed and verified on an independent research platform', 'coingeckoVerified'],
    ['Holder count is growing steadily', 'holderGrowth'],
  ];
  return matchers.find(([prefix]) => signal.startsWith(prefix))?.[1] || null;
}

function translatedCategory(category) {
  return t(`askKhan.answers.assetCategories.${category || 'Other'}`);
}

function translatedModifier(modifier, category) {
  if (!modifier?.explanationKey) {
    const inferredKey = inferModifierKey(modifier);
    if (!inferredKey) return modifier?.explanation || '';
    return t(`askKhan.answers.modifiers.${inferredKey}`, {
      cap: modifier.cap,
      category: translatedCategory(category),
    });
  }
  return t(`askKhan.answers.modifiers.${modifier.explanationKey}`, {
    cap: modifier.cap,
    category: translatedCategory(category),
  });
}

function inferModifierKey(modifier) {
  if (!modifier) return null;
  if (modifier.label === 'Established memecoin') return 'establishedMemecoin';
  if (modifier.label === 'New / unproven memecoin') return 'newMemecoin';
  if (modifier.label === 'Major Layer 1 infrastructure') return 'majorLayer1';
  if (modifier.label === 'Infrastructure asset') return 'infrastructure';
  if (modifier.label === 'Utility / DeFi asset') return 'utilityDefi';
  if (modifier.label === 'Stablecoin') return 'stablecoin';
  if (modifier.label === 'Gaming / metaverse token') return 'gaming';
  return modifier.explanation ? 'default' : null;
}

function whyRisky(project) {
  const parts = [];
  const modifier = project.assetTypeRiskModifier;
  const modifierNote = translatedModifier(modifier, project.assetCategory);
  if (modifierNote) parts.push(modifierNote);
  const risks = translateSignalKeys(project.hiddenRiskSignalKeys, project.hiddenRiskSignals || []);
  if (risks.length) {
    parts.push(t('askKhan.answers.whyRiskyConcerns', { signals: joinSignals(risks, 3) }));
  } else {
    parts.push(t('askKhan.answers.whyRiskyNoConcerns'));
  }
  const positives = translateSignalKeys(project.positiveSignalKeys, project.positiveSignals || []);
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
  const riskSignals = translateSignalKeys(project.hiddenRiskSignalKeys, project.hiddenRiskSignals || []);
  const positiveSignals = translateSignalKeys(project.positiveSignalKeys, project.positiveSignals || []);
  const driver = (delta.delta < 0 ? riskSignals[0] : positiveSignals[0])
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
      modifierNote: translatedModifier(project.assetTypeRiskModifier, project.assetCategory),
    }).trim();
  }
  const modifierNote = translatedModifier(project.assetTypeRiskModifier, project.assetCategory);
  if (modifierNote) {
    return t('askKhan.answers.compareNoPeersWithModifier', { explanation: modifierNote });
  }
  return t('askKhan.answers.compareNoPeers');
}

function whatToWatch(project) {
  const risks = translateSignalKeys(project.hiddenRiskSignalKeys, project.hiddenRiskSignals || []);
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
