// POST /.netlify/functions/create-stripe-checkout-session
// Creates a Stripe Checkout Session for the given plan and returns its URL for
// the browser to redirect to.
//
// THE SUBJECT IS THE AUTHENTICATED ACCOUNT
//
// This endpoint used to demand a connected Solana wallet and refuse to sell
// anything without one ("Connect a wallet first so we know where to grant
// access"), because entitlements were keyed by wallet from a time before this
// site had accounts. The effect was that the most security-anxious user on the
// internet had to connect their wallet in order to buy protection from wallet
// risk — and `wallet_required` became a named, measured drop-off in the
// checkout funnel.
//
// Now the session carries "u:<userId>" as client_reference_id and the webhook
// grants to that account. Stripe has no idea what an account is either, so this
// app still has to carry the link itself; the difference is only which identity
// it carries.
//
// A wallet may still be supplied. It is recorded as OPTIONAL METADATA — never
// as the grant key, never required, and never validated as a precondition of
// taking money.
import Stripe from 'stripe';
import { jsonResponse } from './_blobsClient.mjs';
import { verifyJwt, bearerToken } from './_authStore.mjs';
import { accountSubject } from './_entitlementsStore.mjs';

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

  // The account is the subject. Proven by the caller's own JWT rather than read
  // from the body: a body-supplied user id would let anyone mint a session that
  // grants Premium to an account they do not own. Stripe would still demand
  // payment, so this is not free access — but it would let an attacker attach
  // their card, and therefore their cancellation, to a stranger's entitlement.
  const auth = verifyJwt(bearerToken(event));
  if (!auth?.sub) {
    return jsonResponse(401, {
      reason: 'sign_in_required',
      message: 'Sign in to continue to checkout.',
    });
  }
  const subject = accountSubject(auth.sub);

  // Optional. Recorded so a purchase can still be associated with a wallet for
  // wallet-specific features, and so support can reconcile a legacy user — but
  // it is metadata, never the key, and never a precondition. An address that
  // fails validation is simply dropped rather than failing the sale.
  const rawWallet = (payload.wallet || '').trim();
  const wallet = WALLET_PATTERN.test(rawWallet) ? rawWallet : '';

  const priceId = getPriceId(plan);
  if (!priceId) {
    return jsonResponse(200, { reason: 'not_configured', message: 'Card payments are not configured yet' });
  }

  const mode = getMode(plan);
  const origin = SITE_URL || `https://${event.headers?.host || ''}`;

  // Everything the webhook needs to grant, on both the session and (for
  // subscriptions) the subscription itself — cancellation events arrive with
  // subscription metadata, not session metadata.
  const metadata = { subject, userId: auth.sub, plan, ...(wallet ? { wallet } : {}) };

  try {
    const stripe = new Stripe(STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.create({
      mode,
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: subject,
      metadata,
      // Prefills the Stripe form and ties the receipt to the account the user
      // actually signed in with — one fewer field to type at the moment of
      // payment.
      ...(auth.email ? { customer_email: auth.email } : {}),
      ...(mode === 'subscription' ? { subscription_data: { metadata } } : {}),
      success_url: `${origin}/#/pricing?checkout=success`,
      cancel_url: `${origin}/#/pricing?checkout=cancelled`,
    });

    return jsonResponse(200, { url: session.url });
  } catch (error) {
    return jsonResponse(200, { reason: 'checkout_error', message: error.message || 'Card payments are not configured yet' });
  }
}
