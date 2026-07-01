// Phase 1 — Score Memory: per-token score history + risk drift, the
// foundation the AI narrative (Phase 2) and alerts (Phase 3) build on.
// Snapshots are recorded client-side - the whole app already computes
// scores client-side (see main.jsx) - whenever a token's report is viewed,
// throttled to once per key per day. Mirrors the fetch +
// localStorage-fallback pattern in userData.js so this also works against a
// plain `vite dev` server with no Netlify Functions running.
import { useEffect, useState } from 'react';
import { snapshotMetrics } from './riskHistory.js';

const FALLBACK_KEY = 'khan-trust-score-history-fallback-v1';
const LAST_RECORDED_KEY = 'khan-trust-score-history-lastrecorded-v1';
const MAX_ENTRIES = 180;

function isFunctionUnavailable(error) {
  return Boolean(error) && (error.status === undefined || error.status === 404);
}

async function callFunction(path, options) {
  const response = await fetch(`/.netlify/functions/${path}`, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.message || `Request to ${path} failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // best effort only - history just won't persist locally this session
  }
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

// Stable identity for history regardless of how many times a token is
// rescanned - reuses the same identity the app already treats as canonical
// for a project (contract address when known, otherwise the project id;
// see findStoredProject in main.jsx).
// Native chain coins (BTC, ETH, SOL, BNB, ...) all share the same literal
// placeholder contract string (see lookupNativeCoinGeckoAsset in main.jsx) -
// without this exclusion they'd all collide onto one shared history key.
// Their project.id (e.g. "native-bitcoin") is the real unique identity.
const NO_CONTRACT_PLACEHOLDERS = new Set(['not provided', 'native asset (no contract)']);

export function historyKeyFor(project = {}) {
  const contract = String(project.contract || '').trim().toLowerCase();
  if (contract && !NO_CONTRACT_PLACEHOLDERS.has(contract)) return `c:${contract}`;
  return project.id ? `id:${project.id}` : '';
}

export async function fetchScoreHistory(key) {
  if (!key) return [];
  try {
    const result = await callFunction(`score-history-get?key=${encodeURIComponent(key)}`, { method: 'GET' });
    return Array.isArray(result.history) ? result.history : [];
  } catch (error) {
    if (!isFunctionUnavailable(error)) throw error;
    const store = readJson(FALLBACK_KEY, {});
    return store[key] || [];
  }
}

// Throttled to once/day/key on the client, so opening the same report
// repeatedly in a session doesn't fire repeated network calls - the server
// would collapse them into one entry/day anyway (see appendSnapshot), this
// just avoids the wasted calls. Also captures top-holder concentration and
// liquidity alongside the score (when known) - Phase 3's risk-change alerts
// need day-over-day deltas on those, not just the score.
export async function recordScoreSnapshot(project, score, riskLevel) {
  const key = historyKeyFor(project);
  if (!key || typeof score !== 'number' || !Number.isFinite(score)) return;
  const today = todayKey();
  const lastRecorded = readJson(LAST_RECORDED_KEY, {});
  if (lastRecorded[key] === today) return;

  const realData = project.realData || {};
  const topHolderPercent = typeof realData.topHolderPercent === 'number' ? realData.topHolderPercent : null;
  const liquidityRaw = realData.totalLiquidityUsd ?? realData.liquidityUsd;
  const liquidityUsd = typeof liquidityRaw === 'number' ? liquidityRaw : null;

  // Phase 5 (Smart Risk History): also capture the per-category breakdown, the
  // social score, and the AI asset classification so the history timeline and
  // smart alerts can explain *which* dimension moved - not just the headline
  // score. All fields are optional; older snapshots simply omit them and the
  // diff logic (riskHistory.js) treats missing values as "unknown".
  const { categories, socialScore, assetCategory } = snapshotMetrics(project);

  const snapshot = {
    date: today,
    score: Math.round(score),
    riskLevel: riskLevel || 'Medium',
    topHolderPercent,
    liquidityUsd,
    categories,
    socialScore,
    assetCategory,
  };
  try {
    await callFunction('score-history-record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, snapshot }),
    });
  } catch (error) {
    if (!isFunctionUnavailable(error)) throw error;
    const store = readJson(FALLBACK_KEY, {});
    const existing = (store[key] || []).filter((entry) => entry.date !== today);
    store[key] = [...existing, snapshot].slice(-MAX_ENTRIES);
    writeJson(FALLBACK_KEY, store);
  }
  lastRecorded[key] = today;
  writeJson(LAST_RECORDED_KEY, lastRecorded);
}

// "+4 thisWeek" against the most recent snapshot that's at least ~6 days
// old, falling back to "-12 sinceLaunch" against the very first snapshot we
// have when there isn't a week of history yet. Returns null when there's
// nothing meaningful to compare against (e.g. only today's snapshot exists).
export function computeScoreDelta(history, currentScore) {
  if (!Array.isArray(history) || history.length < 2 || typeof currentScore !== 'number') return null;
  const byDateDesc = [...history].sort((a, b) => b.date.localeCompare(a.date));
  const now = new Date();
  const weekEntry = byDateDesc.find((entry) => (now - new Date(entry.date)) / 86400000 >= 6);
  if (weekEntry) {
    return { delta: Math.round(currentScore - weekEntry.score), label: 'thisWeek' };
  }
  const earliest = byDateDesc[byDateDesc.length - 1];
  return { delta: Math.round(currentScore - earliest.score), label: 'sinceLaunch' };
}

// Single shared hook for the Token Report page: records today's snapshot
// (throttled, see above) and loads the stored history once, so the trend
// strip, the Ask KHAN analyst, and anything else on the page that needs
// history all read the same fetched data instead of each firing their own
// network call.
export function useScoreHistory(project) {
  const [history, setHistory] = useState([]);
  const key = historyKeyFor(project);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    recordScoreSnapshot(project, project.trustScore, project.riskLevel).catch(() => {});
    fetchScoreHistory(key)
      .then((entries) => {
        if (!cancelled) setHistory(entries);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, project.trustScore, project.riskLevel]);

  return history;
}
