// GET /.netlify/functions/score-history-get?key=<historyKey> - returns the
// stored daily score snapshots for one token. Public read, same posture as
// user-data-get.mjs: this is non-sensitive, already-public score data, just
// looked up by a key instead of a wallet.
import { getHistory, jsonResponse } from './_scoreHistoryStore.mjs';

const MAX_KEY_LENGTH = 150;

export async function handler(event) {
  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { message: 'Method not allowed' });
  }
  const key = (event.queryStringParameters?.key || '').trim().slice(0, MAX_KEY_LENGTH);
  if (!key) {
    return jsonResponse(400, { message: 'key query parameter is required' });
  }
  const history = await getHistory(key);
  return jsonResponse(200, { history });
}
