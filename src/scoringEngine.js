// Deep Risk Analysis Engine — additive layer on top of KHAN Trust's existing
// scoring system (see calculateLiveScores/calculateManualScores in main.jsx).
// This module never touches trustScore/riskLevel math; it consumes the
// already-computed scores + raw data and produces extra intelligence:
// asset classification, hidden risk / positive signal detection, a
// confidence score, and a plain-language summary. Nothing here can lower
// or raise the existing trustScore unless explicitly composed by the
// caller via `categoryAdjustment` (small, capped, opt-in).

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function hasValue(value) {
  return Boolean(value && !['Not provided', 'Not available', 'Missing', 'Data unavailable'].includes(value));
}

const MEME_KEYWORDS = ['dog', 'cat', 'inu', 'pepe', 'shib', 'doge', 'elon', 'moon', 'wojak', 'frog', 'meme', 'bonk', 'floki', 'cum', 'chad'];
const STABLE_KEYWORDS = ['usd', 'usdt', 'usdc', 'dai', 'stable', 'eur', 'gbp'];
const PRIVACY_KEYWORDS = ['privacy', 'monero', 'zcash', 'secret'];
const AI_KEYWORDS = ['ai', 'gpt', 'agent', 'neural', 'render'];
const GAMING_KEYWORDS = ['game', 'play', 'gaming', 'metaverse', 'guild'];
const DEFI_KEYWORDS = ['swap', 'finance', 'fi', 'yield', 'lend', 'dex', 'vault'];
const EXCHANGE_KEYWORDS = ['exchange', 'bnb', 'okb', 'cake'];
const INFRA_KEYWORDS = ['oracle', 'bridge', 'node', 'storage', 'compute', 'infra'];
const L1_NAMES = ['bitcoin', 'ethereum', 'solana', 'avalanche', 'cardano', 'sui', 'aptos', 'near', 'cosmos', 'ton'];
const L2_NAMES = ['arbitrum', 'optimism', 'base', 'polygon', 'zksync', 'starknet', 'scroll', 'mantle'];

// Heuristic classifier — no new API calls. Falls back to 'Other' rather
// than guessing wrong; an uncertain classification never penalizes a score,
// it only selects which baseline weighting to apply.
export function classifyAsset(project = {}, data = {}) {
  const name = (project.name || '').toLowerCase();
  const ticker = (project.ticker || '').toLowerCase();
  const text = `${name} ${ticker}`;
  const category = (data.coingeckoCategory || '').toLowerCase();
  const marketCap = Number(data.marketCapUsd || 0);
  const supply = Number(data.supply || data.totalSupply || 0);
  const price = Number(data.priceUsd || 0);

  if (STABLE_KEYWORDS.some((k) => text.includes(k)) || category.includes('stablecoin')) {
    return { category: 'Stablecoin', confidence: 'high' };
  }
  if (L1_NAMES.some((k) => text.includes(k))) return { category: 'Layer 1', confidence: 'high' };
  if (L2_NAMES.some((k) => text.includes(k)) || category.includes('layer 2')) return { category: 'Layer 2', confidence: 'high' };
  if (category.includes('layer 1') || category.includes('smart contract platform')) return { category: 'Layer 1', confidence: 'high' };
  if (PRIVACY_KEYWORDS.some((k) => text.includes(k)) || category.includes('privacy')) return { category: 'Privacy', confidence: 'high' };
  if (EXCHANGE_KEYWORDS.some((k) => text.includes(k)) || category.includes('exchange')) return { category: 'Exchange Token', confidence: 'heuristic' };
  if (GAMING_KEYWORDS.some((k) => text.includes(k)) || category.includes('gaming') || category.includes('metaverse')) return { category: 'Gaming', confidence: 'heuristic' };
  if (AI_KEYWORDS.some((k) => text.includes(k)) || category.includes('ai-')) return { category: 'AI', confidence: 'heuristic' };
  if (DEFI_KEYWORDS.some((k) => text.includes(k)) || category.includes('defi') || category.includes('decentralized')) return { category: 'DeFi', confidence: 'heuristic' };
  if (INFRA_KEYWORDS.some((k) => text.includes(k)) || category.includes('infrastructure')) return { category: 'Infrastructure', confidence: 'heuristic' };
  if (category.includes('real world asset') || category.includes('rwa')) return { category: 'RWA', confidence: 'high' };

  // Meme heuristic: meme-style name/ticker, or (very large supply + very low unit price
  // + no recognizable utility category) which is the classic memecoin shape.
  const memeShaped = supply >= 1_000_000_000 && price > 0 && price < 0.01;
  if (MEME_KEYWORDS.some((k) => text.includes(k)) || category.includes('meme') || (memeShaped && marketCap < 5_000_000_000)) {
    return { category: 'Meme Token', confidence: MEME_KEYWORDS.some((k) => text.includes(k)) ? 'high' : 'heuristic' };
  }
  if (category.includes('utility')) return { category: 'Utility Token', confidence: 'heuristic' };
  return { category: 'Other', confidence: 'heuristic' };
}

// Per-category emphasis: which already-computed scores matter more or less.
// These are alternate weight tables for the SAME weightedAverage() the
// existing engine already uses — not a new scoring formula.
export const CATEGORY_BASELINES = {
  'Meme Token': { topHolderScore: 24, topTenHolderScore: 20, marketActivityScore: 14, liquidityScore: 18, tokenAgeScore: 12, securityScore: 10, githubScore: 0, founderActivity: 2 },
  Stablecoin: { topHolderScore: 6, topTenHolderScore: 4, liquidityScore: 22, marketCapScore: 14, securityScore: 18, tokenAgeScore: 14, marketActivityScore: 8, websiteScore: 4 },
  'Layer 1': { tokenAgeScore: 18, securityScore: 10, holderScore: 16, topHolderScore: 12, liquidityScore: 10, githubScore: 8, marketCapScore: 8, founderActivity: 6, roadmapClarity: 6 },
  'Layer 2': { tokenAgeScore: 14, securityScore: 10, holderScore: 14, topHolderScore: 14, liquidityScore: 12, githubScore: 8, marketCapScore: 8, founderActivity: 6, roadmapClarity: 6 },
  DeFi: { securityScore: 16, liquidityScore: 18, topHolderScore: 16, marketActivityScore: 10, githubScore: 8, founderActivity: 6 },
  Infrastructure: { tokenAgeScore: 14, githubScore: 12, securityScore: 12, holderScore: 12, founderActivity: 8, roadmapClarity: 8 },
  Gaming: { roadmapClarity: 10, communityActivity: 10, founderActivity: 8, liquidityScore: 14, topHolderScore: 14, githubScore: 6 },
  AI: { githubScore: 10, roadmapClarity: 10, founderActivity: 8, securityScore: 10, liquidityScore: 14, topHolderScore: 14 },
  'Exchange Token': { liquidityScore: 18, marketCapScore: 12, securityScore: 10, topHolderScore: 14, marketActivityScore: 10 },
  RWA: { founderActivity: 10, transparency: 10, securityScore: 14, liquidityScore: 14, tokenAgeScore: 10 },
  Privacy: { securityScore: 14, githubScore: 10, tokenAgeScore: 12, holderScore: 10, topHolderScore: 14 },
};

// Liquidity relative to market cap, plus pool concentration — a deep pool
// spread across many venues is healthier than the same liquidity sitting in
// one fragile pool.
export function scoreLiquidityQuality(liquidityUsd, marketCapUsd, poolCount) {
  const liquidity = Number(liquidityUsd || 0);
  const marketCap = Number(marketCapUsd || 0);
  if (!liquidity || !marketCap) return null;
  const ratio = liquidity / marketCap;
  let score;
  if (ratio >= 0.15) score = 92;
  else if (ratio >= 0.08) score = 78;
  else if (ratio >= 0.03) score = 60;
  else if (ratio >= 0.01) score = 40;
  else score = 18;
  if (typeof poolCount === 'number' && poolCount > 0) {
    if (poolCount === 1) score -= 8;
    else if (poolCount >= 3) score += 5;
  }
  return clamp(Math.round(score), 5, 95);
}

// Flags volume far exceeding liquidity (wash trading / artificial pump risk)
// vs. healthy organic turnover. Distinct from the existing scoreMarketActivity,
// which only rewards turnover — this one specifically penalizes the
// "low liquidity + huge volume" manipulation shape.
export function scoreVolumeLiquidityConsistency(volume24hUsd, liquidityUsd) {
  const volume = Number(volume24hUsd || 0);
  const liquidity = Number(liquidityUsd || 0);
  if (!volume || !liquidity) return null;
  const ratio = volume / liquidity;
  if (ratio > 20) return 10;
  if (ratio > 8) return 30;
  if (ratio > 3) return 55;
  if (ratio >= 0.05) return 88;
  return 50;
}

export function scoreVolatility(priceChange1h, priceChange24h, priceChange7d) {
  const moves = [priceChange1h, priceChange24h, priceChange7d].filter((v) => typeof v === 'number');
  if (!moves.length) return null;
  const maxAbsMove = Math.max(...moves.map((v) => Math.abs(v)));
  if (maxAbsMove <= 5) return 90;
  if (maxAbsMove <= 15) return 74;
  if (maxAbsMove <= 35) return 52;
  if (maxAbsMove <= 70) return 28;
  return 10;
}

// "Survived a real market cycle" — drew down meaningfully from its ATH and
// is still trading, rather than being fresh off a launch pump.
export function scoreMarketMaturity(tokenAgeDays, priceChange30d, ath, priceUsd) {
  if (tokenAgeDays === null || tokenAgeDays === undefined) return null;
  let score;
  if (tokenAgeDays >= 730) score = 92;
  else if (tokenAgeDays >= 365) score = 80;
  else if (tokenAgeDays >= 180) score = 62;
  else if (tokenAgeDays >= 30) score = 40;
  else score = 18;
  if (typeof ath === 'number' && ath > 0 && typeof priceUsd === 'number' && priceUsd > 0) {
    const drawdown = (ath - priceUsd) / ath;
    if (drawdown >= 0.4 && drawdown < 0.95) score += 6; // survived a real correction
  }
  return clamp(Math.round(score), 5, 95);
}

// Rule-based manipulation pattern detection from already-fetched data only.
// A volume-to-pool-depth ratio is only evidence of wash trading when this pool
// is where the token's price discovery actually happens. For a large,
// independently-listed asset most volume is on venues that are not this pool,
// so a high ratio is ordinary market structure, not manipulation — the same
// exemption isLargeVerifiedAsset() already applies to the shallow-liquidity
// signal. Without this, every blue-chip scan raised a HIGH "wash-traded"
// flag that contradicted its own all-clear scam-risk verdict.
function hasWashTradeShape(data = {}) {
  if (isLargeVerifiedAsset(data)) return false;
  const liquidity = Number(data.totalLiquidityUsd ?? data.liquidityUsd ?? 0);
  const volume = Number(data.volume24hUsd || 0);
  return liquidity > 0 && volume > 0 && volume / liquidity > 10;
}

export function detectManipulationPattern(data = {}) {
  const flags = [];
  const liquidity = Number(data.totalLiquidityUsd ?? data.liquidityUsd ?? 0);
  if (hasWashTradeShape(data)) {
    flags.push('Trading volume is far larger than available liquidity — possible artificial or wash-traded activity');
  }
  if (typeof data.priceChange1h === 'number' && Math.abs(data.priceChange1h) > 40 && liquidity > 0 && liquidity < 50000) {
    flags.push('Extreme short-term price swing combined with thin liquidity — consistent with a manipulated pump or dump');
  }
  if (
    typeof data.tokenAgeDays === 'number' && data.tokenAgeDays < 14 &&
    typeof data.priceChange24h === 'number' && data.priceChange24h > 100
  ) {
    flags.push('Very new token with an extreme price spike — typical of pump-and-dump launches');
  }
  return flags;
}

function detectManipulationPatternKeys(data = {}) {
  const flags = [];
  const liquidity = Number(data.totalLiquidityUsd ?? data.liquidityUsd ?? 0);
  if (hasWashTradeShape(data)) {
    flags.push('volumeLiquidityMismatch');
  }
  if (typeof data.priceChange1h === 'number' && Math.abs(data.priceChange1h) > 40 && liquidity > 0 && liquidity < 50000) {
    flags.push('extremeSwingThinLiquidity');
  }
  if (
    typeof data.tokenAgeDays === 'number' && data.tokenAgeDays < 14 &&
    typeof data.priceChange24h === 'number' && data.priceChange24h > 100
  ) {
    flags.push('newTokenPriceSpike');
  }
  return flags;
}

const EXPECTED_FIELDS = [
  'marketCapUsd', 'totalLiquidityUsd', 'holderCount', 'topHolderPercent', 'topTenHolderPercent',
  'tokenAgeDays', 'volume24hUsd', 'mintAuthorityEnabled', 'freezeAuthorityEnabled', 'upgradeable',
  'coingeckoListed', 'websiteUrl', 'twitterUrl', 'telegramUrl', 'githubUrl', 'priceChange24h',
  'holderGrowthPercent', 'supply', 'poolCount', 'ath',
];

// Reports how much real data we actually have — never lowers trustScore by
// itself. Surfaced separately so a thin-data project isn't silently scored
// as risky when the real answer is "we just don't know yet."
export function computeConfidence(data = {}) {
  const missing = EXPECTED_FIELDS.filter((field) => {
    const value = data[field];
    return value === null || value === undefined || value === '';
  });
  const presentCount = EXPECTED_FIELDS.length - missing.length;
  const confidenceScore = clamp(Math.round((presentCount / EXPECTED_FIELDS.length) * 100), 0, 100);
  const label = confidenceScore >= 75 ? 'High' : confidenceScore >= 45 ? 'Medium' : 'Low';
  return { confidenceScore, label, missingFields: missing };
}

// Large, CoinGecko-verified assets (BTC, ETH, USDC, ...) have most of their real
// liquidity spread across exchanges and order books, not a single on-chain pool -
// a low pool-vs-marketcap ratio is meaningless for them, same exemption the
// existing engine already applies via isLargeVerifiedAsset in main.jsx.
function isLargeVerifiedAsset(data = {}) {
  return Boolean(data.coingeckoListed) && Number(data.marketCapUsd || 0) >= 50_000_000;
}

export function detectHiddenRisks(project = {}, data = {}, scores = {}, manipulationFlags = []) {
  const risks = [];
  if (typeof data.topHolderPercent === 'number' && data.topHolderPercent > 20 && data.topHolderPercent <= 35) {
    risks.push('Largest holder controls a notable share of supply — moderate whale concentration risk');
  }
  if (
    !isLargeVerifiedAsset(data) &&
    scores.liquidityQualityScore !== null && scores.liquidityQualityScore !== undefined && scores.liquidityQualityScore < 40
  ) {
    risks.push('Liquidity is shallow relative to market cap — large trades could move price significantly');
  }
  if (
    !isLargeVerifiedAsset(data) &&
    scores.volumeConsistencyScore !== null && scores.volumeConsistencyScore !== undefined && scores.volumeConsistencyScore < 55
  ) {
    risks.push('Trading volume looks inconsistent with available liquidity — possible artificial activity');
  }
  if (typeof data.tokenAgeDays === 'number' && data.tokenAgeDays < 30) {
    risks.push('Project is very new with little trading history to evaluate');
  }
  if (!hasValue(project.website) && !hasValue(project.twitter) && !hasValue(project.telegram)) {
    risks.push('No verifiable public presence (website, X/Twitter, or Telegram) was found');
  }
  if (data.mintAuthorityEnabled === null && data.freezeAuthorityEnabled === null && data.upgradeable === null) {
    risks.push('Contract security status (mint/freeze/upgrade authority) could not be confirmed');
  }
  if (scores.volatilityScore !== null && scores.volatilityScore !== undefined && scores.volatilityScore < 30) {
    risks.push('Price action has been extremely volatile over recent timeframes');
  }
  if (typeof data.topTenHolderPercent === 'number' && data.topTenHolderPercent > 55 && data.topTenHolderPercent <= 70) {
    risks.push('Top 10 wallets hold a large majority of supply — centralization risk');
  }
  manipulationFlags.forEach((flag) => risks.push(flag));
  return risks;
}

function detectHiddenRiskKeys(project = {}, data = {}, scores = {}, manipulationFlagKeys = []) {
  const risks = [];
  if (typeof data.topHolderPercent === 'number' && data.topHolderPercent > 20 && data.topHolderPercent <= 35) {
    risks.push('largestHolderModerate');
  }
  if (
    !isLargeVerifiedAsset(data) &&
    scores.liquidityQualityScore !== null && scores.liquidityQualityScore !== undefined && scores.liquidityQualityScore < 40
  ) {
    risks.push('shallowLiquidity');
  }
  if (scores.volumeConsistencyScore !== null && scores.volumeConsistencyScore !== undefined && scores.volumeConsistencyScore < 55) {
    risks.push('volumeInconsistent');
  }
  if (typeof data.tokenAgeDays === 'number' && data.tokenAgeDays < 30) {
    risks.push('veryNewProject');
  }
  if (!hasValue(project.website) && !hasValue(project.twitter) && !hasValue(project.telegram)) {
    risks.push('noPublicPresence');
  }
  if (data.mintAuthorityEnabled === null && data.freezeAuthorityEnabled === null && data.upgradeable === null) {
    risks.push('contractSecurityUnknown');
  }
  if (scores.volatilityScore !== null && scores.volatilityScore !== undefined && scores.volatilityScore < 30) {
    risks.push('extremeVolatility');
  }
  if (typeof data.topTenHolderPercent === 'number' && data.topTenHolderPercent > 55 && data.topTenHolderPercent <= 70) {
    risks.push('topTenCentralization');
  }
  manipulationFlagKeys.forEach((flag) => risks.push(flag));
  return risks;
}

// Severity taxonomy for hidden-risk signals (Phase 2 evidence surfacing). Lets
// the UI show HOW serious each detected risk is, instead of a flat list where a
// cosmetic concern looks as alarming as a rug-pull pattern. Keyed by the stable
// signal keys emitted by detectHiddenRiskKeys / detectManipulationPatternKeys,
// so it is language-independent. Unknown keys default to 'medium' (never
// silently 'low') so a new signal is never under-stated.
export const SIGNAL_SEVERITY = {
  // Active manipulation / imminent-loss patterns.
  volumeLiquidityMismatch: 'high',
  extremeSwingThinLiquidity: 'high',
  newTokenPriceSpike: 'high',
  extremeVolatility: 'high',
  topTenCentralization: 'high',
  // Structural weaknesses worth heeding but not acute.
  shallowLiquidity: 'medium',
  volumeInconsistent: 'medium',
  largestHolderModerate: 'medium',
  veryNewProject: 'medium',
  noPublicPresence: 'medium',
  contractSecurityUnknown: 'medium',
};

export function severityForSignalKey(key) {
  return SIGNAL_SEVERITY[key] || 'medium';
}

// Ranks a set of signal keys most-severe first and tags each with its severity,
// so the UI can both order and label them. Returns [{ key, severity }].
export function rankSignalsBySeverity(keys = []) {
  const order = { high: 0, medium: 1, low: 2 };
  return keys
    .map((key) => ({ key, severity: severityForSignalKey(key) }))
    .sort((a, b) => order[a.severity] - order[b.severity]);
}

// ── Evidence weighting (analyst layer, NOT the UI) ────────────────────────────
//
// The UI's three-tier severity chip (above) is deliberately coarse. The analyst
// prose, by contrast, should spend its attention in PROPORTION to how much each
// piece of evidence actually moves a buyer's decision — a mint authority that
// lets the deployer print unlimited supply is not the same order of concern as
// a missing Telegram link. This five-tier weighting exists only to shape the
// reasoning; it never renders a chip and never touches a score.
//
//   critical — a live loss vector or active manipulation (infinite mint, a
//              majority holder, wash-traded volume, no exit liquidity).
//   high     — a serious structural weakness (freeze authority, extreme
//              volatility, deep top-10 centralisation, an upgradeable contract).
//   medium   — a real but survivable concern (thin liquidity, a young token).
//   low      — weak evidence worth a mention but not weight (mere link presence).
//   noise    — cosmetic; the analyst is told to ignore it entirely.
//
// Keyed by the SAME stable signal keys the rest of the engine emits (hidden
// risks, manipulation flags, scam reasons, and positive signals), so it is
// language-independent and cannot drift from the detectors.
export const EVIDENCE_WEIGHTS = {
  // Negative — live loss vectors / active manipulation.
  mintAuthorityEnabled: 'critical',
  topHolderConcentration: 'critical',
  noLiquidityFound: 'critical',
  volumeLiquidityMismatch: 'critical',
  extremeSwingThinLiquidity: 'critical',
  newTokenPriceSpike: 'critical',
  // Negative — serious structural weaknesses.
  freezeAuthorityEnabled: 'high',
  contractUpgradeable: 'high',
  topTenConcentration: 'high',
  topTenCentralization: 'high',
  extremeVolatility: 'high',
  extremelyLowLiquidity: 'high',
  // Negative — real but survivable.
  shallowLiquidity: 'medium',
  volumeInconsistent: 'medium',
  largestHolderModerate: 'medium',
  veryNewProject: 'medium',
  veryNewToken: 'medium',
  noSocialPresence: 'medium',
  noPublicPresence: 'medium',
  // Negative — absence of confirmation, not a positive finding.
  contractSecurityUnknown: 'low',

  // Positive — removes a loss vector or proves resilience.
  authoritiesDisabled: 'high',
  deepLiquidity: 'high',
  tradedOverYear: 'high',
  wellDistributedSupply: 'high',
  // Positive — supportive but not decisive.
  coingeckoVerified: 'medium',
  holderGrowth: 'medium',
  stablePrice: 'medium',
  // Positive — necessary hygiene, weak on its own.
  activePublicPresence: 'low',
};

export const EVIDENCE_TIER_ORDER = { critical: 0, high: 1, medium: 2, low: 3, noise: 4 };

// Weight for a positive key defaults to 'low' (a new positive is weak until
// classified); a negative key defaults to 'medium' (a new risk is never
// silently trivialised). `kind` disambiguates the default only.
export function weightForEvidenceKey(key, kind = 'negative') {
  return EVIDENCE_WEIGHTS[key] || (kind === 'positive' ? 'low' : 'medium');
}

// Turns the engine's raw signal lists into a single, impact-ranked evidence
// ledger split into the BULL and BEAR case — the pre-work an analyst does before
// writing a word. Each side is ordered strongest-first so the narrative can lead
// with what matters and, per the "ignore cosmetic signals" rule, the model is
// handed the weights it needs to do exactly that. Text + keys arrive parallel
// from the detectors; dedup is on text so the same concern surfaced by two
// detectors (e.g. a hidden-risk AND a scam reason) is weighed once.
export function rankEvidence({
  positiveKeys = [], positiveTexts = [],
  riskKeys = [], riskTexts = [],
  scamKeys = [], scamTexts = [],
} = {}) {
  const pack = (keys, texts, kind) => {
    const seen = new Set();
    const out = [];
    const max = Math.max(keys.length, texts.length);
    for (let i = 0; i < max; i += 1) {
      const text = (texts[i] || '').trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      out.push({ kind, key: keys[i] || null, text, weight: weightForEvidenceKey(keys[i], kind) });
    }
    return out;
  };
  const sort = (list) => list.sort((a, b) => EVIDENCE_TIER_ORDER[a.weight] - EVIDENCE_TIER_ORDER[b.weight]);

  const bull = sort(pack(positiveKeys, positiveTexts, 'positive'));
  // Bear pools hidden-risk signals and scam reasons, then dedups by text so an
  // overlap between the two detectors is never double-counted in the narrative.
  const bearRaw = [...pack(riskKeys, riskTexts, 'negative'), ...pack(scamKeys, scamTexts, 'negative')];
  const bearSeen = new Set();
  const bear = sort(bearRaw.filter((entry) => {
    if (bearSeen.has(entry.text)) return false;
    bearSeen.add(entry.text);
    return true;
  }));
  return { bull, bear };
}

// Conflicting-signal detection — the part a generic summary misses. A real
// analyst's value is not listing strengths and risks side by side; it is
// noticing when they point in OPPOSITE directions and saying which one wins.
// Each rule fires only when BOTH sides of the tension are actually observed
// (never on missing data), and is tagged with the side that should dominate the
// read. Pure and deterministic: it reasons over numbers the engine already
// produced, and invents nothing. Returns [{ key, severity, text }].
export function detectSignalConflicts(project = {}, data = {}, scores = {}) {
  const conflicts = [];
  const liq = Number(data.totalLiquidityUsd ?? data.liquidityUsd ?? 0);
  const topHolder = typeof data.topHolderPercent === 'number' ? data.topHolderPercent : null;
  const holders = Number(data.holderCount ?? project.holders ?? 0);
  const age = typeof data.tokenAgeDays === 'number' ? data.tokenAgeDays : null;
  const liqQ = scores.liquidityQualityScore;
  const volC = scores.volumeConsistencyScore;
  const vol = scores.volatilityScore;

  // Deep-looking pool sitting under a dominant wallet: the exit depth is real
  // only until that wallet sells into it.
  if (liqQ !== null && liqQ !== undefined && liqQ >= 70 && topHolder !== null && topHolder > 35) {
    conflicts.push({
      key: 'deepLiquidityVsConcentration',
      severity: 'high',
      text: `Liquidity looks healthy, but a single wallet controls ${topHolder.toFixed(1)}% of supply — that exit depth could evaporate if the top holder sells, so the concentration risk dominates the read.`,
    });
  }
  // An established token that never gave up deployer control is anomalous —
  // legitimate long-lived projects almost always renounce.
  if (age !== null && age >= 365 && (data.mintAuthorityEnabled === true || data.freezeAuthorityEnabled === true)) {
    const which = data.mintAuthorityEnabled === true && data.freezeAuthorityEnabled === true
      ? 'mint and freeze'
      : data.mintAuthorityEnabled === true ? 'mint' : 'freeze';
    conflicts.push({
      key: 'establishedVsLiveAuthority',
      severity: 'high',
      text: `The token has traded for over a year yet still leaves ${which} authority enabled — unusual for an established project, and a control risk that offsets the reassurance of its age.`,
    });
  }
  // A broad holder base does not make wash-shaped volume organic.
  if (holders >= 1000 && volC !== null && volC !== undefined && volC < 40) {
    conflicts.push({
      key: 'holderBaseVsWashVolume',
      severity: 'medium',
      text: `A broad holder base coexists with volume far out of line with liquidity — the trading activity may be inorganic despite the healthy holder count, so treat the volume as unverified.`,
    });
  }
  // Calm price on a shallow pool is fragile calm, not stability.
  if (vol !== null && vol !== undefined && vol >= 74 && liqQ !== null && liqQ !== undefined && liqQ < 40) {
    conflicts.push({
      key: 'stablePriceVsThinLiquidity',
      severity: 'medium',
      text: `Recent price looks stable, but it sits on shallow liquidity — that calm is fragile, and a single sizeable trade could move the price sharply.`,
    });
  }
  return conflicts;
}

export function detectPositiveSignals(project = {}, data = {}, scores = {}) {
  const positives = [];
  if (typeof data.topHolderPercent === 'number' && data.topHolderPercent <= 10) {
    positives.push('Supply is well distributed — no single wallet dominates holdings');
  }
  if (scores.liquidityQualityScore !== null && scores.liquidityQualityScore !== undefined && scores.liquidityQualityScore >= 78) {
    positives.push('Liquidity is deep relative to market cap, supporting healthy price stability');
  }
  if (typeof data.tokenAgeDays === 'number' && data.tokenAgeDays >= 365) {
    positives.push('Project has traded for over a year, surviving multiple market conditions');
  }
  if (scores.volatilityScore !== null && scores.volatilityScore !== undefined && scores.volatilityScore >= 74) {
    positives.push('Price has remained relatively stable across recent timeframes');
  }
  if (data.mintAuthorityEnabled === false && data.freezeAuthorityEnabled === false) {
    positives.push('Mint and freeze authority are confirmed disabled — supply and transfers cannot be unilaterally controlled');
  }
  if (hasValue(project.website) && hasValue(project.twitter) && hasValue(project.github)) {
    positives.push('Team maintains an active public presence across website, social, and code repositories');
  }
  if (data.coingeckoListed) {
    positives.push('Listed and verified on an independent research platform (CoinGecko)');
  }
  if (typeof data.holderGrowthPercent === 'number' && data.holderGrowthPercent >= 5) {
    positives.push('Holder count is growing steadily, indicating organic community growth');
  }
  return positives;
}

function detectPositiveSignalKeys(project = {}, data = {}, scores = {}) {
  const positives = [];
  if (typeof data.topHolderPercent === 'number' && data.topHolderPercent <= 10) {
    positives.push('wellDistributedSupply');
  }
  if (scores.liquidityQualityScore !== null && scores.liquidityQualityScore !== undefined && scores.liquidityQualityScore >= 78) {
    positives.push('deepLiquidity');
  }
  if (typeof data.tokenAgeDays === 'number' && data.tokenAgeDays >= 365) {
    positives.push('tradedOverYear');
  }
  if (scores.volatilityScore !== null && scores.volatilityScore !== undefined && scores.volatilityScore >= 74) {
    positives.push('stablePrice');
  }
  if (data.mintAuthorityEnabled === false && data.freezeAuthorityEnabled === false) {
    positives.push('authoritiesDisabled');
  }
  if (hasValue(project.website) && hasValue(project.twitter) && hasValue(project.github)) {
    positives.push('activePublicPresence');
  }
  if (data.coingeckoListed) {
    positives.push('coingeckoVerified');
  }
  if (typeof data.holderGrowthPercent === 'number' && data.holderGrowthPercent >= 5) {
    positives.push('holderGrowth');
  }
  return positives;
}

// Memecoins are inherently sentiment-driven instruments — even with strong
// liquidity, age, and holder counts, they lack the underlying network
// utility, developer activity, and adoption that justify a Layer 1-grade
// score. This cap stops high market cap / high community size alone from
// disguising that speculative risk, per the "no near-parity with BTC/ETH/SOL"
// requirement.
// ── Speculative-asset maturity model ─────────────────────────────────────────
//
// REPLACES a binary `isEstablishedMemecoin()` that ANDed four thresholds
// (age >= 365 && liquidity >= 1M && marketCap >= 100M && holders >= 10k) and
// picked one of two ceilings: 35 or 70.
//
// Two things were wrong with it, and the second is the serious one:
//
//  1. Any single unavailable input collapsed the whole test. `tokenAgeDays`
//     was structurally unavailable for almost every SPL token (fixed in
//     src/lib/tokenAge.js), so essentially every memecoin failed at the first
//     clause and took the 35 ceiling.
//  2. A two-valued ceiling cannot rank. Measured on production data, BONK
//     ($256M cap, 1.0M holders, both authorities revoked, raw score 82) and a
//     minutes-old pump.fun launch with 15 holders and $3k of liquidity BOTH
//     resolved to exactly 35/100 "High Risk". A score that returns one constant
//     across the entire range it is asked about carries no information, and the
//     users who most need this product are precisely the ones scanning that
//     range.
//
// The model below grades maturity continuously across the dimensions that
// actually separate a survivable speculative asset from a rug, and maps it onto
// a ceiling band. The original intent is preserved exactly: the band TOPS OUT
// below the infrastructure tier, so no amount of market cap or community size
// can ever let a memecoin read as safe as BTC/ETH/SOL. What changes is that
// between "obvious rug" and "as safe as a memecoin ever gets" there are now
// gradations instead of a single value.
//
// Every dimension is independently nullable. An unavailable dimension is
// EXCLUDED from the weighted average rather than scored as zero — absence is
// not evidence of risk — but it also lowers coverage, and low coverage pulls
// the ceiling toward the conservative end (see `applyUncertaintyDiscount`).
// That is how "we don't know" stays conservative without being punitive.

// Piecewise-linear interpolation over [input, output] stops. Keeps each
// dimension's shape readable as data instead of a ladder of if-statements.
function interpolate(value, stops) {
  if (value <= stops[0][0]) return stops[0][1];
  const last = stops[stops.length - 1];
  if (value >= last[0]) return last[1];
  for (let i = 1; i < stops.length; i += 1) {
    const [x0, y0] = stops[i - 1];
    const [x1, y1] = stops[i];
    if (value <= x1) return y0 + ((value - x0) / (x1 - x0)) * (y1 - y0);
  }
  return last[1];
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Each entry: [weight, 0..1 sub-score or null].
// Weights sum to 100 when every dimension is available.
export function speculativeMaturityFactors(data = {}) {
  const age = numberOrNull(data.tokenAgeDays);
  const liquidity = numberOrNull(data.totalLiquidityUsd ?? data.liquidityUsd);
  const marketCap = numberOrNull(data.marketCapUsd);
  const holders = numberOrNull(data.holderCount);
  const topHolder = numberOrNull(data.topHolderPercent);
  const topTen = numberOrNull(data.topTenHolderPercent);

  // Authority status. Unknown stays null — an unconfirmed authority must never
  // be credited as revoked, and must never be assumed enabled either.
  let authority = null;
  const mint = data.mintAuthorityEnabled;
  const freeze = data.freezeAuthorityEnabled;
  const upgradeable = data.upgradeable;
  const known = [mint, freeze, upgradeable].filter((v) => v === true || v === false);
  if (known.length) {
    const enabled = known.filter((v) => v === true).length;
    // Any live authority is a unilateral-control risk and dominates: one
    // enabled authority cannot be averaged away by two revoked ones.
    authority = enabled === 0 ? 1 : enabled === known.length ? 0 : 0.3;
  }

  // Decentralization. Uses whichever concentration measures resolved; the
  // top-10 figure is the better signal when both are present.
  let decentralization = null;
  const parts = [];
  if (topHolder !== null) parts.push(interpolate(topHolder, [[2, 1], [8, 0.85], [15, 0.6], [25, 0.35], [40, 0.1], [60, 0]]));
  if (topTen !== null) parts.push(interpolate(topTen, [[15, 1], [30, 0.85], [45, 0.6], [60, 0.35], [80, 0.1], [95, 0]]));
  if (parts.length) decentralization = Math.min(...parts);

  return {
    // A lower-bound age (resolved from earliest observed liquidity) is safe to
    // use here: it can only ever understate how old the token is, so it can
    // never make a new token look mature.
    age: [22, age === null ? null : interpolate(age, [[0, 0], [7, 0.05], [30, 0.2], [90, 0.38], [180, 0.52], [365, 0.72], [730, 0.9], [1095, 1]])],
    liquidity: [20, liquidity === null ? null : interpolate(liquidity, [[0, 0], [10_000, 0.05], [50_000, 0.2], [250_000, 0.42], [1_000_000, 0.65], [5_000_000, 0.85], [20_000_000, 1]])],
    marketCap: [12, marketCap === null ? null : interpolate(marketCap, [[0, 0], [100_000, 0.05], [1_000_000, 0.2], [10_000_000, 0.45], [100_000_000, 0.7], [1_000_000_000, 0.9], [5_000_000_000, 1]])],
    holders: [16, holders === null ? null : interpolate(holders, [[0, 0], [100, 0.08], [1_000, 0.25], [10_000, 0.5], [100_000, 0.75], [500_000, 0.95], [1_000_000, 1]])],
    authority: [15, authority],
    decentralization: [15, decentralization],
  };
}

// The 0..100 maturity index, plus how much of the model we could actually
// evaluate. `coverage` is the share of total weight that resolved.
export function speculativeMaturity(data = {}) {
  const factors = speculativeMaturityFactors(data);
  let weighted = 0;
  let resolvedWeight = 0;
  let totalWeight = 0;
  for (const [weight, value] of Object.values(factors)) {
    totalWeight += weight;
    if (value === null) continue;
    resolvedWeight += weight;
    weighted += weight * value;
  }
  const coverage = totalWeight > 0 ? resolvedWeight / totalWeight : 0;
  // No dimension resolved at all: maturity is unknown, and unknown is treated
  // as immature. This is the one place absence IS conservative, deliberately —
  // a token we know literally nothing about does not get the benefit of doubt.
  const index = resolvedWeight > 0 ? weighted / resolvedWeight : 0;
  return { index, coverage, factors };
}

// Wash-trading style activity is a real ceiling risk on a thin token and noise
// on a deep one: a top-20 asset routinely turns over many multiples of its
// on-chain pool depth because most of its volume is on venues that are not
// this pool. So the penalty scales with how much the token's own depth
// suggests the ratio is meaningful.
function tradingBehaviourPenalty(data = {}) {
  const liquidity = Number(data.totalLiquidityUsd ?? data.liquidityUsd ?? 0);
  const volume = Number(data.volume24hUsd || 0);
  if (!(liquidity > 0 && volume > 0)) return 0;
  const ratio = volume / liquidity;
  if (ratio <= 10) return 0;
  // Exempt genuinely large, independently-listed assets for the same reason
  // isLargeVerifiedAsset() already exempts them from the shallow-liquidity
  // signal: their price discovery does not happen in this pool.
  if (isLargeVerifiedAsset(data)) return 0;
  return interpolate(ratio, [[10, 0], [25, 6], [60, 12], [150, 18]]);
}

// Low coverage pulls the ceiling toward the conservative end of the band,
// proportionally. Full coverage costs nothing; knowing almost nothing costs
// most of what the model would otherwise have granted above the floor.
function applyUncertaintyDiscount(ceiling, floor, coverage) {
  const headroom = ceiling - floor;
  // Coverage at or above 0.8 is treated as complete — the model should not
  // penalise a token for a single provider being down.
  const factor = clamp(coverage / 0.8, 0, 1);
  return floor + headroom * factor;
}

// A CONFIRMED-live authority is a hard ceiling, not a weighted factor.
//
// A live mint authority means the deployer can create unlimited new supply at
// any moment. No amount of age, liquidity, holder count or market cap offsets
// that — those measure what the token HAS done, and this describes what its
// controller can still do unilaterally, today. Treating it as one weighted
// input among six would let a mature token average it away, which is exactly
// the shape of a slow rug on an established name.
//
// Only a CONFIRMED `true` gates. Unknown (null) never gates — that is handled
// as reduced coverage by the uncertainty discount, not as an accusation.
export const AUTHORITY_HARD_CEILING = { mint: 45, freeze: 55, upgradeable: 60 };

function authorityHardCeiling(data = {}) {
  const ceilings = [];
  if (data.mintAuthorityEnabled === true) ceilings.push(AUTHORITY_HARD_CEILING.mint);
  if (data.freezeAuthorityEnabled === true) ceilings.push(AUTHORITY_HARD_CEILING.freeze);
  if (data.upgradeable === true) ceilings.push(AUTHORITY_HARD_CEILING.upgradeable);
  return ceilings.length ? Math.min(...ceilings) : null;
}

// Exact identifiers for the top blue-chip Layer 1s. Matching used to be a loose
// substring test (text.includes('eth') etc.), which let a name-squatting token
// — "Ethereum Max", "Solend", "Wrapped X" — inherit the 95 trust ceiling just
// by containing 'eth'/'sol' in its name. Now the token must present the ACTUAL
// blue-chip ticker or full name, so the top ceiling is resistant to that
// impersonation. This only ever makes look-alikes score MORE conservatively.
const BLUE_CHIP_TICKERS = new Set(['btc', 'eth', 'sol', 'bnb']);
const BLUE_CHIP_NAMES = new Set(['bitcoin', 'ethereum', 'solana', 'binance coin', 'bnb']);

function isMajorBlueChip(project = {}, data = {}) {
  const ticker = String(project.ticker || '').trim().toLowerCase();
  const name = String(project.name || '').trim().toLowerCase();
  const isBlueChip = BLUE_CHIP_TICKERS.has(ticker) || BLUE_CHIP_NAMES.has(name);
  return isBlueChip && Number(data.marketCapUsd || 0) >= 5_000_000_000;
}

// The "Asset Type Risk Modifier" — caps the final Trust Score by asset
// category so popularity/market cap alone can never make a speculative
// asset (a memecoin) read as safe as infrastructure-grade assets (BTC, ETH,
// SOL, BNB). This is the only place a category is allowed to put a ceiling
// on the score; it never lowers a score below what the underlying data
// already produced, it only prevents the score from exceeding what that
// asset class can credibly earn.
export function getAssetTypeRiskModifier(category, project = {}, data = {}) {
  if (category === 'Meme Token') {
    // The band. FLOOR: no memecoin, however clean its data, is ever a low-risk
    // asset — it has no underlying utility and the ceiling says so. TOP: stays
    // below the Utility/DeFi tier (85) and far below infrastructure (92) and
    // blue-chip L1 (95), so market cap and community size still cannot buy a
    // memecoin an infrastructure-grade score. That was the original rule and it
    // is unchanged; what is new is that the space between the two ends is now
    // graded rather than collapsed onto a single value.
    const MEME_FLOOR = 30;
    const MEME_TOP = 82;
    const { index, coverage } = speculativeMaturity(data);
    const graded = MEME_FLOOR + (MEME_TOP - MEME_FLOOR) * index;
    const discounted = applyUncertaintyDiscount(graded, MEME_FLOOR, coverage);
    const penalty = tradingBehaviourPenalty(data);
    const hardCeiling = authorityHardCeiling(data);
    const gated = hardCeiling === null ? discounted : Math.min(discounted, hardCeiling);
    const cap = Math.round(clamp(gated - penalty, MEME_FLOOR, MEME_TOP));

    const maturityPercent = Math.round(index * 100);
    // Tiering is for the human-readable label only — the cap itself is
    // continuous, so two tokens in the same tier still receive different
    // ceilings.
    const tier = cap >= 70 ? 'proven' : cap >= 55 ? 'maturing' : cap >= 42 ? 'early' : 'unproven';
    const labels = {
      proven: 'Proven memecoin',
      maturing: 'Maturing memecoin',
      early: 'Early-stage memecoin',
      unproven: 'New / unproven memecoin',
    };
    const explanations = {
      proven: `This memecoin has a sustained track record — age, liquidity depth, holder base, contract authorities and supply distribution all check out (maturity ${maturityPercent}/100). It still has no underlying network utility and is driven by sentiment, so its Trust Score is capped at ${cap}/100: this is as strong as a speculative asset can score, not a safety rating.`,
      maturing: `This memecoin shows real staying power on some measures but not all (maturity ${maturityPercent}/100). Its Trust Score is capped at ${cap}/100 to reflect speculative risk that a growing market cap does not remove.`,
      early: `This memecoin is still early: its age, liquidity, holder base or supply distribution do not yet show a sustained track record (maturity ${maturityPercent}/100). Its Trust Score is capped at ${cap}/100.`,
      unproven: `This memecoin has little verifiable history, thin liquidity, a concentrated holder base, or live contract authorities (maturity ${maturityPercent}/100). Speculative risk is severe, so its Trust Score is capped at ${cap}/100.`,
    };
    return {
      cap,
      isSpeculative: true,
      label: labels[tier],
      // Flat key — the i18n lookup in khanAnalyst.js indexes
      // `askKhan.answers.modifiers.<key>` directly, so it must not be dotted.
      explanationKey: `memecoin${tier.charAt(0).toUpperCase()}${tier.slice(1)}`,
      explanation: explanations[tier],
      maturityIndex: maturityPercent,
      maturityCoverage: Math.round(coverage * 100),
      tradingBehaviourPenalty: Math.round(penalty),
      authorityHardCeiling: hardCeiling,
    };
  }
  if (category === 'Layer 1' && isMajorBlueChip(project, data)) {
    return {
      cap: 95,
      isSpeculative: false,
      label: 'Major Layer 1 infrastructure',
      explanationKey: 'majorLayer1',
      explanation: 'This is a major Layer 1 blockchain with established infrastructure, deep liquidity, sustained developer activity, and real long-term network utility — evaluated against infrastructure-grade criteria, not speculative-asset criteria.',
    };
  }
  if (['Layer 1', 'Layer 2', 'Infrastructure'].includes(category)) {
    return {
      cap: 92,
      isSpeculative: false,
      label: 'Infrastructure asset',
      explanationKey: 'infrastructure',
      explanation: `Classified as ${category} infrastructure. The score reflects network utility, developer activity, and adoption rather than hype-driven demand.`,
    };
  }
  if (['DeFi', 'Utility Token', 'AI', 'RWA', 'Privacy', 'Exchange Token'].includes(category)) {
    return {
      cap: 85,
      isSpeculative: false,
      label: 'Utility / DeFi asset',
      explanationKey: 'utilityDefi',
      explanation: `Classified as a ${category} project with real protocol utility. It is capped below the major infrastructure tier because its adoption and longevity are comparatively less proven than a top Layer 1.`,
    };
  }
  if (category === 'Stablecoin') {
    return {
      cap: 95,
      isSpeculative: false,
      label: 'Stablecoin',
      explanationKey: 'stablecoin',
      explanation: 'Classified as a stablecoin; evaluated on peg stability, reserve transparency, and redemption mechanics rather than price-speculation risk.',
    };
  }
  if (category === 'Gaming') {
    return {
      cap: 80,
      isSpeculative: true,
      label: 'Gaming / metaverse token',
      explanationKey: 'gaming',
      explanation: 'Classified as a gaming/metaverse token. These projects mix real product development with significant speculative hype, so the score is capped below established infrastructure assets.',
    };
  }
  return {
    cap: 90,
    isSpeculative: false,
    label: category,
    explanationKey: 'default',
    explanation: `Classified as ${category}. No asset-type ceiling beyond standard scoring applies, but the score is still capped below blue-chip Layer 1 infrastructure.`,
  };
}

// Applies the cap above to an already-computed weighted score. Never raises
// a score — only prevents it from exceeding what its asset class can
// credibly support.
export function applyAssetTypeRiskModifier(category, project, data, rawScore) {
  const modifier = getAssetTypeRiskModifier(category, project, data);
  const adjustedScore = clamp(Math.min(rawScore, modifier.cap), 5, 100);
  return { ...modifier, adjustedScore, rawScore, capApplied: adjustedScore < rawScore };
}

function buildRiskSummary({ category, riskLevel, hiddenRisks, positiveSignals, confidence, assetTypeModifier }) {
  const parts = [];
  parts.push(`Classified as a ${category} asset with an overall ${riskLevel.toLowerCase()} risk rating.`);
  if (assetTypeModifier?.explanation) {
    parts.push(assetTypeModifier.explanation);
    if (assetTypeModifier.capApplied) {
      parts.push(`The raw data-driven score of ${assetTypeModifier.rawScore} was capped to ${assetTypeModifier.adjustedScore} to reflect this asset-type risk ceiling.`);
    }
  }
  if (positiveSignals.length) {
    parts.push(`Strengths: ${positiveSignals.slice(0, 3).join('; ')}.`);
  }
  if (hiddenRisks.length) {
    parts.push(`Areas of concern: ${hiddenRisks.slice(0, 3).join('; ')}.`);
  } else {
    parts.push('No significant hidden risk patterns were detected in the available data.');
  }
  parts.push(`Confidence in this analysis is ${confidence.label.toLowerCase()} (${confidence.confidenceScore}% of expected data points were available)${confidence.missingFields.length ? `; missing: ${confidence.missingFields.slice(0, 5).join(', ')}` : ''}.`);
  return parts.join(' ');
}

// Main orchestrator — purely additive. Takes the already-computed score
// breakdown + riskLevel (from the existing, untouched engine) plus raw
// project/data, and returns extra fields to merge into the normalized
// project. Never mutates or recomputes trustScore/riskLevel itself.
export function runRiskAnalysis(project = {}, data = {}, scoreBreakdown = {}, riskLevel = 'Medium', scoreInfo = null) {
  const { category, confidence: categoryConfidence } = classifyAsset(project, data);
  const liquidityUsd = data.totalLiquidityUsd ?? data.liquidityUsd;

  const extraScores = {
    liquidityQualityScore: scoreLiquidityQuality(liquidityUsd, data.marketCapUsd, data.poolCount),
    volumeConsistencyScore: scoreVolumeLiquidityConsistency(data.volume24hUsd, liquidityUsd),
    volatilityScore: scoreVolatility(data.priceChange1h, data.priceChange24h, data.priceChange7d),
    marketMaturityScore: scoreMarketMaturity(data.tokenAgeDays, data.priceChange30d, data.ath, data.priceUsd),
  };

  const manipulationFlags = detectManipulationPattern(data);
  const manipulationFlagKeys = detectManipulationPatternKeys(data);
  const confidence = computeConfidence(data);
  const hiddenRiskSignals = detectHiddenRisks(project, data, extraScores, manipulationFlags);
  const hiddenRiskSignalKeys = detectHiddenRiskKeys(project, data, extraScores, manipulationFlagKeys);
  const positiveSignals = detectPositiveSignals(project, data, extraScores);
  const positiveSignalKeys = detectPositiveSignalKeys(project, data, extraScores);
  const signalConflicts = detectSignalConflicts(project, data, extraScores);
  const assetTypeModifier = scoreInfo
    ? applyAssetTypeRiskModifier(category, project, data, scoreInfo.rawScore)
    : getAssetTypeRiskModifier(category, project, data);
  const aiRiskSummary = buildRiskSummary({ category, riskLevel, hiddenRisks: hiddenRiskSignals, positiveSignals, confidence, assetTypeModifier });

  return {
    assetCategory: category,
    assetCategoryConfidence: categoryConfidence,
    assetTypeRiskModifier: assetTypeModifier,
    confidenceScore: confidence.confidenceScore,
    confidenceLabel: confidence.label,
    missingDataFields: confidence.missingFields,
    hiddenRiskSignals,
    hiddenRiskSignalKeys,
    positiveSignals,
    positiveSignalKeys,
    signalConflicts,
    aiRiskSummary,
    deepScores: extraScores,
  };
}
