// The Free/Premium presentation layer: crowns, teaser locks, and the upgrade
// modal that every locked surface opens.
//
// THE MODEL: SHOW THE VALUE, THEN ASK
//
// A locked feature is RENDERED, not hidden. A Free user sees the real panel —
// real headings, real shape, real crown — dimmed and inert, and clicking it
// opens the upgrade modal naming the feature they just reached for. Hiding
// Premium features entirely is the intuitive design and the wrong one: nobody
// upgrades for a capability they have never seen, and an invisible feature
// cannot do any selling.
//
// WHAT THIS FILE IS NOT
//
// It is NOT a security boundary, and nothing here should ever be the only thing
// between a Free user and paid data. Everything in this module runs in the
// user's browser, where `hasPremium` is one devtools edit away from `true`.
// The real gate is netlify/functions/_featureGate.mjs; this is the sales
// surface in front of it. Both read the same registry (src/lib/features.js) so
// they cannot disagree about what is Premium.
//
// The practical consequence: a locked panel must never be handed the real data
// and told not to paint it. Server-gated endpoints return 402 (or a redacted
// payload), so a teaser renders SKELETON content — never the answer under a
// blur.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Crown, Check, X, Sparkles, ArrowRight, Infinity as InfinityIcon } from 'lucide-react';
import { useTranslation } from './i18n/I18nContext.jsx';
import { canUseFeature, isTeasable, featuresForTier, featuresByGroup, FEATURES, FREE_DAILY_SCAN_LIMIT } from './lib/features.js';
import { PLAN_USD_AMOUNT } from './lib/pricing.js';

const PremiumGateContext = createContext(null);

export function usePremiumGate() {
  const context = useContext(PremiumGateContext);
  // Deliberately permissive rather than throwing: a component rendered outside
  // the provider (a test, a stray subtree) should degrade to "locked, no modal"
  // instead of crashing the whole page. Locked is the safe default — see the
  // unknown-key note in src/lib/features.js.
  if (!context) {
    return { hasPremium: false, can: () => false, openUpgrade: () => {}, closeUpgrade: () => {} };
  }
  return context;
}

// Wraps the app. `hasPremium` comes from usePremiumEntitlement() in main.jsx —
// this provider deliberately does NOT resolve entitlement itself, so there
// stays exactly one merged entitlement view in the client (account + legacy
// wallet + admin grant) rather than a second one that could disagree with it.
export function PremiumGateProvider({ hasPremium, navigate, children }) {
  // Which feature the user reached for, or null when the modal is closed. Held
  // as the feature KEY rather than a rendered string so the modal can headline
  // the exact capability ("Unlock Detailed Holder Analytics") instead of a
  // generic pitch — the specific ask converts better because it answers the
  // question the user actually just asked.
  const [requested, setRequested] = useState(null);

  const openUpgrade = useCallback((featureKey = null) => {
    setRequested({ feature: featureKey, at: Date.now() });
  }, []);

  const closeUpgrade = useCallback(() => setRequested(null), []);

  // A user who upgrades while the modal is open should not be left staring at
  // a sales pitch for something they now own.
  useEffect(() => {
    if (hasPremium) setRequested(null);
  }, [hasPremium]);

  const can = useCallback(
    (featureKey) => canUseFeature(featureKey, { hasPremium }),
    [hasPremium]
  );

  const value = useMemo(
    () => ({ hasPremium: hasPremium === true, can, openUpgrade, closeUpgrade }),
    [hasPremium, can, openUpgrade, closeUpgrade]
  );

  return (
    <PremiumGateContext.Provider value={value}>
      {children}
      {requested && !hasPremium && (
        <PremiumUpgradeModal featureKey={requested.feature} onClose={closeUpgrade} navigate={navigate} />
      )}
    </PremiumGateContext.Provider>
  );
}

// The crown. One component so the marker is identical everywhere it appears —
// inline in a heading, on a locked card, next to a disabled button.
export function PremiumCrown({ size = 14, className = '' }) {
  const { t } = useTranslation();
  return (
    <span className={`premium-crown ${className}`.trim()} title={t('premiumGate.crownTooltip')}>
      <Crown size={size} aria-hidden="true" />
      <span className="sr-only">{t('premiumGate.crownLabel')}</span>
    </span>
  );
}

// ── The teaser lock ──────────────────────────────────────────────────────────
//
// Usage:
//   <PremiumLock feature="holderAnalytics" title={t('...')}>
//     <RealHolderAnalytics ... />       ← rendered ONLY when entitled
//   </PremiumLock>
//
// For an entitled user this is a pass-through and costs nothing. For a Free
// user it renders `preview` (a skeleton, never real data) behind a crowned
// overlay whose whole surface is one big upgrade button.
//
// ACCESSIBILITY, BECAUSE INERT UI IS EASY TO GET WRONG
//
// The preview is `aria-hidden` and removed from the tab order (`inert`), so a
// screen-reader or keyboard user is not dragged through a wall of decorative
// skeleton before reaching the thing they can act on. The overlay button
// carries the real accessible name — "Premium feature: Detailed Holder
// Analytics. Upgrade to unlock." — which is the only part of this that is
// actually useful to them.
export function PremiumLock({
  feature,
  title,
  description,
  children,
  preview = null,
  className = '',
  as: Wrapper = 'div',
}) {
  const { t } = useTranslation();
  const { can, openUpgrade } = usePremiumGate();

  if (can(feature)) return <>{children}</>;

  // A non-teasable premium feature is simply absent for Free users. Used for
  // things where an empty shell communicates nothing (see `teaser: false` in
  // the registry).
  if (!isTeasable(feature)) return null;

  const label = title || t(FEATURES[feature]?.labelKey || 'premiumGate.genericFeature');

  return (
    <Wrapper className={`premium-lock ${className}`.trim()} data-feature={feature}>
      {/* `inert` must be a real boolean here: React 19 treats inert="" as falsy
          and drops the attribute entirely, which silently leaves the skeleton
          focusable — a keyboard user would tab through a wall of decorative
          bars before reaching the upgrade button. */}
      <div className="premium-lock-preview" aria-hidden="true" inert={true}>
        {preview || <PremiumLockSkeleton />}
      </div>

      <div className="premium-lock-overlay">
        <button
          type="button"
          className="premium-lock-button"
          onClick={() => openUpgrade(feature)}
          aria-label={t('premiumGate.unlockAria', { feature: label })}
        >
          <span className="premium-lock-crown"><Crown size={20} aria-hidden="true" /></span>
          <strong className="premium-lock-title">{label}</strong>
          <span className="premium-lock-desc">{description || t('premiumGate.lockedDescription')}</span>
          <span className="premium-lock-cta">
            {t('premiumGate.unlockCta')} <ArrowRight size={15} aria-hidden="true" />
          </span>
        </button>
      </div>
    </Wrapper>
  );
}

// Generic shimmer used when a caller supplies no bespoke preview. Shaped like a
// content panel — a few bars of varying width — so the lock reads as "there is
// something real here" rather than as a broken empty box.
export function PremiumLockSkeleton({ rows = 4 }) {
  return (
    <div className="premium-skeleton">
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} className="premium-skeleton-row" style={{ width: `${92 - index * 13}%` }} />
      ))}
    </div>
  );
}

// A crowned, disabled inline control (a button or tab a Free user cannot use).
// Click opens the modal rather than doing nothing — a dead control teaches the
// user the product is broken; one that explains itself teaches them what it is.
//
// NOTE it is a real enabled <button>, not `disabled`. A `disabled` button
// receives no click and no focus, so it could neither open the modal nor be
// discovered by a keyboard user — it would be invisible to exactly the people
// who most need the explanation. `aria-disabled` states the semantics without
// removing the affordance.
export function PremiumActionButton({ feature, children, className = '', onClick, ...rest }) {
  const { t } = useTranslation();
  const { can, openUpgrade } = usePremiumGate();
  const allowed = can(feature);

  return (
    <button
      type="button"
      className={`${className} ${allowed ? '' : 'premium-locked-action'}`.trim()}
      aria-disabled={allowed ? undefined : true}
      onClick={allowed ? onClick : () => openUpgrade(feature)}
      title={allowed ? undefined : t('premiumGate.crownTooltip')}
      {...rest}
    >
      {children}
      {!allowed && <PremiumCrown size={13} />}
    </button>
  );
}

// ── The upgrade modal ────────────────────────────────────────────────────────
//
// Leads with the feature the user just reached for, then the Free-vs-Premium
// comparison, then one price and one button. The lifetime plan is the hero
// because it is the offer we most want taken; the monthly plan stays visible
// as a secondary line rather than a competing card, so the modal asks ONE
// question instead of making the user do comparison shopping mid-task.
export function PremiumUpgradeModal({ featureKey = null, onClose, navigate, reason = null }) {
  const { t } = useTranslation();
  const requested = featureKey ? FEATURES[featureKey] : null;
  const requestedLabel = requested ? t(requested.labelKey) : null;

  // Escape closes, and focus is trapped to the panel by the browser's own
  // modal semantics (role="dialog" + aria-modal). Matches ScanLimitModal.
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const premiumFeatures = featuresForTier('premium');
  const groups = featuresByGroup();

  const goToPricing = () => {
    onClose?.();
    navigate?.('pricing');
  };

  return (
    <div
      className="modal-backdrop premium-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t('premiumModal.title')}
      onClick={(event) => { if (event.target === event.currentTarget) onClose?.(); }}
    >
      <div className="modal-panel premium-modal">
        <button className="close-button" onClick={onClose} aria-label={t('common.close')}><X size={20} /></button>

        <header className="premium-modal-head">
          <span className="premium-modal-crown"><Crown size={26} aria-hidden="true" /></span>
          {/* When the user reached for a specific feature, name it. The generic
              headline is only for the "browse the plans" entry point. */}
          <h2>
            {reason === 'scanLimit'
              ? t('premiumModal.scanLimitTitle')
              : requestedLabel
                ? t('premiumModal.featureTitle', { feature: requestedLabel })
                : t('premiumModal.title')}
          </h2>
          <p>
            {reason === 'scanLimit'
              ? t('premiumModal.scanLimitBody', { limit: FREE_DAILY_SCAN_LIMIT })
              : t('premiumModal.subtitle')}
          </p>
        </header>

        <div className="premium-modal-compare">
          <div className="premium-modal-col free">
            <h3>{t('premiumModal.freeColumn')}</h3>
            <p className="premium-modal-price">{t('premiumModal.freePrice')}</p>
            <ul>
              <li><Check size={14} aria-hidden="true" /> {t('premiumModal.freeScans', { limit: FREE_DAILY_SCAN_LIMIT })}</li>
              {featuresForTier('free').slice(0, 5).map(([key, def]) => (
                <li key={key}><Check size={14} aria-hidden="true" /> {t(def.labelKey)}</li>
              ))}
            </ul>
          </div>

          <div className="premium-modal-col premium">
            <span className="premium-modal-tag">{t('premiumModal.bestValue')}</span>
            <h3><Crown size={15} aria-hidden="true" /> {t('premiumModal.premiumColumn')}</h3>
            <p className="premium-modal-price">
              <strong>${PLAN_USD_AMOUNT.early_supporter}</strong>
              <span>{t('premiumModal.lifetimeSuffix')}</span>
            </p>
            <ul>
              <li className="highlight">
                <InfinityIcon size={14} aria-hidden="true" /> {t('premiumModal.unlimitedScans')}
              </li>
              {premiumFeatures
                .filter(([key]) => key !== 'unlimitedScans')
                .map(([key, def]) => (
                  <li key={key} className={key === featureKey ? 'requested' : ''}>
                    <Check size={14} aria-hidden="true" /> {t(def.labelKey)}
                  </li>
                ))}
            </ul>
          </div>
        </div>

        <div className="premium-modal-actions">
          <button type="button" className="primary-button premium-modal-cta" onClick={goToPricing}>
            <Sparkles size={16} aria-hidden="true" />
            {t('premiumModal.cta', { price: PLAN_USD_AMOUNT.early_supporter })}
            <ArrowRight size={16} aria-hidden="true" />
          </button>
          <p className="premium-modal-monthly">{t('premiumModal.monthlyAlternative', { price: PLAN_USD_AMOUNT.premium })}</p>
          <button type="button" className="ghost-button" onClick={onClose}>{t('premiumModal.dismiss')}</button>
        </div>

        <p className="premium-modal-note">{t('premiumModal.note')}</p>
      </div>
    </div>
  );
}

// Exported so the pricing page renders the SAME comparison the modal does,
// generated from the registry. Two hand-maintained lists would drift, and the
// drift always lands the same way: the pricing page promises something the
// product does not gate, or gates something it never promised.
export function FeatureComparisonTable() {
  const { t } = useTranslation();
  const groups = featuresByGroup();
  return (
    <div className="feature-compare">
      <div className="feature-compare-head">
        <span>{t('pricing.comparison.feature')}</span>
        <span>{t('pricing.comparison.free')}</span>
        <span className="premium-col"><Crown size={13} aria-hidden="true" /> {t('pricing.comparison.premium')}</span>
      </div>
      {groups.map(([group, items]) => (
        <div className="feature-compare-group" key={group}>
          <h4>{t(`pricing.groups.${group}`)}</h4>
          {items.map(([key, def]) => (
            <div className="feature-compare-row" key={key}>
              <span className="feature-compare-name">{t(def.labelKey)}</span>
              <span className="feature-compare-cell">
                {def.tier === 'free'
                  ? <Check size={16} className="yes" aria-label={t('pricing.comparison.included')} />
                  : <X size={16} className="no" aria-label={t('pricing.comparison.notIncluded')} />}
              </span>
              <span className="feature-compare-cell">
                <Check size={16} className="yes" aria-label={t('pricing.comparison.included')} />
              </span>
            </div>
          ))}
        </div>
      ))}
      <div className="feature-compare-row totals">
        <span className="feature-compare-name">{t('features.dailyScans')}</span>
        <span className="feature-compare-cell">{FREE_DAILY_SCAN_LIMIT}</span>
        <span className="feature-compare-cell premium-col">{t('pricing.comparison.unlimited')}</span>
      </div>
    </div>
  );
}
