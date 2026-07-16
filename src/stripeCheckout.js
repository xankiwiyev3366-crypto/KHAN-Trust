// Card payments go through a Stripe-hosted Checkout Session created
// server-side (see netlify/functions/create-stripe-checkout-session.mjs),
// not Stripe.js redirectToCheckout - that keeps the secret key and Price IDs
// off the client and lets the session carry the buyer's identity so the webhook
// knows who to grant access to.
//
// That identity is the SIGNED-IN ACCOUNT. This used to refuse to start checkout
// without a connected Solana wallet, which meant the platform asked people
// frightened of wallet risk to connect a wallet before it would sell them
// protection from it. A wallet may still be passed; it travels as optional
// metadata and never blocks the sale.
const CREATE_SESSION_ENDPOINT = '/.netlify/functions/create-stripe-checkout-session';

// Same convention as src/userData.js and src/premiumAdmin.js: the token key is
// declared locally rather than imported, so a plain .js module never has to pull
// in AuthContext.jsx (and React with it). The literal must stay identical across
// all of them.
const AUTH_TOKEN_KEY = 'khan-trust-auth-token-v1';

const PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

export function isStripeConfigured() {
  return Boolean(PUBLISHABLE_KEY);
}

export function stripeUnavailableMessage() {
  return 'Card payments are not configured yet';
}

function authToken() {
  try { return localStorage.getItem(AUTH_TOKEN_KEY) || ''; } catch { return ''; }
}

export async function startStripeCheckout(plan = 'premium', wallet = '') {
  if (!isStripeConfigured()) {
    return { ok: false, reason: 'missing_config', message: stripeUnavailableMessage() };
  }

  // The account is the subject of the purchase, so the session cannot be
  // created anonymously. Checked here as well as server-side purely so the user
  // gets an instant, honest prompt instead of a round-trip and a 401.
  const token = authToken();
  if (!token) {
    return { ok: false, reason: 'sign_in_required', message: 'Sign in to continue to checkout.' };
  }

  let response;
  try {
    response = await fetch(CREATE_SESSION_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      // `wallet` is optional metadata now. Sent when we happen to have one.
      body: JSON.stringify({ plan, ...(wallet ? { wallet } : {}) }),
    });
  } catch {
    return { ok: false, reason: 'network_error', message: stripeUnavailableMessage() };
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.url) {
    return { ok: false, reason: data?.reason || 'checkout_error', message: data?.message || stripeUnavailableMessage() };
  }

  window.location.href = data.url;
  return { ok: true };
}
