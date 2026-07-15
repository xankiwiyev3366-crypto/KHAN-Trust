// Growth Data Plane — the event store the whole Growth OS reads from.
//
// WHY THIS EXISTS (and why it is not _analyticsStore.mjs):
//
// The existing analytics store keeps every event in ONE capped array at a
// single blob key. Every append reads the entire array, pushes one item, and
// writes the whole thing back. That has two defects which are fatal to a growth
// system, both of which get worse exactly as the platform succeeds:
//
//   1. LOST WRITES. Two visitors acting in the same moment both read the array,
//      both append, both write - last write wins and the other event is gone
//      forever. There is no lock. The busier the platform, the more data is
//      silently destroyed.
//   2. A HARD CEILING. At 20 000 events the oldest are dropped. Cohort
//      retention needs months of intact history; the old design guarantees the
//      AI's most valuable input is deleted right when there is finally enough
//      of it to reason about.
//
// THE FIX: events are immutable facts, so they never need read-modify-write.
// Each event is written to its OWN key under a day prefix:
//
//   raw/2026-07-15/evt-1752566400000-a7f3c2.json
//
// A write is a single put with no prior read, so concurrent writes cannot
// collide and nothing is ever lost or truncated. History is unbounded.
//
// The cost of one-key-per-event is read amplification (a day = N gets), so days
// that are finished get COMPACTED into a single `daily/2026-07-15.json` blob by
// growth-compact.mjs. Reads prefer the compacted blob and fall back to listing
// raw keys for days not yet compacted (i.e. today). Compaction is idempotent
// and only ever runs on days in the past, so it can never race a live write.
import { getNamedStore, jsonResponse } from './_blobsClient.mjs';

const STORE_NAME = 'khan-trust-growth';
const RAW_PREFIX = 'raw/';
const DAILY_PREFIX = 'daily/';

function store() {
  return getNamedStore(STORE_NAME);
}

export function dayKey(iso) {
  return String(iso).slice(0, 10);
}

export function rawKeyFor(event) {
  return `${RAW_PREFIX}${dayKey(event.timestamp)}/${event.id}`;
}

export function dailyKeyFor(day) {
  return `${DAILY_PREFIX}${day}`;
}

// ── Write ─────────────────────────────────────────────────────────────────────

// Single put, no read. This is the whole point of the design - see header.
export async function putEvent(event) {
  await store().setJSON(rawKeyFor(event), event);
  return event;
}

// ── Read ──────────────────────────────────────────────────────────────────────

async function readRawDay(day) {
  const s = store();
  const { blobs } = await s.list({ prefix: `${RAW_PREFIX}${day}/` });
  if (!blobs.length) return [];
  // Parallel fetch: a day of raw events is only read before compaction (i.e.
  // today), so this is bounded by one day's traffic, not all history.
  const events = await Promise.all(
    blobs.map((blob) => s.get(blob.key, { type: 'json' }).catch(() => null))
  );
  return events.filter(Boolean);
}

async function readCompactedDay(day) {
  const data = await store().get(dailyKeyFor(day), { type: 'json' }).catch(() => null);
  return Array.isArray(data) ? data : null;
}

// Reads one day, preferring the compacted blob.
//
// The union of compacted + raw is deliberate rather than "compacted OR raw":
// compaction writes the daily blob before deleting the raw keys it consumed, so
// mid-compaction a day can legitimately have both. Deduplicating by event id
// makes a read during that window correct instead of double-counting.
export async function readDay(day) {
  const compacted = await readCompactedDay(day);
  if (!compacted) return readRawDay(day);

  const raw = await readRawDay(day);
  if (!raw.length) return compacted;

  const byId = new Map();
  for (const event of [...compacted, ...raw]) byId.set(event.id, event);
  return Array.from(byId.values());
}

export function dayRange(days, now = Date.now()) {
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    out.push(new Date(now - i * 86400000).toISOString().slice(0, 10));
  }
  return out;
}

// Reads a window of days, newest-inclusive. Days are fetched in parallel and
// the result is sorted by timestamp so every downstream consumer can assume
// chronological order.
export async function readWindow(days, now = Date.now()) {
  const perDay = await Promise.all(dayRange(days, now).map((day) => readDay(day)));
  return perDay.flat().sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
}

// ── Compaction support (used by growth-compact.mjs) ───────────────────────────

export async function listRawDays() {
  const { blobs } = await store().list({ prefix: RAW_PREFIX });
  const days = new Set();
  for (const blob of blobs) {
    const day = blob.key.slice(RAW_PREFIX.length).split('/')[0];
    if (day) days.add(day);
  }
  return Array.from(days).sort();
}

export async function compactDay(day) {
  const s = store();
  const { blobs } = await s.list({ prefix: `${RAW_PREFIX}${day}/` });
  if (!blobs.length) return { day, compacted: 0, skipped: true };

  const raw = (await Promise.all(
    blobs.map((blob) => s.get(blob.key, { type: 'json' }).catch(() => null))
  )).filter(Boolean);

  const existing = (await readCompactedDay(day)) || [];
  const byId = new Map();
  for (const event of [...existing, ...raw]) byId.set(event.id, event);
  const merged = Array.from(byId.values()).sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));

  // Write the consolidated blob BEFORE deleting the raw keys. If the delete
  // half fails, the day is merely un-compacted (readDay dedupes the overlap) -
  // never missing. The reverse order could lose a day permanently.
  await s.setJSON(dailyKeyFor(day), merged);
  await Promise.all(blobs.map((blob) => s.delete(blob.key).catch(() => {})));

  return { day, compacted: merged.length, skipped: false };
}

export { jsonResponse };
