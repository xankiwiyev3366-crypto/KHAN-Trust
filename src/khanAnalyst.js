// Phase 2 — Score Voice: a token-specific "Ask KHAN" analyst. Deliberately
// NOT a general chatbot - there is no free-text input and no external LLM
// call. Every answer is composed deterministically from data the rest of
// the engine already computed (scoreBreakdown, deepAnalysis signals, the
// asset-type risk modifier, Phase 1's score history, and Phase 4's peer
// benchmark), so nothing here can say anything the underlying data doesn't
// actually support.
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
    parts.push(`The main concerns right now: ${joinSignals(risks, 3)}.`);
  } else {
    parts.push('No major hidden risk patterns were detected in the available data.');
  }
  const positives = project.positiveSignals || [];
  if (positives.length) {
    parts.push(`On the positive side: ${joinSignals(positives, 2)}.`);
  }
  parts.push(`This puts it at a ${(project.riskLevel || 'medium').toLowerCase()} risk rating with ${(project.confidenceLabel || 'medium').toLowerCase()} confidence in the data behind it.`);
  return parts.join(' ');
}

function whatChanged(project, history) {
  const delta = computeScoreDelta(history, project.trustScore);
  if (!delta) {
    return "There isn't enough tracked history yet to show a trend for this token - check back in a few days as KHAN Trust keeps watching it.";
  }
  const direction = delta.delta > 0 ? 'improved' : delta.delta < 0 ? 'declined' : 'held steady';
  const periodLabel = delta.label === 'thisWeek' ? 'over the past week' : 'since it was first scanned';
  const driver = delta.delta < 0
    ? (project.hiddenRiskSignals?.[0] || 'increased risk signals in the underlying data')
    : (project.positiveSignals?.[0] || 'stable or improving fundamentals in the underlying data');
  return `The Trust Score has ${direction} by ${Math.abs(delta.delta)} point(s) ${periodLabel}, now at ${project.trustScore}/100. The main driver: ${driver}.`;
}

function howCompare(project, peerBenchmark) {
  if (peerBenchmark) {
    const { comparison, peerCount, category } = peerBenchmark;
    const modifierNote = project.assetTypeRiskModifier?.explanation || '';
    return `Against ${peerCount} other tracked ${peerLabelFor(category)}, this token ranks ${comparison} the median Trust Score. ${modifierNote}`.trim();
  }
  if (project.assetTypeRiskModifier?.explanation) {
    return `${project.assetTypeRiskModifier.explanation} Not enough peer data is tracked yet for a direct ranking.`;
  }
  return 'Not enough peer data is tracked yet to rank this token against similar assets.';
}

function whatToWatch(project) {
  const risks = project.hiddenRiskSignals || [];
  if (risks.length) {
    return `Keep an eye on: ${joinSignals(risks, 3)}. Add this token to your Watchlist to get notified here in KHAN Trust if any of these get meaningfully worse.`;
  }
  return 'No specific red flags stand out right now, but liquidity and holder concentration can change quickly. Add this token to your Watchlist to get notified if that happens.';
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
