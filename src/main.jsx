import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Bell,
  CalendarDays,
  CheckCircle2,
  CircleDot,
  Clock3,
  Copy,
  Download,
  ExternalLink,
  Eye,
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

const PROJECTS_KEY = 'khan-trust-projects-v1';
const WATCHLIST_KEY = 'khan-trust-watchlist-v1';
const CRYPTO_PAYMENT_WALLET = import.meta.env.VITE_KHAN_PAYMENT_WALLET || '';
const SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com';
const DEXSCREENER_SOLANA_TOKEN_URL = 'https://api.dexscreener.com/token-pairs/v1/solana';
const JUPITER_TOKEN_SEARCH_URL = 'https://lite-api.jup.ag/tokens/v2/search';

const khanProject = {
  id: 'khan-solana',
  name: 'KHAN',
  ticker: '$KHAN',
  chain: 'Solana',
  contract: 'Coming soon',
  website: 'https://khantrust.local',
  twitter: 'https://x.com/khantrust',
  telegram: 'https://t.me/khantrust',
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
  { id: 'about', label: 'About', icon: Info },
  { id: 'khan', label: '$KHAN', icon: Star },
];

const premiumReportItems = [
  ['Saved reports', 'Keep previous scans organized in a future Premium workspace.'],
  ['Watchlist', 'Track selected tokens and changing risk signals when Premium launches.'],
  ['Deeper risk analysis', 'Expanded checks across liquidity, age, holders, links, and transparency.'],
  ['Advanced holder insights', 'Largest wallets, top 10 concentration, and whale-pressure warnings.'],
  ['Telegram alerts', 'Alerts for watched tokens and changing risk signals.'],
];

const filters = ['All', 'Solana', 'Ethereum', 'BSC', 'Base', 'New Projects', 'High Risk', 'Strong Community'];

function normalizeProject(input) {
  const now = new Date().toISOString().slice(0, 10);
  const roadmapText = input.roadmapText || roadmapToText(input.roadmap);
  const realData = input.realData ? syncSocialData(input.realData, input) : null;
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
    lastUpdate: input.lastUpdate || now,
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
  const score = calculateTrustScore(baseProject, realData);

  return {
    ...baseProject,
    trustScore: score,
    riskLevel: scoreToRisk(score),
    scoreBreakdown: buildScoreBreakdown(baseProject, holders, communitySize, score),
    riskFlags: deriveRiskFlags(baseProject, holders, communitySize),
  };
}

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
  ]);
  const penalty = liveDataPenalty(data, holderCount);
  return {
    ...scores,
    finalTrustScore: clamp(Math.max(5, weighted - penalty), 5, 100),
  };
}

function calculateManualScores(project = {}) {
  const socialScore = scoreSocial(project, project.realData);
  const founderScore = isPublicFounder(project.founderStatus) ? 72 : project.founderStatus?.toLowerCase().includes('anonymous') ? 18 : 42;
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
    finalTrustScore: clamp(Math.max(5, average - riskPenalty(project.riskNotes)), 5, 100),
  };
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

function riskPenalty(notes = '') {
  const text = notes.toLowerCase();
  const penalties = [
    ['anonymous', 10],
    ['low liquidity', 10],
    ['no roadmap', 8],
    ['low holders', 7],
    ['very new project', 6],
    ['very new', 6],
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
  return [
    ['Chain', project.chain, Layers3],
    ['Contract', project.contract, Lock],
    ['Website', socialPresenceState('website', project, data), Globe2],
    ['X/Twitter', socialPresenceState('twitter', project, data), ExternalLink],
    ['Telegram', socialPresenceState('telegram', project, data), MessageCircle],
    ['GitHub', linkPresenceState(firstPresent(project.github, data.githubUrl)), Github],
    ['Launch date', project.launchDate, CalendarDays],
    ['Status', project.status, BadgeCheck],
    ['Last update', project.lastUpdate, TimerReset],
  ];
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
    websiteUrl: firstPresent(project.website, data.websiteUrl),
    twitterUrl: firstPresent(project.twitter, data.twitterUrl),
    telegramUrl: firstPresent(project.telegram, data.telegramUrl),
    githubUrl: firstPresent(project.github, data.githubUrl),
  };
}

function deriveRiskFlags(project, holders, communitySize) {
  const factorFlags = riskFactors({ ...project, holders, communitySize })
    .filter((factor) => factor.severity === 'High' || factor.severity === 'Medium' || factor.severity === 'Limited')
    .map((factor) => `${factor.title} - ${factor.signal}`);
  return factorFlags.length ? factorFlags : ['No major public risk flags detected'];
}

function buildUpdatesTimeline(project, now) {
  const date = project.launchDate || now;
  const updates = [{ label: 'Project submitted', date: now }];
  if (hasValue(project.website)) updates.push({ label: 'Website added', date });
  if (hasValue(project.twitter)) updates.push({ label: 'X added', date });
  if (hasValue(project.telegram)) updates.push({ label: 'Telegram added', date });
  if (hasValue(project.github)) updates.push({ label: 'GitHub added', date });
  if (hasValue(project.roadmapText) || project.roadmap?.length) updates.push({ label: 'Roadmap added', date });
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
  return notes.length ? notes.join(', ') : 'Live Solana data available. Continue reviewing public transparency signals.';
}

function roadmapFromText(text) {
  if (!text) {
    return [{ phase: 'Roadmap proof needed', status: 'Planned' }];
  }
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((phase, index) => ({ phase, status: index === 0 ? 'In progress' : 'Planned' }));
}

function scoreToRisk(score) {
  if (score >= 78) return 'Low';
  if (score >= 55) return 'Medium';
  return 'High';
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
  if (!number) return 'Not available';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: number >= 1000 ? 0 : 2,
  }).format(number);
}

function formatNumber(value) {
  const number = Number(value || 0);
  if (!number) return 'Not available';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(number);
}

function formatAge(days) {
  if (days === null || days === undefined) return 'Not available';
  if (days < 1) return 'Less than 1 day';
  if (days < 30) return `${days} days`;
  if (days < 365) return `${Math.round(days / 30)} months`;
  return `${Math.round(days / 365)} years`;
}

function formatPercent(value) {
  if (value === null || value === undefined) return 'Not available';
  return `${Number(value).toFixed(2)}%`;
}

function formatScore(value) {
  return value === null || value === undefined ? 'Not available' : `${value}/100`;
}

function displayValue(value) {
  return hasValue(value) ? value : 'Not available';
}

function holderConcentrationStatus(data = {}) {
  if (data.topHolderPercent === null || data.topHolderPercent === undefined) {
    return 'Top holder data unavailable from public source';
  }
  if (data.topHolderPercent > 35 || data.topTenHolderPercent > 70) return 'Whale concentration warning';
  return 'No major whale concentration signal';
}

function holderRiskLevel(data = {}) {
  if (data.topHolderPercent === null || data.topHolderPercent === undefined) return 'Limited data';
  if (data.topHolderPercent > 35 || data.topTenHolderPercent > 70) return 'High risk signal';
  if (data.topHolderPercent > 20 || data.topTenHolderPercent > 50) return 'Moderate risk signal';
  return 'Lower concentration risk';
}

function riskBadge(score) {
  if (score >= 78) return 'Low Risk';
  if (score >= 55) return 'Medium Risk';
  return 'High Risk';
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
    return { label: 'Limited data', available, total: checks.length };
  }
  if (available >= 7) return { label: 'High confidence', available, total: checks.length };
  if (available >= 5) return { label: 'Medium confidence', available, total: checks.length };
  return { label: 'Limited data', available, total: checks.length };
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
    presenceFactor('Website presence', website, 'Website found', 'Missing website', 'A website gives users a basic place to verify project information, docs, and official links.'),
    presenceFactor('X/Twitter presence', twitter, 'X/Twitter found', 'Missing X/Twitter', 'An active X/Twitter account is a public communication signal. Missing X/Twitter makes community verification harder.'),
    presenceFactor('Telegram presence', telegram, 'Telegram found', 'Missing Telegram', 'Telegram is a common Solana community channel. Missing Telegram limits community visibility.'),
  ];

  return factors.sort((a, b) => riskSeverityRank(b.severity) - riskSeverityRank(a.severity));
}

function holderCountFactor(holders, source = '') {
  if (!holders) {
    return {
      title: 'Holder count',
      severity: 'Limited',
      signal: 'Holder count unavailable',
      value: 'Not available',
      explanation: 'KHAN Trust could not confirm holder count from the public data sources available in this browser scan.',
    };
  }
  if (holders < 100) {
    return {
      title: 'Holder count',
      severity: 'High',
      signal: 'Very low holder count',
      value: formatNumber(holders),
      explanation: `${formatNumber(holders)} holders were found${source ? ` via ${source}` : ''}. Very low holder count can make price action easier to manipulate.`,
    };
  }
  if (holders < 500) {
    return {
      title: 'Holder count',
      severity: 'Medium',
      signal: 'Low holder count',
      value: formatNumber(holders),
      explanation: `${formatNumber(holders)} holders were found. This is still a small holder base, so concentration and liquidity deserve closer review.`,
    };
  }
  return {
    title: 'Holder count',
    severity: 'Low',
    signal: 'Holder count available',
    value: formatNumber(holders),
    explanation: `${formatNumber(holders)} holders were found. Holder count alone is not enough, but it improves the available risk picture.`,
  };
}

function largestHolderFactor(percent) {
  if (percent === null || percent === undefined) {
    return {
      title: 'Largest holder concentration',
      severity: 'Limited',
      signal: 'Largest holder unavailable',
      value: 'Not available',
      explanation: 'The largest holder percentage was not available from public Solana holder data during this scan.',
    };
  }
  if (percent > 35) {
    return {
      title: 'Largest holder concentration',
      severity: 'High',
      signal: 'High holder concentration',
      value: formatPercent(percent),
      explanation: `The largest holder controls ${formatPercent(percent)} of supply, which is a strong concentration warning.`,
    };
  }
  if (percent > 20) {
    return {
      title: 'Largest holder concentration',
      severity: 'Medium',
      signal: 'Moderate holder concentration',
      value: formatPercent(percent),
      explanation: `The largest holder controls ${formatPercent(percent)} of supply. This is not automatically unsafe, but it deserves attention.`,
    };
  }
  return {
    title: 'Largest holder concentration',
    severity: 'Low',
    signal: 'No major largest-holder warning',
    value: formatPercent(percent),
    explanation: `The largest holder controls ${formatPercent(percent)} of supply, which is below KHAN Trust's major-warning threshold.`,
  };
}

function topTenHolderFactor(percent) {
  if (percent === null || percent === undefined) {
    return {
      title: 'Top 10 holder concentration',
      severity: 'Limited',
      signal: 'Top 10 concentration unavailable',
      value: 'Not available',
      explanation: 'Top 10 holder concentration could not be confirmed from the available public holder data.',
    };
  }
  if (percent > 70) {
    return {
      title: 'Top 10 holder concentration',
      severity: 'High',
      signal: 'High holder concentration',
      value: formatPercent(percent),
      explanation: `The top 10 holders control ${formatPercent(percent)} of supply, which can increase sell-pressure and manipulation risk.`,
    };
  }
  if (percent > 50) {
    return {
      title: 'Top 10 holder concentration',
      severity: 'Medium',
      signal: 'Moderate top 10 concentration',
      value: formatPercent(percent),
      explanation: `The top 10 holders control ${formatPercent(percent)} of supply. This is a concentration signal to monitor.`,
    };
  }
  return {
    title: 'Top 10 holder concentration',
    severity: 'Low',
    signal: 'No major top 10 warning',
    value: formatPercent(percent),
    explanation: `The top 10 holders control ${formatPercent(percent)} of supply, below KHAN Trust's major-warning threshold.`,
  };
}

function tokenAgeFactor(days) {
  if (days === null || days === undefined || Number.isNaN(days)) {
    return {
      title: 'Token age',
      severity: 'Limited',
      signal: 'Token age unavailable',
      value: 'Not available',
      explanation: 'Token age could not be confirmed from pool creation or token index data.',
    };
  }
  if (days < 14) {
    return {
      title: 'Token age',
      severity: 'High',
      signal: 'New token warning',
      value: formatAge(days),
      explanation: `This token appears to be ${formatAge(days)} old. Very new tokens usually have less trading history and less community proof.`,
    };
  }
  if (days < 60) {
    return {
      title: 'Token age',
      severity: 'Medium',
      signal: 'New token warning',
      value: formatAge(days),
      explanation: `This token appears to be ${formatAge(days)} old. It is still early, so users should expect higher uncertainty.`,
    };
  }
  return {
    title: 'Token age',
    severity: 'Low',
    signal: 'Token has public age history',
    value: formatAge(days),
    explanation: `This token appears to be ${formatAge(days)} old based on public pool or index data.`,
  };
}

function liquidityFactor(liquidity, poolCount = 0) {
  if (!liquidity) {
    return {
      title: 'Liquidity indicators',
      severity: 'Limited',
      signal: 'Liquidity warning',
      value: 'Not available',
      explanation: 'No public liquidity was found from the connected market sources. Thin or missing liquidity can make exits difficult.',
    };
  }
  if (liquidity < 5000) {
    return {
      title: 'Liquidity indicators',
      severity: 'High',
      signal: 'Liquidity warning',
      value: formatCurrency(liquidity),
      explanation: `Only ${formatCurrency(liquidity)} public liquidity was found${poolCount ? ` across ${formatNumber(poolCount)} pool(s)` : ''}. This is a high liquidity-risk signal.`,
    };
  }
  if (liquidity < 50000) {
    return {
      title: 'Liquidity indicators',
      severity: 'Medium',
      signal: 'Liquidity warning',
      value: formatCurrency(liquidity),
      explanation: `${formatCurrency(liquidity)} public liquidity was found. This is usable data, but still shallow for many token trades.`,
    };
  }
  return {
    title: 'Liquidity indicators',
    severity: 'Low',
    signal: 'Liquidity found',
    value: formatCurrency(liquidity),
    explanation: `${formatCurrency(liquidity)} public liquidity was found${poolCount ? ` across ${formatNumber(poolCount)} pool(s)` : ''}. Liquidity still changes quickly, so review it before acting.`,
  };
}

function presenceFactor(title, presence, okSignal, missingSignal, explanation) {
  if (presence.state === 'Present') {
    return {
      title,
      severity: 'Low',
      signal: okSignal,
      value: `Present: ${presence.value}`,
      explanation: `${okSignal}: ${presence.value}`,
    };
  }
  if (presence.state === 'Data unavailable') {
    return {
      title,
      severity: 'Limited',
      signal: 'Data unavailable',
      value: 'Data unavailable',
      explanation: `KHAN Trust could not confirm ${title.toLowerCase()} from the available token metadata sources.`,
    };
  }
  return {
    title,
    severity: 'Medium',
    signal: missingSignal,
    value: 'Missing',
    explanation,
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
    return 'This token has stronger public signals, but users should still check holders, liquidity, links, and recent updates before acting.';
  }
  if (score >= 55) {
    return 'This token has some useful public signals, but there are still gaps. Review holder concentration, liquidity, social links, and roadmap proof carefully.';
  }
  return 'This token has weak or limited public signals. Treat it as high risk until stronger holder, liquidity, social, founder, and roadmap proof is available.';
}

function buildPdfReportData(project = {}) {
  const confidence = confidenceScore(project);
  const data = project.realData || {};
  return {
    name: project.name,
    ticker: project.ticker,
    chain: project.chain,
    contract: displayValue(project.contract),
    trustScore: project.trustScore,
    riskLevel: project.riskLevel,
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
    generatedDate: new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }),
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
  const name = project.name || 'this token';
  const score = project.trustScore || 0;
  const risk = riskBadge(score);
  const contract = hasValue(project.contract) ? ` Contract: ${project.contract}` : '';
  if (channel === 'telegram') {
    return `KHAN Trust check: ${name} has a Trust Score of ${score}/100 (${risk}). Review holder, liquidity, social and founder risks before buying.${contract}`;
  }
  return `Checked ${name} on KHAN Trust: Trust Score ${score}/100 (${risk}). Review holder, liquidity, social and founder risks before buying.${contract}`;
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

function looksLikeSolanaAddress(value) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,48}$/.test(value.trim());
}

function upsertProject(items, project) {
  const normalizedContract = project.contract?.toLowerCase();
  const existing = items.find((item) => {
    const sameId = item.id === project.id;
    const sameContract = normalizedContract && item.contract?.toLowerCase() === normalizedContract;
    return sameId || sameContract;
  });
  const projectWithGrowth = applyHolderGrowth(project, existing);
  const withoutExisting = items.filter((item) => {
    const sameId = item.id === projectWithGrowth.id;
    const sameContract = normalizedContract && item.contract?.toLowerCase() === normalizedContract;
    return !sameId && !sameContract;
  });
  return [projectWithGrowth, ...withoutExisting];
}

function applyHolderGrowth(project, existing) {
  if (!project.realData) return project;
  if (project.realData.holderGrowthPercent !== null && project.realData.holderGrowthPercent !== undefined) {
    return project;
  }
  const previous = Number(existing?.realData?.holderCount || 0);
  const current = Number(project.realData.holderCount || 0);
  const holderGrowthPercent = previous > 0 && current > 0 ? roundPercent((current - previous) / previous) : null;
  return {
    ...project,
    realData: {
      ...project.realData,
      previousHolderCount: previous || null,
      holderGrowthPercent,
    },
  };
}

function App() {
  const [page, setPage] = useState(() => window.location.hash.replace('#/', '') || 'home');
  const [query, setQuery] = useState('');
  const [searchState, setSearchState] = useState({ status: 'idle', message: '' });
  const [activeFilter, setActiveFilter] = useState('All');
  const [userProjects, setUserProjects] = useState(() => readStorage(PROJECTS_KEY, []));
  const [watchlist, setWatchlist] = useState(() => readStorage(WATCHLIST_KEY, []));
  const [methodologyOpen, setMethodologyOpen] = useState(false);
  const [editingProject, setEditingProject] = useState(null);

  useEffect(() => {
    const onHash = () => setPage(window.location.hash.replace('#/', '') || 'home');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => writeStorage(PROJECTS_KEY, userProjects), [userProjects]);
  useEffect(() => writeStorage(WATCHLIST_KEY, watchlist), [watchlist]);

  useEffect(() => {
    initAnalytics();
  }, []);

  useEffect(() => {
    trackPageView(`/${page}`);
  }, [page]);

  useEffect(() => {
    if (page === 'pricing') trackPricingView();
  }, [page]);

  const projects = useMemo(() => userProjects.map((project) => normalizeProject(project)), [userProjects]);
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

  const navigate = (target) => {
    window.location.hash = `/${target}`;
    setPage(target);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const addProject = (project) => {
    const normalized = normalizeProject(project);
    setUserProjects((items) => upsertProject(items, normalized));
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

    setSearchState({ status: 'loading', message: 'Fetching live Solana token data...' });
    trackTokenScanStarted(term);
    try {
      const liveProject = normalizeProject(await lookupSolanaToken(term));
      setUserProjects((items) => upsertProject(items, liveProject));
      setSearchState({ status: 'success', message: `Opened live profile for ${liveProject.name || liveProject.ticker}.` });
      trackTokenScanCompleted(term, 'success');
      navigate(`project/${liveProject.id}`);
    } catch (error) {
      setSearchState({ status: 'error', message: error.message || 'No live Solana token data was found.' });
      trackTokenScanCompleted(term, 'error');
      navigate('explore');
    }
  };

  const handleTokenCheck = async (contractAddress) => {
    const term = contractAddress.trim();
    if (!term) {
      return { status: 'error', message: 'Paste a Solana token contract address first.' };
    }
    if (!looksLikeSolanaAddress(term)) {
      return { status: 'error', message: 'Enter a valid Solana token contract address, usually 32-48 base58 characters.' };
    }

    try {
      trackTokenScanStarted(term);
      const liveProject = normalizeProject(await lookupSolanaToken(term));
      setUserProjects((items) => upsertProject(items, liveProject));
      trackTokenScanCompleted(term, 'success');
      navigate(`report/${liveProject.id}`);
      return { status: 'success', message: `Opened free risk report for ${liveProject.name || liveProject.ticker}.` };
    } catch (error) {
      const demoProject = normalizeProject(createDemoRiskProject(term, error.message));
      setUserProjects((items) => upsertProject(items, demoProject));
      trackTokenScanCompleted(term, 'demo-fallback');
      navigate(`report/${demoProject.id}`);
      return { status: 'success', message: 'Live API data was unavailable, so KHAN Trust opened a demo risk report.' };
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
        {page === 'add' && <AddProjectPage onAdd={addProject} />}
        {page === 'pricing' && <PricingPage navigate={navigate} />}
        {page === 'compare' && <ComparePage projects={projects} navigate={navigate} />}
        {page.startsWith('report/') && reportProject && (
          <RiskReportPage project={reportProject} navigate={navigate} />
        )}
        {page.startsWith('report/') && !reportProject && (
          <section className="page-section">
            <EmptyState title="No report loaded" text="Paste a Solana contract address on the homepage to create a free risk report." />
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
          />
        )}
        {page.startsWith('project/') && !selectedProject && (
          <section className="page-section">
            <EmptyState title="No live profile loaded" text="Search a Solana contract address to create a real KHAN Trust profile." />
          </section>
        )}
        {page === 'khan' && !selectedProject && (
          <section className="page-section">
            <KhanTokenRole />
            <Disclaimer />
          </section>
        )}
        {page === 'about' && <AboutPage openMethodology={() => setMethodologyOpen(true)} />}
      </main>
      <Footer />
      <MobileNav page={page} navigate={navigate} />
      {methodologyOpen && <MethodologyModal onClose={() => setMethodologyOpen(false)} />}
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
  return (
    <header className="site-header">
      <button className="brand" onClick={() => navigate('home')} aria-label="Go to home">
        <span className="brand-mark">K</span>
        <span>
          <strong>KHAN Trust</strong>
          <small>Trust before hype</small>
        </span>
      </button>
      <nav className="desktop-nav">
        {navItems.map((item) => (
          <button key={item.id} className={isActive(page, item.id) ? 'active' : ''} onClick={() => navigate(item.id)}>
            {item.label}
          </button>
        ))}
      </nav>
    </header>
  );
}

function MobileNav({ page, navigate }) {
  return (
    <nav className="mobile-nav">
      {navItems.map((item) => {
        const Icon = item.icon;
        return (
          <button key={item.id} className={isActive(page, item.id) ? 'active' : ''} onClick={() => navigate(item.id)}>
            <Icon size={18} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function isActive(page, id) {
  if (id === 'khan') return page === 'khan';
  if (id === 'explore') return page === 'explore' || page.startsWith('project/') || page.startsWith('report/');
  return page === id;
}

function HomePage({ projects, query, setQuery, searchState, onSearch, onTokenCheck, navigate, openMethodology }) {
  const featured = projects.slice(0, 4);
  const heroProject = featured[0];
  return (
    <>
      <section className="hero-section">
        <div className="hero-grid">
          <div className="hero-copy">
            <p className="eyebrow"><Shield size={16} /> Trust before hype.</p>
            <h1>KHAN Trust</h1>
            <p className="hero-subtitle">Check token risk before you buy.</p>
            <p className="hero-explainer">
              KHAN Trust helps users understand holder, liquidity, social and founder risks.
            </p>
            <SearchBox value={query} onChange={setQuery} onSubmit={onSearch} loading={searchState.status === 'loading'} />
            <SearchStatus state={searchState} />
            <div className="flow-steps" aria-label="KHAN Trust flow">
              {['Paste token contract', 'Get Trust Score', 'Read simple risk explanation', 'Share result'].map((step, index) => (
                <div className="flow-step" key={step}>
                  <span>{index + 1}</span>
                  <strong>{step}</strong>
                </div>
              ))}
            </div>
            <div className="hero-actions">
              <button className="primary-button" onClick={() => navigate('explore')}>
                Explore Projects <ArrowRight size={18} />
              </button>
              <button className="secondary-button" onClick={() => navigate('add')}>
                Add Project <Plus size={18} />
              </button>
              <button className="ghost-button" onClick={() => navigate('khan')}>
                View $KHAN <Star size={18} />
              </button>
            </div>
          </div>
          <div className="hero-panel">
            <div className="signal-header">
              <div>
                <span className="tiny-label">Live trust radar</span>
                <h2>Project Signals</h2>
              </div>
              <BadgeCheck className="gold-icon" />
            </div>
            <div className="radar-score">
              {heroProject ? <ScoreCircle score={heroProject.trustScore} size="large" /> : <BadgeCheck className="gold-icon hero-empty-icon" size={56} />}
              <div>
                <strong>{heroProject ? heroProject.name : 'Live token lookup'}</strong>
                <span>{heroProject ? `${heroProject.ticker} on ${heroProject.chain}` : 'Paste a Solana contract to fetch real data'}</span>
              </div>
            </div>
            <div className="signal-list">
              {['Holder risk', 'Liquidity risk', 'Social risk', 'Founder / roadmap status'].map((item) => (
                <div key={item} className="signal-row">
                  <CheckCircle2 size={18} />
                  <span>{item}</span>
                  <small>tracked</small>
                </div>
              ))}
            </div>
            <button className="method-button" onClick={openMethodology}>
              Trust Score Methodology <Info size={16} />
            </button>
          </div>
        </div>
      </section>
      <CheckAnyTokenSection onTokenCheck={onTokenCheck} navigate={navigate} />
      <section className="content-band">
        <SectionTitle icon={BarChart3} eyebrow="Explore" title="Trust profiles, not hype feeds" />
        <div className="project-grid">
          {featured.map((project) => (
            <ProjectCard key={project.id} project={project} navigate={navigate} />
          ))}
        </div>
        {!featured.length && <EmptyState title="No saved live profiles" text="Search a Solana contract address to create the first real trust profile." />}
      </section>
      <KhanTokenRole />
      <Disclaimer />
    </>
  );
}

function CheckAnyTokenSection({ onTokenCheck, navigate }) {
  const [contractAddress, setContractAddress] = useState('');
  const [state, setState] = useState({ status: 'idle', message: '' });

  const submit = async (event) => {
    event.preventDefault();
    setState({ status: 'loading', message: 'Checking token risk signals...' });
    const result = await onTokenCheck(contractAddress);
    setState(result);
  };

  return (
    <section className="content-band check-token-section" id="check-token">
      <div className="check-token-grid">
        <div>
          <SectionTitle icon={Search} eyebrow="Token checker" title="Check Any Token" />
          <p>
            Paste a Solana token contract address to generate a free KHAN Trust risk report. If live public APIs are unavailable,
            the checker uses demo risk data so the report structure remains testable.
          </p>
        </div>
        <form className="token-check-card" onSubmit={submit}>
          <label className="form-field">
            <span>Solana contract address</span>
            <input
              value={contractAddress}
              onChange={(event) => setContractAddress(event.target.value)}
              placeholder="Paste token mint address"
              autoComplete="off"
            />
          </label>
          {state.message && <p className={`lookup-message ${state.status === 'error' ? 'error' : ''}`}>{state.message}</p>}
          <div className="token-check-actions">
            <button className="primary-button" type="submit" disabled={state.status === 'loading'}>
              <Search size={18} /> {state.status === 'loading' ? 'Checking...' : 'Check Token'}
            </button>
            <button className="ghost-button" type="button" onClick={() => navigate('pricing')}>
              See Pricing <WalletCards size={18} />
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

function ExplorePage({ projects, query, setQuery, searchState, onSearch, activeFilter, setActiveFilter, navigate }) {
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
      <SectionTitle icon={ListFilter} eyebrow="Explore" title="Crypto project trust profiles" />
      <SearchBox value={query} onChange={setQuery} onSubmit={onSearch} loading={searchState.status === 'loading'} />
      <SearchStatus state={searchState} />
      <div className="filter-row">
        {filters.map((filter) => (
          <button key={filter} className={activeFilter === filter ? 'active' : ''} onClick={() => setActiveFilter(filter)}>
            {filter}
          </button>
        ))}
      </div>
      <div className="project-grid">
        {filtered.map((project) => (
          <ProjectCard key={project.id} project={project} navigate={navigate} />
        ))}
      </div>
      {!filtered.length && <EmptyState title="No matching profiles" text="Try another search term or add the project manually." />}
    </section>
  );
}

function ComparePage({ projects, navigate }) {
  const [firstId, setFirstId] = useState(projects[0]?.id || '');
  const [secondId, setSecondId] = useState(projects[1]?.id || projects[0]?.id || '');
  const first = projects.find((project) => project.id === firstId) || projects[0];
  const second = projects.find((project) => project.id === secondId) || projects[1] || projects[0];

  return (
    <section className="page-section compare-page">
      <SectionTitle icon={Scale} eyebrow="Compare" title="Compare project trust signals" />
      {!projects.length && <EmptyState title="No live profiles yet" text="Search a Solana contract address first, then compare saved token profiles." />}
      <div className="compare-selectors">
        <ProjectSelect label="Project A" value={first?.id || ''} projects={projects} onChange={setFirstId} />
        <ProjectSelect label="Project B" value={second?.id || ''} projects={projects} onChange={setSecondId} />
      </div>
      {first && second && (
        <>
          <div className="compare-grid">
            <ComparePanel project={first} navigate={navigate} />
            <ComparePanel project={second} navigate={navigate} />
          </div>
          <div className="compare-table detail-section">
            <SectionTitle icon={BarChart3} eyebrow="Signal Review" title="Side-by-side checks" />
            <CompareRow label="Trust Score" first={`${first.trustScore}/100`} second={`${second.trustScore}/100`} />
            <CompareRow label="Chain" first={first.chain} second={second.chain} />
            <CompareRow label="Market Cap" first={formatCurrency(first.realData?.marketCapUsd)} second={formatCurrency(second.realData?.marketCapUsd)} />
            <CompareRow label="Liquidity" first={formatCurrency(first.realData?.totalLiquidityUsd ?? first.realData?.liquidityUsd)} second={formatCurrency(second.realData?.totalLiquidityUsd ?? second.realData?.liquidityUsd)} />
            <CompareRow label="Holder Count" first={formatNumber(first.realData?.holderCount || first.holders)} second={formatNumber(second.realData?.holderCount || second.holders)} />
            <CompareRow label="Token Age" first={formatAge(first.realData?.tokenAgeDays)} second={formatAge(second.realData?.tokenAgeDays)} />
            <CompareRow label="Largest Holder %" first={formatPercent(first.realData?.topHolderPercent)} second={formatPercent(second.realData?.topHolderPercent)} />
            <CompareRow label="Top 10 Holders %" first={formatPercent(first.realData?.topTenHolderPercent)} second={formatPercent(second.realData?.topTenHolderPercent)} />
            <CompareRow label="Social Score" first={formatScore(first.scoreBreakdown.socialScore)} second={formatScore(second.scoreBreakdown.socialScore)} />
            <CompareRow label="Risk Flags" first={first.riskFlags.join(', ')} second={second.riskFlags.join(', ')} />
            <CompareRow label="Roadmap status" first={roadmapClarity(first)} second={roadmapClarity(second)} />
            <CompareRow label="Founder status" first={displayValue(first.founderStatus)} second={displayValue(second.founderStatus)} />
          </div>
        </>
      )}
    </section>
  );
}

function ProjectSelect({ label, value, projects, onChange }) {
  return (
    <label className="form-field compare-select">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {!projects.length && <option value="">No live profiles</option>}
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
  return (
    <article className="compare-panel">
      <div className="compare-panel-top">
        <div>
          <span className="status-badge">{project.chain}</span>
          <h3>{project.name}</h3>
          <p>{project.ticker}</p>
        </div>
        <ScoreCircle score={project.trustScore} />
      </div>
      <div className="compare-metrics">
        <span><Users size={16} /> {formatNumber(project.realData?.holderCount || project.holders)} holders</span>
        <span><Shield size={16} /> {project.founderStatus}</span>
        <RiskPill level={project.riskLevel} />
      </div>
      <button className="card-button" onClick={() => navigate(`project/${project.id}`)}>
        Open profile <ArrowRight size={17} />
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
  const reasons = riskSignals(project).slice(0, 3);
  const factors = riskFactors(project);
  const confidence = confidenceScore(project);
  return (
    <section className="page-section report-page">
      <button className="back-button" onClick={() => navigate('home')}>Check another token</button>
      <div className="report-hero detail-section">
        <div>
          <span className="status-badge">{project.realData?.isDemo ? 'Demo report' : 'Free report'}</span>
          <h1>Risk Report</h1>
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
            <Download size={18} /> Download PDF Report
          </button>
          <small>Export this report for sharing or research.</small>
        </div>
      </div>

      <div className="report-layout">
        <div className="main-column">
          <section className="detail-section">
            <SectionTitle icon={Shield} eyebrow="Free scan" title="Basic Risk View" />
            <div className="report-metrics">
              <div>
                <span>Trust Score</span>
                <strong>{project.trustScore}/100</strong>
              </div>
              <div>
                <span>Risk Level</span>
                <strong>{project.riskLevel}</strong>
              </div>
              <div>
                <span>Data mode</span>
                <strong>{project.realData?.isDemo ? 'Mock demo' : 'Live/public'}</strong>
              </div>
              <div>
                <span>Confidence Score</span>
                <strong>{confidence.label}</strong>
              </div>
            </div>
            <p className="inline-note">Signal coverage: {confidence.available}/{confidence.total} data points available.</p>
          </section>

          <section className="detail-section">
            <SectionTitle icon={AlertTriangle} eyebrow="Reasons" title="3 Main Risk Reasons" />
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
            <SectionTitle icon={ListFilter} eyebrow="Risk factors" title="Real Solana Signal Explanations" />
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
  const [paymentMessage, setPaymentMessage] = useState('');
  const unlockPremium = async () => {
    const result = await handleUnlockPremiumClick(project);
    if (!result?.ok) setPaymentMessage(result?.message || stripeUnavailableMessage());
  };

  return (
    <section className="detail-section premium-lock-section">
      <SectionTitle icon={Lock} eyebrow="Premium" title="Unlock premium risk tools" />
      <p className="inline-note">Premium features are optional. Payments unlock platform features only. PDF export remains free for now.</p>
      <div className="premium-feature-grid">
        {premiumReportItems.map(([title, text]) => (
          <div className="premium-feature locked" key={title}>
            <Lock size={17} />
            <span>{title}</span>
            <p>{text}</p>
          </div>
        ))}
      </div>
      <div className="unlock-bar">
        <strong>Unlock Premium</strong>
        <div>
          <button className="primary-button" type="button" onClick={unlockPremium}>
            Unlock Premium
          </button>
          <button className="secondary-button" type="button" onClick={() => navigate('pricing')}>
            View plans <ArrowRight size={18} />
          </button>
        </div>
      </div>
      {paymentMessage && <p className="inline-note">{paymentMessage}</p>}
    </section>
  );
}

function OneTimeUnlockCard({ project, navigate }) {
  const [paymentMessage, setPaymentMessage] = useState('');
  const unlockPremium = async () => {
    const result = await handleUnlockPremiumClick(project);
    if (!result?.ok) setPaymentMessage(result?.message || stripeUnavailableMessage());
  };

  return (
    <section className="detail-section one-time-card">
      <SectionTitle icon={FileWarning} eyebrow="Premium" title="Premium Access" />
      <strong>$9/month</strong>
      <p>Premium features are optional. Payments unlock platform features only.</p>
      <button className="primary-button" type="button" onClick={unlockPremium}>
        Unlock Premium
      </button>
      <button className="secondary-button" type="button" onClick={() => navigate('pricing')}>
        View Pricing <WalletCards size={18} />
      </button>
      {paymentMessage && <p className="inline-note">{paymentMessage}</p>}
    </section>
  );
}

function PricingPage({ navigate }) {
  const [paymentMessage, setPaymentMessage] = useState('');
  const beginCheckout = async (plan) => {
    const result = plan === 'early_supporter' ? await handleEarlySupporterClick() : await handleUnlockPremiumClick();
    if (!result?.ok) setPaymentMessage(result?.message || stripeUnavailableMessage());
  };

  const plans = [
    {
      name: 'Free',
      price: '$0',
      description: 'Basic token scan and shareable PDF report export.',
      features: ['Trust Score', 'Risk Level', '3 main risk reasons', 'PDF report export'],
      cta: 'Start free scan',
      action: () => navigate('home'),
    },
    {
      name: 'Premium',
      price: '$9/month or 9 USDT/month',
      description: 'Optional Premium access for saved reports, watchlist, and deeper analysis placeholders.',
      features: ['Saved reports', 'Watchlist', 'Deeper risk analysis', 'Advanced holder insights', 'Telegram alerts'],
      cta: 'Unlock Premium',
      action: () => beginCheckout('premium'),
      featured: true,
    },
    {
      name: 'Early Supporter',
      price: '$29 one-time or 29 USDT one-time',
      description: 'Optional one-time supporter access. Early supporters may receive benefits later.',
      features: ['Early supporter badge placeholder', 'Potential future benefits', 'No token investment claims', 'No profit promises'],
      cta: 'Become Early Supporter',
      action: () => beginCheckout('early_supporter'),
    },
  ];

  return (
    <section className="page-section pricing-page">
      <SectionTitle icon={WalletCards} eyebrow="Pricing" title="Plans for KHAN Trust" />
      <p className="pricing-intro">
        Basic scans remain free and PDF report export remains available for now. Premium features are optional, and payments unlock platform features only.
      </p>
      <p className="pricing-note">
        KHAN Trust does not promise profit, returns, or investment outcomes. No investment claims.
      </p>
      {paymentMessage && <p className="pricing-note payment-message">{paymentMessage}</p>}
      <div className="premium-value-strip">
        {premiumReportItems.map(([title]) => (
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
      <p className="pricing-note">
        Premium features are optional. Early supporters may receive benefits later. Payments unlock platform features only. KHAN Trust does not promise profit, returns, or investment outcomes.
      </p>
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
  const cardReady = isStripeConfigured('premium') || isStripeConfigured('early_supporter');
  return (
    <div className="payment-method-card">
      <span className="status-badge">Card payment via Stripe</span>
      <h3>Card payments</h3>
      <p>Use Stripe Checkout for Premium or Early Supporter access. Payments unlock platform features only.</p>
      {!cardReady && <p className="inline-note">Card payments are not configured yet</p>}
      <div className="payment-action-row">
        <button className="primary-button" type="button" onClick={() => beginCheckout('premium')}>
          Unlock Premium
        </button>
        <button className="secondary-button" type="button" onClick={() => beginCheckout('early_supporter')}>
          Become Early Supporter
        </button>
      </div>
    </div>
  );
}

const VERIFY_STATUS_MESSAGE = {
  idle: 'Waiting for transaction hash',
  not_configured: 'Automatic verification is not configured yet',
  verifying: 'Verifying payment...',
  verified: 'Payment verified',
  failed: 'Payment failed',
  amount_too_low: 'Amount too low',
  wrong_receiver: 'Wrong receiver wallet',
  not_confirmed: 'Transaction not confirmed yet',
};

function CryptoPaymentSection() {
  const [transactionHash, setTransactionHash] = useState('');
  const [copied, setCopied] = useState(false);
  const [plan, setPlan] = useState('premium');
  const [verifyStatus, setVerifyStatus] = useState('idle');
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
      return;
    }
    if (!transactionHash.trim()) {
      setVerifyStatus('idle');
      return;
    }

    trackCryptoVerifyStarted(plan);
    setVerifyStatus('verifying');

    const result = await verifySolanaPayment({ transactionHash, plan });
    setVerifyStatus(result.status);

    if (result.status === 'verified') {
      trackCryptoVerifySuccess(plan);
    } else {
      trackCryptoVerifyFailed(plan, result.status);
    }
  };

  const statusMessage = VERIFY_STATUS_MESSAGE[verifyStatus] || VERIFY_STATUS_MESSAGE.idle;

  return (
    <div className="payment-method-card">
      <span className="status-badge">Crypto payment via USDT/SOL</span>
      <h3>Crypto payments</h3>
      <p>Supported networks: Solana / USDT / SOL. Automatic on-chain verification of your transaction hash.</p>
      <div className="crypto-price-grid">
        <span>Premium: 9 USDT/month</span>
        <span>Early Supporter: 29 USDT one-time</span>
      </div>
      {walletConfigured ? (
        <div className="wallet-copy-box">
          <span>Payment wallet</span>
          <strong>{CRYPTO_PAYMENT_WALLET}</strong>
          <button className="secondary-button" type="button" onClick={copyWallet}>
            <Copy size={17} /> {copied ? 'Copied' : 'Copy wallet address'}
          </button>
        </div>
      ) : (
        <p className="inline-note">Crypto payments are not configured yet</p>
      )}

      {!verificationConfigured && <p className="inline-note">{solanaUnavailableMessage()}</p>}

      <label className="form-field">
        <span>Plan</span>
        <select value={plan} onChange={(event) => setPlan(event.target.value)} disabled={!walletConfigured}>
          <option value="premium">Premium - 9 USDT/month</option>
          <option value="early_supporter">Early Supporter - 29 USDT one-time</option>
        </select>
      </label>

      <label className="form-field transaction-field">
        <span>Transaction hash</span>
        <input
          value={transactionHash}
          onChange={(event) => {
            setTransactionHash(event.target.value);
            setVerifyStatus('idle');
          }}
          placeholder="Paste transaction hash after payment"
          disabled={!walletConfigured}
        />
      </label>

      <button
        className="primary-button"
        type="button"
        onClick={verifyPayment}
        disabled={!walletConfigured || verifyStatus === 'verifying'}
      >
        Verify payment
      </button>

      <p className={verifyStatus === 'verified' ? 'inline-note verify-success' : 'inline-note'}>
        {statusMessage}
      </p>

      {verifyStatus === 'verified' && (
        <p className="inline-note">
          Payment verified. Premium activation will be handled by the team until user accounts are added.
        </p>
      )}

      <p className="inline-note">If automatic verification fails, contact the team with your transaction hash.</p>
    </div>
  );
}

function roadmapClarity(project) {
  if (!project.roadmap?.length) return 'No roadmap proof';
  const completed = project.roadmap.filter((phase) => phase.status === 'Completed').length;
  const inProgress = project.roadmap.filter((phase) => phase.status === 'In progress').length;
  return `${project.roadmap.length} phases, ${completed} completed, ${inProgress} in progress`;
}

function ProjectCard({ project, navigate }) {
  return (
    <article className="project-card">
      <div className="card-top">
        <div>
          <span className="status-badge">{project.status}</span>
          <h3>{project.name}</h3>
          <p>{project.ticker} on {project.chain}</p>
        </div>
        <ScoreCircle score={project.trustScore} />
      </div>
      <p className="card-description">{project.description}</p>
      <div className="card-signal-strip">
        <span>{project.chain}</span>
        <span>{project.ticker}</span>
        <span>{project.communitySize.toLocaleString()} community</span>
      </div>
      <div className="card-meta">
        <RiskPill level={project.riskLevel} />
        <span><Clock3 size={15} /> {project.lastUpdate}</span>
      </div>
      <button className="card-button" onClick={() => navigate(`project/${project.id}`)}>
        Open trust profile <ArrowRight size={17} />
      </button>
    </article>
  );
}

function ProjectProfile({ project, navigate, watched, toggleWatch, onEdit, openMethodology }) {
  const confidence = confidenceScore(project);
  const unlockPremium = async () => {
    const result = await handleUnlockPremiumClick(project);
    if (!result?.ok) alert(result?.message || stripeUnavailableMessage());
  };

  return (
    <section className="profile-page">
      <div className="profile-hero">
        <div>
          <button className="back-button" onClick={() => navigate('explore')}>Explore Projects</button>
          <div className="profile-title-row">
            <h1>{project.name}</h1>
            <span className="ticker-pill">{project.ticker}</span>
          </div>
          <p>{project.description}</p>
          {project.mission && <p className="mission-text">{project.mission}</p>}
          <div className="profile-actions">
            <button className={watched ? 'primary-button watched' : 'primary-button'} onClick={toggleWatch}>
              <Bell size={18} /> {watched ? 'Watching Project' : 'Watch Project'}
            </button>
            <button className="secondary-button" onClick={onEdit}>
              <Plus size={18} /> Edit Project
            </button>
            <button className="secondary-button" onClick={() => handleDownloadPdf(project)}>
              <Download size={18} /> Download PDF Report
            </button>
            <button className="primary-button" onClick={unlockPremium}>
              <Lock size={18} /> Unlock Premium
            </button>
            <button className="secondary-button" onClick={() => alert('Suggestion noted locally for the MVP. In a future version this can open a moderation flow.')}>
              <Flag size={18} /> Report / Suggest Update
            </button>
            <button className="ghost-button" onClick={openMethodology}>
              <Info size={18} /> Methodology
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
          <KhanTokenRole />
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
  const confidence = confidenceScore(project);
  return (
    <section className="detail-section">
      <SectionTitle icon={AlertTriangle} eyebrow="Result" title="Simple Risk Summary" />
      <div className="result-score-row">
        <div>
          <span>Trust Score</span>
          <strong>{project.trustScore}/100</strong>
        </div>
        <div>
          <span>Confidence Score</span>
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
      <SectionTitle icon={MessageCircle} eyebrow="Share" title="Share-ready Result" />
      <div className="share-grid">
        {[
          ['x', 'X/Twitter', shareText(project, 'x')],
          ['telegram', 'Telegram', shareText(project, 'telegram')],
        ].map(([channel, label, text]) => (
          <div className="share-card" key={channel}>
            <span>{label}</span>
            <p>{text}</p>
            <button className="secondary-button" type="button" onClick={() => copy(channel)}>
              <Copy size={17} /> {copied === channel ? 'Copied' : 'Copy text'}
            </button>
          </div>
        ))}
      </div>
      {copied === 'error' && <p className="inline-note">Copy is not available in this browser. Select the text manually.</p>}
    </section>
  );
}

function KhanTokenRole() {
  return (
    <section className="detail-section khan-token-role">
      <SectionTitle icon={Star} eyebrow="Ecosystem" title="KHAN Token Role" />
      <p>
        KHAN is planned as the community/utility token of the KHAN Trust ecosystem. Future utility may include premium
        analysis, early access, community features and holder-based benefits. No profit or investment promise.
      </p>
    </section>
  );
}

function InfoGrid({ project }) {
  const rows = resolvedMetadataRows(project);
  return (
    <section className="detail-section">
      <SectionTitle icon={Shield} eyebrow="Profile" title="Project Information" />
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
    return value.state;
  }
  return <ClickableLink href={value} fallback={value || 'Not provided'} network={network} />;
}

function ClickableLink({ href, fallback = 'Not provided', network }) {
  if (!hasValue(href)) return fallback;
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
  const labels = {
    founderActivity: 'Founder activity',
    communityActivity: 'Community activity',
    roadmapClarity: 'Roadmap clarity',
    transparency: 'Transparency',
    tokenRisk: 'Token risk',
    socialProof: 'Social proof',
    marketCapScore: 'Market Cap Score',
    liquidityScore: 'Liquidity Score',
    holderScore: 'Holder Score',
    topHolderScore: 'Top Holder Score',
    topTenHolderScore: 'Top 10 Holder Score',
    tokenAgeScore: 'Token Age Score',
    websiteScore: 'Website Presence',
    twitterScore: 'X/Twitter Presence',
    telegramScore: 'Telegram Presence',
    socialScore: 'Social Score',
    holderGrowthScore: 'Holder Growth Score',
    supplyScore: 'Supply Score',
    finalTrustScore: 'Final Trust Score',
  };
  return (
    <section className="detail-section">
      <SectionTitle icon={LineChart} eyebrow="Score" title="Trust Score Breakdown" />
      <div className="breakdown-list">
        {Object.entries(project.scoreBreakdown).map(([key, value]) => (
          <div className="score-row" key={key}>
            <span>{labels[key]}</span>
            <div className="score-bar"><i style={{ width: `${value || 0}%` }} /></div>
            <strong>{value === null ? 'Not available' : value}</strong>
          </div>
        ))}
      </div>
      {project.scoreBreakdown.socialScore === null && (
        <p className="inline-note">No public socials found</p>
      )}
    </section>
  );
}

function RiskFlags({ flags }) {
  return (
    <section className="detail-section">
      <SectionTitle icon={FileWarning} eyebrow="Risk" title="Risk Flags" />
      <div className="flag-grid">
        {flags.map((flag) => (
          <span key={flag} className="warning-badge"><AlertTriangle size={15} /> {flag}</span>
        ))}
      </div>
    </section>
  );
}

function Timeline({ items }) {
  return (
    <section className="detail-section">
      <SectionTitle icon={History} eyebrow="Project Updates" title="Updates Timeline" />
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
  const stats = [
    ['Holder count', project.holders.toLocaleString(), WalletCards],
    ['Top holder', project.realData ? formatPercent(project.realData.topHolderPercent) : 'Not connected', Shield],
    ['Liquidity', project.realData ? formatCurrency(project.realData.totalLiquidityUsd ?? project.realData.liquidityUsd) : 'Not connected', BarChart3],
    ['Market cap', project.realData ? formatCurrency(project.realData.marketCapUsd) : 'Not connected', LineChart],
    ['Token age', project.realData ? formatAge(project.realData.tokenAgeDays) : 'Not connected', CalendarDays],
    ['Trust score', `${project.trustScore}/100`, BadgeCheck],
    ['Last update date', project.lastUpdate, Clock3],
  ];
  return (
    <section className="detail-section sticky-panel">
      <SectionTitle icon={Users} eyebrow="Proof" title="Community Proof" />
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
  const rows = [
    ['Holder Count', `${formatNumber(data.holderCount)} (${data.holderSource})`, Users],
    ['Largest Holder %', formatPercent(data.topHolderPercent), WalletCards],
    ['Top 10 Holders %', formatPercent(data.topTenHolderPercent), Shield],
    ['Holder Risk Level', holderRiskLevel(data), AlertTriangle],
    ['Concentration Status', holderConcentrationStatus(data), FileWarning],
    ['Liquidity USD', formatCurrency(data.totalLiquidityUsd ?? data.liquidityUsd), BarChart3],
    ['Market Cap USD', formatCurrency(data.marketCapUsd), LineChart],
    ['Token Age', formatAge(data.tokenAgeDays), CalendarDays],
    ['Trust Score', `${project.trustScore}/100`, BadgeCheck],
    ['Website', socialPresenceState('website', project, data), Globe2],
    ['X/Twitter', socialPresenceState('twitter', project, data), ExternalLink],
    ['Telegram', socialPresenceState('telegram', project, data), MessageCircle],
    ['Supply', data.supply ? formatNumber(data.supply) : 'Not available', WalletCards],
    ['Holder Growth', data.holderGrowthPercent === null ? 'Needs a second lookup' : formatPercent(data.holderGrowthPercent), TrendingUp],
    ['Pools Found', formatNumber(data.poolCount), Layers3],
    ['Data source', data.source, BadgeCheck],
  ];

  return (
    <section className="detail-section">
      <SectionTitle icon={Activity} eyebrow="Live Data" title="Solana Token Data" />
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
          View market pair <ExternalLink size={16} />
        </a>
      )}
    </section>
  );
}

function RealDataPreview({ data }) {
  return (
    <div className="real-data-preview wide">
      <strong>Live Solana data connected</strong>
      <span>Liquidity: {formatCurrency(data.liquidityUsd)}</span>
      <span>Market cap: {formatCurrency(data.marketCapUsd)}</span>
      <span>Token age: {formatAge(data.tokenAgeDays)}</span>
      <span>Holder signal: {formatNumber(data.holderCount)} via {data.holderSource}</span>
    </div>
  );
}

function Roadmap({ phases }) {
  return (
    <section className="detail-section">
      <SectionTitle icon={Target} eyebrow="Roadmap" title="Roadmap Proof" />
      <div className="roadmap-list">
        {phases.map((phase) => (
          <div className="roadmap-item" key={phase.phase}>
            <span className={`roadmap-status ${phase.status.toLowerCase().replaceAll(' ', '-')}`}>{phase.status}</span>
            <strong>{phase.phase}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function AddProjectPage({ onAdd }) {
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
    setLookupState({ status: 'loading', message: 'Looking up Solana token data...' });
    try {
      const data = await lookupSolanaToken(form.contract);
      setForm((current) => ({
        ...current,
        ...data,
        name: data.name || current.name,
        ticker: data.ticker || current.ticker,
        description: current.description || data.description,
      }));
      setLookupState({ status: 'success', message: 'Live Solana data added to this profile.' });
    } catch (error) {
      setLookupState({ status: 'error', message: error.message || 'Token lookup failed.' });
    }
  };
  const submit = (event) => {
    event.preventDefault();
    if (!form.realData) {
      setLookupState({ status: 'error', message: 'Run Solana token lookup before saving. KHAN Trust only saves real live-token profiles.' });
      return;
    }
    onAdd(form);
  };

  return (
    <section className="page-section">
      <SectionTitle icon={Plus} eyebrow="Submit" title="Add a crypto project" />
      <form className="add-form" onSubmit={submit}>
        <FormField label="Project name" value={form.name} onChange={(value) => update('name', value)} required />
        <FormField label="Ticker" value={form.ticker} onChange={(value) => update('ticker', value)} required />
        <label className="form-field">
          <span>Chain</span>
          <select value={form.chain} onChange={(event) => update('chain', event.target.value)}>
            <option>Solana</option>
            <option>Ethereum</option>
            <option>BSC</option>
            <option>Base</option>
            <option>Other</option>
          </select>
        </label>
        <FormField label="Contract address" value={form.contract} onChange={(value) => update('contract', value)} />
        <div className="lookup-panel">
          <button className="secondary-button" type="button" onClick={lookupToken} disabled={lookupState.status === 'loading'}>
            <Search size={18} /> {lookupState.status === 'loading' ? 'Looking up...' : 'Lookup Solana Token'}
          </button>
          <p className={lookupState.status === 'error' ? 'lookup-message error' : 'lookup-message'}>
            {lookupState.message || 'Fetches public liquidity, market cap, token age, supply, and holder signals.'}
          </p>
        </div>
        <FormField label="Website" value={form.website} onChange={(value) => update('website', value)} />
        <FormField label="X/Twitter" value={form.twitter} onChange={(value) => update('twitter', value)} />
        <FormField label="Telegram" value={form.telegram} onChange={(value) => update('telegram', value)} />
        <FormField label="GitHub" value={form.github} onChange={(value) => update('github', value)} />
        <FormField type="date" label="Launch date" value={form.launchDate} onChange={(value) => update('launchDate', value)} />
        <FormField label="Founder status" value={form.founderStatus} onChange={(value) => update('founderStatus', value)} placeholder="Public founder, anonymous team, doxxed team..." />
        <FormField type="number" label="Community size" value={form.communitySize} onChange={(value) => update('communitySize', value)} />
        <FormField type="number" label="Holder count" value={form.holderCount} onChange={(value) => update('holderCount', value)} />
        {form.realData && <RealDataPreview data={form.realData} />}
        <label className="form-field wide">
          <span>Description</span>
          <textarea value={form.description} onChange={(event) => update('description', event.target.value)} required />
        </label>
        <label className="form-field wide">
          <span>Roadmap text</span>
          <textarea value={form.roadmapText} onChange={(event) => update('roadmapText', event.target.value)} placeholder="One phase per line" />
        </label>
        <label className="form-field wide">
          <span>Risk notes</span>
          <textarea value={form.riskNotes} onChange={(event) => update('riskNotes', event.target.value)} />
        </label>
        <button className="primary-button wide-button" type="submit">
          Save Project <ArrowRight size={18} />
        </button>
      </form>
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

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Edit Project">
      <form className="modal-panel edit-modal" onSubmit={submit}>
        <button className="close-button" type="button" onClick={onClose} aria-label="Close edit project"><X size={20} /></button>
        <SectionTitle icon={Plus} eyebrow="Edit" title={`Update ${project.name}`} />
        <div className="add-form">
          <FormField label="Website" value={form.website} onChange={(value) => update('website', value)} />
          <FormField label="X/Twitter" value={form.twitter} onChange={(value) => update('twitter', value)} />
          <FormField label="Telegram" value={form.telegram} onChange={(value) => update('telegram', value)} />
          <FormField label="GitHub" value={form.github} onChange={(value) => update('github', value)} />
          <FormField label="Founder status" value={form.founderStatus} onChange={(value) => update('founderStatus', value)} placeholder="Public founder, anonymous founder, known team..." />
          <FormField type="number" label="Community size" value={form.communitySize} onChange={(value) => update('communitySize', value)} />
          <label className="form-field wide">
            <span>Description</span>
            <textarea value={form.description} onChange={(event) => update('description', event.target.value)} />
          </label>
          <label className="form-field wide">
            <span>Roadmap</span>
            <textarea value={form.roadmapText} onChange={(event) => update('roadmapText', event.target.value)} placeholder="One phase per line" />
          </label>
          <label className="form-field wide">
            <span>Risk notes</span>
            <textarea value={form.riskNotes} onChange={(event) => update('riskNotes', event.target.value)} />
          </label>
          <button className="primary-button wide-button" type="submit">
            Save Updates <ArrowRight size={18} />
          </button>
        </div>
      </form>
    </div>
  );
}

function AboutPage({ openMethodology }) {
  return (
    <section className="page-section about-page">
      <SectionTitle icon={Shield} eyebrow="About" title="Why KHAN Trust exists" />
      <div className="about-grid">
        <div className="about-panel">
          <h3>The problem</h3>
          <p>Crypto is full of hype, fake promises, anonymous teams, abandoned projects, and weak transparency.</p>
        </div>
        <div className="about-panel">
          <h3>The solution</h3>
          <p>KHAN Trust gives every crypto project a public trust profile with activity, community proof, roadmap proof, and risk signals.</p>
        </div>
      </div>
      <div className="positioning">
        <p><strong>CoinMarketCap</strong> shows prices.</p>
        <p><strong>GitHub</strong> shows developer activity.</p>
        <p><strong>Trustpilot</strong> shows reputation.</p>
        <p><strong>KHAN Trust</strong> shows crypto project trust signals.</p>
      </div>
      <button className="primary-button" onClick={openMethodology}>
        View Trust Score Methodology <Info size={18} />
      </button>
      <Disclaimer />
    </section>
  );
}

function MethodologyModal({ onClose }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Trust Score Methodology">
      <div className="modal-panel">
        <button className="close-button" onClick={onClose} aria-label="Close methodology"><X size={20} /></button>
        <SectionTitle icon={Sparkles} eyebrow="Methodology" title="Trust Score Methodology" />
        <p>
          KHAN Trust scores are informational signals from 0 to 100. Submitted projects earn points for website,
          X/Twitter, Telegram, GitHub, public founder status, roadmap proof, and community size. Risk notes reduce
          the score when they mention anonymous teams, low liquidity, no roadmap, low holders, or a very new project.
          The score is not a buy or sell signal.
        </p>
        <div className="method-grid">
          {['Website +10', 'X/Twitter +10', 'Telegram +10', 'GitHub +15', 'Public founder +15', 'Roadmap +10', 'Community up to +15', 'Risk notes subtract'].map((item) => (
            <div key={item}>
              <CheckCircle2 size={18} />
              <strong>{item}</strong>
              <span>Reviewed as a visible trust signal.</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SearchBox({ value, onChange, onSubmit, loading = false }) {
  return (
    <form className="search-box" onSubmit={(event) => { event.preventDefault(); onSubmit?.(); }}>
      <Search size={20} />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search coin, token, project, chain, or contract address"
      />
      <button type="submit" disabled={loading}>{loading ? 'Fetching...' : 'Search'}</button>
    </form>
  );
}

function SearchStatus({ state }) {
  if (!state.message) return null;
  return <p className={`search-status ${state.status}`}>{state.message}</p>;
}

function ScoreCircle({ score, size = 'normal' }) {
  const style = { '--score': `${score * 3.6}deg` };
  return (
    <div className={`score-circle ${size}`} style={style}>
      <span>{score}</span>
      <small>Trust</small>
    </div>
  );
}

function RiskPill({ level }) {
  return <span className={`risk-pill ${level.toLowerCase()}`}>{level} Risk</span>;
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

function Disclaimer({ compact = false }) {
  return (
    <section className={compact ? 'disclaimer compact' : 'disclaimer'}>
      <AlertTriangle size={18} />
      <p>KHAN Trust does not provide financial advice. Scores are for research and risk awareness only.</p>
    </section>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <strong>KHAN Trust</strong>
      <span>Trust before hype.</span>
    </footer>
  );
}

createRoot(document.getElementById('root')).render(<App />);
