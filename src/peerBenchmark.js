// Phase 4 — Analyst Perspective: ranks a token's Trust Score against other
// tracked tokens KHAN Trust has already classified into the same asset
// category (see classifyAsset in scoringEngine.js). Pure and synchronous -
// computed only from scores already held in memory (the app's existing
// `projects` list), no new data source or network call.
import { translate as t } from './i18n/index.js';

const MIN_PEER_COUNT = 4;

export function computePeerBenchmark(project, allProjects = []) {
  const category = project?.assetCategory;
  if (!category) return null;
  const peers = allProjects.filter(
    (candidate) => candidate.assetCategory === category && typeof candidate.trustScore === 'number'
  );
  if (peers.length < MIN_PEER_COUNT) return null;

  const scores = peers.map((peer) => peer.trustScore).sort((a, b) => a - b);
  const below = scores.filter((score) => score < project.trustScore).length;
  const percentile = Math.round((below / scores.length) * 100);
  const mid = Math.floor(scores.length / 2);
  const median = scores.length % 2 === 0 ? (scores[mid - 1] + scores[mid]) / 2 : scores[mid];
  const comparison = project.trustScore > median ? 'above' : project.trustScore < median ? 'below' : 'at';

  return { category, percentile, peerCount: scores.length, median: Math.round(median), comparison };
}

// Category string (from classifyAsset) -> translation key suffix under
// `peerCategories` (see i18n/en.js and its az/tr/ru mirrors). This map is
// just identifiers, not display text - the actual words come from the
// dictionaries so this label is fully localized.
const CATEGORY_KEY = {
  'Meme Token': 'memeToken',
  Stablecoin: 'stablecoin',
  'Layer 1': 'layer1',
  'Layer 2': 'layer2',
  DeFi: 'defi',
  Infrastructure: 'infrastructure',
  Gaming: 'gaming',
  AI: 'ai',
  'Exchange Token': 'exchangeToken',
  RWA: 'rwa',
  Privacy: 'privacy',
  'Utility Token': 'utilityToken',
  Other: 'other',
};

export function peerLabelFor(category) {
  return t(`peerCategories.${CATEGORY_KEY[category] || 'other'}`);
}
