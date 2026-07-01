// GET (rewritten from /sitemap.xml, see netlify.toml)
// Generates the sitemap from the shared Trust Graph Corpus so every scored
// token's /token/<contract> page is discoverable by search engines. Purely
// additive - it only reads the corpus index (Direction 1) and emits XML.
import { readIndex } from './_tokenCorpusStore.mjs';

const SITE_URL = (process.env.URL || 'https://khantrust.net').replace(/\/$/, '');
const MAX_URLS = 5000;

function escapeXml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function handler(event) {
  try {
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, headers: { 'Content-Type': 'text/plain' }, body: 'Method not allowed' };
    }

    let entries = [];
    try {
      const index = await readIndex();
      entries = Object.values(index)
        .filter((entry) => entry && entry.contract)
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
        .slice(0, MAX_URLS);
    } catch {
      entries = [];
    }

    const staticUrls = [
      { loc: `${SITE_URL}/`, priority: '1.0' },
    ];

    const urls = [
      ...staticUrls.map((u) => `<url><loc>${escapeXml(u.loc)}</loc><priority>${u.priority}</priority></url>`),
      ...entries.map((entry) => {
        const loc = `${SITE_URL}/token/${encodeURIComponent(entry.contract)}`;
        const lastmod = String(entry.updatedAt || '').slice(0, 10);
        return `<url><loc>${escapeXml(loc)}</loc>${lastmod ? `<lastmod>${escapeXml(lastmod)}</lastmod>` : ''}<priority>0.6</priority></url>`;
      }),
    ];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=600, s-maxage=3600',
      },
      body: xml,
    };
  } catch (error) {
    return { statusCode: 500, headers: { 'Content-Type': 'text/plain' }, body: `sitemap error: ${error.message}` };
  }
}
