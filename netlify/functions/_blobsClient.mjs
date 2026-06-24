// Shared Netlify Blobs connection helper. Netlify automatically injects a
// correct SITE_ID (a UUID) into every function's environment - no manual
// setup needed for it. A manually-set NETLIFY_SITE_ID is only used as a
// fallback if that's somehow absent (and previously caused 400s when its
// value was malformed, i.e. not a real Site ID - see verification store
// history). The Blobs zero-config execution context is not available on
// this site, so a Personal Access Token is required: Netlify dashboard ->
// User settings -> Applications -> New access token -> set as
// NETLIFY_BLOBS_TOKEN env var.
import { getStore } from '@netlify/blobs';

const SITE_ID = process.env.SITE_ID || process.env.NETLIFY_SITE_ID;
const BLOBS_TOKEN = process.env.NETLIFY_BLOBS_TOKEN;

export function getNamedStore(name) {
  try {
    if (SITE_ID && BLOBS_TOKEN) {
      return getStore({ name, siteID: SITE_ID, token: BLOBS_TOKEN });
    }
    return getStore(name);
  } catch (error) {
    throw new Error(`Netlify Blobs getStore("${name}") failed: ${error.message}`);
  }
}

export function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
