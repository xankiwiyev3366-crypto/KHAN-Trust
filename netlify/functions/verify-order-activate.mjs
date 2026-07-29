// POST /.netlify/functions/verify-order-activate
// { orderId, transactionHash }
// Header: x-khan-wallet-auth: <wallet-session token>
//
// The moment money becomes a badge. Three independent things must all hold, and
// the order they are checked in is deliberate.
//
//   1. OWNERSHIP OF A WALLET — proven cryptographically, before anything else.
//   2. PAYMENT — the chain says the right amount reached the treasury.
//   3. EXCLUSIVITY — no one else already holds this contract.
//
// WHY THE NONCE SYSTEM AND NOT THE EXISTING SIGNED MESSAGE
//
// The pre-existing verification-request.mjs asks the owner to sign a message
// containing a CLIENT-SUPPLIED timestamp. That is replayable: anyone who ever
// sees such a signature can resubmit it. It was tolerable when an admin
// reviewed every request by hand and nothing was for sale. It is not tolerable
// when the signature is what unlocks a $149 purchase.
//
// _walletSession.mjs already implements the correct primitive — a server-issued
// one-time nonce, stored, consumed on use, verified with tweetnacl — and it is
// already deployed for premium user-data access. So the paid flow requires a
// wallet-session token (wallet-challenge -> wallet-auth) instead of inventing a
// second nonce system.
//
// WHAT "PROVING OWNERSHIP" ACTUALLY MEANS, HONESTLY
//
// A wallet-session token proves control of a WALLET. It says nothing about that
// wallet's relationship to the token being verified. Two levels are therefore
// recorded, and the difference is preserved rather than flattened:
//
//   'mint_authority'  the proven wallet IS the token's mint authority, checked
//                     against the chain here. Self-evident and automatic.
//   'admin_review'    the wallet is proven but its link to the project is not,
//                     so the order lands PAID and the badge is withheld until
//                     the existing admin review approves it.
//
// The badge does not go live on payment. It goes live on proof. Selling the
// badge and shipping it on receipt of funds is exactly the failure mode that
// makes a paid verification worthless.
import { verifyJwt, bearerToken } from './_authStore.mjs';
import { provenWallet } from './_walletSession.mjs';
import {
  accountSubject,
  isSignatureUsed,
  markSignatureUsed,
  grantTimedBonus,
} from './_entitlementsStore.mjs';
import { readStatuses, writeStatuses, readRequests, writeRequests } from './_verificationStore.mjs';
import { inspectPayment, rpcPost } from './_solanaChainPayments.mjs';
import {
  getOrder,
  putOrder,
  claimContract,
  withActivation,
  ORDER_STATUS,
  jsonResponse,
} from './_verificationOrders.mjs';
import {
  getVerificationTier,
  verificationTierUsd,
  premiumBonusExpiry,
} from '../../src/lib/verificationTiers.js';
import crypto from 'node:crypto';

function treasury() {
  return process.env.VERIFY_TREASURY_WALLET || process.env.VITE_KHAN_PAYMENT_WALLET || '';
}

// Is the proven wallet the mint authority of this token?
//
// Returns true ONLY on a definite yes. An RPC failure, an unparseable account,
// a non-Solana chain and a renounced (null) authority all return false, which
// routes the order to admin review rather than granting the stronger claim.
// Failing towards "a human should look at this" is the only safe direction: the
// alternative is auto-verifying a project because a lookup timed out.
async function provesMintAuthority({ chain, contract, wallet }) {
  if (chain !== 'solana' || !wallet || !contract) return false;
  const debug = { rpcAttemptCount: 0, rpcAttempts: [], rpcUrlUsed: null, rpcError: null };
  try {
    const result = await rpcPost('getAccountInfo', [contract, { encoding: 'jsonParsed' }], debug);
    const info = result?.value?.data?.parsed?.info;
    if (!info) return false;
    // A renounced mint authority is null. That is GOOD for the token's trust
    // score and simply means this particular proof is unavailable — it must not
    // read as a match against a wallet that is also null/undefined.
    const authority = info.mintAuthority;
    if (!authority) return false;
    return authority === wallet;
  } catch {
    return false;
  }
}

// A per-verification secret embedded in the public badge/profile URL later, so
// a badge can be pinned to the exact verification that produced it rather than
// to a guessable project id. Generated once, at activation.
function newBadgeToken() {
  return crypto.randomBytes(16).toString('hex');
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

    const order = await getOrder(String(payload.orderId || '').trim());
    if (!order) return jsonResponse(404, { message: 'Order not found' });

    if (order.status === ORDER_STATUS.ACTIVE) {
      // Idempotent. A retried activation (double-click, flaky connection, a
      // client that polls) must return the same success rather than attempting
      // a second payment check against an already-spent signature.
      return jsonResponse(200, { ok: true, status: order.status, order: publicOrder(order) });
    }
    if (order.status === ORDER_STATUS.DUPLICATE) {
      return jsonResponse(409, { message: 'This order was superseded and is refundable.', reason: 'duplicate', order: publicOrder(order) });
    }
    if (order.status === ORDER_STATUS.CANCELLED || order.status === ORDER_STATUS.REVOKED) {
      return jsonResponse(409, { message: 'This order is closed.', reason: order.status });
    }

    // ── 1. Wallet ownership, first and unconditionally ──────────────────────
    const wallet = provenWallet(event);
    if (!wallet) {
      return jsonResponse(401, {
        message: 'Connect and sign with the wallet that controls this project.',
        reason: 'ownership_proof_required',
      });
    }

    // ── 2. Payment ──────────────────────────────────────────────────────────
    const signature = String(payload.transactionHash || '').trim();
    const requiredUsd = verificationTierUsd(order.tierId);

    // The signature ledger is SHARED with Premium. That is intentional: one
    // on-chain transfer may buy exactly one thing on this platform, and a
    // per-product ledger would let the same payment redeem a Premium
    // subscription AND a verification.
    if (signature && await isSignatureUsed(signature)) {
      // Unless it was OUR payment being retried, which is not a replay.
      if (order.paymentSignature !== signature) {
        return jsonResponse(409, {
          message: 'This transaction has already been used.',
          reason: 'signature_already_used',
        });
      }
    }

    let settlement = null;
    if (order.status !== ORDER_STATUS.PAID) {
      settlement = await inspectPayment({ signature, treasury: treasury(), requiredUsd });
      if (settlement.status !== 'settled') {
        // 'not_confirmed' and 'waiting' are not failures — the client polls.
        // Everything is returned verbatim so the UI can say the true thing.
        return jsonResponse(200, {
          ok: false,
          status: settlement.status,
          message: settlement.message,
          reason: settlement.reason || settlement.status,
        });
      }
      await markSignatureUsed(signature, settlement.buyerWallet);
    }

    // ── 3. Exclusivity, only now that money has actually moved ──────────────
    const claim = await claimContract(order);
    if (!claim.won) {
      // Paid, but someone else holds the contract. The payment signature is
      // KEPT on the record: this is a refund case, and a refund needs a
      // traceable transaction. Discarding it to keep the data model tidy would
      // lose a real customer's real money.
      const duplicate = {
        ...order,
        status: ORDER_STATUS.DUPLICATE,
        paymentSignature: signature || order.paymentSignature,
        paymentCurrency: settlement?.currency || order.paymentCurrency,
        amountPaid: settlement?.amountPaid ?? order.amountPaid,
        paidAt: order.paidAt || new Date().toISOString(),
        ownerWallet: wallet,
        supersededBy: claim.heldBy || '',
        updatedAt: new Date().toISOString(),
      };
      await putOrder(duplicate);
      console.warn(`[verify-activate] duplicate sale on ${order.contractKey} (enforcedBy=${claim.enforcedBy}, heldBy=${claim.heldBy}) — order ${order.id} is refundable, signature ${signature}`);
      return jsonResponse(409, {
        message: 'Another verification for this contract was completed first. Your payment is recorded and refundable.',
        reason: 'duplicate',
        order: publicOrder(duplicate),
      });
    }

    // ── Ownership level ─────────────────────────────────────────────────────
    const isMintAuthority = await provesMintAuthority({
      chain: order.chain,
      contract: order.contract,
      wallet,
    });
    const ownershipMethod = isMintAuthority ? 'mint_authority' : 'admin_review';

    const paidBase = {
      ...order,
      paymentSignature: signature || order.paymentSignature,
      paymentCurrency: settlement?.currency || order.paymentCurrency,
      amountPaid: settlement?.amountPaid ?? order.amountPaid,
      paidAt: order.paidAt || new Date().toISOString(),
      ownerWallet: wallet,
      ownershipMethod,
    };

    if (!isMintAuthority) {
      // PAID, NOT ACTIVE. The badge is withheld. An entry is pushed into the
      // EXISTING admin review queue (verification-admin-list reads this store),
      // so paid orders and the free requests that predate them are reviewed
      // through one screen rather than two.
      const paid = { ...paidBase, status: ORDER_STATUS.PAID, updatedAt: new Date().toISOString() };
      await putOrder(paid);

      const projectId = order.projectId || order.contractKey;
      const requests = await readRequests();
      const request = {
        id: `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        projectId,
        projectName: order.contract,
        contract: order.contract,
        ownerWallet: wallet,
        walletAddress: wallet,
        // No client-supplied signature/timestamp: ownership was proven by the
        // wallet-session nonce, which is stronger than what this record used to
        // carry. The field is kept for shape compatibility with the admin UI.
        signature: '',
        timestamp: new Date().toISOString(),
        proofNote: `Paid verification order ${order.id} (${order.tierId}). Wallet ownership proven by signed nonce; project link needs review.`,
        paidOrderId: order.id,
        tier: order.tierId,
        priority: getVerificationTier(order.tierId)?.includes.includes('priorityReview') || false,
        status: 'pending',
        adminNote: '',
        createdAt: new Date().toISOString(),
      };
      await writeRequests([request, ...requests.filter((item) => item.projectId !== projectId)]);

      const statuses = await readStatuses();
      statuses[projectId] = { status: 'pending', updatedAt: request.createdAt, adminNote: '' };
      await writeStatuses(statuses);

      return jsonResponse(200, {
        ok: true,
        status: ORDER_STATUS.PAID,
        ownershipMethod,
        message: 'Payment received. Your ownership proof is with our reviewers.',
        order: publicOrder(paid),
      });
    }

    // ── Activation ──────────────────────────────────────────────────────────
    const active = { ...withActivation(paidBase, { ownerWallet: wallet, ownershipMethod }), badgeToken: newBadgeToken() };
    await putOrder(active);

    // The PUBLIC verification status — the one the badge endpoint, the token
    // page and every "Verified by KHAN Trust" mark on the site read. Written to
    // the existing store rather than a parallel one, so nothing downstream has
    // to learn about paid verification to honour it.
    const projectId = order.projectId || order.contractKey;
    const statuses = await readStatuses();
    statuses[projectId] = {
      status: 'verified',
      updatedAt: active.activatedAt,
      adminNote: '',
      // New, additive fields. Every existing consumer ignores what it does not
      // know about, and isVerificationActive() treats a record with no
      // expiresAt as permanent — so the admin-approved verifications that
      // predate this system keep working untouched.
      expiresAt: active.expiresAt,
      tier: active.tierId,
      ownershipMethod,
      ownerWallet: wallet,
      badgeToken: active.badgeToken,
      orderId: active.id,
    };
    await writeStatuses(statuses);

    // ── The included Premium months ─────────────────────────────────────────
    // Granted through the EXISTING entitlements store so resolveVerifiedPremium
    // Access() sees it with no changes. A parallel table would have made this
    // bonus invisible to every feature gate on the platform.
    const auth = verifyJwt(bearerToken(event));
    const bonusSubject = auth?.sub ? accountSubject(auth.sub) : (order.buyerSubject || wallet);
    const bonusExpiry = premiumBonusExpiry(order.tierId, Date.parse(active.activatedAt));
    let bonus = { granted: false, reason: 'no_subject' };
    if (bonusSubject && bonusExpiry) {
      // grantTimedBonus never shortens an existing entitlement — see its header
      // for the monthly subscriber this would otherwise have silently downgraded.
      bonus = await grantTimedBonus(bonusSubject, {
        plan: 'premium',
        expiresAt: bonusExpiry,
        source: 'verification_bonus',
        verificationOrderId: active.id,
      }).catch(() => ({ granted: false, reason: 'error' }));
    }

    return jsonResponse(200, {
      ok: true,
      status: ORDER_STATUS.ACTIVE,
      ownershipMethod,
      order: publicOrder(active),
      premiumBonus: bonus,
    });
  } catch (error) {
    return jsonResponse(500, { message: `verify-order-activate crashed: ${error.message}` });
  }
}

// What a buyer may see about their own order. Deliberately narrower than the
// stored record: buyerSubject and the raw admin fields stay server-side.
function publicOrder(order) {
  return {
    id: order.id,
    chain: order.chain,
    contract: order.contract,
    tierId: order.tierId,
    usd: order.usd,
    status: order.status,
    ownershipMethod: order.ownershipMethod || '',
    activatedAt: order.activatedAt || '',
    expiresAt: order.expiresAt || '',
    badgeToken: order.badgeToken || '',
    createdAt: order.createdAt,
  };
}
