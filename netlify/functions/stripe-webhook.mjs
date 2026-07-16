// POST /.netlify/functions/stripe-webhook
// Receives Stripe webhook events and mirrors successful card payments into
// the same entitlement store the crypto flow writes to (see
// _entitlementsStore.mjs), keyed by the SUBJECT carried through checkout (see
// create-stripe-checkout-session.mjs).
//
// The subject is "u:<userId>" for anything bought since accounts became the
// primary identity, and a bare wallet address for older sessions. This handler
// does not care which: it grants to whatever key checkout stamped on the
// session. That is what lets the cutover happen with no dual-write and no
// backfill — old sessions in flight at deploy time still resolve correctly,
// because their client_reference_id already says what they are.
import Stripe from 'stripe';
import { grantEntitlement, revokeEntitlement, findSubjectByStripeSubscription, jsonResponse } from './_entitlementsStore.mjs';
import { recordCheckoutCompleted } from './_growthRecord.mjs';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

async function handleCheckoutCompleted(stripe, session) {
  // client_reference_id is the subject. metadata.subject is a belt-and-braces
  // copy; metadata.wallet is the LEGACY fallback for sessions created before
  // this change that were already open in a browser tab when it deployed.
  const subject = session.client_reference_id || session.metadata?.subject || session.metadata?.wallet;
  const plan = session.metadata?.plan === 'early_supporter' ? 'early_supporter' : 'premium';
  if (!subject) return;

  await grantEntitlement(subject, {
    plan,
    currency: 'card',
    amountPaid: (session.amount_total || 0) / 100,
    provider: 'stripe',
    stripeCustomerId: session.customer || null,
    stripeSubscriptionId: session.subscription || null,
    transactionHash: session.id,
    verifiedAt: new Date().toISOString(),
    // Optional context, never the key. userId is present for account purchases;
    // wallet only when the buyer happened to have one connected.
    userId: session.metadata?.userId || null,
    wallet: session.metadata?.wallet || null,
  });

  // Growth Data Plane: the ONLY trustworthy record that money actually moved.
  // Stripe has verified the signature by the time this runs, so this is the
  // one conversion event in the system that cannot be faked by a client.
  //
  // Recorded AFTER grantEntitlement so a failure here can never cost a paying
  // customer their access - _growthRecord is fail-soft by contract, but the
  // ordering makes that guarantee independent of it.
  //
  // This used to pass userId: null and say so honestly, because checkout was
  // keyed by wallet and the platform genuinely could not know who paid. Account
  // checkout means it now can, for the first time. It is still passed as
  // whatever it actually is — null for a legacy wallet session — so the
  // warehouse is never handed an identity that was not really established.
  await recordCheckoutCompleted({
    userId: session.metadata?.userId || null,
    plan,
  });
}

async function handleSubscriptionDeleted(subscription) {
  // Order matters: prefer the subject stamped in metadata, then fall back to
  // scanning for the key carrying this subscription id. The scan is what covers
  // legacy wallet subscriptions, whose metadata predates `subject`.
  const subject = subscription.metadata?.subject
    || subscription.metadata?.wallet
    || (await findSubjectByStripeSubscription(subscription.id));
  if (!subject) return;
  await revokeEntitlement(subject);
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
