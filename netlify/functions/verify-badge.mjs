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
// Shields-style two-segment badge.
//
// THE BADGE MAY ONLY ASSERT WHAT THIS SERVICE CAN SUBSTANTIATE.
//
// The non-verified branch used to render a gold "Rated" badge. `/badge/:id`
// takes an arbitrary string and never checked that anything existed behind it,
// so `/badge/whatever-i-typed` returned a gold KHAN Trust badge reading
// "Rated". Nothing had rated it. Nothing had ever heard of it. The badge is
// designed to be embedded on someone else's website, which makes it the single
// most portable claim this platform emits — and it was assertable by anyone,
// about anything, for free.
//
// "Rated" also could not be substantiated even in the honest case: a rating
// comes from a completed scan in the corpus, and this function reads the
// VERIFICATION store, which knows only whether an ownership request was
// approved. It never had the fact it was asserting.
//
// So there are two states, and the gold one is gone:
//   verified  -> green "Verified ✓". Provable: an owner signed with the
//                controlling wallet and an admin approved it.
//   anything  -> neutral grey "Unverified". True of a rejected project, a
//   else        pending one, and a project id that does not exist, without
//                distinguishing between them — review state is not public, and
//                a badge is the wrong place to leak it.
//
// Every badge KHAN Trust itself hands out is the verified one: VerifiedBadgeEmbed
// in src/main.jsx renders the snippet only on a verified project's profile. So
// this narrowing costs no legitimate embed anything.
export function renderBadgeSvg(status) {
  const verified = status === 'verified';
  const label = 'KHAN Trust';
  const value = verified ? 'Verified ✓' : 'Unverified';
  // Grey, not gold. Gold is this product's "good" colour and it was doing
  // persuasive work on behalf of a claim that did not exist.
  const valueColor = verified ? '#2f9e5f' : '#6b6b6b';
  const labelWidth = 78;
  const valueWidth = verified ? 74 : 70;
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
