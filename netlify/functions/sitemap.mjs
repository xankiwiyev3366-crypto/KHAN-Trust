// GET (rewritten from /sitemap.xml, see netlify.toml)
//
// Generates the sitemap from the shared Trust Graph Corpus so every scored
// token's public profile is discoverable by search engines.
//
// ── PHASE 4 CHANGED TWO THINGS ──────────────────────────────────────────────
//
// 1. THE URLs ARE NOW /t/<chain>/<contract>.
//    /token/<contract> permanently 301s there (token-page.mjs). Listing a URL
//    that redirects is a documented sitemap error: crawlers report it as a
//    warning, spend crawl budget on the hop, and it delays consolidation onto
//    the canonical. A sitemap should contain the destination, never the door.
//
// 2. LOW-QUALITY ENTRIES ARE EXCLUDED, and this is the more consequential one.
//    The corpus index is a record of every token anyone ever scanned, which
//    includes typos, test addresses and tokens whose scan produced nothing.
//    Submitting those tells Google "these are my best pages"; Google disagrees,
//    and the judgement it forms lands on the whole /t/ surface, including the
//    pages that are genuinely good. isEligible() below is deliberately strict:
//    it is better to submit 400 real pages than 5000 with 4600 thin ones.
//
// The eligibility rule is intentionally the SAME predicate the page itself uses
// to decide its robots directive (isProfileIndexable). A page that says noindex
// while the sitemap begs Google to index it is the single most common
// self-inflicted SEO fault there is, and it cannot happen if both read one
// function.
import { getCorpusListingIndex } from './_tokenCorpusStore.mjs';
import { profileUrlFor, isProfileIndexable } from '../../src/lib/publicProfile.js';
import { isSupportedChain, parseBadgeTarget } from './_badgeState.mjs';

const SITE_URL = (process.env.URL || 'https://khantrust.net').replace(/\/$/, '');

// Sitemaps.org caps a single file at 50 000 URLs / 50MB. This is far below that
// and is a QUALITY cap, not a format one: the most recently updated tokens are
// the ones with live interest, and an enormous sitemap of stale entries dilutes
// the crawl budget spent on them.
const MAX_URLS = 5000;

function escapeXml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Would this entry produce a page worth indexing?
//
// Chain and contract are re-validated here rather than trusted from the corpus.
// The corpus is written by a PUBLIC endpoint (token-corpus-record.mjs), and
// while it validates on write, a sitemap is the one place where a malformed
// entry becomes a URL we actively ask a crawler to fetch. Validating again costs
// nothing and means a bad record can only ever be absent, never advertised.
export function isEligible(entry) {
  if (!entry || !entry.contract || !entry.chain) return false;
  if (!isSupportedChain(entry.chain)) return false;
  if (!parseBadgeTarget({ contract: entry.contract, chain: entry.chain }).ok) return false;
  // The same predicate the page uses for its own robots meta — see the header.
  // The sitemap only knows the corpus half of a profile, so it can prove
  // "has a score" but not "has a verification"; a verified-but-unscored token is
  // therefore missed here and still indexable on its own page, which is the safe
  // direction to be wrong in.
  return isProfileIndexable({
    chain: entry.chain,
    contract: entry.contract,
    trustScore: Number.isFinite(entry.trustScore) ? entry.trustScore : null,
  });
}

export function buildSitemapXml(entries, { siteUrl = SITE_URL } = {}) {
  const staticUrls = [
    { loc: `${siteUrl}/`, priority: '1.0', changefreq: 'daily' },
  ];

  const urls = [
    ...staticUrls.map((u) => `<url><loc>${escapeXml(u.loc)}</loc><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`),
    ...entries.map((entry) => {
      const loc = profileUrlFor(siteUrl, entry.chain, entry.contract);
      const lastmod = String(entry.updatedAt || '').slice(0, 10);
      return `<url><loc>${escapeXml(loc)}</loc>${lastmod ? `<lastmod>${escapeXml(lastmod)}</lastmod>` : ''}<changefreq>weekly</changefreq><priority>0.6</priority></url>`;
    }),
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;
}

export async function handler(event) {
  try {
    if (event.httpMethod !== 'GET' && event.httpMethod !== 'HEAD') {
      return { statusCode: 405, headers: { 'Content-Type': 'text/plain' }, body: 'Method not allowed' };
    }

    let entries = [];
    try {
      const index = await getCorpusListingIndex();
      entries = Object.values(index)
        .filter(isEligible)
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
        .slice(0, MAX_URLS);
    } catch (error) {
      // A corpus outage yields the static sitemap, not a 500. A 500 on
      // /sitemap.xml is recorded by Search Console as a site-level fetch error;
      // a valid sitemap with one URL is simply a quiet day.
      console.warn(`[sitemap] corpus unavailable, serving static entries only: ${error.message}`);
      entries = [];
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=600, s-maxage=3600',
      },
      body: buildSitemapXml(entries),
    };
  } catch (error) {
    console.error(`[sitemap] failed: ${error.stack || error.message}`);
    return { statusCode: 503, headers: { 'Content-Type': 'text/plain', 'Retry-After': '300' }, body: 'Temporarily unavailable' };
  }
}
