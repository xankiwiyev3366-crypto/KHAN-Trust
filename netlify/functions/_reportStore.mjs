// Persistence layer for project "Report / Suggest Update" submissions. Same
// pattern as _supportStore.mjs: Netlify Blobs holding a single JSON array,
// plus a server-side IP rate-limit map (Netlify Functions are stateless
// between invocations, so an in-memory limiter would not work).
import { getNamedStore, jsonResponse } from './_blobsClient.mjs';

const STORE_NAME = 'khan-trust-reports';
const REPORTS_KEY = 'reports.json';
const RATE_LIMIT_KEY = 'rate-limit.json';

function store() {
  return getNamedStore(STORE_NAME);
}

export async function readReports() {
  const data = await store().get(REPORTS_KEY, { type: 'json' });
  return Array.isArray(data) ? data : [];
}

export async function writeReports(reports) {
  await store().setJSON(REPORTS_KEY, reports);
}

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX = 5;

// IP-based submission throttling, mirroring the Support ticket limiter.
export async function checkAndRecordRateLimit(identifier) {
  if (!identifier) return true;
  const data = await store().get(RATE_LIMIT_KEY, { type: 'json' });
  const map = data && typeof data === 'object' ? data : {};
  const now = Date.now();
  const recent = (map[identifier] || []).filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) {
    map[identifier] = recent;
    await store().setJSON(RATE_LIMIT_KEY, map);
    return false;
  }
  recent.push(now);
  map[identifier] = recent;
  for (const key of Object.keys(map)) {
    if (!map[key].some((ts) => now - ts < RATE_LIMIT_WINDOW_MS)) delete map[key];
  }
  await store().setJSON(RATE_LIMIT_KEY, map);
  return true;
}

export { jsonResponse };
