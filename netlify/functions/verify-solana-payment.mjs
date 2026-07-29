// Runs server-side on Netlify. Public Solana RPC endpoints (notably
// api.mainnet-beta.solana.com) reject many browser-origin fetches with HTTP
// 403 - this function performs the getTransaction lookup from Netlify's
// infrastructure instead, where that restriction doesn't apply.
//
// On a verified payment this also grants an entitlement (see
// _entitlementsStore.mjs) to the wallet that signed/paid for the
// transaction, keyed by wallet address since there are no user accounts.

// The chain-reading half of this file now lives in _solanaChainPayments.mjs,
// parameterised by treasury wallet, because paid verification is a second
// product paid to a possibly-different address and forking the money path to
// get there would have duplicated every non-obvious rule in it (the SPL mint
// allow-list above all). This file keeps what is Premium-specific: replay
// protection through the shared used-signatures ledger, and who gets granted.
import { grantEntitlement, grantAccountEntitlement, accountSubject, isSignatureUsed, markSignatureUsed } from './_entitlementsStore.mjs';
import { verifyJwt, bearerToken } from './_authStore.mjs';
import { markMilestone } from './_referralStore.mjs';
import { planUsdAmount } from '../../src/lib/pricing.js';
import { inspectPayment } from './_solanaChainPayments.mjs';

// THE KEYED ENDPOINT, ON THE PAYMENT PATH — read from the right variable.
//
// This line read ONLY `VITE_SOLANA_RPC_URL`. That variable was retired when a
// previous deployment set it to a keyed Helius endpoint and Vite inlined the
// key into every visitor's bundle (see .env.example and README_DEPLOY.md, both
// of which instruct the operator to DELETE it from Netlify and rotate the key).
// Following that instruction — the correct thing to do — silently downgraded
// live payment verification to the unkeyed fallback below, because nothing else
// here supplied a URL.
//
// `api.mainnet-beta.solana.com` is aggressively rate-limited. A throttled
// getTransaction is indistinguishable here from a transaction that does not
// exist, so the failure mode is a customer who really paid being told their
// payment could not be verified. That is the worst class of bug this file can
// have, and it was reachable purely by doing the documented cleanup.
//
// `SOLANA_RPC_URL` is the server-side, never-inlined variable that already
// holds the keyed URL for the rest of the backend. Preferring it makes this
// function consistent with _khanIndexer.mjs, which resolves the same way. The
// retired name is kept as a second choice ONLY so a deployment that has not yet
// finished the migration keeps working; it must not be re-added to Netlify.
const RPC_URL = process.env.SOLANA_RPC_URL || process.env.VITE_SOLANA_RPC_URL || '';
const PAYMENT_WALLET = process.env.VITE_KHAN_PAYMENT_WALLET || '';

// Constants, the SPL mint allow-list, RPC transport, the SOL/USD price feed and
// every transfer-detection routine now come from _solanaChainPayments.mjs. They
// are unchanged in behaviour — the module was created by MOVING them out of
// this file so the verification product could not fork them.


// Premium is the only paid product left - a wallet either has an active
// Premium/Early Supporter entitlement or it doesn't. Launchpad/token creation
// no longer collects its own separate fee (see src/main.jsx LaunchpadPage);
// it is gated purely on this same entitlement, granted here.
//
// The required USD per plan comes from the shared single source of truth
// (src/lib/pricing.js) — the SAME module src/cryptoPayment.js reads to decide
// how much to charge — so the amount a wallet is asked to pay and the amount
// required here can never drift apart. Imported across the src/ boundary exactly
// as _rescanEngine.mjs imports src/lib/trustScore.js.

// `accountUserId` is the verified id of the SIGNED-IN buyer, resolved from their
// JWT by the handler (never from the request body — a body-supplied id would let
// anyone grant Premium to a stranger's account). When present, a verified
// payment grants Premium to that account IN ADDITION to the paying wallet, so a
// signed-in buyer sees Premium immediately with no "claim wallet" step. When
// absent (anonymous caller, legacy flow) the behaviour is byte-for-byte the old
// wallet-only grant.
async function verifySolanaPayment({ transactionHash, plan, accountUserId = null }) {
  const signature = String(transactionHash || '').trim();
  const requiredUsd = planUsdAmount(plan);

  // REPLAY PROTECTION, BEFORE THE CHAIN LOOKUP. A confirmed signature can only
  // redeem one entitlement; without this a single paid transaction hash could
  // be replayed to grant access to multiple wallets. Checked here rather than
  // inside the shared inspector because "spent" means something different per
  // product — see the note on inspectPayment.
  //
  // Deliberately still ahead of the RPC call: a replayed hash costs no network
  // round trip, and the format check inside inspectPayment would otherwise run
  // first and change the status a malformed-but-used signature returns.
  if (signature && await isSignatureUsed(signature)) {
    return {
      status: 'already_used',
      message: 'This transaction has already been used to unlock access',
      debug: { signatureLength: signature.length, finalDecision: 'already_used', requiredUsdAmount: requiredUsd },
    };
  }

  const settlement = await inspectPayment({
    signature,
    treasury: PAYMENT_WALLET,
    requiredUsd,
  });

  const debug = { ...settlement.debug, grantedToAccount: false };
  if (settlement.status !== 'settled') {
    // Every non-settled status ('not_configured', 'waiting', 'failed',
    // 'not_confirmed', 'wrong_receiver', 'amount_too_low') passes straight
    // through with its message and reason — the contract this endpoint has
    // always had with the client's polling UI.
    return { ...settlement, debug };
  }

  const { currency, amountPaid, buyerWallet } = settlement;
  debug.finalDecision = 'verified';
  await markSignatureUsed(signature, buyerWallet);
  const record = {
    plan,
    currency,
    amountPaid,
    transactionHash: signature,
    verifiedAt: new Date().toISOString(),
  };
  // The paying wallet is still granted, unconditionally and exactly as before:
  // it keeps the wallet-keyed entitlement working everywhere (and is the ONLY
  // grant for an anonymous buyer). This mirrors premium-claim-wallet's
  // "copy, never move" rule — nothing here can cost a wallet access it paid for.
  if (buyerWallet) {
    await grantEntitlement(buyerWallet, record);
  }
  // ADDITIONALLY grant to the signed-in account, so Premium is live on the
  // account immediately — no reconnecting the wallet, no separate claim step.
  // The wallet is recorded as context on the account's record, never as its key.
  if (accountUserId) {
    await grantAccountEntitlement(accountUserId, { ...record, wallet: buyerWallet || null });
    debug.grantedToAccount = true;
    // Referral funnel: a paid account grant advances this account's edge to
    // premium (or lifetime for Early Supporter / Founding Member). Only fires
    // when the buyer is signed in (accountUserId proven from their own JWT),
    // idempotent, best-effort — never affects the payment result.
    await markMilestone(accountUserId, plan === 'early_supporter' ? 'lifetime' : 'premium').catch(() => {});
  }
  return {
    status: 'verified',
    message: 'Payment verified',
    buyerWallet,
    accountSubject: accountUserId ? accountSubject(accountUserId) : null,
    debug,
  };
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ status: 'failed', message: 'Method not allowed' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ status: 'failed', message: 'Invalid request body' }) };
  }

  // The buyer's account, proven by their OWN JWT (optional). A missing or
  // invalid token simply yields null and the flow stays wallet-only — signing
  // in is never a precondition of a crypto payment, so this can never block a
  // sale. A valid token additionally routes the grant to that account. The id
  // is taken only from the verified token, never from payload, so the body
  // cannot redirect a grant to an account the caller does not own.
  const auth = verifyJwt(bearerToken(event));
  const accountUserId = auth?.sub || null;

  const result = await verifySolanaPayment({
    transactionHash: payload.transactionHash,
    plan: payload.plan,
    accountUserId,
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result),
  };
}
