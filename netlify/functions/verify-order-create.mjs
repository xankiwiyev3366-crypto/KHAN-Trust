// POST /.netlify/functions/verify-order-create
// { contract, chain, tierId, projectId? }
//
// Creates a pending order and returns where to send the money. Takes nothing,
// promises nothing, reserves nothing — the contract is only locked at
// activation, once a payment actually exists (see _verificationOrders.mjs).
//
// WHY THE PRICE IS RE-DERIVED HERE AND NOT ACCEPTED FROM THE BODY
//
// The obvious shape for this endpoint is to let the client post the amount it
// showed the user. That would let anyone buy the $399 tier for $1 by editing
// one JSON field. The tier ID is the only thing taken from the caller; the
// price attached to the order comes from src/lib/verificationTiers.js, the same
// module the activation check re-reads. An unknown tier id is refused outright
// rather than defaulted — verificationTierUsd() returns null on purpose.
//
// THE FLOOR IS RE-CHECKED, NOT TRUSTED
//
// verify-quote already applied the score floor. It is applied again here
// because the quote is a public GET the buyer can simply skip: posting straight
// to this endpoint would otherwise create a payable order for a token the
// scanner rates as high-risk. A gate that only runs when the client chooses to
// call it is not a gate.
import { getCorpusToken } from './_tokenCorpusStore.mjs';
import { verifyJwt, bearerToken } from './_authStore.mjs';
import { provenWallet } from './_walletSession.mjs';
import { accountSubject } from './_entitlementsStore.mjs';
import { tokenIdentity } from '../../src/lib/tokenIdentity.js';
import {
  getVerificationTier,
  DEFAULT_VERIFY_MIN_SCORE,
  meetsScoreFloor,
} from '../../src/lib/verificationTiers.js';
import {
  buildOrder,
  putOrder,
  findActiveOrderForContract,
  contractKey,
  jsonResponse,
} from './_verificationOrders.mjs';

// The treasury for verification revenue. A SEPARATE address from the Premium
// payment wallet is recommended — a $9/month subscription stream and a
// $149/$399 one-time stream landing on one address makes reconciliation and
// any future webhook filtering needlessly painful. It falls back to the Premium
// wallet so the feature is not dead on a deployment that has not set it yet,
// and the response says which one is in use so that is never a silent surprise.
function treasury() {
  return process.env.VERIFY_TREASURY_WALLET || process.env.VITE_KHAN_PAYMENT_WALLET || '';
}

function minScore() {
  const raw = Number(process.env.VERIFY_MIN_SCORE);
  return Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : DEFAULT_VERIFY_MIN_SCORE;
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

    const contract = String(payload.contract || '').trim();
    const chain = String(payload.chain || 'solana').trim().toLowerCase();
    const tier = getVerificationTier(payload.tierId);

    if (!contract) return jsonResponse(400, { message: 'contract is required' });
    if (!tier) return jsonResponse(400, { message: 'Unknown verification tier' });

    const wallet = treasury();
    if (!wallet) {
      // Fail LOUDLY. Everything optional in this codebase degrades to a silent
      // no-op (_telegram without a token, _email without a key, _db without a
      // URL) and that posture is right for those. It is wrong for a payment
      // path: an order with no destination address is not a degraded sale, it
      // is an invitation to send money nowhere.
      return jsonResponse(503, {
        message: 'Verification payments are not configured yet.',
        reason: 'no_treasury',
      });
    }

    const key = contractKey(chain, contract);
    const active = await findActiveOrderForContract(key);
    if (active) {
      return jsonResponse(409, {
        message: 'This contract already has an active verification.',
        reason: 'already_verified',
        verifiedUntil: active.expiresAt || null,
      });
    }

    // Re-derive the score from the corpus. See the header: the quote endpoint's
    // check is skippable, this one is not.
    const identity = tokenIdentity({ contract, chainId: chain });
    const record = identity ? await getCorpusToken(identity) : null;
    if (!record || typeof record.trustScore !== 'number') {
      return jsonResponse(409, {
        message: 'This token has not been scanned yet. Run a free scan first.',
        reason: 'needs_scan',
      });
    }
    const floor = minScore();
    if (!meetsScoreFloor(record.trustScore, floor)) {
      return jsonResponse(409, {
        message: 'This token does not currently meet the minimum Trust Score for verification.',
        reason: 'below_floor',
        score: record.trustScore,
        minScore: floor,
      });
    }

    // WHO IS BUYING. Taken only from proven identity — a verified JWT or a
    // wallet-session token — never from the body. Optional: an anonymous buyer
    // is allowed, because requiring an account before taking a payment is the
    // exact friction that made Premium checkout demand a wallet. The subject is
    // recorded so the Premium bonus can be granted at activation; without one,
    // the bonus attaches to the paying wallet instead.
    const auth = verifyJwt(bearerToken(event));
    const proven = provenWallet(event);
    const buyerSubject = auth?.sub ? accountSubject(auth.sub) : (proven || '');

    const order = buildOrder({
      chain,
      contract,
      tierId: tier.id,
      buyerSubject,
      quoteScore: record.trustScore,
      projectId: String(payload.projectId || '').trim(),
    });
    await putOrder(order);

    return jsonResponse(200, {
      ok: true,
      order: {
        id: order.id,
        chain: order.chain,
        contract: order.contract,
        tierId: order.tierId,
        usd: order.usd,
        status: order.status,
        createdAt: order.createdAt,
      },
      payment: {
        treasuryWallet: wallet,
        usd: order.usd,
        // Whether this deployment separated the treasuries. Surfaced rather than
        // hidden so an operator can see at a glance that verification revenue is
        // landing on the Premium address.
        dedicatedTreasury: Boolean(process.env.VERIFY_TREASURY_WALLET),
      },
    });
  } catch (error) {
    return jsonResponse(500, { message: `verify-order-create crashed: ${error.message}` });
  }
}
