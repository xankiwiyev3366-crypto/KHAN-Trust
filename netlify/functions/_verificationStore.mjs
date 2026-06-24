// Shared persistence layer for the Verified Project system.
// Uses Netlify Blobs so verification requests and statuses survive across
// deploys/instances instead of living only in a browser's localStorage.
import { getStore } from '@netlify/blobs';

const STORE_NAME = 'khan-trust-verification';
const REQUESTS_KEY = 'requests.json';
const STATUSES_KEY = 'statuses.json';

// Netlify automatically injects a correct SITE_ID (a UUID) into every
// function's environment - no manual setup needed for it. Prefer that over
// any manually-set NETLIFY_SITE_ID, which previously caused a 400 from the
// Blobs API because the manually-pasted value (24 chars, not UUID-shaped)
// was the site's name/slug rather than its actual Site ID.
const SITE_ID = process.env.SITE_ID || process.env.NETLIFY_SITE_ID;
// Zero-config getStore(name) relies on Netlify injecting a Blobs execution
// context automatically, which is absent on this site, so a Personal Access
// Token is required: Netlify dashboard -> User settings -> Applications ->
// New access token -> set as NETLIFY_BLOBS_TOKEN env var.
const BLOBS_TOKEN = process.env.NETLIFY_BLOBS_TOKEN;

function store() {
  try {
    if (SITE_ID && BLOBS_TOKEN) {
      return getStore({ name: STORE_NAME, siteID: SITE_ID, token: BLOBS_TOKEN });
    }
    return getStore(STORE_NAME);
  } catch (error) {
    throw new Error(`Netlify Blobs getStore("${STORE_NAME}") failed: ${error.message}`);
  }
}

export async function readRequests() {
  const data = await store().get(REQUESTS_KEY, { type: 'json' });
  return Array.isArray(data) ? data : [];
}

export async function writeRequests(requests) {
  await store().setJSON(REQUESTS_KEY, requests);
}

export async function readStatuses() {
  const data = await store().get(STATUSES_KEY, { type: 'json' });
  return data && typeof data === 'object' ? data : {};
}

export async function writeStatuses(statuses) {
  await store().setJSON(STATUSES_KEY, statuses);
}

export function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
