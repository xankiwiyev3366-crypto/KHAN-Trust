// Shared persistence layer for the Verified Project system.
// Uses Netlify Blobs so verification requests and statuses survive across
// deploys/instances instead of living only in a browser's localStorage.
import { getStore } from '@netlify/blobs';

const STORE_NAME = 'khan-trust-verification';
const REQUESTS_KEY = 'requests.json';
const STATUSES_KEY = 'statuses.json';

// Zero-config getStore(name) relies on Netlify injecting a Blobs execution
// context into the function runtime automatically. On this site that
// context is not present ("The environment has not been configured to use
// Netlify Blobs..."), so we fall back to explicit credentials. Set these in
// Netlify (Site configuration -> Environment variables):
//   NETLIFY_SITE_ID         - Site configuration -> General -> Site details -> Site ID
//   NETLIFY_BLOBS_TOKEN     - a Personal Access Token from User settings -> Applications -> New access token
const SITE_ID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
const BLOBS_TOKEN = process.env.NETLIFY_BLOBS_TOKEN;

// TEMPORARY diagnostic - masked, no secrets leaked. Remove once the 400 from
// the Blobs API is root-caused (see investigation in netlify functions PR).
function diagnostics() {
  return {
    siteIdPresent: Boolean(SITE_ID),
    siteIdLength: SITE_ID ? SITE_ID.length : 0,
    siteIdLooksLikeUuid: SITE_ID ? /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(SITE_ID) : false,
    tokenPresent: Boolean(BLOBS_TOKEN),
    tokenLength: BLOBS_TOKEN ? BLOBS_TOKEN.length : 0,
    tokenPrefix: BLOBS_TOKEN ? BLOBS_TOKEN.slice(0, 4) : null,
  };
}

function store() {
  try {
    if (SITE_ID && BLOBS_TOKEN) {
      return getStore({ name: STORE_NAME, siteID: SITE_ID, token: BLOBS_TOKEN });
    }
    return getStore(STORE_NAME);
  } catch (error) {
    throw new Error(`Netlify Blobs getStore("${STORE_NAME}") failed: ${error.message}. diagnostics=${JSON.stringify(diagnostics())}`);
  }
}

async function withDiagnostics(fn) {
  try {
    return await fn();
  } catch (error) {
    error.message = `${error.message} diagnostics=${JSON.stringify(diagnostics())}`;
    throw error;
  }
}

export async function readRequests() {
  return withDiagnostics(async () => {
    const data = await store().get(REQUESTS_KEY, { type: 'json' });
    return Array.isArray(data) ? data : [];
  });
}

export async function writeRequests(requests) {
  return withDiagnostics(() => store().setJSON(REQUESTS_KEY, requests));
}

export async function readStatuses() {
  return withDiagnostics(async () => {
    const data = await store().get(STATUSES_KEY, { type: 'json' });
    return data && typeof data === 'object' ? data : {};
  });
}

export async function writeStatuses(statuses) {
  return withDiagnostics(() => store().setJSON(STATUSES_KEY, statuses));
}

export function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
