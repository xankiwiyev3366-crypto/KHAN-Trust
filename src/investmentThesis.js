// AI Investment Thesis — the SYNTHESIS layer of the KHAN Trust report.
//
// WHY THIS EXISTS AND WHAT IT DELIBERATELY IS NOT
//
// The report already carries two Premium AI prose cards:
//   - Advanced AI Research (src/premiumResearch.js buildAdvancedResearch) — the
//     engine's detected strengths / weaknesses / risk signals, one line each.
//   - Premium AI Analysis (buildPremiumAnalysis) — bullish / bearish signals,
//     confidence, data quality, recommendations.
//
// Both operate at the level of INDIVIDUAL SIGNALS. This module operates one
// altitude higher, and that is the whole reason it is allowed to exist without
// duplicating them: it does NOT re-list signal strings. It aggregates the
// engine's already-computed CATEGORY SCORES (scoreBreakdown + deepScores) into
// investment DIMENSIONS, and from that aggregate produces four things that
// appear nowhere else in the platform:
//
//   1. A single AI Conviction Level (Low / Moderate / High) — a synthesized
//      investment verdict. No other card computes this.
//   2. Growth Catalysts — forward-looking drivers. No other card is forward
//      looking; every other card describes the present.
//   3. An institutional Overall Thesis narrative (150–300 words).
//   4. Investor considerations and investment risks framed at the DIMENSION
//      level ("liquidity depth", "distribution health") with the investment
//      IMPLICATION, not the raw signal text the other cards already show.
//
// GROUNDING — same contract as premiumResearch.js
//
// Nothing here calls an LLM and nothing here computes a new score. Every number
// used is one the scoring engine already produced (trustScore, confidenceScore,
// scoreBreakdown.*, deepScores.*, scamRisk.*, realData.*). This module cannot
// assert anything the engine did not measure, and it cannot contradict the
// verdicts the rest of the report renders. It is complete and correct on its
// own, exactly like the deterministic floor the other Premium cards stand on.
import { translate as t } from './i18n/index.js';

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function realData(project) {
  return project.realData || {};
}

function formatUsd(value) {
  const n = num(value);
  if (n === null || n <= 0) return null;
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

// Lowest non-null of a set of engine scores — used where several fine-grained
// scores describe one investment dimension (e.g. distribution is the WORST of
// top-holder / top-ten / holder-count health, because the weakest link is what
// an investor is exposed to).
function worstScore(...scores) {
  const present = scores.map(num).filter((s) => s !== null);
  return present.length ? Math.min(...present) : null;
}

function firstScore(...scores) {
  for (const s of scores) {
    const n = num(s);
    if (n !== null) return n;
  }
  return null;
}

// ── Investment dimensions ─────────────────────────────────────────────────────
//
// Each dimension maps to engine scores that already exist. `value` is a measured
// figure to cite in the investment-framed sentence (never recomputed — read
// straight off realData). A dimension with a null score is simply absent from
// the thesis rather than guessed at, consistent with the engine's Unknown≠Bad
// policy.
function buildDimensions(project) {
  const sb = project.scoreBreakdown || {};
  const deep = project.deepScores || {};
  const d = realData(project);

  const defs = [
    {
      key: 'liquidity',
      score: firstScore(deep.liquidityQualityScore, sb.liquidityScore),
      value: formatUsd(d.totalLiquidityUsd ?? d.liquidityUsd),
    },
    {
      key: 'distribution',
      score: worstScore(sb.topHolderScore, sb.topTenHolderScore, sb.holderScore),
      value: num(d.topHolderPercent) !== null ? `${num(d.topHolderPercent).toFixed(1)}%` : null,
    },
    {
      key: 'maturity',
      score: firstScore(deep.marketMaturityScore, sb.tokenAgeScore),
      value: num(d.tokenAgeDays) !== null ? Math.round(num(d.tokenAgeDays)).toLocaleString() : null,
    },
    {
      key: 'activity',
      score: firstScore(sb.marketActivityScore, deep.volumeConsistencyScore),
      value: formatUsd(d.volume24hUsd),
    },
    {
      key: 'security',
      score: firstScore(sb.securityScore),
      value: null,
    },
    {
      key: 'transparency',
      score: firstScore(sb.socialScore),
      value: null,
    },
    {
      key: 'stability',
      score: firstScore(deep.volatilityScore),
      value: null,
    },
  ];

  return defs
    .filter((dim) => dim.score !== null)
    .map((dim) => ({
      ...dim,
      tone: dim.score >= 70 ? 'strength' : dim.score <= 40 ? 'risk' : 'neutral',
    }));
}

// Investment-framed sentence for a dimension. The IMPLICATION for an investor,
// not the raw signal — this is what keeps the section from restating the other
// cards. Cites the measured value when one is available.
function dimensionLine(dim, tone) {
  const key = `investmentThesis.dimensions.${dim.key}.${tone}`;
  return dim.value
    ? t(key, { value: dim.value })
    : t(`investmentThesis.dimensions.${dim.key}.${tone}NoValue`);
}

// ── Section: Why investors may consider this project ──────────────────────────
// The strength dimensions, strongest first, expressed as investment reasons.
function investorReasons(dimensions) {
  return dimensions
    .filter((dim) => dim.tone === 'strength')
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((dim) => dimensionLine(dim, 'strength'));
}

// ── Section: Investment risks ─────────────────────────────────────────────────
// The risk dimensions, weakest first, plus two structural risks the dimension
// scores don't capture on their own (anonymous presence, very high top-holder
// concentration). Framed as investment risks, deduped, capped at 6.
function investmentRisks(project, dimensions) {
  const risks = dimensions
    .filter((dim) => dim.tone === 'risk')
    .sort((a, b) => a.score - b.score)
    .map((dim) => dimensionLine(dim, 'risk'));

  const d = realData(project);
  const topPct = num(d.topHolderPercent);
  if (topPct !== null && topPct > 50 && !dimensions.some((dim) => dim.key === 'distribution' && dim.tone === 'risk')) {
    risks.push(t('investmentThesis.risks.whaleConcentration', { value: `${topPct.toFixed(1)}%` }));
  }

  const noPresence = !d.websiteUrl && !d.twitterUrl && !d.telegramUrl && !project.website;
  if (noPresence) risks.push(t('investmentThesis.risks.anonymousTeam'));

  const deduped = [...new Set(risks)];
  return deduped.length ? deduped.slice(0, 6) : [t('investmentThesis.risks.none')];
}

// ── Section: Growth catalysts ─────────────────────────────────────────────────
// Forward-looking only. Nothing here describes the present state — each item is
// a plausible future DRIVER supported by a specific data condition. When no
// condition fires, the section says so plainly rather than inventing momentum.
function growthCatalysts(project) {
  const d = realData(project);
  const out = [];

  const growth = num(d.holderGrowthPercent);
  if (growth !== null && growth >= 5) {
    out.push(t('investmentThesis.catalysts.holderGrowth', { value: `${growth.toFixed(1)}%` }));
  }

  if (d.coingeckoListed) out.push(t('investmentThesis.catalysts.listingVisibility'));

  const age = num(d.tokenAgeDays);
  if (age !== null && age >= 180 && age < 365) out.push(t('investmentThesis.catalysts.approachingMaturity'));

  const liqQuality = num((project.deepScores || {}).liquidityQualityScore);
  const activity = num((project.scoreBreakdown || {}).marketActivityScore);
  if (liqQuality !== null && liqQuality >= 70 && activity !== null && activity >= 60) {
    out.push(t('investmentThesis.catalysts.deepeningLiquidity'));
  }

  const community = num(project.communitySize);
  if (community !== null && community >= 20000) out.push(t('investmentThesis.catalysts.communityScale'));

  if (d.githubUrl) out.push(t('investmentThesis.catalysts.activeDevelopment'));

  const deduped = [...new Set(out)].slice(0, 6);
  return { items: deduped, empty: deduped.length === 0 };
}

// ── AI Conviction Level ───────────────────────────────────────────────────────
//
// A single synthesized verdict. Deterministic and grounded: it is a function of
// the engine's Trust Score, the scam-risk level, data confidence, and the net
// balance of strong-vs-weak investment dimensions. It never exceeds what the
// evidence supports — thin data (Low confidence) can never yield High conviction,
// and a High scam-risk reading forces Low regardless of everything else.
function convictionLevel(project, dimensions) {
  const trust = num(project.trustScore) ?? 0;
  const confidence = num(project.confidenceScore) ?? 0;
  const scamLevel = String(project.scamRisk?.level || 'Low').toLowerCase();
  const strengths = dimensions.filter((dim) => dim.tone === 'strength').length;
  const risks = dimensions.filter((dim) => dim.tone === 'risk').length;
  const net = strengths - risks;

  const evidenceSufficient = confidence >= 45;

  let key;
  if (scamLevel === 'high' || trust < 40 || !evidenceSufficient) {
    key = 'low';
  } else if (trust >= 70 && net >= 2 && scamLevel === 'low') {
    key = 'high';
  } else if (trust >= 55 && net >= 0) {
    key = 'moderate';
  } else {
    key = 'low';
  }

  return {
    key,
    label: t(`investmentThesis.conviction.levels.${key}`),
    note: evidenceSufficient
      ? t(`investmentThesis.conviction.notes.${key}`)
      : t('investmentThesis.conviction.notes.insufficient'),
    evidenceSufficient,
  };
}

// ── Overall thesis narrative (150–300 words) ──────────────────────────────────
//
// Stitched from the same aggregates. Deliberately references the DIMENSION
// balance and the single conviction verdict — the synthesis — never the
// individual signal strings. Says plainly when it is stronger or weaker than an
// average profile, using the Trust Score against a neutral 50 baseline.
function overallNarrative(project, dimensions, conviction, catalysts) {
  const trust = num(project.trustScore) ?? 0;
  const risk = t(`common.${String(project.riskLevel || 'medium').toLowerCase()}`);
  const category = t(`askKhan.answers.assetCategories.${project.assetCategory || 'Other'}`);
  const confidence = t(`common.${String(project.confidenceLabel || 'medium').toLowerCase()}`);
  const strengthsSorted = dimensions.filter((dim) => dim.tone === 'strength').sort((a, b) => b.score - a.score);
  const risksSorted = dimensions.filter((dim) => dim.tone === 'risk').sort((a, b) => a.score - b.score);
  const dimName = (dim) => t(`investmentThesis.dimensionNames.${dim.key}`);

  const standing = trust >= 60 ? 'stronger' : trust >= 45 ? 'average' : 'weaker';

  const parts = [];
  parts.push(t('investmentThesis.narrative.opening', { category, score: trust, risk }));
  parts.push(t('investmentThesis.narrative.balance', {
    strengths: strengthsSorted.length,
    risks: risksSorted.length,
  }));
  if (strengthsSorted.length) {
    parts.push(t('investmentThesis.narrative.leadStrength', { dimension: dimName(strengthsSorted[0]) }));
    if (strengthsSorted.length > 1) {
      parts.push(t('investmentThesis.narrative.secondStrength', { dimension: dimName(strengthsSorted[1]) }));
    }
  }
  if (risksSorted.length) parts.push(t('investmentThesis.narrative.leadRisk', { dimension: dimName(risksSorted[0]) }));
  else parts.push(t('investmentThesis.narrative.noLeadRisk'));
  parts.push(catalysts.empty
    ? t('investmentThesis.narrative.catalystsNone')
    : t('investmentThesis.narrative.catalystsSummary', { count: catalysts.items.length }));
  parts.push(t(`investmentThesis.narrative.standing.${standing}`));
  parts.push(t('investmentThesis.narrative.confidenceLine', { confidence, score: num(project.confidenceScore) ?? 0 }));
  parts.push(t('investmentThesis.narrative.convictionLine', { conviction: conviction.label }));
  if (!conviction.evidenceSufficient) parts.push(t('investmentThesis.narrative.limitedData'));
  parts.push(t('investmentThesis.narrative.close'));
  return parts.join(' ');
}

// The public composer. One call builds the whole thesis from a computed project.
export function buildInvestmentThesis(project = {}) {
  const dimensions = buildDimensions(project);
  const conviction = convictionLevel(project, dimensions);
  const reasons = investorReasons(dimensions);
  const catalysts = growthCatalysts(project);
  const risks = investmentRisks(project, dimensions);
  const narrative = overallNarrative(project, dimensions, conviction, catalysts);

  return {
    reasons,
    reasonsEmpty: reasons.length === 0,
    catalysts: catalysts.items,
    catalystsEmpty: catalysts.empty,
    risks,
    conviction,
    narrative,
    // Surfaced so the card can honestly caveat a thin-data thesis rather than
    // presenting it with the same confidence as a data-complete one.
    evidenceSufficient: conviction.evidenceSufficient,
  };
}
