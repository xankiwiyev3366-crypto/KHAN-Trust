// GET /.netlify/functions/verify-badge-status?contract=<addr>&chain=<id>
// GET /.netlify/functions/verify-badge-status?projectId=<id>
//
// The JSON transport of the badge. Read cross-origin by public/badge.js on
// third-party websites, which is the only reason it exists separately from the
// SVG: a script cannot read pixels, and re-deriving the state client-side from
// something the client already had would defeat the point.
//
// WHY NOT verification-status.mjs, WHICH ALREADY RETURNS STATUSES
//
// That endpoint returns the ENTIRE map — every project the platform has ever
// reviewed, including everything pending. Pointing a widget on an arbitrary
// website at it would publish the whole review queue to every visitor of every
// site that embedded a badge, and make each of them download it. This returns
// exactly one project, which is all a badge can possibly need.
//
// The state comes from the same resolveBadgeState() the SVG uses, so the two
// transports cannot drift.
//
// WHAT IS DELIBERATELY NOT RETURNED
//
// No owner wallet, no order id, no tier, no admin note, no payment data, no
// badge token. A widget needs to know what to draw and where to link. Anything
// beyond that would be published to every visitor of every embedding site, and
// the only reason to include it would be that it was convenient.
import { readStatuses } from './_verificationStore.mjs';
import { jsonResponse } from './_blobsClient.mjs';
import {
  BADGE_STATES,
  BADGE_CACHE_CONTROL,
  resolveBadgeState,
  parseBadgeTarget,
  candidateKeys,
  lookupRecord,
  profileUrl,
  siteOrigin,
} from './_badgeState.mjs';

// Public, unauthenticated, no cookies, no credentials. `*` is correct and is
// not a weakening: this is the same data the SVG already serves to anyone, and
// a widget's whole job is to run on origins we do not know in advance.
//
// Access-Control-Allow-Credentials is deliberately absent — with `*` it would
// be rejected by browsers anyway, and its presence would suggest this endpoint
// has a notion of a signed-in caller. It does not, and must not: a badge whose
// answer varied by viewer would be uncacheable and unauditable.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': BADGE_CACHE_CONTROL,
      'X-Content-Type-Options': 'nosniff',
      'Vary': 'Accept-Encoding',
      ...CORS_HEADERS,
    },
    body: JSON.stringify(body),
  };
}

export async function handler(event) {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: CORS_HEADERS, body: '' };
    }
    if (event.httpMethod !== 'GET') {
      return respond(405, { message: 'Method not allowed' });
    }

    const query = event.queryStringParameters || {};
    const projectId = String(query.projectId || '').trim();
    const rawContract = String(query.contract || '').trim();

    let target = null;
    if (rawContract) {
      target = parseBadgeTarget({ contract: rawContract, chain: query.chain });
      if (!target.ok && !projectId) {
        // 200, NOT 4xx. A malformed address on someone's website should render
        // an honest "Unverified" badge, not a broken one — an error status
        // makes the widget look broken when what is actually true is simply
        // that we have not verified whatever they typed. `reason` is returned
        // so the embedder can debug their own snippet.
        return respond(200, {
          state: BADGE_STATES.UNVERIFIED,
          reason: target.reason,
          // No profile link: there is no canonical page for an address that
          // cannot be parsed, and inventing one would send visitors to a 404.
          profileUrl: null,
          checkedAt: new Date().toISOString(),
        });
      }
    }

    if (!target?.ok && !projectId) {
      return respond(200, {
        state: BADGE_STATES.UNVERIFIED,
        reason: 'missing_contract',
        profileUrl: null,
        checkedAt: new Date().toISOString(),
      });
    }

    const keys = candidateKeys({
      contract: target?.ok ? target.contract : '',
      chain: target?.ok ? target.chain : '',
      projectId,
    });

    let record = null;
    try {
      record = lookupRecord(await readStatuses(), keys);
    } catch {
      // Fail closed, exactly as the SVG does. An unreadable store is not
      // evidence of verification.
      record = null;
    }

    const state = resolveBadgeState(record);

    return respond(200, {
      state,
      chain: target?.ok ? target.chain : null,
      contract: target?.ok ? target.contract : null,
      // The canonical profile — /token/<contract>, the surface that already
      // exists. Never a /t/ route: a second URL for one token splits its
      // ranking, and every badge is a backlink pointing at whichever we choose.
      profileUrl: target?.ok ? profileUrl(target.contract) : siteOrigin(),
      // Only present when there is one. A verified badge with no expiry is a
      // pre-paid admin approval and is permanent; sending `null` says that
      // plainly rather than implying an unknown date.
      verifiedUntil: state === BADGE_STATES.VERIFIED ? (record?.expiresAt || null) : null,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    return respond(500, { message: `verify-badge-status crashed: ${error.message}` });
  }
}

export { jsonResponse };
