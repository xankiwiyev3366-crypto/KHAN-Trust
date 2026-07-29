// GET /.netlify/functions/verify-quote?contract=<addr>&chain=<chainId>
//
// The gate in front of the verification sale. Answers one question: may this
// token be sold a verified badge, and for how much?
//
// WHERE THE SCORE COMES FROM, AND WHY IT MATTERS MORE THAN IT LOOKS
//
// This codebase computes two trust scores that are NOT comparable.
// _rescanEngine.mjs documents the case verbatim: at one instant a token scores
// 35 from the client's ~18-provider fan-out and 76 from the server's two
// keyless calls, and "both are internally consistent; neither is wrong; they
// are simply not comparable."
//
// A quote endpoint therefore has to choose, and choosing the convenient one is
// a trap. The server lane is right here in a Function and would answer in two
// HTTP calls — but its number is one no visitor has ever seen. A team looking
// at 62 on their token's page, quoted 38 and refused a sale, is being told the
// platform disagrees with itself. The reverse is worse: selling verification to
// a token the public page rates as high-risk.
//
// So the quote reads the CORPUS — the durable record of real, completed
// client-lane scans (netlify/functions/_tokenCorpusStore.mjs). Same number, same
// methodology, same lane as the public profile. The cost is that a token nobody
// has ever scanned cannot be quoted, and the caller is told to run the free scan
// first. That is a feature: it makes the free scanner the top of the
// verification funnel, and it means no second scoring lane has to be built or
// kept in sync with the first.
//
// ABSENCE IS NOT A ZERO AND IT IS NOT A PASS. "Never scanned" returns
// `needs_scan`, distinct from `below_floor`. Collapsing them would either refuse
// a legitimate customer for a scan they were never asked to run, or — far worse
// — let an unscored token through a floor it was never measured against.
import { getCorpusToken, jsonResponse } from './_tokenCorpusStore.mjs';
import { findActiveOrderForContract, contractKey } from './_verificationOrders.mjs';
import { recordEvent } from './_productEvents.mjs';
import { tokenIdentity } from '../../src/lib/tokenIdentity.js';
import { PRODUCT_EVENTS } from '../../src/lib/productEvents.js';
import {
  VERIFICATION_TIERS,
  DEFAULT_VERIFY_MIN_SCORE,
  meetsScoreFloor,
} from '../../src/lib/verificationTiers.js';

// Operator override, server-side only. Deliberately NOT a VITE_ variable: the
// client reads the floor off this endpoint's response, so there is exactly one
// authority for it and a browser cannot be told a different number than the one
// the sale is actually judged against.
function minScore() {
  const raw = Number(process.env.VERIFY_MIN_SCORE);
  return Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : DEFAULT_VERIFY_MIN_SCORE;
}

// The tier list the client renders. Derived from the shared module rather than
// restated, so a price change lands in the UI, the order and the payment check
// together or not at all.
function publicTiers() {
  return Object.values(VERIFICATION_TIERS).map((tier) => ({
    id: tier.id,
    usd: tier.usd,
    durationDays: tier.durationDays,
    premiumBonusMonths: tier.premiumBonusMonths,
    includes: tier.includes,
  }));
}

export async function handler(event) {
  try {
    if (event.httpMethod !== 'GET') {
      return jsonResponse(405, { message: 'Method not allowed' });
    }

    const contract = (event.queryStringParameters?.contract || '').trim();
    // Solana is the default because it is the only chain this platform takes
    // payment on and by far the most common case; an explicit chain still wins.
    const chain = (event.queryStringParameters?.chain || 'solana').trim().toLowerCase();

    if (!contract) {
      return jsonResponse(400, { message: 'contract query parameter is required' });
    }

    const floor = minScore();
    const key = contractKey(chain, contract);

    // Already sold. Checked BEFORE the score so an owner renewing, or a
    // competitor probing, gets the honest answer rather than a purchasable
    // quote for something that is not for sale.
    const active = await findActiveOrderForContract(key);
    if (active) {
      return jsonResponse(200, {
        eligible: false,
        reason: 'already_verified',
        minScore: floor,
        // No buyer subject, no order id, no wallet. This endpoint is public and
        // unauthenticated; who bought a verification is not public information.
        verifiedUntil: active.expiresAt || null,
        tiers: publicTiers(),
      });
    }

    const identity = tokenIdentity({ contract, chainId: chain });
    const record = identity ? await getCorpusToken(identity) : null;

    if (!record || typeof record.trustScore !== 'number') {
      // Not a rejection — an instruction. The client sends them to the free
      // scanner and the quote succeeds on their return.
      return jsonResponse(200, {
        eligible: false,
        reason: 'needs_scan',
        minScore: floor,
        score: null,
        tiers: publicTiers(),
      });
    }

    const score = record.trustScore;
    if (!meetsScoreFloor(score, floor)) {
      return jsonResponse(200, {
        eligible: false,
        reason: 'below_floor',
        minScore: floor,
        score,
        riskLevel: record.riskLevel || null,
        scoredAt: record.updatedAt || null,
        tiers: publicTiers(),
      });
    }

    // The top of the verification funnel. Only an ELIGIBLE quote is recorded —
    // `needs_scan` and `below_floor` are refusals, and counting them as quotes
    // would put every high-risk token that was turned away into the denominator
    // of the conversion rate, making the funnel look broken while it was working
    // exactly as designed.
    //
    // Fire-and-forget: this endpoint is public and unauthenticated, and a
    // telemetry write must never delay or fail a price quote.
    recordEvent({
      name: PRODUCT_EVENTS.VERIFICATION_QUOTE_CREATED,
      chain,
      contract,
      source: event.headers?.referer || event.headers?.Referer || '',
      metadata: { score, minScore: floor },
    }).catch(() => {});

    return jsonResponse(200, {
      eligible: true,
      reason: 'ok',
      minScore: floor,
      score,
      riskLevel: record.riskLevel || null,
      // The client shows this date next to the score. A quote resting on a scan
      // from four months ago is a materially different offer than one resting on
      // this morning's, and the buyer is entitled to see which they are getting.
      scoredAt: record.updatedAt || null,
      chain,
      contract,
      tiers: publicTiers(),
    });
  } catch (error) {
    return jsonResponse(500, { message: `verify-quote crashed: ${error.message}` });
  }
}
