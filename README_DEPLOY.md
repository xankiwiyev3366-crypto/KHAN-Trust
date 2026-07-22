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
- `VITE_KHAN_PAYMENT_WALLET` (optional) - Public Solana wallet address shown for manual USDT/SOL crypto payments.
- `TELEGRAM_BOT_TOKEN` (optional, server-side / Netlify Function env) - Activates the Watchtower Telegram alert channel (`_telegram.mjs`). When set, the scheduled alerts job also pushes risk-change digests to any subscriber who has linked a Telegram chat id (`sub.telegramChatId`). When unset the channel is a silent no-op — email and the in-app bell are unaffected. NOTE: linking a user's chat id still needs a small bot `/start` webhook that records the chat id onto the user's alert subscription; the SEND path is complete, the ENROLLMENT webhook is the remaining piece. Server-only; never expose as `VITE_`.
- `ANTHROPIC_API_KEY` (optional, server-side / Netlify Function env) - Activates the Grounded AI Analyst. When set, the Premium AI cards overlay real Claude-written prose (explaining the deterministic engine's scores, holder concentration, liquidity, and contract-security authorities) over the deterministic templates. The model NEVER produces a number: every figure is validated against the engine's own facts and any fabricated number is discarded (`_aiValidator`), and the monthly spend ceiling in `_aiBudget` fails closed. When unset, the AI layer is silently skipped and the deterministic templates render unchanged — no user-visible error. Never expose this as a `VITE_` variable; it is server-only.

If any required Stripe variable is missing, card payment buttons show “Card payments are not configured yet” and the site keeps working. If the crypto wallet variable is missing, the crypto section shows “Crypto payments are not configured yet”.

## Notes

- No backend is required for the MVP.
- No secret keys are required.
- Live Solana token data is fetched in the browser from public APIs.
- Submitted and edited profiles are stored in `localStorage`.
- PDF report export runs fully client-side via `jspdf`.
