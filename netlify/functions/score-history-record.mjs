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
    const riskLevel = VALID_RISK_LEVELS.has(snapshot.riskLevel) ? snapshot.riskLevel : 'Medium';

    const history = await appendSnapshot(key, { date, score: Math.round(score), riskLevel });
    return jsonResponse(200, { ok: true, history });
  } catch (error) {
    return jsonResponse(500, { message: `score-history-record crashed: ${error.message}` });
  }
}
