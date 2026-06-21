// Verification itself runs server-side in netlify/functions/verify-solana-payment.mjs.
// Public Solana RPC endpoints reject many browser-origin requests with HTTP 403, so the
// getTransaction lookup (and the SOL/USD price lookup) must happen off the client.

const RPC_URL = import.meta.env.VITE_SOLANA_RPC_URL || '';
const PAYMENT_WALLET = import.meta.env.VITE_KHAN_PAYMENT_WALLET || '';
const VERIFY_ENDPOINT = '/.netlify/functions/verify-solana-payment';

export function isSolanaVerificationConfigured() {
  return Boolean(RPC_URL && PAYMENT_WALLET);
}

export function solanaUnavailableMessage() {
  return 'Automatic verification is not configured yet';
}

export async function verifySolanaPayment({ transactionHash, plan }) {
  if (!isSolanaVerificationConfigured()) {
    return {
      status: 'not_configured',
      message: solanaUnavailableMessage(),
      debug: { finalDecision: 'not_configured' },
    };
  }

  const signature = (transactionHash || '').trim();
  if (!signature) {
    return {
      status: 'waiting',
      message: 'Waiting for transaction hash',
      debug: { finalDecision: 'waiting' },
    };
  }

  try {
    const response = await fetch(VERIFY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionHash: signature, plan }),
    });

    if (!response.ok) {
      return {
        status: 'failed',
        message: 'RPC unavailable, please try again',
        debug: { finalDecision: `failed (verification endpoint returned ${response.status})` },
      };
    }

    return await response.json();
  } catch (error) {
    return {
      status: 'failed',
      message: 'RPC unavailable, please try again',
      debug: { finalDecision: `failed (${error.message})` },
    };
  }
}
