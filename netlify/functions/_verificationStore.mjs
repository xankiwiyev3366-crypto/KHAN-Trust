// Shared persistence layer for the Verified Project system.
// Uses Netlify Blobs so verification requests and statuses survive across
// deploys/instances instead of living only in a browser's localStorage.
import { getStore } from '@netlify/blobs';

const STORE_NAME = 'khan-trust-verification';
const REQUESTS_KEY = 'requests.json';
const STATUSES_KEY = 'statuses.json';

function store() {
  try {
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
