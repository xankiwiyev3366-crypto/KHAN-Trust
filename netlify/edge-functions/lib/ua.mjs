// Pure, dependency-free routing logic for the /token/<contract> surface.
//
// Shared between the Deno edge function (../token-router.js) and the Node test
// suite (tests/tokenRouter.test.mjs) — it must import nothing runtime-specific.
//
// This lives in a SUBDIRECTORY on purpose: Netlify treats every top-level file
// in netlify/edge-functions/ as an edge-function entry point (each must default
// export a function), and the underscore-ignore convention that applies to
// netlify/functions/ does NOT apply here. A helper at the top level breaks the
// whole edge bundle. Files in subdirectories are importable but not registered.
//
// WHY THIS EXISTS: /token/<contract> serves two very different audiences from
// one URL. Link-preview crawlers (WhatsApp, Telegram, Facebook, X, LinkedIn,
// Discord, Slack, search engines) cannot run JavaScript, so they need the
// server-rendered SEO/Open-Graph HTML from the token-page function. Human
// browsers need the full interactive React SPA. The edge function inspects the
// User-Agent and rewrites accordingly, at the SAME URL, so the shared link is
// preserved and there is no redirect loop.

// Known link-preview bots and crawlers. Deliberately matched by the crawler's
// OWN token, NOT the in-app browser a human uses:
//   - "facebookexternalhit"/"facebot" = the FB scraper. "FBAN"/"FBAV" (a human
//     in the Facebook app's webview) is intentionally NOT here.
//   - "TelegramBot"/"WhatsApp" = the preview fetchers. A human who taps a link
//     in those apps opens a normal browser webview with an ordinary UA.
// This asymmetry matters: misclassifying a HUMAN as a bot reintroduces the very
// "raw HTML" bug we are fixing, so the human path must stay the default.
export const CRAWLER_PATTERN = new RegExp(
  [
    'facebookexternalhit', 'facebot', 'Twitterbot', 'WhatsApp', 'TelegramBot',
    'LinkedInBot', 'Slackbot', 'Slack-ImgProxy', 'Discordbot', 'Pinterest',
    'redditbot', 'Googlebot', 'Google-InspectionTool', 'Storebot-Google',
    'AdsBot-Google', 'APIs-Google', 'bingbot', 'Applebot', 'DuckDuckBot',
    'YandexBot', 'Baiduspider', 'SkypeUriPreview', 'vkShare', 'W3C_Validator',
    'Embedly', 'Iframely', 'Nuzzel', 'Qwantify', 'outbrain', 'Bytespider',
    'SemrushBot', 'AhrefsBot', 'ia_archiver', 'MetaInspector',
    // Generic catch-alls last. No mainstream human browser UA contains these
    // as standalone words, so they are safe defaults that err toward serving
    // crawlers the SEO HTML rather than starving a preview.
    '\\bbot\\b', 'crawler', 'spider',
  ].join('|'),
  'i',
);

export function isCrawler(userAgent) {
  return CRAWLER_PATTERN.test(String(userAgent || ''));
}

// Extract the contract from a /token/<contract> pathname; '' when it is not a
// token page. Single path segment only, so /token/x/y is not treated as x.
export function tokenContractFromPath(pathname) {
  const match = String(pathname || '').match(/^\/token\/([^/?#]+)\/?$/i);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

// Decide how to serve a request to the token surface. Pure and fully testable.
//   'passthrough' — not a token page: let Netlify continue its normal chain.
//   'seo'         — a crawler / link-preview bot: serve the server-rendered
//                   OG/SEO HTML from the token-page function.
//   'spa'         — a human browser: serve the React SPA at the same URL, which
//                   reads the contract from the pathname and loads the live
//                   report (see the deep-link effect in src/main.jsx).
//
// PHASE 4 NOTE. /token/<contract> is no longer a destination — the token-page
// function now 301s it to the canonical /t/<chain>/<contract>. The UA split
// below is therefore vestigial for crawlers (they follow the 301 to the fully
// server-rendered profile) but is KEPT for humans, because it is what stops a
// person who clicks an old shared link from landing on a bare redirect: they
// still get the interactive SPA at the URL they arrived on.
//
// The new /t/* surface deliberately has NO edge router and NO UA sniffing.
// Everyone — crawler, human, human with JavaScript disabled — receives the same
// server-rendered HTML. See the header of netlify/functions/token-profile.mjs
// for why serving different bytes to different visitors is the wrong shape for a
// page that asserts someone's verification status.
export function resolveTokenRoute({ pathname, userAgent }) {
  const contract = tokenContractFromPath(pathname);
  if (!contract) return { mode: 'passthrough' };
  if (isCrawler(userAgent)) {
    return {
      mode: 'seo',
      contract,
      target: `/.netlify/functions/token-page?contract=${encodeURIComponent(contract)}`,
    };
  }
  return { mode: 'spa', contract, target: '/index.html' };
}
