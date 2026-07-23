// Project model — normalization + verification/social/risk-flag helpers,
// extracted verbatim from src/main.jsx. normalizeProject turns a raw scanned or
// stored record into the canonical project shape the whole app renders, running
// it through the scoring/risk pipeline. The small helpers (applyVerificationStatus,
// linkPresenceState, syncSocialData, deriveRiskFlags) are the pure pieces that
// feed it. The verification UI (VerifiedBadge, badge config) stays in main.jsx.
import { translate } from '../i18n/index.js';
import { firstPresent, hasValue, scoreToRisk } from '../lib/trustScore.js';
import { runRiskAnalysis, classifyAsset, applyAssetTypeRiskModifier } from '../scoringEngine.js';
import { VERIFICATION_STATUS, normalizeVerificationStatus } from '../verification.js';
import { slugify } from '../format.js';
import { roadmapToText, roadmapFromText, buildUpdatesTimeline } from '../roadmap.js';
import { buildCanonicalRiskNotes, mergeRiskNotes } from '../providers/lookups.js';
import { calculateTrustScore, buildScoreBreakdown, buildCategoryBreakdown, calculateScamRisk } from './scoring.js';
import { riskFactors } from './riskModel.js';

export function normalizeProject(input) {
  const now = new Date().toISOString().slice(0, 10);
  const roadmapText = input.roadmapText || roadmapToText(input.roadmap);
  const rawRealData = input.realData || null;
  const realData = rawRealData ? syncSocialData(rawRealData, input) : null;
  const holders = Number(input.holders || input.holderCount || realData?.holderCount || 0);
  const communitySize = Number(input.communitySize || realData?.holderCount || 0);
  const baseProject = {
    id: input.id || `${slugify(input.name || 'project')}-${Date.now()}`,
    name: input.name || 'Untitled Project',
    ticker: input.ticker || 'N/A',
    chain: input.chain || 'Unknown',
    // Canonical chain id (registry key) for chain-aware UI: badge, explorer
    // links, and capability gating. Preserved from the lookup; for legacy
    // stored projects it is derived from the id prefix (`${chainId}-slug`),
    // which is safe because no chain id contains a hyphen. Solana stays the
    // default so pre-multichain records keep working unchanged.
    chainId: input.chainId || (typeof input.id === 'string' && input.id.includes('-') ? input.id.split('-')[0] : 'solana'),
    contract: input.contract || 'Not provided',
    website: firstPresent(input.website, realData?.websiteUrl) || 'Not provided',
    twitter: firstPresent(input.twitter, realData?.twitterUrl) || 'Not provided',
    telegram: firstPresent(input.telegram, realData?.telegramUrl) || 'Not provided',
    github: firstPresent(input.github, realData?.githubUrl) || 'Not provided',
    // Live-scanned tokens with a confirmed real launch date use it. A
    // live-scanned token whose real creation date is unknown must stay
    // unknown - defaulting it to "today" would fabricate a "brand new
    // token" age out of thin air. Only profiles with no live data at all
    // (manual Add Project entries) default the launch date to today.
    launchDate: input.launchDate || (rawRealData ? '' : now),
    description: input.description || 'No description provided yet.',
    mission: input.mission || '',
    status: input.status || 'User submitted',
    // Verification status is never trusted from user input (Add Project, Edit
    // Project, Launchpad). It always starts unverified here; the only way a
    // project becomes verified/pending/rejected is through the central
    // verification store applied in applyVerificationStatus() after admin
    // review - see src/verification.js and netlify/functions/verification-*.
    verificationStatus: VERIFICATION_STATUS.UNVERIFIED,
    lastUpdate: input.lastUpdate || now,
    logoUrl: input.logoUrl || '',
    createdBy: input.createdBy || '',
    network: input.network || '',
    launchpadSource: input.launchpadSource || '',
    transactionSignature: input.transactionSignature || '',
    tokenSupply: input.tokenSupply || '',
    tokenDecimals: input.tokenDecimals ?? '',
    founderStatus: input.founderStatus || 'Not provided',
    communitySize,
    holders,
    traders: Number(input.traders || Math.round(holders * 0.22)),
    realData,
    activityStatus: input.activityStatus || (communitySize > 5000 ? 'Active' : 'Needs more proof'),
    timeline: input.timeline || buildUpdatesTimeline({ ...input, roadmapText }, now),
    roadmap: input.roadmap || roadmapFromText(roadmapText),
    roadmapText,
    riskNotes: input.riskNotes || 'Community-submitted profile. Review public links, activity, and risk signals.',
  };
  const liveScoringProject = rawRealData ? {
    ...baseProject,
    website: firstPresent(rawRealData.websiteUrl, baseProject.website) || 'Not provided',
    twitter: firstPresent(rawRealData.twitterUrl, baseProject.twitter) || 'Not provided',
    telegram: firstPresent(rawRealData.telegramUrl, baseProject.telegram) || 'Not provided',
    github: firstPresent(rawRealData.githubUrl, baseProject.github) || 'Not provided',
    founderStatus: baseProject.founderStatus,
    communitySize: Number(rawRealData.holderCount || baseProject.communitySize || 0),
    holders: Number(rawRealData.holderCount || baseProject.holders || 0),
    description: baseProject.description,
    roadmap: baseProject.roadmap,
    roadmapText: baseProject.roadmapText,
    riskNotes: mergeRiskNotes(buildCanonicalRiskNotes(rawRealData), baseProject.riskNotes),
    realData: rawRealData,
  } : null;
  const scoringProject = {
    ...baseProject,
    website: firstPresent(baseProject.website, realData?.websiteUrl) || 'Not provided',
    twitter: firstPresent(baseProject.twitter, realData?.twitterUrl) || 'Not provided',
    telegram: firstPresent(baseProject.telegram, realData?.telegramUrl) || 'Not provided',
    founderStatus: baseProject.founderStatus,
    communitySize: baseProject.communitySize,
    description: baseProject.description,
    roadmap: baseProject.roadmap,
    roadmapText: baseProject.roadmapText,
    riskNotes: baseProject.riskNotes,
  };
  const authoritativeProject = liveScoringProject || scoringProject;
  const authoritativeHolders = liveScoringProject?.holders ?? holders;
  const authoritativeCommunitySize = liveScoringProject?.communitySize ?? communitySize;
  const rawScore = calculateTrustScore(authoritativeProject, rawRealData);
  // Asset Type Risk Modifier: caps the raw, data-driven score by asset class
  // so a high market cap / community size memecoin can never read as close
  // to a major Layer 1 (BTC/ETH/SOL/BNB) — see scoringEngine.getAssetTypeRiskModifier.
  const assetCategoryInfo = classifyAsset(authoritativeProject, rawRealData || {});
  const assetTypeRiskModifier = applyAssetTypeRiskModifier(assetCategoryInfo.category, authoritativeProject, rawRealData || {}, rawScore);
  const score = assetTypeRiskModifier.adjustedScore;
  const breakdown = buildScoreBreakdown(authoritativeProject, authoritativeHolders, authoritativeCommunitySize, score);
  breakdown.finalTrustScore = score;
  const riskLevel = scoreToRisk(score);
  const deepAnalysis = runRiskAnalysis(authoritativeProject, rawRealData || {}, breakdown, riskLevel, { rawScore, adjustedScore: score });

  return {
    ...scoringProject,
    trustScore: score,
    riskLevel,
    scoreBreakdown: breakdown,
    categoryBreakdown: buildCategoryBreakdown(breakdown),
    scamRisk: calculateScamRisk(authoritativeProject, rawRealData || {}),
    riskFlags: deriveRiskFlags(authoritativeProject, authoritativeHolders, authoritativeCommunitySize),
    // Evidence provenance (Phase 2): surface WHERE the scan data came from and
    // WHEN it was fetched, so results carry source attribution + a timestamp
    // instead of an unsourced number. Both are already captured on rawRealData;
    // this just lifts them onto the normalized project for the UI. Null for
    // manually-entered (non-live) profiles, which the card handles.
    dataSources: Array.isArray(rawRealData?.source) ? rawRealData.source : (rawRealData?.source ? [rawRealData.source] : null),
    dataFetchedAt: rawRealData?.fetchedAt || null,
    ...deepAnalysis,
  };
}

export function applyVerificationStatus(project, verificationMap = {}) {
  const entry = verificationMap[project.id];
  if (!entry) return project;
  return {
    ...project,
    verificationStatus: normalizeVerificationStatus(entry.status),
    verificationNote: entry.adminNote || '',
    ownerWallet: entry.ownerWallet || null,
  };
}

export function linkPresenceState(value) {
  return hasValue(value)
    ? { state: 'Present', value }
    : { state: 'Missing', value: 'Missing' };
}

export function syncSocialData(data = {}, project = {}) {
  return {
    ...data,
    websiteUrl: firstPresent(data.websiteUrl, project.website),
    twitterUrl: firstPresent(data.twitterUrl, project.twitter),
    telegramUrl: firstPresent(data.telegramUrl, project.telegram),
    githubUrl: firstPresent(data.githubUrl, project.github),
  };
}

export function deriveRiskFlags(project, holders, communitySize) {
  const factorFlags = riskFactors({ ...project, holders, communitySize })
    .filter((factor) => factor.severity === 'High' || factor.severity === 'Medium' || factor.severity === 'Limited')
    .map((factor) => `${factor.title} - ${factor.signal}`);
  return factorFlags.length ? factorFlags : [translate('scoring.riskFlags.none')];
}
