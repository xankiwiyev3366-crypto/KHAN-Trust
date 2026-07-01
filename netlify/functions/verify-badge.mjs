// GET (rewritten from /badge/:projectId, see netlify.toml)
// Returns an embeddable SVG "Verified by KHAN Trust" badge for one project,
// read from the EXISTING verification store (no verification logic changes).
// This is Direction 4 - Verification-as-Network: KHAN's rarest, least-copyable
// asset is signature-proven project ownership. Turning it into a badge projects
// embed on their own sites creates a two-sided trust network (projects prove
// themselves -> users trust the KHAN badge -> more of both) AND earns backlinks
// that compound the SEO surface from Direction 2. Additive: a brand-new
// /badge/* surface that touches nothing existing.
import { readStatuses } from './_verificationStore.mjs';

function escapeXml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Pure, side-effect-free SVG renderer so it can be unit-tested without Blobs.
// Shields-style two-segment badge. Verified projects get the green "Verified"
// treatment; anything else gets a neutral gold "Rated" badge that still links
// back to KHAN Trust (a useful backlink without ever falsely implying
// verification).
export function renderBadgeSvg(status) {
  const verified = status === 'verified';
  const label = 'KHAN Trust';
  const value = verified ? 'Verified ✓' : 'Rated';
  const valueColor = verified ? '#2f9e5f' : '#c9a227';
  const labelWidth = 78;
  const valueWidth = verified ? 74 : 52;
  const total = labelWidth + valueWidth;
  const labelMid = labelWidth / 2;
  const valueMid = labelWidth + valueWidth / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${escapeXml(label)}: ${escapeXml(value)}">
<title>${escapeXml(label)}: ${escapeXml(value)}</title>
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${total}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)">
<rect width="${labelWidth}" height="20" fill="#0d0d0d"/>
<rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${valueColor}"/>
<rect width="${total}" height="20" fill="url(#s)"/>
</g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${labelMid}" y="14">${escapeXml(label)}</text>
<text x="${valueMid}" y="14">${escapeXml(value)}</text>
</g>
</svg>`;
}

export async function handler(event) {
  try {
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, headers: { 'Content-Type': 'text/plain' }, body: 'Method not allowed' };
    }
    const projectId = (event.queryStringParameters?.projectId || '').trim();
    let status = 'unverified';
    if (projectId) {
      try {
        const statuses = await readStatuses();
        status = statuses[projectId]?.status || 'unverified';
      } catch {
        status = 'unverified';
      }
    }
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        // Short cache so a freshly-approved verification shows up quickly, but
        // embeds still load fast.
        'Cache-Control': 'public, max-age=300, s-maxage=600',
      },
      body: renderBadgeSvg(status),
    };
  } catch (error) {
    return { statusCode: 500, headers: { 'Content-Type': 'text/plain' }, body: `verify-badge error: ${error.message}` };
  }
}
