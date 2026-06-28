// Phase 1 (Score Memory) persistence: per-token daily score snapshots, keyed
// by a stable token identity (contract address, or project id as fallback -
// see historyKeyFor in src/scoreHistory.js). Same single-JSON-blob pattern
// as _userDataStore.mjs since this dataset is small (one entry per key per
// day, capped per key below).
import { getNamedStore, jsonResponse } from './_blobsClient.mjs';

const STORE_NAME = 'khan-trust-score-history';
const DATA_KEY = 'score-history.json';
const MAX_ENTRIES_PER_KEY = 180;

function store() {
  return getNamedStore(STORE_NAME);
}

export async function readAllHistory() {
  const data = await store().get(DATA_KEY, { type: 'json' });
  return data && typeof data === 'object' ? data : {};
}

export async function writeAllHistory(allData) {
  await store().setJSON(DATA_KEY, allData);
}

export async function getHistory(key) {
  const all = await readAllHistory();
  return all[key] || [];
}

// Upserts today's snapshot for this key (one entry per calendar day - a
// rescan later the same day updates today's entry rather than duplicating
// it), then trims to the most recent MAX_ENTRIES_PER_KEY days.
export async function appendSnapshot(key, snapshot) {
  const all = await readAllHistory();
  const existing = all[key] || [];
  const withoutToday = existing.filter((entry) => entry.date !== snapshot.date);
  const next = [...withoutToday, snapshot]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-MAX_ENTRIES_PER_KEY);
  all[key] = next;
  await writeAllHistory(all);
  return next;
}

export { jsonResponse };
