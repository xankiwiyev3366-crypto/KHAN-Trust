const CONFIGURED_RPC_URL = import.meta.env.VITE_SOLANA_RPC_URL || '';
const PAYMENT_WALLET = import.meta.env.VITE_KHAN_PAYMENT_WALLET || '';

const LAMPORTS_PER_SOL = 1_000_000_000;
const PRICE_TIMEOUT_MS = 5000;
// 5s was too aggressive for some public RPC nodes under load and caused
// "signal is aborted without reason" before a response ever arrived.
const RPC_TIMEOUT_MS = 15000;

// Try the configured RPC first, then fall back to the public mainnet endpoint
// so a single overloaded/unreachable node doesn't block verification entirely.
// projectserum and ankr were removed: projectserum no longer answers requests,
// and ankr returns 403 without an API key - both only masked the real error.
const FALLBACK_RPC_URLS = ['https://api.mainnet-beta.solana.com'];

function getRpcUrlsToTry() {
  const urls = [CONFIGURED_RPC_URL, ...FALLBACK_RPC_URLS].filter(Boolean);
  return [...new Set(urls)];
}
// Allow a small tolerance for price-feed drift / rounding when SOL is used to pay a USD-denominated plan.
const AMOUNT_TOLERANCE = 0.98;
const SIGNATURE_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

const PLAN_USD_AMOUNT = {
  premium: 9,
  early_supporter: 29,
};

// Multiple independent price sources so a single rate-limited/unreachable API
// doesn't turn a real underpayment into an opaque "Payment failed".
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

function getRequiredUsdAmount(plan) {
  return PLAN_USD_AMOUNT[plan] || PLAN_USD_AMOUNT.premium;
}

export function isSolanaVerificationConfigured() {
  return Boolean(CONFIGURED_RPC_URL && PAYMENT_WALLET);
}

export function solanaUnavailableMessage() {
  return 'Automatic verification is not configured yet';
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

async function rpcPostOnce(url, method, params) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort('timeout'), RPC_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`RPC request failed (${response.status})`);
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'RPC error');
  return data.result;
}

// Try the configured RPC, then each fallback in order, stopping at the first
// endpoint that answers successfully. Every attempt (including ones that time
// out before a later one fails outright) is recorded in debug.rpcAttempts so
// the real first failure isn't hidden behind whichever endpoint failed last.
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
      const response = await fetchWithTimeout(source.url, PRICE_TIMEOUT_MS);
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

// Native SOL transfer to the payment wallet, read directly from parsed system-program instructions
// when available (more reliable than balance diffing, which breaks on multi-instruction transactions).
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

// Fallback for when instructions aren't parsed (e.g. unsupported encoding): diff balances at the
// receiver's account index.
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
  // Report whichever wallet actually received funds, for debugging mismatches.
  const accountKeys = extractAccountKeys(transaction);
  if (meta?.preBalances && meta?.postBalances) {
    const idx = meta.postBalances.findIndex((bal, i) => bal > meta.preBalances[i] && accountKeys[i] !== transaction?.message?.accountKeys?.[0]);
    if (idx > -1) return accountKeys[idx];
  }
  return null;
}

export async function verifySolanaPayment({ transactionHash, plan }) {
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
    requiredUsdAmount: getRequiredUsdAmount(plan),
    priceSource: null,
    finalDecision: null,
  };

  if (!isSolanaVerificationConfigured()) {
    debug.finalDecision = 'not_configured';
    return { status: 'not_configured', message: solanaUnavailableMessage(), debug };
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

  // Prefer the USDT (or other USD-pegged SPL token) amount when present - it maps 1:1 to USD.
  if (tokenAmount > 0) {
    debug.detectedUsdValue = tokenAmount;
    if (tokenAmount < requiredUsd * AMOUNT_TOLERANCE) {
      debug.finalDecision = 'amount_too_low';
      return { status: 'amount_too_low', message: 'Amount too low', debug };
    }
    debug.finalDecision = 'verified';
    return { status: 'verified', message: 'Payment verified', debug };
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
    debug.finalDecision = 'verified';
    return { status: 'verified', message: 'Payment verified', debug };
  }

  debug.finalDecision = 'amount_too_low (no transfer detected)';
  return { status: 'amount_too_low', message: 'Amount too low', debug };
}
