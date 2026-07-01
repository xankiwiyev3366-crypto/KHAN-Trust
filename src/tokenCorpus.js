// Trust Graph Corpus (client). ADDITIVE and non-breaking: the existing
// per-browser Explore/localStorage flow (readProjectStorage in main.jsx) is
// left completely untouched. This module only ALSO mirrors each viewed token
// into the shared, server-side corpus (see netlify/functions/token-corpus-*),
// so scans compound into a queryable dataset - the foundation for shared
// discovery, SEO token pages, and retention alerts.
//
// It reuses the exact fetch + graceful-degrade posture of scoreHistory.js /
// userData.js: every call is best-effort and swallows failures, so a corpus
// outage (or a plain `vite dev` server with no Functions running) can never
// affect the scan/report the user is looking at. It imports only the pure
// historyKeyFor() from scoreHistory.js and scoreHistory.js does NOT import
// this module back, so there is no import cycle.
import { useEffect } from 'react';
import { historyKeyFor } from './scoreHistory.js';

const LAST_RECORDED_KEY = 'khan-trust-corpus-lastrecorded-v1';

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
    // best effort only
  }
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

// Fire-and-forget, throttled to once/day/token on the client (same posture as
// score snapshots) so repeated views don't spam the endpoint. Never throws.
// Demo/preview projects are skipped so they never enter the shared corpus.
export async function recordTokenSnapshot(project = {}) {
  try {
    if (project.realData?.isDemo) return;
    const identity = historyKeyFor(project);
    if (!identity) return;
    if (typeof project.trustScore !== 'number' || !Number.isFinite(project.trustScore)) return;

    const stamp = readJson(LAST_RECORDED_KEY, {});
    if (stamp[identity] === todayKey()) return;

    await callFunction('token-corpus-record', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identity,
        contract: project.contract || '',
        chain: project.chain || '',
        name: project.name || '',
        ticker: project.ticker || '',
        trustScore: project.trustScore,
        riskLevel: project.riskLevel || 'Medium',
        category: project.assetCategory || '',
        confidenceLabel: project.confidenceLabel || '',
      }),
    }).catch(() => {}); // includes the no-Functions-server case; corpus is best-effort

    stamp[identity] = todayKey();
    writeJson(LAST_RECORDED_KEY, stamp);
  } catch {
    // never propagate - the corpus must never affect the current scan/report
  }
}

export async function fetchCorpusToken(identity) {
  if (!identity) return null;
  try {
    const data = await callFunction(`token-corpus-get?identity=${encodeURIComponent(identity)}`, { method: 'GET' });
    return data.token || null;
  } catch {
    return null;
  }
}

export async function fetchCorpusList(limit = 50) {
  try {
    const data = await callFunction(`token-corpus-list?limit=${encodeURIComponent(limit)}`, { method: 'GET' });
    return Array.isArray(data.tokens) ? data.tokens : [];
  } catch {
    return [];
  }
}

// Records the shown token into the shared corpus exactly once per view,
// throttled server-agnostically by recordTokenSnapshot. Dropped into the
// report/profile pages alongside the existing useScoreHistory funnel - purely
// additive, no existing behavior changes.
export function useCorpusRecord(project) {
  const identity = project ? historyKeyFor(project) : '';
  useEffect(() => {
    if (!project || !identity) return;
    recordTokenSnapshot(project).catch(() => {});
    // identity is the stable per-token key; re-fire only when the token changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);
}
