// Card payments go through a Stripe-hosted Checkout Session created
// server-side (see netlify/functions/create-stripe-checkout-session.mjs),
// not Stripe.js redirectToCheckout - that keeps the secret key and Price IDs
// off the client and lets the session carry the connected wallet address so
// the webhook knows which wallet to grant access to.
const CREATE_SESSION_ENDPOINT = '/.netlify/functions/create-stripe-checkout-session';

const PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

export function isStripeConfigured() {
  return Boolean(PUBLISHABLE_KEY);
}

export function stripeUnavailableMessage() {
  return 'Card payments are not configured yet';
}

export async function startStripeCheckout(plan = 'premium', wallet = '') {
  if (!isStripeConfigured()) {
    return { ok: false, reason: 'missing_config', message: stripeUnavailableMessage() };
  }

  if (!wallet) {
    return { ok: false, reason: 'wallet_required', message: 'Connect a wallet first so we know where to grant access.' };
  }

  let response;
  try {
    response = await fetch(CREATE_SESSION_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan, wallet }),
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
