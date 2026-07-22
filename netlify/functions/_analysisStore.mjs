// Cache for generated analyst prose.
//
// THE ANALYSIS IS A PROPERTY OF THE TOKEN, NOT THE USER
//
// The same insight the watch lane runs on. What the analyst says about BONK
// depends only on BONK's data, so a thousand Premium users viewing BONK is ONE
// generation, not a thousand. Cost then scales with MATERIAL CHANGE rather than
// with traffic — which is the only shape in which a user-facing LLM is
// affordable at all. Without this, one popular token would exhaust the whole
// monthly AI budget in an afternoon and every other token would silently fall
// back to templates for the rest of the month.
//
// THE CACHE KEY IS ALSO THE SECURITY BOUNDARY. READ THIS BEFORE CHANGING IT.
//
// The facts are computed in the browser (the scoring engine runs client-side)
// and posted here. A caller can therefore post whatever facts they like. That
// is acceptable for their OWN reading — they would only get prose about numbers
// their own browser is already showing them, harming nobody — but it would be a
// serious hole if forged facts could overwrite what OTHER users see.
//
// So the key includes a fingerprint of the FACTS, not just the token identity:
//
//     analysis/<identity>/<factsHash>/<language>
//
// Forged facts hash differently, land in their own cache slot, and are read
// back only by a caller posting those same forged facts. Cache poisoning is
// structurally impossible rather than merely guarded against. The same property
// gives correct invalidation for free: when a token's real data moves, the hash
// moves, and the next reader gets a fresh analysis rather than stale prose
// about numbers that no longer hold.
import { getNamedStore } from './_blobsClient.mjs';

const STORE_NAME = 'khan-trust-analysis';

// Entries older than this are regenerated even when the facts are unchanged, so
// a prompt or model improvement reaches existing tokens instead of being masked
// forever by a warm cache.
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Bumped whenever the prompt, schema or field set changes in a way that should
// invalidate existing prose. Part of the key, so a bump is a clean cutover with
// no purge step.
export const ANALYST_PROMPT_VERSION = 2;

function store() {
  return getNamedStore(STORE_NAME);
}

// FNV-1a, 32-bit. A non-cryptographic hash is the right tool here: this is a
// cache-bucketing and change-detection key, not a security token — the security
// property comes from forged facts landing in a DIFFERENT bucket, which any
// deterministic hash provides. Implemented inline rather than pulling in
// node:crypto so this module stays trivially bundleable and synchronous.
export function fingerprintFacts(facts) {
  // Keys sorted so an object built in a different property order still hashes
  // the same — otherwise every client refactor would silently invalidate the
  // entire cache.
  const stable = JSON.stringify(facts, Object.keys(facts).sort());
  let hash = 0x811c9dc5;
  for (let i = 0; i < stable.length; i += 1) {
    hash ^= stable.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

function analysisKey(identity, factsHash, language) {
  const safeIdentity = String(identity || 'unknown').replace(/[^a-zA-Z0-9:_-]/g, '');
  return `analysis/${safeIdentity}/${ANALYST_PROMPT_VERSION}/${factsHash}/${language}`;
}

export async function getCachedAnalysis(identity, factsHash, language) {
  const data = await store().get(analysisKey(identity, factsHash, language), { type: 'json' }).catch(() => null);
  if (!data || typeof data !== 'object') return null;

  const generatedAt = Date.parse(data.generatedAt);
  if (Number.isFinite(generatedAt) && (Date.now() - generatedAt) > MAX_AGE_MS) return null;

  return data;
}

export async function putCachedAnalysis(identity, factsHash, language, payload) {
  const record = { ...payload, generatedAt: new Date().toISOString() };
  // Best-effort: a cache write failing must not fail the request. The caller
  // already has the analysis in hand — losing the cache entry costs one extra
  // generation later, where failing the request costs the user their feature.
  try {
    await store().setJSON(analysisKey(identity, factsHash, language), record);
  } catch {
    // intentionally ignored
  }
  return record;
}
