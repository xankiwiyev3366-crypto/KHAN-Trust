// Verification itself runs server-side in netlify/functions/verify-solana-payment.mjs.
// Public Solana RPC endpoints reject many browser-origin requests with HTTP 403, so the
// getTransaction lookup (and the SOL/USD price lookup) must happen off the client.

const RPC_URL = import.meta.env.VITE_SOLANA_RPC_URL || '';
const PAYMENT_WALLET = import.meta.env.VITE_KHAN_PAYMENT_WALLET || '';
const VERIFY_ENDPOINT = '/.netlify/functions/verify-solana-payment';

// Same convention as src/stripeCheckout.js / src/entitlements.js: the token key
// is declared locally so this plain .js module never has to import AuthContext
// (and React with it). The literal must stay identical across all of them.
const AUTH_TOKEN_KEY = 'khan-trust-auth-token-v1';

// Best-effort: any failure resolves to '' so an anonymous (or storage-blocked)
// caller still gets the exact pre-existing wallet-keyed flow.
function authToken() {
  try { return localStorage.getItem(AUTH_TOKEN_KEY) || ''; } catch { return ''; }
}

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
    // When the payer is signed in, the JWT rides along so the server grants
    // Premium DIRECTLY to their account (not only to the paying wallet) — the
    // buyer sees Premium immediately, with no separate "claim wallet" step and
    // no need to reconnect that wallet elsewhere. Sent as a header, never in the
    // body, so it is treated exactly like every other authenticated endpoint.
    const token = authToken();
    const response = await fetch(VERIFY_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
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
