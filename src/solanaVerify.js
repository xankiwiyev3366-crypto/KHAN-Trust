const RPC_URL = import.meta.env.VITE_SOLANA_RPC_URL || '';
const PAYMENT_WALLET = import.meta.env.VITE_KHAN_PAYMENT_WALLET || '';

const LAMPORTS_PER_SOL = 1_000_000_000;
const SOL_PRICE_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd';
const SOL_PRICE_TIMEOUT_MS = 5000;
// Allow a small tolerance for price-feed drift / rounding when SOL is used to pay a USD-denominated plan.
const AMOUNT_TOLERANCE = 0.98;
const SIGNATURE_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

const PLAN_USD_AMOUNT = {
  premium: 9,
  early_supporter: 29,
};

export function isSolanaVerificationConfigured() {
  return Boolean(RPC_URL && PAYMENT_WALLET);
}

export function solanaUnavailableMessage() {
  return 'Automatic verification is not configured yet';
}

function getRequiredUsdAmount(plan) {
  return PLAN_USD_AMOUNT[plan] || PLAN_USD_AMOUNT.premium;
}

async function rpcCall(method, params) {
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`RPC request failed (${response.status})`);
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'RPC error');
  return data.result;
}

async function fetchSolUsdPrice() {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), SOL_PRICE_TIMEOUT_MS);
  try {
    const response = await fetch(SOL_PRICE_URL, { signal: controller.signal });
    if (!response.ok) return null;
    const data = await response.json();
    const price = data?.solana?.usd;
    return typeof price === 'number' && price > 0 ? price : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
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

function isReceiverInTransaction(transaction, meta) {
  if (extractAccountKeys(transaction).includes(PAYMENT_WALLET)) return true;
  return (meta?.postTokenBalances || []).some((entry) => entry.owner === PAYMENT_WALLET);
}

export async function verifySolanaPayment({ transactionHash, plan }) {
  if (!isSolanaVerificationConfigured()) {
    return { status: 'not_configured', message: solanaUnavailableMessage() };
  }

  const signature = (transactionHash || '').trim();
  if (!signature) {
    return { status: 'waiting', message: 'Waiting for transaction hash' };
  }

  if (!SIGNATURE_PATTERN.test(signature)) {
    return { status: 'failed', message: 'Payment failed', reason: 'invalid_signature_format' };
  }

  let result;
  try {
    result = await rpcCall('getTransaction', [
      signature,
      { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
    ]);
  } catch (error) {
    return { status: 'failed', message: 'Payment failed', reason: error.message };
  }

  if (!result) {
    return { status: 'not_confirmed', message: 'Transaction not confirmed yet' };
  }

  if (result.meta?.err) {
    return { status: 'failed', message: 'Payment failed', reason: 'on_chain_error' };
  }

  if (!isReceiverInTransaction(result.transaction, result.meta)) {
    return { status: 'wrong_receiver', message: 'Wrong receiver wallet' };
  }

  const tokenAmount = findTokenTransferAmount(result.meta);
  let solAmount = findParsedSolTransfer(result.transaction);
  if (solAmount === 0) {
    solAmount = findBalanceDiffSolTransfer(result.transaction, result.meta);
  }

  const requiredUsd = getRequiredUsdAmount(plan);

  // Prefer the USDT (or other USD-pegged SPL token) amount when present - it maps 1:1 to USD.
  if (tokenAmount > 0) {
    if (tokenAmount < requiredUsd * AMOUNT_TOLERANCE) {
      return { status: 'amount_too_low', message: 'Amount too low' };
    }
    return { status: 'verified', message: 'Payment verified' };
  }

  if (solAmount > 0) {
    const solPrice = await fetchSolUsdPrice();
    if (!solPrice) {
      return { status: 'failed', message: 'Payment failed', reason: 'price_unavailable' };
    }
    const paidUsd = solAmount * solPrice;
    if (paidUsd < requiredUsd * AMOUNT_TOLERANCE) {
      return { status: 'amount_too_low', message: 'Amount too low' };
    }
    return { status: 'verified', message: 'Payment verified' };
  }

  return { status: 'amount_too_low', message: 'Amount too low' };
}
