// Runs server-side on Netlify. Public Solana RPC endpoints (notably
// api.mainnet-beta.solana.com) reject many browser-origin fetches with HTTP
// 403 - this function performs the getTransaction lookup from Netlify's
// infrastructure instead, where that restriction doesn't apply.
//
// On a verified payment this also grants an entitlement (see
// _entitlementsStore.mjs) to the wallet that signed/paid for the
// transaction, keyed by wallet address since there are no user accounts.

import { grantEntitlement, grantAccountEntitlement, accountSubject, isSignatureUsed, markSignatureUsed } from './_entitlementsStore.mjs';
import { verifyJwt, bearerToken } from './_authStore.mjs';
import { planUsdAmount } from '../../src/lib/pricing.js';

const RPC_URL = process.env.VITE_SOLANA_RPC_URL || '';
const PAYMENT_WALLET = process.env.VITE_KHAN_PAYMENT_WALLET || '';

// Only these SPL token mints count toward a payment. Both are 6-decimal USD
// stablecoins whose uiAmount maps 1:1 to USD (the assumption the amount check
// relies on). Without this allow-list a caller could transfer any worthless
// custom SPL token to the payment wallet and have its uiAmount counted as USD,
// unlocking Premium for free. Mirrors src/cryptoPayment.js SPL_TOKEN_CONFIG.
const ACCEPTED_TOKEN_MINTS = new Set([
  process.env.VITE_USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  process.env.VITE_USDT_MINT || 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
]);

const LAMPORTS_PER_SOL = 1_000_000_000;
const RPC_TIMEOUT_MS = 15000;
const PRICE_TIMEOUT_MS = 5000;
const AMOUNT_TOLERANCE = 0.98;
const SIGNATURE_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

const FALLBACK_RPC_URLS = ['https://api.mainnet-beta.solana.com'];

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

const SOL_PRICE_SOURCES = [
  {
    name: 'coingecko',
    url: 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
    extract: (data) => data?.solana?.usd,
  },
  {
    name: 'binance',
    url: 'https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT',
    extract: (data) => Number(data?.price),
  },
];

function getRpcUrlsToTry() {
  return [...new Set([RPC_URL, ...FALLBACK_RPC_URLS].filter(Boolean))];
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function rpcPostOnce(url, method, params) {
  const response = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    },
    RPC_TIMEOUT_MS
  );
  if (!response.ok) throw new Error(`RPC request failed (${response.status})`);
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'RPC error');
  return data.result;
}

async function rpcPost(method, params, debug) {
  const urls = getRpcUrlsToTry();
  for (const url of urls) {
    debug.rpcAttemptCount += 1;
    debug.rpcUrlUsed = url;
    try {
      const result = await rpcPostOnce(url, method, params);
      debug.rpcAttempts.push({ url, ok: true });
      return result;
    } catch (error) {
      debug.rpcAttempts.push({ url, ok: false, error: error.message });
    }
  }
  debug.rpcError = 'RPC unavailable, please try again';
  throw new Error('RPC unavailable, please try again');
}

async function fetchSolUsdPrice(debug) {
  for (const source of SOL_PRICE_SOURCES) {
    try {
      const response = await fetchWithTimeout(source.url, {}, PRICE_TIMEOUT_MS);
      if (!response.ok) continue;
      const data = await response.json();
      const price = source.extract(data);
      if (typeof price === 'number' && price > 0) {
        debug.priceSource = source.name;
        return price;
      }
    } catch {
      // try the next source
    }
  }
  debug.priceSource = 'unavailable';
  return null;
}

function extractAccountKeys(transaction) {
  const keys = transaction?.message?.accountKeys || [];
  return keys.map((key) => (typeof key === 'string' ? key : key.pubkey));
}

function findParsedSolTransfer(transaction) {
  const instructions = transaction?.message?.instructions || [];
  let total = 0;
  for (const instruction of instructions) {
    const parsed = instruction?.parsed;
    if (instruction.program === 'system' && parsed?.type === 'transfer' && parsed.info?.destination === PAYMENT_WALLET) {
      total += Number(parsed.info.lamports || 0) / LAMPORTS_PER_SOL;
    }
  }
  return total;
}

function findBalanceDiffSolTransfer(transaction, meta) {
  const accountKeys = extractAccountKeys(transaction);
  const receiverIndex = accountKeys.indexOf(PAYMENT_WALLET);
  if (receiverIndex === -1 || !meta?.preBalances || !meta?.postBalances) return 0;
  const delta = meta.postBalances[receiverIndex] - meta.preBalances[receiverIndex];
  return delta > 0 ? delta / LAMPORTS_PER_SOL : 0;
}

function findTokenTransferAmount(meta) {
  if (!meta?.postTokenBalances) return 0;
  let total = 0;
  for (const postEntry of meta.postTokenBalances) {
    if (postEntry.owner !== PAYMENT_WALLET) continue;
    // Reject any non-stablecoin mint: its uiAmount must NOT be treated as USD.
    if (!ACCEPTED_TOKEN_MINTS.has(postEntry.mint)) continue;
    const preEntry = (meta.preTokenBalances || []).find(
      (entry) => entry.accountIndex === postEntry.accountIndex && entry.owner === PAYMENT_WALLET
    );
    const postAmount = Number(postEntry.uiTokenAmount?.uiAmount || 0);
    const preAmount = Number(preEntry?.uiTokenAmount?.uiAmount || 0);
    const delta = postAmount - preAmount;
    if (delta > 0) total += delta;
  }
  return total;
}

function findReceiverWallet(transaction, meta) {
  if (extractAccountKeys(transaction).includes(PAYMENT_WALLET)) return PAYMENT_WALLET;
  const tokenOwner = (meta?.postTokenBalances || []).find((entry) => entry.owner === PAYMENT_WALLET);
  if (tokenOwner) return PAYMENT_WALLET;
  const accountKeys = extractAccountKeys(transaction);
  if (meta?.preBalances && meta?.postBalances) {
    const idx = meta.postBalances.findIndex((bal, i) => bal > meta.preBalances[i] && accountKeys[i] !== transaction?.message?.accountKeys?.[0]);
    if (idx > -1) return accountKeys[idx];
  }
  return null;
}

// `accountUserId` is the verified id of the SIGNED-IN buyer, resolved from their
// JWT by the handler (never from the request body — a body-supplied id would let
// anyone grant Premium to a stranger's account). When present, a verified
// payment grants Premium to that account IN ADDITION to the paying wallet, so a
// signed-in buyer sees Premium immediately with no "claim wallet" step. When
// absent (anonymous caller, legacy flow) the behaviour is byte-for-byte the old
// wallet-only grant.
async function verifySolanaPayment({ transactionHash, plan, accountUserId = null }) {
  const debug = {
    signatureLength: (transactionHash || '').trim().length,
    rpcUrlUsed: null,
    rpcAttemptCount: 0,
    rpcAttempts: [],
    rpcError: null,
    rpcResponseReceived: false,
    confirmationStatus: null,
    detectedReceiverWallet: null,
    expectedReceiverWallet: PAYMENT_WALLET || null,
    detectedSolAmount: 0,
    detectedUsdValue: 0,
    requiredUsdAmount: planUsdAmount(plan),
    grantedToAccount: false,
    priceSource: null,
    finalDecision: null,
  };

  if (!RPC_URL || !PAYMENT_WALLET) {
    debug.finalDecision = 'not_configured';
    return { status: 'not_configured', message: 'Automatic verification is not configured yet', debug };
  }

  const signature = (transactionHash || '').trim();
  if (!signature) {
    debug.finalDecision = 'waiting';
    return { status: 'waiting', message: 'Waiting for transaction hash', debug };
  }

  if (!SIGNATURE_PATTERN.test(signature)) {
    debug.finalDecision = 'failed (invalid signature format)';
    return { status: 'failed', message: 'Payment failed', reason: 'invalid_signature_format', debug };
  }

  // A confirmed signature can only redeem one entitlement - without this a
  // single paid transaction hash could be replayed to grant access to
  // multiple wallets.
  if (await isSignatureUsed(signature)) {
    debug.finalDecision = 'already_used';
    return { status: 'already_used', message: 'This transaction has already been used to unlock access', debug };
  }

  let result;
  try {
    result = await rpcPost(
      'getTransaction',
      [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }],
      debug
    );
    debug.rpcResponseReceived = true;
  } catch (error) {
    debug.rpcResponseReceived = false;
    debug.finalDecision = `failed (${error.message})`;
    return { status: 'failed', message: error.message, reason: error.message, debug };
  }

  if (!result) {
    debug.confirmationStatus = 'not found / not yet confirmed';
    debug.finalDecision = 'not_confirmed';
    return { status: 'not_confirmed', message: 'Transaction not confirmed yet', debug };
  }

  debug.confirmationStatus = result.meta?.err ? 'on-chain error' : 'confirmed';

  if (result.meta?.err) {
    debug.finalDecision = 'failed (on-chain error)';
    return { status: 'failed', message: 'Payment failed', reason: 'on_chain_error', debug };
  }

  debug.detectedReceiverWallet = findReceiverWallet(result.transaction, result.meta);

  if (debug.detectedReceiverWallet !== PAYMENT_WALLET) {
    debug.finalDecision = 'wrong_receiver';
    return { status: 'wrong_receiver', message: 'Wrong receiver wallet', debug };
  }

  const tokenAmount = findTokenTransferAmount(result.meta);
  let solAmount = findParsedSolTransfer(result.transaction);
  if (solAmount === 0) {
    solAmount = findBalanceDiffSolTransfer(result.transaction, result.meta);
  }
  debug.detectedSolAmount = solAmount;

  const requiredUsd = debug.requiredUsdAmount;
  const buyerWallet = extractAccountKeys(result.transaction)[0] || null;
  debug.detectedBuyerWallet = buyerWallet;

  async function grantAndReturn(currency, amountPaid) {
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
    }
    return { status: 'verified', message: 'Payment verified', buyerWallet, accountSubject: accountUserId ? accountSubject(accountUserId) : null, debug };
  }

  if (tokenAmount > 0) {
    debug.detectedUsdValue = tokenAmount;
    if (tokenAmount < requiredUsd * AMOUNT_TOLERANCE) {
      debug.finalDecision = 'amount_too_low';
      return { status: 'amount_too_low', message: 'Amount too low', debug };
    }
    return grantAndReturn('USDC', tokenAmount);
  }

  if (solAmount > 0) {
    const solPrice = await fetchSolUsdPrice(debug);
    if (!solPrice) {
      debug.finalDecision = 'failed (sol/usd price unavailable)';
      return { status: 'failed', message: 'Payment failed', reason: 'price_unavailable', debug };
    }
    const paidUsd = solAmount * solPrice;
    debug.detectedUsdValue = paidUsd;
    if (paidUsd < requiredUsd * AMOUNT_TOLERANCE) {
      debug.finalDecision = 'amount_too_low';
      return { status: 'amount_too_low', message: 'Amount too low', debug };
    }
    return grantAndReturn('SOL', solAmount);
  }

  debug.finalDecision = 'amount_too_low (no transfer detected)';
  return { status: 'amount_too_low', message: 'Amount too low', debug };
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
