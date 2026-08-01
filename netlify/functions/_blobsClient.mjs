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

// One store handle per name, reused for the life of the (warm) function
// instance. Every module here calls getNamedStore() inside a `store()` helper
// on EVERY read, so a hot endpoint constructed hundreds of handles per request
// — each one re-resolving config and standing up its own HTTP client rather
// than reusing the keep-alive connection the previous one had already opened.
// The inputs are process-level environment, so the handle can never go stale
// within an instance.
const handles = new Map();

export function getNamedStore(name) {
  const cached = handles.get(name);
  if (cached) return cached;
  try {
    const store = (SITE_ID && BLOBS_TOKEN)
      ? getStore({ name, siteID: SITE_ID, token: BLOBS_TOKEN })
      : getStore(name);
    handles.set(name, store);
    return store;
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
