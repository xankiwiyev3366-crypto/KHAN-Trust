// POST /.netlify/functions/create-stripe-checkout-session
// Creates a Stripe Checkout Session for the given plan and returns its URL
// for the browser to redirect to. The connected wallet address is recorded
// as client_reference_id/metadata so the webhook (see stripe-webhook.mjs)
// knows which wallet to grant access to once payment succeeds - Stripe has
// no idea what a "wallet" is, so this app has to carry that link itself.
import Stripe from 'stripe';
import { jsonResponse } from './_blobsClient.mjs';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const PREMIUM_PRICE_ID = process.env.STRIPE_PREMIUM_PRICE_ID || '';
const SUPPORTER_PRICE_ID = process.env.STRIPE_SUPPORTER_PRICE_ID || '';
const SITE_URL = process.env.URL || '';

const WALLET_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,48}$/;

function getPriceId(plan) {
  return plan === 'early_supporter' ? SUPPORTER_PRICE_ID : PREMIUM_PRICE_ID;
}

function getMode(plan) {
  return plan === 'early_supporter' ? 'payment' : 'subscription';
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { message: 'Method not allowed' });
  }

  if (!STRIPE_SECRET_KEY) {
    return jsonResponse(200, { reason: 'not_configured', message: 'Card payments are not configured yet' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { reason: 'invalid_body', message: 'Invalid request body' });
  }

  const plan = payload.plan === 'early_supporter' ? 'early_supporter' : 'premium';
  const wallet = (payload.wallet || '').trim();

  if (!wallet || !WALLET_PATTERN.test(wallet)) {
    return jsonResponse(400, { reason: 'wallet_required', message: 'Connect a wallet first so we know where to grant access.' });
  }

  const priceId = getPriceId(plan);
  if (!priceId) {
    return jsonResponse(200, { reason: 'not_configured', message: 'Card payments are not configured yet' });
  }

  const mode = getMode(plan);
  const origin = SITE_URL || `https://${event.headers?.host || ''}`;

  try {
    const stripe = new Stripe(STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.create({
      mode,
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: wallet,
      metadata: { wallet, plan },
      ...(mode === 'subscription' ? { subscription_data: { metadata: { wallet, plan } } } : {}),
      success_url: `${origin}/#/pricing?checkout=success`,
      cancel_url: `${origin}/#/pricing?checkout=cancelled`,
    });

    return jsonResponse(200, { url: session.url });
  } catch (error) {
    return jsonResponse(200, { reason: 'checkout_error', message: error.message || 'Card payments are not configured yet' });
  }
}
