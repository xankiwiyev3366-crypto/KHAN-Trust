// SINGLE SOURCE OF TRUTH for what Free gets and what Premium gets.
//
// Every access decision in the product — the crown overlays in the UI, the
// server's 402 on a Premium endpoint, the pricing page's comparison table —
// resolves through THIS registry. Before it, the answer to "is this Premium?"
// was spread across component-local `!hasPremium` checks in main.jsx and a
// handful of endpoints that each re-derived entitlement their own way. That is
// how a feature ends up locked in the UI but wide open on the API.
//
// This file must stay PURE — no import.meta.env, no Node/Vite-only APIs — so it
// bundles into a Netlify Function (CJS, via ../../src/lib/features.js) and into
// the Vite client alike. Same cross-boundary contract as src/lib/pricing.js;
// enforced by scripts/verify-functions.mjs.
//
// ── ADDING A FUTURE PREMIUM FEATURE ──────────────────────────────────────────
//
// 1. Add one entry below with `tier: 'premium'`.
// 2. Client: wrap the UI in <PremiumLock feature="yourKey"> (src/main.jsx).
// 3. Server: `const gate = await requireFeature(event, 'yourKey')` at the top of
//    the endpoint (netlify/functions/_featureGate.mjs).
//
// That is the whole checklist. Nothing else needs to know the feature exists —
// the pricing table, the upgrade modal's feature list, and the comparison grid
// are all GENERATED from this registry, so a new entry shows up in the upgrade
// pitch automatically instead of being forgotten there.

// How many token analyses a Free user may run per UTC day.
//
// Premium is unlimited and is never counted (see netlify/functions/scan-quota.mjs
// — a premium caller does not touch the quota store at all). The server echoes
// this number on every quota reply so no UI ever hardcodes it.
export const FREE_DAILY_SCAN_LIMIT = 5;

// The tiers, ordered weakest → strongest. `early_supporter` is a superset of
// `premium`, exactly as hasPlanAccess() in src/entitlements.js already treats
// it — a Founding Member must never be told a Premium feature is locked.
export const TIERS = ['free', 'premium'];

// ── The registry ─────────────────────────────────────────────────────────────
//
// `tier`     'free'    — always available, to everyone, signed in or not.
//            'premium' — requires an active paid or admin-granted entitlement.
// `labelKey` i18n key for the human name, used by the comparison table and the
//            upgrade modal. Copy lives in src/i18n/*.js under `features.*`.
// `teaser`   true when Free users should still SEE the feature (rendered,
//            crowned, non-interactive) rather than have it hidden. This is the
//            "show the value before asking them to pay" rule; a feature with
//            teaser:false is simply absent for Free users.
// `group`    which row-group it sits in on the pricing comparison table.
export const FEATURES = {
  // ── Free tier: the whole core scan is genuinely usable without paying ──────
  trustScore: { tier: 'free', labelKey: 'features.trustScore', group: 'analysis' },
  scamProbability: { tier: 'free', labelKey: 'features.scamProbability', group: 'analysis' },
  projectOverview: { tier: 'free', labelKey: 'features.projectOverview', group: 'analysis' },
  aiSummary: { tier: 'free', labelKey: 'features.aiSummary', group: 'analysis' },
  basicRiskIndicators: { tier: 'free', labelKey: 'features.basicRiskIndicators', group: 'analysis' },
  basicHolders: { tier: 'free', labelKey: 'features.basicHolders', group: 'holders' },
  basicContractSecurity: { tier: 'free', labelKey: 'features.basicContractSecurity', group: 'security' },
  priceChart: { tier: 'free', labelKey: 'features.priceChart', group: 'analysis' },

  // ── Premium ───────────────────────────────────────────────────────────────
  fullAiAnalysis: { tier: 'premium', labelKey: 'features.fullAiAnalysis', teaser: true, group: 'analysis' },
  detailedRiskBreakdown: { tier: 'premium', labelKey: 'features.detailedRiskBreakdown', teaser: true, group: 'analysis' },
  aiRecommendations: { tier: 'premium', labelKey: 'features.aiRecommendations', teaser: true, group: 'analysis' },
  investmentThesis: { tier: 'premium', labelKey: 'features.investmentThesis', teaser: true, group: 'analysis' },
  holderAnalytics: { tier: 'premium', labelKey: 'features.holderAnalytics', teaser: true, group: 'holders' },
  securityAnalysis: { tier: 'premium', labelKey: 'features.securityAnalysis', teaser: true, group: 'security' },
  scoreHistory: { tier: 'premium', labelKey: 'features.scoreHistory', teaser: true, group: 'monitoring' },
  compareProjects: { tier: 'premium', labelKey: 'features.compareProjects', teaser: true, group: 'tools' },
  watchlist: { tier: 'premium', labelKey: 'features.watchlist', teaser: true, group: 'monitoring' },
  continuousMonitoring: { tier: 'premium', labelKey: 'features.continuousMonitoring', teaser: true, group: 'monitoring' },
  realtimeAlerts: { tier: 'premium', labelKey: 'features.realtimeAlerts', teaser: true, group: 'monitoring' },
  pdfReports: { tier: 'premium', labelKey: 'features.pdfReports', teaser: true, group: 'tools' },
  advancedAnalytics: { tier: 'premium', labelKey: 'features.advancedAnalytics', teaser: true, group: 'tools' },
  unlimitedScans: { tier: 'premium', labelKey: 'features.unlimitedScans', teaser: false, group: 'analysis' },
};

// Row-groups, in the order the comparison table renders them.
export const FEATURE_GROUPS = ['analysis', 'holders', 'security', 'monitoring', 'tools'];

// An UNKNOWN feature key is treated as Premium, not as free.
//
// This is deliberate and it is the safe direction: a typo in a gate call, or a
// feature someone wired up before adding its registry entry, fails CLOSED —
// locked for free users — instead of silently giving away paid functionality
// with no error anywhere. The cost of the mistake is a support ticket; the cost
// of the opposite default is unpriced revenue leaking with no signal at all.
export function featureTier(featureKey) {
  return FEATURES[featureKey]?.tier === 'free' ? 'free' : 'premium';
}

export function isPremiumFeature(featureKey) {
  return featureTier(featureKey) === 'premium';
}

// THE access predicate. Both sides of the app call this and nothing else.
//
// `hasPremium` must already be a RESOLVED boolean — on the client the merged
// entitlement view from usePremiumEntitlement(), on the server the result of
// resolveVerifiedPremiumAccess(). This function never resolves identity itself,
// so it cannot be tricked by a caller-supplied wallet address; see the identity
// note in netlify/functions/_premiumAccess.mjs.
export function canUseFeature(featureKey, { hasPremium } = {}) {
  if (!isPremiumFeature(featureKey)) return true;
  return hasPremium === true;
}

// Should a locked feature still be RENDERED to a Free user (crowned and inert)?
// Free features are always shown; premium ones follow their `teaser` flag.
export function isTeasable(featureKey) {
  if (!isPremiumFeature(featureKey)) return true;
  return FEATURES[featureKey]?.teaser === true;
}

// Every feature of a tier, as [key, definition] pairs, in registry order.
// Drives the upgrade modal's list and the pricing comparison table, so both
// stay in sync with the registry for free.
export function featuresForTier(tier) {
  return Object.entries(FEATURES).filter(([, def]) => (def.tier === 'free' ? 'free' : 'premium') === tier);
}

// Registry entries bucketed by `group`, in FEATURE_GROUPS order. Used by the
// pricing page's Free-vs-Premium table, which renders one section per group.
export function featuresByGroup() {
  return FEATURE_GROUPS.map((group) => [
    group,
    Object.entries(FEATURES).filter(([, def]) => def.group === group),
  ]).filter(([, items]) => items.length > 0);
}
