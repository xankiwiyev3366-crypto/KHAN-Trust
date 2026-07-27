import { planUsdAmount } from './lib/pricing.js';

const MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID;

let initialized = false;

function isEnabled() {
  return Boolean(MEASUREMENT_ID) && import.meta.env.PROD && typeof window !== 'undefined';
}

export function initAnalytics() {
  if (!isEnabled() || initialized) return;
  initialized = true;

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag(...args) {
    window.dataLayer.push(args);
  };

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  document.head.appendChild(script);

  window.gtag('js', new Date());
  window.gtag('config', MEASUREMENT_ID, { send_page_view: false });
}

export function trackEvent(action, params = {}) {
  if (!isEnabled() || typeof window.gtag !== 'function') return;
  window.gtag('event', action, params);
}

export function trackPageView(path) {
  if (!isEnabled() || typeof window.gtag !== 'function') return;
  window.gtag('event', 'page_view', {
    page_path: path,
    page_location: window.location.href,
    page_title: document.title,
  });
}

export function trackTokenSearch(term, status) {
  trackEvent('token_scan_completed', { search_term: term, status });
}

export function trackTokenScanStarted(term) {
  trackEvent('token_scan_started', { search_term: term });
}

export function trackTokenScanCompleted(term, status) {
  trackEvent('token_scan_completed', { search_term: term, status });
}

export function trackPdfDownload(project = {}) {
  trackEvent('download_pdf_report_clicked', {
    token_name: project.name,
    token_ticker: project.ticker,
    chain: project.chain,
  });
}

export function trackReportViewed(project = {}) {
  trackEvent('report_viewed', {
    token_name: project.name,
    token_ticker: project.ticker,
    chain: project.chain,
  });
}

export function trackPricingView() {
  trackEvent('pricing_view');
}

export function trackPremiumClick() {
  trackEvent('premium_click');
}

export function trackEarlySupporterClick() {
  trackEvent('early_supporter_click');
}

export function trackCheckoutStarted(plan) {
  trackEvent('checkout_started', { plan });
}

export function trackCheckoutUnavailable(plan, reason = 'missing_config') {
  trackEvent('checkout_unavailable', { plan, reason });
}

export function trackCryptoVerifyStarted(plan) {
  trackEvent('crypto_verify_started', { plan });
}

export function trackCryptoVerifySuccess(plan) {
  trackEvent('crypto_verify_success', { plan });
  // BOTH crypto rails funnel through here — the connected-wallet flow and the
  // manual transaction-hash flow — and neither reaches this line unless the
  // server actually verified the payment and granted the entitlement. Firing
  // the Pixel Purchase here rather than at the two call sites means a future
  // third crypto entry point cannot forget to report the sale.
  trackPixelPurchase(plan);
}

export function trackCryptoVerifyFailed(plan, reason) {
  trackEvent('crypto_verify_failed', { plan, reason });
}

export function trackSocialClick(network, url) {
  trackEvent('social_link_click', { network, link_url: url });
}

export function trackShareClick(channel, tokenName) {
  trackEvent('share_click', { channel, token_name: tokenName });
}

// ---------------------------------------------------------------------------
// META PIXEL
//
// The pixel is loaded by the inline snippet in index.html, so — unlike GA above
// — this module never bootstraps it and only fires events at an already-present
// `fbq`. Enablement is therefore deliberately NOT tied to MEASUREMENT_ID: the
// two vendors are independent, and GA being unconfigured must not silence Meta.
//
// PROD-gated ON PURPOSE. The snippet's PageView fires in every environment, but
// the events below are CONVERSION signals that feed Meta's ad optimisation. A
// developer running the app locally, or an e2e run, must never be able to teach
// the ad algorithm what a buyer looks like, nor inflate the reported ROAS that
// ad spend is decided on. Same reasoning as isEnabled() above.
function isPixelEnabled() {
  return (
    import.meta.env.PROD &&
    typeof window !== 'undefined' &&
    typeof window.fbq === 'function'
  );
}

// Every caller below sits directly on a signup or purchase success path, so a
// tracking failure must never surface as a failed sign-up or a sale the user
// thinks did not complete. Swallow everything.
function trackPixel(event, params) {
  if (!isPixelEnabled()) return;
  try {
    if (params) window.fbq('track', event, params);
    else window.fbq('track', event);
  } catch {
    // analytics is never load-bearing
  }
}

// Fired once a registration has actually returned a user and the session has
// been persisted — not when the form is submitted, so abandoned and rejected
// sign-ups (duplicate email, weak password, network error) are never counted.
export function trackPixelCompleteRegistration() {
  trackPixel('CompleteRegistration');
}

// `value`/`currency` come from lib/pricing.js, the same single source of truth
// the wallet charges against and the server verifies against, so the revenue
// Meta optimises on can never drift from the revenue actually collected.
// Reported in USD even when the buyer paid in USDT/SOL: those plan prices ARE
// denominated in USD, and a stable currency keeps Meta's ROAS math meaningful.
export function trackPixelPurchase(plan) {
  trackPixel('Purchase', {
    value: planUsdAmount(plan),
    currency: 'USD',
    content_name: plan,
  });
}
