// The product event store: one durable, deduplicated, queryable record of what
// actually happened in the funnel.
//
// ── WHY NOT _analyticsStore.mjs (which already stores events) ────────────────
//
// Because it appends to ONE capped array at a single blob key. _growthEvents.mjs
// already wrote down the two defects that follow, and both are fatal here:
// concurrent appends silently destroy each other (last writer wins, no lock),
// and at 20 000 events the oldest are dropped. A funnel whose denominator
// quietly loses events reports a conversion rate that is too HIGH, which is the
// direction nobody investigates.
//
// So this store follows the growth plane's shape instead — an event is an
// immutable fact, so it never needs read-modify-write:
//
//   product/2026-07-29/evt-1753...-a7f3c2
//
// One key per event, one put, no prior read. Concurrent writes cannot collide,
// nothing is truncated, and history is unbounded.
//
// ── WHY NOT THE GROWTH PLANE ITSELF ─────────────────────────────────────────
//
// It is tempting, since the shape is identical. It is wrong, for one reason
// recorded in the Growth OS's own invariants: the growth warehouse measures the
// PUBLIC funnel, and its analyses are calibrated on that population. Pouring
// admin actions, cron-fired expiry transitions and server-authored verification
// lifecycle events into it would move every metric the console reports without
// any human behaviour having changed. Separate store, separate question.
import { getNamedStore, jsonResponse } from './_blobsClient.mjs';
import { mirror, readRows } from './_db.mjs';
import {
  PRODUCT_EVENTS,
  isProductEvent,
  sanitizeMetadata,
  defaultDedupKey,
} from '../../src/lib/productEvents.js';

const STORE_NAME = 'khan-trust-product-events';
const EVENT_PREFIX = 'product/';
const DEDUP_PREFIX = 'seen/';

function store() {
  return getNamedStore(STORE_NAME);
}

function dayOf(iso) {
  return String(iso).slice(0, 10);
}

export function eventKey(event) {
  return `${EVENT_PREFIX}${dayOf(event.timestamp)}/${event.id}`;
}

// Builds the stored shape. Pure, so the redaction and dedup rules are testable
// without a store.
//
// EVERY IDENTIFIER IS OPTIONAL AND EVERY ONE IS BOUNDED. An event with no
// session and no user is still a real event (a crawler-driven profile view, a
// cron-fired expiry) and must not be discarded for lack of a person attached to
// it — absence is not a reason to drop a fact.
export function buildProductEvent({
  name,
  sessionId = '',
  userId = '',
  orderId = '',
  projectId = '',
  chain = '',
  contract = '',
  source = '',
  metadata = {},
  dedupKey = '',
  timestamp = new Date().toISOString(),
}) {
  const clean = (value, max) => String(value == null ? '' : value).replace(/<[^>]*>/g, '').trim().slice(0, max);
  const event = {
    id: `pe-${Date.parse(timestamp) || Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    name,
    timestamp,
    sessionId: clean(sessionId, 64),
    userId: clean(userId, 64),
    orderId: clean(orderId, 64),
    projectId: clean(projectId, 100),
    chain: clean(chain, 40).toLowerCase(),
    contract: clean(contract, 128),
    // Referrers are truncated to their ORIGIN. A full referrer URL routinely
    // carries a query string, and a query string routinely carries a token, an
    // email or a session id that whoever wrote the link never meant to send us.
    // Keeping only the origin preserves everything attribution actually needs.
    source: originOnly(clean(source, 300)),
    metadata: sanitizeMetadata(metadata),
  };
  event.dedupKey = dedupKey || defaultDedupKey(event);
  return event;
}

function originOnly(value) {
  if (!value) return '';
  try {
    return new URL(value).origin;
  } catch {
    // Not a URL — a campaign name, a channel id. Kept as-is but short.
    return value.slice(0, 80);
  }
}

// ── Write ───────────────────────────────────────────────────────────────────

// Never throws. Every caller is on a path where the real work — activating a
// verification, rendering a public page, confirming a payment — has already
// succeeded or is about to, and none of them may fail because a telemetry write
// did. The return value says what happened so a caller that cares can log it.
export async function recordEvent(input) {
  try {
    if (!isProductEvent(input?.name)) {
      // Loudly, and without storing it. See the header of
      // src/lib/productEvents.js: a mis-spelled event name that gets stored is a
      // permanently wrong metric nobody notices.
      console.warn(`[events] refused unknown event name: ${String(input?.name).slice(0, 60)}`);
      return { ok: false, reason: 'unknown_event' };
    }

    const event = buildProductEvent(input);
    const s = store();

    // DEDUPLICATION. A marker key per dedupKey, checked before the write.
    //
    // Not a transaction, and it does not need to be: the marker and the event
    // are both idempotent puts, so the worst interleaving of two concurrent
    // identical events is that both are stored — which the funnel readers below
    // also dedupe by dedupKey at read time. Two independent chances to be right,
    // neither of which can lose a DISTINCT event.
    if (event.dedupKey) {
      const marker = `${DEDUP_PREFIX}${encodeURIComponent(event.dedupKey)}`;
      const seen = await s.get(marker, { type: 'json' }).catch(() => null);
      if (seen?.id) return { ok: true, deduplicated: true, id: seen.id };
      await s.setJSON(marker, { id: event.id, at: event.timestamp }).catch(() => {});
    }

    await s.setJSON(eventKey(event), event);

    try {
      await mirror(
        `INSERT INTO product_events
           (id, name, session_id, user_id, order_id, project_id, chain, contract, source, metadata, dedup_key, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         -- The WHERE clause is REQUIRED, not decoration. uq_product_events_dedup
         -- is a PARTIAL unique index (dedup_key IS NOT NULL), and Postgres will
         -- only infer a partial index as the conflict arbiter when the statement
         -- restates its predicate. Without it this fails with "no unique or
         -- exclusion constraint matching the ON CONFLICT specification" — and
         -- because mirror() swallows errors by contract, it would fail SILENTLY
         -- and the Postgres projection would simply never be written.
         ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING`,
        [
          event.id, event.name, event.sessionId || null, event.userId || null,
          event.orderId || null, event.projectId || null, event.chain || null,
          event.contract || null, event.source || null,
          JSON.stringify(event.metadata), event.dedupKey || null, event.timestamp,
        ],
      );
    } catch { /* mirror is non-fatal by contract */ }

    return { ok: true, deduplicated: false, id: event.id };
  } catch (error) {
    console.warn(`[events] record failed (non-fatal): ${error.message}`);
    return { ok: false, reason: 'error' };
  }
}

// ── Read ────────────────────────────────────────────────────────────────────

export function dayRange(days, now = Date.now()) {
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    out.push(new Date(now - i * 86400000).toISOString().slice(0, 10));
  }
  return out;
}

async function readDay(day) {
  const s = store();
  const { blobs } = await s.list({ prefix: `${EVENT_PREFIX}${day}/` }).catch(() => ({ blobs: [] }));
  if (!blobs.length) return [];
  const events = await Promise.all(
    blobs.map((blob) => s.get(blob.key, { type: 'json' }).catch(() => null)),
  );
  return events.filter(Boolean);
}

// Postgres-first when it can answer, because a 90-day funnel over Blobs is
// 90 list calls plus one get per event, and the admin console asks for it on
// every page load. Falls back to Blobs — which is the source of truth — so the
// funnel still renders with no DATABASE_URL, just more slowly.
export async function readEventWindow(days, now = Date.now()) {
  const since = new Date(now - days * 86400000).toISOString();
  const pg = await readRows(
    `SELECT id, name, session_id, user_id, order_id, project_id, chain, contract,
            source, metadata, dedup_key, created_at
       FROM product_events
      WHERE created_at >= $1
      ORDER BY created_at`,
    [since],
    { label: 'product_events_window' },
  );
  if (pg.ok) {
    return pg.rows.map((row) => ({
      id: row.id,
      name: row.name,
      sessionId: row.session_id || '',
      userId: row.user_id || '',
      orderId: row.order_id || '',
      projectId: row.project_id || '',
      chain: row.chain || '',
      contract: row.contract || '',
      source: row.source || '',
      metadata: row.metadata || {},
      dedupKey: row.dedup_key || '',
      timestamp: new Date(row.created_at).toISOString(),
    }));
  }

  const perDay = await Promise.all(dayRange(days, now).map((day) => readDay(day)));
  // Deduplicated at READ time as well as write time — see recordEvent for why
  // both exist.
  const byKey = new Map();
  for (const event of perDay.flat()) {
    byKey.set(event.dedupKey || event.id, event);
  }
  return Array.from(byKey.values()).sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
}

// ── The funnel ──────────────────────────────────────────────────────────────

// Pure: hand it events, get the funnel. No store, no clock, fully testable.
//
// ABSENCE IS NOT A ZERO — but here it genuinely is. Every stage counts events
// that were recorded, so a stage with no events has a count of 0 and that IS the
// truth ("nobody did this"), unlike a metric derived from a missing measurement.
// The DENOMINATOR is the thing to be careful with: conversion is expressed
// against quotes, and is reported as null rather than 0% when there were no
// quotes at all, because 0/0 is not a conversion rate of zero.
export function computeFunnel(events) {
  const count = (name) => events.filter((e) => e.name === name).length;

  const quotes = count(PRODUCT_EVENTS.VERIFICATION_QUOTE_CREATED);
  const orders = count(PRODUCT_EVENTS.VERIFICATION_ORDER_CREATED);
  const paymentsConfirmed = count(PRODUCT_EVENTS.VERIFICATION_PAYMENT_CONFIRMED);
  const ownershipCompleted = count(PRODUCT_EVENTS.VERIFICATION_OWNERSHIP_COMPLETED);
  const activations = count(PRODUCT_EVENTS.VERIFICATION_ACTIVATED);

  // Revenue by tier, from the activation events themselves. Read off the event
  // rather than recomputed from the tier table at report time, so a future price
  // change cannot retroactively rewrite what past customers paid.
  const revenueByTier = {};
  for (const event of events) {
    if (event.name !== PRODUCT_EVENTS.VERIFICATION_ACTIVATED) continue;
    const tier = event.metadata?.tier || 'unknown';
    const usd = Number(event.metadata?.usd);
    if (!Number.isFinite(usd)) continue;
    revenueByTier[tier] = (revenueByTier[tier] || 0) + usd;
  }

  return {
    quotes,
    orders,
    paymentsConfirmed,
    ownershipCompleted,
    activations,
    conversionRate: quotes > 0 ? Number((activations / quotes).toFixed(4)) : null,
    revenueByTier,
    revenueTotal: Object.values(revenueByTier).reduce((sum, n) => sum + n, 0),
    badgeImpressions: count(PRODUCT_EVENTS.BADGE_IMPRESSION),
    profileViews: count(PRODUCT_EVENTS.PROJECT_PROFILE_VIEWED),
    upgradeClicks: count(PRODUCT_EVENTS.UPGRADE_CLICKED),
    paywallHits: count(PRODUCT_EVENTS.PAYWALL_HIT),
    scansStarted: count(PRODUCT_EVENTS.SCAN_STARTED),
    scansCompleted: count(PRODUCT_EVENTS.SCAN_COMPLETED),
    scansFailed: count(PRODUCT_EVENTS.SCAN_FAILED),
    expired: count(PRODUCT_EVENTS.VERIFICATION_EXPIRED),
    revoked: count(PRODUCT_EVENTS.VERIFICATION_REVOKED),
    refunded: count(PRODUCT_EVENTS.VERIFICATION_REFUNDED),
    alertsFired: count(PRODUCT_EVENTS.ALERT_FIRED),
    walletConnections: count(PRODUCT_EVENTS.WALLET_CONNECTED),
  };
}

export { PRODUCT_EVENTS, jsonResponse };
