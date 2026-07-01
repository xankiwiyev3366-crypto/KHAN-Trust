// GET /.netlify/functions/token-corpus-list?limit=<n>
// Returns the most-recently-updated tokens in the shared Trust Graph Corpus,
// from the compact discovery index. Public read. This is the surface a future
// shared "Explore from the corpus" view, trending/leaderboard, and SEO
// sitemap will read from - the first thing that turns accumulated scans into
// cross-user discovery instead of per-browser silos.
import { readIndex, jsonResponse } from './_tokenCorpusStore.mjs';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function handler(event) {
  try {
    if (event.httpMethod !== 'GET') {
      return jsonResponse(405, { message: 'Method not allowed' });
    }
    const requested = Number(event.queryStringParameters?.limit);
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number.isFinite(requested) ? requested : DEFAULT_LIMIT));

    const index = await readIndex();
    const tokens = Object.values(index)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, limit);

    return jsonResponse(200, { tokens, total: Object.keys(index).length });
  } catch (error) {
    return jsonResponse(500, { message: `token-corpus-list crashed: ${error.message}` });
  }
}
