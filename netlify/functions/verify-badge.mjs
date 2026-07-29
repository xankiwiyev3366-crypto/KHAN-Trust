// GET /badge/:projectId  (rewritten in netlify.toml)
// GET /badge/:projectId?contract=<addr>&chain=<id>
// GET /.netlify/functions/verify-badge?contract=<addr>&chain=<id>
//
// The embeddable SVG badge. Direction 4 — Verification-as-Network: KHAN's
// rarest, least-copyable asset is signature-proven project ownership, and a
// badge projects put on their own sites turns it into a two-sided network while
// earning backlinks that compound the /token/* SEO surface.
//
// PHASE 3 CHANGED TWO THINGS AND KEPT EVERYTHING ELSE.
//
//   1. Five states instead of two. "Pending", "Expired" and "Revoked" were
//      previously all flattened into "Unverified", which is true but useless:
//      an owner mid-review and an owner whose year lapsed both need to know
//      which one they are, and the badge is the surface they are actually
//      looking at.
//   2. It can be addressed by CONTRACT, not only by an internal project id. An
//      external site owner knows their contract address; they have no reason to
//      know a KHAN Trust project id. The projectId form still works — embeds
//      using it are already live and a URL that has been published is a promise.
//
// The state itself is decided in _badgeState.mjs, shared with the JSON endpoint
// the JavaScript widget calls, so the two transports cannot disagree.
//
// NOTHING THE CALLER SENDS CAN PRODUCE A STATE. The query string carries an
// address and a chain name. There is no `status`, `verified` or `score`
// parameter, and adding one would end the product: a badge whose host page can
// influence what it says is a badge that says whatever that page wants.
import { readStatuses } from './_verificationStore.mjs';
import {
  BADGE_STATES,
  BADGE_CACHE_CONTROL,
  resolveBadgeState,
  parseBadgeTarget,
  candidateKeys,
  lookupRecord,
} from './_badgeState.mjs';

function escapeXml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// What each state says and what colour it says it in.
//
// Only VERIFIED gets a positive colour. Gold — this product's "good" colour —
// is not used at all: it was previously doing persuasive work for a "Rated"
// claim that had nothing behind it, and reintroducing it for a pending or
// expired badge would repeat the same trick more quietly.
const STATE_PRESENTATION = {
  [BADGE_STATES.VERIFIED]: { text: 'Verified ✓', color: '#2f9e5f', width: 74 },
  [BADGE_STATES.UNVERIFIED]: { text: 'Unverified', color: '#6b6b6b', width: 70 },
  [BADGE_STATES.PENDING]: { text: 'Pending', color: '#8a7326', width: 56 },
  [BADGE_STATES.EXPIRED]: { text: 'Expired', color: '#7a5c2e', width: 54 },
  [BADGE_STATES.REVOKED]: { text: 'Revoked', color: '#a33a2f', width: 60 },
};

// Pure, side-effect-free renderer so it can be unit-tested without Blobs.
// Shields-style two-segment badge.
//
// Every dynamic value is escaped, and every one of them comes from the table
// above rather than from the request — there is deliberately no path by which
// caller input reaches the SVG body. That is stricter than escaping alone:
// escaping protects against injection, a closed vocabulary protects against a
// badge being made to say something true-looking that we never authorised.
export function renderBadgeSvg(state) {
  const presentation = STATE_PRESENTATION[state] || STATE_PRESENTATION[BADGE_STATES.UNVERIFIED];
  const label = 'KHAN Trust';
  const labelWidth = 78;
  const valueWidth = presentation.width;
  const total = labelWidth + valueWidth;
  const labelMid = labelWidth / 2;
  const valueMid = labelWidth + valueWidth / 2;
  const accessibleName = `${label}: ${presentation.text}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${escapeXml(accessibleName)}">
<title>${escapeXml(accessibleName)}</title>
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${total}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)">
<rect width="${labelWidth}" height="20" fill="#0d0d0d"/>
<rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${presentation.color}"/>
<rect width="${total}" height="20" fill="url(#s)"/>
</g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${labelMid}" y="14">${escapeXml(label)}</text>
<text x="${valueMid}" y="14">${escapeXml(presentation.text)}</text>
</g>
</svg>`;
}

export async function handler(event) {
  try {
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, headers: { 'Content-Type': 'text/plain' }, body: 'Method not allowed' };
    }

    const query = event.queryStringParameters || {};
    const projectId = String(query.projectId || '').trim();
    const rawContract = String(query.contract || '').trim();

    // A contract, when supplied, must be well-formed for its chain. An
    // unparseable address or an unknown chain is not an error page — a broken
    // <img> on a customer's website helps nobody — it is an honest "we have not
    // verified this", rendered as a normal badge.
    let keys = [];
    if (rawContract) {
      const target = parseBadgeTarget({ contract: rawContract, chain: query.chain });
      if (target.ok) {
        keys = candidateKeys({ contract: target.contract, chain: target.chain, projectId });
      } else if (projectId) {
        keys = candidateKeys({ projectId });
      }
    } else if (projectId) {
      keys = candidateKeys({ projectId });
    }

    let state = BADGE_STATES.UNVERIFIED;
    if (keys.length) {
      try {
        const statuses = await readStatuses();
        state = resolveBadgeState(lookupRecord(statuses, keys));
      } catch {
        // Fail closed. An unreadable store is not evidence of verification.
        state = BADGE_STATES.UNVERIFIED;
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': BADGE_CACHE_CONTROL,
        // The SVG is a public image with no cookies, no auth and no
        // per-requester variation, so it may be read cross-origin. Stated
        // explicitly rather than relied upon: <img> does not need CORS, but a
        // site fetching the badge to inline it does, and there is nothing here
        // worth withholding.
        'Access-Control-Allow-Origin': '*',
        // No user-specific input is read, so nothing may be varied on. Saying
        // so stops a CDN inventing a cache key from a header we never used.
        'Vary': 'Accept-Encoding',
        'X-Content-Type-Options': 'nosniff',
      },
      body: renderBadgeSvg(state),
    };
  } catch (error) {
    return { statusCode: 500, headers: { 'Content-Type': 'text/plain' }, body: `verify-badge error: ${error.message}` };
  }
}
