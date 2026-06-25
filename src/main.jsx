import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  clusterApiUrl,
} from '@solana/web3.js';
import {
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  getAssociatedTokenAddress,
  getMinimumBalanceForRentExemptMint,
} from '@solana/spl-token';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  CircleDot,
  Clock3,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileText,
  FileWarning,
  Flag,
  Github,
  Globe2,
  History,
  Home,
  Info,
  Layers3,
  LineChart,
  ListFilter,
  Lock,
  MessageCircle,
  Plus,
  Search,
  Scale,
  Shield,
  Sparkles,
  Star,
  Target,
  TimerReset,
  TrendingUp,
  Users,
  WalletCards,
  X,
} from 'lucide-react';
import './styles.css';
import { WHITEPAPER } from './whitepaperConfig.js';
import { I18nProvider, useTranslation } from './i18n/I18nContext.jsx';
import { translate, getLanguage } from './i18n/index.js';
import LanguageSwitcher from './LanguageSwitcher.jsx';
import WalletContextProvider from './wallet/WalletContextProvider.jsx';
import ConnectWalletButton from './ConnectWalletButton.jsx';
import { useKhanWallet } from './wallet/useKhanWallet.js';
import { PhantomWalletName } from '@solana/wallet-adapter-phantom';
import {
  initAnalytics,
  trackPageView,
  trackPdfDownload,
  trackCheckoutStarted,
  trackCheckoutUnavailable,
  trackEarlySupporterClick,
  trackPremiumClick,
  trackPricingView,
  trackReportViewed,
  trackShareClick,
  trackSocialClick,
  trackTokenScanCompleted,
  trackTokenScanStarted,
  trackCryptoVerifyStarted,
  trackCryptoVerifySuccess,
  trackCryptoVerifyFailed,
} from './analytics.js';
import { isStripeConfigured, startStripeCheckout, stripeUnavailableMessage } from './stripeCheckout.js';
import { isSolanaVerificationConfigured, solanaUnavailableMessage, verifySolanaPayment } from './solanaVerify.js';
import {
  VERIFICATION_STATUS,
  normalizeVerificationStatus,
  verificationStatusLabel,
  buildVerificationMessage,
  signVerificationMessage,
  submitVerificationRequest,
  fetchVerificationStatuses,
  adminLogin,
  getStoredAdminToken,
  clearAdminToken,
  fetchPendingRequests,
  fetchAllRequests,
  reviewVerificationRequest,
} from './verification.js';
import {
  initAnalyticsContext,
  trackPageViewEvent,
  trackTokenScanEvent,
  trackProjectViewEvent,
  trackProjectAddedEvent,
  trackCompareUsedEvent,
  trackSearchEvent,
  fetchAnalyticsSummary,
  downloadAsFile,
  summaryToCsv,
} from './platformAnalytics.js';

const PROJECTS_KEY = 'khan-trust-projects-v1';
const WATCHLIST_KEY = 'khan-trust-watchlist-v1';
const CRYPTO_PAYMENT_WALLET = import.meta.env.VITE_KHAN_PAYMENT_WALLET || '';
const OFFICIAL_KHAN_LINKS = {
  website: 'https://khantrust.netlify.app',
  x: 'https://x.com/KXankiwiyev3366',
  telegram: 'https://t.me/+RXCuwpSNwikzNTE0',
};
const LAUNCHPAD_PAYMENT_MODEL = {
  devnetPrice: '$0',
  mainnetPriceUsd: 9,
  mainnetPlan: 'launchpad_mainnet',
  mainnetPriceLabel: '$9',
  note: 'Launchpad payments are separate from KHAN Trust Premium plans.',
};
const SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com';
const SOLANA_DEVNET_RPC_URL = clusterApiUrl('devnet');
const DEXSCREENER_SOLANA_TOKEN_URL = 'https://api.dexscreener.com/token-pairs/v1/solana';
const JUPITER_TOKEN_SEARCH_URL = 'https://lite-api.jup.ag/tokens/v2/search';

const khanProject = {
  id: 'khan-solana',
  name: 'KHAN',
  ticker: '$KHAN',
  chain: 'Solana',
  contract: 'Coming soon',
  website: OFFICIAL_KHAN_LINKS.website,
  twitter: OFFICIAL_KHAN_LINKS.x,
  telegram: OFFICIAL_KHAN_LINKS.telegram,
  github: 'https://github.com/khantrust',
  launchDate: '2026-06-01',
  description: 'Building a crypto trust ecosystem from zero with community-first project profiles and public risk signals.',
  mission: 'Building a crypto trust ecosystem from zero.',
  status: 'Early community',
  lastUpdate: '2026-06-19',
  trustScore: 74,
  riskLevel: 'Medium',
  founderStatus: 'Public mission, early founder activity',
  communitySize: 1280,
  holders: 0,
  traders: 0,
  activityStatus: 'Forming',
  scoreBreakdown: {
    founderActivity: 74,
    communityActivity: 68,
    roadmapClarity: 84,
    transparency: 72,
    tokenRisk: 58,
    socialProof: 70,
  },
  riskFlags: ['Very new project', 'Low holders', 'Not verified'],
  timeline: [
    { label: 'X account created', date: '2026-06-01' },
    { label: 'Telegram launched', date: '2026-06-04' },
    { label: 'Website launched', date: '2026-06-12' },
    { label: 'Roadmap published', date: '2026-06-16' },
    { label: 'New update posted', date: '2026-06-19' },
  ],
  roadmap: [
    { phase: 'Phase 1 - KHAN Community', status: 'In progress' },
    { phase: 'Phase 2 - KHAN Trust Portal', status: 'Completed' },
    { phase: 'Phase 3 - Project trust profiles', status: 'In progress' },
    { phase: 'Phase 4 - Community proof tools', status: 'Planned' },
    { phase: 'Phase 5 - AI-assisted project analysis', status: 'Planned' },
  ],
  riskNotes: 'Planned community/utility token. Users should review activity and public updates before forming opinions.',
};

const demoProjects = [
  khanProject,
  {
    id: 'aurum-vault-eth',
    name: 'Aurum Vault',
    ticker: 'AVLT',
    chain: 'Ethereum',
    contract: '0x91f2...a8c0',
    website: 'https://example.com/aurum-vault',
    twitter: 'https://x.com/example',
    telegram: 'https://t.me/example',
    github: 'https://github.com/example/aurum-vault',
    launchDate: '2025-11-08',
    description: 'Example Ethereum DeFi project focused on vault transparency, public reports, and risk dashboards.',
    status: 'Verified demo',
    lastUpdate: '2026-06-17',
    trustScore: 86,
    riskLevel: 'Low',
    founderStatus: 'Public operators',
    communitySize: 18600,
    holders: 12450,
    traders: 3620,
    activityStatus: 'Active',
    scoreBreakdown: {
      founderActivity: 88,
      communityActivity: 82,
      roadmapClarity: 90,
      transparency: 91,
      tokenRisk: 76,
      socialProof: 84,
    },
    riskFlags: ['High concentration'],
    timeline: [
      { label: 'Website launched', date: '2025-10-21' },
      { label: 'X account created', date: '2025-10-25' },
      { label: 'Roadmap published', date: '2025-11-02' },
      { label: 'Community milestone reached', date: '2026-02-11' },
      { label: 'New update posted', date: '2026-06-17' },
    ],
    roadmap: [
      { phase: 'Protocol dashboard', status: 'Completed' },
      { phase: 'Vault reporting', status: 'Completed' },
      { phase: 'Risk module expansion', status: 'In progress' },
      { phase: 'DAO transparency hub', status: 'Planned' },
    ],
    riskNotes: 'Concentration should be monitored even with strong reporting signals.',
  },
  {
    id: 'moonbark-bsc',
    name: 'MoonBark',
    ticker: 'MBRK',
    chain: 'BSC',
    contract: '0xb21d...77aa',
    website: 'https://example.com/moonbark',
    twitter: 'https://x.com/example',
    telegram: 'https://t.me/example',
    github: 'Not provided',
    launchDate: '2026-05-28',
    description: 'Example BSC meme project with early social traction but limited transparency and roadmap proof.',
    status: 'Community watched',
    lastUpdate: '2026-06-10',
    trustScore: 39,
    riskLevel: 'High',
    founderStatus: 'Anonymous team',
    communitySize: 9400,
    holders: 730,
    traders: 1180,
    activityStatus: 'Unclear',
    scoreBreakdown: {
      founderActivity: 28,
      communityActivity: 52,
      roadmapClarity: 26,
      transparency: 22,
      tokenRisk: 31,
      socialProof: 46,
    },
    riskFlags: ['Very new project', 'Anonymous team', 'No roadmap', 'Not verified', 'Weak community'],
    timeline: [
      { label: 'Telegram launched', date: '2026-05-25' },
      { label: 'X account created', date: '2026-05-26' },
      { label: 'Website launched', date: '2026-05-28' },
      { label: 'New update posted', date: '2026-06-10' },
    ],
    roadmap: [
      { phase: 'Community launch', status: 'Completed' },
      { phase: 'Public roadmap', status: 'Planned' },
      { phase: 'Team transparency update', status: 'Planned' },
    ],
    riskNotes: 'Demo example of a project that needs clearer founder and roadmap proof.',
  },
  {
    id: 'creatorbase-base',
    name: 'CreatorBase',
    ticker: 'CRTB',
    chain: 'Base',
    contract: '0x2ca9...40de',
    website: 'https://example.com/creatorbase',
    twitter: 'https://x.com/example',
    telegram: 'https://t.me/example',
    github: 'https://github.com/example/creatorbase',
    launchDate: '2026-02-19',
    description: 'Example Base creator token with public creator updates, small holder base, and measured roadmap execution.',
    status: 'Building',
    lastUpdate: '2026-06-15',
    trustScore: 67,
    riskLevel: 'Medium',
    founderStatus: 'Public creator',
    communitySize: 5200,
    holders: 1680,
    traders: 810,
    activityStatus: 'Active',
    scoreBreakdown: {
      founderActivity: 78,
      communityActivity: 64,
      roadmapClarity: 70,
      transparency: 66,
      tokenRisk: 55,
      socialProof: 62,
    },
    riskFlags: ['Low holders', 'Very new project'],
    timeline: [
      { label: 'X account created', date: '2026-01-30' },
      { label: 'Website launched', date: '2026-02-10' },
      { label: 'Roadmap published', date: '2026-02-17' },
      { label: 'Community milestone reached', date: '2026-05-02' },
      { label: 'New update posted', date: '2026-06-15' },
    ],
    roadmap: [
      { phase: 'Creator token launch', status: 'Completed' },
      { phase: 'Community rewards', status: 'In progress' },
      { phase: 'Creator proof dashboard', status: 'Planned' },
    ],
    riskNotes: 'Small but active community. Holder growth and update consistency matter.',
  },
];

const navItems = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'explore', label: 'Explore', icon: Layers3 },
  { id: 'pricing', label: 'Pricing', icon: WalletCards },
  { id: 'compare', label: 'Compare', icon: Scale },
  { id: 'add', label: 'Add Project', icon: Plus },
  { id: 'launchpad', label: 'Launchpad', icon: Sparkles },
  { id: 'whitepaper', label: 'Whitepaper', icon: BookOpen },
  { id: 'about', label: 'About', icon: Info },
  { id: 'khan', label: '$KHAN', icon: Star },
];

const filters = ['All', 'Solana', 'Ethereum', 'BSC', 'Base', 'New Projects', 'High Risk', 'Strong Community'];
const FILTER_KEY_MAP = {
  All: 'all',
  Solana: 'solana',
  Ethereum: 'ethereum',
  BSC: 'bsc',
  Base: 'base',
  'New Projects': 'newProjects',
  'High Risk': 'highRisk',
  'Strong Community': 'strongCommunity',
};

function normalizeProject(input) {
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
    contract: input.contract || 'Not provided',
    website: firstPresent(input.website, realData?.websiteUrl) || 'Not provided',
    twitter: firstPresent(input.twitter, realData?.twitterUrl) || 'Not provided',
    telegram: firstPresent(input.telegram, realData?.telegramUrl) || 'Not provided',
    github: firstPresent(input.github, realData?.githubUrl) || 'Not provided',
    launchDate: input.launchDate || now,
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
  const score = calculateTrustScore(authoritativeProject, rawRealData);

  return {
    ...scoringProject,
    trustScore: score,
    riskLevel: scoreToRisk(score),
    scoreBreakdown: buildScoreBreakdown(authoritativeProject, authoritativeHolders, authoritativeCommunitySize, score),
    riskFlags: deriveRiskFlags(authoritativeProject, authoritativeHolders, authoritativeCommunitySize),
  };
}

// Maximum combined penalty (liveDataPenalty + riskPenalty) that can be subtracted from
// the weighted score, so a fully-completed profile keeps a meaningful score advantage
// over an identical project with no profile data, regardless of how risky the chain data is.
const MAX_TRUST_SCORE_PENALTY = 35;

function calculateTrustScore(project, liveData = project?.realData) {
  if (liveData) {
    return calculateLiveScores(project, liveData).finalTrustScore;
  }
  return calculateManualScores(project).finalTrustScore;
}

function buildScoreBreakdown(project, holders, communitySize, score) {
  if (project.realData) {
    const liveScores = calculateLiveScores(project, project.realData);
    return {
      marketCapScore: liveScores.marketCapScore,
      liquidityScore: liveScores.liquidityScore,
      holderScore: liveScores.holderScore,
      topHolderScore: liveScores.topHolderScore,
      topTenHolderScore: liveScores.topTenHolderScore,
      tokenAgeScore: liveScores.tokenAgeScore,
      websiteScore: liveScores.websiteScore,
      twitterScore: liveScores.twitterScore,
      telegramScore: liveScores.telegramScore,
      socialScore: liveScores.socialScore,
      holderGrowthScore: liveScores.holderGrowthScore,
      supplyScore: liveScores.supplyScore,
      finalTrustScore: liveScores.finalTrustScore,
    };
  }

  return calculateManualScores(project);
}

function calculateLiveScores(project = {}, data = {}) {
  const holderCount = Number(data.holderCount || project.holders || project.communitySize || 0);
  const websiteScore = scorePresence(socialPresenceState('website', project, data));
  const twitterScore = scorePresence(socialPresenceState('twitter', project, data));
  const telegramScore = scorePresence(socialPresenceState('telegram', project, data));
  const founderScore = scoreFounder(project.founderStatus);
  const roadmapScore = hasRoadmap(project) ? 68 : null;
  const communityScoreValue = scoreHolders(project.communitySize);
  const descriptionScore = hasValue(project.description) ? 58 : null;
  const scores = {
    marketCapScore: scoreMarketCap(data.marketCapUsd),
    liquidityScore: scoreLiquidity(data.totalLiquidityUsd ?? data.liquidityUsd),
    holderScore: scoreHolders(holderCount),
    topHolderScore: scoreTopHolder(data.topHolderPercent),
    topTenHolderScore: scoreTopTenHolder(data.topTenHolderPercent),
    tokenAgeScore: scoreTokenAge(data.tokenAgeDays),
    websiteScore,
    twitterScore,
    telegramScore,
    socialScore: Math.round((websiteScore + twitterScore + telegramScore) / 3),
    founderActivity: founderScore,
    roadmapClarity: roadmapScore,
    communityActivity: communityScoreValue,
    transparency: descriptionScore,
    holderGrowthScore: scoreHolderGrowth(data.holderGrowthPercent),
    supplyScore: scoreSupply(data.supply),
  };
  const weighted = weightedAverage([
    [scores.holderScore, 16],
    [scores.topHolderScore, 18],
    [scores.topTenHolderScore, 14],
    [scores.tokenAgeScore, 10],
    [scores.liquidityScore, 16],
    [scores.marketCapScore, 6],
    [scores.websiteScore, 7],
    [scores.twitterScore, 7],
    [scores.telegramScore, 6],
    [scores.founderActivity, 7],
    [scores.roadmapClarity, 6],
    [scores.communityActivity, 5],
    [scores.transparency, 3],
  ]);
  const livePenaltyValue = liveDataPenalty(data, holderCount);
  const riskPenaltyValue = riskPenalty(project.riskNotes, { excludeLiveDataDupes: true });
  // Cap total penalty so a project with a complete profile (social links, founder
  // status, description, roadmap) can never be fully cancelled out by on-chain risk
  // signals alone — those signals still matter, but profile quality keeps contributing.
  const penalty = Math.min(livePenaltyValue + riskPenaltyValue, MAX_TRUST_SCORE_PENALTY);
  const finalTrustScore = clamp(Math.max(5, weighted - penalty), 5, 100);
  return {
    ...scores,
    finalTrustScore,
  };
}

function calculateManualScores(project = {}) {
  const socialScore = scoreSocial(project, project.realData);
  const founderScore = scoreFounder(project.founderStatus) ?? 42;
  const roadmapScore = hasRoadmap(project) ? 68 : null;
  const communityScoreValue = scoreHolders(project.communitySize);
  const available = [socialScore, founderScore, roadmapScore, communityScoreValue].filter((value) => value !== null);
  const average = available.length ? Math.round(available.reduce((total, value) => total + value, 0) / available.length) : 5;

  return {
    founderActivity: founderScore,
    communityActivity: communityScoreValue,
    roadmapClarity: roadmapScore,
    transparency: socialScore,
    socialProof: socialScore,
    finalTrustScore: clamp(Math.max(5, average - Math.min(riskPenalty(project.riskNotes), MAX_TRUST_SCORE_PENALTY)), 5, 100),
  };
}

function scoreFounder(status = '') {
  if (!hasValue(status)) return null;
  const text = status.toLowerCase();
  if (text.includes('anonymous')) return 18;
  if (isPublicFounder(status)) return 72;
  return 42;
}

function scoreMarketCap(value) {
  const amount = Number(value || 0);
  if (!amount) return null;
  if (amount >= 10000000) return 95;
  if (amount >= 1000000) return 82;
  if (amount >= 100000) return 65;
  if (amount >= 10000) return 42;
  return 12;
}

function scoreLiquidity(value) {
  const amount = Number(value || 0);
  if (!amount) return null;
  if (amount >= 1000000) return 95;
  if (amount >= 250000) return 84;
  if (amount >= 50000) return 68;
  if (amount >= 10000) return 48;
  if (amount >= 5000) return 34;
  return 10;
}

function scoreHolders(value) {
  const count = Number(value || 0);
  if (!count) return null;
  if (count >= 10000) return 95;
  if (count >= 5000) return 84;
  if (count >= 1000) return 70;
  if (count >= 500) return 52;
  if (count >= 100) return 32;
  return 10;
}

function scoreTokenAge(days) {
  if (days === null || days === undefined) return null;
  if (days >= 365) return 95;
  if (days >= 180) return 82;
  if (days >= 90) return 66;
  if (days >= 30) return 48;
  if (days >= 7) return 25;
  return 8;
}

function scoreTopHolder(percent) {
  if (percent === null || percent === undefined) return null;
  if (percent <= 5) return 94;
  if (percent <= 10) return 82;
  if (percent <= 20) return 62;
  if (percent <= 35) return 38;
  return 12;
}

function scoreTopTenHolder(percent) {
  if (percent === null || percent === undefined) return null;
  if (percent <= 25) return 92;
  if (percent <= 40) return 78;
  if (percent <= 55) return 58;
  if (percent <= 70) return 34;
  return 10;
}

function scorePresence(value) {
  const state = typeof value === 'string' ? value : value?.state;
  if (state === 'Present') return 88;
  if (state === 'Data unavailable') return 44;
  if (state === 'Missing') return 26;
  return hasValue(value) ? 88 : 44;
}

function scoreSocial(project = {}, data = {}) {
  data = data || {};
  const checks = [
    socialPresenceState('website', project, data).state === 'Present',
    socialPresenceState('twitter', project, data).state === 'Present',
    socialPresenceState('telegram', project, data).state === 'Present',
    hasValue(firstPresent(project.github, data.githubUrl)),
  ];
  const count = checks.filter(Boolean).length;
  if (!count) return null;
  return [0, 28, 55, 78, 92][count];
}

function scoreHolderGrowth(percent) {
  if (percent === null || percent === undefined) return null;
  if (percent >= 25) return 88;
  if (percent >= 10) return 72;
  if (percent >= 1) return 58;
  if (percent === 0) return 45;
  return 24;
}

function scoreSupply(value) {
  const supply = Number(value || 0);
  if (!supply) return null;
  if (supply <= 1000000000) return 72;
  if (supply <= 10000000000) return 62;
  if (supply <= 100000000000) return 50;
  return 38;
}

function liveDataPenalty(data = {}, holderCount = 0) {
  let penalty = 0;
  const liquidity = Number(data.totalLiquidityUsd ?? data.liquidityUsd ?? 0);
  if (!liquidity) penalty += 4;
  if (liquidity > 0 && liquidity < 5000) penalty += 12;
  if (holderCount > 0 && holderCount < 100) penalty += 10;
  if (!holderCount) penalty += 3;
  if (data.tokenAgeDays !== null && data.tokenAgeDays !== undefined && data.tokenAgeDays < 7) penalty += 8;
  if (data.topHolderPercent > 35) penalty += 12;
  if (data.topTenHolderPercent > 70) penalty += 10;
  return penalty;
}

function weightedAverage(items) {
  const available = items.filter(([value]) => value !== null && value !== undefined);
  if (!available.length) return 5;
  const totalWeight = available.reduce((total, [, weight]) => total + weight, 0);
  const total = available.reduce((sum, [value, weight]) => sum + value * weight, 0);
  return Math.round(total / totalWeight);
}

function communityScore(size) {
  if (!size) return 0;
  return clamp(Math.round(Number(size) / 1000), 0, 15);
}

// Phrases here ('low liquidity', 'low holders', 'very new') describe the same conditions
// already scored by liveDataPenalty (liquidity/holderCount/tokenAgeDays/concentration).
// They are excluded when liveData is present so a project isn't penalized twice for one signal.
function riskPenalty(notes = '', { excludeLiveDataDupes = false } = {}) {
  const text = notes.toLowerCase();
  const penalties = [
    ['anonymous', 10],
    ['no roadmap', 8],
    ...(excludeLiveDataDupes ? [] : [
      ['low liquidity', 10],
      ['low holders', 7],
      ['very new', 6],
    ]),
  ];
  return penalties.reduce((total, [phrase, value]) => total + (text.includes(phrase) ? value : 0), 0);
}

function hasValue(value) {
  return Boolean(value && !['Not provided', 'Not available', 'Missing', 'Data unavailable'].includes(value));
}

function firstPresent(...values) {
  return values.find((value) => hasValue(value)) || '';
}

function cleanLink(value = '') {
  return typeof value === 'string' ? value.trim() : '';
}

function mergeSocialLinks(...items) {
  return items.reduce((links, item = {}) => ({
    website: firstPresent(links.website, item.website, item.websiteUrl),
    twitter: firstPresent(links.twitter, item.twitter, item.twitterUrl, item.xUrl),
    telegram: firstPresent(links.telegram, item.telegram, item.telegramUrl),
    github: firstPresent(links.github, item.github, item.githubUrl),
  }), {});
}

function socialPresenceState(kind, project = {}, data = {}) {
  const fieldMap = {
    website: ['website', 'websiteUrl'],
    twitter: ['twitter', 'twitterUrl', 'xUrl'],
    telegram: ['telegram', 'telegramUrl'],
  };
  const value = firstPresent(...fieldMap[kind].flatMap((field) => [project[field], data[field]]));
  if (value) return { state: 'Present', value };
  if (data.socialMetadataAvailable === false) return { state: 'Data unavailable', value: 'Data unavailable' };
  return { state: 'Missing', value: 'Missing' };
}

function resolvedMetadataRows(project = {}) {
  const data = project.realData || {};
  const m = (key) => translate(`profileSections.metadataRows.${key}`);
  const rows = [
    [m('chain'), project.chain, Layers3],
    project.network ? [m('network'), project.network, BadgeCheck] : null,
    [m('contract'), project.contract, Lock],
    [m('website'), socialPresenceState('website', project, data), Globe2],
    [m('twitter'), socialPresenceState('twitter', project, data), ExternalLink],
    [m('telegram'), socialPresenceState('telegram', project, data), MessageCircle],
    [m('github'), linkPresenceState(firstPresent(project.github, data.githubUrl)), Github],
    project.createdBy ? [m('createdBy'), project.createdBy, WalletCards] : null,
    project.launchpadSource ? [m('source'), project.launchpadSource, Sparkles] : null,
    project.tokenSupply ? [m('tokenSupply'), project.tokenSupply, CircleDot] : null,
    project.tokenDecimals !== '' && project.tokenDecimals !== undefined ? [m('decimals'), project.tokenDecimals, CircleDot] : null,
    project.transactionSignature ? [m('transaction'), project.transactionSignature, BadgeCheck] : null,
    [m('verification'), translatedVerificationStatusLabel(project.verificationStatus), BadgeCheck],
    [m('launchDate'), project.launchDate, CalendarDays],
    [m('status'), project.status, BadgeCheck],
    [m('lastUpdate'), project.lastUpdate, TimerReset],
  ];
  return rows.filter(Boolean);
}

// Single source of truth merge: the project object itself is always created
// unverified (see normalizeProject). The central verification store (fetched
// from the backend in App()) is overlaid on top here so Explore, Profile,
// Compare, and the PDF report all agree on the same status.
function applyVerificationStatus(project, verificationMap = {}) {
  const entry = verificationMap[project.id];
  if (!entry) return project;
  return { ...project, verificationStatus: normalizeVerificationStatus(entry.status), verificationNote: entry.adminNote || '' };
}

// Visible on Explore, Project Profile, and Compare so all three pages and
// mobile/desktop always agree on the same status (see applyVerificationStatus
// above, the single source of truth). Unverified projects show no badge.
const VERIFICATION_BADGE_CONFIG = {
  [VERIFICATION_STATUS.VERIFIED]: { className: 'status-pill-verified', Icon: BadgeCheck, key: 'common.verified' },
  [VERIFICATION_STATUS.PENDING]: { className: 'status-pill-pending', Icon: Clock3, key: 'common.pendingReview' },
  [VERIFICATION_STATUS.REJECTED]: { className: 'status-pill-rejected', Icon: X, key: 'common.rejected' },
};

function VerifiedBadge({ status, size = 14 }) {
  const { t } = useTranslation();
  const normalized = normalizeVerificationStatus(status);
  const config = VERIFICATION_BADGE_CONFIG[normalized];
  if (!config) return null;
  const { className, Icon, key } = config;
  const label = t(key);
  return (
    <span className={`verification-status-pill ${className}`} title={label}>
      <Icon size={size} /> {label}
    </span>
  );
}

const VERIFICATION_SHORT_KEY = {
  [VERIFICATION_STATUS.VERIFIED]: 'common.verifiedShort',
  [VERIFICATION_STATUS.PENDING]: 'common.pendingShort',
  [VERIFICATION_STATUS.REJECTED]: 'common.rejectedShort',
  [VERIFICATION_STATUS.UNVERIFIED]: 'common.unverifiedShort',
};

function translatedVerificationStatusLabel(status) {
  const normalized = normalizeVerificationStatus(status);
  return translate(VERIFICATION_SHORT_KEY[normalized] || 'common.unverifiedShort');
}

function linkPresenceState(value) {
  return hasValue(value)
    ? { state: 'Present', value }
    : { state: 'Missing', value: 'Missing' };
}

function isPublicFounder(status = '') {
  const text = status.toLowerCase();
  return text.includes('public') || text.includes('doxxed') || text.includes('known');
}

function hasRoadmap(project = {}) {
  return hasValue(project.roadmapText) || (project.roadmap && project.roadmap.some((item) => hasValue(item.phase)));
}

function syncSocialData(data = {}, project = {}) {
  return {
    ...data,
    websiteUrl: firstPresent(data.websiteUrl, project.website),
    twitterUrl: firstPresent(data.twitterUrl, project.twitter),
    telegramUrl: firstPresent(data.telegramUrl, project.telegram),
    githubUrl: firstPresent(data.githubUrl, project.github),
  };
}

function deriveRiskFlags(project, holders, communitySize) {
  const factorFlags = riskFactors({ ...project, holders, communitySize })
    .filter((factor) => factor.severity === 'High' || factor.severity === 'Medium' || factor.severity === 'Limited')
    .map((factor) => `${factor.title} - ${factor.signal}`);
  return factorFlags.length ? factorFlags : [translate('scoring.riskFlags.none')];
}

function buildUpdatesTimeline(project, now) {
  const date = project.launchDate || now;
  const updates = [{ label: translate('timeline.projectSubmitted'), date: now }];
  if (hasValue(project.website)) updates.push({ label: translate('timeline.websiteAdded'), date });
  if (hasValue(project.twitter)) updates.push({ label: translate('timeline.xAdded'), date });
  if (hasValue(project.telegram)) updates.push({ label: translate('timeline.telegramAdded'), date });
  if (hasValue(project.github)) updates.push({ label: translate('timeline.githubAdded'), date });
  if (hasValue(project.roadmapText) || project.roadmap?.length) updates.push({ label: translate('timeline.roadmapAdded'), date });
  return updates;
}

function roadmapToText(roadmap = []) {
  return roadmap.map((item) => item.phase).join('\n');
}

async function lookupSolanaToken(contractAddress) {
  const address = contractAddress.trim();
  if (!address) throw new Error('Enter a Solana contract address first.');

  const [dexData, rpcData, holderAnalyticsData, jupiterData] = await Promise.allSettled([
    fetchDexscreenerToken(address),
    fetchSolanaRpcToken(address),
    fetchSolanaHolderAnalytics(address),
    fetchJupiterTokenData(address),
  ]);

  const dex = dexData.status === 'fulfilled' ? dexData.value : null;
  const rpc = rpcData.status === 'fulfilled' ? rpcData.value : null;
  const holderAnalytics = holderAnalyticsData.status === 'fulfilled' ? holderAnalyticsData.value : null;
  const jupiter = jupiterData.status === 'fulfilled' ? jupiterData.value : null;

  if (!dex?.primaryPair && !rpc && !jupiter) {
    throw new Error('No public Solana token data was found for this address.');
  }

  const token = getDexTokenForAddress(dex?.primaryPair, address);
  const info = dex?.primaryPair?.info || {};
  const socialLinks = mergeSocialLinks(
    extractSocialLinksFromDexInfo(info),
    jupiter?.socialLinks,
    extractSocialLinksFromMetadata(dex?.primaryPair),
    extractSocialLinksFromMetadata(jupiter?.rawToken)
  );
  const website = socialLinks.website || '';
  const twitter = socialLinks.twitter || '';
  const telegram = socialLinks.telegram || '';
  const github = socialLinks.github || '';
  const socialMetadataAvailable = Boolean(dex?.primaryPair || jupiter);
  const createdAt = dex?.oldestPairCreatedAt || dex?.primaryPair?.pairCreatedAt || (jupiter?.createdAt ? new Date(jupiter.createdAt).getTime() : null);
  const tokenAgeDays = createdAt ? daysSince(createdAt) : null;
  const holderCount = holderAnalytics?.holderCount || jupiter?.holderCount || rpc?.holderCountEstimate || 0;
  const liquidityUsd = Number(dex?.primaryPair?.liquidity?.usd || 0);
  const totalLiquidityUsd = Number(dex?.totalLiquidityUsd || liquidityUsd || jupiter?.liquidity || 0);
  const marketCapUsd = Number(dex?.primaryPair?.marketCap || dex?.primaryPair?.fdv || jupiter?.mcap || jupiter?.fdv || 0);

  return {
    id: `solana-${slugify(address)}`,
    name: token.name || jupiter?.name || '',
    ticker: token.symbol ? token.symbol.toUpperCase() : jupiter?.symbol?.toUpperCase() || '',
    chain: 'Solana',
    contract: address,
    website,
    twitter,
    telegram,
    github,
    launchDate: createdAt ? new Date(createdAt).toISOString().slice(0, 10) : '',
    description: token.name || jupiter?.name
      ? `${token.name || jupiter.name} is a Solana token profile enriched with public market and on-chain signals.`
      : 'Solana token profile enriched with public market and on-chain signals.',
    status: 'Live Solana data',
    lastUpdate: new Date().toISOString().slice(0, 10),
    holderCount,
    communitySize: holderCount,
    riskNotes: buildRealDataRiskNotes({ liquidityUsd, holderCount, tokenAgeDays }),
    realData: {
      source: 'Dexscreener pools + Solana RPC + Jupiter token index',
      holderSource: holderAnalytics?.source || (jupiter?.holderCount ? 'Jupiter indexed Solana holder count' : rpc?.holderSource) || 'Best-effort public data',
      liquidityUsd,
      totalLiquidityUsd,
      marketCapUsd,
      tokenAgeDays,
      holderCount,
      topHolderPercent: holderAnalytics?.topHolderPercent ?? rpc?.topHolderPercent ?? null,
      topTenHolderPercent: holderAnalytics?.topTenHolderPercent ?? rpc?.topTenHolderPercent ?? jupiter?.topHoldersPercentage ?? null,
      holderGrowthPercent: jupiter?.holderGrowthPercent ?? null,
      supply: rpc?.supply || jupiter?.totalSupply || null,
      topAccountCount: rpc?.topAccountCount || null,
      poolCount: dex?.poolCount || 0,
      websiteUrl: website,
      twitterUrl: twitter,
      telegramUrl: telegram,
      githubUrl: github,
      socialMetadataAvailable,
      tokenProgram: jupiter?.tokenProgram || '',
      launchpad: jupiter?.launchpad || '',
      pairUrl: dex?.primaryPair?.url || '',
      pairAddress: dex?.primaryPair?.pairAddress || '',
      fetchedAt: new Date().toISOString(),
    },
  };
}

function createDemoRiskProject(contractAddress, reason = '') {
  const address = contractAddress.trim();
  const signal = address.split('').reduce((total, char) => total + char.charCodeAt(0), 0);
  const holderCount = 120 + (signal % 8800);
  const topHolderPercent = 12 + (signal % 34);
  const topTenHolderPercent = clamp(topHolderPercent + 22 + (signal % 28), 28, 92);
  const liquidityUsd = 3500 + ((signal * 97) % 180000);
  const tokenAgeDays = 4 + (signal % 260);
  const riskNotes = [
    topHolderPercent > 35 ? 'high holder concentration' : '',
    liquidityUsd < 50000 ? 'low liquidity' : '',
    tokenAgeDays < 30 ? 'very new project' : '',
    holderCount < 500 ? 'low holders' : '',
  ].filter(Boolean).join(', ') || 'Demo risk data generated because live public APIs were unavailable.';

  return {
    id: `solana-demo-${slugify(address)}`,
    name: `Solana Token ${address.slice(0, 4)}...${address.slice(-4)}`,
    ticker: 'DEMO',
    chain: 'Solana',
    contract: address,
    website: '',
    twitter: '',
    telegram: '',
    github: '',
    launchDate: new Date(Date.now() - tokenAgeDays * 86400000).toISOString().slice(0, 10),
    description: 'Demo Solana token risk report generated with mock data while live API data is unavailable.',
    status: 'Demo risk report',
    lastUpdate: new Date().toISOString().slice(0, 10),
    holderCount,
    communitySize: holderCount,
    founderStatus: 'Not provided',
    roadmapText: '',
    riskNotes,
    realData: {
      source: reason ? `Demo fallback: ${reason}` : 'Demo fallback risk model',
      holderSource: 'Mock demo holder data',
      liquidityUsd,
      totalLiquidityUsd: liquidityUsd,
      marketCapUsd: liquidityUsd * (18 + (signal % 34)),
      tokenAgeDays,
      holderCount,
      topHolderPercent,
      topTenHolderPercent,
      holderGrowthPercent: null,
      supply: 1000000000 + signal * 1000,
      topAccountCount: 20,
      poolCount: 1,
      websiteUrl: '',
      twitterUrl: '',
      telegramUrl: '',
      githubUrl: '',
      socialMetadataAvailable: false,
      fetchedAt: new Date().toISOString(),
      isDemo: true,
    },
  };
}

async function fetchDexscreenerToken(address) {
  const response = await fetch(`${DEXSCREENER_SOLANA_TOKEN_URL}/${address}`);
  if (!response.ok) throw new Error('Dexscreener lookup failed.');
  const pairs = await response.json();
  if (!Array.isArray(pairs) || !pairs.length) return null;
  const solanaPairs = pairs
    .filter((pair) => pair.chainId === 'solana')
    .filter((pair) => {
      const normalized = address.toLowerCase();
      return pair.baseToken?.address?.toLowerCase() === normalized || pair.quoteToken?.address?.toLowerCase() === normalized;
    });
  const sortedPairs = solanaPairs.sort((a, b) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0));
  return {
    primaryPair: sortedPairs[0] || null,
    pairs: sortedPairs,
    poolCount: sortedPairs.length,
    totalLiquidityUsd: sortedPairs.reduce((total, pair) => total + Number(pair?.liquidity?.usd || 0), 0),
    oldestPairCreatedAt: sortedPairs
      .map((pair) => pair.pairCreatedAt)
      .filter(Boolean)
      .sort((a, b) => a - b)[0] || null,
  };
}

function getDexTokenForAddress(pair, address) {
  const normalized = address.toLowerCase();
  if (pair?.baseToken?.address?.toLowerCase() === normalized) return pair.baseToken;
  if (pair?.quoteToken?.address?.toLowerCase() === normalized) return pair.quoteToken;
  return pair?.baseToken || {};
}

function extractSocialLinksFromDexInfo(info = {}) {
  const websites = Array.isArray(info.websites) ? info.websites : [];
  const socials = Array.isArray(info.socials) ? info.socials : [];
  return mergeSocialLinks(
    { website: websites.map((item) => item?.url).find(hasValue) },
    ...socials.map((item) => {
      const type = String(item?.type || item?.label || '').toLowerCase();
      const url = cleanLink(item?.url);
      if (type.includes('twitter') || type === 'x') return { twitter: url };
      if (type.includes('telegram') || type === 'tg') return { telegram: url };
      if (type.includes('github')) return { github: url };
      if (type.includes('website') || type.includes('site')) return { website: url };
      return {};
    })
  );
}

function extractSocialLinksFromMetadata(value) {
  const links = {};
  const seen = new Set();

  const visit = (input, keyHint = '') => {
    if (input === null || input === undefined || seen.size > 1200) return;
    if (typeof input === 'string') {
      assignSocialLink(links, keyHint, input);
      return;
    }
    if (typeof input !== 'object' || seen.has(input)) return;
    seen.add(input);
    if (Array.isArray(input)) {
      input.forEach((item) => visit(item, keyHint));
      return;
    }
    Object.entries(input).forEach(([key, item]) => visit(item, key));
  };

  visit(value);
  return links;
}

function assignSocialLink(links, keyHint, rawValue) {
  const value = cleanLink(rawValue);
  if (!value || value.length > 260) return;
  const lowerKey = String(keyHint || '').toLowerCase();
  const lowerValue = value.toLowerCase();
  const looksLikeUrl = lowerValue.startsWith('http') || lowerValue.includes('.com') || lowerValue.includes('.org') || lowerValue.includes('.io') || lowerValue.includes('.xyz');
  if (!looksLikeUrl) return;

  if (!links.telegram && (lowerKey.includes('telegram') || lowerKey === 'tg' || lowerValue.includes('t.me/') || lowerValue.includes('telegram.me/'))) {
    links.telegram = value;
    return;
  }
  if (!links.twitter && (lowerKey.includes('twitter') || lowerKey === 'x' || lowerKey === 'xurl' || lowerValue.includes('twitter.com/') || lowerValue.includes('x.com/'))) {
    links.twitter = value;
    return;
  }
  if (!links.github && (lowerKey.includes('github') || lowerValue.includes('github.com/'))) {
    links.github = value;
    return;
  }
  if (!links.website && (lowerKey.includes('website') || lowerKey.includes('site') || lowerKey.includes('url') || lowerKey.includes('homepage'))) {
    links.website = value;
  }
}

async function fetchJupiterTokenData(address) {
  const response = await fetch(`${JUPITER_TOKEN_SEARCH_URL}?query=${encodeURIComponent(address)}`);
  if (!response.ok) throw new Error('Jupiter token lookup failed.');
  const tokens = await response.json();
  const token = Array.isArray(tokens)
    ? tokens.find((item) => item.id?.toLowerCase() === address.toLowerCase())
    : null;
  if (!token) return null;
  return {
    name: token.name,
    symbol: token.symbol,
    holderCount: Number(token.holderCount || 0),
    holderGrowthPercent: token.stats24h?.holderChange ?? null,
    liquidity: Number(token.liquidity || 0),
    mcap: Number(token.mcap || 0),
    fdv: Number(token.fdv || 0),
    totalSupply: Number(token.totalSupply || token.circSupply || 0),
    topHoldersPercentage: token.audit?.topHoldersPercentage ?? null,
    tokenProgram: token.tokenProgram,
    launchpad: token.launchpad,
    createdAt: token.createdAt || token.firstPool?.createdAt || null,
    socialLinks: extractSocialLinksFromMetadata(token),
    rawToken: token,
  };
}

async function fetchSolanaRpcToken(address) {
  const [supplyResult, largestResult] = await Promise.all([
    solanaRpc('getTokenSupply', [address]),
    solanaRpc('getTokenLargestAccounts', [address]),
  ]);
  const topAccounts = largestResult?.value || [];
  const supply = Number(supplyResult?.value?.uiAmount || 0);
  const topBalances = topAccounts.map((account) => Number(account.uiAmount || 0));
  const topHolderPercent = supply ? roundPercent((topBalances[0] || 0) / supply) : null;
  const topTenHolderPercent = supply ? roundPercent(topBalances.slice(0, 10).reduce((total, value) => total + value, 0) / supply) : null;
  return {
    supply,
    holderCountEstimate: topAccounts.length,
    holderSource: 'Solana RPC top token accounts',
    topHolderPercent,
    topTenHolderPercent,
    topAccountCount: topAccounts.length,
  };
}

async function fetchSolanaHolderAnalytics(address) {
  const tokenProgramId = await fetchMintOwnerProgram(address);
  const result = await solanaRpc('getProgramAccounts', [
    tokenProgramId,
    {
      encoding: 'jsonParsed',
      filters: [
        { memcmp: { offset: 0, bytes: address } },
      ],
    },
  ]);
  const balances = (result || [])
    .map((account) => Number(account?.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0))
    .filter((amount) => amount > 0)
    .sort((a, b) => b - a);
  const supply = balances.reduce((total, amount) => total + amount, 0);
  return {
    holderCount: balances.length,
    topHolderPercent: supply ? roundPercent((balances[0] || 0) / supply) : null,
    topTenHolderPercent: supply ? roundPercent(balances.slice(0, 10).reduce((total, value) => total + value, 0) / supply) : null,
    source: `Solana RPC token-account scan (${tokenProgramId === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' ? 'Token-2022' : 'SPL Token'})`,
  };
}

async function fetchMintOwnerProgram(address) {
  const accountInfo = await solanaRpc('getAccountInfo', [address, { encoding: 'jsonParsed' }]);
  return accountInfo?.value?.owner || 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
}

async function solanaRpc(method, params) {
  const response = await fetch(SOLANA_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params }),
  });
  if (!response.ok) throw new Error(`${method} failed.`);
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.message);
  return payload.result;
}

function buildRealDataRiskNotes({ liquidityUsd, holderCount, tokenAgeDays }) {
  const notes = [];
  if (liquidityUsd > 0 && liquidityUsd < 5000) notes.push('low liquidity');
  if (holderCount > 0 && holderCount < 500) notes.push('low holders');
  if (tokenAgeDays !== null && tokenAgeDays < 14) notes.push('very new project');
  return notes.length ? notes.join(', ') : translate('scoring.riskNotes.liveDataAvailable');
}

function buildCanonicalRiskNotes(data = {}) {
  return buildRealDataRiskNotes({
    liquidityUsd: Number(data.totalLiquidityUsd ?? data.liquidityUsd ?? 0),
    holderCount: Number(data.holderCount || 0),
    tokenAgeDays: data.tokenAgeDays,
  });
}

function mergeRiskNotes(...notes) {
  const unique = notes
    .flatMap((note) => String(note || '').split(','))
    .map((note) => note.trim())
    .filter(hasValue)
    .filter((note, index, items) => items.findIndex((item) => item.toLowerCase() === note.toLowerCase()) === index);
  return unique.length ? unique.join(', ') : translate('scoring.riskNotes.liveDataAvailable');
}

function roadmapFromText(text) {
  if (!text) {
    return [{ phase: translate('scoring.roadmapNeeded'), status: 'Planned' }];
  }
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((phase, index) => ({ phase, status: index === 0 ? 'In progress' : 'Planned' }));
}

function parseTokenAmount(value, decimals) {
  const raw = String(value || '').trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    throw new Error('Total supply must be a positive number.');
  }
  const [wholePart, fractionPart = ''] = raw.split('.');
  if (fractionPart.length > decimals) {
    throw new Error(`Total supply cannot have more than ${decimals} decimal places.`);
  }
  const scale = 10n ** BigInt(decimals);
  const whole = BigInt(wholePart || '0') * scale;
  const fraction = BigInt((fractionPart || '').padEnd(decimals, '0') || '0');
  const amount = whole + fraction;
  if (amount <= 0n) {
    throw new Error('Total supply must be positive.');
  }
  return amount;
}

function formatWalletAddress(address = '') {
  return address ? `${address.slice(0, 4)}...${address.slice(-4)}` : translate('common.notConnected');
}

function launchpadNetworkConfig(network = 'devnet') {
  if (network === 'mainnet-beta') {
    return {
      network,
      rpcUrl: SOLANA_RPC_URL,
      label: translate('common.mainnet'),
      explorerCluster: '',
      profileNetwork: 'mainnet-beta',
    };
  }
  return {
    network: 'devnet',
    rpcUrl: SOLANA_DEVNET_RPC_URL,
    label: translate('common.devnet'),
    explorerCluster: '?cluster=devnet',
    profileNetwork: 'devnet',
  };
}

function solanaExplorerUrl(type, value, network = 'devnet') {
  const config = launchpadNetworkConfig(network);
  const path = type === 'tx' ? 'tx' : 'address';
  return `https://explorer.solana.com/${path}/${value}${config.explorerCluster}`;
}

async function createLaunchpadSplToken({ walletAddress, decimals, totalSupply, network, signTransaction }) {
  if (!walletAddress || !signTransaction) {
    throw new Error('Connect a wallet before creating a token.');
  }

  const config = launchpadNetworkConfig(network);
  const connection = new Connection(config.rpcUrl, 'confirmed');
  const walletPublicKey = new PublicKey(walletAddress);
  const mintKeypair = Keypair.generate();
  const mintLamports = await getMinimumBalanceForRentExemptMint(connection);
  const tokenAccount = await getAssociatedTokenAddress(mintKeypair.publicKey, walletPublicKey);
  const amount = parseTokenAmount(totalSupply, decimals);
  const latestBlockhash = await connection.getLatestBlockhash('confirmed');
  const transaction = new Transaction({
    feePayer: walletPublicKey,
    recentBlockhash: latestBlockhash.blockhash,
  }).add(
    SystemProgram.createAccount({
      fromPubkey: walletPublicKey,
      newAccountPubkey: mintKeypair.publicKey,
      space: MINT_SIZE,
      lamports: mintLamports,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(mintKeypair.publicKey, decimals, walletPublicKey, null),
    createAssociatedTokenAccountInstruction(walletPublicKey, tokenAccount, walletPublicKey, mintKeypair.publicKey),
    createMintToInstruction(mintKeypair.publicKey, tokenAccount, walletPublicKey, amount)
  );

  transaction.partialSign(mintKeypair);
  const signedTransaction = await signTransaction(transaction);
  const signature = await connection.sendRawTransaction(signedTransaction.serialize());
  await connection.confirmTransaction({ signature, ...latestBlockhash }, 'confirmed');

  return {
    mintAddress: mintKeypair.publicKey.toString(),
    signature,
    tokenAccount: tokenAccount.toString(),
    network: config.profileNetwork,
  };
}

function launchpadProfileFromForm(form, walletAddress, result, network = 'devnet') {
  const now = new Date().toISOString().slice(0, 10);
  const roadmap = roadmapFromText(form.roadmapText);
  const config = launchpadNetworkConfig(result.network || network);
  const isMainnet = config.network === 'mainnet-beta';
  return {
    id: `launchpad-${slugify(result.mintAddress)}`,
    name: form.name.trim(),
    ticker: form.symbol.trim().toUpperCase(),
    chain: 'Solana',
    network: config.profileNetwork,
    contract: result.mintAddress,
    website: form.website,
    twitter: form.twitter,
    telegram: form.telegram,
    logoUrl: form.logoUrl,
    launchDate: now,
    description: form.description,
    status: isMainnet ? translate('launchpad.status.mainnetToken') : translate('launchpad.status.devnetToken'),
    lastUpdate: now,
    tokenSupply: form.totalSupply,
    tokenDecimals: Number(form.decimals || 0),
    founderStatus: form.founderStatus,
    communitySize: Number(form.communitySize || 0),
    roadmap,
    roadmapText: form.roadmapText,
    riskNotes: form.riskNotes || (isMainnet
      ? translate('launchpad.riskNotes.mainnet')
      : translate('launchpad.riskNotes.devnet')),
    createdBy: walletAddress,
    launchpadSource: 'KHAN Launchpad',
    transactionSignature: result.signature,
    timeline: [
      { label: translate('timeline.tokenCreated', { network: config.label }), date: now },
      { label: translate('timeline.profileGenerated'), date: now },
    ],
  };
}

function scoreToRisk(score) {
  if (score >= 78) return 'Low';
  if (score >= 55) return 'Medium';
  return 'High';
}

function translateRiskLevel(level = '') {
  return translate(`common.${level.toLowerCase()}`) || level;
}

function daysSince(date) {
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatCurrency(value) {
  const number = Number(value || 0);
  if (!number) return translate('common.notAvailable');
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: number >= 1000 ? 0 : 2,
  }).format(number);
}

function formatNumber(value) {
  const number = Number(value || 0);
  if (!number) return translate('common.notAvailable');
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(number);
}

function formatAge(days) {
  if (days === null || days === undefined) return translate('common.notAvailable');
  if (days < 1) return translate('common.ageLessThanDay');
  if (days < 30) return translate('common.ageDays', { count: days });
  if (days < 365) return translate('common.ageMonths', { count: Math.round(days / 30) });
  return translate('common.ageYears', { count: Math.round(days / 365) });
}

function formatPercent(value) {
  if (value === null || value === undefined) return translate('common.notAvailable');
  return `${Number(value).toFixed(2)}%`;
}

function formatScore(value) {
  return value === null || value === undefined ? translate('common.notAvailable') : `${value}/100`;
}

function displayValue(value) {
  return hasValue(value) ? value : translate('common.notAvailable');
}

function storedMetadataValue(value) {
  if (typeof value === 'number') return value > 0 ? value : undefined;
  if (Array.isArray(value)) return value.length ? value : undefined;
  return hasValue(value) ? value : undefined;
}

function hasSavedRoadmap(project = {}) {
  if (hasValue(project.roadmapText)) return true;
  return Boolean(project.roadmap?.some((item) => hasValue(item.phase) && item.phase !== 'Roadmap proof needed'));
}

function findStoredProject(items = [], project = {}) {
  const normalizedContract = project.contract?.toLowerCase();
  return items.find((item) => {
    const sameId = item.id === project.id;
    const sameContract = normalizedContract && item.contract?.toLowerCase() === normalizedContract;
    return sameId || sameContract;
  });
}

function mergeStoredMetadata(liveProject = {}, storedProject = null) {
  if (!storedProject) return liveProject;

  const merged = {
    ...liveProject,
    id: storedProject.id || liveProject.id,
    verificationStatus: storedProject.verificationStatus || liveProject.verificationStatus,
  };
  ['website', 'twitter', 'telegram', 'github', 'founderStatus', 'description', 'riskNotes'].forEach((field) => {
    const savedValue = storedMetadataValue(storedProject[field]);
    if (savedValue !== undefined && !hasValue(merged[field])) merged[field] = savedValue;
  });

  const savedCommunitySize = storedMetadataValue(storedProject.communitySize);
  if (savedCommunitySize !== undefined && !Number(merged.communitySize || merged.realData?.holderCount || 0)) {
    merged.communitySize = Number(savedCommunitySize);
  }

  if (!hasSavedRoadmap(merged) && hasSavedRoadmap(storedProject)) {
    merged.roadmapText = storedProject.roadmapText || roadmapToText(storedProject.roadmap);
    merged.roadmap = storedProject.roadmap;
  }

  if (merged.realData) {
    merged.realData = syncSocialData(merged.realData, merged);
  }

  return merged;
}

function holderConcentrationStatus(data = {}) {
  if (data.topHolderPercent === null || data.topHolderPercent === undefined) {
    return translate('scoring.holderConcentration.unavailable');
  }
  if (data.topHolderPercent > 35 || data.topTenHolderPercent > 70) return translate('scoring.holderConcentration.warning');
  return translate('scoring.holderConcentration.ok');
}

function holderRiskLevel(data = {}) {
  if (data.topHolderPercent === null || data.topHolderPercent === undefined) return translate('scoring.holderRiskLevel.limited');
  if (data.topHolderPercent > 35 || data.topTenHolderPercent > 70) return translate('scoring.holderRiskLevel.high');
  if (data.topHolderPercent > 20 || data.topTenHolderPercent > 50) return translate('scoring.holderRiskLevel.medium');
  return translate('scoring.holderRiskLevel.low');
}

function riskBadge(score) {
  if (score >= 78) return translate('common.lowRisk');
  if (score >= 55) return translate('common.mediumRisk');
  return translate('common.highRisk');
}

function confidenceScore(project = {}) {
  const data = project.realData || {};
  const checks = [
    Number(data.holderCount || project.holders || 0) > 0,
    data.topHolderPercent !== null && data.topHolderPercent !== undefined,
    data.topTenHolderPercent !== null && data.topTenHolderPercent !== undefined,
    data.tokenAgeDays !== null && data.tokenAgeDays !== undefined,
    Number(data.totalLiquidityUsd ?? data.liquidityUsd ?? 0) > 0,
    Number(data.marketCapUsd || 0) > 0,
    socialPresenceState('website', project, data).state !== 'Data unavailable',
    socialPresenceState('twitter', project, data).state !== 'Data unavailable',
    socialPresenceState('telegram', project, data).state !== 'Data unavailable',
  ];
  const available = checks.filter(Boolean).length;
  if (data.isDemo) {
    return { label: translate('scoring.confidence.limited'), available, total: checks.length };
  }
  if (available >= 7) return { label: translate('scoring.confidence.high'), available, total: checks.length };
  if (available >= 5) return { label: translate('scoring.confidence.medium'), available, total: checks.length };
  return { label: translate('scoring.confidence.limited'), available, total: checks.length };
}

function riskFactors(project = {}) {
  const data = project.realData || {};
  const holders = Number(data.holderCount || project.holderCount || project.holders || project.communitySize || 0);
  const liquidity = Number(data.totalLiquidityUsd ?? data.liquidityUsd ?? 0);
  const tokenAgeDays = data.tokenAgeDays ?? (project.launchDate ? daysSince(project.launchDate) : null);
  const largestHolder = data.topHolderPercent;
  const topTen = data.topTenHolderPercent;
  const website = socialPresenceState('website', project, data);
  const twitter = socialPresenceState('twitter', project, data);
  const telegram = socialPresenceState('telegram', project, data);

  const factors = [
    holderCountFactor(holders, data.holderSource),
    largestHolderFactor(largestHolder),
    topTenHolderFactor(topTen),
    tokenAgeFactor(tokenAgeDays),
    liquidityFactor(liquidity, data.poolCount),
    presenceFactor('website', website),
    presenceFactor('twitter', twitter),
    presenceFactor('telegram', telegram),
  ];

  return factors.sort((a, b) => riskSeverityRank(b.severity) - riskSeverityRank(a.severity));
}

function holderCountFactor(holders, source = '') {
  const title = translate('scoring.factors.holderCountTitle');
  if (!holders) {
    return {
      title,
      severity: 'Limited',
      signal: translate('scoring.factors.holderCountUnavailableSignal'),
      value: translate('common.notAvailable'),
      explanation: translate('scoring.factors.holderCountUnavailableExplain'),
    };
  }
  const sourceText = source ? translate('scoring.factors.viaSource', { source }) : '';
  if (holders < 100) {
    return {
      title,
      severity: 'High',
      signal: translate('scoring.factors.holderCountVeryLowSignal'),
      value: formatNumber(holders),
      explanation: translate('scoring.factors.holderCountVeryLowExplain', { count: formatNumber(holders), sourceText }),
    };
  }
  if (holders < 500) {
    return {
      title,
      severity: 'Medium',
      signal: translate('scoring.factors.holderCountLowSignal'),
      value: formatNumber(holders),
      explanation: translate('scoring.factors.holderCountLowExplain', { count: formatNumber(holders) }),
    };
  }
  return {
    title,
    severity: 'Low',
    signal: translate('scoring.factors.holderCountOkSignal'),
    value: formatNumber(holders),
    explanation: translate('scoring.factors.holderCountOkExplain', { count: formatNumber(holders) }),
  };
}

function largestHolderFactor(percent) {
  const title = translate('scoring.factors.largestHolderTitle');
  if (percent === null || percent === undefined) {
    return {
      title,
      severity: 'Limited',
      signal: translate('scoring.factors.largestHolderUnavailableSignal'),
      value: translate('common.notAvailable'),
      explanation: translate('scoring.factors.largestHolderUnavailableExplain'),
    };
  }
  if (percent > 35) {
    return {
      title,
      severity: 'High',
      signal: translate('scoring.factors.largestHolderHighSignal'),
      value: formatPercent(percent),
      explanation: translate('scoring.factors.largestHolderHighExplain', { percent: formatPercent(percent) }),
    };
  }
  if (percent > 20) {
    return {
      title,
      severity: 'Medium',
      signal: translate('scoring.factors.largestHolderMediumSignal'),
      value: formatPercent(percent),
      explanation: translate('scoring.factors.largestHolderMediumExplain', { percent: formatPercent(percent) }),
    };
  }
  return {
    title,
    severity: 'Low',
    signal: translate('scoring.factors.largestHolderLowSignal'),
    value: formatPercent(percent),
    explanation: translate('scoring.factors.largestHolderLowExplain', { percent: formatPercent(percent) }),
  };
}

function topTenHolderFactor(percent) {
  const title = translate('scoring.factors.topTenTitle');
  if (percent === null || percent === undefined) {
    return {
      title,
      severity: 'Limited',
      signal: translate('scoring.factors.topTenUnavailableSignal'),
      value: translate('common.notAvailable'),
      explanation: translate('scoring.factors.topTenUnavailableExplain'),
    };
  }
  if (percent > 70) {
    return {
      title,
      severity: 'High',
      signal: translate('scoring.factors.topTenHighSignal'),
      value: formatPercent(percent),
      explanation: translate('scoring.factors.topTenHighExplain', { percent: formatPercent(percent) }),
    };
  }
  if (percent > 50) {
    return {
      title,
      severity: 'Medium',
      signal: translate('scoring.factors.topTenMediumSignal'),
      value: formatPercent(percent),
      explanation: translate('scoring.factors.topTenMediumExplain', { percent: formatPercent(percent) }),
    };
  }
  return {
    title,
    severity: 'Low',
    signal: translate('scoring.factors.topTenLowSignal'),
    value: formatPercent(percent),
    explanation: translate('scoring.factors.topTenLowExplain', { percent: formatPercent(percent) }),
  };
}

function tokenAgeFactor(days) {
  const title = translate('scoring.factors.tokenAgeTitle');
  if (days === null || days === undefined || Number.isNaN(days)) {
    return {
      title,
      severity: 'Limited',
      signal: translate('scoring.factors.tokenAgeUnavailableSignal'),
      value: translate('common.notAvailable'),
      explanation: translate('scoring.factors.tokenAgeUnavailableExplain'),
    };
  }
  if (days < 14) {
    return {
      title,
      severity: 'High',
      signal: translate('scoring.factors.tokenAgeHighSignal'),
      value: formatAge(days),
      explanation: translate('scoring.factors.tokenAgeHighExplain', { age: formatAge(days) }),
    };
  }
  if (days < 60) {
    return {
      title,
      severity: 'Medium',
      signal: translate('scoring.factors.tokenAgeMediumSignal'),
      value: formatAge(days),
      explanation: translate('scoring.factors.tokenAgeMediumExplain', { age: formatAge(days) }),
    };
  }
  return {
    title,
    severity: 'Low',
    signal: translate('scoring.factors.tokenAgeLowSignal'),
    value: formatAge(days),
    explanation: translate('scoring.factors.tokenAgeLowExplain', { age: formatAge(days) }),
  };
}

function liquidityFactor(liquidity, poolCount = 0) {
  const title = translate('scoring.factors.liquidityTitle');
  if (!liquidity) {
    return {
      title,
      severity: 'Limited',
      signal: translate('scoring.factors.liquidityUnavailableSignal'),
      value: translate('common.notAvailable'),
      explanation: translate('scoring.factors.liquidityUnavailableExplain'),
    };
  }
  const poolText = poolCount ? translate('scoring.factors.acrossPools', { count: formatNumber(poolCount) }) : '';
  if (liquidity < 5000) {
    return {
      title,
      severity: 'High',
      signal: translate('scoring.factors.liquidityHighSignal'),
      value: formatCurrency(liquidity),
      explanation: translate('scoring.factors.liquidityHighExplain', { value: formatCurrency(liquidity), poolText }),
    };
  }
  if (liquidity < 50000) {
    return {
      title,
      severity: 'Medium',
      signal: translate('scoring.factors.liquidityMediumSignal'),
      value: formatCurrency(liquidity),
      explanation: translate('scoring.factors.liquidityMediumExplain', { value: formatCurrency(liquidity) }),
    };
  }
  return {
    title,
    severity: 'Low',
    signal: translate('scoring.factors.liquidityLowSignal'),
    value: formatCurrency(liquidity),
    explanation: translate('scoring.factors.liquidityLowExplain', { value: formatCurrency(liquidity), poolText }),
  };
}

const PRESENCE_FACTOR_KEYS = {
  website: { title: 'presenceWebsiteTitle', ok: 'presenceWebsiteOk', missing: 'presenceWebsiteMissing', explain: 'presenceWebsiteExplain' },
  twitter: { title: 'presenceTwitterTitle', ok: 'presenceTwitterOk', missing: 'presenceTwitterMissing', explain: 'presenceTwitterExplain' },
  telegram: { title: 'presenceTelegramTitle', ok: 'presenceTelegramOk', missing: 'presenceTelegramMissing', explain: 'presenceTelegramExplain' },
};

function presenceFactor(kind, presence) {
  const keys = PRESENCE_FACTOR_KEYS[kind];
  const title = translate(`scoring.factors.${keys.title}`);
  if (presence.state === 'Present') {
    const okSignal = translate(`scoring.factors.${keys.ok}`);
    return {
      title,
      severity: 'Low',
      signal: okSignal,
      value: translate('scoring.factors.presenceFound', { value: presence.value }),
      explanation: `${okSignal}: ${presence.value}`,
    };
  }
  if (presence.state === 'Data unavailable') {
    return {
      title,
      severity: 'Limited',
      signal: translate('common.dataUnavailable'),
      value: translate('common.dataUnavailable'),
      explanation: translate('scoring.factors.presenceDataUnavailable', { title: title.toLowerCase() }),
    };
  }
  return {
    title,
    severity: 'Medium',
    signal: translate(`scoring.factors.${keys.missing}`),
    value: translate('common.missing'),
    explanation: translate(`scoring.factors.${keys.explain}`),
  };
}

function riskSeverityRank(severity) {
  return { Low: 1, Limited: 2, Medium: 3, High: 4 }[severity] || 0;
}

function riskSignals(project = {}) {
  return riskFactors(project).map((factor) => ({
    label: factor.title,
    value: factor.severity,
    detail: factor.explanation,
  }));
}

function holderRiskLabel(data = {}, holders = 0) {
  if (data.topHolderPercent > 35 || data.topTenHolderPercent > 70) return 'High';
  if (data.topHolderPercent > 20 || data.topTenHolderPercent > 50 || (holders > 0 && holders < 500)) return 'Medium';
  if (holders >= 500 || data.topHolderPercent !== null) return 'Low';
  return 'Limited data';
}

function holderRiskDetail(data = {}, holders = 0) {
  if (!holders && data.topHolderPercent === null) return 'Holder count and concentration need more public data.';
  const holderText = holders ? `${formatNumber(holders)} holders found` : 'Holder count not available';
  const topHolderText = data.topHolderPercent === null || data.topHolderPercent === undefined
    ? 'top holder data unavailable'
    : `largest holder at ${formatPercent(data.topHolderPercent)}`;
  return `${holderText}; ${topHolderText}.`;
}

function liquidityRiskLabel(liquidity = 0) {
  if (!liquidity) return 'Limited data';
  if (liquidity < 5000) return 'High';
  if (liquidity < 50000) return 'Medium';
  return 'Low';
}

function socialRiskLabel(count = 0) {
  if (count <= 1) return 'High';
  if (count <= 2) return 'Medium';
  return 'Low';
}

function founderRoadmapLabel(project = {}) {
  if (project.founderStatus?.toLowerCase().includes('anonymous')) return 'High';
  if (!hasRoadmap(project)) return 'Medium';
  if (isPublicFounder(project.founderStatus)) return 'Low';
  return 'Medium';
}

function plainRiskExplanation(project = {}) {
  const score = project.trustScore || 0;
  if (score >= 78) {
    return translate('scoring.plainExplanation.strong');
  }
  if (score >= 55) {
    return translate('scoring.plainExplanation.mixed');
  }
  return translate('scoring.plainExplanation.weak');
}

const PDF_LOCALE_MAP = { en: 'en-US', az: 'az-AZ', tr: 'tr-TR', ru: 'ru-RU' };

function buildPdfReportData(project = {}) {
  const confidence = confidenceScore(project);
  const data = project.realData || {};
  const language = getLanguage();
  return {
    name: project.name,
    ticker: project.ticker,
    chain: project.chain,
    contract: displayValue(project.contract),
    trustScore: project.trustScore,
    riskLevel: translateRiskLevel(project.riskLevel),
    verificationStatus: translatedVerificationStatusLabel(project.verificationStatus),
    isVerified: normalizeVerificationStatus(project.verificationStatus) === VERIFICATION_STATUS.VERIFIED,
    confidenceLabel: confidence.label,
    riskReasons: riskSignals(project).slice(0, 3),
    riskNotes: project.riskNotes,
    socialLinks: {
      website: displayValue(project.website),
      twitter: displayValue(project.twitter),
      telegram: displayValue(project.telegram),
      github: displayValue(project.github),
    },
    holderData: {
      holderCount: formatNumber(data.holderCount || project.holders),
      topHolderPercent: formatPercent(data.topHolderPercent),
      topTenHolderPercent: formatPercent(data.topTenHolderPercent),
    },
    liquidityData: {
      liquidityUsd: formatCurrency(data.totalLiquidityUsd ?? data.liquidityUsd),
      marketCapUsd: formatCurrency(data.marketCapUsd),
    },
    tokenAge: project.realData ? formatAge(data.tokenAgeDays) : formatAge(project.launchDate ? daysSince(project.launchDate) : null),
    scoreBreakdown: project.scoreBreakdown || {},
    generatedDate: new Date().toLocaleString(PDF_LOCALE_MAP[language] || 'en-US', { dateStyle: 'medium', timeStyle: 'short' }),
    labels: translate('pdfReport', null, language),
  };
}

async function handleDownloadPdf(project) {
  try {
    const { generatePdfReport } = await import('./pdfReport.js');
    generatePdfReport(buildPdfReportData(project));
    trackPdfDownload(project);
  } catch {
    alert('PDF generation failed to load. Check your connection and try again.');
  }
}

function handleUnlockPremiumClick(project) {
  trackPremiumClick();
  return handleCheckout('premium');
}

function handleEarlySupporterClick() {
  trackEarlySupporterClick();
  return handleCheckout('early_supporter');
}

async function handleCheckout(plan) {
  if (!isStripeConfigured(plan)) {
    trackCheckoutUnavailable(plan, 'missing_config');
    return { ok: false, message: stripeUnavailableMessage() };
  }

  trackCheckoutStarted(plan);
  try {
    const result = await startStripeCheckout(plan);
    if (!result.ok) {
      trackCheckoutUnavailable(plan, result.reason);
    }
    return result;
  } catch {
    trackCheckoutUnavailable(plan, 'checkout_error');
    return { ok: false, message: stripeUnavailableMessage() };
  }
}

function shareText(project = {}, channel = 'x') {
  const name = project.name || translate('scoring.shareText.thisToken');
  const score = project.trustScore || 0;
  const risk = riskBadge(score);
  const contract = hasValue(project.contract) ? translate('scoring.shareText.contractSuffix', { contract: project.contract }) : '';
  const key = channel === 'telegram' ? 'scoring.shareText.telegram' : 'scoring.shareText.x';
  return translate(key, { name, score, risk, contract });
}

function roundPercent(ratio) {
  return Math.round(ratio * 10000) / 100;
}

function readStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function readProjectStorage() {
  return readStorage(PROJECTS_KEY, []).filter((project) => !project?.realData?.isDemo);
}

function writeProjectStorage(projects) {
  writeStorage(PROJECTS_KEY, projects.filter((project) => !project?.realData?.isDemo));
}

function looksLikeSolanaAddress(value) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,48}$/.test(value.trim());
}

function upsertProject(items, project) {
  const normalizedContract = project.contract?.toLowerCase();
  const existing = findStoredProject(items, project);
  if (project.realData?.isDemo && existing?.realData && !existing.realData.isDemo) {
    return [normalizeProject(existing), ...items.filter((item) => item !== existing)];
  }
  const mergedProject = normalizeProject(mergeStoredMetadata(project, existing));
  const projectWithGrowth = applyHolderGrowth(mergedProject, existing);
  const withoutExisting = items.filter((item) => {
    const sameId = item.id === projectWithGrowth.id;
    const sameContract = normalizedContract && item.contract?.toLowerCase() === normalizedContract;
    return !sameId && !sameContract;
  });
  return [projectWithGrowth, ...withoutExisting];
}

function applyHolderGrowth(project, existing) {
  return project;
}

function App() {
  const { t } = useTranslation();
  const [page, setPage] = useState(() => window.location.hash.replace('#/', '') || 'home');
  const [query, setQuery] = useState('');
  const [searchState, setSearchState] = useState({ status: 'idle', message: '' });
  const [activeFilter, setActiveFilter] = useState('All');
  const [userProjects, setUserProjects] = useState(() => readProjectStorage());
  const [watchlist, setWatchlist] = useState(() => readStorage(WATCHLIST_KEY, []));
  const [methodologyOpen, setMethodologyOpen] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [verificationMap, setVerificationMap] = useState({});
  const [requestingVerification, setRequestingVerification] = useState(null);

  const refreshVerificationMap = async () => {
    const statuses = await fetchVerificationStatuses();
    setVerificationMap(statuses);
  };

  useEffect(() => {
    refreshVerificationMap();
  }, []);

  useEffect(() => {
    const onHash = () => setPage(window.location.hash.replace('#/', '') || 'home');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => writeProjectStorage(userProjects), [userProjects]);
  useEffect(() => writeStorage(WATCHLIST_KEY, watchlist), [watchlist]);

  useEffect(() => {
    initAnalytics();
    initAnalyticsContext();
  }, []);

  useEffect(() => {
    trackPageView(`/${page}`);
    trackPageViewEvent(`/${page}`);
  }, [page]);

  useEffect(() => {
    if (page === 'pricing') trackPricingView();
  }, [page]);

  const projects = useMemo(
    () => userProjects.map((project) => applyVerificationStatus(normalizeProject(project), verificationMap)),
    [userProjects, verificationMap]
  );
  const selectedProject = useMemo(() => {
    if (page === 'khan') return projects.find((project) => project.contract === '6bSHkoMYqzyCZdWPQ45nUv73dvdfx4yEd4yEemefpump') || null;
    if (!page.startsWith('project/')) return null;
    const id = page.split('/')[1];
    return projects.find((project) => project.id === id) || null;
  }, [page, projects]);
  const reportProject = useMemo(() => {
    if (!page.startsWith('report/')) return null;
    const id = page.split('/')[1];
    return projects.find((project) => project.id === id) || null;
  }, [page, projects]);

  useEffect(() => {
    if (reportProject) trackReportViewed(reportProject);
  }, [reportProject]);

  useEffect(() => {
    if (selectedProject) trackProjectViewEvent(selectedProject);
  }, [selectedProject?.id]);

  const navigate = (target) => {
    window.location.hash = `/${target}`;
    setPage(target);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const saveProjectProfile = (project) => {
    const normalized = normalizeProject(project);
    setUserProjects((items) => upsertProject(items, normalized));
    return normalized;
  };

  const addProject = (project) => {
    const normalized = saveProjectProfile(project);
    trackProjectAddedEvent(normalized);
    navigate(`project/${normalized.id}`);
  };

  const updateProject = (projectId, updates) => {
    setUserProjects((items) =>
      items.map((item) => {
        if (item.id !== projectId) return item;
        const updated = normalizeProject({
          ...item,
          ...updates,
          realData: syncSocialData(item.realData, updates),
          lastUpdate: new Date().toISOString().slice(0, 10),
        });
        return updated;
      })
    );
    setEditingProject(null);
  };

  const handleSearch = async () => {
    const term = query.trim();
    if (!term) {
      navigate('explore');
      return;
    }

    if (!looksLikeSolanaAddress(term)) {
      setSearchState({ status: 'idle', message: '' });
      navigate('explore');
      return;
    }

    setSearchState({ status: 'loading', message: t('search.fetching') });
    trackTokenScanStarted(term);
    trackSearchEvent(term);
    try {
      const liveLookup = await lookupSolanaToken(term);
      const liveProject = normalizeProject(mergeStoredMetadata(liveLookup, findStoredProject(userProjects, liveLookup)));
      setUserProjects((items) => upsertProject(items, liveProject));
      setSearchState({ status: 'success', message: t('search.successOpened', { name: liveProject.name || liveProject.ticker }) });
      trackTokenScanCompleted(term, 'success');
      trackTokenScanEvent(liveProject);
      navigate(`project/${liveProject.id}`);
    } catch (error) {
      setSearchState({ status: 'error', message: error.message || t('search.errorNone') });
      trackTokenScanCompleted(term, 'error');
      navigate('explore');
    }
  };

  const handleTokenCheck = async (contractAddress) => {
    const term = contractAddress.trim();
    if (!term) {
      return { status: 'error', message: t('checkToken.errorEmpty') };
    }
    if (!looksLikeSolanaAddress(term)) {
      return { status: 'error', message: t('checkToken.errorInvalid') };
    }

    try {
      trackTokenScanStarted(term);
      trackSearchEvent(term);
      const liveLookup = await lookupSolanaToken(term);
      const liveProject = normalizeProject(mergeStoredMetadata(liveLookup, findStoredProject(userProjects, liveLookup)));
      setUserProjects((items) => upsertProject(items, liveProject));
      trackTokenScanCompleted(term, 'success');
      trackTokenScanEvent(liveProject);
      navigate(`report/${liveProject.id}`);
      return { status: 'success', message: t('checkToken.successOpened', { name: liveProject.name || liveProject.ticker }) };
    } catch (error) {
      const existing = findStoredProject(userProjects, { contract: term });
      if (existing?.realData && !existing.realData.isDemo) {
        const existingProject = normalizeProject(existing);
        trackTokenScanCompleted(term, 'cached-live');
        trackTokenScanEvent(existingProject);
        navigate(`report/${existingProject.id}`);
        return { status: 'success', message: t('checkToken.successCachedLive', { name: existingProject.name || existingProject.ticker }) };
      }
      const demoProject = normalizeProject(createDemoRiskProject(term, error.message));
      setUserProjects((items) => upsertProject(items, demoProject));
      trackTokenScanCompleted(term, 'demo-fallback');
      navigate(`report/${demoProject.id}`);
      return { status: 'success', message: t('checkToken.successDemo') };
    }
  };

  const toggleWatch = (projectId) => {
    setWatchlist((items) => (items.includes(projectId) ? items.filter((id) => id !== projectId) : [...items, projectId]));
  };

  return (
    <div className="app-shell">
      <Header page={page} navigate={navigate} />
      <main>
        {page === 'home' && (
          <HomePage
            projects={projects}
            query={query}
            setQuery={setQuery}
            searchState={searchState}
            onSearch={handleSearch}
            onTokenCheck={handleTokenCheck}
            navigate={navigate}
            openMethodology={() => setMethodologyOpen(true)}
          />
        )}
        {page === 'explore' && (
          <ExplorePage
            projects={projects}
            query={query}
            setQuery={setQuery}
            searchState={searchState}
            onSearch={handleSearch}
            activeFilter={activeFilter}
            setActiveFilter={setActiveFilter}
            navigate={navigate}
          />
        )}
        {page === 'add' && <AddProjectPage onAdd={addProject} navigate={navigate} />}
        {page === 'launchpad' && <LaunchpadPage onCreateProfile={saveProjectProfile} navigate={navigate} />}
        {page === 'pricing' && <PricingPage navigate={navigate} />}
        {page === 'whitepaper' && <WhitepaperPage navigate={navigate} />}
        {page === 'compare' && <ComparePage projects={projects} navigate={navigate} />}
        {page.startsWith('report/') && reportProject && (
          <RiskReportPage project={reportProject} navigate={navigate} />
        )}
        {page.startsWith('report/') && !reportProject && (
          <section className="page-section">
            <EmptyState title={t('explore.emptyNoReportTitle')} text={t('explore.emptyNoReportText')} />
          </section>
        )}
        {(page.startsWith('project/') || page === 'khan') && selectedProject && (
          <ProjectProfile
            project={selectedProject}
            navigate={navigate}
            watched={watchlist.includes(selectedProject.id)}
            toggleWatch={() => toggleWatch(selectedProject.id)}
            onEdit={() => setEditingProject(selectedProject)}
            openMethodology={() => setMethodologyOpen(true)}
            onRequestVerification={() => setRequestingVerification(selectedProject)}
          />
        )}
        {page.startsWith('project/') && !selectedProject && (
          <section className="page-section">
            <EmptyState title={t('explore.emptyNoProfileTitle')} text={t('explore.emptyNoProfileText')} />
          </section>
        )}
        {page === 'khan' && !selectedProject && <KhanEcosystemPage navigate={navigate} />}
        {page === 'about' && <AboutPage openMethodology={() => setMethodologyOpen(true)} navigate={navigate} />}
        {page === 'admin-verify' && <AdminVerificationPage onReviewed={refreshVerificationMap} />}
        {page === 'admin-analytics' && <AdminAnalyticsPage />}
      </main>
      <Footer />
      <MobileNav page={page} navigate={navigate} />
      {methodologyOpen && <MethodologyModal onClose={() => setMethodologyOpen(false)} />}
      {requestingVerification && (
        <VerificationRequestModal
          project={requestingVerification}
          onClose={() => setRequestingVerification(null)}
          onSubmitted={async () => {
            await refreshVerificationMap();
            setRequestingVerification(null);
          }}
        />
      )}
      {editingProject && (
        <EditProjectModal
          project={editingProject}
          onSave={updateProject}
          onClose={() => setEditingProject(null)}
        />
      )}
    </div>
  );
}

function Header({ page, navigate }) {
  const { t } = useTranslation();
  return (
    <header className="site-header">
      <button className="brand" onClick={() => navigate('home')} aria-label={t('header.goHome')}>
        <span className="brand-mark">K</span>
        <span>
          <strong>KHAN Trust</strong>
          <small>{t('header.tagline')}</small>
        </span>
      </button>
      <div className="header-right">
        <nav className="desktop-nav">
          {navItems.map((item) => (
            <button key={item.id} className={isActive(page, item.id) ? 'active' : ''} onClick={() => navigate(item.id)}>
              {t(`nav.${item.id}`)}
            </button>
          ))}
        </nav>
        <ConnectWalletButton variant="desktop" />
        <LanguageSwitcher variant="desktop" />
      </div>
    </header>
  );
}

function MobileNav({ page, navigate }) {
  const { t } = useTranslation();
  return (
    <nav className="mobile-nav">
      {navItems.map((item) => {
        const Icon = item.icon;
        return (
          <button key={item.id} className={isActive(page, item.id) ? 'active' : ''} onClick={() => navigate(item.id)}>
            <Icon size={18} />
            <span>{t(`nav.${item.id}`)}</span>
          </button>
        );
      })}
      <ConnectWalletButton variant="mobile" />
      <LanguageSwitcher variant="mobile" />
    </nav>
  );
}

function isActive(page, id) {
  if (id === 'khan') return page === 'khan';
  if (id === 'explore') return page === 'explore' || page.startsWith('project/') || page.startsWith('report/');
  return page === id;
}

function HomePage({ projects, query, setQuery, searchState, onSearch, onTokenCheck, navigate, openMethodology }) {
  const { t } = useTranslation();
  const featured = projects.slice(0, 4);
  const heroProject = featured[0];
  return (
    <>
      <section className="hero-section">
        <div className="hero-grid">
          <div className="hero-copy">
            <p className="eyebrow"><Shield size={16} /> {t('home.eyebrow')}</p>
            <h1>{t('home.title')}</h1>
            <p className="hero-subtitle">{t('home.subtitle')}</p>
            <p className="hero-explainer">{t('home.explainer')}</p>
            <SearchBox value={query} onChange={setQuery} onSubmit={onSearch} loading={searchState.status === 'loading'} />
            <SearchStatus state={searchState} />
            <div className="flow-steps" aria-label={t('home.flowAriaLabel')}>
              {t('home.flowSteps').map((step, index) => (
                <div className="flow-step" key={step}>
                  <span>{index + 1}</span>
                  <strong>{step}</strong>
                </div>
              ))}
            </div>
            <div className="hero-actions">
              <button className="primary-button" onClick={() => navigate('explore')}>
                {t('home.exploreProjects')} <ArrowRight size={18} />
              </button>
              <button className="secondary-button" onClick={() => navigate('add')}>
                {t('home.addProject')} <Plus size={18} />
              </button>
              <button className="ghost-button" onClick={() => navigate('khan')}>
                {t('home.viewKhan')} <Star size={18} />
              </button>
              <a className="secondary-button" href={OFFICIAL_KHAN_LINKS.telegram} target="_blank" rel="noreferrer" onClick={() => trackSocialClick('Telegram Community', OFFICIAL_KHAN_LINKS.telegram)}>
                {t('home.joinTelegram')} <MessageCircle size={18} />
              </a>
            </div>
          </div>
          <div className="hero-panel">
            <div className="signal-header">
              <div>
                <span className="tiny-label">{t('home.liveTrustRadar')}</span>
                <h2>{t('home.projectSignals')}</h2>
              </div>
              <BadgeCheck className="gold-icon" />
            </div>
            <div className="radar-score">
              {heroProject ? <ScoreCircle score={heroProject.trustScore} size="large" /> : <BadgeCheck className="gold-icon hero-empty-icon" size={56} />}
              <div>
                <strong>{heroProject ? heroProject.name : t('home.liveTokenLookup')}</strong>
                <span>{heroProject ? `${heroProject.ticker} on ${heroProject.chain}` : t('home.pasteContractToFetch')}</span>
              </div>
            </div>
            <div className="signal-list">
              {t('home.signalRows').map((item) => (
                <div key={item} className="signal-row">
                  <CheckCircle2 size={18} />
                  <span>{item}</span>
                  <small>{t('home.tracked')}</small>
                </div>
              ))}
            </div>
            <button className="method-button" onClick={openMethodology}>
              {t('home.methodology')} <Info size={16} />
            </button>
          </div>
        </div>
      </section>
      <CheckAnyTokenSection onTokenCheck={onTokenCheck} navigate={navigate} />
      <KhanEcosystemStrip navigate={navigate} />
      <section className="content-band">
        <SectionTitle icon={BarChart3} eyebrow={t('home.exploreEyebrow')} title={t('home.exploreTitle')} />
        <div className="project-grid">
          {featured.map((project) => (
            <ProjectCard key={project.id} project={project} navigate={navigate} />
          ))}
        </div>
        {!featured.length && <EmptyState title={t('home.emptyNoSavedTitle')} text={t('home.emptyNoSavedText')} />}
      </section>
      <KhanTokenRole navigate={navigate} />
      <FutureFoundationSection />
      <Disclaimer />
    </>
  );
}

function CheckAnyTokenSection({ onTokenCheck, navigate }) {
  const { t } = useTranslation();
  const [contractAddress, setContractAddress] = useState('');
  const [state, setState] = useState({ status: 'idle', message: '' });

  const submit = async (event) => {
    event.preventDefault();
    setState({ status: 'loading', message: t('checkToken.checking') });
    const result = await onTokenCheck(contractAddress);
    setState(result);
  };

  return (
    <section className="content-band check-token-section" id="check-token">
      <div className="check-token-grid">
        <div>
          <SectionTitle icon={Search} eyebrow={t('checkToken.eyebrow')} title={t('checkToken.title')} />
          <p>{t('checkToken.description')}</p>
        </div>
        <form className="token-check-card" onSubmit={submit}>
          <label className="form-field">
            <span>{t('checkToken.fieldLabel')}</span>
            <input
              value={contractAddress}
              onChange={(event) => setContractAddress(event.target.value)}
              placeholder={t('checkToken.placeholder')}
              autoComplete="off"
            />
          </label>
          {state.message && <p className={`lookup-message ${state.status === 'error' ? 'error' : ''}`}>{state.message}</p>}
          <div className="token-check-actions">
            <button className="primary-button" type="submit" disabled={state.status === 'loading'}>
              <Search size={18} /> {state.status === 'loading' ? t('checkToken.submitChecking') : t('checkToken.submit')}
            </button>
            <button className="ghost-button" type="button" onClick={() => navigate('pricing')}>
              {t('checkToken.seePricing')} <WalletCards size={18} />
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

function ExplorePage({ projects, query, setQuery, searchState, onSearch, activeFilter, setActiveFilter, navigate }) {
  const { t } = useTranslation();
  const filtered = projects.filter((project) => {
    const text = `${project.name} ${project.ticker} ${project.chain} ${project.contract}`.toLowerCase();
    const matchesQuery = !query || text.includes(query.toLowerCase());
    const matchesFilter =
      activeFilter === 'All' ||
      project.chain === activeFilter ||
      (activeFilter === 'New Projects' && daysSince(project.launchDate) < 90) ||
      (activeFilter === 'High Risk' && project.riskLevel === 'High') ||
      (activeFilter === 'Strong Community' && project.communitySize >= 5000);
    return matchesQuery && matchesFilter;
  });

  return (
    <section className="page-section">
      <SectionTitle icon={ListFilter} eyebrow={t('explore.eyebrow')} title={t('explore.title')} />
      <SearchBox value={query} onChange={setQuery} onSubmit={onSearch} loading={searchState.status === 'loading'} />
      <SearchStatus state={searchState} />
      <div className="filter-row">
        {filters.map((filter) => (
          <button key={filter} className={activeFilter === filter ? 'active' : ''} onClick={() => setActiveFilter(filter)}>
            {t(`explore.filters.${FILTER_KEY_MAP[filter]}`)}
          </button>
        ))}
      </div>
      <div className="project-grid">
        {filtered.map((project) => (
          <ProjectCard key={project.id} project={project} navigate={navigate} />
        ))}
      </div>
      {!filtered.length && <EmptyState title={t('explore.emptyNoMatchTitle')} text={t('explore.emptyNoMatchText')} />}
    </section>
  );
}

function ComparePage({ projects, navigate }) {
  const { t } = useTranslation();
  const [firstId, setFirstId] = useState(projects[0]?.id || '');
  const [secondId, setSecondId] = useState(projects[1]?.id || projects[0]?.id || '');
  const first = projects.find((project) => project.id === firstId) || projects[0];
  const second = projects.find((project) => project.id === secondId) || projects[1] || projects[0];

  useEffect(() => {
    if (first && second) trackCompareUsedEvent(first, second);
  }, [first?.id, second?.id]);

  return (
    <section className="page-section compare-page">
      <SectionTitle icon={Scale} eyebrow={t('compare.eyebrow')} title={t('compare.title')} />
      {!projects.length && <EmptyState title={t('compare.emptyTitle')} text={t('compare.emptyText')} />}
      <div className="compare-selectors">
        <ProjectSelect label={t('compare.projectA')} value={first?.id || ''} projects={projects} onChange={setFirstId} />
        <ProjectSelect label={t('compare.projectB')} value={second?.id || ''} projects={projects} onChange={setSecondId} />
      </div>
      {first && second && (
        <>
          <div className="compare-grid">
            <ComparePanel project={first} navigate={navigate} />
            <ComparePanel project={second} navigate={navigate} />
          </div>
          <div className="compare-table detail-section">
            <SectionTitle icon={BarChart3} eyebrow={t('compare.signalReviewEyebrow')} title={t('compare.sideBySide')} />
            <CompareRow label={t('compare.rows.trustScore')} first={`${first.trustScore}/100`} second={`${second.trustScore}/100`} />
            <CompareRow label={t('compare.rows.verification')} first={translatedVerificationStatusLabel(first.verificationStatus)} second={translatedVerificationStatusLabel(second.verificationStatus)} />
            <CompareRow label={t('compare.rows.chain')} first={first.chain} second={second.chain} />
            <CompareRow label={t('compare.rows.marketCap')} first={formatCurrency(first.realData?.marketCapUsd)} second={formatCurrency(second.realData?.marketCapUsd)} />
            <CompareRow label={t('compare.rows.liquidity')} first={formatCurrency(first.realData?.totalLiquidityUsd ?? first.realData?.liquidityUsd)} second={formatCurrency(second.realData?.totalLiquidityUsd ?? second.realData?.liquidityUsd)} />
            <CompareRow label={t('compare.rows.holderCount')} first={formatNumber(first.realData?.holderCount || first.holders)} second={formatNumber(second.realData?.holderCount || second.holders)} />
            <CompareRow label={t('compare.rows.tokenAge')} first={formatAge(first.realData?.tokenAgeDays)} second={formatAge(second.realData?.tokenAgeDays)} />
            <CompareRow label={t('compare.rows.largestHolder')} first={formatPercent(first.realData?.topHolderPercent)} second={formatPercent(second.realData?.topHolderPercent)} />
            <CompareRow label={t('compare.rows.topTen')} first={formatPercent(first.realData?.topTenHolderPercent)} second={formatPercent(second.realData?.topTenHolderPercent)} />
            <CompareRow label={t('compare.rows.socialScore')} first={formatScore(first.scoreBreakdown.socialScore)} second={formatScore(second.scoreBreakdown.socialScore)} />
            <CompareRow label={t('compare.rows.riskFlags')} first={first.riskFlags.join(', ')} second={second.riskFlags.join(', ')} />
            <CompareRow label={t('compare.rows.roadmapStatus')} first={roadmapClarity(first)} second={roadmapClarity(second)} />
            <CompareRow label={t('compare.rows.founderStatus')} first={displayValue(first.founderStatus)} second={displayValue(second.founderStatus)} />
          </div>
        </>
      )}
    </section>
  );
}

function ProjectSelect({ label, value, projects, onChange }) {
  const { t } = useTranslation();
  return (
    <label className="form-field compare-select">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {!projects.length && <option value="">{t('compare.noLiveProfiles')}</option>}
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name} ({project.ticker})
          </option>
        ))}
      </select>
    </label>
  );
}

function ComparePanel({ project, navigate }) {
  const { t } = useTranslation();
  return (
    <article className="compare-panel">
      <div className="compare-panel-top">
        <div>
          <span className="status-badge">{project.chain}</span>
          <h3>{project.name}</h3>
          <p>{project.ticker}</p>
          <VerifiedBadge status={project.verificationStatus} />
        </div>
        <ScoreCircle score={project.trustScore} />
      </div>
      <div className="compare-metrics">
        <span><Users size={16} /> {formatNumber(project.realData?.holderCount || project.holders)} {t('compare.holders')}</span>
        <span><Shield size={16} /> {project.founderStatus}</span>
        <RiskPill level={project.riskLevel} />
      </div>
      <button className="card-button" onClick={() => navigate(`project/${project.id}`)}>
        {t('compare.openProfile')} <ArrowRight size={17} />
      </button>
    </article>
  );
}

function CompareRow({ label, first, second }) {
  return (
    <div className="compare-row">
      <span>{label}</span>
      <strong>{first}</strong>
      <strong>{second}</strong>
    </div>
  );
}

function RiskReportPage({ project, navigate }) {
  const { t } = useTranslation();
  const reasons = riskSignals(project).slice(0, 3);
  const factors = riskFactors(project);
  const confidence = confidenceScore(project);
  return (
    <section className="page-section report-page">
      <button className="back-button" onClick={() => navigate('home')}>{t('riskReport.checkAnother')}</button>
      <div className="report-hero detail-section">
        <div>
          <span className="status-badge">{project.realData?.isDemo ? t('riskReport.demoReport') : t('riskReport.freeReport')}</span>
          <h1>{t('riskReport.title')}</h1>
          <p>{project.name} on {project.chain}</p>
          <strong className="contract-line">{project.contract}</strong>
        </div>
        <div className="report-score">
          <ScoreCircle score={project.trustScore} size="large" />
          <RiskPill level={project.riskLevel} />
        </div>
      </div>

      <div className="report-action-row">
        <div className="pdf-export-cta">
          <button className="secondary-button" type="button" onClick={() => handleDownloadPdf(project)}>
            <Download size={18} /> {t('riskReport.downloadPdf')}
          </button>
          <small>{t('riskReport.downloadHint')}</small>
        </div>
      </div>

      <div className="report-layout">
        <div className="main-column">
          <section className="detail-section">
            <SectionTitle icon={Shield} eyebrow={t('riskReport.basicScanEyebrow')} title={t('riskReport.basicViewTitle')} />
            <div className="report-metrics">
              <div>
                <span>{t('riskReport.trustScoreLabel')}</span>
                <strong>{project.trustScore}/100</strong>
              </div>
              <div>
                <span>{t('riskReport.riskLevelLabel')}</span>
                <strong>{translateRiskLevel(project.riskLevel)}</strong>
              </div>
              <div>
                <span>{t('riskReport.dataModeLabel')}</span>
                <strong>{project.realData?.isDemo ? t('riskReport.dataModeMock') : t('riskReport.dataModeLive')}</strong>
              </div>
              <div>
                <span>{t('riskReport.confidenceScoreLabel')}</span>
                <strong>{confidence.label}</strong>
              </div>
            </div>
            <p className="inline-note">{t('riskReport.signalCoverage', { available: confidence.available, total: confidence.total })}</p>
          </section>

          <section className="detail-section">
            <SectionTitle icon={AlertTriangle} eyebrow={t('riskReport.reasonsEyebrow')} title={t('riskReport.reasonsTitle')} />
            <div className="risk-reason-list">
              {reasons.map((reason) => (
                <div className="risk-reason" key={reason.label}>
                  <span>{reason.label}</span>
                  <strong>{reason.value}</strong>
                  <p>{reason.detail}</p>
                </div>
              ))}
            </div>
            <p className="plain-explanation">{plainRiskExplanation(project)}</p>
          </section>

          <section className="detail-section">
            <SectionTitle icon={ListFilter} eyebrow={t('riskReport.factorsEyebrow')} title={t('riskReport.factorsTitle')} />
            <div className="risk-factor-grid">
              {factors.map((factor) => (
                <div className={`risk-factor-card ${factor.severity.toLowerCase()}`} key={factor.title}>
                  <div>
                    <span>{factor.title}</span>
                    <strong>{factor.signal}</strong>
                  </div>
                  <em>{factor.value}</em>
                  <p>{factor.explanation}</p>
                </div>
              ))}
            </div>
          </section>

          <PremiumLockedSection project={project} navigate={navigate} />
        </div>

        <aside className="side-column">
          <OneTimeUnlockCard project={project} navigate={navigate} />
          <Disclaimer compact />
        </aside>
      </div>
    </section>
  );
}

function PremiumLockedSection({ project, navigate }) {
  const { t } = useTranslation();
  const [paymentMessage, setPaymentMessage] = useState('');
  const unlockPremium = async () => {
    const result = await handleUnlockPremiumClick(project);
    if (!result?.ok) setPaymentMessage(result?.message || stripeUnavailableMessage());
  };

  return (
    <section className="detail-section premium-lock-section">
      <SectionTitle icon={Lock} eyebrow={t('premium.eyebrow')} title={t('premium.unlockToolsTitle')} />
      <p className="inline-note">{t('premium.optionalNote')}</p>
      <div className="premium-feature-grid">
        {t('premium.items').map(([title, text]) => (
          <div className="premium-feature locked" key={title}>
            <Lock size={17} />
            <span>{title}</span>
            <p>{text}</p>
          </div>
        ))}
      </div>
      <div className="unlock-bar">
        <strong>{t('premium.unlockBarTitle')}</strong>
        <div>
          <button className="primary-button" type="button" onClick={unlockPremium}>
            {t('premium.unlockPremium')}
          </button>
          <button className="secondary-button" type="button" onClick={() => navigate('pricing')}>
            {t('premium.viewPlans')} <ArrowRight size={18} />
          </button>
        </div>
      </div>
      {paymentMessage && <p className="inline-note">{paymentMessage}</p>}
    </section>
  );
}

function OneTimeUnlockCard({ project, navigate }) {
  const { t } = useTranslation();
  const [paymentMessage, setPaymentMessage] = useState('');
  const unlockPremium = async () => {
    const result = await handleUnlockPremiumClick(project);
    if (!result?.ok) setPaymentMessage(result?.message || stripeUnavailableMessage());
  };

  return (
    <section className="detail-section one-time-card">
      <SectionTitle icon={FileWarning} eyebrow={t('premium.eyebrow')} title={t('premium.accessTitle')} />
      <strong>{t('premium.priceMonthly')}</strong>
      <p>{t('premium.accessNote')}</p>
      <button className="primary-button" type="button" onClick={unlockPremium}>
        {t('premium.unlockPremium')}
      </button>
      <button className="secondary-button" type="button" onClick={() => navigate('pricing')}>
        {t('premium.viewPricing')} <WalletCards size={18} />
      </button>
      {paymentMessage && <p className="inline-note">{paymentMessage}</p>}
    </section>
  );
}

function PricingPage({ navigate }) {
  const { t } = useTranslation();
  const [paymentMessage, setPaymentMessage] = useState('');
  const beginCheckout = async (plan) => {
    const result = plan === 'early_supporter' ? await handleEarlySupporterClick() : await handleUnlockPremiumClick();
    if (!result?.ok) setPaymentMessage(result?.message || stripeUnavailableMessage());
  };

  const plans = [
    { ...t('pricing.plans.free'), action: () => navigate('home') },
    { ...t('pricing.plans.premium'), action: () => beginCheckout('premium'), featured: true },
    { ...t('pricing.plans.earlySupporter'), action: () => beginCheckout('early_supporter') },
  ];

  return (
    <section className="page-section pricing-page">
      <SectionTitle icon={WalletCards} eyebrow={t('pricing.eyebrow')} title={t('pricing.title')} />
      <p className="pricing-intro">{t('pricing.intro')}</p>
      <p className="pricing-note">{t('pricing.noInvestmentNote')}</p>
      <p className="pricing-note payment-message">
        {t('pricing.launchpadNote', { price: LAUNCHPAD_PAYMENT_MODEL.mainnetPriceLabel })}
      </p>
      {paymentMessage && <p className="pricing-note payment-message">{paymentMessage}</p>}
      <div className="premium-value-strip">
        {t('premium.items').map(([title]) => (
          <span key={title}><CheckCircle2 size={16} /> {title}</span>
        ))}
      </div>
      <div className="pricing-grid">
        {plans.map((plan) => (
          <article className={plan.featured ? 'pricing-card featured' : 'pricing-card'} key={plan.name}>
            <span className="status-badge">{plan.name}</span>
            <h3>{plan.price}</h3>
            <p>{plan.description}</p>
            <div className="pricing-features">
              {plan.features.map((feature) => (
                <span key={feature}><CheckCircle2 size={16} /> {feature}</span>
              ))}
            </div>
            <button className={plan.featured ? 'primary-button' : 'secondary-button'} type="button" onClick={plan.action}>
              {plan.cta}
            </button>
          </article>
        ))}
      </div>
      <PaymentMethodsSection beginCheckout={beginCheckout} />
      <p className="pricing-note">{t('pricing.footerNote')}</p>
      <Disclaimer />
    </section>
  );
}

function PaymentMethodsSection({ beginCheckout }) {
  return (
    <section className="payment-methods">
      <CardPaymentSection beginCheckout={beginCheckout} />
      <CryptoPaymentSection />
    </section>
  );
}

function CardPaymentSection({ beginCheckout }) {
  const { t } = useTranslation();
  const cardReady = isStripeConfigured('premium') || isStripeConfigured('early_supporter');
  return (
    <div className="payment-method-card">
      <span className="status-badge">{t('pricing.payment.cardBadge')}</span>
      <h3>{t('pricing.payment.cardTitle')}</h3>
      <p>{t('pricing.payment.cardDescription')}</p>
      {!cardReady && <p className="inline-note">{t('pricing.payment.cardNotConfigured')}</p>}
      <div className="payment-action-row">
        <button className="primary-button" type="button" onClick={() => beginCheckout('premium')}>
          {t('premium.unlockPremium')}
        </button>
        <button className="secondary-button" type="button" onClick={() => beginCheckout('early_supporter')}>
          {t('pricing.plans.earlySupporter').cta}
        </button>
      </div>
    </div>
  );
}

function verifyStatusMessageKey(status) {
  return {
    idle: 'pricing.payment.status.idle',
    not_configured: 'pricing.payment.status.notConfigured',
    verifying: 'pricing.payment.status.verifying',
    verified: 'pricing.payment.status.verified',
    failed: 'pricing.payment.status.failed',
    amount_too_low: 'pricing.payment.status.amountTooLow',
    wrong_receiver: 'pricing.payment.status.wrongReceiver',
    not_confirmed: 'pricing.payment.status.notConfirmed',
  }[status] || 'pricing.payment.status.idle';
}

function CryptoPaymentSection() {
  const { t } = useTranslation();
  const [transactionHash, setTransactionHash] = useState('');
  const [copied, setCopied] = useState(false);
  const [plan, setPlan] = useState('premium');
  const [verifyStatus, setVerifyStatus] = useState('idle');
  const [resultMessage, setResultMessage] = useState('');
  const [debugInfo, setDebugInfo] = useState(null);
  const walletConfigured = Boolean(CRYPTO_PAYMENT_WALLET);
  const verificationConfigured = isSolanaVerificationConfigured();

  const copyWallet = async () => {
    if (!walletConfigured) return;
    try {
      await navigator.clipboard.writeText(CRYPTO_PAYMENT_WALLET);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const verifyPayment = async () => {
    if (!verificationConfigured) {
      setVerifyStatus('not_configured');
      setResultMessage('');
      setDebugInfo(null);
      return;
    }
    if (!transactionHash.trim()) {
      setVerifyStatus('idle');
      setResultMessage('');
      setDebugInfo(null);
      return;
    }

    trackCryptoVerifyStarted(plan);
    setVerifyStatus('verifying');
    setResultMessage('');
    setDebugInfo(null);

    const result = await verifySolanaPayment({ transactionHash, plan });
    setVerifyStatus(result.status);
    setResultMessage(result.message || '');
    setDebugInfo(result.debug || null);

    if (result.status === 'verified') {
      trackCryptoVerifySuccess(plan);
    } else {
      trackCryptoVerifyFailed(plan, result.status);
    }
  };

  const statusMessage = resultMessage || t(verifyStatusMessageKey(verifyStatus));

  return (
    <div className="payment-method-card">
      <span className="status-badge">{t('pricing.payment.cryptoBadge')}</span>
      <h3>{t('pricing.payment.cryptoTitle')}</h3>
      <p>{t('pricing.payment.cryptoDescription')}</p>
      <div className="crypto-price-grid">
        <span>{t('pricing.payment.premiumPrice')}</span>
        <span>{t('pricing.payment.earlySupporterPrice')}</span>
      </div>
      {walletConfigured ? (
        <div className="wallet-copy-box">
          <span>{t('pricing.payment.walletLabel')}</span>
          <strong>{CRYPTO_PAYMENT_WALLET}</strong>
          <button className="secondary-button" type="button" onClick={copyWallet}>
            <Copy size={17} /> {copied ? t('common.copied') : t('pricing.payment.copyWallet')}
          </button>
        </div>
      ) : (
        <p className="inline-note">{t('pricing.payment.cryptoNotConfigured')}</p>
      )}

      {!verificationConfigured && <p className="inline-note">{solanaUnavailableMessage()}</p>}

      <label className="form-field">
        <span>{t('pricing.payment.planLabel')}</span>
        <select value={plan} onChange={(event) => setPlan(event.target.value)} disabled={!walletConfigured}>
          <option value="premium">{t('pricing.payment.planPremiumOption')}</option>
          <option value="early_supporter">{t('pricing.payment.planEarlySupporterOption')}</option>
        </select>
      </label>

      <label className="form-field transaction-field">
        <span>{t('pricing.payment.transactionHashLabel')}</span>
        <input
          value={transactionHash}
          onChange={(event) => {
            setTransactionHash(event.target.value);
            setVerifyStatus('idle');
            setResultMessage('');
            setDebugInfo(null);
          }}
          placeholder={t('pricing.payment.transactionHashPlaceholder')}
          disabled={!walletConfigured}
        />
      </label>

      <button
        className="primary-button"
        type="button"
        onClick={verifyPayment}
        disabled={!walletConfigured || verifyStatus === 'verifying'}
      >
        {t('pricing.payment.verifyPayment')}
      </button>

      <p className={verifyStatus === 'verified' ? 'inline-note verify-success' : 'inline-note'}>
        {statusMessage}
      </p>

      {verifyStatus === 'verified' && (
        <p className="inline-note">{t('pricing.payment.verifiedFollowUp')}</p>
      )}

      {debugInfo && (
        <div className="inline-note verify-debug-panel">
          <strong>{t('pricing.payment.debugTitle')}</strong>
          <ul>
            <li>Signature length: {debugInfo.signatureLength}</li>
            <li>RPC URL used: {debugInfo.rpcUrlUsed ?? 'n/a'}</li>
            <li>RPC attempt count: {debugInfo.rpcAttemptCount}</li>
            <li>
              RPC attempts:
              <ul>
                {(debugInfo.rpcAttempts || []).map((attempt, index) => (
                  <li key={`${attempt.url}-${index}`}>
                    {attempt.url} - {attempt.ok ? 'ok' : `failed (${attempt.error})`}
                  </li>
                ))}
              </ul>
            </li>
            <li>RPC error: {debugInfo.rpcError ?? 'none'}</li>
            <li>RPC response received: {debugInfo.rpcResponseReceived ? 'yes' : 'no'}</li>
            <li>Transaction confirmation status: {debugInfo.confirmationStatus ?? 'n/a'}</li>
            <li>Detected receiver wallet: {debugInfo.detectedReceiverWallet ?? 'none'}</li>
            <li>Expected receiver wallet: {debugInfo.expectedReceiverWallet ?? 'not set'}</li>
            <li>Detected SOL amount: {debugInfo.detectedSolAmount}</li>
            <li>Detected USD value: {debugInfo.detectedUsdValue} {debugInfo.priceSource ? `(source: ${debugInfo.priceSource})` : ''}</li>
            <li>Selected plan required amount: ${debugInfo.requiredUsdAmount}</li>
            <li>Final decision: {debugInfo.finalDecision}</li>
          </ul>
        </div>
      )}

      <p className="inline-note">{t('pricing.payment.contactSupport')}</p>
    </div>
  );
}

function roadmapClarity(project) {
  if (!project.roadmap?.length) return translate('scoring.noRoadmapProof');
  const completed = project.roadmap.filter((phase) => phase.status === 'Completed').length;
  const inProgress = project.roadmap.filter((phase) => phase.status === 'In progress').length;
  return translate('scoring.roadmapClarity', { count: project.roadmap.length, completed, inProgress });
}

function ProjectCard({ project, navigate }) {
  const { t } = useTranslation();
  return (
    <article className="project-card">
      <div className="card-top">
        <div>
          <span className="status-badge">{project.status}</span>
          <h3>{project.name}</h3>
          <p>{project.ticker} on {project.chain}</p>
          <VerifiedBadge status={project.verificationStatus} />
        </div>
        <ScoreCircle score={project.trustScore} />
      </div>
      <p className="card-description">{project.description}</p>
      <div className="card-signal-strip">
        <span>{project.chain}</span>
        <span>{project.ticker}</span>
        <span>{project.communitySize.toLocaleString()} {t('explore.community')}</span>
      </div>
      <div className="card-meta">
        <RiskPill level={project.riskLevel} />
        <span><Clock3 size={15} /> {project.lastUpdate}</span>
      </div>
      <button className="card-button" onClick={() => navigate(`project/${project.id}`)}>
        {t('explore.openTrustProfile')} <ArrowRight size={17} />
      </button>
    </article>
  );
}

function ProjectProfile({ project, navigate, watched, toggleWatch, onEdit, openMethodology, onRequestVerification }) {
  const { t } = useTranslation();
  const confidence = confidenceScore(project);
  const canRequestVerification =
    project.verificationStatus === VERIFICATION_STATUS.UNVERIFIED || project.verificationStatus === VERIFICATION_STATUS.REJECTED;
  const unlockPremium = async () => {
    const result = await handleUnlockPremiumClick(project);
    if (!result?.ok) alert(result?.message || stripeUnavailableMessage());
  };

  return (
    <section className="profile-page">
      <div className="profile-hero">
        <div>
          <button className="back-button" onClick={() => navigate('explore')}>{t('projectProfile.backToExplore')}</button>
          <div className="profile-title-row">
            <h1>{project.name}</h1>
            <span className="ticker-pill">{project.ticker}</span>
            <VerifiedBadge status={project.verificationStatus} size={16} />
          </div>
          <p>{project.description}</p>
          {project.mission && <p className="mission-text">{project.mission}</p>}
          {project.verificationStatus === VERIFICATION_STATUS.PENDING && (
            <p className="inline-note verification-pending-note">{t('projectProfile.pendingNote')}</p>
          )}
          {project.verificationStatus === VERIFICATION_STATUS.REJECTED && (
            <p className="inline-note verification-rejected-note">
              {t('projectProfile.rejectedNote', { note: project.verificationNote ? `: ${project.verificationNote}` : '.' })}
            </p>
          )}
          <div className="profile-actions">
            <button className={watched ? 'primary-button watched' : 'primary-button'} onClick={toggleWatch}>
              <Bell size={18} /> {watched ? t('projectProfile.watchingProject') : t('projectProfile.watchProject')}
            </button>
            <button className="secondary-button" onClick={onEdit}>
              <Plus size={18} /> {t('projectProfile.editProject')}
            </button>
            {canRequestVerification && (
              <button className="primary-button" onClick={onRequestVerification}>
                <BadgeCheck size={18} /> {t('projectProfile.requestVerification')}
              </button>
            )}
            <button className="secondary-button" onClick={() => handleDownloadPdf(project)}>
              <Download size={18} /> {t('projectProfile.downloadPdf')}
            </button>
            <button className="primary-button" onClick={unlockPremium}>
              <Lock size={18} /> {t('projectProfile.unlockPremium')}
            </button>
            <button className="secondary-button" onClick={() => alert(t('projectProfile.reportSuggestAlert'))}>
              <Flag size={18} /> {t('projectProfile.reportSuggest')}
            </button>
            <button className="ghost-button" onClick={openMethodology}>
              <Info size={18} /> {t('projectProfile.methodology')}
            </button>
          </div>
        </div>
        <div className="profile-score-card">
          <ScoreCircle score={project.trustScore} size="large" />
          <RiskPill level={project.riskLevel} />
          <span className="confidence-badge">{confidence.label}</span>
          <strong>{riskBadge(project.trustScore)}</strong>
          <span className="status-badge">{project.status}</span>
        </div>
      </div>

      <div className="profile-layout">
        <div className="main-column">
          <RiskSummary project={project} />
          <InfoGrid project={project} />
          <TrustBreakdown project={project} />
          {project.realData && <RealDataSection project={project} data={project.realData} />}
          <RiskFlags flags={project.riskFlags} />
          <Timeline items={project.timeline} />
          <Roadmap phases={project.roadmap} />
          <ShareReady project={project} />
          <KhanTokenRole navigate={navigate} />
          <FutureFoundationSection />
        </div>
        <aside className="side-column">
          <CommunityProof project={project} />
          <Disclaimer compact />
        </aside>
      </div>
    </section>
  );
}

function RiskSummary({ project }) {
  const { t } = useTranslation();
  const confidence = confidenceScore(project);
  return (
    <section className="detail-section">
      <SectionTitle icon={AlertTriangle} eyebrow={t('riskSummary.eyebrow')} title={t('riskSummary.title')} />
      <div className="result-score-row">
        <div>
          <span>{t('riskSummary.trustScore')}</span>
          <strong>{project.trustScore}/100</strong>
        </div>
        <div>
          <span>{t('riskSummary.confidenceScore')}</span>
          <strong>{confidence.label}</strong>
        </div>
        <RiskPill level={project.riskLevel} />
      </div>
      <div className="risk-summary-grid">
        {riskSignals(project).map((item) => (
          <div className="risk-summary-item" key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <p>{item.detail}</p>
          </div>
        ))}
      </div>
      <p className="plain-explanation">{plainRiskExplanation(project)}</p>
    </section>
  );
}

function ShareReady({ project }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState('');
  const copy = async (channel) => {
    const text = shareText(project, channel);
    trackShareClick(channel, project.name);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(channel);
      window.setTimeout(() => setCopied(''), 1600);
    } catch {
      setCopied('error');
    }
  };

  return (
    <section className="detail-section">
      <SectionTitle icon={MessageCircle} eyebrow={t('shareReady.eyebrow')} title={t('shareReady.title')} />
      <div className="share-grid">
        {[
          ['x', t('scoring.shareChannels.x'), shareText(project, 'x')],
          ['telegram', t('scoring.shareChannels.telegram'), shareText(project, 'telegram')],
        ].map(([channel, label, text]) => (
          <div className="share-card" key={channel}>
            <span>{label}</span>
            <p>{text}</p>
            <button className="secondary-button" type="button" onClick={() => copy(channel)}>
              <Copy size={17} /> {copied === channel ? t('common.copied') : t('shareReady.copyText')}
            </button>
          </div>
        ))}
      </div>
      {copied === 'error' && <p className="inline-note">{t('shareReady.copyUnavailable')}</p>}
    </section>
  );
}

function EcosystemActions({ navigate }) {
  const { t } = useTranslation();
  return (
    <div className="ecosystem-actions">
      <button className="primary-button" type="button" onClick={() => navigate?.('home')}>
        {t('ecosystem.visitKhanTrust')} <ArrowRight size={18} />
      </button>
      <button className="secondary-button" type="button" onClick={() => navigate?.('khan')}>
        {t('ecosystem.exploreEcosystem')} <Star size={18} />
      </button>
      <a className="secondary-button" href={OFFICIAL_KHAN_LINKS.x} target="_blank" rel="noreferrer" onClick={() => trackSocialClick('Official X', OFFICIAL_KHAN_LINKS.x)}>
        {t('ecosystem.followX')} <ExternalLink size={18} />
      </a>
      <a className="secondary-button" href={OFFICIAL_KHAN_LINKS.telegram} target="_blank" rel="noreferrer" onClick={() => trackSocialClick('Telegram Community', OFFICIAL_KHAN_LINKS.telegram)}>
        {t('ecosystem.joinTelegram')} <MessageCircle size={18} />
      </a>
    </div>
  );
}

function KhanEcosystemStrip({ navigate }) {
  const { t } = useTranslation();
  const icons = [Shield, Star, Users];
  return (
    <section className="content-band ecosystem-strip">
      <SectionTitle icon={Globe2} eyebrow={t('ecosystem.stripEyebrow')} title={t('ecosystem.stripTitle')} />
      <div className="ecosystem-grid">
        {t('ecosystem.items').map(([title, text], index) => {
          const Icon = icons[index];
          return (
            <div className="ecosystem-card" key={title}>
              <Icon size={20} />
              <strong>{title}</strong>
              <p>{text}</p>
            </div>
          );
        })}
      </div>
      <EcosystemActions navigate={navigate} />
    </section>
  );
}

function KhanTokenRole({ navigate }) {
  const { t } = useTranslation();
  return (
    <section className="detail-section khan-token-role">
      <SectionTitle icon={Star} eyebrow={t('ecosystem.tokenRoleEyebrow')} title={t('ecosystem.tokenRoleTitle')} />
      <p>{t('ecosystem.tokenRoleText')}</p>
      <EcosystemActions navigate={navigate} />
    </section>
  );
}

function FutureFoundationSection() {
  const { t } = useTranslation();
  return (
    <section className="detail-section foundation-section">
      <SectionTitle icon={BadgeCheck} eyebrow={t('ecosystem.foundationEyebrow')} title={t('ecosystem.foundationTitle')} />
      <div className="foundation-grid">
        <div>
          <span className="status-badge">{t('ecosystem.verificationBadge')}</span>
          <p>{t('ecosystem.verificationText')}</p>
          <div className="foundation-list">
            {t('ecosystem.verificationItems').map((item) => <span key={item}><CheckCircle2 size={15} /> {item}</span>)}
          </div>
        </div>
        <div>
          <span className="status-badge">{t('ecosystem.holderBadge')}</span>
          <p>{t('ecosystem.holderText')}</p>
          <div className="foundation-list">
            {t('ecosystem.holderItems').map((item) => <span key={item}><CheckCircle2 size={15} /> {item}</span>)}
          </div>
        </div>
      </div>
    </section>
  );
}

function KhanEcosystemPage({ navigate }) {
  const { t } = useTranslation();
  return (
    <section className="page-section khan-ecosystem-page">
      <SectionTitle icon={Star} eyebrow={t('ecosystem.pageEyebrow')} title={t('ecosystem.pageTitle')} />
      <p className="section-subtitle">{t('ecosystem.pageSubtitle')}</p>
      <KhanEcosystemStrip navigate={navigate} />
      <KhanTokenRole navigate={navigate} />
      <FutureFoundationSection />
      <Disclaimer />
    </section>
  );
}

function InfoGrid({ project }) {
  const { t } = useTranslation();
  const rows = resolvedMetadataRows(project);
  return (
    <section className="detail-section">
      <SectionTitle icon={Shield} eyebrow={t('profileSections.profileEyebrow')} title={t('profileSections.infoTitle')} />
      <div className="info-grid">
        {rows.map(([label, value, Icon]) => (
          <div className="info-item" key={label}>
            <Icon size={18} />
            <span>{label}</span>
            <strong><InfoValue value={value} network={label} /></strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function InfoValue({ value, network }) {
  if (value && typeof value === 'object' && 'state' in value) {
    if (value.state === 'Present') return <ClickableLink href={value.value} network={network} />;
    return value.state === 'Missing' ? translate('common.missing') : value.state === 'Data unavailable' ? translate('common.dataUnavailable') : value.state;
  }
  return <ClickableLink href={value} fallback={value || translate('common.notProvided')} network={network} />;
}

function ClickableLink({ href, fallback, network }) {
  const resolvedFallback = fallback ?? translate('common.notProvided');
  if (!hasValue(href)) return resolvedFallback;
  const url = normalizeExternalUrl(href);
  if (!url) return href;
  return (
    <a className="metadata-link" href={url} target="_blank" rel="noreferrer" onClick={() => trackSocialClick(network || 'unknown', url)}>
      {href} <ExternalLink size={13} />
    </a>
  );
}

function normalizeExternalUrl(value = '') {
  const text = String(value).trim();
  if (!text) return '';
  if (/^https?:\/\//i.test(text)) return text;
  if (/^[\w.-]+\.[a-z]{2,}/i.test(text)) return `https://${text}`;
  return '';
}

function TrustBreakdown({ project }) {
  const { t } = useTranslation();
  const labels = t('profileSections.breakdownLabels');
  return (
    <section className="detail-section">
      <SectionTitle icon={LineChart} eyebrow={t('profileSections.scoreEyebrow')} title={t('profileSections.breakdownTitle')} />
      <div className="breakdown-list">
        {Object.entries(project.scoreBreakdown).map(([key, value]) => (
          <div className="score-row" key={key}>
            <span>{labels[key]}</span>
            <div className="score-bar"><i style={{ width: `${value || 0}%` }} /></div>
            <strong>{value === null ? t('common.notAvailable') : value}</strong>
          </div>
        ))}
      </div>
      {project.scoreBreakdown.socialScore === null && (
        <p className="inline-note">{t('profileSections.noSocialsFound')}</p>
      )}
    </section>
  );
}

function RiskFlags({ flags }) {
  const { t } = useTranslation();
  return (
    <section className="detail-section">
      <SectionTitle icon={FileWarning} eyebrow={t('profileSections.riskEyebrow')} title={t('profileSections.riskFlagsTitle')} />
      <div className="flag-grid">
        {flags.map((flag) => (
          <span key={flag} className="warning-badge"><AlertTriangle size={15} /> {flag}</span>
        ))}
      </div>
    </section>
  );
}

function Timeline({ items }) {
  const { t } = useTranslation();
  return (
    <section className="detail-section">
      <SectionTitle icon={History} eyebrow={t('profileSections.updatesEyebrow')} title={t('profileSections.timelineTitle')} />
      <div className="timeline">
        {items.map((item, index) => (
          <div className="timeline-item" key={`${item.label}-${index}`}>
            <CircleDot size={18} />
            <div>
              <strong>{item.label}</strong>
              <span>{item.date}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function CommunityProof({ project }) {
  const { t } = useTranslation();
  const s = t('profileSections.communityProofStats');
  const stats = [
    [s.holderCount, project.holders.toLocaleString(), WalletCards],
    [s.topHolder, project.realData ? formatPercent(project.realData.topHolderPercent) : t('common.notConnected'), Shield],
    [s.liquidity, project.realData ? formatCurrency(project.realData.totalLiquidityUsd ?? project.realData.liquidityUsd) : t('common.notConnected'), BarChart3],
    [s.marketCap, project.realData ? formatCurrency(project.realData.marketCapUsd) : t('common.notConnected'), LineChart],
    [s.tokenAge, project.realData ? formatAge(project.realData.tokenAgeDays) : t('common.notConnected'), CalendarDays],
    [s.trustScore, `${project.trustScore}/100`, BadgeCheck],
    [s.lastUpdateDate, project.lastUpdate, Clock3],
  ];
  return (
    <section className="detail-section sticky-panel">
      <SectionTitle icon={Users} eyebrow={t('profileSections.proofEyebrow')} title={t('profileSections.communityProofTitle')} />
      <div className="proof-list">
        {stats.map(([label, value, Icon]) => (
          <div className="proof-item" key={label}>
            <Icon size={18} />
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function RealDataSection({ project, data }) {
  const { t } = useTranslation();
  const r = t('profileSections.realDataRows');
  const rows = [
    [r.holderCount, `${formatNumber(data.holderCount)} (${data.holderSource})`, Users],
    [r.largestHolder, formatPercent(data.topHolderPercent), WalletCards],
    [r.topTenHolders, formatPercent(data.topTenHolderPercent), Shield],
    [r.holderRiskLevel, holderRiskLevel(data), AlertTriangle],
    [r.concentrationStatus, holderConcentrationStatus(data), FileWarning],
    [r.liquidityUsd, formatCurrency(data.totalLiquidityUsd ?? data.liquidityUsd), BarChart3],
    [r.marketCapUsd, formatCurrency(data.marketCapUsd), LineChart],
    [r.tokenAge, formatAge(data.tokenAgeDays), CalendarDays],
    [r.trustScore, `${project.trustScore}/100`, BadgeCheck],
    [r.website, socialPresenceState('website', project, data), Globe2],
    [r.twitter, socialPresenceState('twitter', project, data), ExternalLink],
    [r.telegram, socialPresenceState('telegram', project, data), MessageCircle],
    [r.supply, data.supply ? formatNumber(data.supply) : t('common.notAvailable'), WalletCards],
    [r.holderGrowth, data.holderGrowthPercent === null ? t('profileSections.holderGrowthNeedsLookup') : formatPercent(data.holderGrowthPercent), TrendingUp],
    [r.poolsFound, formatNumber(data.poolCount), Layers3],
    [r.dataSource, data.source, BadgeCheck],
  ];

  return (
    <section className="detail-section">
      <SectionTitle icon={Activity} eyebrow={t('profileSections.liveDataEyebrow')} title={t('profileSections.liveDataTitle')} />
      <div className="real-data-grid">
        {rows.map(([label, value, Icon]) => (
          <div className="real-data-item" key={label}>
            <Icon size={18} />
            <span>{label}</span>
            <strong><InfoValue value={value} network={label} /></strong>
          </div>
        ))}
      </div>
      {data.pairUrl && (
        <a className="data-link" href={data.pairUrl} target="_blank" rel="noreferrer">
          {t('profileSections.viewMarketPair')} <ExternalLink size={16} />
        </a>
      )}
    </section>
  );
}

function RealDataPreview({ data }) {
  const { t } = useTranslation();
  return (
    <div className="real-data-preview wide">
      <strong>{t('liveDataPreview.title')}</strong>
      <span>{t('liveDataPreview.liquidity', { value: formatCurrency(data.liquidityUsd) })}</span>
      <span>{t('liveDataPreview.marketCap', { value: formatCurrency(data.marketCapUsd) })}</span>
      <span>{t('liveDataPreview.tokenAge', { value: formatAge(data.tokenAgeDays) })}</span>
      <span>{t('liveDataPreview.holderSignal', { count: formatNumber(data.holderCount), source: data.holderSource })}</span>
    </div>
  );
}

const ROADMAP_STATUS_KEY = { Completed: 'common.completed', 'In progress': 'common.inProgress', Planned: 'common.planned' };

function Roadmap({ phases }) {
  const { t } = useTranslation();
  return (
    <section className="detail-section">
      <SectionTitle icon={Target} eyebrow={t('profileSections.roadmapEyebrow')} title={t('profileSections.roadmapTitle')} />
      <div className="roadmap-list">
        {phases.map((phase) => (
          <div className="roadmap-item" key={phase.phase}>
            <span className={`roadmap-status ${phase.status.toLowerCase().replaceAll(' ', '-')}`}>
              {t(ROADMAP_STATUS_KEY[phase.status] || 'common.planned')}
            </span>
            <strong>{phase.phase}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

const launchpadInitialForm = {
  name: '',
  symbol: '',
  description: '',
  totalSupply: '',
  decimals: '9',
  logoUrl: '',
  website: '',
  twitter: '',
  telegram: '',
  founderStatus: '',
  roadmapText: '',
  communitySize: '',
  riskNotes: '',
};

function LaunchpadPage({ onCreateProfile, navigate }) {
  const { t } = useTranslation();
  const [form, setForm] = useState(launchpadInitialForm);
  const [network, setNetwork] = useState('devnet');
  const [mainnetConfirmations, setMainnetConfirmations] = useState({
    realToken: false,
    launchpadPayment: false,
    realFees: false,
    verifiedMetadata: false,
    noGuarantee: false,
    seedPhrase: false,
  });
  const { address: walletAddress, connecting: walletConnecting, adapter: walletAdapter, selectAndConnect, connectError: walletConnectError } = useKhanWallet();
  const [walletMessage, setWalletMessage] = useState('');
  const [status, setStatus] = useState({ state: 'idle', message: '' });
  const [created, setCreated] = useState(null);
  const [launchpadPaymentHash, setLaunchpadPaymentHash] = useState('');
  const [launchpadPaymentStatus, setLaunchpadPaymentStatus] = useState('idle');
  const [launchpadPaymentMessage, setLaunchpadPaymentMessage] = useState('');
  const [launchpadPaymentCopied, setLaunchpadPaymentCopied] = useState(false);
  const decimals = Number(form.decimals || 0);
  const isMainnet = network === 'mainnet-beta';
  const selectedNetwork = launchpadNetworkConfig(network);
  const mainnetReady = Object.values(mainnetConfirmations).every(Boolean);
  const launchpadPaymentVerified = launchpadPaymentStatus === 'verified';
  const mainnetUnlocked = !isMainnet || launchpadPaymentVerified;
  const walletConfigured = Boolean(CRYPTO_PAYMENT_WALLET);
  const verificationConfigured = isSolanaVerificationConfigured();
  const socialWarnings = [
    !hasValue(form.website) ? t('launchpad.form.websiteWarning') : '',
    !hasValue(form.twitter) ? t('launchpad.form.twitterWarning') : '',
    !hasValue(form.telegram) ? t('launchpad.form.telegramWarning') : '',
  ].filter(Boolean);
  const validationErrors = validateLaunchpadForm(form);
  const previewProject = useMemo(() => normalizeProject({
    ...launchpadProfileFromForm(form, walletAddress || 'Preview wallet', {
      mintAddress: `${selectedNetwork.label} mint pending`,
      signature: '',
      network,
    }, network),
    id: 'launchpad-preview',
    status: 'Launchpad preview',
  }), [form, walletAddress, network, selectedNetwork.label]);

  const update = (key, value) => {
    setForm((current) => ({ ...current, [key]: key === 'symbol' ? value.toUpperCase().slice(0, 10) : value }));
    setCreated(null);
  };

  const updateNetwork = (value) => {
    setNetwork(value);
    setCreated(null);
    setStatus({ state: 'idle', message: '' });
    if (value !== 'mainnet-beta') {
      setLaunchpadPaymentStatus('idle');
      setLaunchpadPaymentMessage('');
    }
  };

  const updateConfirmation = (key, checked) => {
    setMainnetConfirmations((current) => ({ ...current, [key]: checked }));
  };

  const connectWallet = () => {
    setWalletMessage('');
    selectAndConnect(walletAdapter?.name || PhantomWalletName);
  };

  useEffect(() => {
    if (walletAddress) setWalletMessage(t('launchpad.wallet.connectedToast', { network: selectedNetwork.label }));
  }, [walletAddress]);

  useEffect(() => {
    if (walletConnectError) setWalletMessage(launchpadErrorMessage(walletConnectError));
  }, [walletConnectError]);

  const copyLaunchpadPaymentWallet = async () => {
    if (!walletConfigured) return;
    try {
      await navigator.clipboard.writeText(CRYPTO_PAYMENT_WALLET);
      setLaunchpadPaymentCopied(true);
      window.setTimeout(() => setLaunchpadPaymentCopied(false), 1600);
    } catch {
      setLaunchpadPaymentCopied(false);
    }
  };

  const verifyLaunchpadPayment = async () => {
    if (!verificationConfigured) {
      setLaunchpadPaymentStatus('not_configured');
      setLaunchpadPaymentMessage(solanaUnavailableMessage());
      return;
    }
    if (!launchpadPaymentHash.trim()) {
      setLaunchpadPaymentStatus('idle');
      setLaunchpadPaymentMessage(t('launchpad.unlock.hashEmpty'));
      return;
    }

    trackCryptoVerifyStarted(LAUNCHPAD_PAYMENT_MODEL.mainnetPlan);
    setLaunchpadPaymentStatus('verifying');
    setLaunchpadPaymentMessage('');

    const result = await verifySolanaPayment({
      transactionHash: launchpadPaymentHash,
      plan: LAUNCHPAD_PAYMENT_MODEL.mainnetPlan,
    });
    setLaunchpadPaymentStatus(result.status);
    setLaunchpadPaymentMessage(result.message || t(verifyStatusMessageKey(result.status)));

    if (result.status === 'verified') {
      trackCryptoVerifySuccess(LAUNCHPAD_PAYMENT_MODEL.mainnetPlan);
    } else {
      trackCryptoVerifyFailed(LAUNCHPAD_PAYMENT_MODEL.mainnetPlan, result.status);
    }
  };

  const createToken = async (event) => {
    event.preventDefault();
    if (validationErrors.length) {
      setStatus({ state: 'error', message: validationErrors[0] });
      return;
    }
    if (!walletAddress) {
      setStatus({ state: 'error', message: t('launchpad.form.submitConnectWallet', { network: selectedNetwork.label.toLowerCase() }) });
      return;
    }
    if (isMainnet && !mainnetReady) {
      setStatus({ state: 'error', message: t('launchpad.form.submitMainnetConfirmations') });
      return;
    }
    if (isMainnet && !launchpadPaymentVerified) {
      setStatus({ state: 'error', message: t('launchpad.form.submitVerifyPayment', { price: LAUNCHPAD_PAYMENT_MODEL.mainnetPriceLabel }) });
      return;
    }

    setStatus({ state: 'loading', message: t('launchpad.form.submitWaitingApproval', { network: selectedNetwork.label }) });
    try {
      const result = await createLaunchpadSplToken({
        walletAddress,
        decimals,
        totalSupply: form.totalSupply,
        network,
        signTransaction: (transaction) => walletAdapter.signTransaction(transaction),
      });
      const profile = onCreateProfile(launchpadProfileFromForm(form, walletAddress, result, network));
      setCreated({ ...result, projectId: profile.id });
      setStatus({ state: 'success', message: t('launchpad.form.submitSuccess', { network: selectedNetwork.label }) });
    } catch (error) {
      setStatus({ state: 'error', message: launchpadErrorMessage(error) });
    }
  };

  const copyValue = async (value, label) => {
    await navigator.clipboard.writeText(value);
    setStatus({ state: 'success', message: t('launchpad.form.copiedSuffix', { label }) });
  };

  return (
    <section className="page-section launchpad-page">
      <SectionTitle icon={Sparkles} eyebrow={isMainnet ? t('launchpad.eyebrowMainnet') : t('launchpad.eyebrowDevnet')} title={t('launchpad.title')} />
      <p className="section-subtitle">{t('launchpad.subtitle')}</p>

      <div className="launchpad-warning-grid">
        <WarningBox text={isMainnet ? t('launchpad.warnings.networkMainnet', { price: LAUNCHPAD_PAYMENT_MODEL.mainnetPriceLabel }) : t('launchpad.warnings.networkDevnet')} tone={isMainnet ? 'danger' : 'warning'} />
        <WarningBox text={t('launchpad.warnings.noGuarantee')} />
        <WarningBox text={t('launchpad.warnings.seedPhrase')} />
        <WarningBox text={t('launchpad.warnings.irreversible')} />
        <WarningBox text={t('launchpad.warnings.noLiquidity')} />
        <WarningBox text={t('launchpad.warnings.noTrading')} />
        <WarningBox text={t('launchpad.warnings.noAdvice')} />
        <WarningBox text={t('launchpad.warnings.metadataComingSoon')} />
      </div>

      <div className="launchpad-network-panel">
        <div>
          <strong>{t('launchpad.network.label')}</strong>
          <p>{isMainnet ? t('launchpad.network.mainnetDescription', { price: LAUNCHPAD_PAYMENT_MODEL.mainnetPriceLabel }) : t('launchpad.network.devnetDescription')}</p>
        </div>
        <div className="network-selector" role="group" aria-label={t('launchpad.network.ariaLabel')}>
          <button className={network === 'devnet' ? 'active' : ''} type="button" onClick={() => updateNetwork('devnet')}>{t('launchpad.network.devnet')}</button>
          <button className={isMainnet ? 'active mainnet' : 'mainnet'} type="button" onClick={() => updateNetwork('mainnet-beta')}>{t('launchpad.network.mainnet')}</button>
        </div>
        <div className="launchpad-network-row">
          <span className={`network-badge ${isMainnet ? 'danger' : 'active'}`}>{selectedNetwork.label}</span>
          <span className="network-badge">{t('launchpad.network.launchpadPayment', { price: isMainnet ? LAUNCHPAD_PAYMENT_MODEL.mainnetPriceLabel : LAUNCHPAD_PAYMENT_MODEL.devnetPrice })}</span>
          <span className="network-badge disabled">{t('launchpad.network.phantomRequired')}</span>
        </div>
      </div>

      <section className="launchpad-payment-panel">
        <SectionTitle icon={WalletCards} eyebrow={t('launchpad.payment.eyebrow')} title={t('launchpad.payment.title')} />
        <div className="launchpad-payment-grid">
          <div>
            <span>{t('launchpad.payment.devnetLabel')}</span>
            <strong>{LAUNCHPAD_PAYMENT_MODEL.devnetPrice}</strong>
            <p>{t('launchpad.payment.devnetText')}</p>
          </div>
          <div>
            <span>{t('launchpad.payment.mainnetLabel')}</span>
            <strong>{LAUNCHPAD_PAYMENT_MODEL.mainnetPriceLabel}</strong>
            <p>{t('launchpad.payment.mainnetText')}</p>
          </div>
        </div>
        <p className="inline-note">{t('launchpad.payment.note', { note: LAUNCHPAD_PAYMENT_MODEL.note })}</p>
      </section>

      {isMainnet && (
        <section className="launchpad-payment-panel">
          <SectionTitle icon={Lock} eyebrow={t('launchpad.unlock.eyebrow')} title={t('launchpad.unlock.title')} />
          <p className="launchpad-message">
            {t('launchpad.unlock.message', { price: LAUNCHPAD_PAYMENT_MODEL.mainnetPriceLabel })}
          </p>
          {walletConfigured ? (
            <div className="wallet-copy-box">
              <span>{t('launchpad.unlock.walletLabel')}</span>
              <strong>{CRYPTO_PAYMENT_WALLET}</strong>
              <button className="secondary-button" type="button" onClick={copyLaunchpadPaymentWallet}>
                <Copy size={17} /> {launchpadPaymentCopied ? t('common.copied') : t('pricing.payment.copyWallet')}
              </button>
            </div>
          ) : (
            <p className="inline-note">{t('launchpad.unlock.notConfigured')}</p>
          )}
          {!verificationConfigured && <p className="inline-note">{solanaUnavailableMessage()}</p>}
          <label className="form-field transaction-field">
            <span>{t('launchpad.unlock.hashLabel')}</span>
            <input
              value={launchpadPaymentHash}
              onChange={(event) => {
                setLaunchpadPaymentHash(event.target.value);
                setLaunchpadPaymentStatus('idle');
                setLaunchpadPaymentMessage('');
              }}
              placeholder={t('launchpad.unlock.hashPlaceholder', { price: LAUNCHPAD_PAYMENT_MODEL.mainnetPriceLabel })}
              disabled={!walletConfigured || launchpadPaymentStatus === 'verifying'}
            />
          </label>
          <div className="payment-action-row">
            <button
              className="primary-button"
              type="button"
              onClick={verifyLaunchpadPayment}
              disabled={!walletConfigured || launchpadPaymentStatus === 'verifying'}
            >
              {launchpadPaymentStatus === 'verifying' ? t('launchpad.unlock.verifying') : t('launchpad.unlock.verifyButton')}
            </button>
            <span className={launchpadPaymentVerified ? 'network-badge active' : 'network-badge danger'}>
              {launchpadPaymentVerified ? t('launchpad.unlock.unlocked') : t('launchpad.unlock.locked')}
            </span>
          </div>
          {(launchpadPaymentMessage || launchpadPaymentStatus !== 'idle') && (
            <p className={launchpadPaymentVerified ? 'inline-note verify-success' : 'inline-note'}>
              {launchpadPaymentMessage || t(verifyStatusMessageKey(launchpadPaymentStatus))}
            </p>
          )}
        </section>
      )}

      <div className="launchpad-wallet-card">
        <div>
          <strong>{t('launchpad.wallet.title')}</strong>
          <p>{walletAddress ? t('launchpad.wallet.connected', { address: walletAddress }) : t('launchpad.wallet.connectPrompt', { network: selectedNetwork.label.toLowerCase() })}</p>
          <p>{t('launchpad.wallet.detectedMode', { network: selectedNetwork.label })}</p>
          {walletMessage && <p className="launchpad-message">{walletMessage}</p>}
        </div>
        <button className="primary-button" type="button" onClick={connectWallet} disabled={Boolean(walletAddress) || walletConnecting}>
          <WalletCards size={18} /> {walletAddress ? formatWalletAddress(walletAddress) : walletConnecting ? t('walletConnect.connecting') : t('launchpad.wallet.connect')}
        </button>
      </div>

      <div className="launchpad-layout">
        <form className="launchpad-form add-form" onSubmit={createToken}>
          <FormField label={t('launchpad.form.name')} value={form.name} onChange={(value) => update('name', value)} required />
          <FormField label={t('launchpad.form.symbol')} value={form.symbol} onChange={(value) => update('symbol', value)} required placeholder={t('launchpad.form.symbolPlaceholder')} />
          <FormField type="number" label={t('launchpad.form.totalSupply')} value={form.totalSupply} onChange={(value) => update('totalSupply', value)} required />
          <FormField type="number" label={t('launchpad.form.decimals')} value={form.decimals} onChange={(value) => update('decimals', value)} required />
          <FormField label={t('launchpad.form.logoUrl')} value={form.logoUrl} onChange={(value) => update('logoUrl', value)} />
          <FormField label={t('launchpad.form.website')} value={form.website} onChange={(value) => update('website', value)} />
          <FormField label={t('launchpad.form.twitter')} value={form.twitter} onChange={(value) => update('twitter', value)} />
          <FormField label={t('launchpad.form.telegram')} value={form.telegram} onChange={(value) => update('telegram', value)} />
          <FormField label={t('launchpad.form.founderStatus')} value={form.founderStatus} onChange={(value) => update('founderStatus', value)} placeholder={t('launchpad.form.founderStatusPlaceholder')} />
          <FormField type="number" label={t('launchpad.form.communitySize')} value={form.communitySize} onChange={(value) => update('communitySize', value)} />
          <label className="form-field wide">
            <span>{t('launchpad.form.description')}</span>
            <textarea value={form.description} onChange={(event) => update('description', event.target.value)} />
          </label>
          <label className="form-field wide">
            <span>{t('launchpad.form.roadmap')}</span>
            <textarea value={form.roadmapText} onChange={(event) => update('roadmapText', event.target.value)} placeholder={t('launchpad.form.roadmapPlaceholder')} />
          </label>
          <label className="form-field wide">
            <span>{t('launchpad.form.riskNotes')}</span>
            <textarea value={form.riskNotes} onChange={(event) => update('riskNotes', event.target.value)} />
          </label>

          {socialWarnings.length > 0 && (
            <div className="launchpad-inline-warning wide">
              <AlertTriangle size={18} />
              <span>{socialWarnings.join(' ')}</span>
            </div>
          )}
          <div className="launchpad-inline-warning wide">
            <AlertTriangle size={18} />
            <span>{isMainnet ? t('launchpad.form.mainnetCostWarning', { price: LAUNCHPAD_PAYMENT_MODEL.mainnetPriceLabel }) : t('launchpad.form.devnetFreeWarning')}</span>
          </div>

          {isMainnet && (
            <div className="mainnet-confirmations wide">
              <strong>{t('launchpad.form.confirmationsTitle')}</strong>
              <ConfirmationBox checked={mainnetConfirmations.realToken} onChange={(checked) => updateConfirmation('realToken', checked)} text={t('launchpad.form.confirmRealToken')} />
              <ConfirmationBox checked={mainnetConfirmations.launchpadPayment} onChange={(checked) => updateConfirmation('launchpadPayment', checked)} text={t('launchpad.form.confirmLaunchpadPayment', { price: LAUNCHPAD_PAYMENT_MODEL.mainnetPriceLabel })} />
              <ConfirmationBox checked={mainnetConfirmations.realFees} onChange={(checked) => updateConfirmation('realFees', checked)} text={t('launchpad.form.confirmRealFees')} />
              <ConfirmationBox checked={mainnetConfirmations.verifiedMetadata} onChange={(checked) => updateConfirmation('verifiedMetadata', checked)} text={t('launchpad.form.confirmVerifiedMetadata')} />
              <ConfirmationBox checked={mainnetConfirmations.noGuarantee} onChange={(checked) => updateConfirmation('noGuarantee', checked)} text={t('launchpad.form.confirmNoGuarantee')} />
              <ConfirmationBox checked={mainnetConfirmations.seedPhrase} onChange={(checked) => updateConfirmation('seedPhrase', checked)} text={t('launchpad.form.confirmSeedPhrase')} />
            </div>
          )}

          {status.message && (
            <p className={`launchpad-status wide ${status.state}`}>{status.message}</p>
          )}

          <button className="primary-button wide-button" type="submit" disabled={!walletAddress || status.state === 'loading' || (isMainnet && (!mainnetReady || !mainnetUnlocked))}>
            {status.state === 'loading' ? t('launchpad.form.submitWaiting') : isMainnet ? t('launchpad.form.submitMainnet') : t('launchpad.form.submitDevnet')}
          </button>
        </form>

        <LaunchpadPreview project={previewProject} form={form} network={network} />
      </div>

      {created && (
        <section className="launchpad-success-card">
          <SectionTitle icon={BadgeCheck} eyebrow={t('launchpad.success.eyebrowCreated')} title={t('launchpad.success.titleTokenCreated', { network: launchpadNetworkConfig(created.network).label })} />
          <div className="success-grid">
            <InfoItem label={t('launchpad.success.mintAddress')} value={created.mintAddress} />
            <InfoItem label={t('launchpad.success.transactionSignature')} value={created.signature} />
          </div>
          <div className="hero-actions">
            <button className="primary-button" type="button" onClick={() => navigate(`project/${created.projectId}`)}>
              {t('launchpad.success.openTrustProfile')} <ArrowRight size={18} />
            </button>
            <button className="secondary-button" type="button" onClick={() => copyValue(created.mintAddress, t('launchpad.success.mintAddress'))}>
              <Copy size={18} /> {t('launchpad.success.copyMintAddress')}
            </button>
            <button className="secondary-button" type="button" onClick={() => copyValue(created.signature, t('launchpad.success.transactionSignature'))}>
              <Copy size={18} /> {t('launchpad.success.copyTransactionSignature')}
            </button>
            <a className="secondary-button" href={solanaExplorerUrl('address', created.mintAddress, created.network)} target="_blank" rel="noreferrer">
              <ExternalLink size={18} /> {t('launchpad.success.openMintExplorer')}
            </a>
            <a className="secondary-button" href={solanaExplorerUrl('tx', created.signature, created.network)} target="_blank" rel="noreferrer">
              <ExternalLink size={18} /> {t('launchpad.success.openTxExplorer')}
            </a>
          </div>
        </section>
      )}
    </section>
  );
}

function validateLaunchpadForm(form) {
  const errors = [];
  if (!form.name.trim()) errors.push(translate('launchpad.form.errorNameRequired'));
  if (!form.symbol.trim()) errors.push(translate('launchpad.form.errorSymbolRequired'));
  if (form.symbol.trim().length > 10) errors.push(translate('launchpad.form.errorSymbolLength'));
  if (Number(form.totalSupply) <= 0) errors.push(translate('launchpad.form.errorSupplyPositive'));
  const decimals = Number(form.decimals);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 9) errors.push(translate('launchpad.form.errorDecimalsRange'));
  return errors;
}

function launchpadErrorMessage(error = {}) {
  if (error.name === 'WalletNotReadyError') return translate('launchpad.errors.notInstalled');
  const message = error.message || String(error);
  const lower = message.toLowerCase();
  if (lower.includes('not installed') || lower.includes('not ready')) return translate('launchpad.errors.notInstalled');
  if (lower.includes('reject') || lower.includes('denied') || lower.includes('cancel')) return translate('launchpad.errors.rejected');
  if (lower.includes('insufficient') || lower.includes('0x1')) return translate('launchpad.errors.insufficientFunds');
  if (lower.includes('blockhash') || lower.includes('network') || lower.includes('fetch') || lower.includes('rpc')) return translate('launchpad.errors.rpcFailed');
  return message && !/^\w*Error$/.test(message) ? message : translate('launchpad.errors.generic');
}

function WarningBox({ text, tone = 'warning' }) {
  return (
    <div className={`launchpad-warning-box ${tone}`}>
      <AlertTriangle size={18} />
      <span>{text}</span>
    </div>
  );
}

function ConfirmationBox({ checked, onChange, text }) {
  return (
    <label className="confirmation-box">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{text}</span>
    </label>
  );
}

function InfoItem({ label, value }) {
  return (
    <div className="info-item">
      <BadgeCheck size={18} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function LaunchpadPreview({ project, form, network }) {
  const { t } = useTranslation();
  const config = launchpadNetworkConfig(network);
  const roadmapLines = form.roadmapText.split('\n').map((line) => line.trim()).filter(Boolean);
  return (
    <aside className="launchpad-preview">
      <SectionTitle icon={Eye} eyebrow={t('launchpad.preview.eyebrow')} title={t('launchpad.preview.title')} />
      <div className="preview-token-top">
        {form.logoUrl ? <img src={form.logoUrl} alt={t('launchpad.preview.logoAlt', { name: form.name || t('launchpad.preview.defaultName') })} /> : <div className="preview-logo-placeholder">{t('launchpad.preview.logoPlaceholder')}</div>}
        <div>
          <h3>{form.name || t('launchpad.preview.defaultName')}</h3>
          <span>{form.symbol || t('launchpad.preview.defaultSymbol')}</span>
        </div>
      </div>
      <div className="preview-score-row">
        <ScoreCircle score={project.trustScore} />
        <div>
          <strong>{t('launchpad.preview.estimatedScore')}</strong>
          <p>{t('launchpad.preview.beforeMint', { score: project.trustScore, network: config.label.toLowerCase() })}</p>
        </div>
      </div>
      <div className="preview-list">
        <PreviewRow label={t('launchpad.preview.supply')} value={form.totalSupply || t('common.notSet')} />
        <PreviewRow label={t('launchpad.preview.decimals')} value={form.decimals || '9'} />
        <PreviewRow label={t('launchpad.form.website')} value={displayValue(form.website)} />
        <PreviewRow label={t('launchpad.form.twitter')} value={displayValue(form.twitter)} />
        <PreviewRow label={t('launchpad.form.telegram')} value={displayValue(form.telegram)} />
        <PreviewRow label={t('launchpad.preview.founderStatus')} value={displayValue(form.founderStatus)} />
        <PreviewRow label={t('launchpad.preview.roadmap')} value={roadmapLines.length ? roadmapLines.join(', ') : t('common.notAvailable')} />
      </div>
    </aside>
  );
}

function PreviewRow({ label, value }) {
  return (
    <div className="preview-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AddProjectPage({ onAdd, navigate }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    name: '',
    ticker: '',
    chain: 'Solana',
    contract: '',
    website: '',
    twitter: '',
    telegram: '',
    github: '',
    launchDate: '',
    description: '',
    founderStatus: '',
    communitySize: '',
    holderCount: '',
    roadmapText: '',
    riskNotes: '',
    realData: null,
  });
  const [lookupState, setLookupState] = useState({ status: 'idle', message: '' });

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const lookupToken = async () => {
    setLookupState({ status: 'loading', message: t('addProject.lookup.checking') });
    try {
      const data = await lookupSolanaToken(form.contract);
      setForm((current) => ({
        ...current,
        ...data,
        name: data.name || current.name,
        ticker: data.ticker || current.ticker,
        description: current.description || data.description,
      }));
      setLookupState({ status: 'success', message: t('addProject.lookup.success') });
    } catch (error) {
      setLookupState({ status: 'error', message: error.message || t('addProject.lookup.failed') });
    }
  };
  const submit = (event) => {
    event.preventDefault();
    if (!form.realData) {
      setLookupState({ status: 'error', message: t('addProject.submitErrorNoData') });
      return;
    }
    onAdd(form);
  };

  return (
    <section className="page-section">
      <SectionTitle icon={Plus} eyebrow={t('addProject.eyebrow')} title={t('addProject.title')} />
      <p className="section-subtitle">{t('addProject.subtitle')}</p>
      <div className="profile-only-notice" role="note">
        <Info size={18} />
        <p>{t('addProject.notice')}</p>
      </div>
      <form className="add-form" onSubmit={submit}>
        <FormField label={t('addProject.fields.name')} value={form.name} onChange={(value) => update('name', value)} required />
        <FormField label={t('addProject.fields.ticker')} value={form.ticker} onChange={(value) => update('ticker', value)} required />
        <label className="form-field">
          <span>{t('addProject.fields.chain')}</span>
          <select value={form.chain} onChange={(event) => update('chain', event.target.value)}>
            <option>Solana</option>
            <option>Ethereum</option>
            <option>BSC</option>
            <option>Base</option>
            <option>Other</option>
          </select>
        </label>
        <FormField label={t('addProject.fields.contract')} value={form.contract} onChange={(value) => update('contract', value)} />
        <div className="lookup-panel">
          <button className="secondary-button" type="button" onClick={lookupToken} disabled={lookupState.status === 'loading'}>
            <Search size={18} /> {lookupState.status === 'loading' ? t('addProject.lookup.looking') : t('addProject.lookup.button')}
          </button>
          <p className={lookupState.status === 'error' ? 'lookup-message error' : 'lookup-message'}>
            {lookupState.message || t('addProject.lookup.hint')}
          </p>
        </div>
        <FormField label={t('addProject.fields.website')} value={form.website} onChange={(value) => update('website', value)} />
        <FormField label={t('addProject.fields.twitter')} value={form.twitter} onChange={(value) => update('twitter', value)} />
        <FormField label={t('addProject.fields.telegram')} value={form.telegram} onChange={(value) => update('telegram', value)} />
        <FormField label={t('addProject.fields.github')} value={form.github} onChange={(value) => update('github', value)} />
        <FormField type="date" label={t('addProject.fields.launchDate')} value={form.launchDate} onChange={(value) => update('launchDate', value)} />
        <FormField label={t('addProject.fields.founderStatus')} value={form.founderStatus} onChange={(value) => update('founderStatus', value)} placeholder={t('addProject.fields.founderStatusPlaceholder')} />
        <FormField type="number" label={t('addProject.fields.communitySize')} value={form.communitySize} onChange={(value) => update('communitySize', value)} />
        <FormField type="number" label={t('addProject.fields.holderCount')} value={form.holderCount} onChange={(value) => update('holderCount', value)} />
        {form.realData && <RealDataPreview data={form.realData} />}
        <label className="form-field wide">
          <span>{t('addProject.fields.description')}</span>
          <textarea value={form.description} onChange={(event) => update('description', event.target.value)} required />
        </label>
        <label className="form-field wide">
          <span>{t('addProject.fields.roadmapText')}</span>
          <textarea value={form.roadmapText} onChange={(event) => update('roadmapText', event.target.value)} placeholder={t('addProject.fields.roadmapPlaceholder')} />
        </label>
        <label className="form-field wide">
          <span>{t('addProject.fields.riskNotes')}</span>
          <textarea value={form.riskNotes} onChange={(event) => update('riskNotes', event.target.value)} />
        </label>
        <button className="primary-button wide-button" type="submit">
          {t('addProject.submit')} <ArrowRight size={18} />
        </button>
      </form>
      <section className="launchpad-card" aria-label="KHAN Launchpad devnet MVP">
        <div>
          <span className="launchpad-kicker">{t('addProject.devnetTool')}</span>
          <h3>{t('addProject.devnetTitle')}</h3>
          <p>{t('addProject.devnetText')}</p>
        </div>
        <button className="secondary-button launchpad-button" type="button" onClick={() => navigate('launchpad')}>
          {t('addProject.openLaunchpad')}
        </button>
      </section>
    </section>
  );
}

function FormField({ label, value, onChange, type = 'text', required = false, placeholder = '' }) {
  return (
    <label className="form-field">
      <span>{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} required={required} placeholder={placeholder} />
    </label>
  );
}

function EditProjectModal({ project, onSave, onClose }) {
  const [form, setForm] = useState({
    website: hasValue(project.website) ? project.website : '',
    twitter: hasValue(project.twitter) ? project.twitter : '',
    telegram: hasValue(project.telegram) ? project.telegram : '',
    github: hasValue(project.github) ? project.github : '',
    description: project.description || '',
    roadmapText: project.roadmapText || roadmapToText(project.roadmap),
    riskNotes: project.riskNotes || '',
    founderStatus: project.founderStatus || '',
    communitySize: project.communitySize || '',
  });
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event) => {
    event.preventDefault();
    onSave(project.id, {
      ...form,
      communitySize: Number(form.communitySize || 0),
      roadmap: roadmapFromText(form.roadmapText),
    });
  };

  const { t } = useTranslation();
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Edit Project">
      <form className="modal-panel edit-modal" onSubmit={submit}>
        <button className="close-button" type="button" onClick={onClose} aria-label="Close edit project"><X size={20} /></button>
        <SectionTitle icon={Plus} eyebrow={t('editModal.eyebrow')} title={t('editModal.title', { name: project.name })} />
        <div className="add-form">
          <FormField label={t('verificationModal.fields.website')} value={form.website} onChange={(value) => update('website', value)} />
          <FormField label={t('addProject.fields.twitter')} value={form.twitter} onChange={(value) => update('twitter', value)} />
          <FormField label={t('addProject.fields.telegram')} value={form.telegram} onChange={(value) => update('telegram', value)} />
          <FormField label={t('addProject.fields.github')} value={form.github} onChange={(value) => update('github', value)} />
          <FormField label={t('addProject.fields.founderStatus')} value={form.founderStatus} onChange={(value) => update('founderStatus', value)} placeholder={t('addProject.fields.founderStatusPlaceholder')} />
          <FormField type="number" label={t('addProject.fields.communitySize')} value={form.communitySize} onChange={(value) => update('communitySize', value)} />
          <label className="form-field wide">
            <span>{t('addProject.fields.description')}</span>
            <textarea value={form.description} onChange={(event) => update('description', event.target.value)} />
          </label>
          <label className="form-field wide">
            <span>{t('launchpad.form.roadmap')}</span>
            <textarea value={form.roadmapText} onChange={(event) => update('roadmapText', event.target.value)} placeholder={t('addProject.fields.roadmapPlaceholder')} />
          </label>
          <label className="form-field wide">
            <span>{t('addProject.fields.riskNotes')}</span>
            <textarea value={form.riskNotes} onChange={(event) => update('riskNotes', event.target.value)} />
          </label>
          <button className="primary-button wide-button" type="submit">
            {t('editModal.save')} <ArrowRight size={18} />
          </button>
        </div>
      </form>
    </div>
  );
}

function VerificationRequestModal({ project, onClose, onSubmitted }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    projectName: project.name || '',
    contract: project.contract || '',
    website: hasValue(project.website) ? project.website : '',
    twitter: hasValue(project.twitter) ? project.twitter : '',
    telegram: hasValue(project.telegram) ? project.telegram : '',
    ownerWallet: '',
    proofNote: '',
  });
  const { address: wallet, adapter: walletAdapter, selectAndConnect, connectError: walletConnectError } = useKhanWallet();
  const [signature, setSignature] = useState('');
  const [timestamp, setTimestamp] = useState('');
  const [state, setState] = useState({ status: 'idle', message: '' });

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (wallet) {
      update('ownerWallet', wallet);
      setState({ status: 'idle', message: t('verificationModal.statusConnected') });
    }
  }, [wallet]);

  useEffect(() => {
    if (walletConnectError) setState({ status: 'error', message: walletConnectError.message || t('verificationModal.statusConnectFailed') });
  }, [walletConnectError]);

  const connectWallet = () => {
    setState({ status: 'loading', message: t('verificationModal.statusConnecting') });
    selectAndConnect(walletAdapter?.name || PhantomWalletName);
  };

  const signMessage = async () => {
    if (!wallet) {
      setState({ status: 'error', message: t('verificationModal.statusConnectFirst') });
      return;
    }
    if (!form.contract.trim()) {
      setState({ status: 'error', message: t('verificationModal.statusContractRequired') });
      return;
    }
    const ts = new Date().toISOString();
    const message = buildVerificationMessage({
      projectName: form.projectName,
      contract: form.contract,
      walletAddress: wallet,
      timestamp: ts,
    });
    setState({ status: 'loading', message: t('verificationModal.statusWaitingSignature') });
    try {
      const sig = await signVerificationMessage(walletAdapter, message);
      setSignature(sig);
      setTimestamp(ts);
      setState({ status: 'idle', message: t('verificationModal.statusSigned') });
    } catch (error) {
      setState({ status: 'error', message: error.message || t('verificationModal.statusSignFailed') });
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!wallet || !signature || !timestamp) {
      setState({ status: 'error', message: t('verificationModal.statusSubmitFirst') });
      return;
    }
    if (form.ownerWallet.trim() !== wallet) {
      setState({ status: 'error', message: t('verificationModal.statusWalletMismatch') });
      return;
    }
    setState({ status: 'loading', message: t('verificationModal.statusSubmitting') });
    try {
      await submitVerificationRequest({
        projectId: project.id,
        projectName: form.projectName,
        contract: form.contract,
        website: form.website,
        twitter: form.twitter,
        telegram: form.telegram,
        ownerWallet: form.ownerWallet.trim(),
        walletAddress: wallet,
        signature,
        timestamp,
        proofNote: form.proofNote,
      });
      setState({ status: 'success', message: t('verificationModal.statusSubmitted') });
      await onSubmitted();
    } catch (error) {
      setState({ status: 'error', message: error.message || t('verificationModal.statusSubmitFailed') });
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Request Verification">
      <form className="modal-panel edit-modal" onSubmit={submit}>
        <button className="close-button" type="button" onClick={onClose} aria-label="Close verification request"><X size={20} /></button>
        <SectionTitle icon={BadgeCheck} eyebrow={t('verificationModal.eyebrow')} title={t('verificationModal.title', { name: project.name })} />
        <p className="section-subtitle">{t('verificationModal.subtitle')}</p>
        <div className="add-form">
          <FormField label={t('verificationModal.fields.projectName')} value={form.projectName} onChange={(value) => update('projectName', value)} required />
          <FormField label={t('verificationModal.fields.contract')} value={form.contract} onChange={(value) => update('contract', value)} required />
          <FormField label={t('verificationModal.fields.website')} value={form.website} onChange={(value) => update('website', value)} />
          <FormField label={t('verificationModal.fields.twitter')} value={form.twitter} onChange={(value) => update('twitter', value)} />
          <FormField label={t('verificationModal.fields.telegram')} value={form.telegram} onChange={(value) => update('telegram', value)} />
          <FormField label={t('verificationModal.fields.ownerWallet')} value={form.ownerWallet} onChange={(value) => update('ownerWallet', value)} required placeholder={t('verificationModal.fields.ownerWalletPlaceholder')} />
          <label className="form-field wide">
            <span>{t('verificationModal.fields.proofNote')}</span>
            <textarea value={form.proofNote} onChange={(event) => update('proofNote', event.target.value)} placeholder={t('verificationModal.fields.proofNotePlaceholder')} />
          </label>

          <div className="verification-wallet-panel">
            <button className="secondary-button" type="button" onClick={connectWallet}>
              <WalletCards size={18} /> {wallet ? t('verificationModal.phantomConnected') : t('verificationModal.connectPhantom')}
            </button>
            {wallet && <span className="verification-wallet-address">{wallet}</span>}
            <button className="secondary-button" type="button" onClick={signMessage} disabled={!wallet}>
              <BadgeCheck size={18} /> {signature ? t('verificationModal.messageSigned') : t('verificationModal.signMessage')}
            </button>
          </div>

          {state.message && (
            <p className={state.status === 'error' ? 'lookup-message error' : 'lookup-message'}>{state.message}</p>
          )}

          <button className="primary-button wide-button" type="submit" disabled={state.status === 'loading' || state.status === 'success'}>
            {t('verificationModal.submit')} <ArrowRight size={18} />
          </button>
        </div>
      </form>
    </div>
  );
}

function AdminVerificationPage({ onReviewed }) {
  const { t } = useTranslation();
  const [token, setToken] = useState(() => getStoredAdminToken());
  const [passcode, setPasscode] = useState('');
  const [authState, setAuthState] = useState({ status: 'idle', message: '' });
  const [requests, setRequests] = useState([]);
  const [notes, setNotes] = useState({});
  const [listState, setListState] = useState({ status: 'idle', message: '' });

  const loadRequests = async (activeToken) => {
    setListState({ status: 'loading', message: t('adminVerify.loadingRequests') });
    try {
      const items = await fetchAllRequests(activeToken);
      setRequests(items);
      setListState({ status: 'idle', message: '' });
    } catch (error) {
      setListState({ status: 'error', message: error.message || t('adminVerify.loadFailed') });
    }
  };

  useEffect(() => {
    if (token) loadRequests(token);
  }, [token]);

  const login = async (event) => {
    event.preventDefault();
    setAuthState({ status: 'loading', message: t('adminVerify.checkingPasscode') });
    try {
      const newToken = await adminLogin(passcode);
      setToken(newToken);
      setAuthState({ status: 'idle', message: '' });
    } catch (error) {
      setAuthState({ status: 'error', message: error.message || t('adminVerify.loginFailed') });
    }
  };

  const logout = () => {
    clearAdminToken();
    setToken('');
    setRequests([]);
  };

  const review = async (request, decision) => {
    try {
      await reviewVerificationRequest(token, { requestId: request.id, decision, adminNote: notes[request.id] || '' });
      await loadRequests(token);
      await onReviewed?.();
    } catch (error) {
      setListState({ status: 'error', message: error.message || t('adminVerify.reviewFailed') });
    }
  };

  if (!token) {
    return (
      <section className="page-section">
        <SectionTitle icon={Lock} eyebrow={t('adminVerify.eyebrow')} title={t('adminVerify.title')} />
        <form className="add-form admin-login-form" onSubmit={login}>
          <FormField label={t('adminVerify.passcodeLabel')} type="password" value={passcode} onChange={setPasscode} required />
          <button className="primary-button wide-button" type="submit" disabled={authState.status === 'loading'}>
            {t('common.signIn')} <ArrowRight size={18} />
          </button>
          {authState.message && <p className="lookup-message error">{authState.message}</p>}
        </form>
      </section>
    );
  }

  const pending = requests.filter((request) => request.status === 'pending');
  const reviewed = requests.filter((request) => request.status !== 'pending');

  return (
    <section className="page-section">
      <SectionTitle icon={Shield} eyebrow={t('adminVerify.eyebrow')} title={t('adminVerify.title')} />
      <button className="secondary-button" type="button" onClick={logout}>{t('common.signOut')}</button>
      {listState.message && <p className={listState.status === 'error' ? 'lookup-message error' : 'lookup-message'}>{listState.message}</p>}

      <h3 className="admin-section-heading">{t('adminVerify.pendingTitle', { count: pending.length })}</h3>
      {!pending.length && <EmptyState title={t('adminVerify.emptyPendingTitle')} text={t('adminVerify.emptyPendingText')} />}
      <div className="admin-request-list">
        {pending.map((request) => (
          <article className="admin-request-card" key={request.id}>
            <header>
              <strong>{request.projectName}</strong>
              <span className="status-badge">{request.contract}</span>
            </header>
            <p>{t('adminVerify.ownerWallet', { value: request.ownerWallet })}</p>
            <p>{t('adminVerify.signedWallet', { value: request.walletAddress })}</p>
            <p>{t('adminVerify.signature')} <code>{request.signature}</code></p>
            <p>{t('adminVerify.timestamp', { value: request.timestamp })}</p>
            {request.website && <p>{t('adminVerify.website', { value: request.website })}</p>}
            {request.twitter && <p>{t('adminVerify.twitter', { value: request.twitter })}</p>}
            {request.telegram && <p>{t('adminVerify.telegram', { value: request.telegram })}</p>}
            {request.proofNote && <p>{t('adminVerify.proofNote', { value: request.proofNote })}</p>}
            <label className="form-field wide">
              <span>{t('adminVerify.adminNoteLabel')}</span>
              <textarea
                value={notes[request.id] || ''}
                onChange={(event) => setNotes((current) => ({ ...current, [request.id]: event.target.value }))}
                placeholder={t('adminVerify.adminNotePlaceholder')}
              />
            </label>
            <div className="admin-request-actions">
              <button className="primary-button" type="button" onClick={() => review(request, 'verified')}>
                <CheckCircle2 size={18} /> {t('adminVerify.approve')}
              </button>
              <button className="secondary-button" type="button" onClick={() => review(request, 'rejected')}>
                <X size={18} /> {t('adminVerify.reject')}
              </button>
            </div>
          </article>
        ))}
      </div>

      <h3 className="admin-section-heading">{t('adminVerify.reviewedTitle', { count: reviewed.length })}</h3>
      <div className="admin-request-list">
        {reviewed.map((request) => (
          <article className="admin-request-card reviewed" key={request.id}>
            <header>
              <strong>{request.projectName}</strong>
              <span className={request.status === 'verified' ? 'status-badge verified' : 'status-badge rejected'}>{translatedVerificationStatusLabel(request.status)}</span>
            </header>
            <p>{t('adminVerify.reviewed', { value: request.reviewedAt || t('common.notAvailable') })}</p>
            {request.adminNote && <p>{t('adminVerify.adminNote', { value: request.adminNote })}</p>}
          </article>
        ))}
      </div>

      <button className="secondary-button admin-cross-link" type="button" onClick={() => { window.location.hash = '/admin-analytics'; window.dispatchEvent(new HashChangeEvent('hashchange')); }}>
        <BarChart3 size={18} /> {t('adminVerify.openAnalytics')}
      </button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Internal Analytics Dashboard - admin-only. Reuses the same admin token
// system as AdminVerificationPage (one shared KHAN_ADMIN_PASSCODE), so an
// admin who is already signed in in this browser session does not need to
// log in twice. All numbers come from analytics-summary, which derives them
// from the one shared event log - the same single source of truth used by
// every page that calls trackEvent() (see src/platformAnalytics.js).
// ---------------------------------------------------------------------------

function Sparkline({ data, color = 'var(--gold)', height = 64 }) {
  if (!data?.length) return null;
  const max = Math.max(1, ...data.map((point) => point.count));
  const width = 100;
  const stepX = width / Math.max(1, data.length - 1);
  const points = data.map((point, index) => `${(index * stepX).toFixed(2)},${(height - (point.count / max) * height).toFixed(2)}`).join(' ');
  return (
    <svg className="analytics-sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" />
    </svg>
  );
}

function MiniBarChart({ data, color = 'var(--gold)' }) {
  if (!data?.length) return null;
  const max = Math.max(1, ...data.map((item) => item.value));
  return (
    <div className="analytics-bar-chart">
      {data.map((item) => (
        <div className="analytics-bar-row" key={item.label}>
          <span className="analytics-bar-label">{item.label}</span>
          <div className="analytics-bar-track">
            <div className="analytics-bar-fill" style={{ width: `${(item.value / max) * 100}%`, background: item.color || color }} />
          </div>
          <span className="analytics-bar-value">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

function DonutChart({ data, size = 140 }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  if (!total) return <EmptyState title={translate('adminAnalytics.noDataTitle')} text={translate('adminAnalytics.distributionNoData')} />;
  const radius = size / 2;
  const circumference = 2 * Math.PI * (radius - 10);
  let offset = 0;
  return (
    <div className="analytics-donut-wrap">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <circle cx={radius} cy={radius} r={radius - 10} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="14" />
        {data.map((item) => {
          const fraction = item.value / total;
          const length = fraction * circumference;
          const dasharray = `${length} ${circumference - length}`;
          const dashoffset = circumference - offset;
          offset += length;
          return (
            <circle
              key={item.label}
              cx={radius}
              cy={radius}
              r={radius - 10}
              fill="none"
              stroke={item.color}
              strokeWidth="14"
              strokeDasharray={dasharray}
              strokeDashoffset={dashoffset}
              transform={`rotate(-90 ${radius} ${radius})`}
            />
          );
        })}
      </svg>
      <div className="analytics-donut-legend">
        {data.map((item) => (
          <span key={item.label}>
            <i style={{ background: item.color }} /> {item.label} ({item.value})
          </span>
        ))}
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sublabel }) {
  return (
    <div className="analytics-stat-card">
      <Icon size={20} />
      <strong>{value}</strong>
      <span>{label}</span>
      {sublabel && <small>{sublabel}</small>}
    </div>
  );
}

function RankTable({ title, columns, rows, emptyText }) {
  return (
    <div className="analytics-table-card">
      <h4>{title}</h4>
      {!rows.length ? (
        <EmptyState title={translate('adminAnalytics.noDataTitle')} text={emptyText || translate('adminAnalytics.noDataDefault')} />
      ) : (
        <table className="analytics-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function AdminAnalyticsPage() {
  const { t } = useTranslation();
  const [token, setToken] = useState(() => getStoredAdminToken());
  const [passcode, setPasscode] = useState('');
  const [authState, setAuthState] = useState({ status: 'idle', message: '' });
  const [summary, setSummary] = useState(null);
  const [loadState, setLoadState] = useState({ status: 'idle', message: '' });
  const [range, setRange] = useState(30);

  const loadSummary = async (activeToken) => {
    setLoadState({ status: 'loading', message: t('adminAnalytics.loadingAnalytics') });
    try {
      const data = await fetchAnalyticsSummary(activeToken);
      setSummary(data);
      setLoadState({ status: 'idle', message: '' });
    } catch (error) {
      setLoadState({ status: 'error', message: error.message || t('adminAnalytics.loadFailed') });
    }
  };

  useEffect(() => {
    if (token) loadSummary(token);
  }, [token]);

  const login = async (event) => {
    event.preventDefault();
    setAuthState({ status: 'loading', message: t('adminVerify.checkingPasscode') });
    try {
      const newToken = await adminLogin(passcode);
      setToken(newToken);
      setAuthState({ status: 'idle', message: '' });
    } catch (error) {
      setAuthState({ status: 'error', message: error.message || t('adminVerify.loginFailed') });
    }
  };

  const logout = () => {
    clearAdminToken();
    setToken('');
    setSummary(null);
  };

  const exportJson = () => {
    if (!summary) return;
    downloadAsFile(`khan-trust-analytics-${Date.now()}.json`, JSON.stringify(summary, null, 2), 'application/json');
  };

  const exportCsv = () => {
    if (!summary) return;
    downloadAsFile(`khan-trust-analytics-${Date.now()}.csv`, summaryToCsv(summary), 'text/csv');
  };

  if (!token) {
    return (
      <section className="page-section">
        <SectionTitle icon={Lock} eyebrow={t('adminVerify.eyebrow')} title={t('adminAnalytics.title')} />
        <form className="add-form admin-login-form" onSubmit={login}>
          <FormField label={t('adminVerify.passcodeLabel')} type="password" value={passcode} onChange={setPasscode} required />
          <button className="primary-button wide-button" type="submit" disabled={authState.status === 'loading'}>
            {t('common.signIn')} <ArrowRight size={18} />
          </button>
          {authState.message && <p className="lookup-message error">{authState.message}</p>}
        </form>
      </section>
    );
  }

  if (loadState.status === 'loading' && !summary) {
    return (
      <section className="page-section">
        <SectionTitle icon={BarChart3} eyebrow={t('adminVerify.eyebrow')} title={t('adminAnalytics.title')} />
        <p className="lookup-message">{t('adminAnalytics.loadingAnalytics')}</p>
      </section>
    );
  }

  if (!summary) {
    return (
      <section className="page-section">
        <SectionTitle icon={BarChart3} eyebrow={t('adminVerify.eyebrow')} title={t('adminAnalytics.title')} />
        <p className="lookup-message error">{loadState.message || t('adminAnalytics.loadFailed')}</p>
        <button className="secondary-button" type="button" onClick={() => loadSummary(token)}>{t('common.retry')}</button>
      </section>
    );
  }

  const scanSeries = range === 7 ? summary.scanAnalytics.last7 : range === 90 ? summary.scanAnalytics.last90 : summary.scanAnalytics.last30;
  const trustColors = { '0-20': 'var(--danger)', '21-40': '#f08a4b', '41-60': 'var(--warning)', '61-80': '#9bd97a', '81-100': 'var(--success)' };
  const distributionData = Object.entries(summary.trustScoreAnalytics.distribution).map(([label, value]) => ({ label, value, color: trustColors[label] }));
  const deviceData = [
    { label: t('adminAnalytics.deviceDesktop'), value: summary.visitorAnalytics.desktop, color: 'var(--gold)' },
    { label: t('adminAnalytics.deviceMobile'), value: summary.visitorAnalytics.mobile, color: 'var(--gold-bright)' },
  ];
  const trafficData = Object.entries(summary.visitorAnalytics.trafficSources).map(([label, value]) => ({
    label: label === 'x' ? 'X (Twitter)' : label.charAt(0).toUpperCase() + label.slice(1),
    value,
  }));
  const c = t('adminAnalytics.columns');

  return (
    <section className="page-section analytics-dashboard">
      <SectionTitle icon={BarChart3} eyebrow={t('adminVerify.eyebrow')} title={t('adminAnalytics.title')} />
      <div className="analytics-toolbar">
        <button className="secondary-button" type="button" onClick={() => loadSummary(token)}>{t('common.refresh')}</button>
        <button className="secondary-button" type="button" onClick={exportCsv}><Download size={16} /> {t('adminAnalytics.exportCsv')}</button>
        <button className="secondary-button" type="button" onClick={exportJson}><Download size={16} /> {t('adminAnalytics.exportJson')}</button>
        <button className="secondary-button" type="button" onClick={() => { window.location.hash = '/admin-verify'; window.dispatchEvent(new HashChangeEvent('hashchange')); }}>
          <Shield size={16} /> {t('adminAnalytics.verificationReview')}
        </button>
        <button className="ghost-button" type="button" onClick={logout}>{t('common.signOut')}</button>
      </div>
      <p className="analytics-meta">{t('adminAnalytics.generated', { date: new Date(summary.generatedAt).toLocaleString(), count: summary.eventCount })}</p>

      <div className="analytics-stat-grid">
        <StatCard icon={Activity} label={t('adminAnalytics.totalScans')} value={formatNumber(summary.overview.totalScans)} />
        <StatCard icon={Users} label={t('adminAnalytics.totalUsers')} value={formatNumber(summary.overview.totalUsers)} sublabel={t('adminAnalytics.uniqueVisitors')} />
        <StatCard icon={Layers3} label={t('adminAnalytics.totalProjects')} value={formatNumber(summary.overview.totalProjects)} />
        <StatCard icon={BadgeCheck} label={t('adminAnalytics.verifiedProjects')} value={formatNumber(summary.overview.verifiedProjects)} />
        <StatCard icon={Clock3} label={t('adminAnalytics.pendingVerification')} value={formatNumber(summary.overview.pendingVerification)} />
        <StatCard icon={X} label={t('adminAnalytics.rejectedVerification')} value={formatNumber(summary.overview.rejectedVerification)} />
      </div>

      <div className="detail-section analytics-section">
        <SectionTitle icon={LineChart} eyebrow={t('adminAnalytics.scansEyebrow')} title={t('adminAnalytics.scanActivity')} />
        <div className="analytics-range-row">
          {[7, 30, 90].map((days) => (
            <button key={days} className={range === days ? 'active' : ''} onClick={() => setRange(days)}>{t('adminAnalytics.lastDays', { days })}</button>
          ))}
        </div>
        <Sparkline data={scanSeries} height={80} />
        <div className="analytics-mini-stats">
          <span>{t('adminAnalytics.thisWeek')} <strong>{summary.scanAnalytics.totalThisWeek}</strong></span>
          <span>{t('adminAnalytics.thisMonth')} <strong>{summary.scanAnalytics.totalThisMonth}</strong></span>
          <span>{t('adminAnalytics.growth7d')} <strong className={summary.scanAnalytics.growth7d >= 0 ? 'trend-up' : 'trend-down'}>{summary.scanAnalytics.growth7d}%</strong></span>
          <span>{t('adminAnalytics.growth30d')} <strong className={summary.scanAnalytics.growth30d >= 0 ? 'trend-up' : 'trend-down'}>{summary.scanAnalytics.growth30d}%</strong></span>
        </div>
      </div>

      <div className="detail-section analytics-section">
        <RankTable
          title={t('adminAnalytics.mostScannedTokens')}
          columns={[c.name, c.ticker, c.contract, c.scans, c.avgTrustScore]}
          rows={summary.mostScannedTokens.map((token) => [
            token.name,
            token.ticker,
            <code key="contract">{token.contract}</code>,
            token.scanCount,
            token.avgTrustScore ?? 'N/A',
          ])}
        />
      </div>

      <div className="detail-section analytics-section analytics-grid-2">
        <RankTable
          title={t('adminAnalytics.mostViewedProjects')}
          columns={[c.name, c.ticker, c.views]}
          rows={summary.projectAnalytics.mostViewed.map((item) => [item.name, item.ticker, item.count])}
        />
        <RankTable
          title={t('adminAnalytics.mostTrustedProjects')}
          columns={[c.name, c.ticker, c.trustScore]}
          rows={summary.projectAnalytics.mostTrusted.map((item) => [item.name, item.ticker, item.trustScore])}
        />
        <RankTable
          title={t('adminAnalytics.lowestTrustProjects')}
          columns={[c.name, c.ticker, c.trustScore]}
          rows={summary.projectAnalytics.lowestTrust.map((item) => [item.name, item.ticker, item.trustScore])}
        />
        <RankTable
          title={t('adminAnalytics.topSearches')}
          columns={[c.query, c.count]}
          rows={summary.popularSearches.map((item) => [item.query, item.count])}
        />
      </div>

      <div className="detail-section analytics-section analytics-grid-2">
        <div>
          <h4>{t('adminAnalytics.distributionTitle')}</h4>
          <p className="analytics-meta">{t('adminAnalytics.averageTrustScore')} <strong>{summary.trustScoreAnalytics.average ?? 'N/A'}</strong> {t('adminAnalytics.scoredProjects', { count: summary.trustScoreAnalytics.sampleSize })}</p>
          <DonutChart data={distributionData} />
        </div>
        <div>
          <h4>{t('adminAnalytics.trendTitle')}</h4>
          <Sparkline data={summary.trustScoreAnalytics.trend.map((point) => ({ count: point.average }))} color="var(--success)" height={80} />
        </div>
      </div>

      <div className="detail-section analytics-section analytics-grid-2">
        <div>
          <h4>{t('adminAnalytics.visitorAnalytics')}</h4>
          <div className="analytics-mini-stats">
            <span>{t('adminAnalytics.totalVisitors')} <strong>{summary.visitorAnalytics.totalVisitors}</strong></span>
            <span><strong>{summary.visitorAnalytics.uniqueVisitors}</strong> {t('adminAnalytics.uniqueVisitors')}</span>
            <span>{t('adminAnalytics.newVisitors')} <strong>{summary.visitorAnalytics.newVisitors}</strong></span>
            <span>{t('adminAnalytics.returningVisitors')} <strong>{summary.visitorAnalytics.returningVisitors}</strong></span>
          </div>
          <MiniBarChart data={deviceData} />
        </div>
        <div>
          <h4>{t('adminAnalytics.trafficSources')}</h4>
          <MiniBarChart data={trafficData} color="var(--gold-bright)" />
        </div>
      </div>

      <div className="detail-section analytics-section analytics-grid-2">
        <div>
          <h4>{t('adminAnalytics.verificationActivity')}</h4>
          <div className="analytics-mini-stats">
            <span>{t('adminAnalytics.totalRequests')} <strong>{summary.verificationAnalytics.totalRequests}</strong></span>
            <span>{t('adminAnalytics.pending')} <strong>{summary.verificationAnalytics.pending}</strong></span>
            <span>{t('adminAnalytics.approved')} <strong>{summary.verificationAnalytics.approved}</strong></span>
            <span>{t('adminAnalytics.rejected')} <strong>{summary.verificationAnalytics.rejected}</strong></span>
            <span>{t('adminAnalytics.approvalRate')} <strong className="trend-up">{summary.verificationAnalytics.approvalRate}%</strong></span>
            <span>{t('adminAnalytics.rejectionRate')} <strong className="trend-down">{summary.verificationAnalytics.rejectionRate}%</strong></span>
          </div>
        </div>
        <div>
          <h4>{t('adminAnalytics.topActivity')}</h4>
          <div className="analytics-mini-stats">
            <span>{t('adminAnalytics.mostActiveDay')} <strong>{summary.topActivity.mostActiveDay.date || 'N/A'}</strong> ({summary.topActivity.mostActiveDay.count})</span>
            <span>{t('adminAnalytics.mostActiveWeek')} <strong>{summary.topActivity.mostActiveWeek.weekStarting || 'N/A'}</strong> ({summary.topActivity.mostActiveWeek.count})</span>
            <span>{t('adminAnalytics.mostActiveMonth')} <strong>{summary.topActivity.mostActiveMonth.month || 'N/A'}</strong> ({summary.topActivity.mostActiveMonth.count})</span>
          </div>
        </div>
      </div>
    </section>
  );
}

const WHITEPAPER_ICONS = [BookOpen, AlertTriangle, Sparkles, Shield, Layers3, Star, TimerReset, TrendingUp];

function WhitepaperPage() {
  const { t } = useTranslation();
  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${WHITEPAPER.title} | KHAN Trust`;
    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <>
      <section className="hero-section whitepaper-hero">
        <p className="eyebrow"><BookOpen size={16} /> {t('whitepaper.eyebrow')}</p>
        <h1>{WHITEPAPER.title}</h1>
        <p className="hero-subtitle">{WHITEPAPER.subtitle}</p>
        <p className="hero-explainer">{t('whitepaper.hero')}</p>
        <div className="whitepaper-meta-row">
          <span><strong>{t('whitepaper.versionLabel')}</strong> {WHITEPAPER.version}</span>
          <span><strong>{t('whitepaper.releaseDateLabel')}</strong> {WHITEPAPER.releaseDate}</span>
        </div>
      </section>

      <section className="page-section">
        <WhitepaperPreviewCard />
      </section>

      <section className="page-section">
        <SectionTitle icon={Layers3} eyebrow={t('whitepaper.insideEyebrow')} title={t('whitepaper.learnTitle')} />
        <div className="whitepaper-topic-grid">
          {t('whitepaper.topics').map(([title, text], index) => {
            const Icon = WHITEPAPER_ICONS[index];
            return (
              <div key={title} className="whitepaper-topic-card">
                <Icon size={20} className="gold-icon" />
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="page-section">
        <SectionTitle icon={Info} eyebrow={t('whitepaper.whyEyebrow')} title={t('whitepaper.whyTitle')} />
        <div className="about-panel whitepaper-reasons-panel">
          <p>{t('whitepaper.whyIntro')}</p>
          <ul className="whitepaper-reasons-list">
            {t('whitepaper.reasons').map((reason) => (
              <li key={reason}><CheckCircle2 size={16} /> {reason}</li>
            ))}
          </ul>
        </div>
      </section>

      <Disclaimer text={t('disclaimer.whitepaper')} />
    </>
  );
}

function WhitepaperPreviewCard() {
  const { t } = useTranslation();
  const [previewFailed, setPreviewFailed] = useState(false);

  return (
    <div className="whitepaper-preview-card">
      <div className="whitepaper-preview-icon">
        <FileText size={36} />
      </div>
      <div className="whitepaper-preview-info">
        <h3>{WHITEPAPER.fileName}</h3>
        <dl className="whitepaper-preview-details">
          <div>
            <dt>{t('whitepaper.versionField')}</dt>
            <dd>{WHITEPAPER.version}</dd>
          </div>
          {WHITEPAPER.pageCount ? (
            <div>
              <dt>{t('whitepaper.pagesField')}</dt>
              <dd>{WHITEPAPER.pageCount}</dd>
            </div>
          ) : null}
          <div>
            <dt>{t('whitepaper.lastUpdatedField')}</dt>
            <dd>{WHITEPAPER.lastUpdated}</dd>
          </div>
        </dl>
        {previewFailed && (
          <p className="whitepaper-preview-fallback">{t('whitepaper.previewFallback')}</p>
        )}
        <div className="whitepaper-preview-actions">
          <a
            className="primary-button"
            href={WHITEPAPER.fileUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => {
              fetch(WHITEPAPER.fileUrl, { method: 'HEAD' })
                .then((response) => {
                  if (!response.ok) setPreviewFailed(true);
                })
                .catch(() => setPreviewFailed(true));
            }}
          >
            {t('whitepaper.viewWhitepaper')} <ExternalLink size={18} />
          </a>
          <a className="secondary-button" href={WHITEPAPER.fileUrl} download={WHITEPAPER.fileName}>
            {t('whitepaper.downloadPdf')} <Download size={18} />
          </a>
        </div>
      </div>
    </div>
  );
}

function AboutPage({ openMethodology, navigate }) {
  const { t } = useTranslation();
  return (
    <section className="page-section about-page">
      <SectionTitle icon={Shield} eyebrow={t('about.eyebrow')} title={t('about.title')} />
      <div className="about-grid">
        <div className="about-panel">
          <h3>{t('about.problemTitle')}</h3>
          <p>{t('about.problemText')}</p>
        </div>
        <div className="about-panel">
          <h3>{t('about.solutionTitle')}</h3>
          <p>{t('about.solutionText')}</p>
        </div>
      </div>
      <div className="positioning">
        {t('about.positioning').map(([name, text]) => (
          <p key={name}><strong>{name}</strong> {text}</p>
        ))}
      </div>
      <button className="primary-button" onClick={openMethodology}>
        {t('about.viewMethodology')} <Info size={18} />
      </button>
      <KhanEcosystemStrip navigate={navigate} />
      <FutureFoundationSection />
      <Disclaimer />
    </section>
  );
}

function MethodologyModal({ onClose }) {
  const { t } = useTranslation();
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Trust Score Methodology">
      <div className="modal-panel">
        <button className="close-button" onClick={onClose} aria-label="Close methodology"><X size={20} /></button>
        <SectionTitle icon={Sparkles} eyebrow={t('methodology.eyebrow')} title={t('methodology.title')} />
        <p>{t('methodology.body')}</p>
        <div className="method-grid">
          {t('methodology.items').map((item) => (
            <div key={item}>
              <CheckCircle2 size={18} />
              <strong>{item}</strong>
              <span>{t('methodology.itemNote')}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SearchBox({ value, onChange, onSubmit, loading = false }) {
  const { t } = useTranslation();
  return (
    <form className="search-box" onSubmit={(event) => { event.preventDefault(); onSubmit?.(); }}>
      <Search size={20} />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={t('search.placeholder')}
      />
      <button type="submit" disabled={loading}>{loading ? t('common.searching') : t('common.search')}</button>
    </form>
  );
}

function SearchStatus({ state }) {
  if (!state.message) return null;
  return <p className={`search-status ${state.status}`}>{state.message}</p>;
}

function ScoreCircle({ score, size = 'normal' }) {
  const { t } = useTranslation();
  const style = { '--score': `${score * 3.6}deg` };
  return (
    <div className={`score-circle ${size}`} style={style}>
      <span>{score}</span>
      <small>{t('common.trust')}</small>
    </div>
  );
}

function RiskPill({ level }) {
  const { t } = useTranslation();
  return <span className={`risk-pill ${level.toLowerCase()}`}>{t('common.riskSuffix', { level: t(`common.${level.toLowerCase()}`) })}</span>;
}

function SectionTitle({ icon: Icon, eyebrow, title }) {
  return (
    <div className="section-title">
      <span><Icon size={17} /> {eyebrow}</span>
      <h2>{title}</h2>
    </div>
  );
}

function EmptyState({ title, text }) {
  return (
    <div className="empty-state">
      <Eye size={28} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

function Disclaimer({ compact = false, text }) {
  return (
    <section className={compact ? 'disclaimer compact' : 'disclaimer'}>
      <AlertTriangle size={18} />
      <p>{text || 'KHAN Trust does not provide financial advice. Scores are for research and risk awareness only.'}</p>
    </section>
  );
}

function Footer() {
  const { t } = useTranslation();
  return (
    <footer className="site-footer">
      <strong>KHAN Trust</strong>
      <span>{t('footer.tagline')}</span>
    </footer>
  );
}

function Root() {
  return (
    <I18nProvider>
      <WalletContextProvider>
        <App />
      </WalletContextProvider>
    </I18nProvider>
  );
}

createRoot(document.getElementById('root')).render(<Root />);
