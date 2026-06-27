// Must run before any @solana/web3.js or @solana/spl-token code executes -
// they reference the Node "Buffer" global at runtime (not just module
// scope), and Vite's optimizeDeps inject only covers dev-time dependency
// pre-bundling, not the production rollup build, so the production bundle
// never got this without an explicit import here.
import './bufferShim.js';
import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  Archive,
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Bell,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
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
  Inbox,
  Info,
  Layers3,
  LifeBuoy,
  LineChart,
  Maximize2,
  ListFilter,
  Lock,
  Mail,
  MessageCircle,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Scale,
  Send,
  Shield,
  Sparkles,
  Star,
  Target,
  TimerReset,
  TrendingDown,
  TrendingUp,
  Trash2,
  UserPlus,
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
import { isWalletPaymentConfigured, payWithConnectedWallet } from './cryptoPayment.js';
import { fetchEntitlement, hasPlanAccess, isEarlySupporter } from './entitlements.js';
import { fetchUserData, saveReport, removeSavedReport, toggleServerWatch } from './userData.js';
import {
  TICKET_CATEGORIES,
  TICKET_STATUSES,
  TICKET_PRIORITIES,
  MAX_ATTACHMENTS,
  fileToAttachment,
  submitSupportTicket,
  fetchMyTickets,
  fetchSupportTickets,
  fetchSupportTicket,
  replyToTicket,
  setTicketStatus,
  setTicketPriority,
  assignTicket,
  setTicketNotes,
  archiveTicket,
  unarchiveTicket,
  deleteTicket,
} from './support.js';
import {
  REPORT_CATEGORIES,
  REPORT_STATUSES,
  MAX_ATTACHMENTS as MAX_REPORT_ATTACHMENTS,
  fileToAttachment as reportFileToAttachment,
  submitReport,
  fetchReports,
  fetchReportDetail,
  setReportStatus,
  setReportNotes,
  deleteReport,
} from './report.js';
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
const WALLET_DOWNLOAD_URLS = { Phantom: 'https://phantom.com/download', Solflare: 'https://solflare.com/download' };
const OFFICIAL_KHAN_LINKS = {
  website: 'https://khantrust.net',
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
// The public RPC is heavily rate-limited and frequently rejects requests
// from browser-origin traffic. Setting VITE_SOLANA_RPC_URL to a dedicated
// provider (Helius, QuickNode, Alchemy, ...) makes holder counts, mint
// authority checks, and mint-creation lookups dramatically more reliable.
const SOLANA_RPC_URL = import.meta.env?.VITE_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const SOLANA_DEVNET_RPC_URL = clusterApiUrl('devnet');
const DEXSCREENER_TOKEN_PAIRS_BASE_URL = 'https://api.dexscreener.com/token-pairs/v1';
const DEXSCREENER_SEARCH_URL = 'https://api.dexscreener.com/latest/dex/search';
const JUPITER_TOKEN_SEARCH_URL = 'https://lite-api.jup.ag/tokens/v2/search';
// Free, no-key public APIs used to widen coverage beyond Dexscreener/Jupiter:
// CoinGecko's contract lookup gives an authoritative circulating market cap,
// a real genesis_date for established assets, and curated social links.
// GeckoTerminal fills in pool/liquidity data for chains or pairs Dexscreener
// hasn't indexed yet. Both are read-only public endpoints with no API key.
const COINGECKO_API_BASE = 'https://api.coingecko.com/api/v3';
const GECKOTERMINAL_API_BASE = 'https://api.geckoterminal.com/api/v2';
const CHAIN_LABELS = {
  solana: 'Solana',
  ethereum: 'Ethereum',
  bsc: 'BSC',
  base: 'Base',
  arbitrum: 'Arbitrum',
  polygon: 'Polygon',
  avalanche: 'Avalanche',
  optimism: 'Optimism',
  sui: 'Sui',
};

const CHAIN_TO_COINGECKO_PLATFORM = {
  solana: 'solana',
  ethereum: 'ethereum',
  bsc: 'binance-smart-chain',
  base: 'base',
  arbitrum: 'arbitrum-one',
  polygon: 'polygon-pos',
  avalanche: 'avalanche',
  optimism: 'optimistic-ethereum',
};

const CHAIN_TO_GECKOTERMINAL_NETWORK = {
  solana: 'solana',
  ethereum: 'eth',
  bsc: 'bsc',
  base: 'base',
  arbitrum: 'arbitrum',
  polygon: 'polygon_pos',
  avalanche: 'avax',
  optimism: 'optimism',
  sui: 'sui',
};

const COINGECKO_PLATFORM_TO_CHAIN = Object.fromEntries(
  Object.entries(CHAIN_TO_COINGECKO_PLATFORM).map(([chainId, platform]) => [platform, chainId])
);

// Native chain coins (BTC, ETH, BNB, SOL, ...) have no on-chain contract of
// their own - they can only be resolved through CoinGecko's coin id, never
// through a token-pairs/contract lookup. Keyed by the ticker users actually
// type, mapped to the CoinGecko coin id used for /coins/{id}.
const NATIVE_ASSET_COINGECKO_IDS = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  BNB: 'binancecoin',
  SOL: 'solana',
  SUI: 'sui',
  DOGE: 'dogecoin',
  LTC: 'litecoin',
  XRP: 'ripple',
  AVAX: 'avalanche-2',
  MATIC: 'matic-network',
  TRX: 'tron',
  ADA: 'cardano',
  DOT: 'polkadot',
};

// Block-explorer "contract creation timestamp" + "is proxy/upgradeable"
// lookups. These need a free API key per chain (Etherscan/BscScan/
// BaseScan/PolygonScan all offer one at no cost) - set the matching env var
// to enable real EVM token age and upgradeable-contract detection. Without
// a key the chain simply falls back to "Unknown" rather than guessing.
const EXPLORER_CONFIG = {
  ethereum: { base: 'https://api.etherscan.io/api', envKey: 'VITE_ETHERSCAN_API_KEY' },
  bsc: { base: 'https://api.bscscan.com/api', envKey: 'VITE_BSCSCAN_API_KEY' },
  base: { base: 'https://api.basescan.org/api', envKey: 'VITE_BASESCAN_API_KEY' },
  polygon: { base: 'https://api.polygonscan.com/api', envKey: 'VITE_POLYGONSCAN_API_KEY' },
};

function explorerApiKeyFor(chainId) {
  const envKey = EXPLORER_CONFIG[chainId]?.envKey;
  return envKey ? import.meta.env?.[envKey] : '';
}

function chainLabelFor(chainId) {
  return CHAIN_LABELS[chainId] || (chainId ? chainId.charAt(0).toUpperCase() + chainId.slice(1) : 'Unknown');
}

// Official $KHAN mint. Dexscreener's general search index doesn't always
// pick up new tokens right away, so exact KHAN/GKHAN searches are resolved
// to this address directly instead of depending on third-party indexing.
const OFFICIAL_KHAN_CONTRACT = '6bSHkoMYqzyCZdWPQ45nUv73dvdfx4yEd4yEemefpump';
const OFFICIAL_KHAN_EXACT_TERMS = ['khan', 'gkhan', '$khan'];
const OFFICIAL_KHAN_MATCH = {
  address: OFFICIAL_KHAN_CONTRACT,
  chainId: 'solana',
  chain: 'Solana',
  name: 'KHAN',
  symbol: 'KHAN',
  marketCap: 0,
  logoUrl: '',
  verified: true,
  isOfficial: true,
};

function normalizeSearchTerm(term) {
  return term.trim().toLowerCase().replace(/^\$/, '');
}

function isExactOfficialKhanQuery(term) {
  return OFFICIAL_KHAN_EXACT_TERMS.includes(normalizeSearchTerm(term));
}

function mentionsKhan(term) {
  return normalizeSearchTerm(term).includes('khan');
}

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
  { id: 'support', label: 'Support', icon: LifeBuoy },
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
  const score = calculateTrustScore(authoritativeProject, rawRealData);
  const breakdown = buildScoreBreakdown(authoritativeProject, authoritativeHolders, authoritativeCommunitySize, score);

  return {
    ...scoringProject,
    trustScore: score,
    riskLevel: scoreToRisk(score),
    scoreBreakdown: breakdown,
    categoryBreakdown: buildCategoryBreakdown(breakdown),
    scamRisk: calculateScamRisk(authoritativeProject, rawRealData || {}),
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
      githubScore: liveScores.githubScore,
      coingeckoScore: liveScores.coingeckoScore,
      socialScore: liveScores.socialScore,
      holderGrowthScore: liveScores.holderGrowthScore,
      supplyScore: liveScores.supplyScore,
      securityScore: liveScores.securityScore,
      marketActivityScore: liveScores.marketActivityScore,
      finalTrustScore: liveScores.finalTrustScore,
    };
  }

  return calculateManualScores(project);
}

// Groups the existing fine-grained scores into the 5 named categories a
// research-platform-style breakdown shows (Contract Security, Liquidity,
// Holder Health, Market Activity, Community). This is purely a display
// aggregation over scores that calculateLiveScores already computed -
// it does not change finalTrustScore or any individual score's math.
const TRUST_CATEGORIES = [
  { key: 'contractSecurity', labelKey: 'contractSecurity', scoreKeys: ['securityScore'] },
  { key: 'liquidity', labelKey: 'liquidity', scoreKeys: ['liquidityScore', 'marketCapScore'] },
  { key: 'holderHealth', labelKey: 'holderHealth', scoreKeys: ['holderScore', 'topHolderScore', 'topTenHolderScore', 'holderGrowthScore'] },
  { key: 'marketActivity', labelKey: 'marketActivity', scoreKeys: ['marketActivityScore', 'tokenAgeScore'] },
  { key: 'community', labelKey: 'community', scoreKeys: ['websiteScore', 'twitterScore', 'telegramScore', 'githubScore', 'coingeckoScore', 'founderActivity', 'roadmapClarity', 'transparency'] },
];

function buildCategoryBreakdown(scoreBreakdown = {}) {
  return TRUST_CATEGORIES.map((category) => {
    const values = category.scoreKeys
      .map((key) => scoreBreakdown[key])
      .filter((value) => value !== null && value !== undefined);
    const score = values.length ? Math.round(values.reduce((total, value) => total + value, 0) / values.length) : null;
    return {
      key: category.key,
      labelKey: category.labelKey,
      score,
      // /20 scale to match the "Contract Security 18/20" style breakdown -
      // purely a display rescale of the same 0-100 average, not a new score.
      outOf20: score === null ? null : Math.round(score / 5),
      available: values.length > 0,
    };
  });
}

// Rule-based scam-risk signal built only from real, already-fetched data
// (holder concentration, liquidity, social presence, mint/freeze/upgrade
// flags, token age). Never penalizes a category that is simply unknown -
// only confirmed-true findings add risk points, consistent with the rest
// of the engine's "Unknown != Bad" policy. Deeper checks this can't cover
// without a specialized API (honeypot simulation, LP lock/burn, clone-site
// detection) are intentionally left out rather than guessed - see
// SCAM_RISK_COVERAGE_NOTE below for what's not covered.
function calculateScamRisk(project = {}, data = {}) {
  const reasons = [];
  let riskPoints = 0;

  const addRisk = (points, reason) => {
    riskPoints += points;
    reasons.push(reason);
  };

  if (typeof data.topHolderPercent === 'number' && data.topHolderPercent > 50) {
    addRisk(25, `Largest holder controls ${formatPercent(data.topHolderPercent)} of supply`);
  }
  if (typeof data.topTenHolderPercent === 'number' && data.topTenHolderPercent > 80) {
    addRisk(20, `Top 10 holders control ${formatPercent(data.topTenHolderPercent)} of supply`);
  }

  const liquidity = Number(data.totalLiquidityUsd ?? data.liquidityUsd ?? 0);
  if (data.socialMetadataAvailable && !liquidity) {
    addRisk(15, 'No public liquidity was found for this token');
  } else if (liquidity > 0 && liquidity < 2000) {
    addRisk(15, 'Liquidity is extremely low (under $2,000)');
  }

  const noSocial = !hasValue(project.website) && !hasValue(project.twitter) && !hasValue(project.telegram);
  if (noSocial && data.socialMetadataAvailable) {
    addRisk(15, 'No website, X/Twitter, or Telegram presence found');
  }

  if (data.mintAuthorityEnabled === true) addRisk(10, 'Mint authority is still enabled');
  if (data.freezeAuthorityEnabled === true) addRisk(10, 'Freeze authority is still enabled');
  if (data.upgradeable === true) addRisk(10, 'Contract is upgradeable');

  if (typeof data.tokenAgeDays === 'number' && data.tokenAgeDays < 3) {
    addRisk(10, 'Token is less than 3 days old');
  }

  const riskScore = clamp(riskPoints, 0, 100);
  const level = riskScore >= 50 ? 'High' : riskScore >= 25 ? 'Medium' : 'Low';
  return { riskScore, level, reasons };
}

// Deliberately NOT implemented (would require fabricating data or a paid
// specialized API rather than reading real on-chain/market data):
// honeypot/transfer-restriction simulation, LP lock/burn status, fake
// website or clone-branding detection. These would need GoPlus Security,
// RugCheck, or TokenSniffer-style integrations - documented here rather
// than guessed.
const SCAM_RISK_COVERAGE_NOTE = 'Concentration, liquidity, social presence, mint/freeze/upgrade authority, and token age only.';

function calculateLiveScores(project = {}, data = {}) {
  const holderCount = Number(data.holderCount || project.holders || project.communitySize || 0);
  const websiteScore = scorePresence(socialPresenceState('website', project, data));
  const twitterScore = scorePresence(socialPresenceState('twitter', project, data));
  const telegramScore = scorePresence(socialPresenceState('telegram', project, data));
  const githubScore = scorePresence(socialPresenceState('github', project, data));
  // Listing on a major independent research platform (CoinGecko) is a real,
  // checkable signal of project legitimacy - only awarded when actually
  // confirmed listed, never assumed.
  const coingeckoScore = data.coingeckoListed ? 85 : null;
  const founderScore = scoreFounder(project.founderStatus);
  const roadmapScore = hasRoadmap(project) ? 68 : null;
  const communityScoreValue = scoreHolders(project.communitySize);
  const descriptionScore = hasValue(project.description) ? 58 : null;
  const socialScoreInputs = [websiteScore, twitterScore, telegramScore, githubScore].filter((value) => value !== null && value !== undefined);
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
    githubScore,
    coingeckoScore,
    socialScore: socialScoreInputs.length ? Math.round(socialScoreInputs.reduce((total, value) => total + value, 0) / socialScoreInputs.length) : null,
    founderActivity: founderScore,
    roadmapClarity: roadmapScore,
    communityActivity: communityScoreValue,
    transparency: descriptionScore,
    holderGrowthScore: scoreHolderGrowth(data.holderGrowthPercent),
    supplyScore: scoreSupply(data.supply),
    securityScore: scoreSecurity(data.mintAuthorityEnabled, data.freezeAuthorityEnabled, data.upgradeable),
    marketActivityScore: scoreMarketActivity(data.volume24hUsd, data.totalLiquidityUsd ?? data.liquidityUsd),
  };
  const weighted = weightedAverage([
    [scores.holderScore, 16],
    [scores.topHolderScore, 18],
    [scores.topTenHolderScore, 14],
    [scores.tokenAgeScore, 10],
    [scores.liquidityScore, 16],
    [scores.marketCapScore, 6],
    [scores.securityScore, 8],
    [scores.marketActivityScore, 6],
    [scores.websiteScore, 6],
    [scores.twitterScore, 6],
    [scores.telegramScore, 5],
    [scores.githubScore, 3],
    [scores.coingeckoScore, 4],
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
  // A large, CoinGecko-verified asset should never read as "high risk" just
  // because one source (e.g. a DEX liquidity pool, an on-chain holder scan)
  // didn't return data for it - confidence floor, not a fabricated score.
  const verifiedFloor = isLargeVerifiedAsset(data) ? 70 : 0;
  const finalTrustScore = clamp(Math.max(5, verifiedFloor, weighted - penalty), 5, 100);
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

function scoreSecurity(mintAuthorityEnabled, freezeAuthorityEnabled, upgradeable) {
  const flags = [mintAuthorityEnabled, freezeAuthorityEnabled, upgradeable];
  if (flags.every((value) => value === null || value === undefined)) return null;
  const enabledCount = flags.filter((value) => value === true).length;
  if (enabledCount === 0) return 92;
  if (enabledCount === 1) return 52;
  return 18;
}

function scoreSupply(value) {
  const supply = Number(value || 0);
  if (!supply) return null;
  if (supply <= 1000000000) return 72;
  if (supply <= 10000000000) return 62;
  if (supply <= 100000000000) return 50;
  return 38;
}

// Real trading activity, not just a liquidity snapshot - a token can have a
// deep pool that nobody is actually trading against. Scored relative to its
// own liquidity (turnover) when both are known, falling back to absolute
// volume only when liquidity is unavailable (e.g. a native asset).
function scoreMarketActivity(volume24hUsd, liquidityUsd) {
  if (volume24hUsd === null || volume24hUsd === undefined) return null;
  if (!volume24hUsd) return 15;
  if (!liquidityUsd) {
    if (volume24hUsd >= 1000000) return 85;
    if (volume24hUsd >= 100000) return 65;
    if (volume24hUsd >= 10000) return 45;
    return 25;
  }
  const turnover = volume24hUsd / liquidityUsd;
  if (turnover >= 0.5 && volume24hUsd >= 10000) return 88;
  if (turnover >= 0.1 && volume24hUsd >= 1000) return 68;
  return 40;
}

// Large, CoinGecko-verified assets (BTC, ETH, USDC, ...) routinely have no
// "liquidity pool" or "holder count" concept the way a DEX-traded token
// does - missing that data is not a risk signal for them. The flat "missing
// data" penalties below only apply to unverified/lower-cap tokens, where an
// absent metric is itself a real transparency gap worth flagging.
function isLargeVerifiedAsset(data = {}) {
  return Boolean(data.coingeckoListed) && Number(data.marketCapUsd || 0) >= 50000000;
}

function liveDataPenalty(data = {}, holderCount = 0) {
  let penalty = 0;
  const liquidity = Number(data.totalLiquidityUsd ?? data.liquidityUsd ?? 0);
  const skipMissingDataPenalty = isLargeVerifiedAsset(data);
  if (!liquidity && !skipMissingDataPenalty) penalty += 4;
  if (liquidity > 0 && liquidity < 5000) penalty += 12;
  if (holderCount > 0 && holderCount < 100) penalty += 10;
  if (!holderCount && !skipMissingDataPenalty) penalty += 3;
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
    ['mint authority enabled', 10],
    ['freeze authority enabled', 10],
    ['upgradeable contract', 8],
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
    discord: firstPresent(links.discord, item.discord, item.discordUrl),
    github: firstPresent(links.github, item.github, item.githubUrl),
  }), {});
}

function socialPresenceState(kind, project = {}, data = {}) {
  const fieldMap = {
    website: ['website', 'websiteUrl'],
    twitter: ['twitter', 'twitterUrl', 'xUrl'],
    telegram: ['telegram', 'telegramUrl'],
    github: ['github', 'githubUrl'],
    discord: ['discord', 'discordUrl'],
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

// Short-lived in-memory cache for live lookups. A single scan already fans
// out to ~8 APIs in parallel; without this, re-opening the same token (back
// button, the same address appearing in a multi-chain search list, a quick
// re-scan) repeats every one of those calls. 45s is long enough to absorb
// that kind of immediate re-navigation without serving meaningfully stale
// price/liquidity data. Resets on page reload (module-level, not persisted).
const LOOKUP_CACHE_TTL_MS = 45_000;
const lookupCache = new Map();

async function withLookupCache(cacheKey, fetcher) {
  const cached = lookupCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < LOOKUP_CACHE_TTL_MS) {
    return cached.value;
  }
  const value = await fetcher();
  lookupCache.set(cacheKey, { value, fetchedAt: Date.now() });
  return value;
}

async function lookupSolanaToken(contractAddress) {
  const address = contractAddress.trim();
  if (!address) throw new Error('Enter a Solana contract address first.');
  return withLookupCache(`solana:${address.toLowerCase()}`, () => lookupSolanaTokenUncached(address));
}

async function lookupSolanaTokenUncached(address) {
  const [dexData, rpcData, holderAnalyticsData, jupiterData, mintInfoData, mintCreationData, coingeckoData, geckoTerminalData] = await Promise.allSettled([
    fetchDexscreenerToken(address),
    fetchSolanaRpcToken(address),
    fetchSolanaHolderAnalytics(address),
    fetchJupiterTokenData(address),
    fetchMintAccountInfo(address),
    fetchMintCreationTimestamp(address),
    fetchCoinGeckoTokenData('solana', address),
    fetchGeckoTerminalToken('solana', address),
  ]);

  const dex = dexData.status === 'fulfilled' ? dexData.value : null;
  const rpc = rpcData.status === 'fulfilled' ? rpcData.value : null;
  const holderAnalytics = holderAnalyticsData.status === 'fulfilled' ? holderAnalyticsData.value : null;
  const jupiter = jupiterData.status === 'fulfilled' ? jupiterData.value : null;
  const mintInfo = mintInfoData.status === 'fulfilled' ? mintInfoData.value : null;
  const mintCreatedAt = mintCreationData.status === 'fulfilled' ? mintCreationData.value : null;
  const coingecko = coingeckoData.status === 'fulfilled' ? coingeckoData.value : null;
  const geckoTerminal = geckoTerminalData.status === 'fulfilled' ? geckoTerminalData.value : null;

  if (!dex?.primaryPair && !rpc && !jupiter && !coingecko && !geckoTerminal) {
    throw new Error('No public Solana token data was found for this address.');
  }

  const token = getDexTokenForAddress(dex?.primaryPair, address);
  const info = dex?.primaryPair?.info || {};
  const socialLinks = mergeSocialLinks(
    extractSocialLinksFromDexInfo(info),
    jupiter?.socialLinks,
    extractSocialLinksFromMetadata(dex?.primaryPair),
    extractSocialLinksFromMetadata(jupiter?.rawToken),
    { website: coingecko?.website, twitter: coingecko?.twitter, telegram: coingecko?.telegram, discord: coingecko?.discord, github: coingecko?.github }
  );
  const website = socialLinks.website || '';
  const twitter = socialLinks.twitter || '';
  const telegram = socialLinks.telegram || '';
  const github = socialLinks.github || '';
  const discord = socialLinks.discord || '';
  const socialMetadataAvailable = Boolean(dex?.primaryPair || jupiter || coingecko);
  // Real asset age priority: CoinGecko's genesis_date (authoritative for
  // listed assets, no RPC dependency) first, then the mint's own genesis
  // transaction on-chain. A DEX pair's first-liquidity date is never used -
  // if neither real source resolves, age is unknown, not estimated.
  const createdAt = coingecko?.genesisDate ? new Date(coingecko.genesisDate).getTime() : mintCreatedAt;
  const tokenAgeSource = coingecko?.genesisDate ? 'CoinGecko genesis date' : (mintCreatedAt ? 'Solana mint genesis transaction' : null);
  const tokenAgeDays = createdAt ? daysSince(createdAt) : null;
  // Real indexed/on-chain holder counts only. getTokenLargestAccounts (rpc)
  // never contributes here - it only returns the top 20 accounts.
  const holderCount = holderAnalytics?.holderCount ?? jupiter?.holderCount ?? null;
  const liquidityUsd = Number(dex?.primaryPair?.liquidity?.usd || 0);
  const totalLiquidityUsd = Number(dex?.totalLiquidityUsd || liquidityUsd || jupiter?.liquidity || 0);
  const realMarketCapUsd = Number(coingecko?.realMarketCapUsd || dex?.primaryPair?.marketCap || jupiter?.mcap || geckoTerminal?.marketCapUsd || 0);
  const fdvUsd = Number(coingecko?.fdvUsd || dex?.primaryPair?.fdv || jupiter?.fdv || geckoTerminal?.fdvUsd || 0);
  const marketCapUsd = realMarketCapUsd || fdvUsd;
  const marketCapIsFdv = !realMarketCapUsd && Boolean(fdvUsd);
  const mintAuthorityEnabled = mintInfo?.mintAuthorityEnabled ?? jupiter?.mintAuthorityEnabled ?? null;
  const freezeAuthorityEnabled = mintInfo?.freezeAuthorityEnabled ?? jupiter?.freezeAuthorityEnabled ?? null;
  const coingeckoListed = Boolean(coingecko?.listed);
  const dexStats = aggregateDexTradingStats(dex);
  // Logo priority (Phase 2): CoinGecko > GeckoTerminal > Dexscreener pair
  // image > none. Never falls back to a different token's image.
  const logoUrl = coingecko?.logoUrl || geckoTerminal?.logoUrl || info.imageUrl || '';
  const sources = [
    'Dexscreener pools',
    geckoTerminal ? 'GeckoTerminal' : null,
    'Solana RPC',
    'Jupiter token index',
    coingecko ? 'CoinGecko' : null,
  ].filter(Boolean).join(' + ');

  return {
    id: `solana-${slugify(address)}`,
    name: token.name || jupiter?.name || geckoTerminal?.name || coingecko?.name || '',
    ticker: token.symbol ? token.symbol.toUpperCase() : (jupiter?.symbol?.toUpperCase() || geckoTerminal?.symbol?.toUpperCase() || coingecko?.symbol || ''),
    chain: 'Solana',
    contract: address,
    website,
    twitter,
    telegram,
    github,
    logoUrl,
    launchDate: createdAt ? new Date(createdAt).toISOString().slice(0, 10) : '',
    description: coingecko?.description || (token.name || jupiter?.name
      ? `${token.name || jupiter.name} is a Solana token profile enriched with public market and on-chain signals.`
      : 'Solana token profile enriched with public market and on-chain signals.'),
    status: 'Live Solana data',
    lastUpdate: new Date().toISOString().slice(0, 10),
    holderCount: holderCount || 0,
    communitySize: holderCount || 0,
    riskNotes: buildRealDataRiskNotes({ liquidityUsd, holderCount, tokenAgeDays, mintAuthorityEnabled, freezeAuthorityEnabled }),
    realData: {
      source: sources,
      holderSource: holderAnalytics?.source || (jupiter?.holderCount ? 'Jupiter indexed Solana holder count' : null),
      liquidityUsd,
      totalLiquidityUsd,
      marketCapUsd,
      marketCapIsFdv,
      tokenAgeDays,
      tokenAgeSource,
      holderCount,
      topHolderPercent: holderAnalytics?.topHolderPercent ?? rpc?.topHolderPercent ?? null,
      topTenHolderPercent: holderAnalytics?.topTenHolderPercent ?? rpc?.topTenHolderPercent ?? jupiter?.topHoldersPercentage ?? null,
      holderGrowthPercent: jupiter?.holderGrowthPercent ?? null,
      supply: rpc?.supply || jupiter?.totalSupply || geckoTerminal?.totalSupply || coingecko?.circulatingSupply || null,
      maxSupply: coingecko?.maxSupply ?? null,
      totalSupply: coingecko?.totalSupply ?? null,
      priceUsd: coingecko?.priceUsd ?? geckoTerminal?.priceUsd ?? (Number(dex?.primaryPair?.priceUsd || 0) || null),
      priceChange5m: dex?.primaryPair?.priceChange?.m5 ?? null,
      priceChange1h: dex?.primaryPair?.priceChange?.h1 ?? null,
      priceChange6h: dex?.primaryPair?.priceChange?.h6 ?? null,
      priceChange24h: coingecko?.priceChange24h ?? dex?.primaryPair?.priceChange?.h24 ?? null,
      priceChange7d: coingecko?.priceChange7d ?? null,
      priceChange30d: coingecko?.priceChange30d ?? null,
      ath: coingecko?.ath ?? null,
      atl: coingecko?.atl ?? null,
      volume24hUsd: coingecko?.volume24hUsd ?? dexStats?.volume24hUsd ?? null,
      buys24h: dexStats?.buys24h ?? null,
      sells24h: dexStats?.sells24h ?? null,
      topPoolConcentrationPercent: dexStats?.topPoolConcentrationPercent ?? null,
      topAccountCount: rpc?.topAccountCount || null,
      mintAuthorityEnabled,
      freezeAuthorityEnabled,
      upgradeable: null,
      coingeckoListed,
      twitterFollowers: coingecko?.twitterFollowers ?? null,
      telegramUsers: coingecko?.telegramUsers ?? null,
      poolCount: dex?.poolCount || 0,
      websiteUrl: website,
      twitterUrl: twitter,
      telegramUrl: telegram,
      githubUrl: github,
      discordUrl: discord,
      socialMetadataAvailable,
      tokenProgram: jupiter?.tokenProgram || '',
      launchpad: jupiter?.launchpad || '',
      pairUrl: dex?.primaryPair?.url || '',
      pairAddress: dex?.primaryPair?.pairAddress || '',
      dexChainId: dex?.primaryPair ? 'solana' : null,
      dexId: dex?.primaryPair?.dexId || '',
      coingeckoId: coingecko?.coingeckoId || null,
      baseSymbol: token.symbol ? token.symbol.toUpperCase() : '',
      quoteSymbol: dex?.primaryPair?.quoteToken?.symbol || '',
      fetchedAt: new Date().toISOString(),
    },
  };
}

// Dexscreener's general search - broad pair-level coverage, but it has no
// notion of "the official token" and ranks purely by pool stats. Used as
// the fallback layer beneath CoinGecko's canonical resolution, never as
// the primary source of truth for which contract is the real asset.
async function fetchDexscreenerSearchMatches(term) {
  const response = await fetch(`${DEXSCREENER_SEARCH_URL}?q=${encodeURIComponent(term)}`);
  if (!response.ok) throw new Error('Token search failed.');
  const data = await response.json();
  const pairs = Array.isArray(data?.pairs) ? data.pairs : [];
  const byKey = new Map();
  pairs.forEach((pair) => {
    const address = pair.baseToken?.address;
    const chainId = pair.chainId;
    if (!address || !chainId) return;
    const key = `${chainId}-${address.toLowerCase()}`;
    const marketCap = Number(pair.marketCap || pair.fdv || 0);
    const existing = byKey.get(key);
    if (existing && existing.marketCap >= marketCap) return;
    byKey.set(key, {
      address,
      chainId,
      chain: chainLabelFor(chainId),
      name: pair.baseToken?.name || '',
      symbol: pair.baseToken?.symbol ? pair.baseToken.symbol.toUpperCase() : '',
      marketCap,
      logoUrl: pair.info?.imageUrl || '',
      // Dexscreener doesn't expose an explicit "verified" flag for search
      // results; a curated profile image is the closest available signal.
      verified: Boolean(pair.info?.imageUrl),
      source: 'dexscreener',
    });
  });
  return Array.from(byKey.values()).sort((a, b) => b.marketCap - a.marketCap);
}

// Canonical token resolution (Phase 1): CoinGecko's own listing is checked
// first since it is the closest available ground truth for "which contract
// is the real asset" - an exact native-asset ticker match (BTC, ETH, SOL...)
// is resolved directly rather than trusting fuzzy search ranking. Dexscreener
// results are only used to fill in anything CoinGecko didn't have, and any
// Dexscreener entry that duplicates a CoinGecko-verified one is dropped in
// favor of the verified entry.
async function fetchTokenSearchMatches(term) {
  const nativeId = NATIVE_ASSET_COINGECKO_IDS[term.trim().toUpperCase()];
  const [canonicalResult, nativeResult, dexResult] = await Promise.allSettled([
    fetchCoinGeckoCanonicalMatches(term),
    nativeId ? fetchCoinGeckoCoinDetail(nativeId) : Promise.resolve(null),
    fetchDexscreenerSearchMatches(term),
  ]);
  const canonical = canonicalResult.status === 'fulfilled' ? canonicalResult.value : [];
  const native = nativeResult.status === 'fulfilled' ? nativeResult.value : null;
  const dex = dexResult.status === 'fulfilled' ? dexResult.value : [];

  const byKey = new Map();
  const upsertVerified = (match) => {
    const key = match.chainId === 'native' ? `native-${match.coingeckoId}` : `${match.chainId}-${match.address.toLowerCase()}`;
    byKey.set(key, match);
  };

  if (native) {
    upsertVerified({
      address: null,
      chainId: 'native',
      chain: native.name,
      coingeckoId: native.coingeckoId,
      name: native.name,
      symbol: native.symbol,
      marketCap: native.realMarketCapUsd,
      logoUrl: native.logoUrl,
      verified: true,
      source: 'coingecko',
    });
  }
  canonical.forEach(upsertVerified);
  dex.forEach((match) => {
    const key = `${match.chainId}-${match.address.toLowerCase()}`;
    if (byKey.has(key)) return;
    byKey.set(key, match);
  });

  return Array.from(byKey.values())
    .sort((a, b) => {
      if (a.source === 'coingecko' && b.source !== 'coingecko') return -1;
      if (b.source === 'coingecko' && a.source !== 'coingecko') return 1;
      return b.marketCap - a.marketCap;
    })
    .slice(0, 8);
}

async function lookupGenericChainToken(chainId, address) {
  return withLookupCache(`${chainId}:${address.toLowerCase()}`, () => lookupGenericChainTokenUncached(chainId, address));
}

async function lookupGenericChainTokenUncached(chainId, address) {
  const [dexResult, coingeckoResult, geckoTerminalResult, explorerCreationResult, explorerFlagsResult] = await Promise.allSettled([
    fetchDexscreenerToken(address, chainId),
    fetchCoinGeckoTokenData(chainId, address),
    fetchGeckoTerminalToken(chainId, address),
    fetchExplorerContractCreation(chainId, address),
    fetchExplorerContractFlags(chainId, address),
  ]);
  const dex = dexResult.status === 'fulfilled' ? dexResult.value : null;
  const coingecko = coingeckoResult.status === 'fulfilled' ? coingeckoResult.value : null;
  const geckoTerminal = geckoTerminalResult.status === 'fulfilled' ? geckoTerminalResult.value : null;
  const explorerCreatedAt = explorerCreationResult.status === 'fulfilled' ? explorerCreationResult.value : null;
  const explorerFlags = explorerFlagsResult.status === 'fulfilled' ? explorerFlagsResult.value : null;

  if (!dex?.primaryPair && !coingecko && !geckoTerminal) {
    throw new Error('No public token data was found for this address.');
  }

  const token = dex?.primaryPair ? getDexTokenForAddress(dex.primaryPair, address) : {};
  const info = dex?.primaryPair?.info || {};
  const socialLinks = mergeSocialLinks(
    extractSocialLinksFromDexInfo(info),
    extractSocialLinksFromMetadata(dex?.primaryPair),
    { website: coingecko?.website, twitter: coingecko?.twitter, telegram: coingecko?.telegram, discord: coingecko?.discord, github: coingecko?.github }
  );
  const website = socialLinks.website || '';
  const twitter = socialLinks.twitter || '';
  const telegram = socialLinks.telegram || '';
  const github = socialLinks.github || '';
  const discord = socialLinks.discord || '';
  // Real asset age priority: CoinGecko's genesis_date, then the chain's
  // own contract-deployment timestamp (requires a free explorer API key -
  // see EXPLORER_CONFIG). A DEX pair's first-liquidity date is never used.
  // If neither real source resolves, age stays unknown.
  const createdAt = coingecko?.genesisDate ? new Date(coingecko.genesisDate).getTime() : explorerCreatedAt;
  const tokenAgeSource = coingecko?.genesisDate
    ? 'CoinGecko genesis date'
    : (explorerCreatedAt ? `${chainLabelFor(chainId)} block explorer contract creation` : null);
  const tokenAgeDays = createdAt ? daysSince(createdAt) : null;
  const liquidityUsd = Number(dex?.primaryPair?.liquidity?.usd || 0);
  const totalLiquidityUsd = Number(dex?.totalLiquidityUsd || liquidityUsd || 0);
  const realMarketCapUsd = Number(coingecko?.realMarketCapUsd || dex?.primaryPair?.marketCap || geckoTerminal?.marketCapUsd || 0);
  const fdvUsd = Number(coingecko?.fdvUsd || dex?.primaryPair?.fdv || geckoTerminal?.fdvUsd || 0);
  const marketCapUsd = realMarketCapUsd || fdvUsd;
  const marketCapIsFdv = !realMarketCapUsd && Boolean(fdvUsd);
  const chainLabel = chainLabelFor(chainId);
  const article = /^[aeiou]/i.test(chainLabel) ? 'an' : 'a';
  const name = token.name || geckoTerminal?.name || coingecko?.name || '';
  const logoUrl = coingecko?.logoUrl || geckoTerminal?.logoUrl || info.imageUrl || '';
  const dexStats = aggregateDexTradingStats(dex);
  const sources = [
    dex?.primaryPair ? 'Dexscreener pools' : null,
    geckoTerminal ? 'GeckoTerminal' : null,
    coingecko ? 'CoinGecko' : null,
    explorerCreatedAt || explorerFlags ? `${chainLabel} block explorer` : null,
  ].filter(Boolean).join(' + ') || 'No public data source available';

  return {
    id: `${chainId}-${slugify(address)}`,
    name,
    ticker: token.symbol ? token.symbol.toUpperCase() : (geckoTerminal?.symbol?.toUpperCase() || coingecko?.symbol || ''),
    chain: chainLabel,
    contract: address,
    website,
    twitter,
    telegram,
    github,
    logoUrl,
    launchDate: createdAt ? new Date(createdAt).toISOString().slice(0, 10) : '',
    description: coingecko?.description || (name
      ? `${name} is ${article} ${chainLabel} token profile enriched with public market signals.`
      : `${chainLabel} token profile enriched with public market signals.`),
    status: 'Live market data',
    lastUpdate: new Date().toISOString().slice(0, 10),
    holderCount: 0,
    communitySize: 0,
    riskNotes: buildRealDataRiskNotes({
      liquidityUsd,
      holderCount: null,
      tokenAgeDays,
      upgradeable: explorerFlags?.upgradeable ?? null,
    }),
    realData: {
      source: sources,
      holderSource: null,
      liquidityUsd,
      totalLiquidityUsd,
      marketCapUsd,
      marketCapIsFdv,
      tokenAgeDays,
      tokenAgeSource,
      holderCount: null,
      topHolderPercent: null,
      topTenHolderPercent: null,
      holderGrowthPercent: null,
      supply: geckoTerminal?.totalSupply || coingecko?.circulatingSupply || null,
      maxSupply: coingecko?.maxSupply ?? null,
      totalSupply: coingecko?.totalSupply ?? null,
      priceUsd: coingecko?.priceUsd ?? geckoTerminal?.priceUsd ?? (Number(dex?.primaryPair?.priceUsd || 0) || null),
      priceChange5m: dex?.primaryPair?.priceChange?.m5 ?? null,
      priceChange1h: dex?.primaryPair?.priceChange?.h1 ?? null,
      priceChange6h: dex?.primaryPair?.priceChange?.h6 ?? null,
      priceChange24h: coingecko?.priceChange24h ?? dex?.primaryPair?.priceChange?.h24 ?? null,
      priceChange7d: coingecko?.priceChange7d ?? null,
      priceChange30d: coingecko?.priceChange30d ?? null,
      ath: coingecko?.ath ?? null,
      atl: coingecko?.atl ?? null,
      volume24hUsd: coingecko?.volume24hUsd ?? dexStats?.volume24hUsd ?? null,
      buys24h: dexStats?.buys24h ?? null,
      sells24h: dexStats?.sells24h ?? null,
      topPoolConcentrationPercent: dexStats?.topPoolConcentrationPercent ?? null,
      topAccountCount: null,
      mintAuthorityEnabled: null,
      freezeAuthorityEnabled: null,
      upgradeable: explorerFlags?.upgradeable ?? null,
      verifiedSource: explorerFlags?.verifiedSource ?? null,
      coingeckoListed: Boolean(coingecko?.listed),
      twitterFollowers: coingecko?.twitterFollowers ?? null,
      telegramUsers: coingecko?.telegramUsers ?? null,
      poolCount: dex?.poolCount || 0,
      websiteUrl: website,
      twitterUrl: twitter,
      telegramUrl: telegram,
      githubUrl: github,
      discordUrl: discord,
      socialMetadataAvailable: Boolean(dex?.primaryPair || coingecko),
      pairUrl: dex?.primaryPair?.url || '',
      pairAddress: dex?.primaryPair?.pairAddress || '',
      dexChainId: dex?.primaryPair ? chainId : null,
      dexId: dex?.primaryPair?.dexId || '',
      coingeckoId: coingecko?.coingeckoId || null,
      baseSymbol: token.symbol ? token.symbol.toUpperCase() : '',
      quoteSymbol: dex?.primaryPair?.quoteToken?.symbol || '',
      fetchedAt: new Date().toISOString(),
    },
  };
}

async function lookupTokenMatch(match) {
  let project;
  if (match.chainId === 'native') {
    project = await lookupNativeCoinGeckoAsset(match.coingeckoId, match.chain);
  } else if (match.chainId === 'solana') {
    project = await lookupSolanaToken(match.address);
  } else {
    project = await lookupGenericChainToken(match.chainId, match.address);
  }
  // The match the user actually picked from the selection list (logo, name,
  // chain) takes priority for display - it's what they saw and chose, and
  // for CoinGecko-verified matches it's already the most authoritative logo.
  return {
    ...project,
    logoUrl: match.logoUrl || project.logoUrl || '',
    name: project.name || match.name || '',
    ticker: project.ticker || match.symbol || '',
  };
}

// Native chain coins (BTC, ETH, BNB, SOL, ...) have no contract to look up -
// the only real source is CoinGecko's coin detail by id. No holder count,
// mint authority, or liquidity concept applies to a chain's own native
// asset, so those fields stay null/unknown rather than being guessed.
async function lookupNativeCoinGeckoAsset(coingeckoId, chainLabel) {
  const detail = await fetchCoinGeckoCoinDetail(coingeckoId);
  if (!detail) throw new Error('No public CoinGecko data was found for this asset.');
  const createdAt = detail.genesisDate ? new Date(detail.genesisDate).getTime() : null;
  const tokenAgeDays = createdAt ? daysSince(createdAt) : null;
  const socialLinks = mergeSocialLinks({ website: detail.website, twitter: detail.twitter, telegram: detail.telegram, github: detail.github });

  return {
    id: `native-${slugify(coingeckoId)}`,
    name: detail.name,
    ticker: detail.symbol,
    chain: chainLabel,
    contract: 'Native asset (no contract)',
    website: socialLinks.website || '',
    twitter: socialLinks.twitter || '',
    telegram: socialLinks.telegram || '',
    github: socialLinks.github || '',
    logoUrl: detail.logoUrl,
    launchDate: createdAt ? new Date(createdAt).toISOString().slice(0, 10) : '',
    description: detail.description || `${detail.name} is ${chainLabel}'s native chain asset.`,
    status: 'Live CoinGecko data',
    lastUpdate: new Date().toISOString().slice(0, 10),
    holderCount: 0,
    communitySize: 0,
    riskNotes: translate('scoring.riskNotes.liveDataAvailable'),
    realData: {
      source: 'CoinGecko',
      holderSource: null,
      liquidityUsd: null,
      totalLiquidityUsd: null,
      marketCapUsd: detail.realMarketCapUsd || detail.fdvUsd,
      marketCapIsFdv: !detail.realMarketCapUsd && Boolean(detail.fdvUsd),
      tokenAgeDays,
      tokenAgeSource: createdAt ? 'CoinGecko genesis date' : null,
      holderCount: null,
      topHolderPercent: null,
      topTenHolderPercent: null,
      holderGrowthPercent: null,
      supply: detail.circulatingSupply,
      maxSupply: detail.maxSupply,
      totalSupply: detail.totalSupply,
      priceUsd: detail.priceUsd,
      priceChange24h: detail.priceChange24h,
      priceChange7d: detail.priceChange7d,
      priceChange30d: detail.priceChange30d,
      ath: detail.ath,
      atl: detail.atl,
      volume24hUsd: detail.volume24hUsd,
      topAccountCount: null,
      mintAuthorityEnabled: null,
      freezeAuthorityEnabled: null,
      upgradeable: null,
      coingeckoListed: true,
      twitterFollowers: detail.twitterFollowers,
      telegramUsers: detail.telegramUsers,
      poolCount: 0,
      websiteUrl: socialLinks.website || '',
      twitterUrl: socialLinks.twitter || '',
      telegramUrl: socialLinks.telegram || '',
      githubUrl: socialLinks.github || '',
      socialMetadataAvailable: true,
      isNativeAsset: true,
      coingeckoId,
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

async function fetchDexscreenerToken(address, chainId = 'solana') {
  const response = await fetch(`${DEXSCREENER_TOKEN_PAIRS_BASE_URL}/${chainId}/${address}`);
  if (!response.ok) throw new Error('Dexscreener lookup failed.');
  const pairs = await response.json();
  if (!Array.isArray(pairs) || !pairs.length) return null;
  const solanaPairs = pairs
    .filter((pair) => pair.chainId === chainId)
    .filter((pair) => {
      const normalized = address.toLowerCase();
      return pair.baseToken?.address?.toLowerCase() === normalized || pair.quoteToken?.address?.toLowerCase() === normalized;
    });
  // Primary pair (and therefore the chart/metrics pair) is chosen by
  // liquidity first, then 24h volume as a tiebreaker for near-equal pools -
  // never an arbitrary/first-returned pair.
  const sortedPairs = solanaPairs.sort((a, b) => {
    const liquidityDiff = Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0);
    if (liquidityDiff !== 0) return liquidityDiff;
    return Number(b?.volume?.h24 || 0) - Number(a?.volume?.h24 || 0);
  });
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

// Dexscreener's per-pool objects already include 24h volume and buy/sell
// transaction counts (dex.pairs, fetched above) - this was being discarded
// after only liquidity was summed. No new API call: just reads fields
// already present on data we fetch for every lookup.
function aggregateDexTradingStats(dex) {
  const pairs = Array.isArray(dex?.pairs) ? dex.pairs : [];
  if (!pairs.length) return null;
  const volume24hUsd = pairs.reduce((total, pair) => total + Number(pair?.volume?.h24 || 0), 0);
  const buys24h = pairs.reduce((total, pair) => total + Number(pair?.txns?.h24?.buys || 0), 0);
  const sells24h = pairs.reduce((total, pair) => total + Number(pair?.txns?.h24?.sells || 0), 0);
  const totalLiquidity = dex.totalLiquidityUsd || 0;
  const primaryLiquidity = Number(dex.primaryPair?.liquidity?.usd || 0);
  // What share of total liquidity sits in the single largest pool - a token
  // whose liquidity is almost entirely concentrated in one pool is more
  // exposed to that pool being pulled than one spread across several.
  const topPoolConcentrationPercent = totalLiquidity > 0 ? roundPercent(primaryLiquidity / totalLiquidity) : null;
  return {
    volume24hUsd: volume24hUsd || null,
    buys24h: pairs.some((p) => p?.txns?.h24) ? buys24h : null,
    sells24h: pairs.some((p) => p?.txns?.h24) ? sells24h : null,
    topPoolConcentrationPercent,
  };
}

function getDexTokenForAddress(pair, address) {
  const normalized = address.toLowerCase();
  if (pair?.baseToken?.address?.toLowerCase() === normalized) return pair.baseToken;
  if (pair?.quoteToken?.address?.toLowerCase() === normalized) return pair.quoteToken;
  return pair?.baseToken || {};
}

// CoinGecko's free contract-lookup endpoint. Most reliable source for real
// circulating market cap (vs. FDV) and, for established assets, a genuine
// genesis_date - the most trustworthy "real asset age" signal available
// without depending on a chain RPC. Not every token is listed, so a 404 is
// a normal "not found" result, not an error worth surfacing.
// Shared parser for CoinGecko's "coin detail" shape, returned identically
// by /coins/{platform}/contract/{address} and /coins/{id}.
function parseCoinGeckoCoinDetail(data) {
  const links = data.links || {};
  const community = data.community_data || {};
  const market = data.market_data || {};
  const telegramHandle = links.telegram_channel_identifier;
  const discordUrl = (links.chat_url || []).find((url) => /discord/i.test(url || ''));
  return {
    listed: true,
    coingeckoId: data.id || '',
    name: data.name || '',
    symbol: data.symbol ? data.symbol.toUpperCase() : '',
    logoUrl: data.image?.large || data.image?.small || data.image?.thumb || '',
    description: cleanLink(data.description?.en)?.split(/\r?\n/)[0]?.slice(0, 280) || '',
    platforms: data.platforms || {},
    realMarketCapUsd: Number(market.market_cap?.usd || 0),
    fdvUsd: Number(market.fully_diluted_valuation?.usd || 0),
    priceUsd: Number(market.current_price?.usd || 0),
    priceChange24h: market.price_change_percentage_24h ?? null,
    priceChange7d: market.price_change_percentage_7d ?? null,
    priceChange30d: market.price_change_percentage_30d ?? null,
    ath: Number(market.ath?.usd || 0) || null,
    athDate: market.ath_date?.usd || null,
    atl: Number(market.atl?.usd || 0) || null,
    atlDate: market.atl_date?.usd || null,
    volume24hUsd: Number(market.total_volume?.usd || 0) || null,
    circulatingSupply: Number(market.circulating_supply || 0) || null,
    maxSupply: Number(market.max_supply || 0) || null,
    totalSupply: Number(market.total_supply || 0) || null,
    genesisDate: data.genesis_date || null,
    category: Array.isArray(data.categories) ? data.categories.find(hasValue) || '' : '',
    website: cleanLink(links.homepage?.find(hasValue)),
    twitter: links.twitter_screen_name ? `https://twitter.com/${links.twitter_screen_name}` : '',
    telegram: telegramHandle ? `https://t.me/${telegramHandle}` : '',
    discord: discordUrl || '',
    github: cleanLink(links.repos_url?.github?.find(hasValue)),
    twitterFollowers: Number(community.twitter_followers || 0) || null,
    telegramUsers: Number(community.telegram_channel_user_count || 0) || null,
  };
}

async function fetchCoinGeckoTokenData(chainId, address) {
  const platform = CHAIN_TO_COINGECKO_PLATFORM[chainId];
  if (!platform) return null;
  const response = await fetch(`${COINGECKO_API_BASE}/coins/${platform}/contract/${address}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('CoinGecko lookup failed.');
  const data = await response.json();
  return parseCoinGeckoCoinDetail(data);
}

async function fetchCoinGeckoCoinDetail(coingeckoId) {
  const response = await fetch(`${COINGECKO_API_BASE}/coins/${coingeckoId}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('CoinGecko lookup failed.');
  const data = await response.json();
  return parseCoinGeckoCoinDetail(data);
}

// CoinGecko's own search index is the closest thing to a ground truth for
// "which contract is the REAL token behind this name/ticker" - Dexscreener's
// search has no concept of an official/canonical asset and will happily
// rank an unrelated higher-liquidity imitator above the real one. Only the
// top few CoinGecko search hits (by market_cap_rank) are resolved in full,
// to stay within the free, no-key rate limit.
async function fetchCoinGeckoCanonicalMatches(term) {
  const response = await fetch(`${COINGECKO_API_BASE}/search?query=${encodeURIComponent(term)}`);
  if (!response.ok) throw new Error('CoinGecko search failed.');
  const data = await response.json();
  const coins = Array.isArray(data?.coins) ? data.coins : [];
  const ranked = coins
    .filter((coin) => coin.market_cap_rank !== null && coin.market_cap_rank !== undefined)
    .sort((a, b) => a.market_cap_rank - b.market_cap_rank)
    .slice(0, 3);
  const details = await Promise.allSettled(ranked.map((coin) => fetchCoinGeckoCoinDetail(coin.id)));

  const matches = [];
  details.forEach((result, index) => {
    if (result.status !== 'fulfilled' || !result.value) return;
    const detail = result.value;
    const coin = ranked[index];
    const platformEntries = Object.entries(detail.platforms || {}).filter(([, address]) => hasValue(address));
    if (!platformEntries.length) {
      // No on-chain contract anywhere - this is the chain's own native
      // asset (BTC, ETH, BNB, SOL, ...), not a token deployed on a chain.
      matches.push({
        address: null,
        chainId: 'native',
        chain: detail.name,
        coingeckoId: coin.id,
        name: detail.name,
        symbol: detail.symbol,
        marketCap: detail.realMarketCapUsd,
        logoUrl: detail.logoUrl,
        verified: true,
        source: 'coingecko',
      });
      return;
    }
    platformEntries.forEach(([platform, address]) => {
      const chainId = COINGECKO_PLATFORM_TO_CHAIN[platform];
      if (!chainId) return;
      matches.push({
        address,
        chainId,
        chain: chainLabelFor(chainId),
        coingeckoId: coin.id,
        name: detail.name,
        symbol: detail.symbol,
        marketCap: detail.realMarketCapUsd,
        logoUrl: detail.logoUrl,
        verified: true,
        source: 'coingecko',
      });
    });
  });
  return matches;
}

// GeckoTerminal covers the same DEX pool universe as Dexscreener but
// indexes some pairs/chains independently - used only to fill gaps when
// Dexscreener has no pair for a token, never to override it.
async function fetchGeckoTerminalToken(chainId, address) {
  const network = CHAIN_TO_GECKOTERMINAL_NETWORK[chainId];
  if (!network) return null;
  const response = await fetch(`${GECKOTERMINAL_API_BASE}/networks/${network}/tokens/${address}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('GeckoTerminal lookup failed.');
  const data = await response.json();
  const attrs = data?.data?.attributes;
  if (!attrs) return null;
  // GeckoTerminal returns total_supply in raw base units, not decimal-
  // adjusted - dividing by 10^decimals avoids displaying an inflated
  // "fake-looking" supply (e.g. 10^27 instead of the real token count).
  const decimals = Number(attrs.decimals || 0);
  const rawSupply = Number(attrs.total_supply || 0);
  const totalSupply = decimals > 0 && rawSupply ? rawSupply / 10 ** decimals : rawSupply;
  return {
    name: attrs.name,
    symbol: attrs.symbol,
    marketCapUsd: Number(attrs.market_cap_usd || 0),
    fdvUsd: Number(attrs.fdv_usd || 0),
    totalSupply,
    priceUsd: Number(attrs.price_usd || 0),
    logoUrl: cleanLink(attrs.image_url) && !/missing_large/i.test(attrs.image_url || '') ? attrs.image_url : '',
  };
}

// EVM contract creation timestamp via the chain's block explorer (Etherscan-
// family APIs). Requires a free API key set as an env var - see
// EXPLORER_CONFIG. Without a key this resolves to null (Unknown), never a
// guess. Two-hop lookup: contract creation tx hash -> tx's block -> block
// timestamp, all on the same explorer API.
async function fetchExplorerContractCreation(chainId, address) {
  const config = EXPLORER_CONFIG[chainId];
  const apiKey = explorerApiKeyFor(chainId);
  if (!config || !apiKey) return null;
  const creationResponse = await fetch(`${config.base}?module=contract&action=getcontractcreation&contractaddresses=${address}&apikey=${apiKey}`);
  if (!creationResponse.ok) throw new Error('Explorer contract-creation lookup failed.');
  const creationData = await creationResponse.json();
  const txHash = creationData?.result?.[0]?.txHash;
  if (!txHash) return null;
  const txResponse = await fetch(`${config.base}?module=proxy&action=eth_getTransactionByHash&txhash=${txHash}&apikey=${apiKey}`);
  const txData = await txResponse.json();
  const blockNumber = txData?.result?.blockNumber;
  if (!blockNumber) return null;
  const blockResponse = await fetch(`${config.base}?module=proxy&action=eth_getBlockByNumber&tag=${blockNumber}&boolean=false&apikey=${apiKey}`);
  const blockData = await blockResponse.json();
  const timestampHex = blockData?.result?.timestamp;
  return timestampHex ? Number(timestampHex) * 1000 : null;
}

// Real contract-security signal for EVM chains: is this a proxy
// (upgradeable) contract? Same explorer API, same free key requirement.
async function fetchExplorerContractFlags(chainId, address) {
  const config = EXPLORER_CONFIG[chainId];
  const apiKey = explorerApiKeyFor(chainId);
  if (!config || !apiKey) return null;
  const response = await fetch(`${config.base}?module=contract&action=getsourcecode&address=${address}&apikey=${apiKey}`);
  if (!response.ok) throw new Error('Explorer source-code lookup failed.');
  const data = await response.json();
  const result = data?.result?.[0];
  if (!result) return null;
  return {
    upgradeable: result.Proxy === '1',
    verifiedSource: hasValue(result.SourceCode),
  };
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
      if (type.includes('discord')) return { discord: url };
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
    holderCount: token.holderCount === undefined || token.holderCount === null ? null : Number(token.holderCount),
    holderGrowthPercent: token.stats24h?.holderChange ?? null,
    liquidity: Number(token.liquidity || 0),
    mcap: Number(token.mcap || 0),
    fdv: Number(token.fdv || 0),
    totalSupply: Number(token.totalSupply || token.circSupply || 0),
    topHoldersPercentage: token.audit?.topHoldersPercentage ?? null,
    // Jupiter's audit flags are "disabled" booleans - invert to the
    // "enabled" framing used throughout the rest of the risk engine.
    mintAuthorityEnabled: typeof token.audit?.mintAuthorityDisabled === 'boolean' ? !token.audit.mintAuthorityDisabled : null,
    freezeAuthorityEnabled: typeof token.audit?.freezeAuthorityDisabled === 'boolean' ? !token.audit.freezeAuthorityDisabled : null,
    tokenProgram: token.tokenProgram,
    launchpad: token.launchpad,
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
  // getTokenLargestAccounts only returns up to the top 20 accounts, so it is a
  // real source for largest-holder concentration but NEVER a valid holder
  // count - there is no "holderCountEstimate" here on purpose.
  const topHolderPercent = supply ? roundPercent((topBalances[0] || 0) / supply) : null;
  const topTenHolderPercent = supply ? roundPercent(topBalances.slice(0, 10).reduce((total, value) => total + value, 0) / supply) : null;
  return {
    supply,
    topHolderPercent,
    topTenHolderPercent,
    topAccountCount: topAccounts.length,
  };
}

async function fetchSolanaHolderAnalytics(address) {
  const mintInfo = await fetchMintAccountInfo(address);
  const result = await solanaRpc('getProgramAccounts', [
    mintInfo.programId,
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
    source: `Solana RPC token-account scan (${mintInfo.programId === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' ? 'Token-2022' : 'SPL Token'})`,
  };
}

async function fetchMintAccountInfo(address) {
  const accountInfo = await solanaRpc('getAccountInfo', [address, { encoding: 'jsonParsed' }]);
  const info = accountInfo?.value?.data?.parsed?.info;
  return {
    programId: accountInfo?.value?.owner || 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    // null mintAuthority/freezeAuthority means that authority has been
    // revoked (disabled) - a genuine on-chain security signal.
    mintAuthorityEnabled: info ? info.mintAuthority !== null && info.mintAuthority !== undefined : null,
    freezeAuthorityEnabled: info ? info.freezeAuthority !== null && info.freezeAuthority !== undefined : null,
  };
}

// Walks getSignaturesForAddress backwards to find the mint account's genesis
// transaction (its real creation timestamp), instead of guessing from a DEX
// pair's first-liquidity date. Bounded so it never hammers the public RPC
// indefinitely for high-traffic mints (SOL, BONK, USDC, ...) - if the mint's
// full history can't be reached within the cap, the real age is unknown and
// must be reported as such rather than estimated.
const MINT_CREATION_LOOKUP_MAX_PAGES = 6;
const MINT_CREATION_LOOKUP_PAGE_SIZE = 1000;

async function fetchMintCreationTimestamp(address) {
  let before;
  let oldestBatch = null;
  for (let page = 0; page < MINT_CREATION_LOOKUP_MAX_PAGES; page += 1) {
    const params = before
      ? [address, { limit: MINT_CREATION_LOOKUP_PAGE_SIZE, before }]
      : [address, { limit: MINT_CREATION_LOOKUP_PAGE_SIZE }];
    const batch = await solanaRpc('getSignaturesForAddress', params);
    if (!Array.isArray(batch) || !batch.length) {
      return oldestBatch ? signatureTimestamp(oldestBatch[oldestBatch.length - 1]) : null;
    }
    oldestBatch = batch;
    if (batch.length < MINT_CREATION_LOOKUP_PAGE_SIZE) {
      // Reached the start of this mint's history within the page - the last
      // entry is the genesis (mint creation) transaction.
      return signatureTimestamp(batch[batch.length - 1]);
    }
    before = batch[batch.length - 1].signature;
  }
  // Hit the page cap without reaching genesis - real creation date unknown.
  return null;
}

function signatureTimestamp(entry) {
  return entry?.blockTime ? entry.blockTime * 1000 : null;
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

function buildRealDataRiskNotes({ liquidityUsd, holderCount, tokenAgeDays, mintAuthorityEnabled, freezeAuthorityEnabled, upgradeable }) {
  const notes = [];
  if (liquidityUsd > 0 && liquidityUsd < 5000) notes.push('low liquidity');
  if (holderCount > 0 && holderCount < 500) notes.push('low holders');
  if (tokenAgeDays !== null && tokenAgeDays !== undefined && tokenAgeDays < 14) notes.push('very new project');
  // Only flagged when explicitly known true from on-chain/indexed data -
  // never inferred when the authority/proxy status is unknown.
  if (mintAuthorityEnabled === true) notes.push('mint authority enabled');
  if (freezeAuthorityEnabled === true) notes.push('freeze authority enabled');
  if (upgradeable === true) notes.push('upgradeable contract');
  return notes.length ? notes.join(', ') : translate('scoring.riskNotes.liveDataAvailable');
}

function buildCanonicalRiskNotes(data = {}) {
  return buildRealDataRiskNotes({
    liquidityUsd: Number(data.totalLiquidityUsd ?? data.liquidityUsd ?? 0),
    holderCount: Number(data.holderCount || 0),
    tokenAgeDays: data.tokenAgeDays,
    mintAuthorityEnabled: data.mintAuthorityEnabled,
    freezeAuthorityEnabled: data.freezeAuthorityEnabled,
    upgradeable: data.upgradeable,
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

// formatCurrency rounds sub-cent prices to "$0.00", which looks like
// missing data for memecoin-range prices that are very real (e.g. PEPE's
// $0.0000028 ATH). Use full precision below $1 instead of silently
// truncating to zero.
function formatTinyOrCurrency(value) {
  const number = Number(value || 0);
  if (!number) return translate('common.notAvailable');
  if (number >= 1) return formatCurrency(number);
  return `$${number.toPrecision(4)}`;
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

function contractSecuritySummary(data = {}) {
  const flags = [];
  if (data.mintAuthorityEnabled === true) flags.push(translate('scoring.factors.mintAuthorityTitle'));
  if (data.freezeAuthorityEnabled === true) flags.push(translate('scoring.factors.freezeAuthorityTitle'));
  if (data.upgradeable === true) flags.push(translate('scoring.factors.upgradeableTitle'));
  if (flags.length) return flags.join(', ');
  const known = [data.mintAuthorityEnabled, data.freezeAuthorityEnabled, data.upgradeable].some((value) => value === false);
  if (known) return translate('scoring.contractSecurity.noKnownRisks');
  return translate('common.notAvailable');
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
  const github = socialPresenceState('github', project, data);

  const factors = [
    holderCountFactor(holders, data.holderSource),
    largestHolderFactor(largestHolder),
    topTenHolderFactor(topTen),
    tokenAgeFactor(tokenAgeDays),
    liquidityFactor(liquidity, data.poolCount),
    presenceFactor('website', website),
    presenceFactor('twitter', twitter),
    presenceFactor('telegram', telegram),
    presenceFactor('github', github),
  ];

  // Only shown when the authority/proxy status is actually known - unknown
  // chains or stale profiles never get a fabricated security verdict.
  if (data.mintAuthorityEnabled !== null && data.mintAuthorityEnabled !== undefined) {
    factors.push(authorityFactor('mint', data.mintAuthorityEnabled));
  }
  if (data.freezeAuthorityEnabled !== null && data.freezeAuthorityEnabled !== undefined) {
    factors.push(authorityFactor('freeze', data.freezeAuthorityEnabled));
  }
  if (data.upgradeable !== null && data.upgradeable !== undefined) {
    factors.push(upgradeableFactor(data.upgradeable));
  }

  return factors.sort((a, b) => riskSeverityRank(b.severity) - riskSeverityRank(a.severity));
}

function authorityFactor(kind, enabled) {
  const title = translate(kind === 'mint' ? 'scoring.factors.mintAuthorityTitle' : 'scoring.factors.freezeAuthorityTitle');
  if (enabled) {
    return {
      title,
      severity: 'High',
      signal: translate('scoring.factors.authorityEnabledSignal'),
      value: translate('scoring.factors.authorityEnabledValue'),
      explanation: translate(kind === 'mint' ? 'scoring.factors.mintAuthorityEnabledExplain' : 'scoring.factors.freezeAuthorityEnabledExplain'),
    };
  }
  return {
    title,
    severity: 'Low',
    signal: translate('scoring.factors.authorityDisabledSignal'),
    value: translate('scoring.factors.authorityDisabledValue'),
    explanation: translate(kind === 'mint' ? 'scoring.factors.mintAuthorityDisabledExplain' : 'scoring.factors.freezeAuthorityDisabledExplain'),
  };
}

function upgradeableFactor(upgradeable) {
  const title = translate('scoring.factors.upgradeableTitle');
  if (upgradeable) {
    return {
      title,
      severity: 'High',
      signal: translate('scoring.factors.upgradeableYesSignal'),
      value: translate('scoring.factors.authorityEnabledValue'),
      explanation: translate('scoring.factors.upgradeableYesExplain'),
    };
  }
  return {
    title,
    severity: 'Low',
    signal: translate('scoring.factors.upgradeableNoSignal'),
    value: translate('scoring.factors.authorityDisabledValue'),
    explanation: translate('scoring.factors.upgradeableNoExplain'),
  };
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
  github: { title: 'presenceGithubTitle', ok: 'presenceGithubOk', missing: 'presenceGithubMissing', explain: 'presenceGithubExplain' },
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

function handleUnlockPremiumClick(project, wallet) {
  trackPremiumClick();
  return handleCheckout('premium', wallet);
}

function handleEarlySupporterClick(wallet) {
  trackEarlySupporterClick();
  return handleCheckout('early_supporter', wallet);
}

async function handleCheckout(plan, wallet) {
  if (!isStripeConfigured(plan)) {
    trackCheckoutUnavailable(plan, 'missing_config');
    return { ok: false, message: stripeUnavailableMessage() };
  }

  if (!wallet) {
    trackCheckoutUnavailable(plan, 'wallet_required');
    return { ok: false, message: 'Connect a wallet first so we know where to grant access.' };
  }

  trackCheckoutStarted(plan);
  try {
    const result = await startStripeCheckout(plan, wallet);
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
  const { hasPremium, wallet: entitledWallet } = useWalletEntitlement();

  // Synced Watchlist (Premium/Early Supporter only): merge in whatever this
  // wallet has saved server-side so watchlist follows the wallet across
  // browsers/devices, on top of the existing free local-only watchlist.
  useEffect(() => {
    if (!hasPremium || !entitledWallet) return;
    fetchUserData(entitledWallet).then((data) => {
      const serverWatchlist = data.watchlist || [];
      if (!serverWatchlist.length) return;
      setWatchlist((items) => [...new Set([...items, ...serverWatchlist])]);
    });
  }, [hasPremium, entitledWallet]);

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

  const resolveSearchMatch = async (match) => {
    setSearchState({ status: 'loading', message: t('search.fetching') });
    trackTokenScanStarted(match.address);
    trackSearchEvent(match.address);
    try {
      const liveLookup = await lookupTokenMatch(match);
      const liveProject = normalizeProject(mergeStoredMetadata(liveLookup, findStoredProject(userProjects, liveLookup)));
      setUserProjects((items) => upsertProject(items, liveProject));
      setSearchState({ status: 'success', message: t('search.successOpened', { name: liveProject.name || liveProject.ticker }) });
      trackTokenScanCompleted(match.address, 'success');
      trackTokenScanEvent(liveProject);
      navigate(`project/${liveProject.id}`);
    } catch (error) {
      setSearchState({ status: 'error', message: error.message || t('search.errorNone') });
      trackTokenScanCompleted(match.address, 'error');
      navigate('explore');
    }
  };

  const handleSearch = async () => {
    const term = query.trim();
    if (!term) {
      navigate('explore');
      return;
    }

    if (looksLikeSolanaAddress(term)) {
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
      return;
    }

    // An exact KHAN/GKHAN/$KHAN query always resolves straight to the
    // official token - Dexscreener's index may not have it yet.
    if (isExactOfficialKhanQuery(term)) {
      await resolveSearchMatch(OFFICIAL_KHAN_MATCH);
      return;
    }

    // Not a Solana contract address - treat it as a name/ticker search
    // across chains (e.g. "Bonk", "SOL", a 0x... address on another chain).
    setSearchState({ status: 'loading', message: t('search.searchingMatches') });
    try {
      const matches = await fetchTokenSearchMatches(term);
      if (mentionsKhan(term)) {
        const withoutOfficial = matches.filter((match) => (match.address || '').toLowerCase() !== OFFICIAL_KHAN_CONTRACT.toLowerCase());
        matches.length = 0;
        matches.push(OFFICIAL_KHAN_MATCH, ...withoutOfficial);
      }
      if (!matches.length) {
        setSearchState({ status: 'idle', message: '' });
        navigate('explore');
        return;
      }
      if (matches.length === 1) {
        await resolveSearchMatch(matches[0]);
        return;
      }
      setSearchState({ status: 'choices', message: t('search.multipleMatches', { term }), matches });
    } catch (error) {
      setSearchState({ status: 'idle', message: '' });
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
    // Mirror to the server-synced watchlist for Premium/Early Supporter
    // wallets only - free users keep the existing local-only behavior
    // unchanged. Fire-and-forget: the server rejects writes for wallets
    // without an entitlement anyway, so there's nothing to recover from here.
    if (hasPremium && entitledWallet) toggleServerWatch(entitledWallet, projectId);
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
            onSelectMatch={resolveSearchMatch}
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
            onSelectMatch={resolveSearchMatch}
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
        {page === 'privacy' && <PrivacyPolicyPage />}
        {page === 'terms' && <TermsOfServicePage />}
        {page === 'disclaimer' && <DisclaimerPage />}
        {page === 'contact' && <ContactPage />}
        {page === 'support' && <SupportPage navigate={navigate} />}
        {page === 'admin-verify' && <AdminVerificationPage onReviewed={refreshVerificationMap} />}
        {page === 'admin-analytics' && <AdminAnalyticsPage />}
        {page === 'admin-support' && <AdminSupportPage />}
        {page === 'admin-report' && <AdminReportPage />}
      </main>
      <Footer navigate={navigate} />
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

// An admin who is already signed in (shared sessionStorage token - see
// AdminVerificationPage/AdminAnalyticsPage/AdminSupportPage) should never get
// bounced out to the public Support contact form by the main nav link; they
// stay inside the admin area until they explicitly sign out. Read fresh at
// click/render time rather than caching in state, since the only way this
// changes is a login/logout elsewhere on the same page.
function navTargetFor(itemId) {
  if (itemId === 'support' && getStoredAdminToken()) return 'admin-support';
  return itemId;
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
            <button key={item.id} className={isActive(page, item.id) ? 'active' : ''} onClick={() => navigate(navTargetFor(item.id))}>
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
          <button key={item.id} className={isActive(page, item.id) ? 'active' : ''} onClick={() => navigate(navTargetFor(item.id))}>
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
  if (id === 'support') return page === 'support' || page === 'admin-support';
  return page === id;
}

function HomePage({ projects, query, setQuery, searchState, onSearch, onSelectMatch, onTokenCheck, navigate, openMethodology }) {
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
            <SearchMatches state={searchState} onSelect={onSelectMatch} />
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

function ExplorePage({ projects, query, setQuery, searchState, onSearch, onSelectMatch, activeFilter, setActiveFilter, navigate }) {
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
      <SearchMatches state={searchState} onSelect={onSelectMatch} />
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

// Polls the server-recorded entitlement (see entitlements.js) for whichever
// wallet is currently connected, so Premium UI can reflect a real verified
// payment instead of always showing the locked state.
function useWalletEntitlement() {
  const { address, connected } = useKhanWallet();
  const [entitlement, setEntitlement] = useState(null);

  const refresh = React.useCallback(async () => {
    if (!connected || !address) {
      setEntitlement(null);
      return;
    }
    setEntitlement(await fetchEntitlement(address));
  }, [connected, address]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    entitlement,
    wallet: connected ? address : '',
    hasPremium: hasPlanAccess(entitlement, 'premium'),
    isEarlySupporter: isEarlySupporter(entitlement),
    refresh,
  };
}

// Shared "what you get" list for a plan, filtered to items that are real and
// unlocked today - 'comingSoon' items render with a distinct muted badge
// instead of looking like an active benefit, so the UI never implies a
// feature is included when it isn't built yet.
function PlanFeatureGrid({ items, locked = false }) {
  const { t } = useTranslation();
  return (
    <div className="premium-feature-grid">
      {items.map(([title, text, status]) => (
        <div className={locked ? 'premium-feature locked' : 'premium-feature'} key={title}>
          {locked ? <Lock size={17} /> : status === 'comingSoon' ? <Clock3 size={17} /> : <CheckCircle2 size={17} />}
          <span>
            {title}
            {status === 'comingSoon' && <em className="coming-soon-tag">{t('premium.comingSoonLabel')}</em>}
          </span>
          <p>{text}</p>
        </div>
      ))}
    </div>
  );
}

// Rendered right after a successful payment so the user sees concretely what
// changed, instead of a generic "payment verified" line.
function UnlockedFeaturesMessage({ plan }) {
  const { t } = useTranslation();
  const isEarly = plan === 'early_supporter';
  const items = (isEarly ? t('earlySupporter.items') : t('premium.items')).filter(([, , status]) => status !== 'comingSoon');
  return (
    <div className="unlocked-features-message">
      <strong>{t(isEarly ? 'earlySupporter.unlockedMessageTitle' : 'premium.unlockedMessageTitle')}</strong>
      <ul>
        {items.map(([title]) => (
          <li key={title}><CheckCircle2 size={15} /> {title}</li>
        ))}
      </ul>
      {isEarly && <p className="inline-note">{t('earlySupporter.noInvestmentReminder')}</p>}
    </div>
  );
}

// Small pill shown wherever a connected wallet's identity is displayed, so an
// Early Supporter visibly looks different from a plain Premium subscriber
// instead of sharing the exact same "Premium Active" treatment everywhere.
function EarlySupporterBadge({ compact = false }) {
  const { t } = useTranslation();
  return (
    <span className="early-supporter-badge" title={t('earlySupporter.badgeTooltip')}>
      <Star size={compact ? 12 : 14} /> {t('earlySupporter.badgeLabel')}
    </span>
  );
}

// Real, working Saved Reports - the one Premium/Early Supporter feature that
// previously existed only as marketing copy. Reads/writes go through
// userData.js, which is rejected server-side for any wallet without an
// active entitlement (see netlify/functions/user-data-save.mjs).
function SavedReportsPanel({ wallet, project }) {
  const { t } = useTranslation();
  const [reports, setReports] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const data = await fetchUserData(wallet);
    setReports(data.savedReports || []);
  };

  useEffect(() => {
    if (wallet) load();
  }, [wallet]);

  const isSaved = project && reports?.some((report) => report.projectId === project.id);

  const handleSave = async () => {
    if (!project) return;
    setBusy(true);
    try {
      await saveReport(wallet, {
        projectId: project.id,
        name: project.name,
        ticker: project.ticker,
        contract: project.contract,
        trustScore: project.trustScore,
        riskLevel: project.riskLevel,
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (reportId) => {
    setBusy(true);
    try {
      await removeSavedReport(wallet, reportId);
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="saved-reports-panel">
      <div className="saved-reports-header">
        <strong>{t('premium.savedReports.title')}</strong>
        {project && (
          <button className="secondary-button" type="button" disabled={busy || isSaved} onClick={handleSave}>
            {isSaved ? t('premium.savedReports.alreadySaved') : t('premium.savedReports.saveThisReport')}
          </button>
        )}
      </div>
      {!reports ? (
        <p className="inline-note">{t('common.loading')}</p>
      ) : !reports.length ? (
        <p className="inline-note">{t('premium.savedReports.empty')}</p>
      ) : (
        <ul className="saved-reports-list">
          {reports.map((report) => (
            <li key={report.id}>
              <span>{report.name} ({report.ticker})</span>
              <small>{translateRiskLevel(report.riskLevel)} - {report.trustScore}/100</small>
              <button className="ghost-button" type="button" disabled={busy} onClick={() => handleRemove(report.id)}>
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PremiumLockedSection({ project, navigate }) {
  const { t } = useTranslation();
  const [paymentMessage, setPaymentMessage] = useState('');
  const { hasPremium, isEarlySupporter: isEarly, wallet } = useWalletEntitlement();
  const unlockPremium = async () => {
    const result = await handleUnlockPremiumClick(project, wallet);
    if (!result?.ok) setPaymentMessage(result?.message || stripeUnavailableMessage());
  };

  if (hasPremium) {
    return (
      <section className="detail-section premium-lock-section">
        <SectionTitle icon={CheckCircle2} eyebrow={t(isEarly ? 'earlySupporter.eyebrow' : 'premium.eyebrow')} title={t(isEarly ? 'earlySupporter.activeTitle' : 'premium.activeTitle')} />
        {isEarly && <EarlySupporterBadge />}
        <p className="inline-note verify-success">{t(isEarly ? 'earlySupporter.activeNote' : 'premium.activeNote')}</p>
        <PlanFeatureGrid items={t(isEarly ? 'earlySupporter.items' : 'premium.items')} />
        <SavedReportsPanel wallet={wallet} project={project} />
      </section>
    );
  }

  return (
    <section className="detail-section premium-lock-section">
      <SectionTitle icon={Lock} eyebrow={t('premium.eyebrow')} title={t('premium.unlockToolsTitle')} />
      <p className="inline-note">{t('premium.optionalNote')}</p>
      <PlanFeatureGrid items={t('premium.items')} locked />
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
  const { hasPremium, isEarlySupporter: isEarly, wallet } = useWalletEntitlement();
  const unlockPremium = async () => {
    const result = await handleUnlockPremiumClick(project, wallet);
    if (!result?.ok) setPaymentMessage(result?.message || stripeUnavailableMessage());
  };

  if (hasPremium) {
    return (
      <section className="detail-section one-time-card">
        <SectionTitle icon={CheckCircle2} eyebrow={t(isEarly ? 'earlySupporter.eyebrow' : 'premium.eyebrow')} title={t(isEarly ? 'earlySupporter.activeTitle' : 'premium.activeTitle')} />
        {isEarly && <EarlySupporterBadge />}
        <p className="inline-note verify-success">{t(isEarly ? 'earlySupporter.activeNote' : 'premium.activeNote')}</p>
      </section>
    );
  }

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

function PlanComparisonTable() {
  const { t } = useTranslation();
  const { columns, rows } = t('pricing.comparison');
  const renderCell = (value) => {
    if (value === true) return <CheckCircle2 size={16} className="gold-icon" />;
    if (value === false) return <span className="comparison-dash">-</span>;
    return value;
  };
  return (
    <div className="analytics-table-card comparison-table-card">
      <h4>{t('pricing.comparison.title')}</h4>
      <table className="analytics-table comparison-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([feature, ...values]) => (
            <tr key={feature}>
              <td>{feature}</td>
              {values.map((value, index) => (
                <td key={index}>{renderCell(value)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PricingPage({ navigate }) {
  const { t } = useTranslation();
  const [paymentMessage, setPaymentMessage] = useState('');
  const { entitlement, hasPremium, isEarlySupporter: isEarly, wallet, refresh } = useWalletEntitlement();
  const beginCheckout = async (plan, walletOverride) => {
    const checkoutWallet = walletOverride || wallet;
    const result = plan === 'early_supporter' ? await handleEarlySupporterClick(checkoutWallet) : await handleUnlockPremiumClick(undefined, checkoutWallet);
    if (!result?.ok) setPaymentMessage(result?.message || stripeUnavailableMessage());
  };

  const plans = [
    { ...t('pricing.plans.free'), action: () => navigate('home') },
    { ...t('pricing.plans.premium'), action: () => beginCheckout('premium'), featured: true },
    { ...t('pricing.plans.earlySupporter'), action: () => beginCheckout('early_supporter') },
  ];

  // Combine both plans' real (non-coming-soon) tools for the top value
  // strip, deduped, so it never implies a "coming soon" item is included.
  const activeToolNames = [...new Set([...t('premium.items'), ...t('earlySupporter.items')].filter(([, , status]) => status !== 'comingSoon').map(([title]) => title))];

  return (
    <section className="page-section pricing-page">
      <SectionTitle icon={WalletCards} eyebrow={t('pricing.eyebrow')} title={t('pricing.title')} />
      <p className="pricing-intro">{t('pricing.intro')}</p>
      <p className="pricing-note">{t('pricing.noInvestmentNote')}</p>
      <p className="pricing-note payment-message">
        {t('pricing.launchpadNote', { price: LAUNCHPAD_PAYMENT_MODEL.mainnetPriceLabel })}
      </p>
      {hasPremium && (
        <p className="pricing-note payment-message verify-success">
          {isEarly ? <EarlySupporterBadge compact /> : null}{' '}
          {t(isEarly ? 'earlySupporter.activeNote' : 'premium.activeNote')}
        </p>
      )}
      {paymentMessage && <p className="pricing-note payment-message">{paymentMessage}</p>}
      <div className="premium-value-strip">
        {activeToolNames.map((title) => (
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
      <PlanComparisonTable />
      <PaymentMethodsSection beginCheckout={beginCheckout} onEntitlementChange={refresh} />
      <p className="pricing-note">{t('pricing.footerNote')}</p>
      <Disclaimer />
    </section>
  );
}

function PaymentMethodsSection({ beginCheckout, onEntitlementChange }) {
  return (
    <section className="payment-methods">
      <WalletPaymentSection onEntitlementChange={onEntitlementChange} />
      <CardPaymentSection beginCheckout={beginCheckout} />
      <CryptoPaymentSection onEntitlementChange={onEntitlementChange} />
    </section>
  );
}

// Official token logos (CoinGecko-hosted, same CDN already used elsewhere
// in this app for live token lookups) - purely a visual label for the
// currency picker, no effect on payment logic or which mint is used.
const CURRENCY_OPTIONS = [
  { value: 'USDC', labelKey: 'currencyUsdc', logo: 'https://coin-images.coingecko.com/coins/images/6319/small/usdc.png' },
  { value: 'USDT', labelKey: 'currencyUsdt', logo: 'https://coin-images.coingecko.com/coins/images/325/small/Tether.png' },
  { value: 'SOL', labelKey: 'currencySol', logo: 'https://coin-images.coingecko.com/coins/images/4128/small/solana.png' },
];

function CurrencyLogo({ option, size = 22 }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className="currency-logo currency-logo-fallback" style={{ width: size, height: size }}>
        {option.value.slice(0, 1)}
      </span>
    );
  }
  return (
    <img
      src={option.logo}
      alt=""
      className="currency-logo"
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}

function CurrencySelect({ value, onChange }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selected = CURRENCY_OPTIONS.find((option) => option.value === value) || CURRENCY_OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="currency-select" ref={rootRef}>
      <button
        type="button"
        className="currency-select-trigger"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <CurrencyLogo option={selected} />
        <span>{t(`pricing.payment.${selected.labelKey}`)}</span>
        <ChevronDown size={16} className="currency-select-chevron" />
      </button>
      {open && (
        <ul className="currency-select-menu" role="listbox">
          {CURRENCY_OPTIONS.map((option) => (
            <li key={option.value}>
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={option.value === value ? 'active' : ''}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <CurrencyLogo option={option} />
                <span>{t(`pricing.payment.${option.labelKey}`)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WalletPaymentSection({ onEntitlementChange }) {
  const { t } = useTranslation();
  const { address, connected, connecting, availableWallets, selectAndConnect, sendTransaction, connection } = useKhanWallet();
  const [plan, setPlan] = useState('premium');
  const [currency, setCurrency] = useState('USDC');
  const [status, setStatus] = useState('idle');
  const [message, setMessage] = useState('');
  const walletConfigured = isWalletPaymentConfigured();

  const planPrice = plan === 'early_supporter' ? '29' : '9';

  const payNow = async () => {
    setStatus('paying');
    setMessage('');
    trackCryptoVerifyStarted(plan);
    const result = await payWithConnectedWallet({ connection, publicKey: new PublicKey(address), sendTransaction, plan, currency });
    setStatus(result.ok ? 'verified' : result.status);
    setMessage(result.message || '');
    if (result.ok) {
      trackCryptoVerifySuccess(plan);
      onEntitlementChange?.();
    } else {
      trackCryptoVerifyFailed(plan, result.status);
    }
  };

  return (
    <div className="payment-method-card payment-method-primary">
      <span className="status-badge">{t('pricing.payment.walletBadge')}</span>
      <h3>{t('pricing.payment.walletTitle')}</h3>
      <p>{t('pricing.payment.walletDescription')}</p>

      {!walletConfigured && <p className="inline-note">{t('pricing.payment.cryptoNotConfigured')}</p>}

      {!connected ? (
        <div className="wallet-pay-connect">
          {availableWallets.map((item) => {
            const notReady = item.readyState === 'NotDetected' || item.readyState === 'Unsupported';
            const downloadUrl = WALLET_DOWNLOAD_URLS[item.adapter.name];
            if (notReady && downloadUrl) {
              return (
                <a key={item.adapter.name} className="secondary-button" href={downloadUrl} target="_blank" rel="noreferrer">
                  {t('pricing.payment.installWalletCta', { name: item.adapter.name })}
                </a>
              );
            }
            return (
              <button
                key={item.adapter.name}
                type="button"
                className="secondary-button"
                disabled={notReady}
                onClick={() => selectAndConnect(item.adapter.name)}
              >
                {connecting ? t('walletConnect.connecting') : t('pricing.payment.connectWalletCta', { name: item.adapter.name })}
              </button>
            );
          })}
          {availableWallets.some((item) => item.adapter.name === 'Phantom' && (item.readyState === 'NotDetected' || item.readyState === 'Unsupported')) && (
            <p className="inline-note">{t('walletConnect.notInstalled', { wallet: 'Phantom' })}</p>
          )}
        </div>
      ) : (
        <>
          <label className="form-field">
            <span>{t('pricing.payment.planLabel')}</span>
            <select value={plan} onChange={(event) => setPlan(event.target.value)}>
              <option value="premium">{t('pricing.payment.planPremiumOption')}</option>
              <option value="early_supporter">{t('pricing.payment.planEarlySupporterOption')}</option>
            </select>
          </label>
          <label className="form-field">
            <span>{t('pricing.payment.currencyLabel')}</span>
            <CurrencySelect value={currency} onChange={setCurrency} />
          </label>
          <button
            className="primary-button"
            type="button"
            onClick={payNow}
            disabled={!walletConfigured || status === 'paying'}
          >
            {status === 'paying' ? t('pricing.payment.payingNow') : t('pricing.payment.payNow', { price: planPrice })}
          </button>
          {message && (
            <p className={status === 'verified' ? 'inline-note verify-success' : 'inline-note'}>{message}</p>
          )}
          {status === 'verified' && (
            <>
              <p className="inline-note verify-success">{t('pricing.payment.walletVerifiedFollowUp')}</p>
              <UnlockedFeaturesMessage plan={plan} />
            </>
          )}
        </>
      )}
    </div>
  );
}

function CardPaymentSection({ beginCheckout }) {
  const { t } = useTranslation();
  const { address, connected } = useKhanWallet();
  const cardReady = isStripeConfigured();
  return (
    <div className="payment-method-card">
      <span className="status-badge">{t('pricing.payment.cardBadge')}</span>
      <h3>{t('pricing.payment.cardTitle')}</h3>
      <p>{t('pricing.payment.cardDescription')}</p>
      {!cardReady && <p className="inline-note">{t('pricing.payment.cardNotConfigured')}</p>}
      {cardReady && !connected && <p className="inline-note">{t('pricing.payment.connectWalletFirst')}</p>}
      <div className="payment-action-row">
        <button className="primary-button" type="button" disabled={!cardReady || !connected} onClick={() => beginCheckout('premium', address)}>
          {t('premium.unlockPremium')}
        </button>
        <button className="secondary-button" type="button" disabled={!cardReady || !connected} onClick={() => beginCheckout('early_supporter', address)}>
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

function CryptoPaymentSection({ onEntitlementChange }) {
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
      onEntitlementChange?.();
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
      <p className="inline-note">{t('pricing.payment.backupLabel')}</p>
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
        <>
          <p className="inline-note">{t('pricing.payment.verifiedFollowUp')}</p>
          <UnlockedFeaturesMessage plan={plan} />
        </>
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

function ProjectLogo({ project, size = 40 }) {
  if (project.logoUrl) {
    return <img src={project.logoUrl} alt="" className="project-logo" style={{ width: size, height: size }} />;
  }
  return (
    <span className="project-logo project-logo-placeholder" style={{ width: size, height: size }}>
      {(project.ticker || project.name || '?').trim().slice(0, 1).toUpperCase()}
    </span>
  );
}

function ProjectCard({ project, navigate }) {
  const { t } = useTranslation();
  return (
    <article className="project-card">
      <div className="card-top">
        <div className="card-top-identity">
          <ProjectLogo project={project} size={36} />
          <div>
            <span className="status-badge">{project.status}</span>
            <h3>{project.name}</h3>
            <p>{project.ticker} on {project.chain}</p>
            <VerifiedBadge status={project.verificationStatus} />
          </div>
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
  const { address: profileWallet } = useKhanWallet();
  const unlockPremium = async () => {
    const result = await handleUnlockPremiumClick(project, profileWallet);
    if (!result?.ok) alert(result?.message || stripeUnavailableMessage());
  };
  const [reportModalOpen, setReportModalOpen] = useState(false);

  return (
    <section className="profile-page">
      <div className="profile-hero">
        <div>
          <button className="back-button" onClick={() => navigate('explore')}>{t('projectProfile.backToExplore')}</button>
          <div className="profile-title-row">
            <ProjectLogo project={project} size={48} />
            <h1>{project.name}</h1>
            <span className="ticker-pill">{project.ticker}</span>
            <span className="chain-badge">{project.chain}</span>
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
            <button className="secondary-button" onClick={() => setReportModalOpen(true)}>
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
          <LiveMarketChart project={project} data={project.realData} />
          <CategoryScoreCards project={project} />
          <TrustBreakdown project={project} />
          {project.realData && <RealDataSection project={project} data={project.realData} />}
          <ScamRiskCard project={project} />
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
      {reportModalOpen && (
        <ReportSuggestModal project={project} wallet={profileWallet} onClose={() => setReportModalOpen(false)} />
      )}
    </section>
  );
}

// Real, backend-persisted "Report / Suggest Update" submission - replaces
// the earlier MVP that just showed an alert() and discarded the input. Same
// fallback-to-localStorage-when-functions-unavailable pattern as the
// Support ticket form (see report.js / support.js), so this page's behavior
// and the rest of the site are otherwise untouched.
function ReportSuggestModal({ project, wallet, onClose }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ name: '', email: '', category: 'incorrect_info', subject: '', message: '', company: '' });
  const [attachments, setAttachments] = useState([]);
  const [attachmentError, setAttachmentError] = useState('');
  const [submitState, setSubmitState] = useState({ status: 'idle', message: '' });

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const onAttachmentChange = async (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length > MAX_REPORT_ATTACHMENTS) {
      setAttachmentError(t('report.form.tooManyFiles', { count: MAX_REPORT_ATTACHMENTS }));
      return;
    }
    setAttachmentError('');
    try {
      const converted = await Promise.all(files.map(reportFileToAttachment));
      setAttachments(converted);
    } catch (error) {
      const key = error.code ? `report.form.attachmentErrors.${error.code}` : 'report.form.attachmentErrors.generic';
      setAttachmentError(t(key, error.params));
      setAttachments([]);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    if (form.email.trim() && !EMAIL_PATTERN.test(form.email.trim())) {
      setSubmitState({ status: 'error', message: t('report.form.invalidEmail') });
      return;
    }
    if (!form.subject.trim() || !form.message.trim()) {
      setSubmitState({ status: 'error', message: t('report.form.missingFields') });
      return;
    }
    setSubmitState({ status: 'loading', message: '' });
    try {
      await submitReport({ ...form, projectId: project.id, projectName: project.name, wallet, attachments });
      setSubmitState({ status: 'success', message: t('report.form.successMessage') });
    } catch (error) {
      setSubmitState({ status: 'error', message: error.message || t('report.form.submitFailed') });
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-panel report-modal">
        <header className="ticket-detail-header">
          <strong>{t('report.modalTitle')}</strong>
          <button className="ghost-button" type="button" onClick={onClose}><X size={18} /></button>
        </header>

        {submitState.status === 'success' ? (
          <>
            <p className="lookup-message success">
              {submitState.message.split('\n').map((line, index) => <span key={index}>{line}<br /></span>)}
            </p>
            <button className="secondary-button" type="button" onClick={onClose}>{t('common.close')}</button>
          </>
        ) : (
          <form className="add-form support-form" onSubmit={submit}>
            <p className="legal-lead">{t('report.modalIntro', { name: project.name })}</p>
            <input
              type="text"
              name="company"
              value={form.company}
              onChange={(event) => update('company', event.target.value)}
              autoComplete="off"
              tabIndex={-1}
              aria-hidden="true"
              className="honeypot-field"
            />
            <div className="support-form-grid">
              <FormField label={t('report.form.nameLabel')} value={form.name} onChange={(value) => update('name', value)} placeholder={t('report.form.namePlaceholder')} />
              <FormField label={t('report.form.emailLabel')} type="email" value={form.email} onChange={(value) => update('email', value)} placeholder={t('report.form.emailPlaceholder')} />
            </div>
            <label className="form-field">
              <span>{t('report.form.categoryLabel')}</span>
              <select value={form.category} onChange={(event) => update('category', event.target.value)}>
                {REPORT_CATEGORIES.map((category) => (
                  <option key={category.id} value={category.id}>{t(`report.categories.${category.id}`)}</option>
                ))}
              </select>
            </label>
            <FormField label={t('report.form.subjectLabel')} value={form.subject} onChange={(value) => update('subject', value)} required placeholder={t('report.form.subjectPlaceholder')} />
            <label className="form-field wide">
              <span>{t('report.form.messageLabel')}</span>
              <textarea value={form.message} onChange={(event) => update('message', event.target.value)} required rows={5} placeholder={t('report.form.messagePlaceholder')} />
            </label>
            <label className="form-field wide">
              <span>{t('report.form.attachmentLabel')}</span>
              <input type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" onChange={onAttachmentChange} />
              <small className="inline-note">{t('report.form.attachmentHint')}</small>
            </label>
            {attachments.length > 0 && (
              <ul className="attachment-list">
                {attachments.map((file) => (
                  <li key={file.name}><Paperclip size={14} /> {file.name}</li>
                ))}
              </ul>
            )}
            {attachmentError && <p className="lookup-message error">{attachmentError}</p>}

            <div className="payment-action-row">
              <button className="primary-button" type="submit" disabled={submitState.status === 'loading'}>
                {submitState.status === 'loading' ? t('report.form.sending') : t('report.form.submit')} <Send size={16} />
              </button>
              <button className="secondary-button" type="button" onClick={onClose}>{t('report.form.cancel')}</button>
            </div>
            {submitState.message && submitState.status === 'error' && (
              <p className="lookup-message error">{submitState.message}</p>
            )}
          </form>
        )}
      </div>
    </div>
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

function PriceChangeStat({ label, value }) {
  const { t } = useTranslation();
  if (value === null || value === undefined) {
    return (
      <div className="market-metric">
        <span>{label}</span>
        <strong>{t('common.notAvailable')}</strong>
      </div>
    );
  }
  const positive = Number(value) >= 0;
  const Icon = positive ? TrendingUp : TrendingDown;
  return (
    <div className="market-metric">
      <span>{label}</span>
      <strong className={positive ? 'trend-up' : 'trend-down'}>
        <Icon size={14} /> {formatPercent(value)}
      </strong>
    </div>
  );
}

// Live Market Chart section. Reuses data already fetched by
// lookupSolanaToken/lookupGenericChainToken (dexChainId, pairAddress,
// price/volume/liquidity fields) - no separate fetch, no new API calls.
// The chart's presence/absence never feeds into Trust Score: this
// component only reads `project`/`data` for display and calls no scoring
// function.
// Module-level so the CoinGecko widget script is only ever injected once
// per page session, no matter how many project profiles get viewed.
let coingeckoWidgetScriptPromise = null;
function loadCoingeckoWidgetScript() {
  if (typeof document === 'undefined') return Promise.resolve(false);
  if (coingeckoWidgetScriptPromise) return coingeckoWidgetScriptPromise;
  coingeckoWidgetScriptPromise = new Promise((resolve) => {
    const existing = document.querySelector('script[data-khan-coingecko-widget]');
    if (existing) {
      resolve(true);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://widgets.coingecko.com/gecko-coin-price-chart-widget.js';
    script.async = true;
    script.dataset.khanCoingeckoWidget = 'true';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
  return coingeckoWidgetScriptPromise;
}

const CHART_LOAD_TIMEOUT_MS = 8000;

// Lazy + resilient chart loading:
// - Never mounts the iframe/widget until the chart section actually
//   scrolls into view (IntersectionObserver) - the rest of the page
//   (Trust Score, Risk Analysis, metrics) renders and is interactive
//   immediately regardless of chart state.
// - Primary provider is Dexscreener (real pair required). If no
//   Dexscreener pair exists but the asset is CoinGecko-listed (covers
//   native assets and delisted-from-Dexscreener tokens), falls back to
//   CoinGecko's official embeddable widget - still real market data,
//   never fabricated.
// - An 8s watchdog flips to the fallback state with a Retry button if
//   neither provider's onload fires in time, instead of leaving a
//   perpetual "Loading pair..." iframe.
// Renders the actual iframe/widget element - shared between the inline
// chart frame and the fullscreen modal so both stay in sync with a single
// implementation instead of two copies drifting apart.
function ChartEmbed({ provider, data, retryKey, widgetReady, onLoad, title }) {
  if (provider === 'dexscreener') {
    return (
      <iframe
        key={`${data.pairAddress}-${retryKey}`}
        title={title}
        src={`https://dexscreener.com/${data.dexChainId}/${data.pairAddress}?embed=1&theme=dark&trades=0&info=0`}
        loading="lazy"
        onLoad={onLoad}
      />
    );
  }
  if (provider === 'coingecko' && widgetReady) {
    return (
      <gecko-coin-price-chart-widget
        key={`${data.coingeckoId}-${retryKey}`}
        locale="en"
        transparent-background="true"
        coin-id={data.coingeckoId}
        initial-currency="usd"
      />
    );
  }
  return null;
}

function LiveMarketChart({ project, data }) {
  const { t } = useTranslation();
  const m = t('profileSections.marketChart');
  const hasPair = Boolean(data?.dexChainId && data?.pairAddress);
  const hasCoingeckoFallback = Boolean(data?.coingeckoId);
  const provider = hasPair ? 'dexscreener' : (hasCoingeckoFallback ? 'coingecko' : 'none');

  const sectionRef = useRef(null);
  const timeoutRef = useRef(null);
  const [inView, setInView] = useState(false);
  const [chartStatus, setChartStatus] = useState('loading'); // loading | loaded | timeout
  const [retryKey, setRetryKey] = useState(0);
  const [widgetReady, setWidgetReady] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event) => {
      if (event.key === 'Escape') setFullscreen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  useEffect(() => {
    if (provider === 'none' || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const node = sectionRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setInView(true);
        observer.disconnect();
      }
    }, { threshold: 0.1, rootMargin: '200px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [provider]);

  useEffect(() => {
    if (!inView || provider === 'none') return;
    setChartStatus('loading');
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setChartStatus((status) => (status === 'loaded' ? status : 'timeout')), CHART_LOAD_TIMEOUT_MS);
    if (provider === 'coingecko') {
      setWidgetReady(false);
      loadCoingeckoWidgetScript().then((ok) => {
        setWidgetReady(ok);
        // The custom element doesn't reliably emit a React-visible "load"
        // event, but a successfully loaded widget script is itself a real
        // signal the provider is available - the watchdog timeout above
        // still catches a genuinely broken/blocked script load.
        setChartStatus(ok ? 'loaded' : 'timeout');
      });
    }
    return () => clearTimeout(timeoutRef.current);
  }, [inView, provider, retryKey]);

  const retryChart = () => {
    clearTimeout(timeoutRef.current);
    setRetryKey((value) => value + 1);
  };

  const showSkeleton = provider !== 'none' && inView && chartStatus === 'loading';
  const showChart = provider !== 'none' && inView && chartStatus !== 'timeout';
  const showFallback = provider === 'none' || chartStatus === 'timeout';

  return (
    <section className="detail-section" ref={sectionRef}>
      <SectionTitle icon={LineChart} eyebrow={m.eyebrow} title={m.title} />
      <div className="market-status-row">
        <span className={`status-badge ${provider !== 'none' && chartStatus !== 'timeout' ? 'market-live' : 'market-unavailable'}`}>
          {provider === 'dexscreener' ? m.statusLive : provider === 'coingecko' ? m.statusFallback : m.statusUnavailable}
        </span>
        {data?.dexId && <span className="chain-badge">{data.dexId}</span>}
        {showChart && (
          <button type="button" className="ghost-button market-fullscreen-btn" onClick={() => setFullscreen(true)}>
            <Maximize2 size={15} /> {m.openLarge}
          </button>
        )}
      </div>

      <div className="market-chart-frame" style={{ display: showChart ? 'block' : 'none' }}>
        {showSkeleton && <div className="skeleton-block market-chart-skeleton" />}
        {!fullscreen && (
          <div style={{ visibility: showSkeleton ? 'hidden' : 'visible', position: 'absolute', inset: 0 }}>
            <ChartEmbed provider={provider} data={data} retryKey={retryKey} widgetReady={widgetReady} title={m.title} onLoad={() => setChartStatus('loaded')} />
          </div>
        )}
      </div>

      {fullscreen && (
        <div className="modal-backdrop market-fullscreen-modal" role="dialog" aria-modal="true" aria-label={m.title}>
          <div className="modal-panel market-fullscreen-panel">
            <button className="close-button" onClick={() => setFullscreen(false)} aria-label={t('common.close')}><X size={20} /></button>
            <div className="market-chart-frame market-chart-frame-large">
              <ChartEmbed provider={provider} data={data} retryKey={retryKey} widgetReady={widgetReady} title={m.title} onLoad={() => {}} />
            </div>
          </div>
        </div>
      )}

      {showFallback && (
        <div className="market-chart-fallback">
          <LineChart size={28} />
          <p>{chartStatus === 'timeout' ? m.timeout : m.fallback}</p>
          {provider !== 'none' && (
            <button type="button" className="secondary-button" onClick={retryChart}>
              <RefreshCw size={15} /> {m.retry}
            </button>
          )}
        </div>
      )}

      <div className="market-metrics-grid">
        <div className="market-metric">
          <span>{m.price}</span>
          <strong>{data?.priceUsd ? formatTinyOrCurrency(data.priceUsd) : t('common.notAvailable')}</strong>
        </div>
        <div className="market-metric">
          <span>{marketCapLabel(m.marketCap, data)}</span>
          <strong>{data?.marketCapUsd ? formatCurrency(data.marketCapUsd) : t('common.notAvailable')}</strong>
        </div>
        <div className="market-metric">
          <span>{m.liquidity}</span>
          <strong>{(data?.totalLiquidityUsd ?? data?.liquidityUsd) ? formatCurrency(data.totalLiquidityUsd ?? data.liquidityUsd) : t('common.notAvailable')}</strong>
        </div>
        <div className="market-metric">
          <span>{m.volume24h}</span>
          <strong>{data?.volume24hUsd ? formatCurrency(data.volume24hUsd) : t('common.notAvailable')}</strong>
        </div>
        <PriceChangeStat label={m.change5m} value={data?.priceChange5m} />
        <PriceChangeStat label={m.change1h} value={data?.priceChange1h} />
        <PriceChangeStat label={m.change6h} value={data?.priceChange6h} />
        <PriceChangeStat label={m.change24h} value={data?.priceChange24h} />
        <div className="market-metric">
          <span>{m.buys24h}</span>
          <strong>{data?.buys24h !== null && data?.buys24h !== undefined ? formatNumber(data.buys24h) : t('common.notAvailable')}</strong>
        </div>
        <div className="market-metric">
          <span>{m.sells24h}</span>
          <strong>{data?.sells24h !== null && data?.sells24h !== undefined ? formatNumber(data.sells24h) : t('common.notAvailable')}</strong>
        </div>
        <div className="market-metric">
          <span>{m.dex}</span>
          <strong>{data?.dexId || t('common.notAvailable')}</strong>
        </div>
        <div className="market-metric">
          <span>{m.pair}</span>
          <strong>{data?.baseSymbol && data?.quoteSymbol ? `${data.baseSymbol} / ${data.quoteSymbol}` : t('common.notAvailable')}</strong>
        </div>
        <div className="market-metric market-metric-wide">
          <span>{m.pairAddress}</span>
          <strong>{data?.pairAddress ? <code>{data.pairAddress}</code> : t('common.notAvailable')}</strong>
        </div>
      </div>
      {data?.pairUrl && (
        <a className="data-link" href={data.pairUrl} target="_blank" rel="noreferrer">
          {t('profileSections.viewMarketPair')} <ExternalLink size={16} />
        </a>
      )}
    </section>
  );
}

const CATEGORY_ICONS = {
  contractSecurity: Lock,
  liquidity: BarChart3,
  holderHealth: Users,
  marketActivity: Activity,
  community: Globe2,
};

function CategoryScoreCards({ project }) {
  const { t } = useTranslation();
  const categories = project.categoryBreakdown || [];
  if (!categories.length) return null;
  const labels = t('profileSections.categoryLabels');
  const explainers = t('profileSections.categoryExplainers');

  return (
    <section className="detail-section">
      <SectionTitle icon={Shield} eyebrow={t('profileSections.categoryEyebrow')} title={t('profileSections.categoryTitle')} />
      <div className="category-grid">
        {categories.map((category) => {
          const Icon = CATEGORY_ICONS[category.key] || Shield;
          const tone = category.score === null ? 'limited' : category.score >= 70 ? 'good' : category.score >= 45 ? 'medium' : 'poor';
          return (
            <div className={`category-card category-${tone}`} key={category.key} title={explainers[category.key]}>
              <div className="category-card-head">
                <Icon size={18} />
                <span>{labels[category.key]}</span>
              </div>
              <strong>{category.score === null ? t('common.notAvailable') : `${category.outOf20}/20`}</strong>
              <div className="category-card-bar">
                <i style={{ width: `${category.score || 0}%` }} />
              </div>
              <p>{explainers[category.key]}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ScamRiskCard({ project }) {
  const { t } = useTranslation();
  const scamRisk = project.scamRisk;
  if (!scamRisk) return null;
  const toneClass = scamRisk.level === 'High' ? 'high' : scamRisk.level === 'Medium' ? 'medium' : 'low';
  return (
    <section className="detail-section">
      <SectionTitle icon={AlertTriangle} eyebrow={t('profileSections.scamRiskEyebrow')} title={t('profileSections.scamRiskTitle')} />
      <div className="result-score-row">
        <span className={`risk-pill ${toneClass}`}>{t(`profileSections.scamRiskLevel.${toneClass}`)}</span>
        <strong>{scamRisk.riskScore}/100</strong>
      </div>
      {scamRisk.reasons.length ? (
        <ul className="scam-risk-reasons">
          {scamRisk.reasons.map((reason) => (
            <li key={reason}><AlertTriangle size={14} /> {reason}</li>
          ))}
        </ul>
      ) : (
        <p className="inline-note">{t('profileSections.scamRiskNone')}</p>
      )}
      <p className="inline-note scam-risk-coverage">{t('profileSections.scamRiskCoverage')}</p>
    </section>
  );
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

function marketCapLabel(baseLabel, data) {
  return data?.marketCapIsFdv ? `${baseLabel} (FDV)` : baseLabel;
}

function CommunityProof({ project }) {
  const { t } = useTranslation();
  const s = t('profileSections.communityProofStats');
  const stats = [
    [s.holderCount, formatNumber(project.holders), WalletCards],
    [s.topHolder, project.realData ? formatPercent(project.realData.topHolderPercent) : t('common.notConnected'), Shield],
    [s.liquidity, project.realData ? formatCurrency(project.realData.totalLiquidityUsd ?? project.realData.liquidityUsd) : t('common.notConnected'), BarChart3],
    [marketCapLabel(s.marketCap, project.realData), project.realData ? formatCurrency(project.realData.marketCapUsd) : t('common.notConnected'), LineChart],
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
    [r.holderCount, data.holderSource ? `${formatNumber(data.holderCount)} (${data.holderSource})` : formatNumber(data.holderCount), Users],
    [r.largestHolder, formatPercent(data.topHolderPercent), WalletCards],
    [r.topTenHolders, formatPercent(data.topTenHolderPercent), Shield],
    [r.holderRiskLevel, holderRiskLevel(data), AlertTriangle],
    [r.concentrationStatus, holderConcentrationStatus(data), FileWarning],
    [r.liquidityUsd, formatCurrency(data.totalLiquidityUsd ?? data.liquidityUsd), BarChart3],
    [marketCapLabel(r.marketCapUsd, data), formatCurrency(data.marketCapUsd), LineChart],
    [r.tokenAge, data.tokenAgeSource ? `${formatAge(data.tokenAgeDays)} (${data.tokenAgeSource})` : formatAge(data.tokenAgeDays), CalendarDays],
    [r.trustScore, `${project.trustScore}/100`, BadgeCheck],
    [r.website, socialPresenceState('website', project, data), Globe2],
    [r.twitter, socialPresenceState('twitter', project, data), ExternalLink],
    [r.telegram, socialPresenceState('telegram', project, data), MessageCircle],
    [r.github, socialPresenceState('github', project, data), Github],
    [r.discord, socialPresenceState('discord', project, data), MessageCircle],
    [r.priceUsd, data.priceUsd ? formatTinyOrCurrency(data.priceUsd) : t('common.notAvailable'), LineChart],
    [r.priceChange24h, formatPercent(data.priceChange24h), TrendingUp],
    [r.volume24h, data.volume24hUsd ? formatCurrency(data.volume24hUsd) : t('common.notAvailable'), BarChart3],
    [r.buySellRatio, data.buys24h !== null && data.buys24h !== undefined ? `${formatNumber(data.buys24h)} / ${formatNumber(data.sells24h)}` : t('common.notAvailable'), Activity],
    [r.ath, data.ath ? formatTinyOrCurrency(data.ath) : t('common.notAvailable'), LineChart],
    [r.supply, data.supply ? formatNumber(data.supply) : t('common.notAvailable'), WalletCards],
    [r.holderGrowth, data.holderGrowthPercent === null ? t('profileSections.holderGrowthNeedsLookup') : formatPercent(data.holderGrowthPercent), TrendingUp],
    [r.poolsFound, formatNumber(data.poolCount), Layers3],
    [r.liquidityConcentration, formatPercent(data.topPoolConcentrationPercent), BarChart3],
    [r.coingeckoListed, data.coingeckoListed ? t('common.yes') : (data.coingeckoListed === false ? t('common.no') : t('common.notAvailable')), BadgeCheck],
    [r.contractSecurity, contractSecuritySummary(data), Lock],
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
      <span>{t('liveDataPreview.marketCap', { value: `${formatCurrency(data.marketCapUsd)}${data.marketCapIsFdv ? ' (FDV)' : ''}` })}</span>
      <span>{t('liveDataPreview.tokenAge', { value: formatAge(data.tokenAgeDays) })}</span>
      <span>{t('liveDataPreview.holderSignal', { count: formatNumber(data.holderCount), source: data.holderSource || t('common.notAvailable') })}</span>
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
      <button className="secondary-button admin-cross-link" type="button" onClick={() => { window.location.hash = '/admin-support'; window.dispatchEvent(new HashChangeEvent('hashchange')); }}>
        <LifeBuoy size={18} /> {t('adminSupport.openSupport')}
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

function StatCard({ icon: Icon, label, value, numericValue, sublabel }) {
  return (
    <div className="analytics-stat-card">
      <Icon size={20} />
      <strong>{numericValue !== undefined ? <AnimatedNumber value={numericValue} format={(n) => n.toLocaleString('en-US')} /> : value}</strong>
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
        <div className="skeleton-stat-grid" aria-hidden="true">
          {Array.from({ length: 8 }).map((_, index) => (
            <div className="skeleton-block" key={index} />
          ))}
        </div>
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
        <button className="secondary-button" type="button" onClick={() => { window.location.hash = '/admin-support'; window.dispatchEvent(new HashChangeEvent('hashchange')); }}>
          <LifeBuoy size={16} /> {t('adminSupport.openSupport')}
        </button>
        <button className="ghost-button" type="button" onClick={logout}>{t('common.signOut')}</button>
      </div>
      <p className="analytics-meta">{t('adminAnalytics.generated', { date: new Date(summary.generatedAt).toLocaleString(), count: summary.eventCount })}</p>

      <div className="analytics-stat-grid">
        <StatCard icon={Activity} label={t('adminAnalytics.totalScans')} numericValue={summary.overview.totalScans} />
        <StatCard icon={Layers3} label={t('adminAnalytics.totalProjects')} numericValue={summary.overview.totalProjects} />
        <StatCard icon={BadgeCheck} label={t('adminAnalytics.verifiedProjects')} numericValue={summary.overview.verifiedProjects} />
        <StatCard icon={LineChart} label={t('adminAnalytics.averageTrustScore')} value={summary.trustScoreAnalytics.average ?? 'N/A'} sublabel={t('adminAnalytics.scoredProjects', { count: summary.trustScoreAnalytics.sampleSize })} />
        <StatCard icon={Users} label={t('adminAnalytics.totalUsers')} numericValue={summary.overview.totalUsers} sublabel={t('adminAnalytics.uniqueVisitors')} />
        <StatCard icon={Search} label={t('adminAnalytics.topSearches')} value={summary.popularSearches[0]?.query || 'N/A'} sublabel={summary.popularSearches[0] ? `${summary.popularSearches[0].count} ${t('adminAnalytics.columns').count}` : ''} />
        <StatCard icon={Clock3} label={t('adminAnalytics.pendingVerification')} numericValue={summary.overview.pendingVerification} />
        <StatCard icon={X} label={t('adminAnalytics.rejectedVerification')} numericValue={summary.overview.rejectedVerification} />
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

function SearchMatches({ state, onSelect }) {
  const { t } = useTranslation();
  if (state.status !== 'choices' || !state.matches?.length) return null;
  return (
    <div className="search-matches">
      {state.matches.map((match) => (
        <button
          key={match.chainId === 'native' ? `native-${match.coingeckoId}` : `${match.chainId}-${match.address}`}
          type="button"
          className="search-match-row"
          onClick={() => onSelect(match)}
        >
          {match.logoUrl ? (
            <img src={match.logoUrl} alt="" className="search-match-logo" />
          ) : (
            <span className="search-match-logo search-match-logo-placeholder">{(match.symbol || '?').slice(0, 1)}</span>
          )}
          <span className="search-match-info">
            <strong>{match.name || match.symbol}</strong>
            <small>{match.symbol} · {match.chain}</small>
          </span>
          {match.marketCap > 0 && <span className="search-match-mcap">{formatCurrency(match.marketCap)}</span>}
          {match.verified && <BadgeCheck size={16} className="search-match-verified" aria-label={t('search.verified')} />}
        </button>
      ))}
    </div>
  );
}

// Counts up from 0 to `value` once the element scrolls into view, purely as
// a presentational micro-interaction - the underlying number/logic this
// wraps is unchanged, this only affects how it's drawn on screen.
function AnimatedNumber({ value, duration = 900, format }) {
  const ref = useRef(null);
  const [display, setDisplay] = useState(0);
  const numericValue = Number(value);
  const isAnimatable = Number.isFinite(numericValue);

  useEffect(() => {
    if (!isAnimatable) return;
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setDisplay(numericValue);
      return;
    }
    let frame;
    const animate = () => {
      const start = performance.now();
      const from = 0;
      const step = (now) => {
        const progress = Math.min((now - start) / duration, 1);
        const eased = 1 - (1 - progress) ** 3;
        setDisplay(Math.round(from + (numericValue - from) * eased));
        if (progress < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    };
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        animate();
        observer.disconnect();
      }
    }, { threshold: 0.3 });
    observer.observe(node);
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [numericValue, duration, isAnimatable]);

  if (!isAnimatable) return <span ref={ref}>{value}</span>;
  return <span ref={ref}>{format ? format(display) : display}</span>;
}

function ScoreCircle({ score, size = 'normal' }) {
  const { t } = useTranslation();
  const style = { '--score': `${score * 3.6}deg` };
  return (
    <div className={`score-circle ${size}`} style={style}>
      <span><AnimatedNumber value={score} /></span>
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

function usePageSeo(title, description) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title;
    let meta = document.querySelector('meta[name="description"]');
    let createdMeta = false;
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'description');
      document.head.appendChild(meta);
      createdMeta = true;
    }
    const previousDescription = meta.getAttribute('content');
    meta.setAttribute('content', description);
    return () => {
      document.title = previousTitle;
      if (createdMeta) {
        meta.remove();
      } else if (previousDescription !== null) {
        meta.setAttribute('content', previousDescription);
      }
    };
  }, [title, description]);
}

const footerQuickLinks = [
  { id: 'home', label: 'nav.home' },
  { id: 'explore', label: 'nav.explore' },
  { id: 'compare', label: 'nav.compare' },
  { id: 'launchpad', label: 'nav.launchpad' },
  { id: 'whitepaper', label: 'nav.whitepaper' },
  { id: 'pricing', label: 'nav.pricing' },
];

const footerLegalLinks = [
  { id: 'privacy', label: 'footer.legal.privacy' },
  { id: 'terms', label: 'footer.legal.terms' },
  { id: 'disclaimer', label: 'footer.legal.disclaimer' },
  { id: 'contact', label: 'footer.legal.contact' },
];

function Footer({ navigate }) {
  const { t } = useTranslation();
  const goTo = (id) => {
    if (navigate) navigate(id);
    else window.location.hash = `/${id}`;
  };
  return (
    <footer className="site-footer">
      <div className="footer-grid">
        <div className="footer-brand">
          <span className="brand">
            <span className="brand-mark">K</span>
            <span>
              <strong>KHAN Trust</strong>
            </span>
          </span>
          <p>{t('footer.tagline')}</p>
        </div>
        <div className="footer-column">
          <h4>{t('footer.quickLinksTitle')}</h4>
          <nav>
            {footerQuickLinks.map((item) => (
              <button key={item.id} type="button" onClick={() => goTo(item.id)}>
                {t(item.label)}
              </button>
            ))}
          </nav>
        </div>
        <div className="footer-column">
          <h4>{t('footer.legalTitle')}</h4>
          <nav>
            {footerLegalLinks.map((item) => (
              <button key={item.id} type="button" onClick={() => goTo(item.id)}>
                {t(item.label)}
              </button>
            ))}
          </nav>
        </div>
      </div>
      <div className="footer-bottom">
        <span>{t('footer.copyright', { year: 2026 })}</span>
      </div>
    </footer>
  );
}

function PrivacyPolicyPage() {
  const { t } = useTranslation();
  usePageSeo(`${t('privacy.title')} | KHAN Trust`, t('privacy.seoDescription'));
  return (
    <section className="page-section legal-page">
      <SectionTitle icon={Shield} eyebrow={t('privacy.eyebrow')} title={t('privacy.title')} />
      <p className="legal-updated">{t('privacy.lastUpdated')}</p>
      <div className="about-panel legal-panel">
        {t('privacy.sections').map(([heading, body]) => (
          <div className="legal-section" key={heading}>
            <h3>{heading}</h3>
            <p>{body}</p>
          </div>
        ))}
      </div>
      <Disclaimer text={t('disclaimer.default')} />
    </section>
  );
}

function TermsOfServicePage() {
  const { t } = useTranslation();
  usePageSeo(`${t('terms.title')} | KHAN Trust`, t('terms.seoDescription'));
  return (
    <section className="page-section legal-page">
      <SectionTitle icon={FileText} eyebrow={t('terms.eyebrow')} title={t('terms.title')} />
      <p className="legal-updated">{t('terms.lastUpdated')}</p>
      <div className="about-panel legal-panel">
        {t('terms.sections').map(([heading, body]) => (
          <div className="legal-section" key={heading}>
            <h3>{heading}</h3>
            <p>{body}</p>
          </div>
        ))}
      </div>
      <Disclaimer text={t('disclaimer.default')} />
    </section>
  );
}

function DisclaimerPage() {
  const { t } = useTranslation();
  usePageSeo(`${t('disclaimerPage.title')} | KHAN Trust`, t('disclaimerPage.seoDescription'));
  return (
    <section className="page-section legal-page">
      <SectionTitle icon={AlertTriangle} eyebrow={t('disclaimerPage.eyebrow')} title={t('disclaimerPage.title')} />
      <div className="about-panel legal-panel">
        <p className="legal-lead">{t('disclaimerPage.lead')}</p>
        {t('disclaimerPage.points').map((point) => (
          <p className="legal-point" key={point}><AlertTriangle size={16} /> {point}</p>
        ))}
      </div>
    </section>
  );
}

function ContactPage() {
  const { t } = useTranslation();
  usePageSeo(`${t('contact.title')} | KHAN Trust`, t('contact.seoDescription'));
  const channels = [
    { icon: Mail, label: t('contact.emailLabel'), value: t('contact.emailValue'), href: 'mailto:Xankiwiyev3366@gmail.com' },
    { icon: MessageCircle, label: t('contact.telegramLabel'), value: t('contact.telegramValue'), href: 'https://t.me/+RXCuwpSNwikzNTE0' },
    { icon: X, label: t('contact.xLabel'), value: t('contact.xValue'), href: 'https://x.com/KXankiwiyev3366' },
    { icon: Github, label: t('contact.githubLabel'), value: t('contact.githubValue'), href: `https://${t('contact.githubValue').replace(/^https?:\/\//, '')}` },
  ];
  return (
    <section className="page-section legal-page">
      <SectionTitle icon={Mail} eyebrow={t('contact.eyebrow')} title={t('contact.title')} />
      <p className="legal-lead">{t('contact.intro')}</p>
      <div className="contact-grid">
        {channels.map((channel) => {
          const Icon = channel.icon;
          const isEmail = channel.href.startsWith('mailto:');
          return (
            <a
              className="contact-card"
              key={channel.label}
              href={channel.href}
              target={isEmail ? undefined : '_blank'}
              rel={isEmail ? undefined : 'noopener noreferrer'}
              aria-label={`${channel.label}: ${channel.value}`}
            >
              <Icon size={20} className="gold-icon" />
              <h3>{channel.label}</h3>
              <p>{channel.value}</p>
            </a>
          );
        })}
      </div>
      <div className="about-panel legal-panel">
        <p>{t('contact.partnership')}</p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Support & Messaging Center - user-facing contact form + ticket history.
// Tickets live server-side (see netlify/functions/support-*.mjs); the admin
// side (AdminSupportPage below) reuses the same shared admin token as the
// verification review and analytics dashboards.
// ---------------------------------------------------------------------------

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function ticketStatusLabel(status) {
  return translate(`support.statusLabels.${status}`) || status;
}

function ticketPriorityLabel(priority) {
  return translate(`support.priorityLabels.${priority}`) || priority;
}

function SupportPage({ navigate }) {
  const { t } = useTranslation();
  usePageSeo(`${t('support.title')} | KHAN Trust`, t('support.seoDescription'));
  const { address, connected } = useKhanWallet();

  // Public Support is for end users only - an admin who lands here directly
  // (typed URL, stale bookmark, etc.) belongs in the Admin Support Center
  // instead, same as the main nav link already redirects them.
  useEffect(() => {
    if (getStoredAdminToken()) navigate?.('admin-support');
  }, []);

  const [form, setForm] = useState({ name: '', email: '', subject: '', category: 'general', message: '', company: '' });
  const [attachments, setAttachments] = useState([]);
  const [attachmentError, setAttachmentError] = useState('');
  const [submitState, setSubmitState] = useState({ status: 'idle', message: '', ticketId: '' });
  const [lookupEmail, setLookupEmail] = useState('');
  const [myTickets, setMyTickets] = useState(null);
  const [lookupState, setLookupState] = useState({ status: 'idle', message: '' });

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const wallet = connected ? address : '';

  const onAttachmentChange = async (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length > MAX_ATTACHMENTS) {
      setAttachmentError(t('support.form.tooManyFiles', { count: MAX_ATTACHMENTS }));
      return;
    }
    setAttachmentError('');
    try {
      const converted = await Promise.all(files.map(fileToAttachment));
      setAttachments(converted);
    } catch (error) {
      const key = error.code ? `support.form.attachmentErrors.${error.code}` : 'support.form.attachmentErrors.generic';
      setAttachmentError(t(key, error.params));
      setAttachments([]);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!EMAIL_PATTERN.test(form.email.trim())) {
      setSubmitState({ status: 'error', message: t('support.form.invalidEmail'), ticketId: '' });
      return;
    }
    if (!form.subject.trim() || !form.message.trim()) {
      setSubmitState({ status: 'error', message: t('support.form.missingFields'), ticketId: '' });
      return;
    }
    setSubmitState({ status: 'loading', message: '', ticketId: '' });
    try {
      const result = await submitSupportTicket({ ...form, wallet, attachments });
      setSubmitState({ status: 'success', message: t('support.form.successMessage'), ticketId: result.ticketId });
      setForm({ name: '', email: form.email, subject: '', category: 'general', message: '', company: '' });
      setAttachments([]);
    } catch (error) {
      setSubmitState({ status: 'error', message: error.message || t('support.form.submitFailed'), ticketId: '' });
    }
  };

  const lookupTickets = async (event) => {
    event.preventDefault();
    const email = lookupEmail.trim();
    if (!email && !wallet) {
      setLookupState({ status: 'error', message: t('support.history.needEmailOrWallet') });
      return;
    }
    setLookupState({ status: 'loading', message: '' });
    try {
      const tickets = await fetchMyTickets({ email, wallet });
      setMyTickets(tickets);
      setLookupState({ status: 'idle', message: '' });
    } catch (error) {
      setLookupState({ status: 'error', message: error.message || t('support.history.lookupFailed') });
    }
  };

  return (
    <section className="page-section support-page">
      <SectionTitle icon={LifeBuoy} eyebrow={t('support.eyebrow')} title={t('support.title')} />
      <p className="legal-lead">{t('support.intro')}</p>

      <form className="add-form support-form" onSubmit={submit}>
        <input
          type="text"
          name="company"
          value={form.company}
          onChange={(event) => update('company', event.target.value)}
          autoComplete="off"
          tabIndex={-1}
          aria-hidden="true"
          className="honeypot-field"
        />
        <div className="support-form-grid">
          <FormField label={t('support.form.nameLabel')} value={form.name} onChange={(value) => update('name', value)} placeholder={t('support.form.namePlaceholder')} />
          <FormField label={t('support.form.emailLabel')} type="email" value={form.email} onChange={(value) => update('email', value)} required placeholder={t('support.form.emailPlaceholder')} />
        </div>
        <label className="form-field">
          <span>{t('support.form.walletLabel')}</span>
          <input type="text" value={wallet || t('support.form.walletNotConnected')} disabled />
        </label>
        <FormField label={t('support.form.subjectLabel')} value={form.subject} onChange={(value) => update('subject', value)} required placeholder={t('support.form.subjectPlaceholder')} />
        <label className="form-field">
          <span>{t('support.form.categoryLabel')}</span>
          <select value={form.category} onChange={(event) => update('category', event.target.value)}>
            {TICKET_CATEGORIES.map((category) => (
              <option key={category.id} value={category.id}>{t(`support.categories.${category.id}`)}</option>
            ))}
          </select>
        </label>
        <label className="form-field wide">
          <span>{t('support.form.messageLabel')}</span>
          <textarea value={form.message} onChange={(event) => update('message', event.target.value)} required rows={6} placeholder={t('support.form.messagePlaceholder')} />
        </label>
        <label className="form-field wide">
          <span>{t('support.form.attachmentLabel')}</span>
          <input type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" onChange={onAttachmentChange} />
          <small className="inline-note">{t('support.form.attachmentHint')}</small>
        </label>
        {attachments.length > 0 && (
          <ul className="attachment-list">
            {attachments.map((file) => (
              <li key={file.name}><Paperclip size={14} /> {file.name}</li>
            ))}
          </ul>
        )}
        {attachmentError && <p className="lookup-message error">{attachmentError}</p>}

        <button className="primary-button wide-button" type="submit" disabled={submitState.status === 'loading'}>
          {submitState.status === 'loading' ? t('support.form.sending') : t('support.form.submit')} <Send size={18} />
        </button>
        {submitState.message && (
          <p className={submitState.status === 'success' ? 'lookup-message success' : 'lookup-message error'}>
            {submitState.message}
            {submitState.ticketId && ` (${t('support.form.ticketIdLabel')}: ${submitState.ticketId})`}
          </p>
        )}
      </form>

      <div className="about-panel legal-panel support-history-panel">
        <h3>{t('support.history.title')}</h3>
        <p>{t('support.history.intro')}</p>
        <form className="support-lookup-form" onSubmit={lookupTickets}>
          <input
            type="email"
            value={lookupEmail}
            onChange={(event) => setLookupEmail(event.target.value)}
            placeholder={t('support.history.emailPlaceholder')}
          />
          <button className="secondary-button" type="submit" disabled={lookupState.status === 'loading'}>
            {t('support.history.lookupCta')}
          </button>
        </form>
        {wallet && <p className="inline-note">{t('support.history.walletHint', { wallet })}</p>}
        {lookupState.message && <p className="lookup-message error">{lookupState.message}</p>}
        {myTickets && !myTickets.length && <EmptyState title={t('support.history.emptyTitle')} text={t('support.history.emptyText')} />}
        {myTickets && myTickets.length > 0 && (
          <div className="my-tickets-list">
            {myTickets.map((ticket) => (
              <article className="my-ticket-card" key={ticket.id}>
                <header>
                  <strong>{ticket.subject}</strong>
                  <span className={`status-badge ticket-status-${ticket.status}`}>{ticketStatusLabel(ticket.status)}</span>
                </header>
                <p className="inline-note">{ticket.id} - {new Date(ticket.createdAt).toLocaleString()}</p>
                <p>{ticket.message}</p>
                {ticket.replies?.length > 0 && (
                  <div className="ticket-reply-thread">
                    {ticket.replies.map((reply, index) => (
                      <div className="ticket-reply" key={index}>
                        <strong>{t('support.history.teamReply')}</strong>
                        <p>{reply.message}</p>
                        <small>{new Date(reply.createdAt).toLocaleString()}</small>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function TicketAttachmentPreview({ attachment }) {
  if (attachment.type?.startsWith('image/') && attachment.data) {
    return <img className="attachment-preview-image" src={attachment.data} alt={attachment.name} />;
  }
  return (
    <a className="attachment-preview-file" href={attachment.data} download={attachment.name} target="_blank" rel="noreferrer">
      <FileText size={16} /> {attachment.name}
    </a>
  );
}

function AdminSupportTicketDetail({ token, ticketId, onClose, onChanged }) {
  const { t } = useTranslation();
  const [ticket, setTicket] = useState(null);
  const [replyMessage, setReplyMessage] = useState('');
  const [notes, setNotes] = useState('');
  const [assignee, setAssignee] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const data = await fetchSupportTicket(token, ticketId);
      setTicket(data);
      setNotes(data?.adminNotes || '');
      setAssignee(data?.assignedTo || '');
    } catch (err) {
      setError(err.message || t('adminSupport.loadTicketFailed'));
    }
  };

  useEffect(() => {
    load();
  }, [ticketId]);

  const runAction = async (fn) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
      await onChanged?.();
    } catch (err) {
      setError(err.message || t('adminSupport.actionFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (!ticket) {
    return (
      <div className="modal-backdrop" role="dialog" aria-modal="true">
        <div className="modal-panel ticket-detail-modal">
          <p className="lookup-message">{error || t('adminSupport.loadingTicket')}</p>
          <button className="secondary-button" type="button" onClick={onClose}>{t('common.close')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Ticket detail">
      <div className="modal-panel ticket-detail-modal">
        <header className="ticket-detail-header">
          <div>
            <strong>{ticket.subject}</strong>
            <p className="inline-note">{ticket.id}</p>
          </div>
          <button className="ghost-button" type="button" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="ticket-detail-grid">
          <p><strong>{t('adminSupport.columns.name')}:</strong> {ticket.name || t('common.notAvailable')}</p>
          <p><strong>{t('adminSupport.columns.email')}:</strong> {ticket.email}</p>
          <p><strong>{t('adminSupport.columns.wallet')}:</strong> {ticket.wallet || t('common.notAvailable')}</p>
          <p><strong>{t('adminSupport.columns.category')}:</strong> {t(`support.categories.${ticket.category}`)}</p>
          <p><strong>{t('adminSupport.submittedAt')}:</strong> {new Date(ticket.createdAt).toLocaleString()}</p>
        </div>

        <div className="ticket-detail-actions">
          <label className="form-field">
            <span>{t('adminSupport.columns.status')}</span>
            <select value={ticket.status} disabled={busy} onChange={(event) => runAction(() => setTicketStatus(token, ticket.id, event.target.value))}>
              {TICKET_STATUSES.map((status) => (
                <option key={status} value={status}>{ticketStatusLabel(status)}</option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>{t('adminSupport.columns.priority')}</span>
            <select value={ticket.priority} disabled={busy} onChange={(event) => runAction(() => setTicketPriority(token, ticket.id, event.target.value))}>
              {TICKET_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>{ticketPriorityLabel(priority)}</option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>{t('adminSupport.assignTo')}</span>
            <input
              type="text"
              value={assignee}
              onChange={(event) => setAssignee(event.target.value)}
              onBlur={() => runAction(() => assignTicket(token, ticket.id, assignee))}
              placeholder={t('adminSupport.assignPlaceholder')}
            />
          </label>
        </div>

        <h4>{t('adminSupport.message')}</h4>
        <p className="ticket-message-body">{ticket.message}</p>

        {ticket.attachments?.length > 0 && (
          <>
            <h4>{t('adminSupport.attachments')}</h4>
            <div className="attachment-grid">
              {ticket.attachments.map((attachment) => (
                <TicketAttachmentPreview attachment={attachment} key={attachment.name} />
              ))}
            </div>
          </>
        )}

        <h4>{t('adminSupport.replyHistory')}</h4>
        {!ticket.replies?.length && <p className="inline-note">{t('adminSupport.noReplies')}</p>}
        <div className="ticket-reply-thread">
          {(ticket.replies || []).map((reply, index) => (
            <div className="ticket-reply" key={index}>
              <strong>{reply.by}</strong>
              <p>{reply.message}</p>
              <small>{new Date(reply.createdAt).toLocaleString()}</small>
            </div>
          ))}
        </div>

        <label className="form-field wide">
          <span>{t('adminSupport.replyLabel')}</span>
          <textarea value={replyMessage} onChange={(event) => setReplyMessage(event.target.value)} rows={4} placeholder={t('adminSupport.replyPlaceholder')} />
        </label>
        <button
          className="primary-button"
          type="button"
          disabled={busy || !replyMessage.trim()}
          onClick={() => runAction(async () => {
            await replyToTicket(token, ticket.id, replyMessage);
            setReplyMessage('');
          })}
        >
          <Send size={16} /> {t('adminSupport.sendReply')}
        </button>

        <label className="form-field wide">
          <span>{t('adminSupport.internalNotesLabel')}</span>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} onBlur={() => runAction(() => setTicketNotes(token, ticket.id, notes))} rows={3} placeholder={t('adminSupport.internalNotesPlaceholder')} />
        </label>

        <div className="admin-request-actions">
          <button className="secondary-button" type="button" disabled={busy} onClick={() => runAction(() => setTicketStatus(token, ticket.id, 'resolved'))}>
            <CheckCircle2 size={16} /> {t('adminSupport.markResolved')}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={() => runAction(() => (ticket.archived ? unarchiveTicket(token, ticket.id) : archiveTicket(token, ticket.id)))}
          >
            <Archive size={16} /> {ticket.archived ? t('adminSupport.unarchive') : t('adminSupport.archive')}
          </button>
          <button
            className="ghost-button danger-button"
            type="button"
            disabled={busy}
            onClick={async () => {
              if (!window.confirm(t('adminSupport.confirmDelete'))) return;
              await runAction(async () => {
                await deleteTicket(token, ticket.id);
                onClose();
              });
            }}
          >
            <Trash2 size={16} /> {t('adminSupport.delete')}
          </button>
        </div>
        {error && <p className="lookup-message error">{error}</p>}
      </div>
    </div>
  );
}

function AdminSupportPage() {
  const { t } = useTranslation();
  const [token, setToken] = useState(() => getStoredAdminToken());
  const [passcode, setPasscode] = useState('');
  const [authState, setAuthState] = useState({ status: 'idle', message: '' });
  const [tickets, setTickets] = useState([]);
  const [stats, setStats] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [listState, setListState] = useState({ status: 'idle', message: '' });
  const [activeTicketId, setActiveTicketId] = useState(null);
  const [lastSeenNewCount, setLastSeenNewCount] = useState(0);

  const load = async (activeToken = token) => {
    if (!activeToken) return;
    setListState({ status: 'loading', message: t('adminSupport.loadingTickets') });
    try {
      const data = await fetchSupportTickets(activeToken, { status: statusFilter, category: categoryFilter });
      setTickets(data.tickets || []);
      setStats(data.stats || null);
      setListState({ status: 'idle', message: '' });
    } catch (error) {
      setListState({ status: 'error', message: error.message || t('adminSupport.loadFailed') });
    }
  };

  useEffect(() => {
    load();
  }, [token, statusFilter, categoryFilter]);

  // Lightweight polling so the "new ticket" badge updates without a manual
  // refresh - a real-time push channel is the documented future upgrade.
  useEffect(() => {
    if (!token) return;
    const interval = window.setInterval(() => load(token), 30000);
    return () => window.clearInterval(interval);
  }, [token, statusFilter, categoryFilter]);

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
    setTickets([]);
    setStats(null);
  };

  if (!token) {
    return (
      <section className="page-section">
        <SectionTitle icon={Lock} eyebrow={t('adminVerify.eyebrow')} title={t('adminSupport.title')} />
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

  const newCount = stats?.new || 0;
  const hasUnseenNew = newCount > lastSeenNewCount;

  return (
    <section className="page-section analytics-dashboard">
      <SectionTitle icon={LifeBuoy} eyebrow={t('adminVerify.eyebrow')} title={t('adminSupport.title')} />
      <div className="analytics-toolbar">
        <button className="secondary-button" type="button" onClick={() => { load(); setLastSeenNewCount(newCount); }}>
          {t('common.refresh')}
          {hasUnseenNew && <span className="notification-badge">{newCount}</span>}
        </button>
        <button className="secondary-button" type="button" onClick={() => { window.location.hash = '/admin-verify'; window.dispatchEvent(new HashChangeEvent('hashchange')); }}>
          <Shield size={16} /> {t('adminAnalytics.verificationReview')}
        </button>
        <button className="secondary-button" type="button" onClick={() => { window.location.hash = '/admin-analytics'; window.dispatchEvent(new HashChangeEvent('hashchange')); }}>
          <BarChart3 size={16} /> {t('adminVerify.openAnalytics')}
        </button>
        <button className="secondary-button" type="button" onClick={() => { window.location.hash = '/admin-report'; window.dispatchEvent(new HashChangeEvent('hashchange')); }}>
          <Flag size={16} /> {t('adminReport.title')}
        </button>
        <button className="ghost-button" type="button" onClick={logout}>{t('common.signOut')}</button>
      </div>

      {stats && (
        <div className="analytics-stat-grid">
          <StatCard icon={Inbox} label={t('adminSupport.stats.new')} numericValue={stats.new} />
          <StatCard icon={Clock3} label={t('adminSupport.stats.open')} numericValue={stats.open} />
          <StatCard icon={CheckCircle2} label={t('adminSupport.stats.resolved')} numericValue={stats.resolved} />
          <StatCard
            icon={TimerReset}
            label={t('adminSupport.stats.avgResponse')}
            value={stats.avgResponseMinutes != null ? `${stats.avgResponseMinutes}m` : t('common.notAvailable')}
          />
        </div>
      )}

      <div className="support-filter-row">
        <label className="form-field">
          <span>{t('adminSupport.filterStatus')}</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">{t('adminSupport.allStatuses')}</option>
            {TICKET_STATUSES.map((status) => (
              <option key={status} value={status}>{ticketStatusLabel(status)}</option>
            ))}
            <option value="archived">{t('adminSupport.archived')}</option>
          </select>
        </label>
        <label className="form-field">
          <span>{t('adminSupport.filterCategory')}</span>
          <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
            <option value="all">{t('adminSupport.allCategories')}</option>
            {TICKET_CATEGORIES.map((category) => (
              <option key={category.id} value={category.id}>{t(`support.categories.${category.id}`)}</option>
            ))}
          </select>
        </label>
      </div>

      {listState.message && <p className={listState.status === 'error' ? 'lookup-message error' : 'lookup-message'}>{listState.message}</p>}

      {!tickets.length ? (
        <EmptyState title={t('adminSupport.emptyTitle')} text={t('adminSupport.emptyText')} />
      ) : (
        <div className="analytics-table-card support-inbox-table">
          <table className="analytics-table">
            <thead>
              <tr>
                <th>{t('adminSupport.columns.id')}</th>
                <th>{t('adminSupport.columns.date')}</th>
                <th>{t('adminSupport.columns.name')}</th>
                <th>{t('adminSupport.columns.email')}</th>
                <th>{t('adminSupport.columns.wallet')}</th>
                <th>{t('adminSupport.columns.subject')}</th>
                <th>{t('adminSupport.columns.category')}</th>
                <th>{t('adminSupport.columns.status')}</th>
                <th>{t('adminSupport.columns.priority')}</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((ticket) => (
                <tr key={ticket.id} className="ticket-row" onClick={() => setActiveTicketId(ticket.id)}>
                  <td>{ticket.id}</td>
                  <td>{new Date(ticket.createdAt).toLocaleDateString()}</td>
                  <td>{ticket.name || t('common.notAvailable')}</td>
                  <td>{ticket.email}</td>
                  <td>{ticket.wallet ? `${ticket.wallet.slice(0, 4)}...${ticket.wallet.slice(-4)}` : t('common.notAvailable')}</td>
                  <td>{ticket.subject}</td>
                  <td>{t(`support.categories.${ticket.category}`)}</td>
                  <td><span className={`status-badge ticket-status-${ticket.status}`}>{ticketStatusLabel(ticket.status)}</span></td>
                  <td><span className={`status-badge ticket-priority-${ticket.priority}`}>{ticketPriorityLabel(ticket.priority)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTicketId && (
        <AdminSupportTicketDetail
          token={token}
          ticketId={activeTicketId}
          onClose={() => setActiveTicketId(null)}
          onChanged={() => load()}
        />
      )}
    </section>
  );
}

function reportStatusLabel(status) {
  return translate(`report.statusLabels.${status}`) || status;
}

function AdminReportDetail({ token, reportId, onClose, onChanged }) {
  const { t } = useTranslation();
  const [report, setReport] = useState(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const data = await fetchReportDetail(token, reportId);
      setReport(data);
      setNotes(data?.adminNotes || '');
    } catch (err) {
      setError(err.message || t('adminReport.loadReportFailed'));
    }
  };

  useEffect(() => {
    load();
  }, [reportId]);

  const runAction = async (fn) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
      await onChanged?.();
    } catch (err) {
      setError(err.message || t('adminReport.actionFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (!report) {
    return (
      <div className="modal-backdrop" role="dialog" aria-modal="true">
        <div className="modal-panel ticket-detail-modal">
          <p className="lookup-message">{error || t('adminReport.loadingReport')}</p>
          <button className="secondary-button" type="button" onClick={onClose}>{t('common.close')}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-panel ticket-detail-modal">
        <header className="ticket-detail-header">
          <div>
            <strong>{report.subject}</strong>
            <p className="inline-note">{report.id}</p>
          </div>
          <button className="ghost-button" type="button" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="ticket-detail-grid">
          <p><strong>{t('adminReport.columns.project')}:</strong> {report.projectName || report.projectId}</p>
          <p><strong>{t('adminReport.columns.name')}:</strong> {report.name || t('common.notAvailable')}</p>
          <p><strong>{t('adminReport.columns.email')}:</strong> {report.email || t('common.notAvailable')}</p>
          <p><strong>{t('adminReport.columns.wallet')}:</strong> {report.wallet || t('common.notAvailable')}</p>
          <p><strong>{t('adminReport.columns.category')}:</strong> {t(`report.categories.${report.category}`)}</p>
          <p><strong>{t('adminReport.submittedAt')}:</strong> {new Date(report.createdAt).toLocaleString()}</p>
        </div>

        <div className="ticket-detail-actions">
          <label className="form-field">
            <span>{t('adminReport.columns.status')}</span>
            <select value={report.status} disabled={busy} onChange={(event) => runAction(() => setReportStatus(token, report.id, event.target.value))}>
              {REPORT_STATUSES.map((status) => (
                <option key={status} value={status}>{reportStatusLabel(status)}</option>
              ))}
            </select>
          </label>
        </div>

        <h4>{t('adminReport.message')}</h4>
        <p className="ticket-message-body">{report.message}</p>

        {report.attachments?.length > 0 && (
          <>
            <h4>{t('adminReport.attachments')}</h4>
            <div className="attachment-grid">
              {report.attachments.map((attachment) => (
                <TicketAttachmentPreview attachment={attachment} key={attachment.name} />
              ))}
            </div>
          </>
        )}

        <label className="form-field wide">
          <span>{t('adminReport.internalNotesLabel')}</span>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} onBlur={() => runAction(() => setReportNotes(token, report.id, notes))} rows={3} placeholder={t('adminReport.internalNotesPlaceholder')} />
        </label>

        <div className="admin-request-actions">
          <button className="secondary-button" type="button" disabled={busy} onClick={() => runAction(() => setReportStatus(token, report.id, 'resolved'))}>
            <CheckCircle2 size={16} /> {t('adminReport.markResolved')}
          </button>
          <button className="secondary-button" type="button" disabled={busy} onClick={() => runAction(() => setReportStatus(token, report.id, 'rejected'))}>
            <Flag size={16} /> {t('adminReport.markRejected')}
          </button>
          <button
            className="ghost-button danger-button"
            type="button"
            disabled={busy}
            onClick={async () => {
              if (!window.confirm(t('adminReport.confirmDelete'))) return;
              await runAction(async () => {
                await deleteReport(token, report.id);
                onClose();
              });
            }}
          >
            <Trash2 size={16} /> {t('adminReport.delete')}
          </button>
        </div>
        {error && <p className="lookup-message error">{error}</p>}
      </div>
    </div>
  );
}

function AdminReportPage() {
  const { t } = useTranslation();
  const [token, setToken] = useState(() => getStoredAdminToken());
  const [passcode, setPasscode] = useState('');
  const [authState, setAuthState] = useState({ status: 'idle', message: '' });
  const [reports, setReports] = useState([]);
  const [stats, setStats] = useState(null);
  const [projects, setProjects] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [listState, setListState] = useState({ status: 'idle', message: '' });
  const [activeReportId, setActiveReportId] = useState(null);

  const load = async (activeToken = token) => {
    if (!activeToken) return;
    setListState({ status: 'loading', message: t('adminReport.loadingReports') });
    try {
      const data = await fetchReports(activeToken, {
        status: statusFilter,
        category: categoryFilter,
        projectId: projectFilter === 'all' ? '' : projectFilter,
        search,
        dateFrom,
        dateTo,
      });
      setReports(data.reports || []);
      setStats(data.stats || null);
      setProjects(data.projects || []);
      setListState({ status: 'idle', message: '' });
    } catch (error) {
      setListState({ status: 'error', message: error.message || t('adminReport.loadFailed') });
    }
  };

  useEffect(() => {
    load();
  }, [token, statusFilter, categoryFilter, projectFilter, dateFrom, dateTo]);

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
    setReports([]);
    setStats(null);
  };

  if (!token) {
    return (
      <section className="page-section">
        <SectionTitle icon={Lock} eyebrow={t('adminVerify.eyebrow')} title={t('adminReport.title')} />
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

  return (
    <section className="page-section analytics-dashboard">
      <SectionTitle icon={Flag} eyebrow={t('adminVerify.eyebrow')} title={t('adminReport.title')} />
      <div className="analytics-toolbar">
        <button className="secondary-button" type="button" onClick={() => load()}>
          {t('common.refresh')}
        </button>
        <button className="secondary-button" type="button" onClick={() => { window.location.hash = '/admin-support'; window.dispatchEvent(new HashChangeEvent('hashchange')); }}>
          <LifeBuoy size={16} /> {t('adminSupport.title')}
        </button>
        <button className="ghost-button" type="button" onClick={logout}>{t('common.signOut')}</button>
      </div>

      {stats && (
        <div className="analytics-stat-grid">
          <StatCard icon={Inbox} label={t('adminReport.stats.new')} numericValue={stats.new} />
          <StatCard icon={Clock3} label={t('adminReport.stats.underReview')} numericValue={stats.under_review} />
          <StatCard icon={CheckCircle2} label={t('adminReport.stats.resolved')} numericValue={stats.resolved} />
          <StatCard icon={Flag} label={t('adminReport.stats.rejected')} numericValue={stats.rejected} />
        </div>
      )}

      <div className="support-filter-row">
        <label className="form-field">
          <span>{t('adminReport.filterStatus')}</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">{t('adminReport.allStatuses')}</option>
            {REPORT_STATUSES.map((status) => (
              <option key={status} value={status}>{reportStatusLabel(status)}</option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>{t('adminReport.filterCategory')}</span>
          <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
            <option value="all">{t('adminReport.allCategories')}</option>
            {REPORT_CATEGORIES.map((category) => (
              <option key={category.id} value={category.id}>{t(`report.categories.${category.id}`)}</option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>{t('adminReport.filterProject')}</span>
          <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
            <option value="all">{t('adminReport.allProjects')}</option>
            {projects.map((projectId) => (
              <option key={projectId} value={projectId}>{projectId}</option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>{t('adminReport.filterDateFrom')}</span>
          <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
        </label>
        <label className="form-field">
          <span>{t('adminReport.filterDateTo')}</span>
          <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
        </label>
        <label className="form-field">
          <span>{t('adminReport.searchLabel')}</span>
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') load(); }}
            placeholder={t('adminReport.searchPlaceholder')}
          />
        </label>
        <button className="secondary-button" type="button" onClick={() => load()}>
          <Search size={16} /> {t('common.search')}
        </button>
      </div>

      {listState.message && <p className={listState.status === 'error' ? 'lookup-message error' : 'lookup-message'}>{listState.message}</p>}

      {!reports.length ? (
        <EmptyState title={t('adminReport.emptyTitle')} text={t('adminReport.emptyText')} />
      ) : (
        <div className="analytics-table-card support-inbox-table">
          <table className="analytics-table">
            <thead>
              <tr>
                <th>{t('adminReport.columns.id')}</th>
                <th>{t('adminReport.columns.date')}</th>
                <th>{t('adminReport.columns.project')}</th>
                <th>{t('adminReport.columns.name')}</th>
                <th>{t('adminReport.columns.email')}</th>
                <th>{t('adminReport.columns.subject')}</th>
                <th>{t('adminReport.columns.category')}</th>
                <th>{t('adminReport.columns.status')}</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <tr key={report.id} className="ticket-row" onClick={() => setActiveReportId(report.id)}>
                  <td>{report.id}</td>
                  <td>{new Date(report.createdAt).toLocaleDateString()}</td>
                  <td>{report.projectName || report.projectId}</td>
                  <td>{report.name || t('common.notAvailable')}</td>
                  <td>{report.email || t('common.notAvailable')}</td>
                  <td>{report.subject}</td>
                  <td>{t(`report.categories.${report.category}`)}</td>
                  <td><span className={`status-badge ticket-status-${report.status}`}>{reportStatusLabel(report.status)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeReportId && (
        <AdminReportDetail
          token={token}
          reportId={activeReportId}
          onClose={() => setActiveReportId(null)}
          onChanged={() => load()}
        />
      )}
    </section>
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
