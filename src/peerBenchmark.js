// Phase 4 — Analyst Perspective: ranks a token's Trust Score against other
// tracked tokens KHAN Trust has already classified into the same asset
// category (see classifyAsset in scoringEngine.js). Pure and synchronous -
// computed only from scores already held in memory (the app's existing
// `projects` list), no new data source or network call.
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

const CATEGORY_PEER_LABEL = {
  'Meme Token': 'memecoins',
  Stablecoin: 'stablecoins',
  'Layer 1': 'Layer 1 projects',
  'Layer 2': 'Layer 2 projects',
  DeFi: 'DeFi projects',
  Infrastructure: 'infrastructure projects',
  Gaming: 'gaming tokens',
  AI: 'AI tokens',
  'Exchange Token': 'exchange tokens',
  RWA: 'RWA projects',
  Privacy: 'privacy coins',
  'Utility Token': 'utility tokens',
  Other: 'tracked tokens',
};

export function peerLabelFor(category) {
  return CATEGORY_PEER_LABEL[category] || 'tracked tokens';
}
