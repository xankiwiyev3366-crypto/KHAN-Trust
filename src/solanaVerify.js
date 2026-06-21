const RPC_URL = import.meta.env.VITE_SOLANA_RPC_URL || '';
const PAYMENT_WALLET = import.meta.env.VITE_KHAN_PAYMENT_WALLET || '';

const LAMPORTS_PER_SOL = 1_000_000_000;

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
  if (!response.ok) throw new Error('RPC request failed');
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || 'RPC error');
  return data.result;
}

function findReceiverTransferAmount(transaction, meta) {
  const accountKeys = transaction.message.accountKeys.map((key) =>
    typeof key === 'string' ? key : key.pubkey
  );
  const receiverIndex = accountKeys.indexOf(PAYMENT_WALLET);
  if (receiverIndex === -1) return { receiverFound: false, solAmount: 0, tokenAmount: 0 };

  let solAmount = 0;
  if (meta?.preBalances && meta?.postBalances) {
    const delta = meta.postBalances[receiverIndex] - meta.preBalances[receiverIndex];
    if (delta > 0) solAmount = delta / LAMPORTS_PER_SOL;
  }

  let tokenAmount = 0;
  if (meta?.preTokenBalances && meta?.postTokenBalances) {
    const postEntry = meta.postTokenBalances.find((entry) => entry.owner === PAYMENT_WALLET);
    const preEntry = meta.preTokenBalances.find(
      (entry) => entry.owner === PAYMENT_WALLET && entry.accountIndex === postEntry?.accountIndex
    );
    if (postEntry) {
      const postAmount = Number(postEntry.uiTokenAmount?.uiAmount || 0);
      const preAmount = Number(preEntry?.uiTokenAmount?.uiAmount || 0);
      const delta = postAmount - preAmount;
      if (delta > 0) tokenAmount = delta;
    }
  }

  return { receiverFound: solAmount > 0 || tokenAmount > 0, solAmount, tokenAmount };
}

export async function verifySolanaPayment({ transactionHash, plan }) {
  if (!isSolanaVerificationConfigured()) {
    return { status: 'not_configured', message: solanaUnavailableMessage() };
  }
  if (!transactionHash || !transactionHash.trim()) {
    return { status: 'waiting', message: 'Waiting for transaction hash' };
  }

  let result;
  try {
    result = await rpcCall('getTransaction', [
      transactionHash.trim(),
      { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
    ]);
  } catch {
    return { status: 'failed', message: 'Payment failed' };
  }

  if (!result) {
    return { status: 'not_confirmed', message: 'Transaction not confirmed yet' };
  }

  if (result.meta?.err) {
    return { status: 'failed', message: 'Payment failed' };
  }

  const { receiverFound, solAmount, tokenAmount } = findReceiverTransferAmount(
    result.transaction,
    result.meta
  );

  if (!receiverFound) {
    return { status: 'wrong_receiver', message: 'Wrong receiver wallet' };
  }

  const requiredUsd = getRequiredUsdAmount(plan);
  const paidEnough = tokenAmount >= requiredUsd || (solAmount > 0 && tokenAmount === 0 && solAmount > 0);

  if (tokenAmount > 0 && tokenAmount < requiredUsd) {
    return { status: 'amount_too_low', message: 'Amount too low' };
  }

  if (!paidEnough) {
    return { status: 'amount_too_low', message: 'Amount too low' };
  }

  return { status: 'verified', message: 'Payment verified' };
}
