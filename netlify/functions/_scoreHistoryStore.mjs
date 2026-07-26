// Phase 1 (Score Memory) persistence: per-token daily score snapshots, keyed
// by a stable token identity (contract address, or project id as fallback -
// see historyKeyFor in src/scoreHistory.js). Same single-JSON-blob pattern
// as _userDataStore.mjs since this dataset is small (one entry per key per
// day, capped per key below).
import { getNamedStore, jsonResponse } from './_blobsClient.mjs';
import { mirrorScoreHistory } from './_pgMirror.mjs';
import { readScoreHistory } from './_pgReads.mjs';

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

// Postgres-FIRST read (Phase 2). Returns one token's daily series, ordered
// oldest→newest by the DB. Falls back to the Blob only when Postgres cannot serve
// the read (unset URL, timeout, error) — an EMPTY Postgres result is a valid
// answer (this token has no history yet) and is returned as-is, never masked by
// a Blob re-read. The response is the same array of snapshot objects either way,
// so score-history-get and every downstream consumer are unchanged.
//
// NOTE: this is the READ surface only. The write helpers below still read the
// whole-map Blob (readAllHistory) to upsert, keeping Blobs the authoritative
// write target during the dual-write phase.
export async function getHistory(key) {
  const pg = await readScoreHistory(key);
  if (pg.ok) return pg.value;
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
  // Phase 1 dual-write: mirror this snapshot to Postgres, best-effort. Blobs is
  // the source of truth — a mirror failure must never affect this write.
  try { await mirrorScoreHistory(key, snapshot); } catch { /* non-fatal */ }
  return next;
}

// Adds a snapshot ONLY if this key has no entry for that date yet, and reports
// whether it wrote. This is the monitored-observation path (watch-rescan-
// background): the client's view path uses appendSnapshot(), which upserts so a
// human re-viewing a token refreshes today's point with the freshest full scan.
// The worker instead FILLS GAPS — it must never overwrite a client point (which
// carries a live market cap the server cannot fetch), and a token observed many
// times in one UTC day must yield exactly one point (the first), not one per
// cycle. So an existing same-day entry, from either source, is left untouched.
export async function appendSnapshotIfDateAbsent(key, snapshot) {
  const all = await readAllHistory();
  const existing = all[key] || [];
  if (existing.some((entry) => entry.date === snapshot.date)) {
    return { written: false, history: existing };
  }
  const next = [...existing, snapshot]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-MAX_ENTRIES_PER_KEY);
  all[key] = next;
  await writeAllHistory(all);
  try { await mirrorScoreHistory(key, snapshot); } catch { /* non-fatal */ }
  return { written: true, history: next };
}

export { jsonResponse };
