// Best-effort observer that tells the server "this signed-in account currently
// has a wallet connected", so the admin panel's Wallet Connected column
// reflects reality. It is deliberately tiny and fail-silent: it can never
// block, slow, or break the wallet or auth flows. It does NOT change payments,
// entitlements, or premium access - it only records an observation.
const AUTH_TOKEN_KEY = 'khan-trust-auth-token-v1';

// Avoid re-posting the same account+wallet pair repeatedly within a session.
let lastPingKey = '';

export function recordWalletLink(wallet) {
  try {
    const address = String(wallet || '').trim();
    if (!address) return;
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (!token) return; // only meaningful for a signed-in account
    const key = `${token.slice(-12)}:${address}`;
    if (key === lastPingKey) return;
    lastPingKey = key;
    fetch('/.netlify/functions/user-wallet-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ wallet: address }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Telemetry must never throw into the caller.
  }
}
