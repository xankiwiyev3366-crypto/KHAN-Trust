const MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID;

let initialized = false;

function isEnabled() {
  return Boolean(MEASUREMENT_ID) && typeof window !== 'undefined';
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
  trackEvent('token_search', { search_term: term, status });
}

export function trackPdfDownload(project = {}) {
  trackEvent('pdf_download', {
    token_name: project.name,
    token_ticker: project.ticker,
    chain: project.chain,
  });
}

export function trackSocialClick(network, url) {
  trackEvent('social_link_click', { network, link_url: url });
}

export function trackShareClick(channel, tokenName) {
  trackEvent('share_click', { channel, token_name: tokenName });
}
