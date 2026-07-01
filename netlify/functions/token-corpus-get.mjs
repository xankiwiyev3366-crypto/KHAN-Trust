// GET /.netlify/functions/token-corpus-get?identity=<identity>
// Returns the shared-corpus snapshot for one token (or null). Public read -
// the corpus is public trust data by design. Feeds future shared discovery,
// SSR/SEO token pages, and the retention re-scan worker.
import { getCorpusToken, jsonResponse } from './_tokenCorpusStore.mjs';

export async function handler(event) {
  try {
    if (event.httpMethod !== 'GET') {
      return jsonResponse(405, { message: 'Method not allowed' });
    }
    const identity = (event.queryStringParameters?.identity || '').trim();
    if (!identity) {
      return jsonResponse(400, { message: 'identity query parameter is required' });
    }
    const token = await getCorpusToken(identity);
    return jsonResponse(200, { token });
  } catch (error) {
    return jsonResponse(500, { message: `token-corpus-get crashed: ${error.message}` });
  }
}
