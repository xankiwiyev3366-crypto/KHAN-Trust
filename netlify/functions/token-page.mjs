// GET (rewritten from /token/:contract, see netlify.toml)
// Server-rendered, crawlable trust page for one token, built from the shared
// Trust Graph Corpus (Direction 1). This is the SEO surface the SPA could
// never provide: the KHAN Trust app is a client-only hash-routed SPA, so
// Google sees nothing. These path-based pages give every scored token a real,
// indexable URL with the trust verdict in the title/meta/JSON-LD - capturing
// the enormous "is <token> a scam / <token> rug check" search intent that
// drives competitors' organic traffic.
//
// ADDITIVE and non-breaking: this is a brand-new /token/* surface. It does not
// touch, intercept, or change any existing SPA route (which are all hash
// routes under "/#/..."). Humans who land here get the verdict plus a CTA
// that opens the live interactive report in the SPA (/?scan=<contract>, wired
// additively in src/main.jsx); crawlers get fully-rendered HTML.
import { getCorpusToken, jsonResponse } from './_tokenCorpusStore.mjs';

const SITE_URL = (process.env.URL || 'https://khantrust.net').replace(/\/$/, '');

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeIdentity(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (/^(c:|id:)/i.test(value)) return value;
  return `c:${value.toLowerCase()}`;
}

function riskWord(riskLevel) {
  const level = String(riskLevel || 'Medium');
  if (level === 'Low') return 'lower-risk';
  if (level === 'High') return 'higher-risk';
  return 'medium-risk';
}

// Pure, side-effect-free HTML renderer so it can be unit-tested by calling it
// with a plain token object (no Netlify Blobs needed). The handler below just
// fetches the corpus record and delegates here.
export function renderTokenHtml(token, { contract }) {
  const safeContract = escapeHtml(contract);
  const scanUrl = `${SITE_URL}/?scan=${encodeURIComponent(contract)}`;

  if (!token) {
    const title = `Token trust check — KHAN Trust`;
    // noindex: don't let Google index empty "not yet analyzed" pages, but
    // still serve a useful page to a human who followed the link.
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex,follow" />
<title>${title}</title>
<meta name="description" content="This token has not been analyzed on KHAN Trust yet. Run a free trust scan to see its Trust Score, risk level, holder concentration, and contract security." />
<link rel="canonical" href="${SITE_URL}/token/${safeContract}" />
</head>
<body>
<main>
<h1>Token not analyzed yet</h1>
<p>KHAN Trust has not scored <code>${safeContract}</code> yet.</p>
<p><a href="${escapeHtml(scanUrl)}">Run a free KHAN Trust scan &rarr;</a></p>
<p><a href="${SITE_URL}/">KHAN Trust — the AI trust layer of Web3</a></p>
</main>
</body>
</html>`;
  }

  const name = escapeHtml(token.name || token.ticker || 'Token');
  const ticker = escapeHtml(token.ticker || '');
  const chain = escapeHtml(token.chain || '');
  const category = escapeHtml(token.category || '');
  const score = Number(token.trustScore);
  const scoreText = Number.isFinite(score) ? `${score}/100` : 'unrated';
  const risk = escapeHtml(token.riskLevel || 'Medium');
  const updated = escapeHtml((token.updatedAt || '').slice(0, 10));
  const tickerSuffix = ticker ? ` (${ticker})` : '';

  const title = `${name}${tickerSuffix} Trust Score: ${scoreText} — KHAN Trust`;
  const description = `${name}${tickerSuffix} has a KHAN Trust Score of ${scoreText} (${riskWord(risk)})${category ? `, classified as ${category}` : ''}${chain ? ` on ${chain}` : ''}. See the full explainable risk breakdown — holder concentration, liquidity, and contract security — on KHAN Trust.`;
  const canonical = `${SITE_URL}/token/${safeContract}`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Rating',
    name: `${token.name || token.ticker || 'Token'} KHAN Trust Score`,
    ratingValue: Number.isFinite(score) ? score : undefined,
    bestRating: 100,
    worstRating: 0,
    ratingExplanation: description,
    url: canonical,
  };
  // Neutralize "<" so a token field containing "</script>" or "<!--" can never
  // break out of the ld+json script block (JSON-LD injection). The corpus
  // already strips HTML on write, but this pure renderer must be safe on its
  // own inputs regardless.
  const jsonLdSafe = JSON.stringify(jsonLd).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}" />
<link rel="canonical" href="${canonical}" />
<meta property="og:type" content="website" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:url" content="${canonical}" />
<meta name="twitter:card" content="summary" />
<meta name="twitter:title" content="${escapeHtml(title)}" />
<meta name="twitter:description" content="${escapeHtml(description)}" />
<script type="application/ld+json">${jsonLdSafe}</script>
</head>
<body>
<main>
<h1>${name}${tickerSuffix}</h1>
<p><strong>KHAN Trust Score:</strong> ${escapeHtml(scoreText)}</p>
<p><strong>Risk level:</strong> ${risk}</p>
${category ? `<p><strong>Category:</strong> ${category}</p>` : ''}
${chain ? `<p><strong>Chain:</strong> ${chain}</p>` : ''}
${updated ? `<p><strong>Last analyzed:</strong> ${updated}</p>` : ''}
<p>KHAN Trust scores are explainable and deterministic — every point is traceable to holder concentration, liquidity depth, contract security, token age, and transparency signals. This is not financial advice.</p>
<p><a href="${escapeHtml(scanUrl)}">Open the live interactive report on KHAN Trust &rarr;</a></p>
<p><a href="${SITE_URL}/">KHAN Trust — the AI trust layer of Web3</a></p>
</main>
</body>
</html>`;
}

export async function handler(event) {
  try {
    if (event.httpMethod !== 'GET') {
      return jsonResponse(405, { message: 'Method not allowed' });
    }
    const contract = (event.queryStringParameters?.contract || '').trim();
    if (!contract) {
      return { statusCode: 400, headers: { 'Content-Type': 'text/plain' }, body: 'Missing token' };
    }
    const identity = normalizeIdentity(contract);
    const token = await getCorpusToken(identity);
    const html = renderTokenHtml(token, { contract });
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // Short edge cache so crawlers/users get fast responses without the
        // corpus going stale (mirrors the site's near-real-time posture).
        'Cache-Control': 'public, max-age=120, s-maxage=300',
      },
      body: html,
    };
  } catch (error) {
    return { statusCode: 500, headers: { 'Content-Type': 'text/plain' }, body: `token-page error: ${error.message}` };
  }
}
