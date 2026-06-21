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

export function trackSocialClick(network, url) {
  trackEvent('social_link_click', { network, link_url: url });
}

export function trackShareClick(channel, tokenName) {
  trackEvent('share_click', { channel, token_name: tokenName });
}
