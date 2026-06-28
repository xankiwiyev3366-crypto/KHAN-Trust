// Shared persistence layer for the KHAN Holder Analytics admin module.
// Single source of truth, same principle as _analyticsStore.mjs: holders.json
// and transactions.json are the only durable facts; every derived number
// (rank, %, whale status, USD value) is computed at read time in the
// khan-holders-admin-* functions so there is never a second aggregate that
// can drift out of sync with the underlying ledger.
import { getNamedStore, jsonResponse } from './_blobsClient.mjs';

const STORE_NAME = 'khan-holder-analytics';
const HOLDERS_KEY = 'holders.json';
const TRANSACTIONS_KEY = 'transactions.json';
const ALERTS_KEY = 'alerts.json';
const META_KEY = 'meta.json';

// Capped like _analyticsStore.mjs's event log - keeps every read/write within
// a single Lambda invocation. Revisit (day-bucketed keys) if KHAN's tx volume
// grows past this comfortably-large ceiling.
const MAX_TRANSACTIONS = 50000;
const MAX_ALERTS = 2000;

function store() {
  return getNamedStore(STORE_NAME);
}

export async function readHolders() {
  const data = await store().get(HOLDERS_KEY, { type: 'json' });
  return data && typeof data === 'object' ? data : {};
}

export async function writeHolders(holders) {
  await store().setJSON(HOLDERS_KEY, holders);
}

export async function readTransactions() {
  const data = await store().get(TRANSACTIONS_KEY, { type: 'json' });
  return Array.isArray(data) ? data : [];
}

export async function appendTransactions(newRows) {
  if (!newRows.length) return readTransactions();
  const existing = await readTransactions();
  const merged = existing.concat(newRows);
  const capped = merged.length > MAX_TRANSACTIONS ? merged.slice(merged.length - MAX_TRANSACTIONS) : merged;
  await store().setJSON(TRANSACTIONS_KEY, capped);
  return capped;
}

export async function readAlerts() {
  const data = await store().get(ALERTS_KEY, { type: 'json' });
  return Array.isArray(data) ? data : [];
}

export async function appendAlerts(newAlerts) {
  if (!newAlerts.length) return readAlerts();
  const existing = await readAlerts();
  const merged = existing.concat(newAlerts);
  const capped = merged.length > MAX_ALERTS ? merged.slice(merged.length - MAX_ALERTS) : merged;
  await store().setJSON(ALERTS_KEY, capped);
  return capped;
}

const DEFAULT_META = () => ({
  lastSignature: null,
  cursorReachedHead: false,
  poolAddresses: [],
  poolAddressesUpdatedAt: 0,
  solPriceCacheByDay: {},
  lastFullBalanceSyncAt: 0,
});

export async function readMeta() {
  const data = await store().get(META_KEY, { type: 'json' });
  return data && typeof data === 'object' ? { ...DEFAULT_META(), ...data } : DEFAULT_META();
}

export async function writeMeta(meta) {
  await store().setJSON(META_KEY, meta);
}

export { jsonResponse };
