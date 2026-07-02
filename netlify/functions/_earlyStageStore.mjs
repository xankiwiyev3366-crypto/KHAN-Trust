// Persistence layer for the "Early Stage Projects" feature - crypto projects
// that are still pre-launch (idea / building / testnet / pre-sale / etc.) and
// want to join KHAN Trust before launching publicly. Same pattern as
// _reportStore.mjs / _supportStore.mjs: Netlify Blobs holding a single JSON
// array, plus a server-side IP rate-limit map (Netlify Functions are stateless
// between invocations, so an in-memory limiter would not work).
//
// This is a fully self-contained, additive store: it shares nothing with the
// existing project/score/verification stores, so nothing it does can affect
// AI Trust Score, Risk Analysis, Search, Explore, Verification, Watchlist,
// Compare, Analytics, or the Launchpad.
import { getNamedStore, jsonResponse } from './_blobsClient.mjs';

const STORE_NAME = 'khan-trust-early-stage';
const PROJECTS_KEY = 'early-stage-projects.json';
const RATE_LIMIT_KEY = 'rate-limit.json';

function store() {
  return getNamedStore(STORE_NAME);
}

export async function readEarlyStageProjects() {
  const data = await store().get(PROJECTS_KEY, { type: 'json' });
  return Array.isArray(data) ? data : [];
}

export async function writeEarlyStageProjects(projects) {
  await store().setJSON(PROJECTS_KEY, projects);
}

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX = 5;

// IP-based submission throttling, mirroring the Report/Support limiters.
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

// Canonical option lists, shared by the submit + admin endpoints so the
// server validates against exactly what the UI offers. Kept here (not in the
// client) because the server is the source of truth for what it will store.
export const VALID_STAGES = [
  'idea',
  'building',
  'private_testing',
  'public_beta',
  'testnet',
  'pre_sale',
  'launching_soon',
  'mainnet_live',
];

export const VALID_STATUSES = ['pending', 'approved', 'rejected', 'archived'];

export function getClientIp(event) {
  return (
    event.headers?.['x-nf-client-connection-ip'] ||
    event.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
    'unknown'
  );
}

export function sanitizeText(value, maxLength) {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .trim()
    .slice(0, maxLength);
}

// A project is publicly visible only once an admin has approved it and it is
// neither hidden nor archived. Everything else stays admin-only.
export function isPubliclyVisible(project) {
  return project.status === 'approved' && !project.hidden;
}

export { jsonResponse };
