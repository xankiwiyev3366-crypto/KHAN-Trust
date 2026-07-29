// THE ONE PLACE THAT READS MONEY OFF THE SOLANA CHAIN.
//
// WHY THIS MODULE EXISTS
//
// Every routine in here lived inside verify-solana-payment.mjs, closed over a
// module-level PAYMENT_WALLET constant. That was fine while Premium was the
// only thing sold. Paid verification is a second product, at a different price,
// optionally paid to a different treasury — and the tempting move is to copy
// the file and change the constant.
//
// Copying it would fork the money path. The rules encoded below are not
// obvious, and each one is a hole somebody could otherwise climb through:
//
//   - The SPL mint ALLOW-LIST. A transfer's `uiAmount` is only treated as USD
//     for mints we have decided are 6-decimal USD stablecoins. Without it,
//     anyone can mint a worthless SPL token, send a million of it to the
//     treasury, and have `uiAmount: 1000000` counted as a million dollars.
//   - SOL transfers are detected TWICE — once from parsed system-transfer
//     instructions, once from raw pre/post balance deltas — because a transfer
//     routed through a program (or an inner instruction) is invisible to the
//     first method and a real customer would be told they had not paid.
//   - The RECEIVER is checked before the amount. A confirmed transaction that
//     moved plenty of money somewhere else is not a payment to us.
//   - A 2% tolerance (AMOUNT_TOLERANCE) absorbs price drift between the moment
//     the browser quoted a SOL amount and the moment the chain settled it.
//
// A second copy would drift from these, and the copy that drifted would be the
// one taking money. So the logic is parameterised by treasury wallet instead:
// callers pass the wallet they expect to have been paid, and everything else is
// identical for every product.
//
// WHAT THIS MODULE DELIBERATELY DOES NOT DO
//
// It grants nothing, stores nothing, and knows about no product. Deciding what
// a confirmed payment BUYS — an entitlement, a verification order — belongs to
// the caller, because those have completely different idempotency and
// replay-protection requirements. This module answers exactly one question:
// "did this signature move at least this many dollars to that wallet?"

const LAMPORTS_PER_SOL = 1_000_000_000;
const RPC_TIMEOUT_MS = 15000;
const PRICE_TIMEOUT_MS = 5000;

// Price drift between quote and settlement. Also the reason a customer who pays
// the exact quoted SOL amount is not rejected by a cent of rounding.
export const AMOUNT_TOLERANCE = 0.98;

export const SIGNATURE_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

// Both are 6-decimal USD stablecoins whose uiAmount maps 1:1 to USD — the
// assumption every amount check below rests on. Mirrors src/cryptoPayment.js
// SPL_TOKEN_CONFIG. Read at call time, not module load, so tests and any future
// environment override apply without re-importing.
export function acceptedTokenMints() {
  return new Set([
    process.env.VITE_USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    process.env.VITE_USDT_MINT || 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  ]);
}

// See the long note at the top of verify-solana-payment.mjs: the keyed URL is
// SOLANA_RPC_URL (server-side, never inlined into the browser bundle). The
// retired VITE_ name is a last-resort fallback for a half-migrated deployment.
// Resolved per call rather than at import so a function that sets env after
// load, and every test, sees the current value.
export function rpcUrls() {
  const configured = process.env.SOLANA_RPC_URL || process.env.VITE_SOLANA_RPC_URL || '';
  return [...new Set([configured, 'https://api.mainnet-beta.solana.com'].filter(Boolean))];
}

export function rpcConfigured() {
  return Boolean(process.env.SOLANA_RPC_URL || process.env.VITE_SOLANA_RPC_URL);
}

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

// Tries each configured URL in turn, recording every attempt on `debug`. The
// debug trail is not decoration: a disputed payment is reconstructed from it.
export async function rpcPost(method, params, debug) {
  for (const url of rpcUrls()) {
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

// Returns a positive USD/SOL price, or null. NEVER a guess: an unavailable
// price must fail the payment check, because pricing a SOL transfer with an
// invented rate is how you either give away a $399 product or refuse a real
// customer's money.
export async function fetchSolUsdPrice(debug) {
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

export function extractAccountKeys(transaction) {
  const keys = transaction?.message?.accountKeys || [];
  return keys.map((key) => (typeof key === 'string' ? key : key.pubkey));
}

export function findParsedSolTransfer(transaction, treasury) {
  const instructions = transaction?.message?.instructions || [];
  let total = 0;
  for (const instruction of instructions) {
    const parsed = instruction?.parsed;
    if (instruction.program === 'system' && parsed?.type === 'transfer' && parsed.info?.destination === treasury) {
      total += Number(parsed.info.lamports || 0) / LAMPORTS_PER_SOL;
    }
  }
  return total;
}

export function findBalanceDiffSolTransfer(transaction, meta, treasury) {
  const accountKeys = extractAccountKeys(transaction);
  const receiverIndex = accountKeys.indexOf(treasury);
  if (receiverIndex === -1 || !meta?.preBalances || !meta?.postBalances) return 0;
  const delta = meta.postBalances[receiverIndex] - meta.preBalances[receiverIndex];
  return delta > 0 ? delta / LAMPORTS_PER_SOL : 0;
}

export function findTokenTransferAmount(meta, treasury) {
  if (!meta?.postTokenBalances) return 0;
  const accepted = acceptedTokenMints();
  let total = 0;
  for (const postEntry of meta.postTokenBalances) {
    if (postEntry.owner !== treasury) continue;
    // Reject any non-stablecoin mint: its uiAmount must NOT be treated as USD.
    if (!accepted.has(postEntry.mint)) continue;
    const preEntry = (meta.preTokenBalances || []).find(
      (entry) => entry.accountIndex === postEntry.accountIndex && entry.owner === treasury
    );
    const postAmount = Number(postEntry.uiTokenAmount?.uiAmount || 0);
    const preAmount = Number(preEntry?.uiTokenAmount?.uiAmount || 0);
    const delta = postAmount - preAmount;
    if (delta > 0) total += delta;
  }
  return total;
}

export function findReceiverWallet(transaction, meta, treasury) {
  if (extractAccountKeys(transaction).includes(treasury)) return treasury;
  const tokenOwner = (meta?.postTokenBalances || []).find((entry) => entry.owner === treasury);
  if (tokenOwner) return treasury;
  const accountKeys = extractAccountKeys(transaction);
  if (meta?.preBalances && meta?.postBalances) {
    const idx = meta.postBalances.findIndex((bal, i) => bal > meta.preBalances[i] && accountKeys[i] !== transaction?.message?.accountKeys?.[0]);
    if (idx > -1) return accountKeys[idx];
  }
  return null;
}

export function newPaymentDebug({ treasury, requiredUsd, signature }) {
  return {
    signatureLength: (signature || '').trim().length,
    rpcUrlUsed: null,
    rpcAttemptCount: 0,
    rpcAttempts: [],
    rpcError: null,
    rpcResponseReceived: false,
    confirmationStatus: null,
    detectedReceiverWallet: null,
    expectedReceiverWallet: treasury || null,
    detectedBuyerWallet: null,
    detectedSolAmount: 0,
    detectedUsdValue: 0,
    requiredUsdAmount: requiredUsd,
    priceSource: null,
    finalDecision: null,
  };
}

// ── The whole check, for callers that just want a verdict ───────────────────
//
// Returns a discriminated result. `status: 'settled'` means the chain says at
// least `requiredUsd` (less tolerance) reached `treasury` in this transaction,
// and nothing else. It carries `buyerWallet` (the fee payer / signer) so the
// caller can attribute the purchase.
//
// REPLAY PROTECTION IS THE CALLER'S JOB and is deliberately not done here. A
// signature is spendable exactly once, but "once" means something different per
// product — Premium marks it in the shared used-signatures ledger, a
// verification order binds it to that order — and a shared implementation would
// have to guess. Callers MUST check before granting anything. Every one of them
// does; see the isSignatureUsed calls at their call sites.
export async function inspectPayment({ signature, treasury, requiredUsd }) {
  const clean = String(signature || '').trim();
  const debug = newPaymentDebug({ treasury, requiredUsd, signature: clean });

  if (!rpcConfigured() || !treasury) {
    debug.finalDecision = 'not_configured';
    return { status: 'not_configured', message: 'Automatic verification is not configured yet', debug };
  }
  if (!clean) {
    debug.finalDecision = 'waiting';
    return { status: 'waiting', message: 'Waiting for transaction hash', debug };
  }
  if (!SIGNATURE_PATTERN.test(clean)) {
    debug.finalDecision = 'failed (invalid signature format)';
    return { status: 'failed', message: 'Payment failed', reason: 'invalid_signature_format', debug };
  }
  if (!(typeof requiredUsd === 'number' && Number.isFinite(requiredUsd) && requiredUsd > 0)) {
    // An unpriced product must never settle. This is what stops an unknown
    // tier id being sold for $0 (see verificationTierUsd, which returns null
    // rather than defaulting to the cheapest product).
    debug.finalDecision = 'failed (no price)';
    return { status: 'failed', message: 'Payment failed', reason: 'no_required_amount', debug };
  }

  let result;
  try {
    result = await rpcPost(
      'getTransaction',
      [clean, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }],
      debug
    );
    debug.rpcResponseReceived = true;
  } catch (error) {
    debug.rpcResponseReceived = false;
    debug.finalDecision = `failed (${error.message})`;
    return { status: 'failed', message: error.message, reason: error.message, debug };
  }

  if (!result) {
    // NOT a failure. An unconfirmed or not-yet-propagated signature is the
    // normal state for the first few seconds after a wallet submits, and the
    // caller is expected to poll. Calling this "failed" would tell a customer
    // who just paid that their payment did not work.
    debug.confirmationStatus = 'not found / not yet confirmed';
    debug.finalDecision = 'not_confirmed';
    return { status: 'not_confirmed', message: 'Transaction not confirmed yet', debug };
  }

  debug.confirmationStatus = result.meta?.err ? 'on-chain error' : 'confirmed';
  if (result.meta?.err) {
    debug.finalDecision = 'failed (on-chain error)';
    return { status: 'failed', message: 'Payment failed', reason: 'on_chain_error', debug };
  }

  debug.detectedReceiverWallet = findReceiverWallet(result.transaction, result.meta, treasury);
  if (debug.detectedReceiverWallet !== treasury) {
    debug.finalDecision = 'wrong_receiver';
    return { status: 'wrong_receiver', message: 'Wrong receiver wallet', debug };
  }

  const buyerWallet = extractAccountKeys(result.transaction)[0] || null;
  debug.detectedBuyerWallet = buyerWallet;

  const tokenAmount = findTokenTransferAmount(result.meta, treasury);
  if (tokenAmount > 0) {
    debug.detectedUsdValue = tokenAmount;
    if (tokenAmount < requiredUsd * AMOUNT_TOLERANCE) {
      debug.finalDecision = 'amount_too_low';
      return { status: 'amount_too_low', message: 'Amount too low', debug };
    }
    debug.finalDecision = 'settled';
    return { status: 'settled', currency: 'USDC', amountPaid: tokenAmount, usdValue: tokenAmount, buyerWallet, debug };
  }

  let solAmount = findParsedSolTransfer(result.transaction, treasury);
  if (solAmount === 0) solAmount = findBalanceDiffSolTransfer(result.transaction, result.meta, treasury);
  debug.detectedSolAmount = solAmount;

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
    debug.finalDecision = 'settled';
    return { status: 'settled', currency: 'SOL', amountPaid: solAmount, usdValue: paidUsd, buyerWallet, debug };
  }

  debug.finalDecision = 'amount_too_low (no transfer detected)';
  return { status: 'amount_too_low', message: 'Amount too low', debug };
}
