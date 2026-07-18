// READ-ONLY check that the live Stripe Price objects match what the application
// assumes. It never creates, edits, or deletes anything in Stripe — it only
// retrieves the two Price ids the app is configured with and asserts their
// shape, so a price drift between the Stripe Dashboard and this codebase is
// caught by one command instead of by a confused customer.
//
// WHY THIS EXISTS
//
// The Early Supporter and Premium *amounts* do NOT live in this repo. The app
// only carries the Price IDs (STRIPE_PREMIUM_PRICE_ID / STRIPE_SUPPORTER_PRICE_ID)
// and the mode each is charged in (Premium = subscription, Early Supporter =
// one-time payment — see create-stripe-checkout-session.mjs). The dollar figure
// is set on the Price object in the Stripe Dashboard. So when the in-app price
// changed from $29 to $99, the code changed but Stripe did not: card buyers keep
// paying the old amount until a NEW $99 one-time Price is created and
// STRIPE_SUPPORTER_PRICE_ID is repointed at it. This script proves whether that
// has been done.
//
// USAGE (with your own key, in your own shell — the key is never committed):
//   STRIPE_SECRET_KEY=sk_live_... \
//   STRIPE_PREMIUM_PRICE_ID=price_... \
//   STRIPE_SUPPORTER_PRICE_ID=price_... \
//   node scripts/verify-stripe-pricing.mjs
//
// Exits 0 if both Prices match expectations, non-zero (with a diff) otherwise.
import Stripe from 'stripe';

// The single source of truth for the numbers, so this check can never disagree
// with what the client charges and the verifier requires.
import { PLAN_USD_AMOUNT } from '../src/lib/pricing.js';

const KEY = process.env.STRIPE_SECRET_KEY || '';
const PREMIUM_PRICE_ID = process.env.STRIPE_PREMIUM_PRICE_ID || '';
const SUPPORTER_PRICE_ID = process.env.STRIPE_SUPPORTER_PRICE_ID || '';

if (!KEY) {
  console.error('✗ STRIPE_SECRET_KEY is not set. Run this with your Stripe key in the environment.');
  console.error('  This script is READ-ONLY; it retrieves prices and never modifies your account.');
  process.exit(2);
}

// What the application requires of each Price, derived from src/lib/pricing.js
// and the checkout modes in create-stripe-checkout-session.mjs.
const EXPECTATIONS = [
  {
    label: 'Premium',
    id: PREMIUM_PRICE_ID,
    envName: 'STRIPE_PREMIUM_PRICE_ID',
    unitAmount: PLAN_USD_AMOUNT.premium * 100, // cents
    recurring: 'month', // subscription mode
  },
  {
    label: 'Early Supporter',
    id: SUPPORTER_PRICE_ID,
    envName: 'STRIPE_SUPPORTER_PRICE_ID',
    unitAmount: PLAN_USD_AMOUNT.early_supporter * 100, // cents
    recurring: null, // one-time payment mode
  },
];

const stripe = new Stripe(KEY);
const failures = [];

for (const expected of EXPECTATIONS) {
  if (!expected.id) {
    failures.push(`${expected.label}: ${expected.envName} is not set.`);
    continue;
  }

  let price;
  try {
    price = await stripe.prices.retrieve(expected.id, { expand: ['product'] });
  } catch (error) {
    failures.push(`${expected.label}: could not retrieve ${expected.id} — ${error.message}`);
    continue;
  }

  const problems = [];
  if (price.currency !== 'usd') problems.push(`currency is ${price.currency}, expected usd`);
  if (price.unit_amount !== expected.unitAmount) {
    problems.push(`amount is ${(price.unit_amount / 100).toFixed(2)}, expected ${(expected.unitAmount / 100).toFixed(2)}`);
  }
  const interval = price.recurring?.interval || null;
  if (interval !== expected.recurring) {
    problems.push(`billing is ${interval ? `recurring/${interval}` : 'one-time'}, expected ${expected.recurring ? `recurring/${expected.recurring}` : 'one-time'}`);
  }
  if (price.active === false) problems.push('price is archived/inactive');

  if (problems.length) {
    failures.push(`${expected.label} (${expected.id}): ${problems.join('; ')}`);
  } else {
    const shape = expected.recurring ? `$${(price.unit_amount / 100).toFixed(2)}/${expected.recurring}` : `$${(price.unit_amount / 100).toFixed(2)} one-time`;
    console.log(`✓ ${expected.label}: ${shape} — matches the application.`);
  }
}

if (failures.length) {
  console.error('\n✗ Stripe prices do NOT match the application:\n');
  for (const failure of failures) console.error(`  ${failure}`);
  console.error('\nTo fix Early Supporter: in the Stripe Dashboard create a NEW one-time Price of');
  console.error('$99.00 USD on the Early Supporter product, then set STRIPE_SUPPORTER_PRICE_ID to it');
  console.error('(Prices are immutable — you cannot edit the old $29 one). Re-run this check.\n');
  process.exit(1);
}

console.log('\n✓ Stripe product/price configuration is consistent with the application.');
