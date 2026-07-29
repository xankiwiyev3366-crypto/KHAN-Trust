// Client half of paid verification. Thin on purpose: every decision that
// matters — eligibility, price, the score floor, exclusivity, whether a
// payment counts, whether ownership was proven — is made server-side and this
// module only carries the answers to the UI.
//
// NO DEV FALLBACK. Every other client module here has a localStorage fallback
// for running `vite dev` with no Functions server, and Phase 1 had to go
// through all six of them because they were firing in PRODUCTION and reporting
// success for submissions no server ever received. src/devFallback.js documents
// the case that matters most:
//
//   "verification.js wrote a 'pending verification request' into the visitor's
//    own localStorage and reported SUCCESS. [...] With Phase 2 this becomes a
//    paid product — the same bug would take someone's intent to pay and drop it
//    on the floor while showing a confirmation."
//
// This is that paid product. A fallback here could only ever fabricate a
// purchase. When the server cannot be reached the honest answer is an error the
// buyer can see, so there is nothing to gate and nothing to compile out.
import { getCachedWalletToken, ensureWalletToken, walletAuthHeaders } from './walletSession.js';

const AUTH_TOKEN_KEY = 'khan-trust-auth-token-v1';

function authHeaders() {
  try {
    const token = window.localStorage.getItem(AUTH_TOKEN_KEY);
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function callFunction(path, options = {}) {
  const response = await fetch(`/.netlify/functions/${path}`, options);
  let data = null;
  let parsed = true;
  try {
    data = await response.json();
  } catch {
    parsed = false;
  }

  // A 200 CARRYING SOMETHING THAT IS NOT JSON IS A FAILURE, NOT AN EMPTY ANSWER.
  //
  // Found by clicking the button: `vite dev` has no Functions server and serves
  // index.html for the unknown path — with status 200. The first version of
  // this treated an unparseable body as `null` data on a successful response,
  // so the caller set its state to null and the page rendered nothing at all:
  // no quote, no error, no explanation. The buyer clicks and the screen does
  // not change.
  //
  // That is the same defect Phase 1 spent itself removing — a failure
  // presented as a quieter, wronger truth instead of as a failure — and it is
  // not dev-only: any proxy, CDN or captive portal that answers 200 with an
  // HTML error page reproduces it in production, on the page that takes money.
  if (response.ok && !parsed) {
    const error = new Error('The verification service returned an unexpected response.');
    error.status = response.status;
    error.reason = 'bad_response';
    throw error;
  }

  if (!response.ok) {
    const error = new Error(data?.message || `Request failed (${response.status})`);
    error.status = response.status;
    // The server's machine-readable reason ('needs_scan', 'below_floor',
    // 'already_verified', 'duplicate') drives which message the UI shows. It is
    // carried on the error rather than flattened into prose so the UI can
    // translate it — the same keys-not-sentences rule the retention engine
    // follows.
    error.reason = data?.reason || '';
    error.data = data || null;
    throw error;
  }
  return data;
}

// Public, unauthenticated. Returns { eligible, reason, score, minScore, tiers }.
export async function fetchVerificationQuote({ contract, chain = 'solana' }) {
  const params = new URLSearchParams({ contract, chain });
  return callFunction(`verify-quote?${params.toString()}`, { method: 'GET' });
}

export async function createVerificationOrder({ contract, chain = 'solana', tierId, projectId = '' }) {
  return callFunction('verify-order-create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ contract, chain, tierId, projectId }),
  });
}

// Activation needs a WALLET-SESSION token, not just a connected wallet: the
// server treats the signed nonce as the ownership proof (see the header of
// verify-order-activate.mjs on why the older client-timestamped signature was
// replayable and is not used for a paid flow). ensureWalletToken() runs the
// challenge/sign/exchange round trip if there is no live token cached.
export async function activateVerificationOrder({ orderId, transactionHash, wallet }) {
  const token = getCachedWalletToken(wallet) || await ensureWalletToken(wallet);
  if (!token) {
    const error = new Error('Wallet ownership could not be proven.');
    error.reason = 'ownership_proof_required';
    throw error;
  }
  return callFunction('verify-order-activate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...walletAuthHeaders(token),
    },
    body: JSON.stringify({ orderId, transactionHash }),
  });
}

export async function fetchVerificationOrder({ orderId, wallet }) {
  const token = wallet ? getCachedWalletToken(wallet) : null;
  const params = new URLSearchParams({ orderId });
  return callFunction(`verify-order-status?${params.toString()}`, {
    method: 'GET',
    headers: { ...authHeaders(), ...walletAuthHeaders(token) },
  });
}
