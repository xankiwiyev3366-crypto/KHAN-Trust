const STRIPE_JS_URL = 'https://js.stripe.com/v3/';

const stripeConfig = {
  publishableKey: import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY,
  premiumPriceId: import.meta.env.VITE_STRIPE_PREMIUM_PRICE_ID,
  supporterPriceId: import.meta.env.VITE_STRIPE_SUPPORTER_PRICE_ID,
};

let stripeLoadPromise;

function getPriceId(plan) {
  return plan === 'early_supporter' ? stripeConfig.supporterPriceId : stripeConfig.premiumPriceId;
}

function getMode(plan) {
  return plan === 'early_supporter' ? 'payment' : 'subscription';
}

export function isStripeConfigured(plan = 'premium') {
  return Boolean(stripeConfig.publishableKey && getPriceId(plan));
}

function loadStripeScript() {
  if (typeof window === 'undefined') return Promise.reject(new Error('Stripe is unavailable in this environment.'));
  if (window.Stripe) return Promise.resolve(window.Stripe);
  if (stripeLoadPromise) return stripeLoadPromise;

  stripeLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${STRIPE_JS_URL}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(window.Stripe), { once: true });
      existing.addEventListener('error', () => reject(new Error('Stripe failed to load.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = STRIPE_JS_URL;
    script.async = true;
    script.onload = () => resolve(window.Stripe);
    script.onerror = () => reject(new Error('Stripe failed to load.'));
    document.head.appendChild(script);
  });

  return stripeLoadPromise;
}

export async function startStripeCheckout(plan = 'premium') {
  if (!isStripeConfigured(plan)) {
    return { ok: false, reason: 'missing_config', message: 'Payments are not configured yet' };
  }

  const Stripe = await loadStripeScript();
  if (typeof Stripe !== 'function') {
    return { ok: false, reason: 'stripe_unavailable', message: 'Payments are not configured yet' };
  }

  const stripe = Stripe(stripeConfig.publishableKey);
  const result = await stripe.redirectToCheckout({
    lineItems: [{ price: getPriceId(plan), quantity: 1 }],
    mode: getMode(plan),
    successUrl: `${window.location.origin}${window.location.pathname}#/pricing?checkout=success`,
    cancelUrl: `${window.location.origin}${window.location.pathname}#/pricing?checkout=cancelled`,
  });

  if (result?.error) {
    return { ok: false, reason: 'redirect_failed', message: result.error.message || 'Payments are not configured yet' };
  }

  return { ok: true };
}
