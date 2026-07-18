// POST /.netlify/functions/score-history-record - records today's score
// snapshot for one token. Public write (no wallet/entitlement gate, same as
// the rest of the app's client-computed scoring - there is no server-side
// recomputation to verify against), but tightly validated and capped server
// side so a malicious caller can't store arbitrary garbage or grow the
// dataset unbounded: score must be a real 0-100 number, riskLevel must be a
// known value, and the key/date shape is fixed. The client also throttles
// this to once per key per day (see recordScoreSnapshot in
// src/scoreHistory.js); the server-side upsert-by-date in
// appendSnapshot() means even a bypassed client still can't create more than
// one entry per key per day.
import { appendSnapshot, jsonResponse } from './_scoreHistoryStore.mjs';

const MAX_KEY_LENGTH = 150;
const VALID_RISK_LEVELS = new Set(['Low', 'Medium', 'High']);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// Phase 5: the category dimensions a snapshot may carry. Any others in the
// payload are ignored so a caller can't pad the blob with arbitrary keys.
const CATEGORY_KEYS = ['contractSecurity', 'liquidity', 'holderHealth', 'marketActivity', 'community'];

// 0-100 score or null. Anything out of range / non-numeric becomes null rather
// than being rejected, so a partial snapshot still stores its known fields.
function clampScoreOrNull(value) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 && num <= 100 ? Math.round(num) : null;
}

export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') {
      return jsonResponse(405, { message: 'Method not allowed' });
    }

    let payload;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { message: 'Invalid request body' });
    }

    const key = String(payload.key || '').trim().slice(0, MAX_KEY_LENGTH);
    if (!key) {
      return jsonResponse(400, { message: 'key is required' });
    }

    const snapshot = payload.snapshot || {};
    const score = Number(snapshot.score);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      return jsonResponse(400, { message: 'snapshot.score must be a number between 0 and 100' });
    }
    const date = String(snapshot.date || '');
    if (!DATE_PATTERN.test(date)) {
      return jsonResponse(400, { message: 'snapshot.date must be in YYYY-MM-DD format' });
    }

    // Server-side data-quality check (defence in depth). The client already gates
    // on completeness (assessSnapshot in src/scoreHistory.js), but this endpoint
    // is public, so a snapshot the caller itself marks incomplete is refused
    // storage here too — never silently, and never as an error the UI must
    // handle: it is a valid, successful "nothing to record" outcome.
    if (snapshot.complete === false || snapshot.demo === true) {
      return jsonResponse(200, { ok: true, skipped: true, reason: 'incomplete_snapshot' });
    }

    // A missing/invalid level is stored as null, NEVER a fabricated 'Medium'.
    // Coercing unknown to a middle value manufactured phantom Low<->Medium<->High
    // transitions in the timeline — the exact bug this system had.
    const riskLevel = VALID_RISK_LEVELS.has(snapshot.riskLevel) ? snapshot.riskLevel : null;

    // Optional (Phase 3): top-holder concentration + liquidity alongside the
    // score, so risk-change alerts can compare day-over-day on those too.
    // Missing/invalid values are stored as null rather than rejected - older
    // snapshots and tokens with unknown holder/liquidity data still work.
    const topHolderPercentRaw = Number(snapshot.topHolderPercent);
    const topHolderPercent = Number.isFinite(topHolderPercentRaw) && topHolderPercentRaw >= 0 && topHolderPercentRaw <= 100
      ? topHolderPercentRaw
      : null;
    const liquidityUsdRaw = Number(snapshot.liquidityUsd);
    const liquidityUsd = Number.isFinite(liquidityUsdRaw) && liquidityUsdRaw >= 0 ? liquidityUsdRaw : null;

    // Optional (Phase 5): per-category breakdown, social score, and AI asset
    // category. Each is strictly validated/clamped so a public caller cannot
    // poison the history blob with arbitrary data (same posture as the corpus
    // recorder). Missing/invalid fields store as null / '' and never reject.
    const categoriesInput = snapshot.categories && typeof snapshot.categories === 'object' ? snapshot.categories : {};
    const categories = {};
    for (const catKey of CATEGORY_KEYS) categories[catKey] = clampScoreOrNull(categoriesInput[catKey]);
    const socialScore = clampScoreOrNull(snapshot.socialScore);
    const assetCategory = String(snapshot.assetCategory == null ? '' : snapshot.assetCategory)
      .replace(/<[^>]*>/g, '').trim().slice(0, 60);

    // Data-quality stamps (Platform Memory repair): `confidence` (0-100 data
    // completeness) lets the diff layer tell a real decline from a data-thinned
    // one; `complete: true` marks this as a comparable observation. Persisted so
    // the distinction survives across sessions and devices, not just in the tab
    // that recorded it.
    const confidence = clampScoreOrNull(snapshot.confidence);

    const history = await appendSnapshot(key, {
      date,
      score: Math.round(score),
      riskLevel,
      confidence,
      complete: true,
      topHolderPercent,
      liquidityUsd,
      categories,
      socialScore,
      assetCategory,
    });
    return jsonResponse(200, { ok: true, history });
  } catch (error) {
    return jsonResponse(500, { message: `score-history-record crashed: ${error.message}` });
  }
}
