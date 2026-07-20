// GET /.netlify/functions/score-history-get?key=<historyKey> - returns the
// stored daily score snapshots for one token.
//
// PREMIUM (feature `scoreHistory`). This read used to be public, on the
// reasoning that score data is non-sensitive and already visible. That is still
// true of any SINGLE score — but the accumulated TIME SERIES is the product:
// "how has this token's trust score moved over weeks" is a thing we spent
// months collecting and is one of the things Premium is sold on. Leaving the
// endpoint open meant the Trust Score History chart could be locked in the UI
// and still trivially read straight off the API.
//
// The WRITE side (score-history-record.mjs) stays public and ungated on
// purpose: every free scan contributes a snapshot, and the corpus is only
// valuable because everyone fills it. We gate reading the series, not
// building it.
import { getHistory, jsonResponse } from './_scoreHistoryStore.mjs';
import { requireFeature } from './_featureGate.mjs';

const MAX_KEY_LENGTH = 150;

export async function handler(event) {
  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { message: 'Method not allowed' });
  }

  const gate = await requireFeature(event, 'scoreHistory');
  if (!gate.allowed) return gate.response;

  const key = (event.queryStringParameters?.key || '').trim().slice(0, MAX_KEY_LENGTH);
  if (!key) {
    return jsonResponse(400, { message: 'key query parameter is required' });
  }
  const history = await getHistory(key);
  return jsonResponse(200, { history });
}
