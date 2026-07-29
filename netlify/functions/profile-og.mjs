// GET /og/t/<chain>/<contract>.svg   (rewritten in netlify.toml)
//
// The social preview image for a public token profile: the card that appears
// when someone pastes a /t/ link into X, Telegram, Slack or Discord.
//
// ── WHY SVG AND NOT A RENDERED PNG ──────────────────────────────────────────
//
// The usual approach is a headless browser or a canvas library rendering to PNG.
// Both were rejected:
//
//   - A headless Chromium does not fit in a Netlify Function's bundle or its
//     10-second budget, and a share preview that times out is worse than none —
//     the platform caches the failure.
//   - node-canvas is a native module; the deploy surface here is already guarded
//     against exactly this class of dependency (scripts/verify-functions.mjs
//     exists because a native/ESM mismatch broke deploys silently).
//
// SVG needs neither. It is text, it renders in ~1ms, it has no dependencies, and
// every major platform that matters renders it — with ONE real exception noted
// below, which is why the fallback exists.
//
// ── THE FALLBACK IS THE POINT, NOT AN AFTERTHOUGHT ──────────────────────────
//
// X/Twitter does not reliably render SVG in cards, and some scrapers reject any
// image they cannot size. The requirement is "a stable fallback when the token
// logo or dynamic image generation fails", and this file has three layers of it:
//
//   1. Unknown token → still a valid card, saying so honestly. Never a 404: a
//      404'd og:image makes the whole preview collapse to a bare link.
//   2. Any internal error → the STATIC brand card below, served 200.
//   3. No logo (which is every token today — the corpus stores none) → a
//      monogram drawn from the symbol. Never a broken <img>, never a guessed
//      CDN path.
//
// Nothing here can produce a non-image response. That is the contract: a share
// card that fails must fail into a KHAN Trust card, not into nothing.
import { buildProfileView } from './_profileData.mjs';
import { siteOrigin } from './_badgeState.mjs';
import {
  parseProfilePath,
  VERIFICATION_LABELS,
  isProfileVerified,
  chainLabel,
} from '../../src/lib/publicProfile.js';

const WIDTH = 1200;
const HEIGHT = 630;

function escapeXml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Truncated by CHARACTER COUNT rather than measured width, because SVG text has
// no layout engine here — an over-long token name would simply run off the card
// and, on some renderers, over the score. A hard cap is ugly at worst; overflow
// is broken.
function fit(value, max) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

const TONE_COLORS = {
  good: '#67d39c',
  warn: '#f7be52',
  bad: '#ff756e',
  neutral: '#aaa28d',
};

function scoreColor(riskLevel) {
  if (riskLevel === 'Low') return TONE_COLORS.good;
  if (riskLevel === 'High') return TONE_COLORS.bad;
  return TONE_COLORS.warn;
}

// The shared frame: background, brand lockup, footer. Every card — including the
// error fallback — is built on this, so a failure still looks like the product.
function frame(inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#0b0a07"/><stop offset="0.55" stop-color="#050505"/><stop offset="1" stop-color="#0d0a03"/>
</linearGradient>
<linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#f4d889"/><stop offset="1" stop-color="#a8802b"/>
</linearGradient>
</defs>
<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
<circle cx="120" cy="0" r="420" fill="#e0b75c" opacity="0.10"/>
<rect x="0" y="0" width="${WIDTH}" height="6" fill="url(#gold)"/>
<g transform="translate(72,72)">
<rect width="56" height="56" rx="14" fill="url(#gold)"/>
<text x="28" y="39" font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif" font-size="30" font-weight="800" fill="#120d02" text-anchor="middle">K</text>
<text x="76" y="26" font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif" font-size="25" font-weight="700" fill="#f6f0df">KHAN Trust</text>
<text x="76" y="50" font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif" font-size="16" fill="#aaa28d">The AI trust layer of Web3</text>
</g>
${inner}
<text x="72" y="574" font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif" font-size="17" fill="#7d765f">khantrust.net · Explainable, deterministic trust scoring — not financial advice</text>
</svg>`;
}

// Pure renderer, so what the card claims is testable without a store.
export function renderOgSvg(view) {
  const name = fit(view.name || view.symbol || 'Unrecognised token', 26);
  const symbol = view.symbol ? fit(view.symbol, 12) : '';
  const chain = view.chain ? chainLabel(view.chain) : '';
  const hasScore = Number.isFinite(view.trustScore);
  const verification = VERIFICATION_LABELS[view.verification?.state] || VERIFICATION_LABELS.unverified;
  const monogram = (view.symbol || view.name || view.contract || '?').trim().slice(0, 2).toUpperCase();

  // The verification pill is drawn with a WIDTH DERIVED FROM THE LABEL LENGTH.
  // A fixed-width pill either clips "Verification in review" or leaves a hole
  // beside "Verified", and the badge SVG already learned this lesson (see
  // STATE_PRESENTATION in verify-badge.mjs, which carries a per-state width).
  const pillLabel = fit(verification.label, 26);
  const pillWidth = 30 + pillLabel.length * 11;
  const pillColor = TONE_COLORS[verification.tone] || TONE_COLORS.neutral;

  return frame(`
<g transform="translate(72,215)">
<rect width="104" height="104" rx="26" fill="#171611" stroke="#e0b75c" stroke-opacity="0.28"/>
<text x="52" y="70" font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif" font-size="40" font-weight="800" fill="#e0b75c" text-anchor="middle">${escapeXml(monogram)}</text>
</g>

<text x="204" y="262" font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif" font-size="56" font-weight="800" fill="#f6f0df">${escapeXml(name)}</text>
<text x="204" y="304" font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif" font-size="26" fill="#aaa28d">${escapeXml([symbol, chain].filter(Boolean).join(' · '))}</text>

<g transform="translate(204,330)">
<rect width="${pillWidth}" height="42" rx="21" fill="${pillColor}" fill-opacity="0.14" stroke="${pillColor}" stroke-opacity="0.55"/>
<text x="${pillWidth / 2}" y="28" font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif" font-size="19" font-weight="600" fill="${pillColor}" text-anchor="middle">${escapeXml(pillLabel)}${isProfileVerified(view.verification?.state) ? ' ✓' : ''}</text>
</g>

${hasScore
    ? `<g transform="translate(770,215)">
<rect width="358" height="200" rx="24" fill="#10100e" stroke="#e0b75c" stroke-opacity="0.20"/>
<text x="179" y="46" font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif" font-size="18" letter-spacing="2" fill="#aaa28d" text-anchor="middle">TRUST SCORE</text>
<text x="179" y="132" font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif" font-size="96" font-weight="800" fill="${scoreColor(view.riskLevel)}" text-anchor="middle">${escapeXml(String(view.trustScore))}</text>
<text x="179" y="170" font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif" font-size="22" fill="#f6f0df" text-anchor="middle">${escapeXml(view.riskLevel || 'Medium')} risk · out of 100</text>
</g>`
    // NOT a zero, and not a blank box. An unscored token says so, because a card
    // showing "0" would read as a catastrophic score rather than as no data —
    // the same absence-is-not-a-zero rule the score floor and the funnel follow.
    : `<g transform="translate(770,215)">
<rect width="358" height="200" rx="24" fill="#10100e" stroke="#e0b75c" stroke-opacity="0.20"/>
<text x="179" y="88" font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif" font-size="30" font-weight="700" fill="#aaa28d" text-anchor="middle">Not yet scored</text>
<text x="179" y="128" font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif" font-size="19" fill="#7d765f" text-anchor="middle">Run a free scan on</text>
<text x="179" y="154" font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif" font-size="19" fill="#7d765f" text-anchor="middle">KHAN Trust</text>
</g>`}

<text x="72" y="470" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="19" fill="#7d765f">${escapeXml(fit(view.contract, 62))}</text>
`);
}

// Layer 2 of the fallback: a card that is still a KHAN Trust card. Served 200
// with a SHORT cache, so a transient outage cannot pin a blank-ish preview into
// every platform's image cache for hours.
export function renderFallbackSvg() {
  return frame(`
<text x="72" y="300" font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif" font-size="54" font-weight="800" fill="#f6f0df">Token trust, verified.</text>
<text x="72" y="352" font-family="Inter,Segoe UI,Helvetica,Arial,sans-serif" font-size="26" fill="#aaa28d">Trust Score, risk analysis and ownership verification for any token.</text>
`);
}

function svgResponse(body, maxAge) {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': `public, max-age=${maxAge}, s-maxage=${maxAge}`,
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
      Vary: 'Accept-Encoding',
    },
    body,
  };
}

export function resolveTarget(event) {
  const source = event.path || event.rawUrl || '';
  let pathname = source;
  if (/^https?:\/\//i.test(source)) {
    try {
      pathname = new URL(source).pathname;
    } catch {
      pathname = source;
    }
  }
  // The /og prefix and the .svg suffix are stripped so the SAME parser that owns
  // the profile URL shape owns this one. Two independent path regexes for one
  // URL shape is how the image ends up describing a different token than the
  // page it was generated for.
  const stripped = pathname.replace(/^\/og/i, '').replace(/\.svg$/i, '');
  const fromPath = parseProfilePath(stripped);
  if (fromPath.chain && fromPath.contract) return fromPath;
  const query = event.queryStringParameters || {};
  return {
    chain: String(query.chain || '').trim().toLowerCase() || null,
    contract: String(query.contract || '').trim() || null,
  };
}

export async function handler(event) {
  try {
    if (event.httpMethod !== 'GET' && event.httpMethod !== 'HEAD') {
      return { statusCode: 405, headers: { 'Content-Type': 'text/plain' }, body: 'Method not allowed' };
    }

    const { chain, contract } = resolveTarget(event);
    if (!chain || !contract) return svgResponse(renderFallbackSvg(), 300);

    const result = await buildProfileView({ chain, contract, origin: siteOrigin() });
    if (!result.ok) return svgResponse(renderFallbackSvg(), 3600);

    // 200 even for a token we hold nothing about — see the header. The profile
    // PAGE 404s in that case, correctly; its share image must not, or the
    // preview collapses to a bare URL.
    return svgResponse(renderOgSvg(result.view), 600);
  } catch (error) {
    console.error(`[profile-og] render failed: ${error.stack || error.message}`);
    return svgResponse(renderFallbackSvg(), 60);
  }
}
