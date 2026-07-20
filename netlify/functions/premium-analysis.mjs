// POST /.netlify/functions/premium-analysis
//
// The Grounded AI Analyst's prose for one token, in the caller's language.
//
// PREMIUM-GATED, AND THAT IS ALSO THE ABUSE CONTROL. This is the only endpoint
// in the platform that can spend money on a per-request basis, so the first
// gate is that the caller has paid, the second is a rate limit, and the third
// is the hard monthly ceiling in _aiBudget (which fails closed). A miss on any
// one of them degrades to deterministic templates rather than to an error.
//
// WHY THE CLIENT POSTS THE FACTS
//
// The scoring engine runs in the browser — that is pre-existing architecture,
// not a choice made here — so the computed project is already client-side. Re-
// deriving it on the server would mean a second implementation of an 18-provider
// fetch and a 550-line engine, and any drift between the two would show up as
// prose that contradicts the numbers on screen, which is the exact failure this
// whole phase exists to avoid.
//
// Posting the facts is safe because of what the response can and cannot do:
//   - It cannot change a number the user sees. Every score, signal and level is
//     rendered from the client's own engine output; this endpoint returns
//     SENTENCES only.
//   - It cannot affect another user. The cache key is a fingerprint of the
//     posted facts (see _analysisStore), so forged facts land in their own slot
//     and are read back only by a caller posting those same forged facts.
//
// So the worst a caller can do by lying is read prose about their own invented
// numbers, which is not an attack on anybody.
import { verifyJwt, bearerToken } from './_authStore.mjs';
import { getAccountEntitlement, isPremiumPlan } from './_entitlementsStore.mjs';
import { getGrant, isGrantActive } from './_premiumStore.mjs';
import { enforce } from './_rateLimit.mjs';
import { generateAnalysis, buildFacts, SUPPORTED_LANGUAGES } from './_groundedAnalyst.mjs';
import { getCachedAnalysis, putCachedAnalysis, fingerprintFacts } from './_analysisStore.mjs';
import { jsonResponse } from './_blobsClient.mjs';

// The limit itself lives in RATE_POLICIES.premium_analysis_user, alongside
// every other policy, so ceilings are reviewable in one place. `enforce`
// silently allows an unknown policy name, so the policy MUST exist there or
// this guard becomes dead code that looks live.

export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return jsonResponse(405, { message: 'Method not allowed' });

    const payload = verifyJwt(bearerToken(event));
    if (!payload?.sub) return jsonResponse(401, { message: 'Unauthorized' });

    // Premium check, account-side only — same two sources as resolveUserTier.
    // A non-Premium caller is refused rather than served: this is the one place
    // where a request costs real money.
    let premium = false;
    try {
      const entitlement = await getAccountEntitlement(payload.sub);
      premium = Boolean(entitlement && isPremiumPlan(entitlement.plan));
      if (!premium) premium = isGrantActive(await getGrant(payload.sub));
    } catch {
      premium = false;
    }
    if (!premium) return jsonResponse(403, { message: 'Premium required', fallback: true });

    let body;
    try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { message: 'Invalid JSON' }); }

    const project = body.project;
    if (!project || typeof project !== 'object') {
      return jsonResponse(400, { message: 'project is required' });
    }
    const identity = String(body.identity || '').slice(0, 100);
    if (!identity) return jsonResponse(400, { message: 'identity is required' });

    const language = SUPPORTED_LANGUAGES.has(body.language) ? body.language : 'en';

    // The exact object the model will be shown, and the exact object the
    // validator will derive legitimate numbers from. Fingerprinting THIS rather
    // than the raw project means cosmetic changes to the client payload do not
    // needlessly invalidate the cache.
    const facts = buildFacts(project);
    const factsHash = fingerprintFacts(facts);

    // Cache first — the common case, and free.
    const cached = await getCachedAnalysis(identity, factsHash, language);
    if (cached) {
      return jsonResponse(200, { ok: true, cached: true, fields: cached.fields || {} });
    }

    // Only a MISS is rate-limited, so normal reading of already-analysed tokens
    // is never throttled.
    const limit = await enforce('premium_analysis_user', payload.sub)
      .catch(() => ({ allowed: true }));
    if (limit && limit.allowed === false) {
      // Not an error to the client: fall back to templates, quietly.
      return jsonResponse(200, { ok: false, reason: 'rate_limited', fields: {} });
    }

    const result = await generateAnalysis({ project, language });

    if (!result.ok) {
      // Budget exhausted, no API key, refusal, timeout — all normal operating
      // states. 200 with empty fields; the client renders its deterministic
      // prose and the user sees a complete card either way.
      return jsonResponse(200, { ok: false, reason: result.reason, fields: {} });
    }

    if (result.rejected?.length) {
      // A model citing numbers the engine never produced is a prompt or model
      // regression, and it must be visible in the logs rather than silently
      // absorbed by the fallback.
      console.warn(
        `[premium-analysis] dropped ${result.rejected.length} field(s) for unverifiable numbers: `
        + JSON.stringify(result.rejected)
      );
    }

    await putCachedAnalysis(identity, factsHash, language, { fields: result.fields });

    return jsonResponse(200, { ok: true, cached: false, fields: result.fields });
  } catch (error) {
    // Even an unexpected crash returns 200-with-no-fields rather than a 500:
    // the client's fallback is correct and complete, and a Premium user must
    // never see a broken card because an optional enhancement failed.
    console.error(`[premium-analysis] crashed: ${error.message}`);
    return jsonResponse(200, { ok: false, reason: 'crashed', fields: {} });
  }
}
