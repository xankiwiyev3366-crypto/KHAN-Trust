// Must run before any @solana/web3.js or @solana/spl-token code executes -
// they reference the Node "Buffer" global at runtime (not just module
// scope), and Vite's optimizeDeps inject only covers dev-time dependency
// pre-bundling, not the production rollup build, so the production bundle
// never got this without an explicit import here.
import './bufferShim.js';
import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
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
  CalendarClock,
  CalendarDays,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  Brain,
  CircleDot,
  Clock3,
  Copy,
  Crown,
  Download,
  ExternalLink,
  Eye,
  FileText,
  FileWarning,
  Flag,
  Gift,
  Github,
  Globe2,
  History,
  Home,
  Link2,
  MousePointerClick,
  QrCode,
  Share2,
  Inbox,
  Info,
  Layers3,
  LayoutDashboard,
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
  Rocket,
  Search,
  Scale,
  Send,
  Shield,
  ShieldCheck,
  Sparkles,
  Star,
  Tags,
  Target,
  TimerReset,
  TrendingDown,
  TrendingUp,
  Trash2,
  Trophy,
  User,
  UserPlus,
  Users,
  WalletCards,
  X,
} from 'lucide-react';
import './styles.css';
import { WHITEPAPER } from './whitepaperConfig.js';
// The trust engine itself. It used to be defined inline in this file, which is
// precisely why no Netlify Function could ever recompute a score — and why the
// alert loop could only see tokens a human had just looked at. It is imported
// here rather than duplicated server-side so there is exactly ONE definition of
// what a score is; see the header of src/lib/trustScore.js for why a second
// copy would produce false "your token got riskier" alerts.
import {
  calculateLiveScores,
  calculateManualScores,
  scoreToRisk,
  clamp,
  hasValue,
  firstPresent,
  weightedAverage,
  riskPenalty,
  socialPresenceState,
  scorePresence,
  scoreSocial,
  scoreFounder,
  scoreHolders,
  scoreNativeHolderDistribution,
  scoreMarketCap,
  scoreLiquidity,
  scoreTopHolder,
  scoreTopTenHolder,
  scoreTokenAge,
  scoreHolderGrowth,
  scoreSupply,
  scoreSecurity,
  scoreMarketActivity,
  isLargeVerifiedAsset,
  isPublicFounder,
  hasRoadmap,
  liveDataPenalty,
  MAX_TRUST_SCORE_PENALTY,
} from './lib/trustScore.js';
import { runRiskAnalysis, classifyAsset, applyAssetTypeRiskModifier, rankSignalsBySeverity } from './scoringEngine.js';
import { withTimeout } from './providers.js';
import { historyKeyFor, fetchScoreHistory, computeScoreDelta, useScoreHistory } from './scoreHistory.js';
import { useCorpusRecord } from './tokenCorpus.js';
import { ANALYST_QUESTIONS, answerQuestion, translateSignalKeys, translatedCategory } from './khanAnalyst.js';
import { detectRiskAlerts, useWatchlistAlertCount } from './riskAlerts.js';
import { TRUST_CATEGORIES, buildRiskHistory, validHistory, describeChange } from './riskHistory.js';
import { useSinceLastVisit } from './sinceLastVisit.js';
import { useWatchtowerReport, describeReason, describeCadence, MONITORED_DIMENSIONS, STATUS_TONE } from './watchtower.js';
import { computePeerBenchmark, peerLabelFor } from './peerBenchmark.js';
import { I18nProvider, useTranslation } from './i18n/I18nContext.jsx';
import { translate, getLanguage } from './i18n/index.js';
import LanguageSwitcher from './LanguageSwitcher.jsx';
import WalletContextProvider from './wallet/WalletContextProvider.jsx';
import ConnectWalletButton from './ConnectWalletButton.jsx';
import { useKhanWallet } from './wallet/useKhanWallet.js';
import { useApprovalScanner } from './approvals/useApprovalScanner.js';
import { lamportsToSol } from './approvals/solanaLane.js';
import { AuthProvider, useAuth } from './auth/AuthContext.jsx';
import { RetentionProvider, useRetention } from './RetentionContext.jsx';
import { contextFromProject } from './retention.js';
import { peekScanQuota, consumeScanQuota, hoursUntilReset, FREE_DAILY_SCAN_LIMIT } from './scanQuota.js';
// The Free/Premium presentation layer: crowns, teaser locks, and the upgrade
// modal. The tier rules themselves live in ./lib/features.js, which the SERVER
// reads too — see netlify/functions/_featureGate.mjs. Nothing here is a
// security boundary.
import {
  PremiumGateProvider,
  usePremiumGate,
  PremiumLock,
  PremiumCrown,
  PremiumActionButton,
  PremiumUpgradeModal,
  FeatureComparisonTable,
} from './premiumGate.jsx';
import { AuthModal } from './auth/AuthModal.jsx';
// Early Stage Projects - additive, lazy-loaded feature. React.lazy keeps this
// entire module (and its earlyStage.js client) out of the initial bundle; it
// only downloads when a user opens an /early-stage* route. See EarlyStage.jsx.
const EarlyStageFeature = lazy(() => import('./EarlyStage.jsx'));
// KHAN AI - the platform's security-intelligence entity. Statically imported
// rather than lazy: it is a few KB of inline SVG with no external assets, and
// it renders in the hero above the fold, where a lazy chunk would show up as a
// visible pop-in on the first paint. See KhanAI.jsx.
import { KhanAiHeroMark, KhanAiScanConsole, KhanAiVerdictMark, KhanAiPanel, KhanAiBackdrop, KhanAiVerificationPanel, createScanReporter } from './KhanAI.jsx';
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
import { isCardPaymentEnabled, startStripeCheckout, stripeUnavailableMessage } from './stripeCheckout.js';
import { isSolanaVerificationConfigured, solanaUnavailableMessage, verifySolanaPayment } from './solanaVerify.js';
import { isWalletPaymentConfigured, payWithConnectedWallet } from './cryptoPayment.js';
import { planUsdAmount, PLAN_USD_AMOUNT } from './lib/pricing.js';
import { fetchEntitlement, fetchAccountEntitlement, hasPlanAccess, isEarlySupporter, describeEntitlement, premiumBadgeInfo } from './entitlements.js';
import { buildAdvancedResearch, buildPremiumAnalysis, buildLocalizedRiskSummary, friendlyMissingFields } from './premiumResearch.js';
import { useGroundedAnalysis, mergeAnalysis } from './groundedAnalysis.js';
import { buildInvestmentThesis } from './investmentThesis.js';
import { fetchMyManualPremium, fetchPremiumUsers, fetchPremiumAudit, submitPremiumAction, submitBulkPremiumAction, fetchUserActivity, fetchUserActivityDetail } from './premiumAdmin.js';
import { recordWalletLink } from './walletLink.js';
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
  setAnalyticsUserId,
} from './platformAnalytics.js';
// Growth Data Plane. Runs ALONGSIDE the two existing tracking modules rather
// than replacing them: platformAnalytics feeds the legacy admin dashboard and
// analytics.js feeds Google Analytics, and cutting either over in the same
// change would put a migration and a rebuild of every metric in one commit.
// This one is additive and independently verifiable; the legacy paths retire
// once the console fully replaces the old dashboard.
import { initGrowth, setGrowthUserId, growth } from './growth.js';
// Referral & Invite System. Client half: capture ?ref= at boot, and the
// user/admin data calls for the Referral dashboard and Referral Analytics.
import {
  initReferral,
  fetchMyReferral,
  regenerateMyReferralCode,
  fetchReferralAnalytics,
  fetchReferralDetail,
} from './referral.js';
import { qrToSvg } from './lib/qrcode.js';
import {
  fetchHolders,
  fetchTransactions,
  fetchHolderStats,
  fetchAlerts as fetchHolderAlerts,
  triggerManualSync,
} from './khanHolderAnalytics.js';

const PROJECTS_KEY = 'khan-trust-projects-v1';
const WATCHLIST_KEY = 'khan-trust-watchlist-v1';
const CRYPTO_PAYMENT_WALLET = import.meta.env.VITE_KHAN_PAYMENT_WALLET || '';
const WALLET_DOWNLOAD_URLS = { Phantom: 'https://phantom.com/download', Solflare: 'https://solflare.com/download' };
const OFFICIAL_KHAN_LINKS = {
  website: 'https://khantrust.net',
  x: 'https://x.com/KhanPortall',
  telegram: 'https://t.me/+RXCuwpSNwikzNTE0',
};
// Token creation has no fee of its own - it is a Premium feature (see
// LaunchpadPage's Premium gate). Mainnet minting still costs real Solana
// network gas, paid by the connected wallet directly to the network; that is
// unrelated to any KHAN Trust charge.
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
// GoPlus Security - free, no-key public token-security API. Used only as a
// fallback for holder count / concentration when our existing sources
// (Solana RPC scan, Jupiter index, EVM block explorers) have nothing, so it
// never overrides a real on-chain/indexed measurement that's already present.
const GOPLUS_API_BASE = 'https://api.gopluslabs.io/api/v1';
const GOPLUS_EVM_CHAIN_IDS = {
  ethereum: '1',
  bsc: '56',
  polygon: '137',
  base: '8453',
  arbitrum: '42161',
  avalanche: '43114',
  optimism: '10',
};
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

// A native chain coin (ETH, BNB, SOL, AVAX, SUI) has no contract of its own,
// but it does trade on its own chain's DEXs via a canonical 1:1 wrapped/native
// representation - WETH, WBNB, wSOL, WAVAX, and Sui's own native coin type
// are the SAME asset for liquidity purposes, not an estimate or a different
// token. Used only to source real DEX liquidity depth for the native asset;
// never used for holder count/concentration, since wrapped-token holders are
// a small DeFi subset and would misrepresent true native-asset distribution.
const NATIVE_LIQUIDITY_PROXY = {
  ethereum: { chainId: 'ethereum', address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' },
  binancecoin: { chainId: 'bsc', address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c' },
  solana: { chainId: 'solana', address: 'So11111111111111111111111111111111111111112' },
  'avalanche-2': { chainId: 'avalanche', address: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7' },
  sui: { chainId: 'sui', address: '0x2::sui::SUI' },
};

// Blockchair exposes a real, CORS-enabled, no-key "hodling_addresses" stat -
// the number of on-chain addresses currently holding a balance - which is a
// genuine holder count for a native chain asset (not a wrapped-token proxy).
// Maps our CoinGecko ids to Blockchair's chain slugs for the chains it covers;
// chains it doesn't cover fall back to the CoinGecko market-rank distribution
// signal below. Best-effort: any failure just drops to the next provider.
const BLOCKCHAIR_NATIVE_CHAINS = {
  bitcoin: 'bitcoin',
  ethereum: 'ethereum',
  litecoin: 'litecoin',
  dogecoin: 'dogecoin',
  ripple: 'ripple',
  cardano: 'cardano',
  'bitcoin-cash': 'bitcoin-cash',
  dash: 'dash',
  zcash: 'zcash',
  stellar: 'stellar',
};

// Best-effort native holder count from Blockchair's public stats endpoint.
// CORS-enabled and key-free; returns null on any failure (unsupported chain,
// rate limit, network) so the caller cleanly falls through to the next signal.
async function fetchBlockchairNativeStats(coingeckoId) {
  const slug = BLOCKCHAIR_NATIVE_CHAINS[coingeckoId];
  if (!slug) return null;
  try {
    const response = await fetch(`https://api.blockchair.com/${slug}/stats`);
    if (!response.ok) return null;
    const payload = await response.json();
    const data = payload?.data || {};
    const holderCount = Number(data.hodling_addresses || 0) || null;
    if (!holderCount) return null;
    return { holderCount, source: `Blockchair ${slug} on-chain address count` };
  } catch {
    return null;
  }
}

// Block-explorer "contract creation timestamp" + "is proxy/upgradeable"
// lookups. The Etherscan-family API keys used to live here as VITE_* env vars,
// which meant they were bundled into the browser and publicly readable. They
// now live server-side and are reached through the evm-explorer proxy function
// (see netlify/functions/evm-explorer.mjs); this list only records which chains
// the proxy supports so unsupported chains short-circuit without a round trip.
// Without a key configured server-side the chain still falls back to "Unknown"
// rather than guessing, exactly as before.
const EXPLORER_SUPPORTED_CHAINS = new Set(['ethereum', 'bsc', 'base', 'polygon']);

async function fetchExplorerProxy(chainId, action, address) {
  if (!EXPLORER_SUPPORTED_CHAINS.has(chainId)) return null;
  const response = await fetch(
    `/.netlify/functions/evm-explorer?chain=${encodeURIComponent(chainId)}&action=${action}&address=${encodeURIComponent(address)}`,
  );
  if (!response.ok) return null;
  const data = await response.json();
  return data?.result ?? null;
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
  { id: 'early-stage', label: 'Early Stage', icon: Rocket },
  { id: 'pricing', label: 'Pricing', icon: WalletCards },
  { id: 'compare', label: 'Compare', icon: Scale },
  { id: 'watchlist', label: 'Watchlist', icon: Bell },
  // Also in SIDEBAR_ITEMS for desktop; listed here too so it reaches the mobile
  // bottom nav and the desktop top-nav (the sidebar is desktop-only). Gated like
  // watchlist/add — navTo() shows the sign-in gate for signed-out users.
  { id: 'referral', label: 'Refer & Earn', icon: Gift },
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
// Single source of truth now lives in riskHistory.js so the live report and the
// Risk History timeline can never drift on how a category is composed (imported
// above as TRUST_CATEGORIES).

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
// `reasons` (English, interpolated) is kept for backward compatibility with
// existing consumers (PDF export, premiumResearch.js dedup-by-string). The
// parallel `reasonKeys` array (translation key + params, no English baked in)
// is what the UI renders, via t(), so it re-translates instantly on language
// switch instead of freezing whatever language was active when the project
// was last normalized (see ScamRiskCard).
function calculateScamRisk(project = {}, data = {}) {
  const reasons = [];
  const reasonKeys = [];
  let riskPoints = 0;

  const addRisk = (points, reason, key, params) => {
    riskPoints += points;
    reasons.push(reason);
    reasonKeys.push({ key, params });
  };

  if (typeof data.topHolderPercent === 'number' && data.topHolderPercent > 50) {
    addRisk(25, `Largest holder controls ${formatPercent(data.topHolderPercent)} of supply`, 'topHolderConcentration', { pct: formatPercent(data.topHolderPercent) });
  }
  if (typeof data.topTenHolderPercent === 'number' && data.topTenHolderPercent > 80) {
    addRisk(20, `Top 10 holders control ${formatPercent(data.topTenHolderPercent)} of supply`, 'topTenConcentration', { pct: formatPercent(data.topTenHolderPercent) });
  }

  const liquidity = Number(data.totalLiquidityUsd ?? data.liquidityUsd ?? 0);
  if (data.socialMetadataAvailable && !liquidity) {
    addRisk(15, 'No public liquidity was found for this token', 'noLiquidityFound');
  } else if (liquidity > 0 && liquidity < 2000) {
    addRisk(15, 'Liquidity is extremely low (under $2,000)', 'extremelyLowLiquidity');
  }

  const noSocial = !hasValue(project.website) && !hasValue(project.twitter) && !hasValue(project.telegram);
  if (noSocial && data.socialMetadataAvailable) {
    addRisk(15, 'No website, X/Twitter, or Telegram presence found', 'noSocialPresence');
  }

  if (data.mintAuthorityEnabled === true) addRisk(10, 'Mint authority is still enabled', 'mintAuthorityEnabled');
  if (data.freezeAuthorityEnabled === true) addRisk(10, 'Freeze authority is still enabled', 'freezeAuthorityEnabled');
  if (data.upgradeable === true) addRisk(10, 'Contract is upgradeable', 'contractUpgradeable');

  if (typeof data.tokenAgeDays === 'number' && data.tokenAgeDays < 3) {
    addRisk(10, 'Token is less than 3 days old', 'veryNewToken');
  }

  const riskScore = clamp(riskPoints, 0, 100);
  const level = riskScore >= 50 ? 'High' : riskScore >= 25 ? 'Medium' : 'Low';
  return { riskScore, level, reasons, reasonKeys };
}

// Render-time translation of scam-risk reasons - always uses the current
// language via t(), unlike the frozen `reasons` array baked in at normalize
// time. Falls back to the raw English reason only if a reasonKeys entry is
// somehow missing (should not happen for anything produced by
// calculateScamRisk above).
function translatedScamReasons(scamRisk, t) {
  if (scamRisk?.reasonKeys?.length) {
    return scamRisk.reasonKeys.map(({ key, params }) => t(`scamRisk.reasons.${key}`, params));
  }
  return scamRisk?.reasons || [];
}

// Deliberately NOT implemented (would require fabricating data or a paid
// specialized API rather than reading real on-chain/market data):
// honeypot/transfer-restriction simulation, LP lock/burn status, fake
// website or clone-branding detection. These would need GoPlus Security,
// RugCheck, or TokenSniffer-style integrations - documented here rather
// than guessed.
const SCAM_RISK_COVERAGE_NOTE = 'Concentration, liquidity, social presence, mint/freeze/upgrade authority, and token age only.';

function communityScore(size) {
  if (!size) return 0;
  return clamp(Math.round(Number(size) / 1000), 0, 15);
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
  return {
    ...project,
    verificationStatus: normalizeVerificationStatus(entry.status),
    verificationNote: entry.adminNote || '',
    ownerWallet: entry.ownerWallet || null,
  };
}

// Editing is a Premium-independent, ownership-only permission (a paid plan
// never grants edit rights on someone else's project). Most user-submitted
// projects live only in the editor's own browser (see readProjectStorage) so
// there is no other viewer to protect against yet; the one place a project's
// identity is genuinely shared across users is once it's Verified, at which
// point the wallet that proved ownership via signature (see
// netlify/functions/verification-request.mjs) is the only wallet allowed to
// edit it.
function canEditProject(project, connectedWallet) {
  if (project?.verificationStatus !== VERIFICATION_STATUS.VERIFIED) return true;
  return Boolean(connectedWallet) && connectedWallet === project.ownerWallet;
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

// Graceful-degradation wrapper for the scan fan-outs (Phase 2, Section M): like
// Promise.allSettled, but every provider promise is time-bounded first, so one
// hung/dead third-party API degrades to a 'rejected' (→ null) result quickly
// instead of stalling the whole scan. A provider that merely fails was already
// isolated by allSettled; this adds the missing timeout for one that hangs.
function settledWithTimeout(promises) {
  return Promise.allSettled(promises.map((promise) => withTimeout(promise)));
}

// Scan telemetry: the console reports real work, never a timer. Each stage is
// backed by specific network calls below, and is only marked complete once the
// promises behind it have actually settled - so the console leads the user by
// exactly zero milliseconds. SCAN_STAGES / createScanReporter live in KhanAI.jsx
// so the pipeline definition and the UI that renders it cannot drift apart.
async function lookupSolanaToken(contractAddress, report) {
  const address = contractAddress.trim();
  if (!address) throw new Error('Enter a Solana contract address first.');
  const cacheKey = `solana:${address.toLowerCase()}`;
  // A cache hit performs no network work at all. Replaying the stage animation
  // would be theatre, so the console jumps straight to complete.
  const cached = lookupCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < LOOKUP_CACHE_TTL_MS) {
    report?.completeAll();
    return cached.value;
  }
  return withLookupCache(cacheKey, () => lookupSolanaTokenUncached(address, report));
}

async function lookupSolanaTokenUncached(address, report) {
  // Kick every provider off in parallel exactly as before, but keep a handle on
  // each promise so stage completion can be driven by the real settlement
  // rather than by elapsed time.
  const dexP = withTimeout(fetchDexscreenerToken(address));
  const rpcP = withTimeout(fetchSolanaRpcToken(address));
  const holderAnalyticsP = withTimeout(fetchSolanaHolderAnalytics(address));
  const jupiterP = withTimeout(fetchJupiterTokenData(address));
  const mintInfoP = withTimeout(fetchMintAccountInfo(address));
  const mintCreationP = withTimeout(fetchMintCreationTimestamp(address));
  const coingeckoP = withTimeout(fetchCoinGeckoTokenData('solana', address));
  const geckoTerminalP = withTimeout(fetchGeckoTerminalToken('solana', address));
  const goPlusP = withTimeout(fetchGoPlusSolanaTokenSecurity(address));

  if (report) {
    // allSettled never rejects, so these taps also keep every provider promise
    // handled - no unhandled rejections even though each is awaited again below.
    Promise.allSettled([rpcP, jupiterP]).then(() => report.complete('connect'));
    Promise.allSettled([dexP, geckoTerminalP, coingeckoP]).then(() => report.complete('liquidity'));
    Promise.allSettled([mintInfoP, mintCreationP, goPlusP]).then(() => report.complete('contract'));
    Promise.allSettled([holderAnalyticsP]).then(() => report.complete('holders'));
  }

  const [dexData, rpcData, holderAnalyticsData, jupiterData, mintInfoData, mintCreationData, coingeckoData, geckoTerminalData, goPlusData] = await Promise.allSettled([
    dexP,
    rpcP,
    holderAnalyticsP,
    jupiterP,
    mintInfoP,
    mintCreationP,
    coingeckoP,
    geckoTerminalP,
    goPlusP,
  ]);

  const dex = dexData.status === 'fulfilled' ? dexData.value : null;
  const rpc = rpcData.status === 'fulfilled' ? rpcData.value : null;
  const holderAnalytics = holderAnalyticsData.status === 'fulfilled' ? holderAnalyticsData.value : null;
  const jupiter = jupiterData.status === 'fulfilled' ? jupiterData.value : null;
  const mintInfo = mintInfoData.status === 'fulfilled' ? mintInfoData.value : null;
  const mintCreatedAt = mintCreationData.status === 'fulfilled' ? mintCreationData.value : null;
  const coingecko = coingeckoData.status === 'fulfilled' ? coingeckoData.value : null;
  const geckoTerminal = geckoTerminalData.status === 'fulfilled' ? geckoTerminalData.value : null;
  const goPlus = goPlusData.status === 'fulfilled' ? goPlusData.value : null;

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
  // never contributes here - it only returns the top 20 accounts. GoPlus is
  // a last-resort fallback, only used when RPC and Jupiter both have nothing.
  const holderCount = holderAnalytics?.holderCount ?? jupiter?.holderCount ?? goPlus?.holderCount ?? null;
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
    (!holderAnalytics && goPlus) ? 'GoPlus Security' : null,
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
      holderSource: holderAnalytics?.source || (jupiter?.holderCount ? 'Jupiter indexed Solana holder count' : null) || goPlus?.source || null,
      liquidityUsd,
      totalLiquidityUsd,
      marketCapUsd,
      marketCapIsFdv,
      tokenAgeDays,
      tokenAgeSource,
      holderCount,
      topHolderPercent: holderAnalytics?.topHolderPercent ?? rpc?.topHolderPercent ?? goPlus?.topHolderPercent ?? null,
      topTenHolderPercent: holderAnalytics?.topTenHolderPercent ?? rpc?.topTenHolderPercent ?? jupiter?.topHoldersPercentage ?? goPlus?.topTenHolderPercent ?? null,
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
      coingeckoCategory: coingecko?.category || null,
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
// Ranks two DEX search matches by SCAM-RESISTANT strength. marketCap/FDV are
// self-reported per pool and trivially spoofed - an impersonator that shares a
// real token's symbol (e.g. "PYTH") reports a fake multi-billion cap on a single
// dead pool to jump to the top of a symbol search. Real 24h trading volume,
// aggregate on-chain liquidity, and how many independent pools a token actually
// trades in are far harder to fake, so ranking on those surfaces the real,
// actively-traded mint instead of the impersonator. marketCap is kept for
// DISPLAY only, never used to rank.
function compareDexMatchStrength(a, b) {
  const volumeDiff = Number(b?.volume24h || 0) - Number(a?.volume24h || 0);
  if (volumeDiff !== 0) return volumeDiff;
  const liquidityDiff = Number(b?.liquidityUsd || 0) - Number(a?.liquidityUsd || 0);
  if (liquidityDiff !== 0) return liquidityDiff;
  return Number(b?.pairCount || 0) - Number(a?.pairCount || 0);
}

async function fetchDexscreenerSearchMatches(term) {
  const response = await fetch(`${DEXSCREENER_SEARCH_URL}?q=${encodeURIComponent(term)}`);
  if (!response.ok) throw new Error('Token search failed.');
  const data = await response.json();
  const pairs = Array.isArray(data?.pairs) ? data.pairs : [];
  // Aggregate ACROSS every pool per distinct (chain, base-token address) so the
  // strength signals below reflect the whole token, not a single cherry-picked
  // (or spoofed) pool. This is what stops a symbol collision from resolving to
  // an impersonator: the real token trades in many pools with real volume; the
  // fake one is a lone pool with a fabricated cap and ~zero volume.
  const byKey = new Map();
  pairs.forEach((pair) => {
    const address = pair.baseToken?.address;
    const chainId = pair.chainId;
    if (!address || !chainId) return;
    const key = `${chainId}-${address.toLowerCase()}`;
    const entry = byKey.get(key) || {
      address,
      chainId,
      chain: chainLabelFor(chainId),
      name: pair.baseToken?.name || '',
      symbol: pair.baseToken?.symbol ? pair.baseToken.symbol.toUpperCase() : '',
      marketCap: 0,
      volume24h: 0,
      liquidityUsd: 0,
      pairCount: 0,
      logoUrl: pair.info?.imageUrl || '',
      // Dexscreener doesn't expose an explicit "verified" flag for search
      // results; a curated profile image is the closest available signal.
      verified: Boolean(pair.info?.imageUrl),
      source: 'dexscreener',
    };
    entry.marketCap = Math.max(entry.marketCap, Number(pair.marketCap || pair.fdv || 0));
    entry.volume24h += Number(pair.volume?.h24 || 0);
    entry.liquidityUsd += Number(pair.liquidity?.usd || 0);
    entry.pairCount += 1;
    if (!entry.logoUrl && pair.info?.imageUrl) {
      entry.logoUrl = pair.info.imageUrl;
      entry.verified = true;
    }
    byKey.set(key, entry);
  });
  return Array.from(byKey.values()).sort(compareDexMatchStrength);
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
  const [canonicalResult, nativeResult, dexResult] = await settledWithTimeout([
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
      // CoinGecko-verified matches are the canonical "which contract is the real
      // asset" ground truth, so they always rank above unverified DEX matches,
      // and among themselves by their (trustworthy) real market cap.
      if (a.source === 'coingecko' && b.source !== 'coingecko') return -1;
      if (b.source === 'coingecko' && a.source !== 'coingecko') return 1;
      if (a.source === 'coingecko' && b.source === 'coingecko') return (b.marketCap || 0) - (a.marketCap || 0);
      // Two unverified DEX matches (the case that matters when CoinGecko is rate-
      // limited/unavailable): rank by real trading strength, NOT the spoofable
      // marketCap that used to let an impersonator outrank the real token.
      return compareDexMatchStrength(a, b);
    })
    .slice(0, 8);
}

async function lookupGenericChainToken(chainId, address, report) {
  const cacheKey = `${chainId}:${address.toLowerCase()}`;
  const cached = lookupCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < LOOKUP_CACHE_TTL_MS) {
    report?.completeAll();
    return cached.value;
  }
  return withLookupCache(cacheKey, () => lookupGenericChainTokenUncached(chainId, address, report));
}

async function lookupGenericChainTokenUncached(chainId, address, report) {
  const dexP = withTimeout(fetchDexscreenerToken(address, chainId));
  const coingeckoP = withTimeout(fetchCoinGeckoTokenData(chainId, address));
  const geckoTerminalP = withTimeout(fetchGeckoTerminalToken(chainId, address));
  const explorerCreationP = withTimeout(fetchExplorerContractCreation(chainId, address));
  const explorerFlagsP = withTimeout(fetchExplorerContractFlags(chainId, address));
  const goPlusP = withTimeout(fetchGoPlusEvmTokenSecurity(chainId, address));

  if (report) {
    Promise.allSettled([explorerCreationP]).then(() => report.complete('connect'));
    Promise.allSettled([dexP, coingeckoP, geckoTerminalP]).then(() => report.complete('liquidity'));
    Promise.allSettled([explorerFlagsP, goPlusP]).then(() => report.complete('contract'));
    // No public EVM equivalent of the Solana holder-analytics fan-out is wired
    // up on this path, so the stage is skipped rather than claimed.
    report.skip('holders');
  }

  const [dexResult, coingeckoResult, geckoTerminalResult, explorerCreationResult, explorerFlagsResult, goPlusResult] = await Promise.allSettled([
    dexP,
    coingeckoP,
    geckoTerminalP,
    explorerCreationP,
    explorerFlagsP,
    goPlusP,
  ]);
  const dex = dexResult.status === 'fulfilled' ? dexResult.value : null;
  const coingecko = coingeckoResult.status === 'fulfilled' ? coingeckoResult.value : null;
  const geckoTerminal = geckoTerminalResult.status === 'fulfilled' ? geckoTerminalResult.value : null;
  const explorerCreatedAt = explorerCreationResult.status === 'fulfilled' ? explorerCreationResult.value : null;
  const explorerFlags = explorerFlagsResult.status === 'fulfilled' ? explorerFlagsResult.value : null;
  const goPlus = goPlusResult.status === 'fulfilled' ? goPlusResult.value : null;

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
  // own contract-deployment timestamp (via the server-side evm-explorer
  // proxy). A DEX pair's first-liquidity date is never used.
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
    goPlus ? 'GoPlus Security' : null,
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
    holderCount: goPlus?.holderCount || 0,
    communitySize: goPlus?.holderCount || 0,
    riskNotes: buildRealDataRiskNotes({
      liquidityUsd,
      holderCount: goPlus?.holderCount ?? null,
      tokenAgeDays,
      upgradeable: explorerFlags?.upgradeable ?? null,
    }),
    realData: {
      source: sources,
      holderSource: goPlus?.source ?? null,
      liquidityUsd,
      totalLiquidityUsd,
      marketCapUsd,
      marketCapIsFdv,
      tokenAgeDays,
      tokenAgeSource,
      holderCount: goPlus?.holderCount ?? null,
      topHolderPercent: goPlus?.topHolderPercent ?? null,
      topTenHolderPercent: goPlus?.topTenHolderPercent ?? null,
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
      // Contract-security flags with a provider fallback chain: GoPlus (free, no
      // key) supplies mint/freeze signals; the block explorer stays
      // authoritative for the proxy/upgradeable flag when a key is configured,
      // with GoPlus as the keyless fallback. Each stays null only when no
      // provider could confirm it.
      mintAuthorityEnabled: goPlus?.mintAuthorityEnabled ?? null,
      freezeAuthorityEnabled: goPlus?.freezeAuthorityEnabled ?? null,
      upgradeable: explorerFlags?.upgradeable ?? goPlus?.upgradeable ?? null,
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

async function lookupTokenMatch(match, report) {
  let project;
  if (match.chainId === 'native') {
    project = await lookupNativeCoinGeckoAsset(match.coingeckoId, match.chain, report);
  } else if (match.chainId === 'solana') {
    project = await lookupSolanaToken(match.address, report);
  } else {
    project = await lookupGenericChainToken(match.chainId, match.address, report);
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
// the only real source is CoinGecko's coin detail by id. Holder count and
// holder concentration genuinely don't apply to a chain's own native asset
// (no reliable public source measures "native asset holder distribution"),
// so those stay null/unknown rather than being guessed. Liquidity, however,
// IS real and obtainable for assets that trade on their own chain via a
// canonical 1:1 wrapped/native representation (see NATIVE_LIQUIDITY_PROXY) -
// that's the same asset's real DEX liquidity, not an estimate.
async function lookupNativeCoinGeckoAsset(coingeckoId, chainLabel, report) {
  const liquidityProxy = NATIVE_LIQUIDITY_PROXY[coingeckoId];
  const detailP = withTimeout(fetchCoinGeckoCoinDetail(coingeckoId));
  const proxyDexP = withTimeout(liquidityProxy ? fetchDexscreenerToken(liquidityProxy.address, liquidityProxy.chainId) : Promise.resolve(null));
  const blockchairP = withTimeout(fetchBlockchairNativeStats(coingeckoId));

  if (report) {
    Promise.allSettled([detailP, blockchairP]).then(() => report.complete('connect'));
    Promise.allSettled([proxyDexP]).then(() => report.complete('liquidity'));
    // A native chain asset has no contract to verify, and no reliable public
    // source measures native holder distribution (see the note above). Both
    // stages are honestly skipped rather than shown as passing checks.
    report.skip('contract');
    report.skip('holders');
  }

  const [detailResult, proxyDexResult, blockchairResult] = await Promise.allSettled([detailP, proxyDexP, blockchairP]);
  const detail = detailResult.status === 'fulfilled' ? detailResult.value : null;
  const proxyDex = proxyDexResult.status === 'fulfilled' ? proxyDexResult.value : null;
  const blockchair = blockchairResult.status === 'fulfilled' ? blockchairResult.value : null;
  if (!detail) throw new Error('No public CoinGecko data was found for this asset.');
  const createdAt = detail.genesisDate ? new Date(detail.genesisDate).getTime() : null;
  const tokenAgeDays = createdAt ? daysSince(createdAt) : null;
  const socialLinks = mergeSocialLinks({ website: detail.website, twitter: detail.twitter, telegram: detail.telegram, github: detail.github });
  const liquidityUsd = proxyDex?.primaryPair ? Number(proxyDex.primaryPair.liquidity?.usd || 0) : null;
  const totalLiquidityUsd = proxyDex ? Number(proxyDex.totalLiquidityUsd || liquidityUsd || 0) : null;

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
    holderCount: blockchair?.holderCount || 0,
    communitySize: blockchair?.holderCount || 0,
    riskNotes: translate('scoring.riskNotes.liveDataAvailable'),
    realData: {
      source: [
        'CoinGecko',
        proxyDex?.primaryPair ? `${chainLabelFor(liquidityProxy.chainId)} DEX liquidity (wrapped/native representation)` : null,
        blockchair ? 'Blockchair on-chain stats' : null,
      ].filter(Boolean).join(' + '),
      // Real on-chain holder count when a provider covers this chain
      // (Blockchair); otherwise the CoinGecko market-rank distribution signal
      // supplies the holder-health score (see calculateLiveScores), never a
      // fabricated count.
      holderSource: blockchair?.source || (detail.marketCapRank ? 'CoinGecko market rank (native asset distribution)' : null),
      liquidityUsd,
      totalLiquidityUsd,
      marketCapUsd: detail.realMarketCapUsd || detail.fdvUsd,
      marketCapIsFdv: !detail.realMarketCapUsd && Boolean(detail.fdvUsd),
      marketCapRank: detail.marketCapRank,
      watchlistUsers: detail.watchlistUsers,
      tokenAgeDays,
      tokenAgeSource: createdAt ? 'CoinGecko genesis date' : null,
      holderCount: blockchair?.holderCount ?? null,
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
      // A native chain asset has NO token contract, so it has no mint, freeze,
      // or upgradeable authority anyone could exercise - issuance is governed by
      // network consensus, not a callable contract. These are therefore FALSE
      // (confirmed absent), not null (unknown): a factual security posture, not
      // a placeholder. This lets scoreSecurity() award the real "no authorities
      // enabled" score instead of returning Not Available.
      mintAuthorityEnabled: false,
      freezeAuthorityEnabled: false,
      upgradeable: false,
      nativeSecurity: {
        protocolSecured: true,
        chain: chainLabel,
        // Established, top-ranked base-layer chains are consensus-secured; this
        // is a real, checkable status, surfaced for display only.
        chainSecurityStatus: 'Consensus-secured base-layer network',
      },
      coingeckoListed: true,
      twitterFollowers: detail.twitterFollowers,
      telegramUsers: detail.telegramUsers,
      poolCount: proxyDex?.poolCount || 0,
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
  const normalized = address.toLowerCase();
  const isBaseToken = (pair) => pair.baseToken?.address?.toLowerCase() === normalized;
  const isQuoteToken = (pair) => pair.quoteToken?.address?.toLowerCase() === normalized;
  const solanaPairs = pairs
    .filter((pair) => pair.chainId === chainId)
    .filter((pair) => isBaseToken(pair) || isQuoteToken(pair));
  // Sorted by liquidity first, then 24h volume as a tiebreaker for near-equal
  // pools - never an arbitrary/first-returned pair. Used for aggregation.
  const sortedPairs = solanaPairs.sort((a, b) => {
    const liquidityDiff = Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0);
    if (liquidityDiff !== 0) return liquidityDiff;
    return Number(b?.volume?.h24 || 0) - Number(a?.volume?.h24 || 0);
  });
  // The PRIMARY pair also drives the live chart embed, which needs a pair the
  // embed can actually load: a real pairAddress and ACTIVE liquidity (a dead
  // pool renders as a permanent "Loading pair..."). And because the embed shows
  // the chart from the BASE token's perspective, the token should be the base;
  // a pair where it is only the quote is used for the chart only as a last
  // resort (#7). Aggregation still spans every matched pool, so metrics are
  // unchanged - this only sharpens which single pool the chart points at.
  const chartCandidates = sortedPairs.filter(
    (pair) => pair.pairAddress && Number(pair?.liquidity?.usd || 0) > 0
  );
  const primaryPair =
    chartCandidates.find(isBaseToken) ||
    chartCandidates[0] ||
    sortedPairs.find((pair) => pair.pairAddress && isBaseToken(pair)) ||
    sortedPairs.find((pair) => pair.pairAddress) ||
    sortedPairs[0] ||
    null;
  return {
    primaryPair,
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
    // Real, universal distribution signals CoinGecko returns for every listed
    // asset (including native coins that have no contract): the market-cap rank
    // and how many people track the asset. Used as an honest holder-distribution
    // proxy for native assets, which have no single on-chain "holder count" API.
    marketCapRank: Number(data.market_cap_rank || 0) || null,
    watchlistUsers: Number(community.watchlist_portfolio_users || 0) || null,
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

// EVM contract creation timestamp via the server-side evm-explorer proxy
// (Etherscan-family APIs, key held server-side). Without a key configured this
// resolves to null (Unknown), never a guess. The two-hop explorer lookup now
// happens inside the proxy function.
async function fetchExplorerContractCreation(chainId, address) {
  const result = await fetchExplorerProxy(chainId, 'creation', address);
  const timestampMs = result?.timestampMs;
  return typeof timestampMs === 'number' ? timestampMs : null;
}

// Real contract-security signal for EVM chains: is this a proxy
// (upgradeable) contract? Same explorer API, same free key requirement.
async function fetchExplorerContractFlags(chainId, address) {
  const result = await fetchExplorerProxy(chainId, 'flags', address);
  return result?.flags ?? null;
}

// Shared parser for GoPlus's token_security response shape (same fields on
// both the EVM and Solana endpoints): a holder_count plus a ranked holders
// list with each entry's share of supply as a 0-1 fraction.
function parseGoPlusHolderResult(result) {
  if (!result) return null;
  const holders = Array.isArray(result.holders) ? result.holders : [];
  const holderCount = result.holder_count !== undefined && result.holder_count !== null
    ? Number(result.holder_count)
    : (holders.length || null);
  if (!holderCount && !holders.length) return null;
  const percents = holders.map((holder) => Number(holder.percent || 0)).filter((value) => !Number.isNaN(value));
  return {
    holderCount: holderCount || null,
    topHolderPercent: percents.length ? roundPercent(percents[0]) : null,
    topTenHolderPercent: percents.length ? roundPercent(percents.slice(0, 10).reduce((total, value) => total + value, 0)) : null,
  };
}

// GoPlus Security (https://gopluslabs.io) - free, no API key, public token-
// security data covering most EVM chains. Used only to fill holder count/
// concentration gaps the existing Dexscreener/CoinGecko/GeckoTerminal/
// block-explorer sources never provide for EVM tokens (those never report
// holder data at all), so it can only add real data, never override it.
// GoPlus returns its boolean-ish flags as the strings "1"/"0" (or omits them
// when unknown). Normalizes to real true/false, or null when GoPlus has no
// answer - so an unknown flag stays "unknown", never a fabricated pass/fail.
function goPlusFlag(value) {
  if (value === '1' || value === 1) return true;
  if (value === '0' || value === 0) return false;
  return null;
}

async function fetchGoPlusEvmTokenSecurity(chainId, address) {
  const goPlusChainId = GOPLUS_EVM_CHAIN_IDS[chainId];
  if (!goPlusChainId) return null;
  const response = await fetch(`${GOPLUS_API_BASE}/token_security/${goPlusChainId}?contract_addresses=${address.toLowerCase()}`);
  if (!response.ok) throw new Error('GoPlus token-security lookup failed.');
  const data = await response.json();
  const result = data?.result?.[address.toLowerCase()];
  const parsed = parseGoPlusHolderResult(result);
  if (!result) return parsed ? { ...parsed, source: 'GoPlus Security token holder analysis' } : null;
  // Real contract-security signals GoPlus already returns for EVM tokens (free,
  // no key): a callable mint function (is_mintable), pausable transfers
  // (transfer_pausable ~ freeze authority), and a proxy/upgradeable contract
  // (is_proxy). These fill the mint/freeze/upgrade flags that otherwise require
  // a per-chain explorer API key, so Contract Security resolves for EVM tokens
  // even without one.
  const security = {
    mintAuthorityEnabled: goPlusFlag(result.is_mintable),
    freezeAuthorityEnabled: goPlusFlag(result.transfer_pausable),
    upgradeable: goPlusFlag(result.is_proxy),
  };
  const base = parsed || { holderCount: null, topHolderPercent: null, topTenHolderPercent: null };
  const hasSecurity = Object.values(security).some((value) => value !== null);
  if (!parsed && !hasSecurity) return null;
  return { ...base, ...security, source: 'GoPlus Security token analysis' };
}

// Same GoPlus dataset, Solana-specific endpoint - used only as a fallback
// when the Solana RPC full-account scan and Jupiter's indexed holder count
// both come back empty (rate limiting, RPC outage, very new mint), never to
// replace a real RPC/Jupiter measurement that already succeeded.
async function fetchGoPlusSolanaTokenSecurity(address) {
  const response = await fetch(`${GOPLUS_API_BASE}/solana/token_security?contract_addresses=${address}`);
  if (!response.ok) throw new Error('GoPlus Solana token-security lookup failed.');
  const data = await response.json();
  const result = data?.result?.[address];
  const parsed = parseGoPlusHolderResult(result);
  return parsed ? { ...parsed, source: 'GoPlus Security token holder analysis' } : null;
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

function translateRiskLevel(level = '') {
  return translate(`common.${level.toLowerCase()}`) || level;
}

function daysSince(date) {
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
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

// Native chain coins (BTC, ETH, SOL, BNB, ...) all share the same literal
// placeholder contract string (see lookupNativeCoinGeckoAsset) since they
// have no real contract address - that string must never be used to match
// two stored projects as "the same token", or scanning e.g. ETH after BTC
// would overwrite Bitcoin's stored profile with Ethereum's. Their id (e.g.
// "native-bitcoin") is already the real unique identity for these.
const NON_DEDUPABLE_CONTRACTS = new Set(['not provided', 'native asset (no contract)']);

function dedupableContract(contract) {
  const normalized = contract?.toLowerCase();
  return normalized && !NON_DEDUPABLE_CONTRACTS.has(normalized) ? normalized : null;
}

function findStoredProject(items = [], project = {}) {
  const normalizedContract = dedupableContract(project.contract);
  return items.find((item) => {
    const sameId = item.id === project.id;
    const sameContract = normalizedContract && dedupableContract(item.contract) === normalizedContract;
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

// The score bands, defined ONCE. riskKey() is the machine-readable form (a CSS
// hook, a lookup); riskBadge() is the human-readable, translated label built
// from the same bands - so the colour a user sees can never disagree with the
// words next to it, and moving a threshold moves both.
//
// riskBadge returns TRANSLATED text and must never be used as a className: that
// yields `class="High Risk"` in English (two junk classes, no styling) and a
// Cyrillic class name in Russian. Use riskKey for that.
const RISK_BANDS = [
  { min: 78, key: 'low' },
  { min: 55, key: 'medium' },
  { min: -Infinity, key: 'high' },
];

function riskKey(score) {
  const band = RISK_BANDS.find((entry) => Number(score) >= entry.min);
  return band ? band.key : 'high';
}

function riskBadge(score) {
  return translate(`common.${riskKey(score)}Risk`);
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
    assetCategory: project.assetCategory || 'Other',
    deepConfidenceScore: project.confidenceScore ?? null,
    hiddenRiskSignals: project.hiddenRiskSignals || [],
    positiveSignals: project.positiveSignals || [],
    aiRiskSummary: project.aiRiskSummary || '',
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
    growth.pdfDownload(project);
  } catch {
    alert('PDF generation failed to load. Check your connection and try again.');
  }
}

// The ONE entry point every "Unlock Premium" / plan CTA calls. It hides the
// card/Stripe split from every caller:
//   - card ENABLED  -> the Stripe checkout funnel (handleCheckout), exactly as before;
//   - card DISABLED -> there is no card option to offer, so instead of surfacing
//                      a "not configured" error it routes the user to the pricing
//                      page, where the working Wallet and Manual Crypto methods
//                      live. Returns { ok:true } so no caller shows an error.
// `navigate` is required so the disabled path can move the user; every call site
// already has it in scope.
async function startPremiumUpgrade({ navigate, project, plan = 'premium', wallet }) {
  if (!isCardPaymentEnabled()) {
    navigate('pricing');
    return { ok: true, routed: 'pricing' };
  }
  return plan === 'early_supporter'
    ? handleEarlySupporterClick(wallet)
    : handleUnlockPremiumClick(project, wallet);
}

function handleUnlockPremiumClick(project, wallet) {
  trackPremiumClick();
  growth.premiumClick();
  return handleCheckout('premium', wallet);
}

function handleEarlySupporterClick(wallet) {
  trackEarlySupporterClick();
  return handleCheckout('early_supporter', wallet);
}

async function handleCheckout(plan, wallet) {
  // Every abandoned path below is recorded with its REASON, not just its
  // existence. A checkout that dies on 'sign_in_required' is a product
  // bottleneck the operator can fix; one that dies on 'card_disabled' means the
  // card rail is intentionally off. Both look like "no conversion" in Google
  // Analytics, which is why they are recorded first-party here.
  if (!isCardPaymentEnabled()) {
    trackCheckoutUnavailable(plan, 'card_disabled');
    growth.checkoutFailed(plan, 'card_disabled');
    return { ok: false, message: stripeUnavailableMessage() };
  }

  // NOTE: the 'wallet_required' gate that used to sit here is gone. It refused
  // to start checkout without a connected Solana wallet, because entitlements
  // were keyed by wallet — so the platform demanded that people afraid of
  // wallet risk connect a wallet before it would sell them protection from it.
  // The buyer's identity is now their account; startStripeCheckout reports
  // 'sign_in_required' if they are signed out, which is recorded below like any
  // other abandonment reason.
  //
  // `wallet` is still threaded through as optional metadata for wallet-specific
  // features. It is not a precondition of anything.
  trackCheckoutStarted(plan);
  growth.checkoutStarted(plan);
  try {
    const result = await startStripeCheckout(plan, wallet);
    if (!result.ok) {
      trackCheckoutUnavailable(plan, result.reason);
      growth.checkoutFailed(plan, result.reason);
    }
    return result;
  } catch {
    trackCheckoutUnavailable(plan, 'checkout_error');
    growth.checkoutFailed(plan, 'checkout_error');
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
  const normalizedContract = dedupableContract(project.contract);
  const existing = findStoredProject(items, project);
  if (project.realData?.isDemo && existing?.realData && !existing.realData.isDemo) {
    return [normalizeProject(existing), ...items.filter((item) => item !== existing)];
  }
  const mergedProject = normalizeProject(mergeStoredMetadata(project, existing));
  const projectWithGrowth = applyHolderGrowth(mergedProject, existing);
  const withoutExisting = items.filter((item) => {
    const sameId = item.id === projectWithGrowth.id;
    const sameContract = normalizedContract && dedupableContract(item.contract) === normalizedContract;
    return !sameId && !sameContract;
  });
  return [projectWithGrowth, ...withoutExisting];
}

function applyHolderGrowth(project, existing) {
  return project;
}

// Pages that require authentication before the user can enter.
// Clicking these in the nav shows the gate modal rather than navigating.
const GATED_PAGES = new Set(['watchlist', 'alerts', 'add', 'launchpad', 'profile', 'referral']);

function App() {
  const { t } = useTranslation();
  const { user, isLoading: authLoading, gate } = useAuth();
  const [page, setPage] = useState(() => window.location.hash.replace('#/', '') || 'home');
  const [authModalMode, setAuthModalMode] = useState(null); // null = closed
  const [query, setQuery] = useState('');
  const [searchState, setSearchState] = useState({ status: 'idle', message: '' });
  // Live scan telemetry, written by the lookup layer as real operations settle
  // and read by the KHAN AI console. `revealScan` marks the one navigation that
  // came from a completed scan, so the Trust Score card plays its reveal there
  // and nowhere else.
  const [scanProgress, setScanProgress] = useState({ done: new Set(), skipped: new Set() });
  const [revealScan, setRevealScan] = useState(false);
  const [activeFilter, setActiveFilter] = useState('All');
  const [userProjects, setUserProjects] = useState(() => readProjectStorage());
  const [watchlist, setWatchlist] = useState(() => readStorage(WATCHLIST_KEY, []));
  const [methodologyOpen, setMethodologyOpen] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [verificationMap, setVerificationMap] = useState({});
  const [requestingVerification, setRequestingVerification] = useState(null);
  const { hasPremium, wallet: entitledWallet } = usePremiumEntitlement();
  const { recordContext, touch: retentionTouch } = useRetention();

  // Free Scanner Strategy (Step 4): the last server-authoritative view of the
  // caller's daily scan quota, and whether the daily limit modal is open. Null
  // until the first peek lands (or for premium users, who are never counted).
  const [scanQuota, setScanQuota] = useState(null);
  const [scanLimitOpen, setScanLimitOpen] = useState(false);

  // Synced Watchlist (Premium/Early Supporter only): merge in whatever the
  // account has saved server-side so the watchlist follows the user across
  // browsers/devices, on top of the existing free local-only watchlist. Works
  // for both paid-wallet and admin-granted Premium - the server resolves
  // identity from the wallet OR the auth token (see _premiumAccess.mjs), so an
  // empty wallet is fine when the user is signed in.
  useEffect(() => {
    if (!hasPremium) return;
    fetchUserData(entitledWallet).then((data) => {
      const serverWatchlist = data.watchlist || [];
      if (!serverWatchlist.length) return;
      setWatchlist((items) => [...new Set([...items, ...serverWatchlist])]);
    });
  }, [hasPremium, entitledWallet]);

  // Paint the "X of 3 free scans remaining" counter. Premium users have no
  // limit, so we neither peek nor show a counter for them. Re-runs when premium
  // status settles or the account changes, so a fresh sign-in shows that
  // account's real remaining count rather than the anonymous one. Peek writes
  // nothing server-side, so this costs no scan.
  useEffect(() => {
    if (hasPremium) {
      setScanQuota(null);
      return;
    }
    let cancelled = false;
    peekScanQuota({ wallet: entitledWallet }).then((view) => {
      if (!cancelled && view && !view.premium) setScanQuota(view);
    });
    return () => { cancelled = true; };
  }, [hasPremium, entitledWallet, user?.id]);

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
    // Must run before any growth event is emitted: it resolves and freezes the
    // first-touch channel from the landing URL's UTM/referrer, which are gone
    // after the first client-side navigation.
    initGrowth();
    // Referral capture: freeze the ?ref= code (write-once) and count the click
    // before any client-side navigation strips the query string. Returns the
    // active code so we can greet a referred visitor with the sign-up modal.
    const refCode = initReferral();
    // Landing on the public invite link (/signup?ref=CODE) means "create an
    // account". If nobody is signed in, open the sign-up modal so the referred
    // visitor is dropped straight into registration. Guarded to the /signup
    // path so a returning signed-out user who merely has a stored code is not
    // nagged on every visit.
    let arrivedOnSignup = false;
    try { arrivedOnSignup = window.location.pathname.replace(/\/+$/, '') === '/signup'; } catch { arrivedOnSignup = false; }
    if (refCode && arrivedOnSignup && !user) setAuthModalMode('register');
  }, []);

  useEffect(() => {
    setAnalyticsUserId(user?.id || null);
    // Stitches the account onto the same visitor that carries the first-touch
    // channel - the join that lets a signup be credited to the video that
    // caused it.
    setGrowthUserId(user?.id || null);
  }, [user?.id]);

  useEffect(() => {
    trackPageView(`/${page}`);
    trackPageViewEvent(`/${page}`);
    growth.pageView(`/${page}`);
  }, [page]);

  useEffect(() => {
    if (page === 'pricing') {
      trackPricingView();
      growth.pricingView();
    }
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
  const alertCount = useWatchlistAlertCount(projects, watchlist);

  useEffect(() => {
    if (reportProject) trackReportViewed(reportProject);
  }, [reportProject]);

  useEffect(() => {
    if (selectedProject) trackProjectViewEvent(selectedProject);
    if (selectedProject) growth.projectView(selectedProject);
    // The resume context for "continue where you left off". recordContext()
    // ignores a repeat of the project already recorded, and the server skips the
    // write for the same reason - so browsing back and forth costs nothing.
    if (selectedProject) recordContext(contextFromProject(selectedProject));
  }, [selectedProject?.id, recordContext]);

  // Records the day when a tab stays open across UTC midnight. touch() checks
  // the local day first and no-ops otherwise, so ordinary navigation issues no
  // request - without this, a long-lived session would silently break its own
  // streak while the user was actively using the app.
  useEffect(() => {
    retentionTouch();
  }, [page, retentionTouch]);

  const navigate = (target, options = {}) => {
    setRevealScan(Boolean(options.revealScan));
    window.location.hash = `/${target}`;
    setPage(target);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Single gate for everything KHAN AI renders. Any page id starting `admin-`
  // is Admin Panel, so a future admin route is excluded by default rather than
  // needing to be remembered here.
  const isAdminPage = page.startsWith('admin-');

  // Opens a scan: clears the previous telemetry and hands the lookup layer a
  // reporter to write real completions into. Every stage the console shows
  // originates here - there is no timer anywhere in this path.
  const beginScan = () => {
    setScanProgress({ done: new Set(), skipped: new Set() });
    return createScanReporter(setScanProgress);
  };

  // Free Scanner Strategy gate. Called at the start of every path that produces
  // a real report (the three scan executors below), BEFORE any lookup runs, so a
  // free user's fourth scan of the day is stopped rather than merely un-shown.
  // Returns true to proceed, false to block.
  //
  //   - Premium (merged client view) → always proceeds, and never even calls the
  //     server: a paying customer must not be gated by a network round-trip, and
  //     the server enforces the free tier independently, so this short-circuit is
  //     not a bypass — it is the "never strand a paying user" rule the whole app
  //     follows for Premium.
  //   - Free → the server reserves one scan. allowed:false opens the limit modal.
  //   - A null response (endpoint down) fails OPEN: scanning a token must not
  //     depend on the quota service being up.
  const guardScan = async () => {
    if (hasPremium) return true;
    const view = await consumeScanQuota({ wallet: entitledWallet });
    if (!view) return true; // fail open — never block on a quota outage
    if (view.premium) return true; // server also sees premium (e.g. proven wallet)
    setScanQuota(view);
    if (!view.allowed) {
      setScanLimitOpen(true);
      return false;
    }
    return true;
  };

  // The AI Trust Engine stages. These wrap the genuine scoring work
  // (normalizeProject runs the scoring engine in scoringEngine.js), so 'engine'
  // completes once scoring has actually run and 'score' once a real trustScore
  // exists on the project.
  const runTrustEngine = (liveLookup, report) => {
    report?.complete('engine');
    const project = normalizeProject(mergeStoredMetadata(liveLookup, findStoredProject(userProjects, liveLookup)));
    if (typeof project.trustScore === 'number') report?.complete('score');
    return project;
  };

  // Auth-gated navigation: intercepts clicks to protected pages and shows
  // the benefit modal instead of navigating. After auth the original target
  // is resumed automatically. Use this for all user-initiated nav clicks;
  // keep `navigate` for programmatic/internal routing that should not gate.
  const navTo = useCallback((target) => {
    if (GATED_PAGES.has(target) && !user) {
      gate(() => navigate(target));
      return;
    }
    navigate(target);
  }, [user, gate]);

  // navTo() only protects clicks that go through it - `page` can still land
  // on a gated value via the initial hash on load, hashchange (browser
  // back/forward, a typed or bookmarked URL), or any other navigate() call,
  // none of which run navTo's check. This effect is the single point that
  // catches ALL of those paths regardless of how `page` got there: it waits
  // for the session-restore check (authLoading) to finish - so a logged-in
  // user reloading a gated page isn't bounced before their session loads -
  // then, if the page is gated and there's still no user, sends them back to
  // a safe page and opens the same sign-in gate navTo would have shown,
  // resuming the original destination automatically after auth.
  useEffect(() => {
    if (authLoading) return;
    if (GATED_PAGES.has(page) && !user) {
      const target = page;
      window.location.hash = '/home';
      setPage('home');
      gate(() => navigate(target));
    }
  }, [page, user, authLoading, gate]);

  // While a gated page's auth state isn't confirmed yet (session restore in
  // flight, or confirmed logged-out and about to be redirected by the effect
  // above), the routed page below must not render - otherwise its content
  // flashes on screen for a frame before the redirect takes effect.
  const pageAuthReady = !GATED_PAGES.has(page) || (!authLoading && Boolean(user));

  const saveProjectProfile = (project) => {
    const normalized = normalizeProject(project);
    setUserProjects((items) => upsertProject(items, normalized));
    return normalized;
  };

  const addProject = (project) => {
    const normalized = saveProjectProfile(project);
    trackProjectAddedEvent(normalized);
    growth.projectAdded(normalized);
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
    if (!(await guardScan())) {
      setSearchState({ status: 'idle', message: '' });
      return;
    }
    const report = beginScan();
    setSearchState({ status: 'loading', message: t('search.fetching') });
    trackTokenScanStarted(match.address);
    trackSearchEvent(match.address);
    growth.search(match.address);
    try {
      const liveLookup = await lookupTokenMatch(match, report);
      const liveProject = runTrustEngine(liveLookup, report);
      setUserProjects((items) => upsertProject(items, liveProject));
      setSearchState({ status: 'success', message: t('search.successOpened', { name: liveProject.name || liveProject.ticker }) });
      trackTokenScanCompleted(match.address, 'success');
      trackTokenScanEvent(liveProject);
      growth.scanCompleted(liveProject);
      report.complete('finalize');
      navigate(`project/${liveProject.id}`, { revealScan: true });
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
      if (!(await guardScan())) {
        setSearchState({ status: 'idle', message: '' });
        return;
      }
      const report = beginScan();
      setSearchState({ status: 'loading', message: t('search.fetching') });
      trackTokenScanStarted(term);
      trackSearchEvent(term);
      growth.search(term);
      try {
        const liveLookup = await lookupSolanaToken(term, report);
        const liveProject = runTrustEngine(liveLookup, report);
        setUserProjects((items) => upsertProject(items, liveProject));
        setSearchState({ status: 'success', message: t('search.successOpened', { name: liveProject.name || liveProject.ticker }) });
        trackTokenScanCompleted(term, 'success');
        trackTokenScanEvent(liveProject);
        growth.scanCompleted(liveProject);
        report.complete('finalize');
        navigate(`project/${liveProject.id}`, { revealScan: true });
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

    // Same daily gate as the hero search. On block, open the limit modal and
    // return a short inline message so the token-check card also reflects it.
    if (!(await guardScan())) {
      return { status: 'error', message: t('scanLimit.inlineBlocked') };
    }

    try {
      trackTokenScanStarted(term);
      trackSearchEvent(term);
      growth.search(term);
      const liveLookup = await lookupSolanaToken(term);
      const liveProject = normalizeProject(mergeStoredMetadata(liveLookup, findStoredProject(userProjects, liveLookup)));
      setUserProjects((items) => upsertProject(items, liveProject));
      trackTokenScanCompleted(term, 'success');
      trackTokenScanEvent(liveProject);
      growth.scanCompleted(liveProject);
      navigate(`report/${liveProject.id}`);
      return { status: 'success', message: t('checkToken.successOpened', { name: liveProject.name || liveProject.ticker }) };
    } catch (error) {
      const existing = findStoredProject(userProjects, { contract: term });
      if (existing?.realData && !existing.realData.isDemo) {
        const existingProject = normalizeProject(existing);
        trackTokenScanCompleted(term, 'cached-live');
        trackTokenScanEvent(existingProject);
        growth.scanCompleted(existingProject);
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
    gate(() => {
      setWatchlist((items) => (items.includes(projectId) ? items.filter((id) => id !== projectId) : [...items, projectId]));
      // Persist to the server for any Premium user (paid wallet or admin-granted);
      // the server keys by wallet or auth account, so no wallet is required.
      if (hasPremium) toggleServerWatch(entitledWallet, projectId);
    });
  };

  // Deep-link entry for the SEO token pages (Direction 2): a visitor arriving
  // from Google at /token/<contract> gets an "Open live report" CTA pointing
  // to /?scan=<contract>. This runs the existing handleTokenCheck() once on
  // load and strips the param so a refresh doesn't re-scan. ADDITIVE: when the
  // param is absent this does nothing, so normal home/hash routing is
  // completely unaffected; any failure falls back silently to the home page.
  const scanDeepLinkFired = useRef(false);
  useEffect(() => {
    if (scanDeepLinkFired.current) return;
    let contract = '';
    try {
      contract = new URLSearchParams(window.location.search).get('scan') || '';
    } catch {
      contract = '';
    }
    if (!contract) return;
    scanDeepLinkFired.current = true;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('scan');
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    } catch {
      // best effort - stripping the param is cosmetic
    }
    Promise.resolve(handleTokenCheck(contract)).catch(() => {});
  }, []);

  return (
    // Every crown, teaser lock, and upgrade modal in the tree reads its
    // entitlement from here. It is fed the SAME merged `hasPremium` the rest of
    // App uses (account + legacy wallet + admin grant, via
    // usePremiumEntitlement) rather than resolving entitlement a second time —
    // two independent resolvers would eventually disagree, and the visible
    // symptom would be a paying user seeing a crown on something they own.
    <PremiumGateProvider hasPremium={hasPremium} navigate={navigate}>
    <div className={`app-shell${isAdminPage ? ' is-admin' : ''}`}>
      {/* The cyber environment is part of the user-facing product identity and
          is never shown behind the Admin Panel, which stays plain tooling. */}
      {!isAdminPage && <KhanAiBackdrop />}
      <Sidebar page={page} navigate={navigate} navTo={navTo} alertCount={alertCount} />
      <div className="app-content">
      <Header page={page} navigate={navigate} navTo={navTo} setAuthModalMode={setAuthModalMode} projects={projects} />
      <main>
        {page === 'home' && (
          <HomePage
            projects={projects}
            query={query}
            setQuery={setQuery}
            searchState={searchState}
            scanProgress={scanProgress}
            onSearch={handleSearch}
            onSelectMatch={resolveSearchMatch}
            onTokenCheck={handleTokenCheck}
            navigate={navigate}
            openMethodology={() => setMethodologyOpen(true)}
            watchlist={watchlist}
            alertCount={alertCount}
            scanQuota={scanQuota}
          />
        )}
        {page === 'explore' && (
          <ExplorePage
            projects={projects}
            query={query}
            setQuery={setQuery}
            searchState={searchState}
            scanProgress={scanProgress}
            onSearch={handleSearch}
            onSelectMatch={resolveSearchMatch}
            activeFilter={activeFilter}
            setActiveFilter={setActiveFilter}
            navigate={navigate}
          />
        )}
        {(page === 'early-stage' || page.startsWith('early-stage/') || page === 'early-stage-submit' || page === 'admin-early-stage') && (
          <Suspense fallback={<section className="page-section"><p className="lookup-message">{t('common.loading')}</p></section>}>
            <EarlyStageFeature
              view={
                page === 'early-stage-submit' ? 'submit'
                : page === 'admin-early-stage' ? 'admin'
                : page.startsWith('early-stage/') ? 'profile'
                : 'list'
              }
              projectId={page.startsWith('early-stage/') ? page.slice('early-stage/'.length) : ''}
              navigate={navigate}
            />
          </Suspense>
        )}
        {page === 'add' && pageAuthReady && <AddProjectPage onAdd={addProject} navigate={navigate} />}
        {page === 'launchpad' && pageAuthReady && <LaunchpadPage onCreateProfile={saveProjectProfile} navigate={navigate} />}
        {page === 'pricing' && <PricingPage navigate={navigate} />}
        {page === 'whitepaper' && <WhitepaperPage navigate={navigate} />}
        {page === 'compare' && <ComparePage projects={projects} navigate={navigate} />}
        {(page === 'watchlist' || page === 'alerts') && pageAuthReady && (
          <WatchlistPage projects={projects} watchlist={watchlist} toggleWatch={toggleWatch} navigate={navigate} />
        )}
        {/* Not in GATED_PAGES: the scanner is gated by a connected WALLET, not
            by an account. Requiring sign-in would block the one user who most
            needs it - someone who suspects their wallet is compromised right
            now and has no reason to trust us with an email first. */}
        {page === 'approvals' && <ApprovalsPage projects={projects} />}
        {page.startsWith('report/') && reportProject && (
          <RiskReportPage project={reportProject} navigate={navigate} />
        )}
        {page.startsWith('report/') && !reportProject && (
          <section className="page-section">
            <KhanAiEmptyState title={t('explore.emptyNoReportTitle')} text={t('explore.emptyNoReportText')} />
          </section>
        )}
        {(page.startsWith('project/') || page === 'khan') && selectedProject && (
          <ProjectProfile
            project={selectedProject}
            projects={projects}
            revealScan={revealScan}
            navigate={navigate}
            watched={watchlist.includes(selectedProject.id)}
            toggleWatch={() => toggleWatch(selectedProject.id)}
            onEdit={() => setEditingProject(selectedProject)}
            openMethodology={() => setMethodologyOpen(true)}
            onRequestVerification={() => gate(() => setRequestingVerification(selectedProject))}
          />
        )}
        {page.startsWith('project/') && !selectedProject && (
          <section className="page-section">
            <KhanAiEmptyState title={t('explore.emptyNoProfileTitle')} text={t('explore.emptyNoProfileText')} />
          </section>
        )}
        {page === 'khan' && !selectedProject && <KhanEcosystemPage navigate={navigate} />}
        {page === 'about' && <AboutPage openMethodology={() => setMethodologyOpen(true)} navigate={navigate} />}
        {page === 'privacy' && <PrivacyPolicyPage />}
        {page === 'terms' && <TermsOfServicePage />}
        {page === 'disclaimer' && <DisclaimerPage />}
        {page === 'contact' && <ContactPage />}
        {page === 'support' && <SupportPage navigate={navigate} />}
        {page === 'top-projects' && <TopProjectsPage projects={projects} navigate={navigate} />}
        {page === 'categories' && <CategoriesPage projects={projects} navigate={navigate} />}
        {page === 'admin-verify' && <AdminVerificationPage onReviewed={refreshVerificationMap} />}
        {page === 'admin-analytics' && <AdminAnalyticsPage />}
        {page === 'admin-support' && <AdminSupportPage />}
        {page === 'admin-report' && <AdminReportPage />}
        {page === 'admin-holders' && <AdminHolderAnalyticsPage />}
        {page === 'admin-premium' && <AdminPremiumPage />}
        {page === 'admin-referral' && <AdminReferralPage />}
        {page === 'watchtower' && pageAuthReady && <WatchtowerPage navigate={navigate} onOpenAuth={() => setAuthModalMode('login')} />}
        {page === 'referral' && pageAuthReady && <ReferralPage navigate={navigate} onOpenAuth={() => setAuthModalMode('login')} />}
        {page === 'profile' && pageAuthReady && <UserProfilePage navigate={navigate} onOpenAuth={() => setAuthModalMode('login')} />}
        {page.startsWith('verify-email/') && <EmailVerifyPage token={page.split('/')[1]} navigate={navigate} />}
        {page.startsWith('reset-password/') && <ResetPasswordPage token={page.split('/')[1]} navigate={navigate} />}
      </main>
      <Footer navigate={navigate} />
      <MobileNav page={page} navigate={navigate} navTo={navTo} setAuthModalMode={setAuthModalMode} />
      {authModalMode && (
        <AuthModal
          initialMode={authModalMode}
          onClose={() => setAuthModalMode(null)}
          onSuccess={() => setAuthModalMode(null)}
        />
      )}
      {methodologyOpen && <MethodologyModal onClose={() => setMethodologyOpen(false)} />}
      {/* Hitting the daily limit is the single highest-intent upgrade moment in
          the product — the user wanted one more analysis and could not have it.
          So it opens the FULL upgrade modal (comparison, lifetime price, one
          CTA) rather than the older limit-only notice, which explained the wall
          without ever showing what was on the other side of it. `reason` swaps
          the headline to the limit message; the rest of the pitch is shared. */}
      {scanLimitOpen && (
        <PremiumUpgradeModal
          reason="scanLimit"
          onClose={() => setScanLimitOpen(false)}
          navigate={(target) => { setScanLimitOpen(false); navigate(target); }}
        />
      )}
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
    </div>
    </PremiumGateProvider>
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

// ── Notification Center ───────────────────────────────────────────────────────
//
// Renders rows from stored KEYS + PARAMS, never stored prose - which is what
// lets a notification written months ago appear in whatever language the reader
// picked today (see netlify/functions/_notificationStore.mjs).

// Relative time, in the reader's language, from the four bucket strings rather
// than a date library. The bell only ever needs coarse recency ("2h ago"); an
// exact timestamp would be noise, and Intl.RelativeTimeFormat pluralisation
// across az/tr/ru is not worth the bundle for four buckets.
function notificationAge(iso, t) {
  const ts = Date.parse(iso || '');
  if (Number.isNaN(ts)) return '';
  const minutes = Math.floor((Date.now() - ts) / 60000);
  if (minutes < 1) return t('notifications.justNow');
  if (minutes < 60) return t('notifications.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('notifications.hoursAgo', { count: hours });
  return t('notifications.daysAgo', { count: Math.floor(hours / 24) });
}

// A risk alert stores the token's IDENTITY (`c:<contract>` / `id:<projectId>`),
// because the server cannot know a client-side project id (see the note in
// alerts-run.mjs). Resolving it to a route is therefore done here, where the
// project list exists. Unresolvable -> no link rather than a dead one.
function notificationTarget(notification, projects) {
  const link = notification.link;
  if (link) return link;
  const { identity, contract } = notification.params || {};
  if (contract) {
    const match = projects.find((project) => project.contract === contract);
    if (match) return `project/${match.id}`;
  }
  if (typeof identity === 'string' && identity.startsWith('id:')) {
    const id = identity.slice(3);
    if (projects.some((project) => project.id === id)) return `project/${id}`;
  }
  return '';
}

// The stored params carry the risk LEVEL as the engine's own value ('High' /
// 'Medium' / 'Low') - it is data, not display text, and the server has no reader
// to translate it for. Left raw, it produces a half-translated sentence: an
// Azerbaijani body reading "Etibar Balı indi 30/100 (High risk)". So the levels
// are localized here, at render time, through the SAME common.* keys
// riskAlerts.js already uses - one vocabulary for risk levels across the app.
function localizedParams(params, t) {
  const level = (value) => {
    if (typeof value !== 'string' || !value) return value;
    const key = value.toLowerCase();
    return ['high', 'medium', 'low'].includes(key) ? t(`common.${key}`) : value;
  };
  return {
    ...params,
    riskLevel: level(params?.riskLevel),
    previousRiskLevel: level(params?.previousRiskLevel),
  };
}

function NotificationRow({ notification, projects, navigate, onRead, onClose }) {
  const { t } = useTranslation();
  const target = notificationTarget(notification, projects);
  const reasons = Array.isArray(notification.params?.reasons) ? notification.params.reasons : [];
  const params = localizedParams(notification.params, t);

  const open = () => {
    if (!notification.read) onRead([notification.id]);
    if (target) {
      navigate(target);
      onClose();
    }
  };

  return (
    <li className={`notification-row${notification.read ? '' : ' unread'} severity-${notification.severity}`}>
      <button type="button" className="notification-row-btn" onClick={open}>
        <div className="notification-row-head">
          <strong>{t(`${notification.titleKey}`, params)}</strong>
          <span className="notification-age">{notificationAge(notification.at, t)}</span>
        </div>
        <p>{t(`${notification.bodyKey}`, params)}</p>
        {reasons.length > 0 && (
          <ul className="notification-reasons">
            {reasons.map(({ code, params }) => (
              <li key={code}>{t(`notifications.reasons.${code}`, params)}</li>
            ))}
          </ul>
        )}
      </button>
      {!notification.read && <span className="notification-dot" aria-hidden="true" />}
    </li>
  );
}

function NotificationBell({ projects, navigate }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { notifications, unread, markRead } = useRetention();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  // Signed-out users have no bell: notifications are addressed by account.
  // Rendering an empty bell would advertise a feature that cannot work.
  useEffect(() => {
    if (!open) return;
    const onDown = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    };
    const onEsc = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  if (!user) return null;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) trackEvent('notification_center_opened', { unread });
  };

  return (
    <div className="notification-bell-wrap" ref={wrapRef}>
      <button
        type="button"
        className="notification-bell"
        onClick={toggle}
        aria-label={t('notifications.open')}
        aria-expanded={open}
      >
        <Bell size={18} />
        {unread > 0 && <span className="notification-count">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className="notification-panel" role="dialog" aria-label={t('notifications.title')}>
          <div className="notification-panel-head">
            <strong>{t('notifications.title')}</strong>
            {unread > 0 && (
              <button type="button" className="notification-mark-all" onClick={() => markRead()}>
                {t('notifications.markAllRead')}
              </button>
            )}
          </div>

          {!notifications.length ? (
            <div className="notification-empty">
              <Bell size={22} />
              <strong>{t('notifications.empty')}</strong>
              <p>{t('notifications.emptyHint')}</p>
            </div>
          ) : (
            <ul className="notification-list">
              {notifications.map((notification) => (
                <NotificationRow
                  key={notification.id}
                  notification={notification}
                  projects={projects}
                  navigate={navigate}
                  onRead={markRead}
                  onClose={() => setOpen(false)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Header({ page, navigate, navTo, setAuthModalMode, projects }) {
  const { t } = useTranslation();
  return (
    <header className="site-header">
      <div className="site-header-top">
        <button className="brand" onClick={() => navigate('home')} aria-label={t('header.goHome')}>
          <span className="brand-mark">K</span>
          <span>
            <strong>KHAN Trust</strong>
            <small>{t('header.tagline')}</small>
          </span>
        </button>
        <div className="header-right">
          <NotificationBell projects={projects} navigate={navigate} />
          <AuthNavButton navigate={navigate} navTo={navTo} onOpenAuth={() => setAuthModalMode('login')} />
          <ConnectWalletButton variant="desktop" />
          <LanguageSwitcher variant="desktop" />
        </div>
      </div>
      <nav className="desktop-nav">
        {navItems.map((item) => (
          <button key={item.id} className={isActive(page, item.id) ? 'active' : ''} onClick={() => navTo(navTargetFor(item.id))}>
            {t(`nav.${item.id}`)}
          </button>
        ))}
      </nav>
    </header>
  );
}

function MobileNav({ page, navigate, navTo, setAuthModalMode }) {
  const { t } = useTranslation();
  return (
    <nav className="mobile-nav">
      {navItems.map((item) => {
        const Icon = item.icon;
        return (
          <button key={item.id} className={isActive(page, item.id) ? 'active' : ''} onClick={() => navTo(navTargetFor(item.id))}>
            <Icon size={18} />
            <span>{t(`nav.${item.id}`)}</span>
          </button>
        );
      })}
      <AuthNavButton navigate={navigate} navTo={navTo} onOpenAuth={() => setAuthModalMode('login')} variant="mobile" />
      <ConnectWalletButton variant="mobile" />
      <LanguageSwitcher variant="mobile" />
    </nav>
  );
}

function isActive(page, id) {
  if (id === 'khan') return page === 'khan';
  if (id === 'explore') return page === 'explore' || page.startsWith('project/') || page.startsWith('report/');
  if (id === 'early-stage') return page === 'early-stage' || page.startsWith('early-stage/') || page === 'early-stage-submit';
  if (id === 'support') return page === 'support' || page === 'admin-support';
  return page === id;
}

// Persistent left dashboard sidebar (desktop only - the existing
// MobileNav bottom bar keeps covering small screens, unchanged). Routes
// through the same `navigate(target)` the top Header already uses, so
// every existing page/route continues to work exactly as before; this is
// a second way to reach them, not a replacement for the routing itself.
// "Alerts" is a dedicated nav entry/route, but it renders the exact same
// WatchlistPage and risk-change alerts (see detectRiskAlerts) rather than
// duplicating that page - only the route id differs, so it can have its
// own exact active state independent of "Watchlist" (see isSidebarActive).
const SIDEBAR_ITEMS = [
  { id: 'home', labelKey: 'sidebar.dashboard', icon: LayoutDashboard },
  { id: 'explore', labelKey: 'sidebar.explore', icon: Layers3 },
  { id: 'early-stage', labelKey: 'sidebar.earlyStage', icon: Rocket },
  { id: 'watchlist', labelKey: 'sidebar.watchlist', icon: Eye },
  { id: 'alerts', labelKey: 'sidebar.alerts', icon: Bell, badgeFrom: 'alertCount' },
  // Sits directly after Alerts: an alert is a single event, the Watchtower
  // Report is the period view over the same monitoring. Adjacent so the
  // relationship is obvious without explanation.
  { id: 'watchtower', labelKey: 'sidebar.watchtower', icon: ShieldCheck },
  { id: 'approvals', labelKey: 'sidebar.approvals', icon: Shield },
  { id: 'compare', labelKey: 'sidebar.comparison', icon: Scale },
  { id: 'top-projects', labelKey: 'sidebar.topProjects', icon: Trophy },
  { id: 'categories', labelKey: 'sidebar.categories', icon: Tags },
  { id: 'referral', labelKey: 'sidebar.referral', icon: Gift },
];

// Exact route matching for the sidebar only - intentionally separate from
// the top Header's isActive(), which also has to light up "Explore" while
// viewing a project/report page. Sidebar items are one-to-one with routes,
// so each one matches only its own page id (plus the explicit "/dashboard"
// and "/comparison" aliases called out in the spec) - never two at once.
function isSidebarActive(page, id) {
  if (id === 'home') return page === 'home' || page === 'dashboard';
  if (id === 'compare') return page === 'compare' || page === 'comparison';
  if (id === 'early-stage') return page === 'early-stage' || page.startsWith('early-stage/') || page === 'early-stage-submit';
  return page === id;
}

function Sidebar({ page, navigate, navTo, alertCount }) {
  const { t } = useTranslation();
  return (
    <aside className="app-sidebar">
      <nav className="sidebar-nav">
        {SIDEBAR_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = isSidebarActive(page, item.id);
          const badge = item.badgeFrom === 'alertCount' ? alertCount : 0;
          return (
            <button key={item.id} className={active ? 'active' : ''} onClick={() => navTo(item.id)}>
              <Icon size={18} />
              <span>{t(item.labelKey)}</span>
              {badge > 0 && <span className="sidebar-badge">{badge}</span>}
            </button>
          );
        })}
      </nav>
      <div className="sidebar-promo">
        <Crown size={28} />
        <strong>{t('sidebar.promoTitle')}</strong>
        <p>{t('sidebar.promoText')}</p>
        <button className="sidebar-promo-cta" onClick={() => navigate('khan')}>
          {t('sidebar.promoCta')} <ArrowRight size={14} />
        </button>
      </div>
    </aside>
  );
}

// ── Personalized dashboard (signed-in users only) ─────────────────────────────
//
// Sits above the generic home content and is built ENTIRELY from things the user
// actually did. It reuses what already exists rather than duplicating it:
//
//   - recent scans come from auth-user-scans.mjs (the same endpoint the profile
//     page already uses), derived from the one analytics event log;
//   - the watchlist and its risk-change alerts come from the existing watchlist
//     state and useWatchlistAlertCount - no second alert implementation;
//   - streak / activity / resume context come from retention-sync.
//
// Renders NOTHING for a signed-out visitor: a dashboard of empty panels is a
// worse landing page than the marketing one, and this must not push the search
// box below the fold for someone who arrived to scan a token.
function ContinueCard({ context, projects, navigate }) {
  const { t } = useTranslation();
  if (!context) return null;
  // Only offer a resume the app can actually honour. The project lives in the
  // browser's storage, so a context recorded on another device may point at
  // something this one has never seen - a card that navigates nowhere is worse
  // than no card.
  const project = projects.find((item) => item.id === context.projectId);
  if (!project) return null;
  const label = project.name || project.ticker || context.name || context.ticker;

  return (
    <div className="retention-continue">
      <div>
        <span className="retention-card-label">{t('retention.continueTitle')}</span>
        <strong>{label}</strong>
      </div>
      <button className="secondary-button" type="button" onClick={() => navigate(`project/${project.id}`)}>
        {t('retention.continueCta', { name: label })} <ArrowRight size={14} />
      </button>
    </div>
  );
}

function StreakCard({ streak }) {
  const { t } = useTranslation();
  if (!streak) return null;

  // Three genuinely different states, deliberately not collapsed into one
  // number. "0" for someone who signed up ninety seconds ago reads as a failure
  // they have not had time to have; and a lapsed user needs to know when they
  // were last here, not just that the streak is gone.
  let value;
  let hint;
  if (!streak.started) {
    value = t('retention.streakNone');
    hint = t('retention.streakNoneHint');
  } else if (streak.current > 0) {
    value = t(streak.current === 1 ? 'retention.streakDay' : 'retention.streakDays', { count: streak.current });
    hint = streak.longest > streak.current ? t('retention.streakLongest', { count: streak.longest }) : '';
  } else {
    value = t('retention.streakNone');
    const days = streak.lastActiveDay ? Math.max(1, Math.round((Date.now() - Date.parse(`${streak.lastActiveDay}T00:00:00Z`)) / 86400000)) : null;
    hint = days ? t('retention.streakBroken', { days }) : '';
  }

  return (
    <div className="retention-stat">
      <span className="retention-card-label">{t('retention.streakTitle')}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function RetentionDashboard({ projects, watchlist, navigate, alertCount }) {
  const { t } = useTranslation();
  const { user, fetchUserScans } = useAuth();
  const { status, retention } = useRetention();
  const [scans, setScans] = useState([]);
  const [scansLoading, setScansLoading] = useState(false);

  // Reuses the endpoint the profile page already calls. Recent scans are derived
  // from the shared analytics event log, so this needs no new persistence.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setScansLoading(true);
    fetchUserScans()
      .then((list) => { if (!cancelled) setScans(list.slice(0, 4)); })
      .catch(() => { if (!cancelled) setScans([]); })
      .finally(() => { if (!cancelled) setScansLoading(false); });
    return () => { cancelled = true; };
  }, [user?.id, fetchUserScans]);

  if (!user) return null;

  const watched = projects.filter((project) => watchlist.includes(project.id)).slice(0, 4);
  const firstName = (user.name || user.email || '').split(/[\s@]/)[0];
  // A first-ever day is a welcome, not a welcome BACK. Getting this backwards on
  // someone's first minute is a small thing that reads as the product not
  // knowing who it is talking to.
  const returning = Boolean(retention?.activity?.totalActiveDays > 1);

  return (
    <section className="retention-dashboard">
      <h2 className="retention-greeting">
        {t(returning ? 'retention.welcomeBack' : 'retention.welcomeFirst', { name: firstName })}
      </h2>

      {status === 'loading' && <p className="retention-loading">{t('retention.loading')}</p>}

      {/* status === 'error' renders nothing extra on purpose: retention is
          memory, and a broken memory must not become an error banner on the
          home page of a product people came here to scan tokens with. */}

      <ContinueCard context={retention?.continueContext} projects={projects} navigate={navigate} />

      <div className="retention-grid">
        <StreakCard streak={retention?.streak} />

        {retention?.activity && (
          <div className="retention-stat">
            <span className="retention-card-label">{t('retention.activityTitle')}</span>
            <strong>{t('retention.activityLast7', { count: retention.activity.activeDaysLast7 })}</strong>
            <small>{t('retention.activityLast30', { count: retention.activity.activeDaysLast30 })}</small>
          </div>
        )}

        {alertCount > 0 && (
          <button className="retention-stat retention-alert-stat" type="button" onClick={() => navigate('watchlist')}>
            <span className="retention-card-label">{t('sidebar.alerts')}</span>
            <strong>{t(alertCount === 1 ? 'retention.alertsPending' : 'retention.alertsPending_plural', { count: alertCount })}</strong>
          </button>
        )}
      </div>

      <div className="retention-columns">
        <div className="retention-column">
          <div className="retention-column-head">
            <strong>{t('retention.recentTitle')}</strong>
          </div>
          {scansLoading && <p className="retention-muted">{t('retention.loading')}</p>}
          {!scansLoading && !scans.length && <p className="retention-muted">{t('retention.recentEmpty')}</p>}
          <ul className="retention-list">
            {scans.map((scan) => {
              // A scan event records the contract; the routable project may or
              // may not exist in this browser. Unresolvable -> plain row, not a
              // link that goes nowhere.
              const project = projects.find((item) => item.contract && item.contract === scan.contract);
              const label = scan.projectName || scan.ticker || scan.contract || '';
              return (
                <li key={`${scan.contract || scan.projectId}-${scan.timestamp}`}>
                  {project ? (
                    <button type="button" onClick={() => navigate(`project/${project.id}`)}>
                      <span>{label}</span>
                      {typeof scan.trustScore === 'number' && <em className={`retention-score ${riskKey(scan.trustScore)}`}>{scan.trustScore}</em>}
                    </button>
                  ) : (
                    <span className="retention-list-flat">
                      <span>{label}</span>
                      {typeof scan.trustScore === 'number' && <em className={`retention-score ${riskKey(scan.trustScore)}`}>{scan.trustScore}</em>}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="retention-column">
          <div className="retention-column-head">
            <strong>{t('retention.watchlistTitle')}</strong>
            {watched.length > 0 && (
              <button type="button" className="retention-link" onClick={() => navigate('watchlist')}>
                {t('retention.watchlistCta')}
              </button>
            )}
          </div>
          {!watched.length && <p className="retention-muted">{t('retention.watchlistEmpty')}</p>}
          <ul className="retention-list">
            {watched.map((project) => (
              <li key={project.id}>
                <button type="button" onClick={() => navigate(`project/${project.id}`)}>
                  <span>{project.name || project.ticker}</span>
                  {typeof project.trustScore === 'number' && <em className={`retention-score ${riskKey(project.trustScore)}`}>{project.trustScore}</em>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

// Free Scanner Strategy — the inline "2 of 3 free scans remaining today" line
// under the hero search box. Renders nothing for premium users (quota is null)
// and nothing until the first server view lands, so it never flashes a wrong
// number. At zero it flips to a compact upgrade nudge — the same message the
// block modal leads with, kept short for the inline slot.
function ScanQuotaMeter({ quota, navigate }) {
  const { t } = useTranslation();
  if (!quota || quota.premium || quota.unlimited) return null;
  const limit = quota.limit || FREE_DAILY_SCAN_LIMIT;
  const remaining = Math.max(0, Number(quota.remaining) || 0);

  if (remaining <= 0) {
    return (
      <div className="scan-quota-meter reached" role="status">
        <Lock size={14} />
        <span>{t('scanLimit.meterReached')}</span>
        <button type="button" className="scan-quota-upgrade" onClick={() => navigate('pricing')}>
          {t('scanLimit.upgradeCta')} <ArrowRight size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="scan-quota-meter" role="status">
      <Search size={14} />
      <span>{t('scanLimit.meterRemaining', { remaining, limit })}</span>
    </div>
  );
}

// The hard block after the third daily scan. Explains that the free limit is
// reached, when it resets, and leads with the Premium upgrade CTA. Premium is
// the way out of the wall, so it is the primary button.
function ScanLimitModal({ quota, onClose, navigate }) {
  const { t } = useTranslation();
  const limit = quota?.limit || FREE_DAILY_SCAN_LIMIT;
  const hours = hoursUntilReset(quota?.resetsAt);
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t('scanLimit.title')}>
      <div className="modal-panel scan-limit-modal">
        <button className="close-button" onClick={onClose} aria-label={t('common.close')}><X size={20} /></button>
        <div className="scan-limit-icon"><Lock size={26} /></div>
        <h2>{t('scanLimit.title')}</h2>
        <p>{t('scanLimit.body', { limit })}</p>
        {hours != null && <p className="scan-limit-reset">{t('scanLimit.resetsIn', { hours })}</p>}
        <ul className="scan-limit-perks">
          {t('scanLimit.perks').map((perk) => (
            <li key={perk}><CheckCircle2 size={16} /> {perk}</li>
          ))}
        </ul>
        <div className="scan-limit-actions">
          <button className="primary-button" type="button" onClick={() => navigate('pricing')}>
            {t('scanLimit.upgradeCta')} <ArrowRight size={16} />
          </button>
          <button className="ghost-button" type="button" onClick={onClose}>
            {t('scanLimit.dismiss')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Your Risk Over Time ──────────────────────────────────────────────────────
//
// What changed across the user's projects since they were last here. Reads the
// CLIENT lane (score history) — see src/sinceLastVisit.js for why this is a
// different question from the Watchtower Report and must never be merged with
// it.
//
// RENDERS NOTHING RATHER THAN "NOTHING CHANGED".
//
// Three states collapse to silence: signed out, no previous visit (a first-ever
// session has no "since"), and no comparable history. Only a real, measured
// change puts a panel on the dashboard. This is the opposite of the Watchtower
// Report's rule, and deliberately so: the Watchtower is a report the user
// ASKED for, where "we checked and all is well" is the answer; this is an
// interruption on a page they came to for something else, and it has to earn
// its space every single time.
function SinceLastVisitPanel({ projects, navigate }) {
  const { t, language } = useTranslation();
  const { user } = useAuth();
  const { hasPremium } = usePremiumEntitlement();
  const { retention } = useRetention();
  const previousSeen = retention?.previousSeen || null;

  const { entries, ready } = useSinceLastVisit({
    projects,
    previousSeen,
    enabled: Boolean(user) && hasPremium,
  });

  if (!user || !hasPremium || !ready || !entries.length) return null;

  return (
    <section className="content-band since-visit">
      <SectionTitle icon={History} eyebrow={t('sinceVisit.eyebrow')} title={t('sinceVisit.title')} />
      <p className="since-visit-subtitle">
        {t('sinceVisit.subtitle', { count: entries.length })}
      </p>
      <ul className="since-visit-list">
        {entries.map((entry) => (
          <li
            key={entry.identity}
            className={`since-visit-row since-visit-${entry.riskChange?.worse ? 'critical' : entry.worse ? 'worse' : 'better'}`}
          >
            <button
              type="button"
              className="since-visit-name"
              onClick={() => navigate(`project/${entry.project.id}`)}
            >
              {entry.project.name}
              {entry.project.ticker && <span>{entry.project.ticker}</span>}
            </button>
            <p className="since-visit-score">
              {t('sinceVisit.scoreLine', {
                score: entry.latest.score,
                previous: entry.baseline.score,
              })}
            </p>
            {/* The WHY, from the same describeChange() the on-page history
                timeline uses — so the dashboard and the token page can never
                word the same movement differently. */}
            <ul className="since-visit-reasons">
              {entry.changes
                .filter((change) => change.key !== 'trustScore')
                .slice(0, 3)
                .map((change, index) => (
                  <li key={`${change.key}-${index}`}>{describeChange(change, language)}</li>
                ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

function HomePage({ projects, query, setQuery, searchState, scanProgress, onSearch, onSelectMatch, onTokenCheck, navigate, openMethodology, watchlist, alertCount, scanQuota }) {
  const { t } = useTranslation();
  const featured = projects.slice(0, 4);
  const heroProject = featured[0];
  return (
    <>
      <section className="hero-section">
        <div className="hero-grid">
          <div className="hero-copy">
            <KhanAiHeroMark title={t('home.title')}>
              <p className="eyebrow"><Shield size={16} /> {t('home.eyebrow')}</p>
            </KhanAiHeroMark>
            <p className="hero-subtitle">{t('home.subtitle')}</p>
            <p className="hero-explainer">{t('home.explainer')}</p>
            <SearchBox value={query} onChange={setQuery} onSubmit={onSearch} loading={searchState.status === 'loading'} />
            <ScanQuotaMeter quota={scanQuota} navigate={navigate} />
            {/* KHAN AI takes over the scan's loading and error reporting; the
                plain one-line status stays for the quieter states (success,
                multiple matches) so nothing is said twice. */}
            <KhanAiScanConsole
              active={searchState.status === 'loading'}
              progress={scanProgress}
              error={searchState.status === 'error' ? searchState.message : null}
            />
            {searchState.status !== 'loading' && searchState.status !== 'error' && <SearchStatus state={searchState} />}
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
      {/* Directly BELOW the hero, never above it. The hero holds the search box,
          and this is a token scanner: pushing search under a wall of personal
          panels would serve the retention loop at the expense of the thing
          people actually came to do. Renders nothing at all when signed out. */}
      {/* Leads the personal panels: "what changed while I was gone" is the
          question a returning user actually has, and the streak/continue cards
          below are context for it rather than the other way round. */}
      <SinceLastVisitPanel projects={projects} navigate={navigate} />
      <RetentionDashboard projects={projects} watchlist={watchlist} navigate={navigate} alertCount={alertCount} />
      <CheckAnyTokenSection onTokenCheck={onTokenCheck} navigate={navigate} />
      <KhanEcosystemStrip navigate={navigate} />
      <section className="content-band">
        <SectionTitle icon={BarChart3} eyebrow={t('home.exploreEyebrow')} title={t('home.exploreTitle')} />
        <div className="project-grid">
          {featured.map((project) => (
            <ProjectCard key={project.id} project={project} navigate={navigate} />
          ))}
        </div>
        {!featured.length && <KhanAiEmptyState title={t('home.emptyNoSavedTitle')} text={t('home.emptyNoSavedText')} />}
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

function ExplorePage({ projects, query, setQuery, searchState, scanProgress, onSearch, onSelectMatch, activeFilter, setActiveFilter, navigate }) {
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
      {/* A failed scan on the home page redirects here, so this is where the
          error is actually read - KHAN AI reports it in both places. */}
      <KhanAiScanConsole
        active={searchState.status === 'loading'}
        progress={scanProgress}
        error={searchState.status === 'error' ? searchState.message : null}
      />
      {searchState.status !== 'loading' && searchState.status !== 'error' && <SearchStatus state={searchState} />}
      <SearchMatches state={searchState} onSelect={onSelectMatch} />
      <div className="filter-row">
        {filters.map((filter) => (
          <button key={filter} className={activeFilter === filter ? 'active' : ''} onClick={() => setActiveFilter(filter)}>
            {t(`explore.filters.${FILTER_KEY_MAP[filter]}`)}
          </button>
        ))}
        {/* Optional cross-link to the additive Early Stage Projects section.
            Deliberately not part of `activeFilter` state - it navigates to the
            separate feature rather than filtering the existing project list,
            so existing filters are untouched. */}
        <button className="es-filter-chip" onClick={() => navigate('early-stage')}>
          <Rocket size={14} /> {t('explore.filters.earlyStage')}
        </button>
      </div>
      <div className="project-grid">
        {filtered.map((project) => (
          <ProjectCard key={project.id} project={project} navigate={navigate} />
        ))}
      </div>
      {!filtered.length && <KhanAiEmptyState title={t('explore.emptyNoMatchTitle')} text={t('explore.emptyNoMatchText')} />}
    </section>
  );
}

// Sidebar "Top Projects" - the same tracked projects as Explore, just
// ranked by Trust Score instead of recency. Pure client-side re-sort of
// data Explore already has; no new scoring or data source.
function TopProjectsPage({ projects, navigate }) {
  const { t } = useTranslation();
  const ranked = [...projects].sort((a, b) => (b.trustScore || 0) - (a.trustScore || 0));
  return (
    <section className="page-section">
      <SectionTitle icon={Trophy} eyebrow="Ranked" title="Top Projects" />
      <div className="project-grid">
        {ranked.map((project, index) => (
          <div className="top-project-card" key={project.id}>
            <span className="top-project-rank">#{index + 1}</span>
            <ProjectCard project={project} navigate={navigate} />
          </div>
        ))}
      </div>
      {!ranked.length && <KhanAiEmptyState title={t('explore.emptyNoMatchTitle')} text={t('explore.emptyNoMatchText')} />}
    </section>
  );
}

// Sidebar "Categories" - groups already-classified projects (see
// classifyAsset in scoringEngine.js, surfaced as project.assetCategory) so
// users can browse by asset type instead of by name. Selecting a category
// jumps to Explore filtered to those tokens by reusing Explore's own text
// search against the category name.
function CategoriesPage({ projects, navigate }) {
  const { t } = useTranslation();
  const categories = useMemo(() => {
    const counts = new Map();
    projects.forEach((project) => {
      const category = project.assetCategory || 'Other';
      counts.set(category, (counts.get(category) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [projects]);

  return (
    <section className="page-section">
      <SectionTitle icon={Tags} eyebrow="Browse" title="Categories" />
      <div className="categories-browse-grid">
        {categories.map(([category, count]) => (
          <button className="categories-browse-card" key={category} onClick={() => navigate('explore')}>
            <span className="categories-browse-icon"><Tags size={20} /></span>
            <strong>{category}</strong>
            <span>{count} {count === 1 ? 'project' : 'projects'}</span>
          </button>
        ))}
      </div>
      {!categories.length && <KhanAiEmptyState title={t('explore.emptyNoMatchTitle')} text={t('explore.emptyNoMatchText')} />}
    </section>
  );
}

// Phase 3 — Analyst Attention: the one new page this roadmap adds. Reuses
// the existing ProjectCard/empty-state visual language rather than
// inventing new layout, and only adds a risk-change alert strip (Phase 1
// history compared day-over-day, see riskAlerts.js) under each watched
// token - no separate "alerts" surface to maintain.
function WatchlistPage({ projects, watchlist, toggleWatch, navigate }) {
  const { t, language } = useTranslation();
  const watchedProjects = projects.filter((project) => watchlist.includes(project.id));
  const [alertsByProjectId, setAlertsByProjectId] = useState({});

  // Re-runs on language change too, not just when the watchlist itself
  // changes - detectRiskAlerts() renders its message text at the moment it
  // runs (see riskAlerts.js), so a stale cached alert would otherwise keep
  // showing the language it was first fetched in until the watchlist itself
  // changed again.
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      watchedProjects.map(async (project) => {
        const key = historyKeyFor(project);
        const history = key ? await fetchScoreHistory(key).catch(() => []) : [];
        return [project.id, detectRiskAlerts(history)];
      })
    ).then((entries) => {
      if (!cancelled) setAlertsByProjectId(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchlist.join(','), language]);

  return (
    <section className="page-section">
      <SectionTitle icon={Bell} eyebrow={t('watchlist.eyebrow')} title={t('watchlist.title')} />
      {!watchedProjects.length && <KhanAiEmptyState title={t('watchlist.emptyTitle')} text={t('watchlist.emptyText')} />}
      {/* The Watchlist is Premium. A free user who saved projects BEFORE this
          became paid still has every one of them — the entries live untouched
          in local storage and sync back the moment Premium is active. The lock
          hides the list; it never deletes it. `description` states that
          explicitly, because "my saved work disappeared behind a paywall" is
          the one upgrade prompt guaranteed to lose a user rather than convert
          them, and here it would not even be true. */}
      <PremiumLock
        feature="watchlist"
        description={watchedProjects.length
          ? t('watchlist.lockedWithItems', { count: watchedProjects.length })
          : undefined}
      >
      <div className="project-grid">
        {watchedProjects.map((project) => (
          <div className="watchlist-item" key={project.id}>
            <ProjectCard project={project} navigate={navigate} />
            {(alertsByProjectId[project.id] || []).map((alert) => (
              <div className={`watchlist-alert ${alert.severity}`} key={alert.type}>
                <AlertTriangle size={15} /> <span>{alert.message}</span>
              </div>
            ))}
            <button className="ghost-button" type="button" onClick={() => toggleWatch(project.id)}>
              {t('watchlist.remove')}
            </button>
          </div>
        ))}
      </div>
      </PremiumLock>
    </section>
  );
}

// ── Wallet Approval Scanner ───────────────────────────────────────────────────
//
// Shows which addresses may move tokens out of the connected wallet, and lets
// the user take that permission back. All chain knowledge lives in
// src/approvals/ - this is presentation only, so an EVM lane needs no change
// here (see src/approvals/index.js).
//
// Mainnet explorer, no cluster suffix: unlike the Launchpad (which is devnet by
// default, hence solanaExplorerUrl's `network` argument), the scanner reads the
// wallet the user has actually connected, which is mainnet. Reusing the devnet
// helper here would link every revoke receipt to a cluster it does not exist on.
function mainnetTxUrl(signature) {
  return `https://explorer.solana.com/tx/${signature}`;
}

// A token we already know about gets its ticker; anything else keeps its raw
// mint. Never invents a symbol - see the note in solanaLane.normalizeAccount.
function approvalSymbol(approval, t) {
  return approval.tokenSymbol || approval.tokenName || t('approvals.row.unknownToken');
}

function formatApprovalAmount(uiAmount, isUnlimited, t) {
  if (isUnlimited) return t('approvals.row.unlimited');
  // null means we could not determine decimals, so any number we printed would
  // be wrong by orders of magnitude. Say so instead.
  if (uiAmount === null || uiAmount === undefined) return t('approvals.row.unknownAmount');
  // Zero is printed HERE rather than deferred to formatNumber, which renders any
  // falsy value as "Not available". That is reasonable for the market data it
  // was written for, where 0 liquidity really does mean "no reading" - but it is
  // exactly backwards here. An empty balance is a KNOWN fact, and the specific
  // fact that makes a dormant approval dormant. Showing it as "unknown" would
  // invert the meaning of the safest row on the page.
  if (uiAmount === 0) return '0';
  return formatNumber(uiAmount);
}

function ApprovalReasons({ approval }) {
  const { t } = useTranslation();
  const symbol = approvalSymbol(approval, t);
  return (
    <ul className="approval-reasons">
      {approval.reasonCodes.map((code) => (
        <li key={code}>
          {t(`approvals.reasons.${code}`, {
            symbol,
            amount: formatApprovalAmount(approval.approvedUi, approval.isUnlimited, t),
          })}
        </li>
      ))}
    </ul>
  );
}

function ApprovalCard({ approval, onRevoke, busy }) {
  const { t } = useTranslation();
  const symbol = approvalSymbol(approval, t);
  return (
    <article className={`approval-card risk-${approval.risk}`}>
      <header className="approval-card-head">
        <div className="approval-token">
          <strong>{symbol}</strong>
          <code className="approval-mint" title={approval.tokenAddress}>{formatWalletAddress(approval.tokenAddress)}</code>
        </div>
        <span className={`approval-risk-badge risk-${approval.risk}`}>{t(`approvals.risk.${approval.risk}`)}</span>
      </header>

      <dl className="approval-facts">
        <div>
          <dt>{t('approvals.row.delegate')}</dt>
          <dd><code title={approval.spender}>{formatWalletAddress(approval.spender)}</code></dd>
        </div>
        <div>
          <dt>{t('approvals.row.approved')}</dt>
          <dd>{formatApprovalAmount(approval.approvedUi, approval.isUnlimited, t)}</dd>
        </div>
        <div>
          <dt>{t('approvals.row.balance')}</dt>
          <dd>{formatApprovalAmount(approval.balanceUi, false, t)}</dd>
        </div>
        <div>
          <dt>{t('approvals.row.exposure')}</dt>
          <dd className={approval.hasLiveExposure ? 'approval-exposed' : ''}>
            {formatApprovalAmount(approval.exposureUi, false, t)}
          </dd>
        </div>
      </dl>

      <ApprovalReasons approval={approval} />

      <button className="danger-button approval-revoke-btn" type="button" onClick={() => onRevoke(approval)} disabled={busy}>
        <Shield size={16} /> {t('approvals.row.revoke')}
      </button>
    </article>
  );
}

// The confirmation dialog and every terminal state of a revoke.
//
// Renders only from an explicit user action, and `confirm` is the ONLY phase
// with a button that signs. The user sees the exact delegate, the exact token,
// the exact approved amount, the risk level and the real network fee BEFORE that
// button exists - which is the point of preparing the transaction first (see
// solanaLane.prepareRevoke).
function RevokeConfirmModal({ state, onConfirm, onCancel }) {
  const { t } = useTranslation();
  const { phase, approval, feeLamports, signature, message } = state;
  if (phase === 'idle' || !approval) return null;

  const symbol = approvalSymbol(approval, t);
  const feeSol = lamportsToSol(feeLamports);
  const feeLabel = feeSol === null ? t('approvals.confirm.feeUnknown') : `~${feeSol.toFixed(6)} SOL`;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={t('approvals.confirm.title')}>
      <div className="modal-panel revoke-modal">
        {phase === 'preparing' && (
          <div className="revoke-state">
            <RefreshCw size={26} className="spin" />
            <p>{t('approvals.confirm.preparing')}</p>
          </div>
        )}

        {phase === 'confirm' && (
          <>
            <h3>{t('approvals.confirm.title')}</h3>
            <p className="revoke-intro">{t('approvals.confirm.intro')}</p>
            <dl className="revoke-facts">
              <div>
                <dt>{t('approvals.confirm.token')}</dt>
                <dd>{symbol} <code>{formatWalletAddress(approval.tokenAddress)}</code></dd>
              </div>
              <div>
                <dt>{t('approvals.confirm.delegate')}</dt>
                <dd><code className="revoke-delegate">{approval.spender}</code></dd>
              </div>
              <div>
                <dt>{t('approvals.confirm.approved')}</dt>
                <dd>{formatApprovalAmount(approval.approvedUi, approval.isUnlimited, t)} {symbol}</dd>
              </div>
              <div>
                <dt>{t('approvals.confirm.risk')}</dt>
                <dd><span className={`approval-risk-badge risk-${approval.risk}`}>{t(`approvals.risk.${approval.risk}`)}</span></dd>
              </div>
              <div>
                <dt>{t('approvals.confirm.fee')}</dt>
                <dd>{feeLabel}<small>{t('approvals.confirm.feeNote')}</small></dd>
              </div>
            </dl>
            <p className="revoke-wallet-note"><Lock size={14} /> {t('approvals.confirm.walletNote')}</p>
            <div className="revoke-actions">
              <button className="ghost-button" type="button" onClick={onCancel}>{t('approvals.confirm.cancel')}</button>
              <button className="danger-button" type="button" onClick={onConfirm}>{t('approvals.confirm.confirm')}</button>
            </div>
          </>
        )}

        {phase === 'signing' && (
          <div className="revoke-state">
            <RefreshCw size={26} className="spin" />
            <h3>{t('approvals.confirm.signingTitle')}</h3>
            <p>{t('approvals.confirm.signingText')}</p>
          </div>
        )}

        {phase === 'success' && (
          <div className="revoke-state">
            <CheckCircle2 size={30} className="revoke-icon-success" />
            <h3>{t('approvals.confirm.successTitle')}</h3>
            <p>{t('approvals.confirm.successText', { symbol })}</p>
            {signature && (
              <a className="ghost-button" href={mainnetTxUrl(signature)} target="_blank" rel="noreferrer noopener">
                <ExternalLink size={14} /> {t('approvals.confirm.viewTx')}
              </a>
            )}
            <button className="primary-button" type="button" onClick={onCancel}>{t('approvals.confirm.done')}</button>
          </div>
        )}

        {/* Declining in the wallet is a legitimate answer, not a failure - it is
            deliberately not styled as an error. */}
        {phase === 'rejected' && (
          <div className="revoke-state">
            <Info size={28} />
            <h3>{t('approvals.confirm.rejectedTitle')}</h3>
            <p>{t('approvals.confirm.rejectedText')}</p>
            <div className="revoke-actions">
              <button className="ghost-button" type="button" onClick={onCancel}>{t('approvals.confirm.close')}</button>
              <button className="primary-button" type="button" onClick={onConfirm}>{t('approvals.confirm.tryAgain')}</button>
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div className="revoke-state">
            <AlertTriangle size={28} className="revoke-icon-error" />
            <h3>{t(state.prepared ? 'approvals.confirm.errorTitle' : 'approvals.confirm.prepareFailedTitle')}</h3>
            <p>{t(state.prepared ? 'approvals.confirm.errorText' : 'approvals.confirm.prepareFailedText', { message: message || '' })}</p>
            <button className="ghost-button" type="button" onClick={onCancel}>{t('approvals.confirm.close')}</button>
          </div>
        )}
      </div>
    </div>
  );
}

function ApprovalsPage({ projects }) {
  const { t } = useTranslation();
  const { connected, publicKey, connection, sendTransaction } = useKhanWallet();

  // Mint -> an already-scanned project, so a token the platform genuinely knows
  // shows its name instead of a raw address. Built from data the app already
  // holds; costs no extra network call, and an unknown mint stays unknown.
  const tokenLookup = useMemo(() => {
    const map = {};
    for (const project of projects) {
      if (project.contract) map[project.contract] = project;
    }
    return map;
  }, [projects]);

  const scanner = useApprovalScanner({
    chain: 'solana',
    connection,
    publicKey,
    sendTransaction,
    tokenLookup,
  });

  const revoking = scanner.revoke.phase !== 'idle';

  return (
    <section className="page-section approvals-page">
      <SectionTitle icon={Shield} eyebrow={t('approvals.eyebrow')} title={t('approvals.title')} />
      <p className="approvals-subtitle">{t('approvals.subtitle')}</p>

      <details className="approvals-explainer">
        <summary>{t('approvals.explainerTitle')}</summary>
        <p>{t('approvals.explainerText')}</p>
      </details>

      {!scanner.supported && (
        <KhanAiEmptyState title={t('approvals.unsupportedTitle')} text={t('approvals.unsupportedText')} />
      )}

      {scanner.supported && !connected && (
        <div className="approvals-connect">
          <KhanAiEmptyState title={t('approvals.connectTitle')} text={t('approvals.connectText')} />
          <ConnectWalletButton variant="desktop" />
        </div>
      )}

      {scanner.supported && connected && (
        <>
          {scanner.scanState === 'scanning' && (
            <div className="approvals-loading">
              <RefreshCw size={22} className="spin" /> <span>{t('approvals.scanning')}</span>
            </div>
          )}

          {/* A failed scan is never rendered as a clean wallet. */}
          {scanner.scanState === 'error' && (
            <div className="approvals-error">
              <AlertTriangle size={20} />
              <div>
                <strong>{t('approvals.errorTitle')}</strong>
                <p>{t('approvals.errorText')}</p>
                {scanner.scanError && <code className="approvals-error-detail">{scanner.scanError}</code>}
              </div>
              <button className="secondary-button" type="button" onClick={() => scanner.rescan()}>
                {t('approvals.retry')}
              </button>
            </div>
          )}

          {scanner.scanState === 'ready' && !scanner.approvals.length && (
            <>
              <KhanAiEmptyState title={t('approvals.cleanTitle')} text={t('approvals.cleanText')} />
              <div className="approvals-toolbar">
                <button className="secondary-button" type="button" onClick={() => scanner.rescan()}>
                  <RefreshCw size={15} /> {t('approvals.rescan')}
                </button>
              </div>
            </>
          )}

          {scanner.scanState === 'ready' && scanner.approvals.length > 0 && (
            <>
              <div className="approvals-summary">
                <div className="approvals-summary-item">
                  <span>{t('approvals.summaryTotal')}</span>
                  <strong>{scanner.summary.total}</strong>
                </div>
                <div className="approvals-summary-item risk-high">
                  <span>{t('approvals.summaryHigh')}</span>
                  <strong>{scanner.summary.high}</strong>
                </div>
                <div className="approvals-summary-item risk-medium">
                  <span>{t('approvals.summaryMedium')}</span>
                  <strong>{scanner.summary.medium}</strong>
                </div>
                <div className="approvals-summary-item risk-low">
                  <span>{t('approvals.summaryLow')}</span>
                  <strong>{scanner.summary.low}</strong>
                </div>
                <div className="approvals-summary-item">
                  <span>{t('approvals.summaryLive')}</span>
                  <strong>{scanner.summary.liveExposureCount}</strong>
                </div>
              </div>

              <div className="approvals-toolbar">
                <button className="secondary-button" type="button" onClick={() => scanner.rescan()} disabled={revoking}>
                  <RefreshCw size={15} /> {t('approvals.rescan')}
                </button>
              </div>

              <div className="approvals-grid">
                {scanner.approvals.map((approval) => (
                  <ApprovalCard
                    key={approval.id}
                    approval={approval}
                    onRevoke={scanner.requestRevoke}
                    busy={revoking}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* Outside the `connected` gate on purpose. This is the promise that KHAN
          Trust never asks for a seed phrase and can never move funds - the
          reassurance a cautious user needs BEFORE deciding to connect a wallet
          to a page that talks about revoking permissions, not after. */}
      {scanner.supported && <p className="approvals-disclaimer"><Lock size={13} /> {t('approvals.disclaimer')}</p>}

      <RevokeConfirmModal
        state={scanner.revoke}
        onConfirm={scanner.confirmRevoke}
        onCancel={scanner.cancelRevoke}
      />
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
    if (first && second) growth.compareUsed(first, second);
  }, [first?.id, second?.id]);

  return (
    <section className="page-section compare-page">
      <SectionTitle icon={Scale} eyebrow={t('compare.eyebrow')} title={t('compare.title')} />
      {!projects.length && <KhanAiEmptyState title={t('compare.emptyTitle')} text={t('compare.emptyText')} />}
      {/* Compare is Premium. The whole comparison body is wrapped rather than
          each row, so a free user sees the page, its title, and a crowned
          skeleton of the side-by-side — the shape of the answer without the
          answer. The selectors stay above the lock so the page still reads as
          a real feature rather than an error. */}
      <PremiumLock feature="compareProjects" className="compare-lock">
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
      </PremiumLock>
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

// Retention alerts opt-in (Direction 3). Additive control shown on the token
// report: a logged-in user can ask to be emailed if this token's risk rises
// (see netlify/functions/alerts-*). Login-gated via the existing gate();
// Every network call is best-effort so it can never
// break the report it sits on.
function TokenAlertToggle({ project }) {
  const { t } = useTranslation();
  const { user, gate, toggleTokenAlert, fetchAlertTokens } = useAuth();
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  // Set when the server refuses an ADD because the plan's watch limit is
  // reached. Surfaced rather than swallowed: a toggle that silently does
  // nothing reads as a broken button, not as a reason to upgrade.
  const [limitReached, setLimitReached] = useState(null);
  const identity = historyKeyFor(project);

  useEffect(() => {
    let cancelled = false;
    if (!user || !identity) {
      setSubscribed(false);
      return;
    }
    fetchAlertTokens()
      .then((tokens) => {
        if (!cancelled) setSubscribed(tokens.some((entry) => entry.identity === identity));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [user, identity, fetchAlertTokens]);

  if (!identity) return null;

  const onClick = () => {
    gate(async () => {
      if (busy) return;
      setBusy(true);
      try {
        const result = await toggleTokenAlert({
          identity,
          contract: project.contract || '',
          chain: project.chain || '',
          name: project.name || '',
          ticker: project.ticker || '',
        });
        // The cap is a successful 200 carrying `limitReached`, not an error —
        // the request was understood and correctly refused. Only that specific
        // signal shows the upgrade prompt; a genuine failure below stays silent
        // as before.
        if (result?.limitReached) {
          setLimitReached(result.limit || null);
          setSubscribed(false);
        } else {
          setLimitReached(null);
          setSubscribed(Boolean(result?.subscribed));
        }
      } catch {
        // best-effort - a failed toggle must not disrupt the report
      }
      setBusy(false);
    });
  };

  return (
    <div className="token-alert-toggle">
      <button
        className={subscribed ? 'secondary-button token-alert-on' : 'secondary-button'}
        type="button"
        onClick={onClick}
        disabled={busy}
        title={t('alerts.hint')}
      >
        <Bell size={18} /> {subscribed ? t('alerts.enabled') : t('alerts.enable')}
      </button>
      {limitReached && (
        <p className="token-alert-limit">{t('alerts.limitReached', { limit: limitReached })}</p>
      )}
    </div>
  );
}

function RiskReportPage({ project, navigate }) {
  const { t } = useTranslation();
  const { gate } = useAuth();
  const reasons = riskSignals(project).slice(0, 3);
  const factors = riskFactors(project);
  const confidence = confidenceScore(project);
  // Additive: mirror this scanned token into the shared Trust Graph Corpus.
  // Purely best-effort - never affects the report render (see tokenCorpus.js).
  useCorpusRecord(project);
  // Phase 5: record today's snapshot and load history so the free report can
  // also show the Risk History timeline. Best-effort (see scoreHistory.js).
  const history = useScoreHistory(project);
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
          <button className="secondary-button" type="button" onClick={() => gate(() => handleDownloadPdf(project))}>
            <Download size={18} /> {t('riskReport.downloadPdf')}
          </button>
          <small>{t('riskReport.downloadHint')}</small>
        </div>
        <TokenAlertToggle project={project} />
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

          <RiskHistoryTimeline history={history} />

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

// Ranks an entitlement by Premium tier so two independent sources (paid wallet
// entitlement + admin-granted manual entitlement) can be merged by strength:
// Early Supporter (3) > Premium (2) > any other non-null plan (1) > none (0).
function entitlementRank(e) {
  if (!e) return 0;
  if (e.plan === 'early_supporter') return 3;
  if (hasPlanAccess(e, 'premium')) return 2;
  return 1;
}

// In-memory merge only. The winning object is returned as-is; no record is ever
// written from another, keeping payment and manual Premium completely
// independent (see task spec, section 9).
//
// Variadic across every source a plan can come from — account-paid (primary),
// wallet-paid (legacy), and admin-granted. Highest tier wins, so a legacy user
// keeps Premium whether or not their wallet is connected, and nobody can lose
// access by the platform simply looking in a different place.
function mergeEntitlements(...sources) {
  const candidates = sources.filter(Boolean);
  if (!candidates.length) return null;
  return candidates.reduce((best, next) => (entitlementRank(next) > entitlementRank(best) ? next : best));
}

// Polls every source a Premium plan can come from and merges them by tier:
//
//   1. the signed-in ACCOUNT's paid entitlement  (entitlement-status + JWT)
//      — primary; every purchase since checkout stopped demanding a wallet
//   2. the connected WALLET's paid entitlement   (entitlement-status?wallet=)
//      — legacy; purchases from before this site had accounts
//   3. the account's admin-granted manual grant  (premium-me)
//
// So Premium UI reflects a real verified payment or a manual grant instead of
// the locked state, and — the point of all this — NONE of those paths requires
// a wallet except the one that is only there for backwards compatibility.
//
// Renamed from useWalletEntitlement: the wallet is no longer the organising
// idea, and a hook called "useWallet*" that returns Premium for accounts with
// no wallet would mislead every future reader of this file.
function usePremiumEntitlement() {
  const { address, connected } = useKhanWallet();
  const { user } = useAuth();
  const [walletEnt, setWalletEnt] = useState(null);
  const [accountEnt, setAccountEnt] = useState(null);
  const [manualEnt, setManualEnt] = useState(null);

  const refresh = React.useCallback(async () => {
    const [w, a, m] = await Promise.all([
      connected && address ? fetchEntitlement(address) : Promise.resolve(null),
      user ? fetchAccountEntitlement() : Promise.resolve(null),
      user ? fetchMyManualPremium() : Promise.resolve(null),
    ]);
    setWalletEnt(w);
    setAccountEnt(a);
    setManualEnt(m);
  }, [connected, address, user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Best-effort: once a signed-in account has a wallet connected, tell the
  // server so the admin panel can show "Wallet Connected". Fully isolated
  // telemetry (see src/walletLink.js) - never gates or changes entitlements.
  useEffect(() => {
    if (user?.id && connected && address) recordWalletLink(address);
  }, [user?.id, connected, address]);

  const entitlement = mergeEntitlements(accountEnt, walletEnt, manualEnt);

  return {
    entitlement,
    // Still surfaced for wallet-SPECIFIC features and for the legacy claim
    // prompt. Nothing gates Premium on it any more.
    wallet: connected ? address : '',
    // True when this caller has a paid plan attached to a wallet but NOT to
    // their account: the one case where connecting a wallet still buys them
    // something, because it is how they claim the purchase onto their account
    // and stop needing the wallet forever. Drives the claim prompt.
    canClaimWalletPurchase: Boolean(user && walletEnt && !accountEnt),
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

// Plain $9/month Premium's own badge - distinct from EarlySupporterBadge so
// the two plans never look identical. Only ever rendered for hasPremium &&
// !isEarlySupporter; an Early Supporter always sees EarlySupporterBadge
// instead, never both, even though Early Supporter also includes every
// Premium feature - the two badges are mutually exclusive by design.
function PremiumBadge({ compact = false }) {
  const { t } = useTranslation();
  return (
    <span className="premium-badge" title={t('premium.badgeTooltip')}>
      <BadgeCheck size={compact ? 12 : 14} /> {t('premium.badgeLabel')}
    </span>
  );
}

// Emoji plan badge (👑 Premium / ⭐ Early Supporter / 🤝 Partner) driven by the
// merged entitlement, shown consistently in the header dropdown, profile, and
// Premium sections. Renders nothing when there is no active Premium.
function AccountBadge({ entitlement, compact = false }) {
  const { t } = useTranslation();
  const info = premiumBadgeInfo(entitlement);
  if (!info) return null;
  return (
    <span className={`account-badge ${info.className}${compact ? ' compact' : ''}`}>
      <span aria-hidden="true">{info.emoji}</span> {t(info.labelKey)}
    </span>
  );
}

// Shared locked-state prompt for the Premium-only AI cards.
function PremiumUpgradeCTA({ navigate, text }) {
  const { t } = useTranslation();
  return (
    <div className="premium-upgrade-cta">
      <Lock size={20} />
      <p className="inline-note">{text || t('premiumResearchCommon.upgradeText')}</p>
      <button className="primary-button" type="button" onClick={() => navigate('pricing')}>
        {t('premium.unlockPremium')} <ArrowRight size={16} />
      </button>
    </div>
  );
}

function ResearchList({ items, tone = 'neutral' }) {
  if (!items?.length) return null;
  const Icon = tone === 'good' ? CheckCircle2 : tone === 'bad' ? AlertTriangle : Info;
  return (
    <ul className="scam-risk-reasons">
      {items.map((item) => (
        <li key={item}><Icon size={14} /> {item}</li>
      ))}
    </ul>
  );
}

// ── Premium feature 1: Advanced AI Research ───────────────────────────────────
// Premium-only deep dive built deterministically from the same data the free
// analysis uses (see premiumResearch.js). Free users see an upgrade CTA.
function AdvancedResearchCard({ project, navigate }) {
  const { t, language } = useTranslation();
  const { hasPremium, entitlement } = usePremiumEntitlement();
  // Hooks run before the early return below, unconditionally, as they must.
  // The overlay is gated on Premium so a free user never triggers a paid call.
  const { fields: aiFields } = useGroundedAnalysis({
    project,
    identity: historyKeyFor(project),
    language,
    enabled: hasPremium && Boolean(project.assetCategory),
  });
  if (!project.assetCategory) return null; // nothing to analyze yet
  return (
    <section className="detail-section premium-ai-card">
      <SectionTitle icon={Sparkles} eyebrow={t('advancedResearch.eyebrow')} title={t('advancedResearch.title')} />
      {!hasPremium ? (
        <PremiumUpgradeCTA navigate={navigate} text={t('advancedResearch.lockedText')} />
      ) : (
        (() => {
          // The deterministic build FIRST — it renders immediately and is
          // complete on its own. The AI overlay replaces only the prose fields
          // it actually produced; every number below still comes from the
          // engine. See mergeAnalysis() for the allowlist that enforces this.
          const r = mergeAnalysis(buildAdvancedResearch(project), aiFields);
          return (
            <>
              <div className="premium-ai-badgeline"><AccountBadge entitlement={entitlement} compact /></div>
              {r.strengths.length > 0 && <><h4>{t('advancedResearch.strengths')}</h4><ResearchList items={r.strengths} tone="good" /></>}
              {r.weaknesses.length > 0 && <><h4>{t('advancedResearch.weaknesses')}</h4><ResearchList items={r.weaknesses} tone="bad" /></>}
              <h4>{t('advancedResearch.risks')}</h4>
              <ResearchList items={r.risks} tone="bad" />
              <div className="premium-ai-observations">
                <div><span>{t('advancedResearch.community')}</span><p>{r.communitySignals}</p></div>
                <div><span>{t('advancedResearch.liquidity')}</span><p>{r.liquidity}</p></div>
                <div><span>{t('advancedResearch.holders')}</span><p>{r.holders}</p></div>
                <div><span>{t('advancedResearch.outlookLabel')}</span><p>{r.outlook}</p></div>
              </div>
              <div className="premium-ai-conclusion">
                <strong>{t('advancedResearch.conclusionLabel')}</strong>
                <p>{r.conclusion}</p>
              </div>
            </>
          );
        })()
      )}
    </section>
  );
}

// ── Premium feature 2: Premium AI Analysis ────────────────────────────────────
// An ADDITIONAL section alongside (never replacing) the free AI Risk Summary.
function PremiumAnalysisCard({ project, navigate }) {
  const { t, language } = useTranslation();
  const { hasPremium, entitlement } = usePremiumEntitlement();
  // Same overlay, same cache. Two cards asking for one token in one language
  // hit the same cached entry, so this is one generation, not two.
  const { fields: aiFields } = useGroundedAnalysis({
    project,
    identity: historyKeyFor(project),
    language,
    enabled: hasPremium && Boolean(project.assetCategory),
  });
  if (!project.assetCategory) return null;
  return (
    <section className="detail-section premium-ai-card">
      <SectionTitle icon={Brain} eyebrow={t('premiumAnalysis.eyebrow')} title={t('premiumAnalysis.title')} />
      {!hasPremium ? (
        <PremiumUpgradeCTA navigate={navigate} text={t('premiumAnalysis.lockedText')} />
      ) : (
        (() => {
          // Deterministic first, AI prose overlaid. riskConfidenceScore,
          // aiConfidence, dataQuality, bullish, bearish and missingInfo are NOT
          // overlayable — they are engine output and stay engine output.
          const a = mergeAnalysis(buildPremiumAnalysis(project), aiFields);
          return (
            <>
              <div className="premium-ai-badgeline"><AccountBadge entitlement={entitlement} compact /></div>
              <p className="inline-note">{a.explanation}</p>
              <div className="premium-ai-metrics">
                <div className="premium-ai-metric">
                  <span>{t('premiumAnalysis.riskConfidence')}</span>
                  <strong>{a.riskConfidenceScore}%</strong>
                </div>
                <div className="premium-ai-metric">
                  <span>{t('premiumAnalysis.aiConfidence')}</span>
                  <strong>{a.aiConfidence.level} ({a.aiConfidence.pct}%)</strong>
                </div>
                <div className="premium-ai-metric">
                  <span>{t('premiumAnalysis.dataQualityLabel')}</span>
                  <strong>{a.dataQuality.label}</strong>
                </div>
              </div>
              {a.bullish.length > 0 && <><h4>{t('premiumAnalysis.bullish')}</h4><ResearchList items={a.bullish} tone="good" /></>}
              {a.bearish.length > 0 && <><h4>{t('premiumAnalysis.bearish')}</h4><ResearchList items={a.bearish} tone="bad" /></>}
              {a.missingInfo.length > 0 && (
                <>
                  <h4>{t('premiumAnalysis.missingInfo')}</h4>
                  <ResearchList items={friendlyMissingFields(a.missingInfo)} tone="neutral" />
                </>
              )}
              <h4>{t('premiumAnalysis.recommendations')}</h4>
              <ResearchList items={a.recommendations} tone="neutral" />
            </>
          );
        })()
      )}
    </section>
  );
}

// ── Premium feature 3: AI Investment Thesis ───────────────────────────────────
// The SYNTHESIS card. It sits after Advanced Research and Premium Analysis and
// deliberately does NOT re-list their signals: it aggregates the engine's
// category scores into investment dimensions and produces the one verdict, the
// forward-looking catalysts and the institutional narrative that appear nowhere
// else (see src/investmentThesis.js for the non-duplication contract). Fully
// deterministic and grounded — every figure traces to engine output.
function InvestmentThesisCard({ project, navigate }) {
  const { t, language } = useTranslation();
  const { hasPremium, entitlement } = usePremiumEntitlement();
  if (!project.assetCategory) return null; // nothing to synthesize yet
  const generatedAt = project.dataFetchedAt || Date.now();
  let stamp;
  try {
    stamp = new Date(generatedAt).toLocaleString(language);
  } catch {
    stamp = new Date(generatedAt).toLocaleString();
  }
  return (
    <section className="detail-section premium-ai-card">
      <SectionTitle icon={TrendingUp} eyebrow={t('investmentThesis.eyebrow')} title={t('investmentThesis.title')} />
      {!hasPremium ? (
        <PremiumUpgradeCTA navigate={navigate} text={t('investmentThesis.lockedText')} />
      ) : (
        (() => {
          const thesis = buildInvestmentThesis(project);
          return (
            <>
              <div className="premium-ai-badgeline">
                <AccountBadge entitlement={entitlement} compact />
                <ConvictionBadge conviction={thesis.conviction} />
              </div>

              <h4>{t('investmentThesis.whyConsiderTitle')}</h4>
              {thesis.reasonsEmpty
                ? <p className="inline-note">{t('investmentThesis.reasonsEmpty')}</p>
                : <ResearchList items={thesis.reasons} tone="good" />}

              <h4>{t('investmentThesis.catalystsTitle')}</h4>
              {thesis.catalystsEmpty
                ? <p className="inline-note">{t('investmentThesis.catalysts.emptyNote')}</p>
                : <ResearchList items={thesis.catalysts} tone="neutral" />}

              <h4>{t('investmentThesis.risksTitle')}</h4>
              <ResearchList items={thesis.risks} tone="bad" />

              <div className="premium-ai-conclusion">
                <strong>{t('investmentThesis.overallTitle')}</strong>
                <p>{thesis.narrative}</p>
              </div>

              <div className="thesis-conviction-block">
                <span className="thesis-conviction-label">{t('investmentThesis.convictionTitle')}</span>
                <ConvictionBadge conviction={thesis.conviction} />
                <p className="inline-note">{thesis.conviction.note}</p>
                <p className="inline-note">{t('investmentThesis.convictionSubtitle')}</p>
              </div>

              <p className="thesis-footnote">
                <Sparkles size={13} /> {t('investmentThesis.generatedNote')} · {t('investmentThesis.timestamp', { time: stamp })}
              </p>

              {/* Prominent, feature-specific compliance disclaimer. The narrative's
                  closing line disclaims too, but this dedicated block is the
                  authoritative one: automated/AI, as-is, not advice, not a
                  solicitation, no future-performance guarantee. Reuses the shared
                  Disclaimer component so styling and the warning icon are
                  consistent with the rest of the platform. */}
              <Disclaimer text={t('investmentThesis.disclaimer')} />
            </>
          );
        })()
      )}
    </section>
  );
}

// The single synthesized verdict, rendered as a toned pill. low → cautionary,
// moderate → neutral, high → positive; the same three-tone language the rest of
// the report uses.
function ConvictionBadge({ conviction }) {
  const tone = conviction.key === 'high' ? 'good' : conviction.key === 'low' ? 'bad' : 'neutral';
  const Icon = tone === 'good' ? TrendingUp : tone === 'bad' ? AlertTriangle : Scale;
  return (
    <span className={`thesis-conviction thesis-conviction-${tone}`}>
      <Icon size={14} /> {conviction.label}
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

  // This panel only renders for Premium users, so always load - fetchUserData
  // identifies the account by the auth token when there is no wallet, so
  // admin-granted Premium users see their saved reports too.
  useEffect(() => {
    load();
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
  const { hasPremium, isEarlySupporter: isEarly, wallet } = usePremiumEntitlement();
  const unlockPremium = async () => {
    const result = await startPremiumUpgrade({ navigate, project, wallet });
    if (!result?.ok) setPaymentMessage(result?.message || stripeUnavailableMessage());
  };

  if (hasPremium) {
    return (
      <section className="detail-section premium-lock-section">
        <SectionTitle icon={CheckCircle2} eyebrow={t(isEarly ? 'earlySupporter.eyebrow' : 'premium.eyebrow')} title={t(isEarly ? 'earlySupporter.activeTitle' : 'premium.activeTitle')} />
        {isEarly ? <EarlySupporterBadge /> : <PremiumBadge />}
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
  const { hasPremium, isEarlySupporter: isEarly, wallet } = usePremiumEntitlement();
  const unlockPremium = async () => {
    const result = await startPremiumUpgrade({ navigate, project, wallet });
    if (!result?.ok) setPaymentMessage(result?.message || stripeUnavailableMessage());
  };

  if (hasPremium) {
    return (
      <section className="detail-section one-time-card">
        <SectionTitle icon={CheckCircle2} eyebrow={t(isEarly ? 'earlySupporter.eyebrow' : 'premium.eyebrow')} title={t(isEarly ? 'earlySupporter.activeTitle' : 'premium.activeTitle')} />
        {isEarly ? <EarlySupporterBadge /> : <PremiumBadge />}
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
  const { entitlement, hasPremium, isEarlySupporter: isEarly, wallet, refresh } = usePremiumEntitlement();
  const beginCheckout = async (plan, walletOverride) => {
    // With card payments off, the plan cards can't start a Stripe session — the
    // working methods (Wallet / Manual Crypto) are already on this same page, so
    // the CTA just brings them into view instead of erroring.
    if (!isCardPaymentEnabled()) {
      document.getElementById('payment-methods')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
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
        {t('pricing.launchpadNote')}
      </p>
      {hasPremium && (
        <p className="pricing-note payment-message verify-success">
          {isEarly ? <EarlySupporterBadge compact /> : <PremiumBadge compact />}{' '}
          {t(isEarly ? 'earlySupporter.activeNote' : 'premium.activeNote')}
        </p>
      )}
      {paymentMessage && <p className="pricing-note payment-message">{paymentMessage}</p>}

      {/* THE HERO: one plan, one price, one button.
          Lifetime is given the whole top of the page rather than being the
          third card in a row of three. A three-card grid asks the visitor to
          run a comparison before they have decided they want anything at all,
          and the option we most want taken was the one furthest from the eye.
          The monthly plan and the free tier are still fully available — they
          are just BELOW this, as the answer to "what else is there?" rather
          than as competing opening offers. Nothing was removed. */}
      <div className="pricing-hero-card">
        <span className="pricing-hero-badge"><Crown size={13} /> {t('pricing.heroBadge')}</span>
        <div className="pricing-hero-price">
          <strong>${PLAN_USD_AMOUNT.early_supporter}</strong>
          <span>{t('premiumModal.lifetimeSuffix')}</span>
        </div>
        <p className="pricing-hero-sub">{t('pricing.heroSave')}</p>
        <ul className="pricing-hero-list">
          {t('pricing.plans.earlySupporter').features.map((feature) => (
            <li key={feature}><CheckCircle2 size={16} /> {feature}</li>
          ))}
        </ul>
        <button
          className="premium-modal-cta"
          type="button"
          onClick={() => beginCheckout('early_supporter')}
        >
          <Sparkles size={16} /> {t('pricing.plans.earlySupporter').cta} <ArrowRight size={16} />
        </button>
      </div>

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

      {/* Generated from src/lib/features.js — the same registry the crowns and
          the server gate read. A hand-written pricing table drifts from what
          the product actually enforces, and it always drifts into either
          promising something that is locked or advertising as Premium
          something that is free. This one cannot. */}
      <section className="detail-section">
        <SectionTitle icon={BarChart3} eyebrow={t('pricing.eyebrow')} title={t('pricing.comparison.title')} />
        <FeatureComparisonTable />
      </section>

      {/* The legacy hand-written plan grid, kept as-is: it is the only place
          the KHAN Founding Member-exclusive rows (badge, lifetime recognition)
          are spelled out, and those are not feature-registry entries. */}
      <PlanComparisonTable />

      <PaymentMethodsSection beginCheckout={beginCheckout} onEntitlementChange={refresh} />

      <section className="pricing-faq">
        <SectionTitle icon={Info} eyebrow={t('pricing.eyebrow')} title={t('pricing.faqTitle')} />
        {t('pricing.faq').map(([question, answer]) => (
          <details className="pricing-faq-item" key={question}>
            <summary>{question}</summary>
            <p>{answer}</p>
          </details>
        ))}
      </section>

      <p className="pricing-note">{t('pricing.footerNote')}</p>
      <Disclaimer />
    </section>
  );
}

function PaymentMethodsSection({ beginCheckout, onEntitlementChange }) {
  // Card is rendered ONLY when Stripe is enabled. Until then users see just the
  // two working rails — Wallet Connect and Manual Crypto — with no disabled
  // buttons and no "not configured" notice. The `id` is the scroll anchor the
  // plan-card CTAs jump to when card checkout is off.
  return (
    <section className="payment-methods" id="payment-methods">
      <WalletPaymentSection onEntitlementChange={onEntitlementChange} />
      {isCardPaymentEnabled() && <CardPaymentSection beginCheckout={beginCheckout} />}
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

  const planPrice = String(planUsdAmount(plan));

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

// Card checkout. Rendered ONLY when card payments are enabled (see
// PaymentMethodsSection / isCardPaymentEnabled), so there is no "not configured"
// state to handle here — if this component is on screen, Stripe is live.
//
// A wallet is NOT required. The buyer's identity is their account, so the only
// prerequisite is being signed in; the user is told when they need to, and the
// connected address is still passed to beginCheckout as optional metadata.
function CardPaymentSection({ beginCheckout }) {
  const { t } = useTranslation();
  const { address } = useKhanWallet();
  const { user } = useAuth();
  return (
    <div className="payment-method-card">
      <span className="status-badge">{t('pricing.payment.cardBadge')}</span>
      <h3>{t('pricing.payment.cardTitle')}</h3>
      <p>{t('pricing.payment.cardDescription')}</p>
      {!user && <p className="inline-note">{t('pricing.payment.signInFirst')}</p>}
      <div className="payment-action-row">
        <button className="primary-button" type="button" onClick={() => beginCheckout('premium', address)}>
          {t('premium.unlockPremium')}
        </button>
        <button className="secondary-button" type="button" onClick={() => beginCheckout('early_supporter', address)}>
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

// Verification-as-Network (Direction 4): on a VERIFIED project's profile, the
// owner gets a copyable "Verified by KHAN Trust" badge to embed on their own
// site/socials. Every embed is a backlink and a trust signal for KHAN, turning
// verification into a two-sided network. Rendered only for verified projects,
// so it never appears where it shouldn't; purely additive to the profile.
function VerifiedBadgeEmbed({ project }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  if (project.verificationStatus !== VERIFICATION_STATUS.VERIFIED) return null;

  const base = OFFICIAL_KHAN_LINKS.website; // https://khantrust.net
  const hasContract = project.contract && !['Not provided', 'Not available'].includes(project.contract);
  const linkUrl = hasContract ? `${base}/token/${encodeURIComponent(project.contract)}` : base;
  const badgeUrl = `${base}/badge/${encodeURIComponent(project.id)}`;
  const snippet = `<a href="${linkUrl}" target="_blank" rel="noopener"><img src="${badgeUrl}" alt="Verified by KHAN Trust" height="20" /></a>`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="detail-section verified-embed-section">
      <SectionTitle icon={BadgeCheck} eyebrow={t('verifiedEmbed.eyebrow')} title={t('verifiedEmbed.title')} />
      <p className="inline-note">{t('verifiedEmbed.description')}</p>
      {/* Relative src so the on-page preview uses the current origin; the
          copyable snippet below uses the absolute production URL for embedding
          on other sites. */}
      <div className="verified-embed-preview">
        <img src={`/badge/${encodeURIComponent(project.id)}`} alt="Verified by KHAN Trust" height="20" />
      </div>
      <textarea
        className="verified-embed-code"
        readOnly
        value={snippet}
        rows={3}
        onFocus={(event) => event.target.select()}
      />
      <button className="secondary-button" type="button" onClick={copy}>
        <Copy size={16} /> {copied ? t('common.copied') : t('verifiedEmbed.copy')}
      </button>
    </section>
  );
}

function ProjectProfile({ project, projects = [], revealScan = false, navigate, watched, toggleWatch, onEdit, openMethodology, onRequestVerification }) {
  const { gate } = useAuth();
  const { t } = useTranslation();
  const confidence = confidenceScore(project);
  const canRequestVerification =
    project.verificationStatus === VERIFICATION_STATUS.UNVERIFIED || project.verificationStatus === VERIFICATION_STATUS.REJECTED;
  const { address: profileWallet } = useKhanWallet();
  const canEdit = canEditProject(project, profileWallet);
  const unlockPremium = async () => {
    const result = await startPremiumUpgrade({ navigate, project, wallet: profileWallet });
    if (!result?.ok) alert(result?.message || stripeUnavailableMessage());
  };
  const [reportModalOpen, setReportModalOpen] = useState(false);
  // Shared by the Phase 1 trend strip and the Phase 2 Ask KHAN analyst below,
  // so both read the same fetched history instead of each fetching its own.
  const history = useScoreHistory(project);
  // Additive: mirror this token into the shared Trust Graph Corpus (best-effort,
  // never affects render - see tokenCorpus.js). The once/day/token throttle
  // means sharing this funnel with RiskReportPage causes no duplicate writes.
  useCorpusRecord(project);
  // Phase 4 — null until at least a handful of same-category peers are
  // tracked; both RiskSummary and Ask KHAN treat null as "not enough data".
  const peerBenchmark = computePeerBenchmark(project, projects);

  return (
    // `is-revealing` drives the whole post-scan choreography (score -> risk ->
    // project info -> charts -> buttons) as staggered CSS delays on the blocks
    // below. Only set for a card reached by a completed scan.
    <section className={`profile-page${revealScan ? ' is-revealing' : ''}`}>
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
            {/* Watchlist and PDF export are Premium, but they stay VISIBLE and
                clickable for free users — the click opens the upgrade modal
                naming the feature instead of silently doing nothing. See the
                note on PremiumActionButton for why these are not `disabled`. */}
            <PremiumActionButton
              feature="watchlist"
              className={watched ? 'primary-button watched' : 'primary-button'}
              onClick={toggleWatch}
            >
              <Bell size={18} /> {watched ? t('projectProfile.watchingProject') : t('projectProfile.watchProject')}
            </PremiumActionButton>
            <TokenAlertToggle project={project} />
            {canEdit && (
              <button className="secondary-button" onClick={onEdit}>
                <Plus size={18} /> {t('projectProfile.editProject')}
              </button>
            )}
            {canRequestVerification && (
              <button className="primary-button" onClick={onRequestVerification}>
                <BadgeCheck size={18} /> {t('projectProfile.requestVerification')}
              </button>
            )}
            <PremiumActionButton
              feature="pdfReports"
              className="secondary-button"
              onClick={() => gate(() => handleDownloadPdf(project))}
            >
              <Download size={18} /> {t('projectProfile.downloadPdf')}
            </PremiumActionButton>
            <button className="primary-button" onClick={unlockPremium}>
              <Lock size={18} /> {t('projectProfile.unlockPremium')}
            </button>
            <button className="secondary-button" onClick={() => gate(() => setReportModalOpen(true))}>
              <Flag size={18} /> {t('projectProfile.reportSuggest')}
            </button>
            <button className="ghost-button" onClick={openMethodology}>
              <Info size={18} /> {t('projectProfile.methodology')}
            </button>
          </div>
        </div>
        {/* Result reveal. Only a card reached by a completed scan choreographs
            (glow -> shield pulse -> data settles -> score -> risk indicators ->
            calm); arriving from a link or a refresh shows the card plainly,
            because there was no analysis to reveal. */}
        <div className={`profile-score-card${revealScan ? ' is-revealing' : ''}`}>
          <ScoreCircle score={project.trustScore} size="large" />
          <ScoreHistoryStrip project={project} history={history} />
          <RiskPill level={project.riskLevel} />
          <span className="confidence-badge">{confidence.label}</span>
          <strong>{riskBadge(project.trustScore)}</strong>
          <span className="status-badge">{project.status}</span>
          <KhanAiVerdictMark revealed={revealScan} />
        </div>
      </div>

      <div className="dashboard-top-row">
        <CommunityProof project={project} />
      </div>
      <CategoryScoreCards project={project} />
      <ContractSecurityRow project={project} />

      <div className="profile-layout">
        <div className="main-column">
          <VerifiedBadgeEmbed project={project} />
          <RiskSummary project={project} peerBenchmark={peerBenchmark} />
          <RiskHistoryTimeline history={history} />
          <InfoGrid project={project} />
          <LiveMarketChart project={project} data={project.realData} />
          <TrustBreakdown project={project} />
          {project.realData && <RealDataSection project={project} data={project.realData} />}
          <ScamRiskCard project={project} />
          <DeepRiskAnalysisCard project={project} />
          <AdvancedResearchCard project={project} navigate={navigate} />
          <PremiumAnalysisCard project={project} navigate={navigate} />
          <InvestmentThesisCard project={project} navigate={navigate} />
          <RiskFlags flags={project.riskFlags} />
          <Timeline items={project.timeline} />
          <Roadmap phases={project.roadmap} />
          <ShareReady project={project} />
          <KhanTokenRole navigate={navigate} />
          <FutureFoundationSection />
        </div>
        <aside className="side-column">
          <KhanAiVerificationPanel project={project} revealed={revealScan} />
          <AskKhanCard project={project} history={history} peerBenchmark={peerBenchmark} />
          <PeerBenchmarkCard project={project} peerBenchmark={peerBenchmark} />
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

  // Portal to <body> so the fixed-position backdrop is not trapped by an
  // ancestor's containing block. ProjectProfile renders this modal inside a
  // `.page-section`, which keeps a non-`none` transform from its khanFadeUp
  // entrance animation (animation-fill-mode: both) - that makes the section the
  // containing block for `position: fixed`, so without the portal the backdrop
  // covers the (tall) section while the centered panel lands far below the
  // viewport. Rendering at document.body restores viewport-relative centering.
  return createPortal(
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
    </div>,
    document.body,
  );
}

function RiskSummary({ project, peerBenchmark }) {
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

// Phase 4 — Analyst Perspective, as its own dashboard card (moved out of
// RiskSummary so it can sit in the report's side rail next to Ask KHAN,
// matching the reference dashboard layout). Same computePeerBenchmark data,
// just a dedicated visual home for it.
function PeerBenchmarkCard({ project, peerBenchmark }) {
  const { t } = useTranslation();
  if (!peerBenchmark) return null;
  return (
    <section className="detail-section peer-benchmark-card">
      <SectionTitle icon={BarChart3} eyebrow={t('riskSummary.eyebrow')} title="Peer Benchmark" />
      <div className="peer-benchmark">
        <div className="peer-benchmark-track">
          <div className="peer-benchmark-fill" style={{ width: `${peerBenchmark.percentile}%` }} />
          <div className="peer-benchmark-median-marker" />
        </div>
        <p className="peer-benchmark-label">
          {t('riskSummary.peerBenchmark', {
            comparison: t(`riskSummary.peerComparison.${peerBenchmark.comparison}`),
            category: peerLabelFor(peerBenchmark.category),
            peerCount: peerBenchmark.peerCount,
          })}
        </p>
      </div>
    </section>
  );
}

// Phase 2 — Score Voice: a small fixed set of preset questions, each
// answered deterministically from data already computed on this project
// (see khanAnalyst.js). Intentionally not a free-text chatbot - there's
// nothing to type, just a handful of buttons, so it can never say anything
// ungrounded.
function AskKhanCard({ project, history, peerBenchmark }) {
  const { t } = useTranslation();
  const { gate } = useAuth();
  const [activeQuestion, setActiveQuestion] = useState(null);

  return (
    <section className="detail-section ask-khan-card">
      <SectionTitle icon={Sparkles} eyebrow={t('askKhan.eyebrow')} title={t('askKhan.title')} />
      <div className="filter-row">
        {ANALYST_QUESTIONS.map((question) => (
          <button
            key={question.id}
            type="button"
            className={activeQuestion === question.id ? 'active' : ''}
            onClick={() => gate(() => setActiveQuestion(question.id))}
          >
            {t(question.labelKey)}
          </button>
        ))}
      </div>
      {activeQuestion ? (
        <p className="plain-explanation">{answerQuestion(activeQuestion, project, history, peerBenchmark)}</p>
      ) : (
        <p className="inline-note">{t('askKhan.prompt')}</p>
      )}
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
  const baseProvider = hasPair ? 'dexscreener' : (hasCoingeckoFallback ? 'coingecko' : 'none');

  const sectionRef = useRef(null);
  const timeoutRef = useRef(null);
  const [inView, setInView] = useState(false);
  const [chartStatus, setChartStatus] = useState('loading'); // loading | loaded | timeout
  const [retryKey, setRetryKey] = useState(0);
  const [widgetReady, setWidgetReady] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  // slowLoad is driven by an INDEPENDENT watchdog that the Dexscreener iframe's
  // onLoad cannot cancel. That matters because the iframe's onLoad fires when
  // Dexscreener's app shell loads, even when the embedded chart then hangs
  // forever on its own internal "Loading pair..." - so onLoad is not proof the
  // chart rendered. When slowLoad trips, an always-reachable recovery row is
  // shown so a user can never be permanently stranded on "Loading pair...".
  const [slowLoad, setSlowLoad] = useState(false);
  // Lets a user switch to the CoinGecko live fallback in-app if the Dexscreener
  // embed won't render - still real market data (#13), never mock.
  const [forceFallback, setForceFallback] = useState(false);
  const provider = forceFallback && hasCoingeckoFallback ? 'coingecko' : baseProvider;

  // A new token is being charted (different pair/coin): clear any prior stuck
  // state so a working chart is never suppressed by the previous token's
  // fallback/slow-load flags.
  useEffect(() => {
    setForceFallback(false);
    setSlowLoad(false);
    setChartStatus('loading');
    setRetryKey(0);
  }, [data?.pairAddress, data?.coingeckoId]);

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
    setSlowLoad(false);
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      // Fires whether or not the iframe reported onLoad (which it does even for a
      // stuck embed): reveals the recovery row, and flips to the fallback state
      // only if no load signal ever arrived.
      setSlowLoad(true);
      setChartStatus((status) => (status === 'loaded' ? status : 'timeout'));
    }, CHART_LOAD_TIMEOUT_MS);
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

      {/* Always-reachable escape hatch: shown once the watchdog trips, even
          though the Dexscreener iframe reported onLoad. If its embed is stuck on
          "Loading pair..." this is the ONLY way out, so a user is never
          permanently stranded - they can reload, switch to the live CoinGecko
          fallback in-app, or open the pair on Dexscreener directly. */}
      {provider === 'dexscreener' && showChart && slowLoad && (
        <div className="market-chart-recovery">
          <span className="inline-note">{m.stuckHint}</span>
          <button type="button" className="ghost-button" onClick={retryChart}>
            <RefreshCw size={14} /> {m.retry}
          </button>
          {hasCoingeckoFallback && (
            <button type="button" className="ghost-button" onClick={() => setForceFallback(true)}>
              <LineChart size={14} /> {m.useFallback}
            </button>
          )}
          {data?.pairUrl && (
            <a className="ghost-button" href={data.pairUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={14} /> {m.openDexscreener}
            </a>
          )}
        </div>
      )}

      {fullscreen && typeof document !== 'undefined' && createPortal(
        // Rendered via portal directly into document.body, not in place
        // here: .profile-page (an ancestor of this component) has a CSS
        // animation with fill-mode "both", which leaves transform:
        // translateY(0) permanently applied even after the animation ends.
        // Per spec, any ancestor with a transform becomes the containing
        // block for position:fixed descendants - so without the portal,
        // this modal would render relative to that tall page element
        // instead of the viewport (the "dark overlay, no visible chart"
        // bug: the real content was rendering far down the page, off-screen).
        <div
          className="modal-backdrop market-fullscreen-modal"
          role="dialog"
          aria-modal="true"
          aria-label={m.title}
          onClick={(event) => {
            // Only the backdrop itself, not the panel/chart inside it -
            // clicking the chart or any control must never close the modal.
            if (event.target === event.currentTarget) setFullscreen(false);
          }}
        >
          <div className="modal-panel market-fullscreen-panel">
            <div className="market-chart-frame market-chart-frame-large">
              <ChartEmbed provider={provider} data={data} retryKey={retryKey} widgetReady={widgetReady} title={m.title} onLoad={() => {}} />
            </div>
          </div>
          {/* position:fixed on the backdrop (not the scrollable panel), so
              this never scrolls out of view and always renders above the
              chart iframe - a 44x44 minimum touch target per mobile a11y
              guidance, always visible regardless of chart content. */}
          <button
            type="button"
            className="market-fullscreen-close"
            onClick={() => setFullscreen(false)}
            aria-label={t('common.close')}
          >
            <X size={20} />
          </button>
        </div>,
        document.body
      )}

      {showFallback && (
        <div className="market-chart-fallback">
          <LineChart size={28} />
          <p>{chartStatus === 'timeout' ? m.timeout : m.fallback}</p>
          <div className="market-chart-recovery">
            {provider !== 'none' && (
              <button type="button" className="secondary-button" onClick={retryChart}>
                <RefreshCw size={15} /> {m.retry}
              </button>
            )}
            {/* If Dexscreener timed out entirely, offer the real CoinGecko live
                chart in-app rather than leaving only "metrics above". */}
            {hasCoingeckoFallback && provider !== 'coingecko' && (
              <button type="button" className="secondary-button" onClick={() => setForceFallback(true)}>
                <LineChart size={15} /> {m.useFallback}
              </button>
            )}
          </div>
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

// Compact "Contract Security" checklist row for the dashboard layout -
// reuses the exact same mint/freeze/upgradeable flags the rest of the
// engine already scores (see scoreSecurity/contractSecuritySummary); a
// flag that was never confirmed shows as unknown rather than a false pass.
function ContractSecurityRow({ project }) {
  const data = project.realData;
  if (!data) return null;
  const isNative = Boolean(data.isNativeAsset);
  const checks = [
    { label: 'No Mint Authority', flag: data.mintAuthorityEnabled },
    { label: 'No Freeze Authority', flag: data.freezeAuthorityEnabled },
    { label: 'No Upgradeable', flag: data.upgradeable },
  ];
  return (
    <section className="detail-section contract-security-row">
      <div className="contract-security-head">
        <Lock size={18} />
        <strong>{isNative ? 'Chain Security' : 'Contract Security'}</strong>
        <VerifiedBadge status={project.verificationStatus} size={14} />
      </div>
      <div className="contract-security-checks">
        {/* Native chain assets have no token contract - surface the real
            protocol-level security posture instead of contract-authority flags
            that don't apply. The mint/freeze/upgrade checks still render below
            (all confirmed absent for a native asset), so nothing reads as
            "unknown" when it is in fact structurally impossible. */}
        {isNative && (
          <>
            <span className="security-check ok"><CheckCircle2 size={14} /> Native Asset</span>
            <span className="security-check ok"><CheckCircle2 size={14} /> Protocol Secured</span>
          </>
        )}
        {checks.map((check) => {
          const known = check.flag === true || check.flag === false;
          const ok = check.flag === false;
          return (
            <span key={check.label} className={`security-check ${known ? (ok ? 'ok' : 'warn') : 'unknown'}`}>
              {known ? (ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />) : <CircleDot size={14} />} {check.label}
            </span>
          );
        })}
      </div>
      {isNative && data.nativeSecurity?.chainSecurityStatus && (
        <p className="inline-note contract-security-native-note">{data.nativeSecurity.chainSecurityStatus}</p>
      )}
    </section>
  );
}

function ScamRiskCard({ project }) {
  const { t } = useTranslation();
  const scamRisk = project.scamRisk;
  if (!scamRisk) return null;
  const toneClass = scamRisk.level === 'High' ? 'high' : scamRisk.level === 'Medium' ? 'medium' : 'low';
  const reasons = translatedScamReasons(scamRisk, t);
  return (
    <section className="detail-section">
      <SectionTitle icon={AlertTriangle} eyebrow={t('profileSections.scamRiskEyebrow')} title={t('profileSections.scamRiskTitle')} />
      <div className="result-score-row">
        <span className={`risk-pill ${toneClass}`}>{t(`profileSections.scamRiskLevel.${toneClass}`)}</span>
        <strong>{scamRisk.riskScore}/100</strong>
      </div>
      {reasons.length ? (
        <ul className="scam-risk-reasons">
          {reasons.map((reason) => (
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

// Maps the engine's raw EXPECTED_FIELDS names (see scoringEngine.js) to
// human-readable, translated labels so the Missing Data list never shows
// developer field names like "mintAuthorityEnabled" to users.
// friendlyMissingFields / MISSING_DATA_LABEL_KEYS now live in premiumResearch.js
// (imported above) so the profile card and Premium research share one mapping.

function DeepRiskAnalysisCard({ project }) {
  const { t } = useTranslation();
  if (!project.assetCategory) return null;
  const confidenceTone = project.confidenceLabel === 'High' ? 'good' : project.confidenceLabel === 'Medium' ? 'medium' : 'limited';
  // Everything below is translated at render time so the whole breakdown -
  // category badge, confidence badge, AI explanation, and both signal lists -
  // follows the selected language instead of the English values baked in at
  // scoring time.
  const positiveSignals = translateSignalKeys(project.positiveSignalKeys, project.positiveSignals || []);
  const confidenceLabel = t(`common.${String(project.confidenceLabel || 'medium').toLowerCase()}`);

  // Pair each hidden-risk signal with its severity, most-serious first, so a
  // rug-pull pattern is visibly ranked above a cosmetic concern. When stable
  // signal keys are present we rank + label by key; otherwise (older/manual
  // data with only English strings) we fall back to the flat translated list
  // at a neutral 'medium' severity so nothing is dropped.
  const rankedRisks = project.hiddenRiskSignalKeys?.length
    ? rankSignalsBySeverity(project.hiddenRiskSignalKeys).map(({ key, severity }) => ({
        severity,
        label: t(`askKhan.answers.signals.${key}`),
      }))
    : translateSignalKeys([], project.hiddenRiskSignals || []).map((label) => ({ severity: 'medium', label }));

  const dataSources = project.dataSources?.length ? [...new Set(project.dataSources)] : [];
  const fetched = project.dataFetchedAt ? formatDateTime(project.dataFetchedAt) : null;

  return (
    <section className="detail-section">
      <SectionTitle icon={Layers3} eyebrow={t('profileSections.deepAnalysisEyebrow')} title={t('profileSections.deepAnalysisTitle')} />
      <div className="result-score-row">
        <span className="status-badge">{translatedCategory(project.assetCategory)}</span>
        <span className={`risk-pill ${confidenceTone}`}>{t('profileSections.confidencePill', { label: confidenceLabel, score: project.confidenceScore })}</span>
      </div>
      {project.assetCategory && <p className="inline-note">{buildLocalizedRiskSummary(project)}</p>}
      {positiveSignals.length > 0 && (
        <>
          <h4>{t('profileSections.positiveSignalsTitle')}</h4>
          <ul className="scam-risk-reasons">
            {positiveSignals.map((signal) => (
              <li key={signal}><CheckCircle2 size={14} /> {signal}</li>
            ))}
          </ul>
        </>
      )}
      {rankedRisks.length > 0 && (
        <>
          <h4>{t('profileSections.hiddenRiskSignalsTitle')}</h4>
          <ul className="scam-risk-reasons">
            {rankedRisks.map(({ label, severity }) => (
              <li key={label}>
                <AlertTriangle size={14} />
                <span className={`severity-chip severity-${severity}`}>{t(`profileSections.severity.${severity}`)}</span>
                {label}
              </li>
            ))}
          </ul>
        </>
      )}
      {project.missingDataFields?.length > 0 && (
        <p className="inline-note">{t('profileSections.limitationsNote')}: {friendlyMissingFields(project.missingDataFields).join(', ')}</p>
      )}
      {(fetched || dataSources.length > 0) && (
        <p className="inline-note evidence-provenance">
          {fetched && <span>{t('profileSections.dataAsOf', { date: fetched.date, time: fetched.time })}</span>}
          {fetched && dataSources.length > 0 && ' · '}
          {dataSources.length > 0 && <span>{t('profileSections.sourcesLabel')}: {dataSources.join(', ')}</span>}
        </p>
      )}
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
    [s.holderCount, project.holders ? formatNumber(project.holders) : t('common.notAvailable'), WalletCards],
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
        {rows.map(([label, value, Icon], index) => (
          <div className="real-data-item" key={`${label}-${index}`}>
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

// Token creation is Premium-only (see the gate in LaunchpadPage below); a
// non-Premium wallet sees this instead of the create-token form.
function LaunchpadUpgradeScreen({ navigate }) {
  const { t } = useTranslation();
  const [paymentMessage, setPaymentMessage] = useState('');
  const { wallet } = usePremiumEntitlement();
  const unlockPremium = async () => {
    const result = await startPremiumUpgrade({ navigate, wallet });
    if (!result?.ok) setPaymentMessage(result?.message || stripeUnavailableMessage());
  };

  return (
    <section className="page-section launchpad-page">
      <SectionTitle icon={Lock} eyebrow={t('launchpad.upgrade.eyebrow')} title={t('launchpad.upgrade.title')} />
      <p className="section-subtitle">{t('launchpad.upgrade.subtitle')}</p>
      <section className="detail-section premium-lock-section">
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
    </section>
  );
}

function LaunchpadPage({ onCreateProfile, navigate }) {
  const { t } = useTranslation();
  const { hasPremium } = usePremiumEntitlement();
  const [form, setForm] = useState(launchpadInitialForm);
  const [network, setNetwork] = useState('devnet');
  const [mainnetConfirmations, setMainnetConfirmations] = useState({
    realToken: false,
    realFees: false,
    verifiedMetadata: false,
    noGuarantee: false,
    seedPhrase: false,
  });
  const { address: walletAddress, connecting: walletConnecting, adapter: walletAdapter, selectAndConnect, connectError: walletConnectError } = useKhanWallet();
  const [walletMessage, setWalletMessage] = useState('');
  const [status, setStatus] = useState({ state: 'idle', message: '' });
  const [created, setCreated] = useState(null);
  const decimals = Number(form.decimals || 0);
  const isMainnet = network === 'mainnet-beta';
  const selectedNetwork = launchpadNetworkConfig(network);
  const mainnetReady = Object.values(mainnetConfirmations).every(Boolean);
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

  // Must come after every hook above (rules of hooks) - everything past this
  // point is the actual token-creation form, gated on Premium.
  if (!hasPremium) {
    return <LaunchpadUpgradeScreen navigate={navigate} />;
  }

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
        <WarningBox text={isMainnet ? t('launchpad.warnings.networkMainnet') : t('launchpad.warnings.networkDevnet')} tone={isMainnet ? 'danger' : 'warning'} />
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
          <p>{isMainnet ? t('launchpad.network.mainnetDescription') : t('launchpad.network.devnetDescription')}</p>
        </div>
        <div className="network-selector" role="group" aria-label={t('launchpad.network.ariaLabel')}>
          <button className={network === 'devnet' ? 'active' : ''} type="button" onClick={() => updateNetwork('devnet')}>{t('launchpad.network.devnet')}</button>
          <button className={isMainnet ? 'active mainnet' : 'mainnet'} type="button" onClick={() => updateNetwork('mainnet-beta')}>{t('launchpad.network.mainnet')}</button>
        </div>
        <div className="launchpad-network-row">
          <span className={`network-badge ${isMainnet ? 'danger' : 'active'}`}>{selectedNetwork.label}</span>
          <span className="network-badge active">{t('launchpad.network.premiumIncluded')}</span>
          <span className="network-badge disabled">{t('launchpad.network.phantomRequired')}</span>
        </div>
      </div>

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
            <span>{isMainnet ? t('launchpad.form.mainnetCostWarning') : t('launchpad.form.devnetFreeWarning')}</span>
          </div>

          {isMainnet && (
            <div className="mainnet-confirmations wide">
              <strong>{t('launchpad.form.confirmationsTitle')}</strong>
              <ConfirmationBox checked={mainnetConfirmations.realToken} onChange={(checked) => updateConfirmation('realToken', checked)} text={t('launchpad.form.confirmRealToken')} />
              <ConfirmationBox checked={mainnetConfirmations.realFees} onChange={(checked) => updateConfirmation('realFees', checked)} text={t('launchpad.form.confirmRealFees')} />
              <ConfirmationBox checked={mainnetConfirmations.verifiedMetadata} onChange={(checked) => updateConfirmation('verifiedMetadata', checked)} text={t('launchpad.form.confirmVerifiedMetadata')} />
              <ConfirmationBox checked={mainnetConfirmations.noGuarantee} onChange={(checked) => updateConfirmation('noGuarantee', checked)} text={t('launchpad.form.confirmNoGuarantee')} />
              <ConfirmationBox checked={mainnetConfirmations.seedPhrase} onChange={(checked) => updateConfirmation('seedPhrase', checked)} text={t('launchpad.form.confirmSeedPhrase')} />
            </div>
          )}

          {status.message && (
            <p className={`launchpad-status wide ${status.state}`}>{status.message}</p>
          )}

          <button className="primary-button wide-button" type="submit" disabled={!walletAddress || status.state === 'loading' || (isMainnet && !mainnetReady)}>
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

// ── Admin: Premium Management ─────────────────────────────────────────────────
// Manually grant / revoke / change FREE Premium access for any already
// registered user. Fully isolated from the payment system: it only ever reads
// and writes the manual-premium store (see netlify/functions/_premiumStore.mjs)
// and never touches wallet entitlements, Stripe, or payment records. Reuses the
// same shared admin token as every other admin page.
const PREMIUM_PLAN_LABELS = { free: 'Free', premium: 'Premium', early_supporter: 'KHAN Founding Member' };
const PREMIUM_SOURCE_OPTIONS = ['manual', 'payment', 'giveaway', 'promotion', 'early_supporter'];
const PREMIUM_DURATION_OPTIONS = ['lifetime', 'none', '7d', '30d', '90d', 'custom'];
const PREMIUM_REASON_OPTIONS = ['giveaway_winner', 'early_supporter', 'investor', 'partner', 'moderator', 'testing', 'promotion', 'other'];

function planLabel(t, plan) {
  return t(`adminPremium.plans.${plan}`) || PREMIUM_PLAN_LABELS[plan] || plan;
}

// Shared shell for the admin user-management modals (grant, details, bulk).
//
// Portal to <body> so the fixed-position backdrop is not trapped by an
// ancestor's containing block. AdminPremiumPage renders these modals inside its
// `.page-section`, which keeps a non-`none` transform from the khanFadeUp
// entrance animation (animation-fill-mode: both retains the final keyframe
// forever) - that makes the section the containing block for `position: fixed`,
// so `inset: 0` resolves against the whole tall section instead of the viewport.
// The backdrop then dims the section while the panel lands at the section's top,
// far above the visible area once you have scrolled down the user table to reach
// "Manage" - which is why this only showed up on mobile, where the table is tall
// enough to need that scroll. ReportModal already uses this same fix.
function AdminModalShell({ onClose, className, dismissable = true, children }) {
  // Lock the background while the modal is open. iOS Safari ignores
  // `overflow: hidden` on <body>, so pin the body and restore the offset on
  // close - otherwise the page behind scrolls under the modal on touch.
  useEffect(() => {
    const { body } = document;
    const scrollY = window.scrollY;
    const prev = { position: body.style.position, top: body.style.top, width: body.style.width };
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.width = prev.width;
      // `behavior: instant` overrides the global `html { scroll-behavior: smooth }`,
      // which would otherwise animate the page back to where it already was.
      window.scrollTo({ top: scrollY, left: 0, behavior: 'instant' });
    };
  }, []);

  useEffect(() => {
    if (!dismissable) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dismissable, onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={`modal-backdrop admin-modal-backdrop${className ? ` ${className}` : ''}`}
      role="dialog"
      aria-modal="true"
      onClick={(event) => { if (dismissable && event.target === event.currentTarget) onClose(); }}
    >
      {children}
    </div>,
    document.body,
  );
}

function PremiumGrantModal({ user, token, onClose, onDone }) {
  const { t } = useTranslation();
  const [plan, setPlan] = useState(user.plan && user.plan !== 'free' ? user.plan : 'premium');
  const [source, setSource] = useState(user.source || 'manual');
  const [duration, setDuration] = useState('lifetime');
  const [customExpiry, setCustomExpiry] = useState('');
  const [reason, setReason] = useState(user.reason || 'giveaway_winner');
  const [state, setState] = useState({ status: 'idle', message: '' });

  const run = async (action, overridePlan) => {
    setState({ status: 'loading', message: '' });
    try {
      await submitPremiumAction(token, {
        action,
        userId: user.id,
        plan: overridePlan || plan,
        source,
        duration,
        customExpiry: duration === 'custom' ? customExpiry : '',
        reason,
      });
      onDone();
    } catch (error) {
      setState({ status: 'error', message: error.message || t('adminPremium.actionFailed') });
    }
  };

  const busy = state.status === 'loading';

  return (
    <AdminModalShell onClose={onClose}>
      <div className="modal-panel premium-grant-modal">
        <button className="modal-close-btn" type="button" onClick={onClose} aria-label={t('common.close')}><X size={18} /></button>
        <SectionTitle icon={Crown} eyebrow={t('adminPremium.eyebrow')} title={t('adminPremium.manageFor', { name: user.name || user.email })} />
        <p className="inline-note">{user.email}</p>

        <label className="form-field">
          <span>{t('adminPremium.fields.plan')}</span>
          <select value={plan} onChange={(event) => setPlan(event.target.value)}>
            <option value="premium">{planLabel(t, 'premium')}</option>
            <option value="early_supporter">{planLabel(t, 'early_supporter')}</option>
            <option value="free">{planLabel(t, 'free')}</option>
          </select>
        </label>

        <label className="form-field">
          <span>{t('adminPremium.fields.duration')}</span>
          <select value={duration} onChange={(event) => setDuration(event.target.value)} disabled={plan === 'free'}>
            {PREMIUM_DURATION_OPTIONS.map((value) => (
              <option key={value} value={value}>{t(`adminPremium.durations.${value}`)}</option>
            ))}
          </select>
        </label>
        {duration === 'custom' && plan !== 'free' && (
          <FormField label={t('adminPremium.fields.customExpiry')} type="date" value={customExpiry} onChange={setCustomExpiry} />
        )}

        <label className="form-field">
          <span>{t('adminPremium.fields.source')}</span>
          <select value={source} onChange={(event) => setSource(event.target.value)}>
            {PREMIUM_SOURCE_OPTIONS.map((value) => (
              <option key={value} value={value}>{t(`adminPremium.sources.${value}`)}</option>
            ))}
          </select>
        </label>

        <label className="form-field">
          <span>{t('adminPremium.fields.reason')}</span>
          <select value={reason} onChange={(event) => setReason(event.target.value)}>
            {PREMIUM_REASON_OPTIONS.map((value) => (
              <option key={value} value={value}>{t(`adminPremium.reasons.${value}`)}</option>
            ))}
          </select>
        </label>

        {state.message && <p className="lookup-message error">{state.message}</p>}

        <div className="premium-grant-actions">
          <button className="primary-button" type="button" disabled={busy} onClick={() => run('grant', 'premium')}>
            <BadgeCheck size={18} /> {t('adminPremium.grantPremium')}
          </button>
          <button className="secondary-button" type="button" disabled={busy} onClick={() => run('change_plan')}>
            <CheckCircle2 size={18} /> {t('adminPremium.applyPlan')}
          </button>
          <button className="ghost-button danger" type="button" disabled={busy} onClick={() => run('revoke')}>
            <X size={18} /> {t('adminPremium.revoke')}
          </button>
        </div>
      </div>
    </AdminModalShell>
  );
}

// Read-only "User Details" modal: the full activity history for one account,
// loaded on demand from premium-admin-user-detail. Analysis only - it shows
// what the account actually did; it never classifies or bans anyone.
function UserDetailsModal({ user, token, onClose, onManage }) {
  const { t } = useTranslation();
  const [state, setState] = useState({ status: 'loading', message: '' });
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setState({ status: 'loading', message: '' });
      try {
        const result = await fetchUserActivityDetail(token, user.id);
        if (!cancelled) { setDetail(result); setState({ status: 'idle', message: '' }); }
      } catch (error) {
        if (!cancelled) setState({ status: 'error', message: error.message || t('adminPremium.details.loadFailed') });
      }
    })();
    return () => { cancelled = true; };
  }, [token, user.id]);

  const m = detail?.metrics || {};
  const history = detail?.history || {};
  const wallet = detail?.wallet || {};

  const summaryRows = [
    [t('adminPremium.columns.registered'), fmtDateTime(detail?.user?.createdAt) || '—'],
    [t('adminPremium.columns.lastLogin'), fmtDateTime(m.lastLogin) || t('adminPremium.never')],
    [t('adminPremium.columns.lastActivity'), fmtDateTime(m.lastActivity) || t('adminPremium.never')],
    [t('adminPremium.columns.logins'), m.loginCount ?? 0],
    [t('adminPremium.columns.scans'), m.scanCount ?? 0],
    [t('adminPremium.columns.compares'), m.compareCount ?? 0],
    [t('adminPremium.columns.watchlist'), m.watchlistCount ?? 0],
    [t('adminPremium.columns.projectsViewed'), m.projectsViewed ?? 0],
    [t('adminPremium.columns.accountAge'), formatAccountAge(m.accountAgeDays)],
  ];

  return (
    <AdminModalShell onClose={onClose}>
      <div className="modal-panel user-details-modal">
        <button className="modal-close-btn" type="button" onClick={onClose} aria-label={t('common.close')}><X size={18} /></button>
        <SectionTitle icon={Activity} eyebrow={t('adminPremium.eyebrow')} title={t('adminPremium.details.title', { name: user.name || user.email })} />
        <p className="inline-note">{user.email}</p>
        <p className="inline-note details-disclaimer">{t('adminPremium.details.disclaimer')}</p>

        {state.status === 'loading' && <p className="lookup-message">{t('adminPremium.details.loading')}</p>}
        {state.status === 'error' && <p className="lookup-message error">{state.message}</p>}

        {detail && (
          <>
            <div className="details-topline">
              <ActivityBadge score={m.activityScore} level={m.activityLevel} t={t} />
              <YesNo value={detail.user.emailVerified} t={t} />
              <span className="status-badge">{planLabel(t, detail.premium?.plan)}</span>
              <span className={wallet.connected ? 'yesno yes' : 'yesno no'}>
                <WalletCards size={13} /> {wallet.connected ? t('common.yes') : t('common.no')}
              </span>
            </div>

            <div className="details-grid">
              {summaryRows.map(([label, value]) => (
                <div className="details-cell" key={label}>
                  <span className="details-label">{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>

            {wallet.connected && (
              <p className="inline-note">
                {t('adminPremium.details.walletAddress')}: <code>{wallet.address}</code>
                {wallet.firstLinkedAt && <> — {t('adminPremium.details.firstSeen', { date: fmtDateTime(wallet.firstLinkedAt) })}</>}
              </p>
            )}

            <DetailHistorySection title={t('adminPremium.details.loginHistory')} count={history.logins?.length}>
              {history.logins?.map((e, i) => (
                <li key={i}>{fmtDateTime(e.timestamp)}</li>
              ))}
            </DetailHistorySection>

            <DetailHistorySection title={t('adminPremium.details.scanHistory')} count={history.scans?.length}>
              {history.scans?.map((e, i) => (
                <li key={i}>
                  <span>{fmtDateTime(e.timestamp)}</span>
                  <span className="details-hist-name">{e.projectName || e.ticker || e.contract || '—'}</span>
                  {e.trustScore !== null && <span className="details-hist-score">{e.trustScore}</span>}
                </li>
              ))}
            </DetailHistorySection>

            <DetailHistorySection title={t('adminPremium.details.compareHistory')} count={history.compares?.length}>
              {history.compares?.map((e, i) => (
                <li key={i}><span>{fmtDateTime(e.timestamp)}</span><span className="details-hist-name">{e.projectName || '—'}</span></li>
              ))}
            </DetailHistorySection>

            <DetailHistorySection title={t('adminPremium.details.watchlistActivity')} count={history.watchlist?.length}>
              {history.watchlist?.map((w, i) => (
                <li key={i}>{typeof w === 'string' ? w : (w.name || w.ticker || w.contract || w.id || '—')}</li>
              ))}
            </DetailHistorySection>

            <DetailHistorySection title={t('adminPremium.details.premiumHistory')} count={history.premium?.length}>
              {history.premium?.map((entry) => (
                <li key={entry.id}>
                  <span>{entry.date} {entry.time}</span>
                  <span className="details-hist-name">{planLabel(t, entry.previousPlan)} → {planLabel(t, entry.newPlan)}</span>
                  <span className="details-hist-score">{entry.administrator}</span>
                </li>
              ))}
            </DetailHistorySection>

            <div className="premium-grant-actions">
              <button className="secondary-button" type="button" onClick={onManage}>
                <Crown size={16} /> {t('adminPremium.manage')}
              </button>
              <button className="ghost-button" type="button" onClick={onClose}>{t('common.close')}</button>
            </div>
          </>
        )}
      </div>
    </AdminModalShell>
  );
}

// One collapsible-free history list with a count and an empty state.
function DetailHistorySection({ title, count, children }) {
  const { t } = useTranslation();
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <div className="details-history">
      <h4>{title} <span className="details-count">{count ?? items.length}</span></h4>
      {items.length ? <ul className="details-hist-list">{items}</ul> : <p className="muted-cell">{t('adminPremium.details.noneYet')}</p>}
    </div>
  );
}

// Bulk-action dropdown values -> how the backend should interpret them. Grants
// map onto the fixed billing windows _premiumStore.computeExpiry understands;
// 'remove' is a bulk revoke.
const BULK_ACTION_OPTIONS = [
  { value: '30d', kind: 'grant', duration: '30d' },
  { value: '90d', kind: 'grant', duration: '90d' },
  { value: '180d', kind: 'grant', duration: '180d' },
  { value: '365d', kind: 'grant', duration: '365d' },
  { value: 'remove', kind: 'remove', duration: null },
];

const PREMIUM_FILTER_OPTIONS = [
  'all', 'verified', 'unverified', 'active_today', 'active_week',
  'never_logged_in', 'never_scanned', 'wallet', 'no_wallet', 'premium', 'free',
];

const DAY_MS_UI = 86400000;

function isActiveWithin(lastActivity, days, now) {
  if (!lastActivity) return false;
  const ts = Date.parse(lastActivity);
  return !Number.isNaN(ts) && now - ts <= days * DAY_MS_UI;
}

function matchesPremiumFilter(user, filter, now, today) {
  switch (filter) {
    case 'verified': return Boolean(user.emailVerified);
    case 'unverified': return !user.emailVerified;
    case 'active_today': return (user.lastActivity || '').slice(0, 10) === today;
    case 'active_week': return isActiveWithin(user.lastActivity, 7, now);
    // MUST use the same durable field as the "Never Logged In" card, not
    // loginCount. loginCount counts surviving `user_login` EVENTS from the
    // capped analytics log — a different question with a different answer, so
    // filtering by it would return a set whose size disagreed with the card
    // sitting directly above it.
    case 'never_logged_in': return user.hasLoggedIn !== true;
    case 'never_scanned': return (user.scanCount || 0) === 0;
    case 'wallet': return Boolean(user.walletConnected);
    case 'no_wallet': return !user.walletConnected;
    case 'premium': return user.status === 'active';
    case 'free': return user.status !== 'active';
    case 'all':
    default: return true;
  }
}

// Requirement 5: activity-based pre-filters that narrow which users are
// *eligible* for a bulk Premium grant, so Premium can be limited to accounts
// that actually used the platform. Each returns true when the user passes.
const BULK_PREFILTERS = [
  { key: 'verified_only', test: (u) => Boolean(u.emailVerified) },
  { key: 'active_only', test: (u, now) => isActiveWithin(u.lastActivity, 7, now) },
  { key: 'min_1_scan', test: (u) => (u.scanCount || 0) >= 1 },
  { key: 'min_3_scans', test: (u) => (u.scanCount || 0) >= 3 },
  { key: 'logged_in_30d', test: (u, now) => isActiveWithin(u.lastLogin, 30, now) },
  { key: 'wallet_connected', test: (u) => Boolean(u.walletConnected) },
  // Same durable field as the card and the filter above — see the note there.
  // This one gates who receives a bulk Premium grant, so a wrong answer here
  // hands paid access to accounts the admin explicitly excluded.
  { key: 'exclude_never_logged_in', test: (u) => u.hasLoggedIn === true },
];

// Small display helpers for the activity columns.
function activityLevelKey(level) {
  return level === 'high' ? 'high' : level === 'medium' ? 'medium' : 'low';
}

function fmtDateTime(iso) {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return null;
  return new Date(ts).toLocaleString();
}

function formatAccountAge(days) {
  if (days === null || days === undefined) return '—';
  if (days < 1) return '<1d';
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

function YesNo({ value, t }) {
  return (
    <span className={value ? 'yesno yes' : 'yesno no'}>
      {value ? t('common.yes') : t('common.no')}
    </span>
  );
}

// Activity indicator badge (Low / Medium / High) - an engagement signal only,
// never a moderation or bot label (see _userActivity.computeActivityScore).
function ActivityBadge({ score, level, t }) {
  const key = activityLevelKey(level);
  return (
    <span className={`activity-badge activity-${key}`} title={`${score ?? 0}/100`}>
      <Activity size={13} /> {t(`adminPremium.activity.${key}`)} <em>{score ?? 0}</em>
    </span>
  );
}

function AdminPremiumPage() {
  const { t } = useTranslation();
  const [token, setToken] = useState(() => getStoredAdminToken());
  const [passcode, setPasscode] = useState('');
  const [authState, setAuthState] = useState({ status: 'idle', message: '' });
  const [data, setData] = useState(null);
  const [loadState, setLoadState] = useState({ status: 'idle', message: '' });
  const [search, setSearch] = useState('');
  const [editingUser, setEditingUser] = useState(null);
  const [showAudit, setShowAudit] = useState(false);
  const [audit, setAudit] = useState(null);
  // ── Bulk Premium Management state ──
  const [filterPlan, setFilterPlan] = useState('all');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkChoice, setBulkChoice] = useState('');
  const [bulkConfirm, setBulkConfirm] = useState(null); // { kind, duration, count }
  const [bulkState, setBulkState] = useState({ status: 'idle', message: '' });
  const [bulkPrefilters, setBulkPrefilters] = useState(() => new Set());
  // ── User Details modal ──
  const [detailUser, setDetailUser] = useState(null);

  const load = async (activeToken) => {
    setLoadState({ status: 'loading', message: t('adminPremium.loading') });
    try {
      // Enriched endpoint: registered users + real activity metrics + dashboard
      // aggregates. Falls back to the lighter premium-admin-list if the newer
      // function is unavailable, so the page keeps working either way.
      let result;
      try {
        result = await fetchUserActivity(activeToken);
      } catch (activityError) {
        if (activityError.status === 401) throw activityError;
        result = await fetchPremiumUsers(activeToken);
      }
      setData(result);
      setLoadState({ status: 'idle', message: '' });
    } catch (error) {
      setLoadState({ status: 'error', message: error.message || t('adminPremium.loadFailed') });
    }
  };

  const loadAudit = async (activeToken) => {
    try {
      setAudit(await fetchPremiumAudit(activeToken));
    } catch {
      setAudit([]);
    }
  };

  useEffect(() => {
    if (token) load(token);
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
    setData(null);
    setSelectedIds(new Set());
  };

  const toggleAudit = () => {
    const next = !showAudit;
    setShowAudit(next);
    if (next && audit === null) loadAudit(token);
  };

  if (!token) {
    return (
      <section className="page-section">
        <SectionTitle icon={Lock} eyebrow={t('adminVerify.eyebrow')} title={t('adminPremium.title')} />
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

  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const dashboard = data?.dashboard || null;

  const term = search.trim().toLowerCase();
  const users = (data?.users || []).filter((u) => {
    if (!matchesPremiumFilter(u, filterPlan, now, today)) return false;
    if (!term) return true;
    return [u.name, u.username, u.email].filter(Boolean).some((field) => field.toLowerCase().includes(term));
  });

  // Bulk pre-filters (requirement 5): a user is *eligible* for a bulk action
  // only if they pass every active pre-filter. When none are active, every
  // visible user is eligible. This lets Premium be granted only to accounts
  // that really used the platform.
  const activePrefilters = BULK_PREFILTERS.filter((f) => bulkPrefilters.has(f.key));
  const isEligible = (u) => activePrefilters.every((f) => f.test(u, now));

  const toggleBulkPrefilter = (key) => {
    setBulkPrefilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
    // Dropping a constraint could leave ineligible rows selected; prune them.
    setSelectedIds((prev) => {
      const next = new Set(prev);
      return next;
    });
  };

  // Selection is tracked by user id; derive counts against the *currently
  // visible AND eligible* rows so "Select all" and the selected count stay
  // meaningful when a search / filter / pre-filter is applied.
  const eligibleUsers = users.filter(isEligible);
  const eligibleIds = eligibleUsers.map((u) => u.id);
  const selectedVisible = eligibleIds.filter((id) => selectedIds.has(id));
  const allVisibleSelected = eligibleIds.length > 0 && selectedVisible.length === eligibleIds.length;

  const toggleOne = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        eligibleIds.forEach((id) => next.delete(id));
      } else {
        eligibleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const openBulkConfirm = () => {
    const option = BULK_ACTION_OPTIONS.find((o) => o.value === bulkChoice);
    if (!option || !selectedVisible.length) return;
    setBulkState({ status: 'idle', message: '' });
    setBulkConfirm({ kind: option.kind, duration: option.duration, count: selectedVisible.length });
  };

  const runBulk = async () => {
    if (!bulkConfirm) return;
    // Only ever act on users that are both selected AND currently eligible.
    const targetIds = eligibleIds.filter((id) => selectedIds.has(id));
    setBulkState({ status: 'loading', message: '' });
    try {
      const result = await submitBulkPremiumAction(token, {
        action: bulkConfirm.kind === 'remove' ? 'bulk_revoke' : 'bulk_grant',
        userIds: targetIds,
        duration: bulkConfirm.duration || undefined,
        source: 'manual',
        reason: 'promotion',
      });
      const successCount = result.successCount ?? targetIds.length;
      const failedCount = result.failedCount ?? 0;
      const message = bulkConfirm.kind === 'remove'
        ? t('adminPremium.bulk.successRemove', { count: successCount })
        : t('adminPremium.bulk.successGrant', { count: successCount });
      const withFailures = failedCount > 0
        ? `${message} ${t('adminPremium.bulk.someFailed', { count: failedCount })}`
        : message;
      setBulkState({ status: 'success', message: withFailures });
      setBulkConfirm(null);
      setBulkChoice('');
      clearSelection();
      await load(token);
      if (showAudit) await loadAudit(token);
    } catch (error) {
      setBulkState({ status: 'error', message: error.message || t('adminPremium.bulk.failed') });
      setBulkConfirm(null);
    }
  };

  return (
    <section className="page-section analytics-dashboard">
      <SectionTitle icon={Crown} eyebrow={t('adminPremium.eyebrow')} title={t('adminPremium.title')} />
      <p className="inline-note">{t('adminPremium.intro')}</p>

      <div className="analytics-toolbar">
        <button className="secondary-button" type="button" onClick={() => load(token)}>{t('common.refresh')}</button>
        <button className="secondary-button" type="button" onClick={toggleAudit}>
          <Shield size={16} /> {showAudit ? t('adminPremium.hideAudit') : t('adminPremium.showAudit')}
        </button>
        <button className="secondary-button admin-cross-link" type="button" onClick={() => { window.location.hash = '/admin-analytics'; window.dispatchEvent(new HashChangeEvent('hashchange')); }}>
          <BarChart3 size={16} /> {t('adminAnalytics.title')}
        </button>
        <button className="ghost-button" type="button" onClick={logout}>{t('common.signOut')}</button>
      </div>

      {data && (
        <div className="analytics-stat-grid">
          {/* These read the same durable user-record fields as the Analytics
              dashboard, so the two admin pages can no longer show different
              numbers for the same question. */}
          <StatCard icon={Users} label={t('adminPremium.statRegistered')} numericValue={data.totalRegistered} tooltip={t('adminAnalytics.tooltips.registeredUsers')} />
          <StatCard icon={Crown} label={t('adminPremium.statActivePremium')} numericValue={data.premiumCount} tooltip={t('adminPremium.dashboard.tooltips.activePremium')} />
          {dashboard && <StatCard icon={BadgeCheck} label={t('adminPremium.dashboard.verified')} numericValue={dashboard.verified} tooltip={t('adminPremium.dashboard.tooltips.verified')} />}
          {dashboard && <StatCard icon={Users} label={t('adminPremium.dashboard.loggedIn')} numericValue={dashboard.loggedIn} tooltip={t('adminAnalytics.tooltips.loggedInUsers')} />}
          {dashboard && <StatCard icon={Lock} label={t('adminPremium.dashboard.neverLoggedIn')} numericValue={dashboard.neverLoggedIn} tooltip={t('adminAnalytics.tooltips.neverLoggedInUsers')} />}
          {dashboard && <StatCard icon={Activity} label={t('adminPremium.dashboard.activeToday')} numericValue={dashboard.activeToday} tooltip={t('adminAnalytics.tooltips.activeToday')} />}
          {dashboard && <StatCard icon={CalendarClock} label={t('adminPremium.dashboard.activeThisWeek')} numericValue={dashboard.activeThisWeek} tooltip={t('adminAnalytics.tooltips.activeLast7Days')} />}
          {dashboard && <StatCard icon={Search} label={t('adminPremium.dashboard.withScans')} numericValue={dashboard.withScans} tooltip={t('adminPremium.dashboard.tooltips.withScans')} />}
          {dashboard && <StatCard icon={X} label={t('adminPremium.dashboard.zeroScans')} numericValue={dashboard.zeroScans} tooltip={t('adminPremium.dashboard.tooltips.zeroScans')} />}
          {dashboard && <StatCard icon={WalletCards} label={t('adminPremium.dashboard.walletConnected')} numericValue={dashboard.walletConnected} tooltip={t('adminPremium.dashboard.tooltips.walletConnected')} />}
        </div>
      )}

      <div className="premium-filter-row">
        <div className="premium-search-bar">
          <Search size={18} />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('adminPremium.searchPlaceholder')}
            aria-label={t('adminPremium.searchPlaceholder')}
          />
        </div>
        <label className="premium-filter-select">
          <ListFilter size={16} />
          <select value={filterPlan} onChange={(event) => setFilterPlan(event.target.value)} aria-label={t('adminPremium.filterLabel')}>
            {PREMIUM_FILTER_OPTIONS.map((value) => (
              <option key={value} value={value}>{t(`adminPremium.filters.${value}`)}</option>
            ))}
          </select>
        </label>
      </div>

      {data && (
        <div className="bulk-premium-panel">
          <h3 className="admin-section-heading">{t('adminPremium.bulk.title')}</h3>
          <p className="inline-note">{t('adminPremium.bulk.intro')}</p>

          <div className="bulk-prefilter-row" role="group" aria-label={t('adminPremium.bulk.prefilterLabel')}>
            <span className="bulk-prefilter-label">{t('adminPremium.bulk.prefilterLabel')}</span>
            {BULK_PREFILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className={bulkPrefilters.has(f.key) ? 'filter-chip active' : 'filter-chip'}
                aria-pressed={bulkPrefilters.has(f.key)}
                onClick={() => toggleBulkPrefilter(f.key)}
              >
                {t(`adminPremium.bulk.prefilters.${f.key}`)}
              </button>
            ))}
            {!!activePrefilters.length && (
              <span className="bulk-eligible-note">{t('adminPremium.bulk.eligibleNote', { count: eligibleIds.length })}</span>
            )}
          </div>

          <div className="bulk-action-bar">
            <span className="bulk-selected-count">{t('adminPremium.bulk.selectedCount', { count: selectedVisible.length })}</span>
            <label className="premium-filter-select">
              <Crown size={16} />
              <select value={bulkChoice} onChange={(event) => setBulkChoice(event.target.value)} aria-label={t('adminPremium.bulk.actionLabel')}>
                <option value="">{t('adminPremium.bulk.choosePlaceholder')}</option>
                {BULK_ACTION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{t(`adminPremium.bulk.options.${option.value}`)}</option>
                ))}
              </select>
            </label>
            <button
              className="primary-button"
              type="button"
              disabled={!bulkChoice || !selectedVisible.length || bulkState.status === 'loading'}
              onClick={openBulkConfirm}
            >
              <BadgeCheck size={16} /> {t('adminPremium.bulk.apply')}
            </button>
            {!!selectedVisible.length && (
              <button className="ghost-button" type="button" onClick={clearSelection}>
                {t('adminPremium.bulk.clear')}
              </button>
            )}
          </div>
          {bulkState.status === 'success' && <p className="lookup-message success">{bulkState.message}</p>}
          {bulkState.status === 'error' && <p className="lookup-message error">{bulkState.message}</p>}
        </div>
      )}

      {loadState.status === 'loading' && !data && <p className="lookup-message">{t('adminPremium.loading')}</p>}
      {loadState.status === 'error' && (
        <>
          <p className="lookup-message error">{loadState.message}</p>
          <button className="secondary-button" type="button" onClick={() => load(token)}>{t('common.retry')}</button>
        </>
      )}

      {data && !users.length && <EmptyState title={t('adminPremium.emptyTitle')} text={t('adminPremium.emptyText')} />}

      {data && !!users.length && (
        <div className="analytics-table-card scroll-x">
          <table className="analytics-table activity-table">
            <thead>
              <tr>
                <th className="bulk-check-col">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    aria-label={t('adminPremium.bulk.selectAll')}
                    title={t('adminPremium.bulk.selectAll')}
                  />
                </th>
                <th>{t('adminPremium.columns.user')}</th>
                <th>{t('adminPremium.columns.email')}</th>
                <th>{t('adminPremium.columns.verified')}</th>
                <th>{t('adminPremium.columns.registered')}</th>
                <th>{t('adminPremium.columns.lastLogin')}</th>
                <th>{t('adminPremium.columns.lastActivity')}</th>
                <th className="num-col">{t('adminPremium.columns.logins')}</th>
                <th className="num-col">{t('adminPremium.columns.scans')}</th>
                <th className="num-col">{t('adminPremium.columns.compares')}</th>
                <th className="num-col">{t('adminPremium.columns.watchlist')}</th>
                <th className="num-col">{t('adminPremium.columns.projectsViewed')}</th>
                <th>{t('adminPremium.columns.wallet')}</th>
                <th>{t('adminPremium.columns.plan')}</th>
                <th>{t('adminPremium.columns.status')}</th>
                <th>{t('adminPremium.columns.accountAge')}</th>
                <th>{t('adminPremium.columns.activity')}</th>
                <th>{t('adminPremium.columns.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const eligible = isEligible(u);
                const disabledRow = activePrefilters.length > 0 && !eligible;
                return (
                  <tr key={u.id} className={`${selectedIds.has(u.id) ? 'row-selected' : ''}${disabledRow ? ' row-ineligible' : ''}`.trim() || undefined}>
                    <td className="bulk-check-col">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(u.id)}
                        onChange={() => toggleOne(u.id)}
                        disabled={disabledRow}
                        title={disabledRow ? t('adminPremium.bulk.ineligibleHint') : undefined}
                        aria-label={t('adminPremium.bulk.selectUser', { name: u.name || u.email })}
                      />
                    </td>
                    <td>
                      <strong>{u.name || t('adminPremium.unnamed')}</strong>
                      {u.username && <div className="table-subtext">@{u.username}</div>}
                    </td>
                    <td>{u.email}</td>
                    <td><YesNo value={u.emailVerified} t={t} /></td>
                    <td>{fmtDateTime(u.createdAt) || '—'}</td>
                    <td>{u.lastLogin ? fmtDateTime(u.lastLogin) : <span className="muted-cell">{t('adminPremium.never')}</span>}</td>
                    <td>{u.lastActivity ? fmtDateTime(u.lastActivity) : <span className="muted-cell">{t('adminPremium.never')}</span>}</td>
                    <td className="num-col">{u.loginCount ?? 0}</td>
                    <td className="num-col">{u.scanCount ?? 0}</td>
                    <td className="num-col">{u.compareCount ?? 0}</td>
                    <td className="num-col">{u.watchlistCount ?? 0}</td>
                    <td className="num-col">{u.projectsViewed ?? 0}</td>
                    <td><YesNo value={u.walletConnected} t={t} /></td>
                    <td><span className="status-badge">{planLabel(t, u.plan)}</span></td>
                    <td>
                      <span className={u.status === 'active' ? 'premium-status active' : 'premium-status'}>
                        {u.status === 'active' ? t('adminPremium.statusActive') : t('adminPremium.statusInactive')}
                      </span>
                      {u.expiresAt && <div className="table-subtext">{t('adminPremium.expires', { date: new Date(u.expiresAt).toLocaleDateString() })}</div>}
                    </td>
                    <td>{formatAccountAge(u.accountAgeDays)}</td>
                    <td><ActivityBadge score={u.activityScore} level={u.activityLevel} t={t} /></td>
                    <td>
                      <div className="row-actions">
                        <button className="secondary-button small-button" type="button" onClick={() => setDetailUser(u)}>
                          <Eye size={14} /> {t('adminPremium.detailsButton')}
                        </button>
                        <button className="secondary-button small-button" type="button" onClick={() => setEditingUser(u)}>
                          {t('adminPremium.manage')}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showAudit && (
        <div className="analytics-table-card">
          <h4>{t('adminPremium.auditTitle')}</h4>
          {audit === null && <p className="lookup-message">{t('adminPremium.loading')}</p>}
          {audit !== null && !audit.length && <EmptyState title={t('adminPremium.auditEmptyTitle')} text={t('adminPremium.auditEmptyText')} />}
          {audit !== null && !!audit.length && (
            <table className="analytics-table">
              <thead>
                <tr>
                  <th>{t('adminPremium.audit.when')}</th>
                  <th>{t('adminPremium.audit.admin')}</th>
                  <th>{t('adminPremium.audit.user')}</th>
                  <th>{t('adminPremium.audit.change')}</th>
                  <th>{t('adminPremium.audit.reason')}</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((entry) => (
                  entry.kind === 'bulk' ? (
                    <tr key={entry.id} className="audit-bulk-row">
                      <td>{entry.date} {entry.time}</td>
                      <td>{entry.administrator}</td>
                      <td>
                        <span className="status-badge">{t('adminPremium.audit.bulkTag')}</span>{' '}
                        {t('adminPremium.bulk.auditUsers', {
                          success: entry.successCount ?? 0,
                          total: entry.userCount ?? 0,
                          failed: entry.failedCount ?? 0,
                        })}
                      </td>
                      <td>
                        {entry.action === 'bulk_revoke'
                          ? t('adminPremium.bulk.auditRevoke')
                          : t('adminPremium.bulk.auditGrant', { duration: t(`adminPremium.durations.${entry.duration}`) })}
                      </td>
                      <td>{entry.reason ? t(`adminPremium.reasons.${entry.reason}`) : '—'}</td>
                    </tr>
                  ) : (
                    <tr key={entry.id}>
                      <td>{entry.date} {entry.time}</td>
                      <td>{entry.administrator}</td>
                      <td>{entry.userEmail}</td>
                      <td>{planLabel(t, entry.previousPlan)} → {planLabel(t, entry.newPlan)}</td>
                      <td>{entry.reason ? t(`adminPremium.reasons.${entry.reason}`) : '—'}</td>
                    </tr>
                  )
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {editingUser && (
        <PremiumGrantModal
          user={editingUser}
          token={token}
          onClose={() => setEditingUser(null)}
          onDone={() => {
            setEditingUser(null);
            load(token);
            if (showAudit) loadAudit(token);
          }}
        />
      )}

      {detailUser && (
        <UserDetailsModal
          user={detailUser}
          token={token}
          onClose={() => setDetailUser(null)}
          onManage={() => { setEditingUser(detailUser); setDetailUser(null); }}
        />
      )}

      {bulkConfirm && (
        <AdminModalShell
          onClose={() => setBulkConfirm(null)}
          dismissable={bulkState.status !== 'loading'}
        >
          <div className="modal-panel bulk-confirm-modal">
            <SectionTitle
              icon={bulkConfirm.kind === 'remove' ? Trash2 : Crown}
              eyebrow={t('adminPremium.bulk.title')}
              title={bulkConfirm.kind === 'remove' ? t('adminPremium.bulk.confirmRemoveTitle') : t('adminPremium.bulk.confirmGrantTitle')}
            />
            <p className="bulk-confirm-text">
              {bulkConfirm.kind === 'remove'
                ? t('adminPremium.bulk.confirmRemove', { count: bulkConfirm.count })
                : t('adminPremium.bulk.confirmGrant', { count: bulkConfirm.count, duration: t(`adminPremium.bulk.options.${bulkChoice}`) })}
            </p>
            {bulkState.status === 'error' && <p className="lookup-message error">{bulkState.message}</p>}
            <div className="premium-grant-actions">
              <button
                className={bulkConfirm.kind === 'remove' ? 'primary-button danger' : 'primary-button'}
                type="button"
                disabled={bulkState.status === 'loading'}
                onClick={runBulk}
              >
                {bulkState.status === 'loading' ? t('adminPremium.bulk.working') : t('adminPremium.bulk.confirmYes')}
              </button>
              <button
                className="ghost-button"
                type="button"
                disabled={bulkState.status === 'loading'}
                onClick={() => setBulkConfirm(null)}
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </AdminModalShell>
      )}
    </section>
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

// `tooltip` explains precisely what the number counts. These metrics are easy
// to misread — "logged in" vs "visited", "today" vs "last 24 hours", "unique
// users" vs "sessions" — and an administrator acting on a misread number is
// the failure this dashboard exists to prevent. The definition is rendered
// as a real focusable element with an accessible name, not a bare `title`
// attribute, so it is reachable by keyboard and screen readers too.
function StatCard({ icon: Icon, label, value, numericValue, sublabel, tooltip }) {
  return (
    <div className="analytics-stat-card">
      <Icon size={20} />
      <strong>{numericValue !== undefined ? <AnimatedNumber value={numericValue} format={(n) => n.toLocaleString('en-US')} /> : value}</strong>
      <span>
        {label}
        {tooltip && (
          <button type="button" className="metric-info" title={tooltip} aria-label={tooltip}>
            <Info size={12} aria-hidden="true" />
          </button>
        )}
      </span>
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
    if (!token) return undefined;
    loadSummary(token);
    // Auto-refresh so the dashboard reflects new user activity in near real
    // time without a manual reload (matches the 30s cadence used elsewhere).
    const interval = setInterval(() => loadSummary(token), 30000);
    return () => clearInterval(interval);
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
  const trafficLabels = {
    direct: t('adminAnalytics.trafficDirect'),
    google: 'Google',
    x: 'X (Twitter)',
    telegram: 'Telegram',
    other: t('adminAnalytics.trafficOther'),
  };
  const trafficData = Object.entries(summary.visitorAnalytics.trafficSources).map(([label, value]) => ({
    label: trafficLabels[label] || (label.charAt(0).toUpperCase() + label.slice(1)),
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
        <button className="secondary-button admin-cross-link" type="button" onClick={() => { window.location.hash = '/admin-holders'; window.dispatchEvent(new HashChangeEvent('hashchange')); }}>
          <WalletCards size={16} /> {t('adminHolders.title')}
        </button>
        <button className="secondary-button admin-cross-link" type="button" onClick={() => { window.location.hash = '/admin-premium'; window.dispatchEvent(new HashChangeEvent('hashchange')); }}>
          <Crown size={16} /> {t('adminPremium.title')}
        </button>
        <button className="secondary-button admin-cross-link" type="button" onClick={() => { window.location.hash = '/admin-referral'; window.dispatchEvent(new HashChangeEvent('hashchange')); }}>
          <Gift size={16} /> {t('adminReferral.title')}
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

      {summary.userAnalytics && (
        <>
          <h3 className="analytics-section-heading">{t('adminAnalytics.userAnalyticsHeading')}</h3>
          {/* Every card below binds to the AUTHORITATIVE backend field. None of
              them is derived in the browser — in particular "Never Logged In"
              is read from the API, not computed as registered − loggedIn here.
              The frontend recomputing a complementary metric is how a UI ends
              up disagreeing with its own API: the two formulas drift, and the
              screen shows a number no endpoint ever returned. The server
              already guarantees the invariant and refuses to serve if it
              breaks, so the browser's job is to display, not to arithmetic. */}
          <div className="analytics-stat-grid">
            <StatCard
              icon={UserPlus}
              label={t('adminAnalytics.registeredUsers')}
              numericValue={summary.userAnalytics.registeredUsers}
              tooltip={t('adminAnalytics.tooltips.registeredUsers')}
            />
            <StatCard
              icon={User}
              label={t('adminAnalytics.newRegistrationsToday')}
              numericValue={summary.userAnalytics.registeredToday}
              tooltip={t('adminAnalytics.tooltips.newRegistrationsToday')}
            />
            {/* Renamed from "Logged In Visitors": the old label collided with a
                completely different metric further down this page (unique
                page-view sessions flagged as signed-in), so the same words
                showed two different numbers on one screen. */}
            <StatCard
              icon={Users}
              label={t('adminAnalytics.loggedInUsers')}
              numericValue={summary.userAnalytics.loggedInUsers}
              sublabel={t('adminAnalytics.loggedInUsersSub')}
              tooltip={t('adminAnalytics.tooltips.loggedInUsers')}
            />
            <StatCard
              icon={Lock}
              label={t('adminAnalytics.neverLoggedInUsers')}
              numericValue={summary.userAnalytics.neverLoggedInUsers}
              sublabel={t('adminAnalytics.neverLoggedInUsersSub')}
              tooltip={t('adminAnalytics.tooltips.neverLoggedInUsers')}
            />
            <StatCard
              icon={Activity}
              label={t('adminAnalytics.activeToday')}
              numericValue={summary.userAnalytics.activeToday}
              tooltip={t('adminAnalytics.tooltips.activeToday')}
            />
            <StatCard
              icon={CalendarClock}
              label={t('adminAnalytics.activeLast7Days')}
              numericValue={summary.userAnalytics.activeLast7Days}
              tooltip={t('adminAnalytics.tooltips.activeLast7Days')}
            />
            <StatCard
              icon={Users}
              label={t('adminAnalytics.returningUsers')}
              numericValue={summary.userAnalytics.returningUsers}
              sublabel={t('adminAnalytics.returningUsersSub')}
              tooltip={t('adminAnalytics.tooltips.returningUsers')}
            />
            <StatCard
              icon={BarChart3}
              label={t('adminAnalytics.avgScansPerUser')}
              numericValue={summary.userAnalytics.avgScansPerUser}
              sublabel={t('adminAnalytics.avgScansPerUserSub')}
              tooltip={t('adminAnalytics.tooltips.avgScansPerUser')}
            />
          </div>
          {/* States the invariant on screen. An administrator should be able to
              check the arithmetic without opening devtools — and if these ever
              stop adding up, the person looking at the dashboard is the one who
              needs to know first. */}
          <p className="analytics-invariant-note">
            {t('adminAnalytics.invariantNote', {
              registered: summary.userAnalytics.registeredUsers,
              loggedIn: summary.userAnalytics.loggedInUsers,
              never: summary.userAnalytics.neverLoggedInUsers,
            })}
          </p>
        </>
      )}

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
            {/* A DIFFERENT metric from "Logged In Users" above, despite the
                old shared label. This one counts unique browser VISITORS
                (keyed by visitorId from page views) whose latest page view was
                made while signed in — so one person on two devices is two, and
                a signed-in user who has not loaded a page recently is zero.
                Renamed to say so. */}
            <span>{t('adminAnalytics.signedInSessions')} <strong>{summary.visitorAnalytics.loggedInVisitors ?? 0}</strong></span>
            <span>{t('adminAnalytics.guestVisitors')} <strong>{summary.visitorAnalytics.guestVisitors ?? 0}</strong></span>
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

// ---------------------------------------------------------------------------
// KHAN Holder Analytics - admin-only. Every number/row comes straight from
// the on-chain indexer (see netlify/functions/_khanIndexer.mjs); there is no
// mock or estimated data path here except where explicitly labeled
// "Estimated" (historical USD conversions, where exact same-block pricing
// isn't available from a free API). Reuses the same shared admin token as
// every other admin page (AdminVerificationPage/AdminAnalyticsPage/etc).
// ---------------------------------------------------------------------------

function MultiLineChart({ series, height = 140 }) {
  const { t } = useTranslation();
  const allPoints = series.flatMap((s) => s.data);
  if (!allPoints.length) return <EmptyState title={t('adminHolders.noChartDataTitle')} text={t('adminHolders.noChartDataText')} />;
  const max = Math.max(1, ...allPoints.map((p) => p.y));
  const width = 100;
  return (
    <div className="holder-chart-wrap">
      <svg className="holder-line-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        {series.map((s) => {
          if (!s.data.length) return null;
          const stepX = width / Math.max(1, s.data.length - 1);
          const points = s.data.map((point, index) => `${(index * stepX).toFixed(2)},${(height - (point.y / max) * height).toFixed(2)}`).join(' ');
          return <polyline key={s.label} points={points} fill="none" stroke={s.color} strokeWidth="2" />;
        })}
      </svg>
      <div className="holder-chart-legend">
        {series.map((s) => (
          <span key={s.label}><i style={{ background: s.color }} /> {s.label}</span>
        ))}
      </div>
    </div>
  );
}

function holderRangeOptions(t) {
  return [
    { key: 'today', label: t('adminHolders.rangeToday') },
    { key: '24h', label: t('adminHolders.range24h') },
    { key: '7d', label: t('adminHolders.range7d') },
    { key: '30d', label: t('adminHolders.range30d') },
    { key: 'all', label: t('adminHolders.rangeAll') },
  ];
}

function alertTypeLabel(t, type) {
  const label = t(`adminHolders.alertTypes.${type}`);
  // translate() falls back to the raw key string when a type is unrecognized
  // (never undefined), so detect that fallback and show the raw type instead
  // of a dotted key path.
  return label.startsWith('adminHolders.alertTypes.') ? type : label;
}

function shortenWallet(wallet) {
  if (!wallet) return translate('common.notAvailable');
  return `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
}

function formatHolderNumber(value, fractionDigits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return translate('common.notAvailable');
  return Number(value).toLocaleString('en-US', { maximumFractionDigits: fractionDigits });
}

function formatUsd(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return translate('common.notAvailable');
  return `$${Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function formatDateTime(timestamp) {
  if (!timestamp) return { date: translate('common.notAvailable'), time: '' };
  const d = new Date(timestamp);
  return { date: d.toLocaleDateString(), time: d.toLocaleTimeString() };
}

function AdminHolderAnalyticsPage() {
  const { t } = useTranslation();
  const [token, setToken] = useState(() => getStoredAdminToken());
  const [passcode, setPasscode] = useState('');
  const [authState, setAuthState] = useState({ status: 'idle', message: '' });

  const [stats, setStats] = useState(null);
  const [holders, setHolders] = useState(null);
  const [transactions, setTransactions] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [loadState, setLoadState] = useState({ status: 'idle', message: '' });
  const [syncState, setSyncState] = useState({ status: 'idle', message: '' });

  const [search, setSearch] = useState('');
  const [range, setRange] = useState('all');
  const [txDirection, setTxDirection] = useState('all');
  const [holderPage, setHolderPage] = useState(1);
  const [txPage, setTxPage] = useState(1);

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
    setStats(null);
    setHolders(null);
    setTransactions(null);
  };

  const loadAll = async (activeToken) => {
    setLoadState({ status: 'loading', message: t('adminHolders.loadingHolders') });
    try {
      const [statsData, holdersData, txData] = await Promise.all([
        fetchHolderStats(activeToken),
        fetchHolders(activeToken, { search, range, page: holderPage, pageSize: 25 }),
        fetchTransactions(activeToken, { search, range, direction: txDirection, page: txPage, pageSize: 25 }),
      ]);
      setStats(statsData);
      setHolders(holdersData);
      setTransactions(txData);
      setLoadState({ status: 'idle', message: '' });
    } catch (error) {
      setLoadState({ status: 'error', message: error.message || t('adminHolders.loadFailed') });
    }
  };

  useEffect(() => {
    if (token) loadAll(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, search, range, txDirection, holderPage, txPage]);

  useEffect(() => {
    if (!token) return;
    const poll = async () => {
      try {
        const data = await fetchHolderAlerts(token, 30);
        setAlerts(data.alerts || []);
      } catch {
        // Alerts polling must never break the rest of the page.
      }
    };
    poll();
    const interval = setInterval(poll, 30000);
    return () => clearInterval(interval);
  }, [token]);

  const refreshNow = async () => {
    setSyncState({ status: 'loading', message: t('adminHolders.syncingOnChain') });
    try {
      const result = await triggerManualSync(token);
      setSyncState({
        status: 'idle',
        message: t('adminHolders.syncSummary', {
          count: result.processed,
          status: result.reachedHead ? t('adminHolders.syncUpToDate') : t('adminHolders.syncMoreHistory'),
        }),
      });
      await loadAll(token);
    } catch (error) {
      setSyncState({ status: 'error', message: error.message || t('adminHolders.syncFailed') });
    }
  };

  const exportHoldersCsv = () => {
    if (!holders) return;
    const yes = t('common.yes');
    const no = t('common.no');
    const rows = [[
      t('adminHolders.csvWallet'), t('adminHolders.csvCurrentBalance'), t('adminHolders.csvTotalBought'), t('adminHolders.csvTotalSold'),
      t('adminHolders.csvBuyTx'), t('adminHolders.csvSellTx'), t('adminHolders.csvFirstBuy'), t('adminHolders.csvLastActivity'),
      t('adminHolders.csvCurrentHolder'), t('adminHolders.csvSolSpent'), t('adminHolders.csvUsdSpent'), t('adminHolders.csvNetPosition'),
      t('adminHolders.csvRank'), t('adminHolders.csvWhale'),
    ]];
    holders.holders.forEach((h) => rows.push([
      h.wallet, h.currentBalance, h.totalBought, h.totalSold, h.buyCount, h.sellCount,
      h.firstBuyAt ? new Date(h.firstBuyAt).toISOString() : '', h.lastActivityAt ? new Date(h.lastActivityAt).toISOString() : '',
      h.isCurrentHolder ? yes : no, h.solSpent, h.usdSpentEstimate ?? '', h.netPosition, h.rank ?? '', h.isWhale ? yes : no,
    ]));
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    downloadAsFile(`khan-holders-${Date.now()}.csv`, csv, 'text/csv');
  };

  if (!token) {
    return (
      <section className="page-section">
        <SectionTitle icon={WalletCards} eyebrow={t('adminVerify.eyebrow')} title={t('adminHolders.title')} />
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

  if (loadState.status === 'loading' && !stats) {
    return (
      <section className="page-section">
        <SectionTitle icon={WalletCards} eyebrow={t('adminVerify.eyebrow')} title={t('adminHolders.title')} />
        <p className="lookup-message">{t('adminHolders.loadingHolders')}</p>
      </section>
    );
  }

  if (!stats) {
    return (
      <section className="page-section">
        <SectionTitle icon={WalletCards} eyebrow={t('adminVerify.eyebrow')} title={t('adminHolders.title')} />
        <p className="lookup-message error">{loadState.message || t('adminHolders.loadFailed')}</p>
        <button className="secondary-button" type="button" onClick={() => loadAll(token)}>{t('common.retry')}</button>
      </section>
    );
  }

  const s = stats.stats;
  const growthSeries = [
    { label: t('adminHolders.holderGrowthSeries'), color: 'var(--gold)', data: stats.charts.growth.map((p) => ({ y: p.holderCount })) },
    { label: t('adminHolders.buyerGrowthSeries'), color: 'var(--success)', data: stats.charts.growth.map((p) => ({ y: p.buyerCount })) },
    { label: t('adminHolders.walletGrowthSeries'), color: 'var(--gold-bright)', data: stats.charts.growth.map((p) => ({ y: p.walletCount })) },
  ];
  const volumeSeries = [
    { label: t('adminHolders.dailyBuyVolumeSeries'), color: 'var(--success)', data: stats.charts.dailyVolume.map((p) => ({ y: p.buyVolumeSol })) },
    { label: t('adminHolders.dailySellVolumeSeries'), color: 'var(--danger)', data: stats.charts.dailyVolume.map((p) => ({ y: p.sellVolumeSol })) },
  ];
  const distributionData = stats.charts.topHolderDistribution;

  return (
    <section className="page-section analytics-dashboard holder-analytics-dashboard">
      <SectionTitle icon={WalletCards} eyebrow={t('adminVerify.eyebrow')} title={t('adminHolders.title')} />
      <div className="analytics-toolbar">
        <button className="secondary-button" type="button" onClick={refreshNow} disabled={syncState.status === 'loading'}>
          <RefreshCw size={16} /> {t('adminHolders.refreshNow')}
        </button>
        <button className="secondary-button" type="button" onClick={exportHoldersCsv}><Download size={16} /> {t('adminHolders.exportHoldersCsv')}</button>
        <button className="secondary-button admin-cross-link" type="button" onClick={() => { window.location.hash = '/admin-analytics'; window.dispatchEvent(new HashChangeEvent('hashchange')); }}>
          <BarChart3 size={16} /> {t('adminHolders.platformAnalytics')}
        </button>
        <button className="ghost-button" type="button" onClick={logout}>{t('common.signOut')}</button>
      </div>
      {syncState.message && <p className={`lookup-message ${syncState.status === 'error' ? 'error' : ''}`}>{syncState.message}</p>}
      <p className="analytics-meta">
        {t('adminHolders.mintLabel')} <code>{OFFICIAL_KHAN_CONTRACT}</code> &middot; {t('adminHolders.khanUsdLabel')} {formatUsd(s.khanUsdPrice)} &middot; {t('adminHolders.solUsdLabel')} {formatUsd(stats.stats.solUsdPrice)} &middot; {t('adminHolders.totalSupplyLabel')} {formatHolderNumber(s.totalSupply, 0)}
      </p>

      <div className="analytics-stat-grid">
        <StatCard icon={Users} label={t('adminHolders.statTotalHolders')} numericValue={s.totalHolders} />
        <StatCard icon={WalletCards} label={t('adminHolders.statCurrentHolders')} numericValue={s.currentHolders} />
        <StatCard icon={TrendingUp} label={t('adminHolders.statUniqueBuyers')} numericValue={s.uniqueBuyers} />
        <StatCard icon={TrendingDown} label={t('adminHolders.statUniqueSellers')} numericValue={s.uniqueSellers} />
        <StatCard icon={UserPlus} label={t('adminHolders.statTodaysBuyers')} numericValue={s.todaysBuyers} />
        <StatCard icon={UserPlus} label={t('adminHolders.statTodaysHolders')} numericValue={s.todaysHolders} />
        <StatCard icon={Crown} label={t('adminHolders.statLargestBuyToday')} value={`${formatHolderNumber(s.largestBuyTodaySol)} SOL`} />
        <StatCard icon={Crown} label={t('adminHolders.statLargestHolder')} value={formatHolderNumber(s.largestHolderBalance, 0)} sublabel={t('adminHolders.khanUnit')} />
        <StatCard icon={Activity} label={t('adminHolders.statAverageBuy')} value={`${formatHolderNumber(s.averageBuySol)} SOL`} />
        <StatCard icon={Activity} label={t('adminHolders.statAverageHolding')} value={formatHolderNumber(s.averageHolding, 0)} sublabel={t('adminHolders.khanUnit')} />
        <StatCard icon={TrendingUp} label={t('adminHolders.statTotalBuyVolume')} value={`${formatHolderNumber(s.totalBuyVolumeSol)} SOL`} />
        <StatCard icon={TrendingDown} label={t('adminHolders.statTotalSellVolume')} value={`${formatHolderNumber(s.totalSellVolumeSol)} SOL`} />
        <StatCard icon={Activity} label={t('adminHolders.statNetBuyVolume')} value={`${formatHolderNumber(s.netBuyVolumeSol)} SOL`} />
      </div>

      <div className="detail-section analytics-section">
        <SectionTitle icon={Bell} eyebrow={t('adminHolders.alertsEyebrow')} title={t('adminHolders.alertsTitle')} />
        {!alerts.length ? (
          <EmptyState title={t('adminHolders.noAlertsTitle')} text={t('adminHolders.noAlertsText')} />
        ) : (
          <ul className="holder-alert-list">
            {alerts.map((alert) => (
              <li key={alert.id} className="holder-alert-item">
                <AlertTriangle size={14} />
                <span className="holder-alert-type">{alertTypeLabel(t, alert.type)}</span>
                {alert.wallet && <code>{shortenWallet(alert.wallet)}</code>}
                {alert.amount !== null && alert.amount !== undefined && <span>{formatHolderNumber(alert.amount)}</span>}
                <span className="holder-alert-time">{alert.createdAt ? new Date(alert.createdAt).toLocaleString() : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="detail-section analytics-section analytics-grid-2">
        <div>
          <h4>{t('adminHolders.growthChartTitle')}</h4>
          <MultiLineChart series={growthSeries} />
        </div>
        <div>
          <h4>{t('adminHolders.volumeChartTitle')}</h4>
          <MultiLineChart series={volumeSeries} />
        </div>
      </div>

      <div className="detail-section analytics-section">
        <h4>{t('adminHolders.distributionTitle')}</h4>
        <DonutChart data={distributionData} />
      </div>

      <div className="detail-section analytics-section">
        <SectionTitle icon={ListFilter} eyebrow={t('adminHolders.filtersEyebrow')} title={t('adminHolders.filtersTitle')} />
        <div className="holder-filter-row">
          <input
            className="holder-search-input"
            type="text"
            placeholder={t('adminHolders.searchPlaceholder')}
            value={search}
            onChange={(event) => { setSearch(event.target.value); setHolderPage(1); setTxPage(1); }}
          />
          <div className="analytics-range-row">
            {holderRangeOptions(t).map((option) => (
              <button key={option.key} className={range === option.key ? 'active' : ''} onClick={() => { setRange(option.key); setHolderPage(1); setTxPage(1); }}>
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="detail-section analytics-section">
        <h4>{t('adminHolders.holdersTitle', { count: holders?.total ?? 0 })}</h4>
        {!holders?.holders?.length ? (
          <EmptyState title={t('adminHolders.noHoldersTitle')} text={t('adminHolders.noHoldersText')} />
        ) : (
          <table className="analytics-table holder-table">
            <thead>
              <tr>
                <th>{t('adminHolders.columns.rank')}</th><th>{t('adminHolders.columns.wallet')}</th><th>{t('adminHolders.columns.balance')}</th><th>{t('adminHolders.columns.portfolioPercent')}</th><th>{t('adminHolders.columns.estValue')}</th>
                <th>{t('adminHolders.columns.totalBought')}</th><th>{t('adminHolders.columns.buys')}</th><th>{t('adminHolders.columns.sells')}</th><th>{t('adminHolders.columns.net')}</th><th>{t('adminHolders.columns.whale')}</th><th>{t('adminHolders.columns.firstBuy')}</th><th>{t('adminHolders.columns.lastActivity')}</th><th>{t('adminHolders.columns.holder')}</th>
              </tr>
            </thead>
            <tbody>
              {holders.holders.map((h) => (
                <tr key={h.wallet}>
                  <td>{h.rank ?? t('common.notAvailable')}</td>
                  <td><code title={h.wallet}>{h.shortWallet}</code></td>
                  <td>{formatHolderNumber(h.currentBalance, 0)}</td>
                  <td>{h.portfolioPercent !== null ? `${formatHolderNumber(h.portfolioPercent)}%` : t('common.notAvailable')}</td>
                  <td>{formatUsd(h.estimatedValueUsd)}</td>
                  <td>{formatHolderNumber(h.totalBought, 0)}</td>
                  <td>{h.buyCount}</td>
                  <td>{h.sellCount}</td>
                  <td>{formatHolderNumber(h.netPosition, 0)}</td>
                  <td>{h.isWhale ? <Crown size={14} /> : ''}</td>
                  <td>{h.firstBuyAt ? new Date(h.firstBuyAt).toLocaleDateString() : t('common.notAvailable')}</td>
                  <td>{h.lastActivityAt ? new Date(h.lastActivityAt).toLocaleDateString() : t('common.notAvailable')}</td>
                  <td>{h.isCurrentHolder ? t('common.yes') : t('common.no')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="holder-pagination">
          <button className="secondary-button" type="button" disabled={holderPage <= 1} onClick={() => setHolderPage((p) => Math.max(1, p - 1))}>{t('adminHolders.previous')}</button>
          <span>{t('adminHolders.pageLabel', { page: holders?.page ?? 1 })}</span>
          <button className="secondary-button" type="button" disabled={!holders || holderPage * 25 >= holders.total} onClick={() => setHolderPage((p) => p + 1)}>{t('adminHolders.next')}</button>
        </div>
      </div>

      <div className="detail-section analytics-section">
        <h4>{t('adminHolders.transactionsTitle', { count: transactions?.total ?? 0 })}</h4>
        <div className="analytics-range-row">
          {[
            { key: 'all', label: t('adminHolders.directionAll') },
            { key: 'buy', label: t('adminHolders.directionBuy') },
            { key: 'sell', label: t('adminHolders.directionSell') },
          ].map((option) => (
            <button key={option.key} className={txDirection === option.key ? 'active' : ''} onClick={() => { setTxDirection(option.key); setTxPage(1); }}>
              {option.label}
            </button>
          ))}
        </div>
        {!transactions?.transactions?.length ? (
          <EmptyState title={t('adminHolders.noTransactionsTitle')} text={t('adminHolders.noTransactionsText')} />
        ) : (
          <table className="analytics-table holder-table">
            <thead>
              <tr>
                <th>{t('adminHolders.columns.date')}</th><th>{t('adminHolders.columns.time')}</th><th>{t('adminHolders.columns.wallet')}</th><th>{t('adminHolders.columns.direction')}</th><th>{t('adminHolders.columns.khan')}</th><th>{t('adminHolders.columns.sol')}</th><th>{t('adminHolders.columns.estUsd')}</th><th>{t('adminHolders.columns.currentBalance')}</th><th>{t('adminHolders.columns.holder')}</th><th>{t('adminHolders.columns.signature')}</th><th>{t('adminHolders.columns.links')}</th>
              </tr>
            </thead>
            <tbody>
              {transactions.transactions.map((tx) => {
                const { date, time } = formatDateTime(tx.blockTime);
                return (
                  <tr key={`${tx.signature}-${tx.wallet}-${tx.direction}`}>
                    <td>{date}</td>
                    <td>{time}</td>
                    <td><code title={tx.wallet}>{shortenWallet(tx.wallet)}</code></td>
                    <td>{tx.direction === 'buy' ? <span className="trend-up">{t('adminHolders.buyLabel')}</span> : <span className="trend-down">{t('adminHolders.sellLabel')}</span>}</td>
                    <td>{formatHolderNumber(tx.khanAmount, 0)}</td>
                    <td>{formatHolderNumber(tx.solAmount)}</td>
                    <td>{tx.usdEstimate !== null ? `${formatUsd(tx.usdEstimate)} ${t('adminHolders.estimatedSuffix')}` : t('common.notAvailable')}</td>
                    <td>{formatHolderNumber(tx.currentBalance, 0)}</td>
                    <td>{tx.isCurrentHolder ? t('common.yes') : t('common.no')}</td>
                    <td><code title={tx.signature}>{tx.signature ? `${tx.signature.slice(0, 8)}...` : t('common.notAvailable')}</code></td>
                    <td>
                      {tx.solscanUrl && <a href={tx.solscanUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> {t('adminHolders.solscanLink')}</a>}
                      {' '}
                      {tx.pumpFunUrl && <a href={tx.pumpFunUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> {t('adminHolders.pumpFunLink')}</a>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className="holder-pagination">
          <button className="secondary-button" type="button" disabled={txPage <= 1} onClick={() => setTxPage((p) => Math.max(1, p - 1))}>{t('adminHolders.previous')}</button>
          <span>{t('adminHolders.pageLabel', { page: transactions?.page ?? 1 })}</span>
          <button className="secondary-button" type="button" disabled={!transactions || txPage * 25 >= transactions.total} onClick={() => setTxPage((p) => p + 1)}>{t('adminHolders.next')}</button>
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
    // A count-up is motion like any other: under prefers-reduced-motion the
    // number is simply the number. CSS cannot reach a rAF loop, so this has to
    // be checked here.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
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

// Phase 1 — Score Memory: small trend line + one-line delta under the score
// on the main Token Report page. Renders nothing until there's at least two
// days of real history to compare - a single dot isn't a trend, so it stays
// silent rather than showing a misleading flat line. `history` is fetched
// once at the page level (see useScoreHistory) and shared with the Ask KHAN
// analyst below, rather than each component fetching its own copy.
function ScoreHistoryStrip({ project, history }) {
  const { t } = useTranslation();
  const { can, openUpgrade } = usePremiumGate();
  // The sparkline and delta plot only VALID snapshots — a demo/outage point
  // would otherwise draw a phantom dip the numbers below never explain.
  const valid = useMemo(() => validHistory(history), [history]);
  const delta = computeScoreDelta(valid, project.trustScore);
  const sparkData = valid.length >= 2 ? valid.map((entry) => ({ count: entry.score })) : null;

  // Trust Score History is Premium, and score-history-get now refuses a free
  // caller, so `history` arrives empty and the component would silently render
  // nothing at all. Nothing is the wrong answer: the user cannot tell "this
  // token has no history yet" apart from "this is a paid feature", and a
  // feature nobody knows exists sells nothing. So a free user gets a compact
  // crowned teaser in the same slot instead — the full-size PremiumLock overlay
  // would dwarf the score card this sits inside.
  if (!can('scoreHistory')) {
    return (
      <button
        type="button"
        className="score-history-strip score-history-locked"
        onClick={() => openUpgrade('scoreHistory')}
        aria-label={t('premiumGate.unlockAria', { feature: t('features.scoreHistory') })}
      >
        <PremiumCrown size={12} />
        <span>{t('features.scoreHistory')}</span>
      </button>
    );
  }

  if (!sparkData && !delta) return null;

  return (
    <div className="score-history-strip">
      {sparkData && <Sparkline data={sparkData} color="var(--gold)" height={28} />}
      {delta && (
        <span className={`score-delta ${delta.delta > 0 ? 'up' : delta.delta < 0 ? 'down' : 'flat'}`}>
          {delta.delta > 0 ? '+' : ''}{delta.delta} {t(`scoreHistory.${delta.label}`)}
        </span>
      )}
    </div>
  );
}

// Phase 5 — Smart Risk History timeline. Renders the derived change events
// (buildRiskHistory, riskHistory.js) as a premium black/gold timeline: each
// entry shows the date, the Trust Score prev->new transition, any risk-level
// change, an AI explanation of what moved, and the individual prev->current
// deltas. Reuses the `history` already fetched at the page level (useScoreHistory)
// so it adds no network calls. Stays silent until there is real drift to show,
// exactly like ScoreHistoryStrip - a token scanned once never renders an empty
// shell. Never throws: it only reads already-loaded snapshot data.
function RiskHistoryTimeline({ history }) {
  const { t, language } = useTranslation();
  const events = useMemo(() => buildRiskHistory(history, language), [history, language]);

  // Nothing meaningful to show yet - render the section with a gentle empty
  // state only if we at least have one VALID observation being tracked;
  // otherwise stay fully silent so a token with only demo/thin snapshots (or a
  // brand-new one) doesn't show a hollow module.
  const hasAnyHistory = validHistory(history).length >= 1;
  if (!hasAnyHistory) return null;

  return (
    <section className="detail-section risk-history">
      <SectionTitle icon={History} eyebrow={t('riskHistory.eyebrow')} title={t('riskHistory.title')} />
      <p className="risk-history-subtitle">{t('riskHistory.subtitle')}</p>

      {events.length === 0 ? (
        <p className="risk-history-empty">{t('riskHistory.empty')}</p>
      ) : (
        <ol className="risk-history-list">
          {events.map((event) => {
            const dir = event.worse ? 'down' : (typeof event.scoreDelta === 'number' && event.scoreDelta > 0 ? 'up' : 'flat');
            const dateLabel = formatHistoryDate(event.date, language);
            return (
              <li key={event.date} className={`risk-history-item ${dir}`}>
                <div className="risk-history-marker" aria-hidden="true" />
                <div className="risk-history-body">
                  <div className="risk-history-head">
                    <span className="risk-history-date">{dateLabel}</span>
                    {typeof event.previousScore === 'number' && typeof event.newScore === 'number' && (
                      <span className={`risk-history-score ${dir}`}>
                        {dir === 'down' ? <TrendingDown size={15} /> : dir === 'up' ? <TrendingUp size={15} /> : null}
                        <strong>{event.previousScore}</strong>
                        <ArrowRight size={13} />
                        <strong>{event.newScore}</strong>
                      </span>
                    )}
                    {event.riskChange && (
                      <span className={`risk-history-risk ${event.riskChange.worse ? 'down' : 'up'}`}>
                        {t('riskHistory.riskLabel')}: {t(`common.${String(event.riskChange.previous).toLowerCase()}`)}
                        {' '}<ArrowRight size={11} />{' '}
                        {t(`common.${String(event.riskChange.current).toLowerCase()}`)}
                      </span>
                    )}
                  </div>
                  <p className="risk-history-explanation">{event.explanation}</p>
                  {event.changes.some((change) => CHIP_DIMENSIONS.has(change.key)) && (
                    <div className="risk-history-chips">
                      {event.changes
                        .filter((change) => CHIP_DIMENSIONS.has(change.key) && typeof change.previous === 'number' && typeof change.current === 'number')
                        .map((change) => (
                          <span key={change.key} className={`risk-history-chip ${change.worse ? 'worse' : 'better'}`}>
                            {chipLabelFor(change.key, t)}
                            {' '}{Math.round(change.previous)} <ArrowRight size={10} /> {Math.round(change.current)}
                          </span>
                        ))}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

// Only 0-100 score dimensions become "prev -> current" chips; liquidity (shown
// as a % in the explanation) and holder concentration (a % of supply, not a
// score) would be misleading as chips, so they stay in the explanation text.
const CHIP_DIMENSIONS = new Set(['trustScore', 'contractSecurity', 'holderHealth', 'marketActivity', 'community', 'social']);

// Localized, compact chip label for a changed score dimension. Falls back to
// the raw key if a translation is somehow missing so a chip never renders blank.
function chipLabelFor(key, t) {
  const map = {
    trustScore: 'riskReport.trustScoreLabel',
    contractSecurity: 'profileSections.categoryLabels.contractSecurity',
    holderHealth: 'profileSections.categoryLabels.holderHealth',
    marketActivity: 'profileSections.categoryLabels.marketActivity',
    community: 'profileSections.categoryLabels.community',
    social: 'compare.rows.socialScore',
  };
  const translationKey = map[key];
  if (!translationKey) return key;
  const label = t(translationKey);
  return label === translationKey ? key : label;
}

function formatHistoryDate(dateStr, language) {
  try {
    const date = new Date(`${dateStr}T00:00:00`);
    if (Number.isNaN(date.getTime())) return dateStr;
    const locale = { en: 'en-US', az: 'az-AZ', tr: 'tr-TR', ru: 'ru-RU' }[language] || 'en-US';
    return date.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
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

// Plain empty state. Deliberately assistant-free: this is what the Admin Panel
// and other internal surfaces use, and KHAN AI must never appear there. The
// user-facing pages use KhanAiEmptyState below instead.
function EmptyState({ title, text }) {
  return (
    <div className="empty-state">
      <Eye size={28} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

// KHAN AI's resting posture, for user-facing pages only: the entity is present
// and watching, with copy that invites the first scan rather than apologising
// for an absence. Kept as a separate component from EmptyState so that adding
// an empty state to the Admin Panel can never accidentally summon the
// assistant into it.
function KhanAiEmptyState({ title, text }) {
  return <KhanAiPanel tone="idle" title={title} text={text} />;
}

function Disclaimer({ compact = false, text }) {
  // The fallback goes through t('disclaimer.default'), NOT an inline English
  // literal. It was a literal, which meant every caller that did not pass
  // `text` — the pricing page among them — rendered an English legal
  // disclaimer inside an Azerbaijani, Turkish or Russian page. The key already
  // existed and was already translated in all four dictionaries; nothing was
  // reaching it.
  const { t } = useTranslation();
  return (
    <section className={compact ? 'disclaimer compact' : 'disclaimer'}>
      <AlertTriangle size={18} />
      <p>{text || t('disclaimer.default')}</p>
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
    { icon: X, label: t('contact.xLabel'), value: t('contact.xValue'), href: 'https://x.com/KhanPortall' },
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
        {myTickets && !myTickets.length && <KhanAiEmptyState title={t('support.history.emptyTitle')} text={t('support.history.emptyText')} />}
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

// Client-side mirror of the server's cooldown (see
// netlify/functions/auth-resend-verification.mjs) - starts the countdown
// immediately on send/429 without waiting on a round trip, and stops a user
// from firing several requests before the first response even comes back.
const VERIFICATION_RESEND_COOLDOWN_S = 60;

// "Send verification email" / "Resend verification email" control, shared by
// the header dropdown and the Profile page so there is exactly one place
// that knows how to trigger + rate-limit this action.
function EmailVerificationAction({ compact = false }) {
  const { resendVerificationEmail } = useAuth();
  const { t } = useTranslation();
  const [state, setState] = useState({ status: 'idle', message: '' }); // idle | sending | sent | error
  const [cooldown, setCooldown] = useState(0);
  const busy = state.status === 'sending';

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown > 0]);

  const send = async () => {
    if (busy || cooldown > 0) return;
    setState({ status: 'sending', message: '' });
    try {
      const result = await resendVerificationEmail();
      setState({ status: 'sent', message: result.message || t('userProfile.verification.sentDefaultMessage') });
      setCooldown(VERIFICATION_RESEND_COOLDOWN_S);
    } catch (err) {
      setState({ status: 'error', message: err.message || t('userProfile.verification.errorDefaultMessage') });
      if (err.status === 429) setCooldown(VERIFICATION_RESEND_COOLDOWN_S);
    }
  };

  const label = busy
    ? t('userProfile.verification.sendingButton')
    : cooldown > 0
      ? t('userProfile.verification.resendCountdown', { seconds: cooldown })
      : state.status === 'sent'
        ? t('userProfile.verification.resendButton')
        : t('userProfile.verification.sendButton');

  return (
    <div className={compact ? 'email-verify-action compact' : 'email-verify-action'}>
      <button type="button" className="email-verify-btn" onClick={send} disabled={busy || cooldown > 0}>
        {label}
      </button>
      {state.message && (
        <p className={`email-verify-message ${state.status === 'error' ? 'error' : 'success'}`}>{state.message}</p>
      )}
    </div>
  );
}

// ── Auth nav button shown in Header and MobileNav ──────────────────────────
function AuthNavButton({ navigate, navTo, onOpenAuth, variant = 'desktop' }) {
  const { user, logout } = useAuth();
  const { entitlement } = usePremiumEntitlement();
  const go = navTo || navigate; // navTo applies gating; fall back if not provided
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  if (!user) {
    if (variant === 'mobile') {
      return (
        <button className="mobile-nav-auth-btn" onClick={onOpenAuth}>
          <User size={18} />
          <span>{t('common.signIn')}</span>
        </button>
      );
    }
    return (
      <button className="auth-nav-signin-btn" onClick={onOpenAuth}>
        <User size={15} /> {t('common.signIn')}
      </button>
    );
  }

  const initial = (user.name || user.email || '?')[0].toUpperCase();
  if (variant === 'mobile') {
    return (
      <button className={`mobile-nav-auth-btn ${menuOpen ? 'active' : ''}`} onClick={() => go('profile')}>
        {user.avatarUrl
          ? <img src={user.avatarUrl} alt={user.name} className="auth-avatar-small" />
          : <span className="auth-avatar-small">{initial}</span>
        }
        <span>{user.name?.split(' ')[0] || t('userProfile.title')}</span>
      </button>
    );
  }

  return (
    <div className="auth-nav-user" ref={ref}>
      <button className="auth-nav-user-btn" onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen}>
        {user.avatarUrl
          ? <img src={user.avatarUrl} alt={user.name} className="auth-avatar" />
          : <span className="auth-avatar">{initial}</span>
        }
        <span className="auth-nav-username">{user.name?.split(' ')[0] || t('userProfile.title')}</span>
        <ChevronDown size={13} />
      </button>
      {menuOpen && (
        <div className="auth-nav-dropdown">
          <div className="auth-nav-dropdown-header">
            <strong>{user.name}</strong>
            <small>{user.email}</small>
            <AccountBadge entitlement={entitlement} compact />
            {user.emailVerified
              ? <span className="auth-verified-badge">{t('userProfile.emailVerified')}</span>
              : (
                <>
                  <span className="auth-unverified-badge">{t('userProfile.emailNotVerified')}</span>
                  <EmailVerificationAction compact />
                </>
              )}
          </div>
          <button onClick={() => { setMenuOpen(false); go('profile'); }}>
            <User size={14} /> {t('userProfile.title')}
          </button>
          <button onClick={() => { setMenuOpen(false); logout(); }}>
            <X size={14} /> {t('userProfile.signOut')}
          </button>
        </div>
      )}
    </div>
  );
}

// Small fixed-position notification, auto-dismissing - used for profile save
// feedback instead of the plain inline message every other form on this page
// still uses, per the "toast" requirement for this page specifically.
function ProfileToast({ toast, onDismiss }) {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  if (!toast) return null;
  return (
    <div className={`profile-toast ${toast.tone}`} role="status">
      {toast.tone === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
      <span>{toast.message}</span>
    </div>
  );
}

const ALLOWED_AVATAR_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_AVATAR_UPLOAD_BYTES = 8 * 1024 * 1024; // raw upload cap, before resize
const AVATAR_OUTPUT_SIZE = 256;

function validateAvatarFile(file) {
  if (!ALLOWED_AVATAR_TYPES.has(file.type)) {
    throw new Error(translate('userProfile.avatar.errors.invalidType'));
  }
  if (file.size > MAX_AVATAR_UPLOAD_BYTES) {
    throw new Error(translate('userProfile.avatar.errors.tooLarge'));
  }
}

// Center-crops to a square and downsamples to AVATAR_OUTPUT_SIZE, then
// re-encodes as JPEG - keeps the stored avatar small (typically a few KB to
// a few tens of KB) regardless of how large the original photo was, since it
// ends up stored inline as a data: URL on the user record (see
// netlify/functions/auth-profile-update.mjs).
function resizeAvatarFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(translate('userProfile.avatar.errors.readFileFailed')));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error(translate('userProfile.avatar.errors.readImageFailed')));
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        const canvas = document.createElement('canvas');
        canvas.width = AVATAR_OUTPUT_SIZE;
        canvas.height = AVATAR_OUTPUT_SIZE;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Premium profile indicators: current plan, status, source, expiration, and
// Lifetime / Early Supporter recognition. Derived entirely from the merged
// entitlement (describeEntitlement) - no separate source of truth.
function PremiumProfilePanel({ entitlement }) {
  const { t } = useTranslation();
  const d = describeEntitlement(entitlement);

  if (!d) {
    return (
      <div className="profile-premium-panel">
        <div className="profile-premium-row">
          <span>{t('accountPlan.currentPlan')}</span>
          <strong>{t('accountPlan.plans.free')}</strong>
        </div>
        <p className="inline-note">{t('accountPlan.freeNote')}</p>
      </div>
    );
  }

  const planLabel = d.isEarlySupporter ? t('accountPlan.plans.early_supporter') : t('accountPlan.plans.premium');
  const sourceKey = d.reason === 'partner' || d.reason === 'investor' ? d.reason : d.source;
  const expirationValue = d.isLifetime
    ? t('accountPlan.lifetimePremium')
    : d.expiresAt
      ? new Date(d.expiresAt).toLocaleDateString()
      : t('accountPlan.noExpiration');

  return (
    <div className="profile-premium-panel active">
      <div className="profile-premium-head">
        <AccountBadge entitlement={entitlement} />
        {d.isEarlySupporter && <span className="lifetime-pill">👑 {t('accountPlan.earlySupporterRecognition')}</span>}
        {d.isLifetime && !d.isEarlySupporter && <span className="lifetime-pill">{t('accountPlan.lifetimeMember')}</span>}
      </div>
      <div className="profile-premium-grid">
        <div className="profile-premium-row"><span>{t('accountPlan.currentPlan')}</span><strong>{planLabel}</strong></div>
        <div className="profile-premium-row"><span>{t('accountPlan.premiumStatus')}</span><strong>{t(`accountPlan.status.${d.status}`)}</strong></div>
        <div className="profile-premium-row"><span>{t('accountPlan.premiumSource')}</span><strong>{t(`accountPlan.sources.${sourceKey}`)}</strong></div>
        <div className="profile-premium-row"><span>{t('accountPlan.expiration')}</span><strong>{expirationValue}</strong></div>
      </div>
    </div>
  );
}

// ── Referral & Invite Page (signed-in users) ──────────────────────────────────
//
// Every registered user gets a permanent invite link the moment they open this
// page (the server mints a code on first read). The funnel counts come straight
// from the referral edges the auth/verify/login/payment hooks stamp, so nothing
// here is fabricated — an empty state is a real zero, never a placeholder.
const REFERRAL_FUNNEL_STAGES = [
  { key: 'clicks', icon: MousePointerClick },
  { key: 'signups', icon: UserPlus },
  { key: 'verified', icon: CheckCircle2 },
  { key: 'active', icon: Activity },
  { key: 'premium', icon: Crown },
  { key: 'lifetime', icon: Star },
];

const REFERRAL_STATUS_TONE = {
  registered: 'neutral',
  verified: 'info',
  active: 'info',
  premium: 'gold',
  lifetime: 'gold',
};

function ReferralStatusBadge({ status }) {
  const { t } = useTranslation();
  const tone = REFERRAL_STATUS_TONE[status] || 'neutral';
  return <span className={`referral-status referral-status-${tone}`}>{t(`referral.statusLabels.${status}`)}</span>;
}

// ── Watchtower Report ────────────────────────────────────────────────────────
//
// The premium monitoring surface: what the re-scan worker observed across the
// user's watched projects while they were away.
//
// THE FREE/PREMIUM SPLIT IS "SHOW THE WORK, GATE THE FINDINGS".
//
// Everyone sees the coverage panel — the eight dimensions checked, the number of
// observation cycles run — and the COUNT of changes detected. Premium unlocks
// which project changed, what moved, and why. That is deliberate: a free user
// who watches the monitoring happen and is told "1 important change was
// detected" has experienced the value before being asked to pay for it. Gating
// the coverage panel too would leave nothing to sell.
//
// EVERY DIMENSION IN THE COVERAGE PANEL IS REAL. The list comes from
// MONITORED_DIMENSIONS in src/watchtower.js, which may only contain signals
// _volatileSignals.mjs actually fetches. A decorative checkmark next to
// something never checked would make this panel a lie, on the one page whose
// entire job is to prove the product does what it promises.
function WatchtowerCoveragePanel({ coverage, plan }) {
  const { t } = useTranslation();
  // The cadence line is what makes the tier concrete: "checked every 30
  // minutes" is a fact about this account, where "continuous monitoring" is
  // marketing. A free reader also sees what Premium would change.
  const cadence = describeCadence(plan?.observeIntervalMs);
  return (
    <div className="watchtower-coverage">
      <h3>{t('watchtower.coverageTitle')}</h3>
      <ul className="watchtower-dimensions">
        {MONITORED_DIMENSIONS.map(({ key }) => (
          <li key={key}>
            <Check size={14} aria-hidden="true" />
            <span>{t(`watchtower.dimensions.${key}`)}</span>
          </li>
        ))}
      </ul>
      {cadence && (
        <p className="watchtower-cadence">
          {t('watchtower.cadence', { count: cadence.count, unit: t('watchtower.units.' + cadence.unit, { count: cadence.count }) })}
          {plan?.tier === 'free' && (
            <span className="watchtower-cadence-upsell"> {t('watchtower.cadenceUpsell')}</span>
          )}
        </p>
      )}
      <p className="watchtower-coverage-line">
        {/* Absence of ledger data is reported as unknown, never as zero cycles —
            claiming "0 observations" would defame a worker that was running. */}
        {coverage?.known
          ? t('watchtower.coverageLine', {
              cycles: formatNumber(coverage.cycles),
              observations: formatNumber(coverage.observations),
            })
          : t('watchtower.coverageUnknown')}
      </p>
      {coverage?.known && coverage.declined > 0 && (
        <p className="watchtower-coverage-note">
          {t('watchtower.coverageDeclined', { declined: formatNumber(coverage.declined) })}
        </p>
      )}
    </div>
  );
}

function WatchtowerTokenRow({ entry, navigate }) {
  const { t, language } = useTranslation();
  const tone = STATUS_TONE[entry.status] || 'neutral';
  const hint = t(`watchtower.statusHint.${entry.status}`);
  // statusHint only exists for the three states that need explaining; t()
  // returns the key itself when unmapped, which must not render as text.
  const hintText = hint.startsWith('watchtower.') ? '' : hint;

  return (
    <li className={`watchtower-row watchtower-row-${tone}`}>
      <div className="watchtower-row-head">
        <button
          type="button"
          className="watchtower-row-name"
          onClick={() => navigate(`project/${encodeURIComponent(entry.identity)}`)}
        >
          {entry.name}
          {entry.ticker && <span className="watchtower-row-ticker">{entry.ticker}</span>}
        </button>
        <span className={`watchtower-status watchtower-status-${tone}`}>
          {t(`watchtower.status.${entry.status}`)}
        </span>
      </div>

      {entry.score !== null && (
        <p className="watchtower-row-score">
          {t('watchtower.scoreLine', {
            score: entry.score,
            risk: t(`common.${String(entry.riskLevel || 'medium').toLowerCase()}`),
          })}
          {typeof entry.previousScore === 'number' && entry.previousScore !== entry.score && (
            <span className="watchtower-row-prev"> · {t('watchtower.scoreFrom', { score: entry.previousScore })}</span>
          )}
        </p>
      )}

      {entry.reasons?.length > 0 && (
        <ul className="watchtower-reasons">
          {entry.reasons.map((reason, index) => (
            <li key={`${reason.code}-${index}`}>{describeReason(reason, language)}</li>
          ))}
        </ul>
      )}

      {hintText && <p className="watchtower-row-hint">{hintText}</p>}
    </li>
  );
}

// The Premium teaser. Shown to free users INSTEAD of the token list, never
// instead of the coverage panel. It states the true number of detected changes
// and withholds only which and why — an honest cliffhanger rather than a
// manufactured one.
function WatchtowerPremiumLock({ changeCount, navigate }) {
  const { t } = useTranslation();
  const items = t('watchtower.lockItems');
  return (
    <div className="watchtower-lock">
      <div className="watchtower-lock-head">
        <Lock size={16} aria-hidden="true" />
        <h3>{t('watchtower.lockTitle')}</h3>
      </div>
      <p className="watchtower-lock-text">
        {changeCount > 0
          ? t(changeCount === 1 ? 'watchtower.lockText' : 'watchtower.lockText_plural', { count: changeCount })
          : t('watchtower.lockTextClear')}
      </p>
      <ul className="watchtower-lock-items">
        {(Array.isArray(items) ? items : []).map((item) => (
          <li key={item}><Check size={13} aria-hidden="true" /> {item}</li>
        ))}
      </ul>
      <button type="button" className="btn-primary" onClick={() => navigate('pricing')}>
        {t('watchtower.lockCta')}
      </button>
    </div>
  );
}

function WatchtowerPage({ navigate, onOpenAuth }) {
  const { user } = useAuth();
  const { t, language } = useTranslation();
  const { hasPremium } = usePremiumEntitlement();
  const { loading, report, plan, reason, reload } = useWatchtowerReport(Boolean(user));
  const dateLocale = PDF_LOCALE_MAP[language] || 'en-US';

  const formatDay = (iso) => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString(dateLocale, { month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  };

  if (!user) {
    return (
      <section className="page-section">
        <SectionTitle icon={ShieldCheck} eyebrow={t('watchtower.eyebrow')} title={t('watchtower.title')} />
        <div className="watchtower-panel">
          <h3>{t('watchtower.signedOutTitle')}</h3>
          <p>{t('watchtower.signedOutText')}</p>
          <button type="button" className="btn-primary" onClick={onOpenAuth}>{t('common.signIn')}</button>
        </div>
      </section>
    );
  }

  const summary = report?.summary;
  // The count the free teaser advertises. Critical + worsened + improved is
  // every token whose state actually MOVED — the honest answer to "how much
  // happened", not an inflated one.
  const changeCount = summary
    ? summary.needsAttention + summary.improved
    : 0;

  return (
    <section className="page-section watchtower-page">
      <SectionTitle icon={ShieldCheck} eyebrow={t('watchtower.eyebrow')} title={t('watchtower.title')} />
      <p className="watchtower-subtitle">{t('watchtower.subtitle')}</p>

      {loading && <div className="watchtower-panel"><p>{t('common.loading')}</p></div>}

      {!loading && reason === 'unavailable' && (
        <div className="watchtower-panel">
          <h3>{t('watchtower.errorTitle')}</h3>
          {/* Says explicitly that monitoring is unaffected: a blank report must
              never be mistaken for "all clear", nor for monitoring having stopped. */}
          <p>{t('watchtower.errorText')}</p>
          <button type="button" className="btn-secondary" onClick={reload}>{t('watchtower.retry')}</button>
        </div>
      )}

      {!loading && report && (
        <>
          <div className="watchtower-header">
            <p className="watchtower-period">
              {t('watchtower.periodLabel')}: {formatDay(report.period.start)} – {formatDay(report.period.end)}
            </p>
            <button type="button" className="btn-secondary btn-small" onClick={reload}>
              {t('watchtower.refresh')}
            </button>
          </div>

          <p className={`watchtower-headline watchtower-headline-${summary.headlineKey}`}>
            {t(
              summary.headlineKey === 'critical' || summary.headlineKey === 'attention'
                ? (summary.needsAttention === 1 ? `watchtower.headline.${summary.headlineKey}` : `watchtower.headline.${summary.headlineKey}_plural`)
                : summary.headlineKey === 'improved'
                  ? (summary.improved === 1 ? 'watchtower.headline.improved' : 'watchtower.headline.improved_plural')
                  : summary.headlineKey === 'partial'
                    ? (summary.unobserved === 1 ? 'watchtower.headline.partial' : 'watchtower.headline.partial_plural')
                    : `watchtower.headline.${summary.headlineKey}`,
              {
                count: summary.headlineKey === 'improved'
                  ? summary.improved
                  : summary.headlineKey === 'partial'
                    ? summary.unobserved
                    : summary.needsAttention,
              }
            )}
          </p>

          <WatchtowerCoveragePanel coverage={report.coverage} plan={plan} />

          {report.tokens.length === 0 ? (
            <div className="watchtower-panel">
              <h3>{t('watchtower.emptyTitle')}</h3>
              <p>{t('watchtower.emptyText')}</p>
              <button type="button" className="btn-primary" onClick={() => navigate('watchlist')}>
                {t('watchtower.emptyCta')}
              </button>
            </div>
          ) : hasPremium ? (
            <ul className="watchtower-list">
              {report.tokens.map((entry) => (
                <WatchtowerTokenRow key={entry.identity} entry={entry} navigate={navigate} />
              ))}
            </ul>
          ) : (
            <WatchtowerPremiumLock changeCount={changeCount} navigate={navigate} />
          )}
        </>
      )}
    </section>
  );
}

function ReferralPage({ navigate, onOpenAuth }) {
  const { user } = useAuth();
  const { t, language } = useTranslation();
  const dateLocale = PDF_LOCALE_MAP[language] || 'en-US';
  const [data, setData] = useState(null);
  const [loadState, setLoadState] = useState({ status: 'idle', message: '' });
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const load = async () => {
    setLoadState({ status: 'loading', message: '' });
    try {
      const view = await fetchMyReferral();
      setData(view);
      setLoadState({ status: 'idle', message: '' });
    } catch (error) {
      setLoadState({ status: 'error', message: error.message || t('referral.loadError') });
    }
  };

  useEffect(() => {
    if (!user) return;
    load();
  }, [user?.id]);

  // Always trust the browser's own origin for the copyable link, so what the
  // user shares matches the domain they are on; fall back to the server value.
  const link = useMemo(() => {
    if (!data?.code) return data?.link || '';
    try {
      return `${window.location.origin}/signup?ref=${encodeURIComponent(data.code)}`;
    } catch {
      return data.link || '';
    }
  }, [data?.code, data?.link]);

  const qrSvg = useMemo(() => {
    if (!showQr || !link) return '';
    try {
      return qrToSvg(link, { ecc: 'M', border: 2, scale: 6 });
    } catch {
      return '';
    }
  }, [showQr, link]);

  if (!user) {
    return (
      <section className="page-section">
        <SectionTitle icon={Gift} eyebrow={t('referral.eyebrow')} title={t('referral.title')} />
        <p className="lookup-message">{t('referral.notSignedIn')}</p>
        <button className="primary-button" onClick={onOpenAuth}>{t('common.signIn')}</button>
      </section>
    );
  }

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked (insecure context / permissions): select-friendly
      // fallback so the user can still copy manually.
      setCopied(false);
    }
  };

  const share = async () => {
    if (!link) return;
    const shareData = { title: t('referral.shareTitle'), text: t('referral.shareText'), url: link };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        return;
      }
    } catch {
      // user cancelled or share failed — fall through to copy
    }
    copy();
  };

  const regenerate = async () => {
    if (regenerating) return;
    if (!window.confirm(t('referral.regenerateConfirm'))) return;
    setRegenerating(true);
    try {
      const res = await regenerateMyReferralCode();
      setData((prev) => (prev ? { ...prev, code: res.code, link: res.link } : prev));
      setShowQr(false);
    } catch {
      // leave the current code in place on failure
    }
    setRegenerating(false);
  };

  const stats = data?.stats || {};
  const funnelMax = Math.max(1, stats.clicks || 0, stats.signups || 0);

  return (
    <section className="page-section referral-page">
      <SectionTitle icon={Gift} eyebrow={t('referral.eyebrow')} title={t('referral.title')} />
      <p className="referral-intro">{t('referral.subtitle')}</p>

      {loadState.status === 'error' && (
        <div className="referral-error">
          <p className="lookup-message error">{loadState.message}</p>
          <button className="secondary-button" type="button" onClick={load}>{t('common.retry')}</button>
        </div>
      )}

      {loadState.status === 'loading' && !data && (
        <div className="skeleton-stat-grid" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, i) => <div className="skeleton-block" key={i} />)}
        </div>
      )}

      {data && (
        <>
          <div className="referral-link-card">
            <div className="referral-link-main">
              <span className="referral-card-label"><Link2 size={15} /> {t('referral.linkLabel')}</span>
              <div className="referral-link-row">
                <input className="referral-link-input" type="text" value={link} readOnly onFocus={(e) => e.target.select()} aria-label={t('referral.linkLabel')} />
                <button className="primary-button referral-copy-btn" type="button" onClick={copy}>
                  <Copy size={16} /> {copied ? t('common.copied') : t('common.copy')}
                </button>
              </div>
              <div className="referral-actions-row">
                <button className="secondary-button" type="button" onClick={share}><Share2 size={16} /> {t('referral.share')}</button>
                <button className="secondary-button" type="button" onClick={() => setShowQr((v) => !v)}>
                  <QrCode size={16} /> {showQr ? t('referral.qrHide') : t('referral.qrShow')}
                </button>
                <button className="ghost-button" type="button" onClick={regenerate} disabled={regenerating}>
                  <RefreshCw size={16} /> {regenerating ? t('referral.regenerating') : t('referral.regenerate')}
                </button>
              </div>
              <p className="referral-code-note">{t('referral.codeLabel')}: <strong>{data.code}</strong></p>
            </div>
            {showQr && qrSvg && (
              <div className="referral-qr" aria-label={t('referral.qrAlt')} dangerouslySetInnerHTML={{ __html: qrSvg }} />
            )}
          </div>

          <div className="referral-stat-grid">
            <ReferralStatTile icon={MousePointerClick} value={stats.clicks || 0} label={t('referral.stats.clicks')} />
            <ReferralStatTile icon={UserPlus} value={stats.signups || 0} label={t('referral.stats.signups')} />
            <ReferralStatTile icon={CheckCircle2} value={stats.verified || 0} label={t('referral.stats.verified')} />
            <ReferralStatTile icon={Activity} value={stats.active || 0} label={t('referral.stats.active')} />
            <ReferralStatTile icon={Crown} value={stats.premium || 0} label={t('referral.stats.premium')} />
            <ReferralStatTile icon={Star} value={stats.lifetime || 0} label={t('referral.stats.lifetime')} />
            <ReferralStatTile icon={TrendingUp} value={`${stats.signupConversion || 0}%`} label={t('referral.stats.conversion')} />
            <ReferralStatTile
              icon={CalendarClock}
              value={stats.lastSignupAt ? new Date(stats.lastSignupAt).toLocaleDateString(dateLocale) : t('referral.stats.never')}
              label={t('referral.stats.lastSignup')}
            />
          </div>

          <div className="referral-funnel">
            <h3>{t('referral.funnelTitle')}</h3>
            <div className="referral-funnel-bars">
              {REFERRAL_FUNNEL_STAGES.map((stage) => {
                const value = stats[stage.key] || 0;
                const pct = Math.round((value / funnelMax) * 100);
                const StageIcon = stage.icon;
                return (
                  <div className="referral-funnel-row" key={stage.key}>
                    <span className="referral-funnel-label"><StageIcon size={15} /> {t(`referral.funnelStages.${stage.key}`)}</span>
                    <div className="referral-funnel-track">
                      <div className="referral-funnel-fill" style={{ width: `${Math.max(pct, value > 0 ? 6 : 0)}%` }} />
                    </div>
                    <span className="referral-funnel-value">{value}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="referral-history">
            <h3>{t('referral.historyTitle')}</h3>
            {(!data.referrals || data.referrals.length === 0) && (
              <p className="lookup-message">{t('referral.historyEmpty')}</p>
            )}
            {data.referrals && data.referrals.length > 0 && (
              <div className="scan-history-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t('referral.historyColumns.user')}</th>
                      <th>{t('referral.historyColumns.status')}</th>
                      <th>{t('referral.historyColumns.joined')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.referrals]
                      .sort((a, b) => Date.parse(b.registeredAt || 0) - Date.parse(a.registeredAt || 0))
                      .map((ref, i) => (
                        <tr key={ref.referredUserId || i}>
                          {/* Privacy: a promoter sees THAT they referred someone
                              and how far they got — never the referred person's
                              identity. */}
                          <td>{t('referral.anonUser', { n: data.referrals.length - i })}</td>
                          <td><ReferralStatusBadge status={ref.status} /></td>
                          <td>{ref.registeredAt ? new Date(ref.registeredAt).toLocaleDateString(dateLocale) : '—'}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="referral-how">
            <h3>{t('referral.howToTitle')}</h3>
            <ol className="referral-steps">
              <li>{t('referral.howToStep1')}</li>
              <li>{t('referral.howToStep2')}</li>
              <li>{t('referral.howToStep3')}</li>
            </ol>
          </div>
        </>
      )}
    </section>
  );
}

function ReferralStatTile({ icon: Icon, value, label }) {
  return (
    <div className="referral-stat-tile">
      <Icon size={18} className="referral-stat-icon" />
      <span className="referral-stat-value">{value}</span>
      <small className="referral-stat-label">{label}</small>
    </div>
  );
}

// ── Admin: Referral Analytics ─────────────────────────────────────────────────
//
// Same shared-passcode admin gate as every other admin page. Read-only view of
// every promoter, searchable/sortable/exportable, with a drill-down into one
// promoter's full referral history.
const REFERRAL_ADMIN_SORTS = ['signups', 'clicks', 'premium', 'conversion', 'recent'];

function referralRowsToCsv(rows, headers) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = headers.map((h) => esc(h.label)).join(',');
  const body = rows.map((r) => headers.map((h) => esc(h.get(r))).join(',')).join('\n');
  return `${head}\n${body}`;
}

function AdminReferralPage() {
  const { t, language } = useTranslation();
  const dateLocale = PDF_LOCALE_MAP[language] || 'en-US';
  const [token, setToken] = useState(() => getStoredAdminToken());
  const [passcode, setPasscode] = useState('');
  const [authState, setAuthState] = useState({ status: 'idle', message: '' });
  const [payload, setPayload] = useState(null);
  const [loadState, setLoadState] = useState({ status: 'idle', message: '' });
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('signups');
  const [detail, setDetail] = useState(null); // { loading, data, error, userId }

  const loadData = async (activeToken) => {
    setLoadState({ status: 'loading', message: t('adminReferral.loading') });
    try {
      const data = await fetchReferralAnalytics(activeToken);
      setPayload(data);
      setLoadState({ status: 'idle', message: '' });
    } catch (error) {
      setLoadState({ status: 'error', message: error.message || t('adminReferral.loadFailed') });
    }
  };

  useEffect(() => {
    if (!token) return undefined;
    loadData(token);
    const interval = setInterval(() => loadData(token), 30000);
    return () => clearInterval(interval);
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
    setPayload(null);
  };

  const goto = (route) => { window.location.hash = `/${route}`; window.dispatchEvent(new HashChangeEvent('hashchange')); };

  const promoters = payload?.promoters || [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = promoters;
    if (q) {
      rows = rows.filter((r) =>
        [r.name, r.username, r.email, r.code].some((v) => String(v || '').toLowerCase().includes(q))
      );
    }
    const sorted = [...rows];
    sorted.sort((a, b) => {
      switch (sort) {
        case 'clicks': return b.clicks - a.clicks;
        case 'premium': return b.premium - a.premium;
        case 'conversion': return (b.signupConversion || 0) - (a.signupConversion || 0);
        case 'recent': return Date.parse(b.lastActivityAt || 0) - Date.parse(a.lastActivityAt || 0);
        case 'signups':
        default: return (b.signups - a.signups) || (b.clicks - a.clicks);
      }
    });
    return sorted;
  }, [promoters, search, sort]);

  const exportCsv = () => {
    const headers = [
      { label: 'User', get: (r) => r.name || r.email || r.userId },
      { label: 'Email', get: (r) => r.email },
      { label: 'Code', get: (r) => r.code },
      { label: 'Link', get: (r) => r.link },
      { label: 'Clicks', get: (r) => r.clicks },
      { label: 'Registrations', get: (r) => r.signups },
      { label: 'Verified', get: (r) => r.verified },
      { label: 'Active', get: (r) => r.active },
      { label: 'Premium', get: (r) => r.premium },
      { label: 'Lifetime', get: (r) => r.lifetime },
      { label: 'Conversion %', get: (r) => r.signupConversion },
      { label: 'Last Activity', get: (r) => r.lastActivityAt || '' },
    ];
    downloadAsFile(`khan-trust-referrals-${Date.now()}.csv`, referralRowsToCsv(filtered, headers), 'text/csv');
  };

  const openDetail = async (userId) => {
    setDetail({ loading: true, data: null, error: '', userId });
    try {
      const data = await fetchReferralDetail(token, userId);
      setDetail({ loading: false, data, error: '', userId });
    } catch (error) {
      setDetail({ loading: false, data: null, error: error.message || t('adminReferral.loadFailed'), userId });
    }
  };

  if (!token) {
    return (
      <section className="page-section">
        <SectionTitle icon={Lock} eyebrow={t('adminVerify.eyebrow')} title={t('adminReferral.title')} />
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

  const totals = payload?.totals || {};
  const c = t('adminReferral.columns');

  return (
    <section className="page-section analytics-dashboard">
      <SectionTitle icon={Gift} eyebrow={t('adminVerify.eyebrow')} title={t('adminReferral.title')} />
      <div className="analytics-toolbar">
        <button className="secondary-button" type="button" onClick={() => loadData(token)}>{t('common.refresh')}</button>
        <button className="secondary-button" type="button" onClick={exportCsv}><Download size={16} /> {t('adminReferral.exportCsv')}</button>
        <button className="secondary-button admin-cross-link" type="button" onClick={() => goto('admin-analytics')}>
          <BarChart3 size={16} /> {t('adminAnalytics.title')}
        </button>
        <button className="secondary-button admin-cross-link" type="button" onClick={() => goto('admin-premium')}>
          <Crown size={16} /> {t('adminPremium.title')}
        </button>
        <button className="ghost-button" type="button" onClick={logout}>{t('common.signOut')}</button>
      </div>

      {payload && (
        <div className="analytics-stat-grid referral-admin-totals">
          <ReferralStatTile icon={Users} value={totals.promoters || 0} label={t('adminReferral.totals.promoters')} />
          <ReferralStatTile icon={MousePointerClick} value={totals.clicks || 0} label={t('adminReferral.totals.clicks')} />
          <ReferralStatTile icon={UserPlus} value={totals.signups || 0} label={t('adminReferral.totals.signups')} />
          <ReferralStatTile icon={CheckCircle2} value={totals.verified || 0} label={t('adminReferral.totals.verified')} />
          <ReferralStatTile icon={Activity} value={totals.active || 0} label={t('adminReferral.totals.active')} />
          <ReferralStatTile icon={Crown} value={totals.premium || 0} label={t('adminReferral.totals.premium')} />
          <ReferralStatTile icon={Star} value={totals.lifetime || 0} label={t('adminReferral.totals.lifetime')} />
        </div>
      )}

      <div className="referral-admin-controls">
        <div className="referral-search">
          <Search size={16} />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('adminReferral.searchPlaceholder')} />
        </div>
        <label className="referral-sort">
          <ListFilter size={16} />
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            {REFERRAL_ADMIN_SORTS.map((key) => (
              <option key={key} value={key}>{t(`adminReferral.sortOptions.${key}`)}</option>
            ))}
          </select>
        </label>
      </div>

      {loadState.status === 'loading' && !payload && (
        <div className="skeleton-stat-grid" aria-hidden="true">
          {Array.from({ length: 8 }).map((_, i) => <div className="skeleton-block" key={i} />)}
        </div>
      )}
      {loadState.status === 'error' && !payload && (
        <p className="lookup-message error">{loadState.message}</p>
      )}

      {payload && filtered.length === 0 && <p className="lookup-message">{t('adminReferral.empty')}</p>}

      {payload && filtered.length > 0 && (
        <div className="scan-history-table-wrap">
          <table className="data-table referral-admin-table">
            <thead>
              <tr>
                <th>{c.user}</th>
                <th>{c.code}</th>
                <th className="num">{c.clicks}</th>
                <th className="num">{c.registrations}</th>
                <th className="num">{c.verified}</th>
                <th className="num">{c.active}</th>
                <th className="num">{c.premium}</th>
                <th className="num">{c.lifetime}</th>
                <th className="num">{c.conversion}</th>
                <th>{c.lastActivity}</th>
                <th>{c.actions}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.userId}>
                  <td>
                    <div className="referral-admin-user">
                      <strong>{r.name || t('adminReferral.unnamed')}</strong>
                      {r.email && <small>{r.email}</small>}
                    </div>
                  </td>
                  <td><code className="referral-admin-code">{r.code || '—'}</code></td>
                  <td className="num">{r.clicks}</td>
                  <td className="num">{r.signups}</td>
                  <td className="num">{r.verified}</td>
                  <td className="num">{r.active}</td>
                  <td className="num">{r.premium}</td>
                  <td className="num">{r.lifetime}</td>
                  <td className="num">{r.signupConversion || 0}%</td>
                  <td>{r.lastActivityAt ? new Date(r.lastActivityAt).toLocaleDateString(dateLocale) : '—'}</td>
                  <td>
                    <button className="ghost-button referral-detail-btn" type="button" onClick={() => openDetail(r.userId)}>
                      <History size={14} /> {t('adminReferral.viewDetail')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <ReferralDetailModal detail={detail} dateLocale={dateLocale} onClose={() => setDetail(null)} />
      )}
    </section>
  );
}

function ReferralDetailModal({ detail, dateLocale, onClose }) {
  const { t } = useTranslation();
  const d = detail.data;
  return (
    <AdminModalShell onClose={onClose}>
      <div className="modal-panel referral-detail-modal">
        <button className="modal-close-btn" type="button" onClick={onClose} aria-label={t('common.close')}><X size={18} /></button>
        <SectionTitle icon={History} eyebrow={t('adminReferral.eyebrow')} title={t('adminReferral.detailTitle')} />
        {detail.loading && <p className="lookup-message">{t('adminReferral.loading')}</p>}
        {detail.error && <p className="lookup-message error">{detail.error}</p>}
        {d && (
          <div className="referral-detail-body">
            <div className="referral-detail-head">
              <strong>{d.promoter?.name || t('adminReferral.unnamed')}</strong>
              {d.promoter?.email && <small>{d.promoter.email}</small>}
              <span className="referral-detail-code">{t('referral.codeLabel')}: <code>{d.code || '—'}</code></span>
            </div>
            <div className="referral-detail-stats">
              <span>{t('adminReferral.totals.clicks')}: <strong>{d.stats?.clicks || 0}</strong></span>
              <span>{t('adminReferral.totals.signups')}: <strong>{d.stats?.signups || 0}</strong></span>
              <span>{t('adminReferral.totals.premium')}: <strong>{d.stats?.premium || 0}</strong></span>
              <span>{t('referral.stats.conversion')}: <strong>{d.stats?.signupConversion || 0}%</strong></span>
            </div>
            {(!d.referrals || d.referrals.length === 0) && <p className="lookup-message">{t('adminReferral.detailEmpty')}</p>}
            {d.referrals && d.referrals.length > 0 && (
              <div className="scan-history-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>{t('adminReferral.detailColumns.user')}</th>
                      <th>{t('adminReferral.detailColumns.status')}</th>
                      <th>{t('adminReferral.detailColumns.registered')}</th>
                      <th>{t('adminReferral.detailColumns.premium')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.referrals.map((ref) => (
                      <tr key={ref.referredUserId}>
                        <td>
                          <div className="referral-admin-user">
                            <strong>{ref.name || t('adminReferral.unnamed')}</strong>
                            {ref.email && <small>{ref.email}</small>}
                          </div>
                        </td>
                        <td><ReferralStatusBadge status={ref.status} /></td>
                        <td>{ref.registeredAt ? new Date(ref.registeredAt).toLocaleDateString(dateLocale) : '—'}</td>
                        <td>{ref.premiumAt ? new Date(ref.premiumAt).toLocaleDateString(dateLocale) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </AdminModalShell>
  );
}

// ── User Profile Page ─────────────────────────────────────────────────────────
function UserProfilePage({ navigate, onOpenAuth }) {
  const { user, logout, updateProfile, fetchUserScans } = useAuth();
  const { entitlement } = usePremiumEntitlement();
  const { t, language } = useTranslation();
  const [scans, setScans] = useState([]);
  const [scansLoading, setScansLoading] = useState(false);
  const [editName, setEditName] = useState('');
  const [editAvatar, setEditAvatar] = useState('');
  const [avatarError, setAvatarError] = useState('');
  const [avatarProcessing, setAvatarProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const avatarInputRef = useRef(null);
  const dateLocale = PDF_LOCALE_MAP[language] || 'en-US';

  useEffect(() => {
    if (!user) return;
    setEditName(user.name || '');
    setEditAvatar(user.avatarUrl || '');
    setScansLoading(true);
    fetchUserScans()
      .then(setScans)
      .catch(() => setScans([]))
      .finally(() => setScansLoading(false));
  }, [user?.id]);

  if (!user) {
    return (
      <section className="page-section">
        <SectionTitle icon={User} eyebrow={t('userProfile.eyebrow')} title={t('userProfile.title')} />
        <p className="lookup-message">{t('userProfile.notSignedIn')}</p>
        <button className="primary-button" onClick={onOpenAuth}>{t('common.signIn')}</button>
      </section>
    );
  }

  const initial = (user.name || user.email || '?')[0].toUpperCase();

  const handleAvatarPick = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    setAvatarError('');
    setAvatarProcessing(true);
    try {
      validateAvatarFile(file);
      const dataUrl = await resizeAvatarFile(file);
      setEditAvatar(dataUrl);
    } catch (err) {
      setAvatarError(err.message || t('userProfile.avatar.errors.genericFailed'));
    }
    setAvatarProcessing(false);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateProfile({ name: editName, avatarUrl: editAvatar });
      setToast({ tone: 'success', message: t('userProfile.toast.saveSuccess') });
    } catch (err) {
      setToast({ tone: 'error', message: err.message || t('userProfile.toast.saveError') });
    }
    setSaving(false);
  };

  const scansToday = scans.filter((s) => s.timestamp?.startsWith(new Date().toISOString().slice(0, 10))).length;
  const scansThisWeek = scans.filter((s) => {
    const diff = Date.now() - new Date(s.timestamp).getTime();
    return diff <= 7 * 86400000;
  }).length;
  const scansThisMonth = scans.filter((s) => {
    const diff = Date.now() - new Date(s.timestamp).getTime();
    return diff <= 30 * 86400000;
  }).length;

  return (
    <section className="page-section">
      <SectionTitle icon={User} eyebrow={t('userProfile.eyebrow')} title={t('userProfile.title')} />
      <ProfileToast toast={toast} onDismiss={() => setToast(null)} />

      <div className="profile-card">
        <div className="profile-avatar-section">
          {user.avatarUrl
            ? <img src={user.avatarUrl} alt={user.name} className="profile-avatar-large" />
            : <span className="profile-avatar-large profile-avatar-fallback">{initial}</span>
          }
          <div>
            <h2 className="profile-name">{user.name} <AccountBadge entitlement={entitlement} compact /></h2>
            <p className="profile-email">{user.email}</p>
            {user.emailVerified
              ? <span className="auth-verified-badge">{t('userProfile.emailVerified')}</span>
              : (
                <>
                  <span className="auth-unverified-badge">{t('userProfile.emailNotVerified')}</span>
                  <EmailVerificationAction />
                </>
              )}
            <p className="profile-joined">{t('userProfile.memberSince', { date: new Date(user.createdAt).toLocaleDateString(dateLocale) })}</p>
          </div>
        </div>

        <PremiumProfilePanel entitlement={entitlement} />

        <div className="profile-stats-row">
          <div className="profile-stat"><span>{scans.length}</span><small>{t('userProfile.stats.totalScans')}</small></div>
          <div className="profile-stat"><span>{scansToday}</span><small>{t('userProfile.stats.today')}</small></div>
          <div className="profile-stat"><span>{scansThisWeek}</span><small>{t('userProfile.stats.thisWeek')}</small></div>
          <div className="profile-stat"><span>{scansThisMonth}</span><small>{t('userProfile.stats.thisMonth')}</small></div>
        </div>
      </div>

      <button type="button" className="profile-referral-cta" onClick={() => navigate('referral')}>
        <span className="profile-referral-cta-icon"><Gift size={20} /></span>
        <span className="profile-referral-cta-text">
          <strong>{t('userProfile.referralCta.title')}</strong>
          <small>{t('userProfile.referralCta.text')}</small>
        </span>
        <ArrowRight size={18} />
      </button>

      <div className="profile-edit-section">
        <h3>{t('userProfile.editTitle')}</h3>
        <form className="auth-form" onSubmit={handleSave}>
          <label className="auth-field">
            <span>{t('userProfile.fields.fullName')}</span>
            <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} required disabled={saving} />
          </label>
          <div className="auth-field">
            <span>{t('userProfile.fields.profilePicture')}</span>
            <div className="avatar-upload-row">
              {editAvatar
                ? <img src={editAvatar} alt={t('userProfile.avatar.previewAlt')} className="avatar-upload-preview" />
                : <span className="avatar-upload-preview avatar-upload-preview-fallback">{initial}</span>
              }
              <div className="avatar-upload-actions">
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="avatar-upload-input"
                  onChange={handleAvatarPick}
                  disabled={saving || avatarProcessing}
                />
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={saving || avatarProcessing}
                >
                  <Camera size={16} /> {avatarProcessing ? t('userProfile.avatar.processing') : editAvatar ? t('userProfile.avatar.changePhoto') : t('userProfile.avatar.uploadPhoto')}
                </button>
                {editAvatar && (
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => setEditAvatar('')}
                    disabled={saving || avatarProcessing}
                  >
                    <Trash2 size={16} /> {t('userProfile.avatar.remove')}
                  </button>
                )}
              </div>
            </div>
            <small className="inline-note">{t('userProfile.avatar.helpText', { size: AVATAR_OUTPUT_SIZE })}</small>
            {avatarError && <p className="lookup-message error">{avatarError}</p>}
          </div>
          <button className="primary-button" type="submit" disabled={saving || avatarProcessing}>{saving ? t('userProfile.saving') : t('userProfile.saveChanges')}</button>
        </form>
      </div>

      <div className="profile-scan-history">
        <h3>{t('userProfile.scanHistory.title')}</h3>
        {scansLoading && <p className="lookup-message">{t('userProfile.scanHistory.loading')}</p>}
        {!scansLoading && scans.length === 0 && <p className="lookup-message">{t('userProfile.scanHistory.empty')}</p>}
        {!scansLoading && scans.length > 0 && (
          <div className="scan-history-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('userProfile.scanHistory.columns.project')}</th>
                  <th>{t('userProfile.scanHistory.columns.ticker')}</th>
                  <th>{t('userProfile.scanHistory.columns.trustScore')}</th>
                  <th>{t('userProfile.scanHistory.columns.date')}</th>
                </tr>
              </thead>
              <tbody>
                {scans.map((s, i) => (
                  <tr key={i}>
                    <td>{s.projectName || '—'}</td>
                    <td>{s.ticker || '—'}</td>
                    <td>{s.trustScore != null ? s.trustScore : '—'}</td>
                    <td>{s.timestamp ? new Date(s.timestamp).toLocaleDateString(dateLocale) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="profile-danger-zone">
        <button className="ghost-button" onClick={() => { logout(); navigate('home'); }}>{t('userProfile.signOut')}</button>
      </div>
    </section>
  );
}

// ── Email Verification Page ───────────────────────────────────────────────────
function EmailVerifyPage({ token, navigate }) {
  const { verifyEmail } = useAuth();
  const [status, setStatus] = useState('loading'); // loading | success | error
  const [message, setMessage] = useState('');

  useEffect(() => {
    verifyEmail(token)
      .then(() => setStatus('success'))
      .catch((err) => { setStatus('error'); setMessage(err.message || 'Verification failed.'); });
  }, [token]);

  return (
    <section className="page-section">
      <SectionTitle icon={Mail} eyebrow="Account" title="Email Verification" />
      {status === 'loading' && <p className="lookup-message">Verifying your email…</p>}
      {status === 'success' && (
        <div className="auth-info-block">
          <p>Your email has been verified successfully.</p>
          <button className="primary-button" onClick={() => navigate('profile')}>Go to Profile</button>
        </div>
      )}
      {status === 'error' && (
        <div className="auth-info-block">
          <p className="lookup-message error">{message}</p>
          <button className="secondary-button" onClick={() => navigate('home')}>Back to Home</button>
        </div>
      )}
    </section>
  );
}

// ── Password Reset Page ───────────────────────────────────────────────────────
function ResetPasswordPage({ token, navigate }) {
  const [showModal, setShowModal] = useState(true);
  if (!showModal) return null;
  return (
    <section className="page-section">
      <SectionTitle icon={Lock} eyebrow="Account" title="Reset Password" />
      <AuthModal
        initialMode="reset-password"
        resetToken={token}
        onClose={() => { setShowModal(false); navigate('home'); }}
        onSuccess={() => { setShowModal(false); navigate('home'); }}
      />
    </section>
  );
}

function Root() {
  return (
    <I18nProvider>
      <AuthProvider>
        {/* Inside AuthProvider: retention is keyed by the signed-in account and
            reads `user` from it. Outside WalletContextProvider because it has
            nothing to do with a wallet - a free, wallet-less account has a
            streak and a notification bell like anyone else. */}
        <RetentionProvider>
          <WalletContextProvider>
            <App />
          </WalletContextProvider>
        </RetentionProvider>
      </AuthProvider>
    </I18nProvider>
  );
}

// Guard against Vite HMR re-executing this module and calling createRoot
// twice on the same container (produces a warning loop in dev but is harmless
// in production where the module only runs once).
const _rootContainer = document.getElementById('root');
if (!_rootContainer._reactRoot) {
  _rootContainer._reactRoot = createRoot(_rootContainer);
}
_rootContainer._reactRoot.render(<Root />);
