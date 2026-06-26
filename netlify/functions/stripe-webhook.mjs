// POST /.netlify/functions/stripe-webhook
// Receives Stripe webhook events and mirrors successful card payments into
// the same entitlement store the crypto flow writes to (see
// _entitlementsStore.mjs), keyed by the wallet address carried through
// checkout (see create-stripe-checkout-session.mjs).
import Stripe from 'stripe';
import { grantEntitlement, revokeEntitlement, findWalletByStripeSubscription, jsonResponse } from './_entitlementsStore.mjs';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

async function handleCheckoutCompleted(stripe, session) {
  const wallet = session.client_reference_id || session.metadata?.wallet;
  const plan = session.metadata?.plan === 'early_supporter' ? 'early_supporter' : 'premium';
  if (!wallet) return;

  await grantEntitlement(wallet, {
    plan,
    currency: 'card',
    amountPaid: (session.amount_total || 0) / 100,
    provider: 'stripe',
    stripeCustomerId: session.customer || null,
    stripeSubscriptionId: session.subscription || null,
    transactionHash: session.id,
    verifiedAt: new Date().toISOString(),
  });
}

async function handleSubscriptionDeleted(subscription) {
  const wallet = subscription.metadata?.wallet || (await findWalletByStripeSubscription(subscription.id));
  if (!wallet) return;
  await revokeEntitlement(wallet);
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { message: 'Method not allowed' });
  }

  if (!STRIPE_SECRET_KEY || !WEBHOOK_SECRET) {
    return jsonResponse(200, { received: false, message: 'Stripe webhook is not configured' });
  }

  const signature = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  const rawBody = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64') : event.body || '';

  const stripe = new Stripe(STRIPE_SECRET_KEY);
  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, WEBHOOK_SECRET);
  } catch (error) {
    return jsonResponse(400, { message: `Webhook signature verification failed: ${error.message}` });
  }

  try {
    switch (stripeEvent.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(stripe, stripeEvent.data.object);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(stripeEvent.data.object);
        break;
      case 'invoice.payment_failed':
      case 'checkout.session.async_payment_failed':
        // No entitlement to grant/revoke - Stripe Checkout/Billing already
        // notifies the customer and retries; we just acknowledge receipt.
        break;
      default:
        break;
    }
  } catch (error) {
    return jsonResponse(500, { message: `Webhook handler error: ${error.message}` });
  }

  return jsonResponse(200, { received: true });
}
