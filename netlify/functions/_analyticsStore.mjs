// Shared persistence layer for the Internal Analytics Dashboard.
// Single source of truth: every tracked event is appended to one capped
// event log in Netlify Blobs. All dashboard metrics (scans, visitors,
// rankings, trust score distribution, traffic sources, verification rates,
// etc.) are derived from this one log at read time in analytics-summary.mjs
// rather than kept as separately-updated counters, so there is no risk of
// duplicate-counting or drift between two parallel aggregates.
import { getNamedStore, jsonResponse } from './_blobsClient.mjs';

const STORE_NAME = 'khan-trust-analytics';
const EVENTS_KEY = 'events.json';
// Cap the log so a single Lambda invocation can always read/write it in one
// shot. At this platform's scale this comfortably covers months of activity;
// revisit (e.g. move to day-bucketed keys) if volume grows much higher.
const MAX_EVENTS = 20000;

function store() {
  return getNamedStore(STORE_NAME);
}

export async function readEvents() {
  const data = await store().get(EVENTS_KEY, { type: 'json' });
  return Array.isArray(data) ? data : [];
}

export async function appendEvent(event) {
  const events = await readEvents();
  events.push(event);
  const capped = events.length > MAX_EVENTS ? events.slice(events.length - MAX_EVENTS) : events;
  await store().setJSON(EVENTS_KEY, capped);
  return capped.length;
}

export { jsonResponse };
