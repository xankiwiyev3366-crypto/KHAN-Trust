// Persistence layer for the Support & Messaging Center. Uses Netlify Blobs
// (same pattern as _verificationStore.mjs) so tickets survive across
// deploys/instances. Tickets are a single JSON array - fine at this volume;
// swap for a real database first if ticket count grows large.
import { getNamedStore, jsonResponse } from './_blobsClient.mjs';

const STORE_NAME = 'khan-trust-support';
const TICKETS_KEY = 'tickets.json';
const RATE_LIMIT_KEY = 'rate-limit.json';

function store() {
  return getNamedStore(STORE_NAME);
}

export async function readTickets() {
  const data = await store().get(TICKETS_KEY, { type: 'json' });
  return Array.isArray(data) ? data : [];
}

export async function writeTickets(tickets) {
  await store().setJSON(TICKETS_KEY, tickets);
}

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX = 5;

// IP-based submission throttling. Stored server-side (not in-memory) since
// Netlify Functions are stateless/ephemeral between invocations.
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
  // Opportunistically prune identifiers with no recent activity so the map
  // doesn't grow unbounded.
  for (const key of Object.keys(map)) {
    if (!map[key].some((ts) => now - ts < RATE_LIMIT_WINDOW_MS)) delete map[key];
  }
  await store().setJSON(RATE_LIMIT_KEY, map);
  return true;
}

export { jsonResponse };
