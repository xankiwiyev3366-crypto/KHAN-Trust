// Client for the Watchtower Report.
//
// One endpoint, one hook. The server does all the composing (see
// _watchtowerReport.mjs) — this only fetches and renders, deliberately: the
// report is persisted server-side and re-read later, so the browser must never
// be the thing that decides what a period contained.
//
// LOCALIZATION HAPPENS HERE, NOT ON THE SERVER
//
// The stored report carries translation KEYS and PARAMS, never sentences (same
// rule as the notification center). So the same stored report renders in
// whatever language the reader has selected right now — including one they
// switch to after the report was generated. describeReason() below is where
// that late binding happens.
//
// FAILURE IS VISIBLE, NOT SILENT
//
// Unlike retention.js (which fails silently because it is memory, not a
// feature), a Watchtower failure MUST surface. A monitoring product that
// silently shows nothing is indistinguishable from one reporting "all clear",
// and that is the one confusion this feature cannot afford.
import { useCallback, useEffect, useState } from 'react';
import { translate as t } from './i18n/index.js';

const ENDPOINT = '/.netlify/functions/watchtower-report';

// Same convention as src/entitlements.js / src/userData.js — see the note in
// src/stripeCheckout.js. Must stay identical across all of them.
const AUTH_TOKEN_KEY = 'khan-trust-auth-token-v1';

function authHeaders() {
  try {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

export async function fetchWatchtowerReport() {
  const headers = authHeaders();
  if (!headers.Authorization) return { ok: false, reason: 'signed_out' };
  try {
    const response = await fetch(ENDPOINT, { headers });
    if (response.status === 401) return { ok: false, reason: 'signed_out' };
    if (!response.ok) return { ok: false, reason: 'unavailable' };
    const data = await response.json();
    if (!data?.report) return { ok: false, reason: 'unavailable' };
    return { ok: true, report: data.report, plan: data.plan || null, fresh: Boolean(data.fresh) };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

export function useWatchtowerReport(enabled) {
  const [state, setState] = useState({ loading: Boolean(enabled), report: null, plan: null, reason: null });

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true }));
    const result = await fetchWatchtowerReport();
    setState(result.ok
      ? { loading: false, report: result.report, plan: result.plan, reason: null }
      : { loading: false, report: null, plan: null, reason: result.reason });
  }, []);

  useEffect(() => {
    if (!enabled) {
      setState({ loading: false, report: null, plan: null, reason: 'signed_out' });
      return;
    }
    load();
  }, [enabled, load]);

  return { ...state, reload: load };
}

// Turns a cadence in milliseconds into the { count, unit } a translation needs.
// Minutes below an hour, then hours — the two units this product's cadences
// actually use. Returns null for an unknown interval rather than rendering
// "every NaN minutes".
export function describeCadence(intervalMs) {
  const ms = Number(intervalMs);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return { count: minutes, unit: 'minutes' };
  return { count: Math.round(minutes / 60), unit: 'hours' };
}

// ── Rendering helpers ────────────────────────────────────────────────────────

// The eight dimensions the re-scan worker genuinely observes on every cycle.
//
// EVERY ENTRY HERE IS REAL. This list is the product's promise about what it
// checks, so it may only ever contain things _volatileSignals.mjs actually
// fetches. Adding a row for a signal that is not observed would make the
// coverage panel a lie, which for a platform named Trust is the single most
// expensive kind of bug. `chains` marks the two dev-wallet dimensions that
// differ per chain (EVM exposes deployer stake; Solana exposes authority
// ownership) — both real, neither simulated to make the other look complete.
export const MONITORED_DIMENSIONS = [
  { key: 'liquidity' },
  { key: 'holderConcentration' },
  { key: 'tradingActivity' },
  { key: 'contractSecurity' },
  { key: 'ownership' },
  { key: 'devWallet' },
  { key: 'holderBase' },
  { key: 'trustScore' },
];

// Localized one-liner for a structured reason code. Falls back to the raw code
// rather than rendering an empty row, so an unmapped code is visibly wrong in
// testing instead of invisibly missing in production.
export function describeReason(reason, language) {
  if (!reason?.code) return '';
  const key = `watchtower.reasons.${reason.code}`;
  const text = t(key, reason.params || {}, language);
  return text === key ? reason.code : text;
}

// Sort order is decided server-side (attention first). This only labels.
export const STATUS_TONE = {
  critical: 'critical',
  worsened: 'worse',
  improved: 'better',
  steady: 'neutral',
  baselined: 'neutral',
  unobserved: 'unknown',
};
