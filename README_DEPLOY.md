# KHAN Trust Deployment

KHAN Trust is a standalone React + Vite frontend app.

## Vercel Settings

- Install command: `npm install`
- Build command: `npm run build`
- Output folder: `dist`
- Local dev: `npm run dev`

## Netlify Settings

- Build command: `npm run build`
- Publish directory: `dist`
- Config is checked in at `netlify.toml`.

## Environment Variables

- `VITE_GA_MEASUREMENT_ID` (optional) - Google Analytics 4 measurement ID (e.g. `G-XXXXXXXXXX`). When unset, no GA scripts load and no analytics events are sent. See `.env.example`.
- `VITE_STRIPE_PUBLISHABLE_KEY` (optional) - Stripe publishable key for client-side Checkout redirects. Do not use a secret key here.
- `VITE_STRIPE_PREMIUM_PRICE_ID` (optional) - Stripe Price ID for the Premium monthly plan.
- `VITE_STRIPE_SUPPORTER_PRICE_ID` (optional) - Stripe Price ID for the Early Supporter one-time payment.

If any required Stripe variable is missing, payment buttons show “Payments are not configured yet” and the site keeps working.

## Notes

- No backend is required for the MVP.
- No secret keys are required.
- Live Solana token data is fetched in the browser from public APIs.
- Submitted and edited profiles are stored in `localStorage`.
- PDF report export runs fully client-side via `jspdf`.
