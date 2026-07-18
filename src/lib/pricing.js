// SINGLE SOURCE OF TRUTH for paid-plan USD amounts.
//
// Imported by BOTH sides of the payment system so the price can never drift:
//   - the browser asks the wallet to pay this much (src/cryptoPayment.js) and
//     renders it on the Pay button (src/main.jsx);
//   - the server requires this much before it grants an entitlement
//     (netlify/functions/verify-solana-payment.mjs).
//
// Before this module the same numbers lived in two files, so a price change had
// to be made in lock-step in both or a wallet could pay one amount while the
// backend demanded another. There is now exactly one place to change a price.
//
// This file must stay PURE — no import.meta.env, no Node/Vite-only APIs — so it
// bundles cleanly into a Netlify Function (CJS, via ../../src/lib/pricing.js,
// the same cross-boundary import _rescanEngine.mjs already uses for trustScore)
// and into the Vite client alike.
//
// NOTE: the human-readable price strings shown on the pricing page live in the
// i18n dictionaries (src/i18n/*.js `pricing.*`) because they are translated and
// carry currency words ("USDT", "one-time"). Those are display copy; THESE are
// the numbers the payment logic actually computes against.
export const PLAN_USD_AMOUNT = {
  premium: 9,
  early_supporter: 99,
};

// The required USD for a plan, defaulting to Premium for any unknown plan —
// the same fallback both call sites previously implemented inline.
export function planUsdAmount(plan) {
  return PLAN_USD_AMOUNT[plan] || PLAN_USD_AMOUNT.premium;
}
