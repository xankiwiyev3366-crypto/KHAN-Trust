// Client for the Grounded AI Analyst.
//
// THE MERGE RULE, WHICH IS THE WHOLE POINT OF THIS MODULE
//
// The deterministic build (src/premiumResearch.js) runs FIRST and produces a
// complete, correct card on its own. The AI response then overlays only the
// PROSE fields it successfully generated. Nothing else is ever replaced.
//
// So at every moment there are exactly two possible states, and both are
// correct: deterministic prose, or AI prose about the same deterministic
// numbers. There is no state in which a number came from the model, no state in
// which a field is blank because generation failed, and no state in which the
// user waits on an LLM to see their analysis.
//
// This is also why the templates were NOT deleted in this phase. They are not
// legacy — they are the floor the feature stands on, and they render instantly
// while the network call is still in flight.
import { useEffect, useState } from 'react';

const ENDPOINT = '/.netlify/functions/premium-analysis';

// Same convention as src/entitlements.js / src/watchtower.js.
const AUTH_TOKEN_KEY = 'khan-trust-auth-token-v1';

// Only these may be overlaid. A response field outside this list is ignored
// entirely, so a future prompt change cannot start overwriting engine-computed
// values by accident — the allowlist is enforced here, not merely intended.
const OVERLAYABLE = new Set([
  'liquidity',
  'holders',
  'communitySignals',
  'contractSecurity',
  'outlook',
  'conclusion',
  'explanation',
  'recommendations',
]);

function authToken() {
  try { return localStorage.getItem(AUTH_TOKEN_KEY); } catch { return null; }
}

// The subset of the computed project the analyst is shown. Sent explicitly
// rather than posting the whole project so nothing incidental (stored notes,
// UI state, other users' data merged into the object) can leave the browser.
function analysisPayload(project = {}) {
  return {
    name: project.name,
    ticker: project.ticker,
    chain: project.chain,
    assetCategory: project.assetCategory,
    trustScore: project.trustScore,
    riskLevel: project.riskLevel,
    confidenceScore: project.confidenceScore,
    confidenceLabel: project.confidenceLabel,
    realData: project.realData,
    holders: project.holders,
    communitySize: project.communitySize,
    positiveSignals: project.positiveSignals,
    hiddenRiskSignals: project.hiddenRiskSignals,
    // Signal keys let the server rank risks by severity and re-detect conflicts
    // without re-implementing the engine; the asset-type modifier lets it
    // explain a capped score. All engine output, never model input.
    positiveSignalKeys: project.positiveSignalKeys,
    hiddenRiskSignalKeys: project.hiddenRiskSignalKeys,
    assetTypeRiskModifier: project.assetTypeRiskModifier,
    scamRiskReasons: project.scamRisk?.reasons,
    missingDataFields: project.missingDataFields,
    scoreBreakdown: project.scoreBreakdown,
  };
}

export async function fetchAnalysis({ project, identity, language }) {
  const token = authToken();
  if (!token || !identity) return null;
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ identity, language, project: analysisPayload(project) }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!data?.ok || !data.fields) return null;
    return data.fields;
  } catch {
    // Every failure is the same to the caller: no overlay, keep the templates.
    return null;
  }
}

// Overlays generated prose onto a deterministic build.
//
// A field is taken from the AI ONLY when it is a non-empty string (or non-empty
// array for recommendations) AND is in the allowlist. Anything else keeps the
// deterministic value, so a partial response degrades field by field rather
// than all at once.
export function mergeAnalysis(deterministic, aiFields) {
  if (!aiFields || typeof aiFields !== 'object') return deterministic;
  const merged = { ...deterministic };
  for (const [key, value] of Object.entries(aiFields)) {
    if (!OVERLAYABLE.has(key)) continue;
    if (Array.isArray(value)) {
      if (value.length) merged[key] = value;
    } else if (typeof value === 'string' && value.trim()) {
      merged[key] = value.trim();
    }
  }
  return merged;
}

// Fetches the overlay for a token. Returns { fields, loading } — never an
// error, because there is nothing for the caller to do about one.
//
// `enabled` gates on Premium: a free user must not trigger a paid call, and the
// server refuses them anyway.
export function useGroundedAnalysis({ project, identity, language, enabled }) {
  const [state, setState] = useState({ fields: null, loading: false });

  useEffect(() => {
    if (!enabled || !identity || !project) {
      setState({ fields: null, loading: false });
      return undefined;
    }
    let cancelled = false;
    setState({ fields: null, loading: true });
    fetchAnalysis({ project, identity, language }).then((fields) => {
      if (!cancelled) setState({ fields, loading: false });
    });
    return () => { cancelled = true; };
    // Re-fetches when the token or the reader's language changes. Deliberately
    // NOT keyed on the whole project object, which is a new reference on every
    // render and would loop.
  }, [enabled, identity, language, project?.trustScore, project?.confidenceScore]);

  return state;
}
