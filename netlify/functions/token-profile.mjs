// GET /t/<chain>/<contract>   (rewritten in netlify.toml)
//
// The public, indexable, server-rendered trust profile for one token. Phase 4.
//
// ── WHY THIS IS SERVER-RENDERED HTML AND NOT THE SPA ────────────────────────
//
// The roadmap suggested FastAPI + Jinja2. This deployment is a Vite/React SPA on
// Netlify with Node functions and NO Python runtime anywhere in it, so adding
// FastAPI would mean a second language, a second deploy target, a second set of
// secrets and a second copy of every rule in src/lib/. The OUTCOME the roadmap
// wanted — meaningful HTML in the first response, readable with JavaScript off —
// is achieved here by a Netlify Function that renders the whole page as a
// string. Same result, one stack, no new deploy surface.
//
// The existing /token/* surface solves a narrower problem in a different way: an
// edge function sniffs the User-Agent and sends crawlers to server HTML while
// humans get the SPA. That was right for a page whose content only mattered to a
// crawler. It is wrong here, and this route deliberately does NOT do it:
//
//   - UA sniffing serves different bytes to different visitors, which is the
//     definition of cloaking if the two ever diverge. On a page that asserts
//     someone's verification status, they must not.
//   - The requirement is a page that WORKS with JavaScript disabled. A human
//     with JS off is not a crawler and would get the SPA — a blank screen.
//   - Every CTA on this page is a link. There is nothing here that needs React.
//
// So everyone gets the same HTML. A small progressive-enhancement script adds a
// copy button and re-checks the badge live; with it blocked, the page is intact.
//
// ── HTTP STATUS CODES ───────────────────────────────────────────────────────
//
//   200  a token we hold data about (scored, or verified/expired/revoked)
//   404  a WELL-FORMED address on a supported chain that we have never heard of,
//        AND an unsupported chain, AND a malformed contract.
//   503  our own stores could not answer.
//
// The 404 is the load-bearing one and it is deliberate. This URL space is
// infinite — any 32-44 base58 characters is a syntactically valid Solana mint —
// so answering 200 for all of it would offer a crawler an unbounded supply of
// interchangeable "not scanned yet" pages, and the sitewide quality judgement
// that follows would land on the pages that DO have content. 404 with a genuinely
// useful body (what this address is, and a button to scan it) is the honest
// answer: the page does not exist yet, and here is how to make it exist.
//
// 503 rather than 500 for a store outage, because 503 is the status that makes a
// crawler come back later instead of dropping the URL, and a blob-store hiccup
// must not cost the page its ranking.
import { buildProfileView } from './_profileData.mjs';
import { siteOrigin } from './_badgeState.mjs';
import { recordEvent, PRODUCT_EVENTS } from './_productEvents.mjs';
import {
  buildProfileMeta,
  buildProfileJsonLd,
  parseProfilePath,
  VERIFICATION_LABELS,
  PROFILE_VERIFICATION,
  ownershipMethodLabel,
  isProfileVerified,
  chainLabel,
} from '../../src/lib/publicProfile.js';

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Attribute values only. Same escaping, named separately so a future reader does
// not have to work out whether a given call site is inside quotes.
const attr = escapeHtml;

// Resolve { chain, contract } from the request. Netlify populates
// queryStringParameters from the ORIGINAL client request rather than from the
// query string written into a redirect target (the production bug
// tests/tokenPage.test.mjs locks in for /token/*), so the PATH is authoritative
// and the query string is only a fallback for direct function calls and dev.
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
  const fromPath = parseProfilePath(pathname);
  if (fromPath.chain && fromPath.contract) return fromPath;
  const query = event.queryStringParameters || {};
  return {
    chain: String(query.chain || '').trim().toLowerCase() || null,
    contract: String(query.contract || '').trim() || null,
  };
}

// ── Presentation ────────────────────────────────────────────────────────────

const STYLES = `
:root{color-scheme:dark;--bg:#050505;--panel:#10100e;--panel-2:#171611;--border:rgba(224,183,92,.18);--border-soft:rgba(255,255,255,.08);--gold:#e0b75c;--gold-bright:#f4d889;--text:#f6f0df;--muted:#aaa28d;--danger:#ff756e;--warning:#f7be52;--success:#67d39c;--radius:12px}
*{box-sizing:border-box}
body{margin:0;background:radial-gradient(circle at 15% 0%,rgba(224,183,92,.14),transparent 28rem),linear-gradient(180deg,#070706 0%,#050505 44%,#080704 100%);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;line-height:1.6}
a{color:var(--gold-bright)}
.wrap{max-width:820px;margin:0 auto;padding:24px 18px 72px}
header.site{display:flex;align-items:center;gap:10px;padding:8px 0 26px}
.mark{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9px;background:linear-gradient(140deg,var(--gold),#8a6b23);color:#120d02;font-weight:800}
header.site b{font-size:15px;letter-spacing:.01em}
header.site small{display:block;color:var(--muted);font-size:12px;font-weight:400}
.card{background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:20px;margin:0 0 18px}
h1{font-size:clamp(24px,5vw,34px);margin:0 0 4px;letter-spacing:-.02em}
h2{font-size:15px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:0 0 12px;font-weight:600}
.sub{color:var(--muted);margin:0 0 18px}
.ident{display:flex;gap:14px;align-items:center;flex-wrap:wrap}
.logo{width:52px;height:52px;border-radius:14px;background:var(--panel-2);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:20px;color:var(--gold);flex:none}
.pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:4px 11px;font-size:12.5px;font-weight:600;border:1px solid var(--border-soft);background:var(--panel-2);color:var(--muted)}
.pill.good{color:var(--success);border-color:rgba(103,211,156,.4)}
.pill.warn{color:var(--warning);border-color:rgba(247,190,82,.4)}
.pill.bad{color:var(--danger);border-color:rgba(255,117,110,.4)}
.pills{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.score{display:flex;align-items:baseline;gap:10px;margin:6px 0 2px}
.score b{font-size:44px;line-height:1;letter-spacing:-.03em}
.score span{color:var(--muted)}
.addr{display:flex;gap:8px;align-items:center;flex-wrap:wrap;background:var(--panel-2);border:1px solid var(--border-soft);border-radius:9px;padding:9px 11px;margin:14px 0 0}
.addr code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;word-break:break-all;color:var(--text)}
.addr button{background:var(--panel);border:1px solid var(--border);color:var(--gold-bright);border-radius:7px;padding:5px 10px;font-size:12px;cursor:pointer;font:inherit;font-size:12px}
dl.rows{margin:0;display:grid;grid-template-columns:minmax(150px,auto) 1fr;gap:9px 18px}
dl.rows dt{color:var(--muted);font-size:13.5px}
dl.rows dd{margin:0;font-size:13.5px;word-break:break-word}
ul.flags{list-style:none;margin:0;padding:0;display:grid;gap:10px}
ul.flags li{border-left:3px solid var(--border-soft);padding:2px 0 2px 12px}
ul.flags li.warn{border-color:var(--warning)}
ul.flags li.bad{border-color:var(--danger)}
ul.flags strong{display:block;font-size:14px}
ul.flags span{color:var(--muted);font-size:13.5px}
.cta{display:flex;gap:10px;flex-wrap:wrap;margin-top:4px}
.btn{display:inline-block;border-radius:9px;padding:11px 18px;font-weight:600;font-size:14px;text-decoration:none;border:1px solid var(--border)}
.btn.primary{background:linear-gradient(140deg,var(--gold),#a8802b);color:#120d02;border-color:transparent}
.btn.ghost{background:var(--panel-2);color:var(--text)}
footer{color:var(--muted);font-size:12.5px;border-top:1px solid var(--border-soft);margin-top:26px;padding-top:16px}
footer a{color:var(--muted)}
@media(max-width:520px){dl.rows{grid-template-columns:1fr;gap:2px 0}dl.rows dd{margin:0 0 8px}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
`.trim();

function scoreTone(riskLevel) {
  if (riskLevel === 'Low') return 'good';
  if (riskLevel === 'High') return 'bad';
  return 'warn';
}

function monogram(view) {
  const source = view.symbol || view.name || view.contract || '?';
  return source.trim().slice(0, 2).toUpperCase();
}

function formatDate(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toISOString().slice(0, 10);
}

// The verification block. This is the part of the page the whole product rests
// on, so it is explicit about three things a naive version gets wrong:
//
//   1. It names the state in words, never by colour alone (WCAG 1.4.1).
//   2. It shows expired/revoked history rather than reverting to "not verified".
//   3. It links to the LIVE lookup, and says why — so a reader knows that a
//      screenshot of this section is not evidence of anything.
function renderVerification(view) {
  const state = view.verification.state;
  const meta = VERIFICATION_LABELS[state];
  const rows = [];

  if (view.verification.tier) {
    rows.push(['Tier', view.verification.tier === 'verified_pro' ? 'Verified Pro' : 'Verified']);
  }
  const method = ownershipMethodLabel(view.verification.ownershipMethod);
  if (method) rows.push(['Ownership proof', method]);

  const issued = formatDate(view.verification.issuedAt);
  if (issued && state !== PROFILE_VERIFICATION.UNVERIFIED) {
    rows.push([state === PROFILE_VERIFICATION.REVOKED ? 'Last updated' : 'Issued', issued]);
  }

  const expires = formatDate(view.verification.expiresAt);
  if (expires) {
    rows.push([state === PROFILE_VERIFICATION.EXPIRED ? 'Expired' : 'Valid until', expires]);
  } else if (isProfileVerified(state)) {
    // A verified record with no expiry is a pre-paid admin approval. Saying so
    // is more honest than an empty cell, and stops a reader assuming the date
    // was simply lost.
    rows.push(['Valid until', 'No expiry (approved before timed verification)']);
  }

  const revoked = formatDate(view.verification.revokedAt);
  if (revoked) rows.push(['Revoked', revoked]);

  return `<section class="card" id="verification" aria-labelledby="vh">
<h2 id="vh">Verification status</h2>
<p><span class="pill ${meta.tone}" data-badge-pill>${escapeHtml(meta.label)}</span></p>
<p class="sub" data-badge-summary>${escapeHtml(meta.summary)}</p>
${rows.length ? `<dl class="rows" data-badge-rows>${rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>` : ''}
<p class="sub" style="margin:16px 0 0">
A KHAN Trust badge is only ever as current as the live record behind it. An image or screenshot proves nothing on its own —
<a href="${attr(view.verification.badgeStatusUrl)}" rel="nofollow">check this project’s live verification status</a>,
which is recomputed from our own records on every request.
</p>
</section>`;
}

function renderCta(view) {
  const verified = isProfileVerified(view.verification.state);
  const ownerCopy = verified
    ? 'Renew or manage this project’s verification'
    : 'Is this your project? Prove ownership and get verified';
  return `<section class="card" aria-labelledby="ch">
<h2 id="ch">Next steps</h2>
<p class="sub">${escapeHtml(ownerCopy)}. Traders: run a live scan or add this token to your watchlist for change alerts.</p>
<div class="cta">
<a class="btn primary" href="${attr(view.scanUrl)}">Run a live trust scan</a>
<a class="btn ghost" href="${attr(view.verifyUrl)}">${verified ? 'Manage verification' : 'Start verification'}</a>
</div>
</section>`;
}

// Pure and side-effect free, so the whole page is unit-testable by handing it a
// plain object — no Blobs, no network, no Netlify.
export function renderProfileHtml(view, { origin = siteOrigin(), notFound = false } = {}) {
  const meta = buildProfileMeta(view, { origin });
  const jsonLd = buildProfileJsonLd(view, { origin });
  // Neutralise "<" so a token field containing "</script>" can never break out
  // of the ld+json block. The corpus strips HTML on write; this renderer must be
  // safe on its own inputs regardless of who calls it.
  const jsonLdSafe = JSON.stringify(jsonLd).replace(/</g, '\\u003c');

  // Same treatment for anything embedded in the progressive-enhancement script
  // below. Both values are already built from validated, encoded inputs, so this
  // is defence in depth rather than a fix — but a `</script>` reaching a script
  // block is the one XSS this file could still have, and the cost of ruling it
  // out unconditionally is a single replace.
  const js = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

  const hasScore = Number.isFinite(view.trustScore);
  const displayName = view.name || view.symbol || 'Unrecognised token';
  const chainName = view.chain ? chainLabel(view.chain) : '';

  const detailRows = [];
  if (chainName) detailRows.push(['Chain', chainName]);
  if (view.symbol) detailRows.push(['Symbol', view.symbol]);
  if (view.category) detailRows.push(['Category', view.category]);
  if (view.riskLevel) detailRows.push(['Risk level', view.riskLevel]);
  if (view.confidenceLabel) detailRows.push(['Data confidence', view.confidenceLabel]);
  const scanned = formatDate(view.scannedAt);
  if (scanned) detailRows.push(['Last analysed', scanned]);
  if (view.channels.length) detailRows.push(['Channels found at last scan', view.channels.join(', ')]);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(meta.title)}</title>
<meta name="description" content="${attr(meta.description)}" />
<meta name="robots" content="${attr(meta.robots)}" />
<link rel="canonical" href="${attr(meta.canonical)}" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<meta property="og:site_name" content="KHAN Trust" />
<meta property="og:type" content="${attr(meta.ogType)}" />
<meta property="og:title" content="${attr(meta.ogTitle)}" />
<meta property="og:description" content="${attr(meta.ogDescription)}" />
<meta property="og:url" content="${attr(meta.ogUrl)}" />
${meta.ogImage ? `<meta property="og:image" content="${attr(meta.ogImage)}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="${attr(`${displayName} Trust Score on KHAN Trust`)}" />` : ''}
<meta name="twitter:card" content="${attr(meta.twitterCard)}" />
<meta name="twitter:title" content="${attr(meta.twitterTitle)}" />
<meta name="twitter:description" content="${attr(meta.twitterDescription)}" />
${meta.twitterImage ? `<meta name="twitter:image" content="${attr(meta.twitterImage)}" />` : ''}
<style>${STYLES}</style>
<script type="application/ld+json">${jsonLdSafe}</script>
</head>
<body>
<div class="wrap">
<header class="site">
<a class="mark" href="${attr(origin)}/" aria-label="KHAN Trust home">K</a>
<div><b>KHAN Trust</b><small>The AI trust layer of Web3</small></div>
</header>

<main>
<section class="card">
<div class="ident">
<div class="logo" aria-hidden="true">${escapeHtml(monogram(view))}</div>
<div>
<h1>${escapeHtml(displayName)}${view.symbol ? ` <span style="color:var(--muted);font-weight:500">(${escapeHtml(view.symbol)})</span>` : ''}</h1>
<div class="pills">
${chainName ? `<span class="pill">${escapeHtml(chainName)}</span>` : ''}
<span class="pill ${VERIFICATION_LABELS[view.verification.state].tone}" data-badge-pill>${escapeHtml(VERIFICATION_LABELS[view.verification.state].label)}</span>
</div>
</div>
</div>

${notFound ? `<p class="sub" style="margin-top:18px">KHAN Trust has no analysis or verification on record for this address yet. Everything below is what we can state truthfully today — run a free scan to create its profile.</p>` : ''}

${hasScore
    ? `<div class="score"><b>${escapeHtml(String(view.trustScore))}</b><span>/ 100 Trust Score</span></div>
<p class="sub">Rated <strong class="pill ${scoreTone(view.riskLevel)}" style="font-size:12.5px">${escapeHtml(view.riskLevel || 'Medium')} risk</strong>${scanned ? ` · last analysed ${escapeHtml(scanned)}` : ''}</p>`
    : `<p class="sub" style="margin-top:16px"><strong>Not yet scored.</strong> No completed KHAN Trust analysis exists for this token, so no Trust Score is shown. An absent score is not a zero and not a pass.</p>`}

<div class="addr">
<code data-contract>${escapeHtml(view.contract)}</code>
<button type="button" data-copy hidden>Copy</button>
</div>
${view.links.length ? `<p class="sub" style="margin:12px 0 0">${view.links.map((l) => `<a href="${attr(l.url)}" rel="${attr(l.rel)}" target="_blank">${escapeHtml(l.label)}</a>`).join(' · ')}</p>` : ''}
</section>

${detailRows.length ? `<section class="card" aria-labelledby="dh">
<h2 id="dh">Project details</h2>
<dl class="rows">${detailRows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>
</section>` : ''}

${view.flags.length ? `<section class="card" aria-labelledby="fh">
<h2 id="fh">Security flags &amp; warnings</h2>
<ul class="flags">${view.flags.map((f) => `<li class="${attr(f.tone)}"><strong>${escapeHtml(f.title)}</strong><span>${escapeHtml(f.detail)}</span></li>`).join('')}</ul>
</section>` : ''}

${renderVerification(view)}
${renderCta(view)}
</main>

<footer>
<p>KHAN Trust scores are explainable and deterministic — every point traces to holder concentration, liquidity depth, contract security, token age and transparency signals. Verification confirms <em>ownership</em> of a project; it is not an endorsement, a security audit, or a prediction. Nothing here is financial advice.</p>
<p><a href="${attr(origin)}/">KHAN Trust</a> · <a href="${attr(view.verification.badgeStatusUrl)}" rel="nofollow">Live badge lookup</a></p>
</footer>
</div>

<script>
// PROGRESSIVE ENHANCEMENT ONLY. Everything above is complete without this
// script; it adds a copy button and re-checks the badge against the live
// endpoint so a cached or screenshotted page cannot keep asserting a
// verification that has since expired or been revoked. Every failure is silent
// because the server-rendered state is already correct and already visible.
(function () {
  try {
    var btn = document.querySelector('[data-copy]');
    var code = document.querySelector('[data-contract]');
    if (btn && code && navigator.clipboard) {
      btn.hidden = false;
      btn.addEventListener('click', function () {
        navigator.clipboard.writeText(code.textContent.trim()).then(function () {
          var was = btn.textContent; btn.textContent = 'Copied'; btn.setAttribute('aria-live','polite');
          setTimeout(function () { btn.textContent = was; }, 1600);
        }, function () {});
      });
    }
  } catch (e) {}

  try {
    // EVERY pill, not just the one in the verification section. The header
    // carries a second copy of the same claim, and updating one while leaving
    // the other is how a page ends up saying "Not verified" beside "Verified".
    var pills = document.querySelectorAll('[data-badge-pill]');
    var summary = document.querySelector('[data-badge-summary]');
    if (!pills.length || !window.fetch) return;
    fetch(${js(view.verification.badgeStatusUrl)}, { credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.state) return;
        var map = ${js(Object.fromEntries(
    Object.entries(VERIFICATION_LABELS).map(([k, v]) => [k, { label: v.label, tone: v.tone, summary: v.summary }]),
  ))};
        var alias = { verified: 'active' };
        var next = map[alias[data.state] || data.state];
        if (!next) return;
        for (var i = 0; i < pills.length; i++) {
          pills[i].textContent = next.label;
          pills[i].className = 'pill ' + next.tone;
        }
        // The SENTENCE moves with the label. Leaving it behind is worse than not
        // re-checking at all: a stale badge is one wrong claim, a half-updated
        // page is two contradictory ones, and a reader cannot tell which to
        // believe.
        if (summary) summary.textContent = next.summary;
        // Term dates belong to the verification that has just been superseded,
        // so they are removed rather than left asserting a validity window for a
        // state that no longer has one.
        if (next.label !== ${js(VERIFICATION_LABELS[view.verification.state].label)}) {
          var rows = document.querySelector('[data-badge-rows]');
          if (rows) rows.remove();
        }
      })
      .catch(function () {});
  } catch (e) {}
})();
</script>
</body>
</html>`;
}

// A minimal, honest page for a request that never identified a token at all.
// Kept separate from renderProfileHtml because there is no view to render: an
// unsupported chain has no contract to show and no score to withhold.
export function renderRejectionHtml(reason, { origin = siteOrigin() } = {}) {
  // 'unavailable' is the 503 path and must NOT reuse the invalid-address copy:
  // telling someone their perfectly good contract address is malformed, because
  // OUR blob store timed out, sends them off to debug something that is not
  // wrong. Each reason gets the sentence that is actually true.
  const COPY = {
    unsupported_chain: {
      heading: 'Profile not found',
      body: 'KHAN Trust does not support that blockchain.',
    },
    invalid_contract: {
      heading: 'Profile not found',
      body: 'That does not look like a valid contract address for this chain.',
    },
    unavailable: {
      heading: 'Temporarily unavailable',
      body: 'KHAN Trust could not load this profile just now. This is our problem, not yours — please try again shortly.',
    },
  };
  const copy = COPY[reason] || COPY.invalid_contract;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(copy.heading)} | KHAN Trust</title>
<meta name="description" content="KHAN Trust could not resolve this token profile URL." />
<meta name="robots" content="noindex,follow" />
<style>${STYLES}</style>
</head>
<body><div class="wrap">
<header class="site"><a class="mark" href="${attr(origin)}/" aria-label="KHAN Trust home">K</a><div><b>KHAN Trust</b><small>The AI trust layer of Web3</small></div></header>
<main><section class="card">
<h1>${escapeHtml(copy.heading)}</h1>
<p class="sub">${escapeHtml(copy.body)}</p>
<div class="cta"><a class="btn primary" href="${attr(origin)}/">Scan a token on KHAN Trust</a></div>
</section></main>
</div></body>
</html>`;
}

function htmlResponse(statusCode, body, { cache, robots } = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Short edge cache. Long enough that a crawl or a burst of shares does not
      // re-invoke this function per view; short enough that a revocation becomes
      // visible while the admin who performed it is still watching — the same
      // trade, and very nearly the same number, as BADGE_CACHE_CONTROL.
      'Cache-Control': cache || 'public, max-age=120, s-maxage=300',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      ...(robots ? { 'X-Robots-Tag': robots } : {}),
    },
    body,
  };
}

export async function handler(event) {
  try {
    if (event.httpMethod !== 'GET' && event.httpMethod !== 'HEAD') {
      return { statusCode: 405, headers: { 'Content-Type': 'text/plain' }, body: 'Method not allowed' };
    }

    const origin = siteOrigin();
    const { chain, contract } = resolveTarget(event);
    if (!chain || !contract) {
      return htmlResponse(404, renderRejectionHtml('invalid_contract', { origin }), {
        cache: 'public, max-age=60',
        robots: 'noindex,follow',
      });
    }

    const result = await buildProfileView({ chain, contract, origin });
    if (!result.ok) {
      return htmlResponse(404, renderRejectionHtml(result.reason, { origin }), {
        cache: 'public, max-age=300',
        robots: 'noindex,follow',
      });
    }

    const { view } = result;

    // Fire-and-forget. The page must never wait on analytics, and an event-store
    // outage must never turn a working public page into an error — the whole
    // reason this goes through the durable queue is that the alternative is
    // either blocking the render or losing the event.
    recordEvent({
      name: PRODUCT_EVENTS.PROJECT_PROFILE_VIEWED,
      chain: view.chain,
      contract: view.contract,
      source: event.headers?.referer || event.headers?.Referer || '',
      metadata: { verification: view.verification.state, indexable: view.indexable },
    }).catch(() => {});

    const html = renderProfileHtml(view, { origin, notFound: !view.exists });

    // See the header: a well-formed address we hold nothing about is a 404 with
    // a useful body, not a 200 placeholder. The body is identical either way —
    // only the status and the robots directive differ, so a human sees no
    // difference and a crawler sees the truth.
    if (!view.exists) {
      return htmlResponse(404, html, { cache: 'public, max-age=120', robots: 'noindex,follow' });
    }
    return htmlResponse(200, html, {
      robots: view.indexable ? undefined : 'noindex,follow',
    });
  } catch (error) {
    // No stack, no message, no store internals. The visitor gets a page, the
    // operator gets the detail in the function log, and a crawler gets a status
    // that means "come back" rather than "delist this".
    console.error(`[token-profile] render failed: ${error.stack || error.message}`);
    return {
      statusCode: 503,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Retry-After': '120',
        'X-Robots-Tag': 'noindex,follow',
      },
      body: renderRejectionHtml('unavailable', { origin: siteOrigin() }),
    };
  }
}
