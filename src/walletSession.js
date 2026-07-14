// Client half of the wallet ownership proof (P0-1). Obtains and caches a
// short-lived wallet-session token so premium user-data requests can prove the
// caller controls the wallet, instead of the server trusting a raw address.
//
// The actual signing is done by the connected wallet adapter. Because this is a
// plain module (no React), the wallet layer registers its signMessage function
// here via setWalletSigner() (see wallet/useKhanWallet.js) rather than this
// module importing the adapter.
const TOKEN_KEY_PREFIX = 'khan-trust-wallet-session-v1:';
// Refresh a little before real expiry so an in-flight request never races it.
const EXPIRY_SKEW_MS = 60 * 1000;

let signer = null; // (messageBytes: Uint8Array) => Promise<Uint8Array>

export function setWalletSigner(fn) {
  signer = typeof fn === 'function' ? fn : null;
}

function cacheGet(wallet) {
  try {
    const raw = localStorage.getItem(TOKEN_KEY_PREFIX + wallet);
    if (!raw) return null;
    const { token, expires } = JSON.parse(raw);
    if (!token || !expires || Date.now() > expires - EXPIRY_SKEW_MS) return null;
    return token;
  } catch {
    return null;
  }
}

function cacheSet(wallet, token, expires) {
  try {
    localStorage.setItem(TOKEN_KEY_PREFIX + wallet, JSON.stringify({ token, expires }));
  } catch {
    // non-fatal - token just won't be cached
  }
}

// Returns a valid cached token without ever prompting the wallet. Used by
// passive/background reads (e.g. watchlist sync on load) so the user is never
// hit with an unexpected signature popup just for opening the app.
export function getCachedWalletToken(wallet) {
  return wallet ? cacheGet(wallet) : null;
}

function toBase64(bytes) {
  let binary = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i += 1) binary += String.fromCharCode(arr[i]);
  return btoa(binary);
}

// Returns a valid token, prompting the wallet to sign a challenge if there is
// no usable cached token. Intended for explicit user actions (saving a report,
// toggling a watched project) - never call this on passive page load. Returns
// null if there is no wallet, no signer, or the user declines to sign.
export async function ensureWalletToken(wallet) {
  if (!wallet) return null;
  const cached = cacheGet(wallet);
  if (cached) return cached;
  if (!signer) return null;

  try {
    const challengeRes = await fetch('/.netlify/functions/wallet-challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet }),
    });
    if (!challengeRes.ok) return null;
    const { message } = await challengeRes.json();
    if (!message) return null;

    const signatureBytes = await signer(new TextEncoder().encode(message));
    const signature = toBase64(signatureBytes);

    const authRes = await fetch('/.netlify/functions/wallet-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet, signature }),
    });
    if (!authRes.ok) return null;
    const { token, expires } = await authRes.json();
    if (!token) return null;
    cacheSet(wallet, token, expires);
    return token;
  } catch {
    // User declined the signature, wallet has no signMessage, or a network
    // error - fail soft; the caller degrades to no wallet identity.
    return null;
  }
}

export function walletAuthHeaders(token) {
  return token ? { 'x-khan-wallet-auth': token } : {};
}
