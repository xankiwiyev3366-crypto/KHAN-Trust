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
- `SOLANA_RPC_URL` (optional, **server-side only**) - The scanner's Solana RPC endpoint. This is where a keyed provider URL belongs (Helius, QuickNode, Triton). Read by `netlify/functions/solana-rpc.mjs`, which proxies the scanner's read-only JSON-RPC calls behind a method allowlist and a per-IP rate limit, and by the `khan-holders-*` indexer. Never expose as a `VITE_` variable.
- `VITE_SOLANA_PUBLIC_RPC_URL` (optional, **public**) - Used only by wallet connection, payment verification and Launchpad minting, which submit transactions and confirm over a websocket and so cannot go through a stateless function. This value is inlined into the browser bundle, so it must be keyless or point at a domain-restricted/public-scoped endpoint. Defaults to `https://api.mainnet-beta.solana.com`.

> **`VITE_SOLANA_RPC_URL` is retired and no longer read by any code.** It was inlined into the client bundle by Vite, so setting it to a keyed provider URL - as earlier notes recommended, because the public endpoint throttles browser traffic - published that key to every visitor. If it is still set in the Netlify UI, **delete it, and rotate the provider key it contained**, then put the keyed URL in `SOLANA_RPC_URL` instead.
- `TELEGRAM_BOT_TOKEN` (optional, server-side / Netlify Function env) - Activates the Watchtower Telegram alert channel (`_telegram.mjs`). When set, the scheduled alerts job also pushes risk-change digests to any subscriber who has linked a Telegram chat id (`sub.telegramChatId`). When unset the channel is a silent no-op — email and the in-app bell are unaffected. NOTE: linking a user's chat id still needs a small bot `/start` webhook that records the chat id onto the user's alert subscription; the SEND path is complete, the ENROLLMENT webhook is the remaining piece. Server-only; never expose as `VITE_`.
- `ANTHROPIC_API_KEY` (optional, server-side / Netlify Function env) - Activates the Grounded AI Analyst. When set, the Premium AI cards overlay real Claude-written prose (explaining the deterministic engine's scores, holder concentration, liquidity, and contract-security authorities) over the deterministic templates. The model NEVER produces a number: every figure is validated against the engine's own facts and any fabricated number is discarded (`_aiValidator`), and the monthly spend ceiling in `_aiBudget` fails closed. When unset, the AI layer is silently skipped and the deterministic templates render unchanged — no user-visible error. Never expose this as a `VITE_` variable; it is server-only.

- `LIFECYCLE_UNSUBSCRIBE_SECRET` (optional, server-side only) - Signs the unsubscribe and resubscribe capability links in lifecycle emails (`_lifecycleToken.mjs`). Falls back to `JWT_SECRET`, so no action is needed to go live. With neither set the mailer still runs, but the opt-out endpoint reports itself unavailable rather than issuing forgeable tokens. Never a `VITE_` variable.

If any required Stripe variable is missing, card payment buttons show “Card payments are not configured yet” and the site keeps working. If the crypto wallet variable is missing, the crypto section shows “Crypto payments are not configured yet”.

## Lifecycle email (retention)

The only email this product ever sent a new account was “verify your email address”. `lifecycle-send-cron.mjs` is the retention sequence: welcome, day1, day3, day5, day7, premiumOffer, and a recurring “nothing changed” reassurance send.

**It is a scheduled function** (`export const config = { schedule: '0 9 * * *' }`, read by Netlify at deploy time — there is no `netlify.toml` entry to add). Scheduled functions are not HTTP-routable, so there is deliberately no way to trigger a send manually or to blast the whole list.

Operational notes:

- **It is a no-op until `RESEND_API_KEY` is set.** No key, no sends, no errors — the same contract every other mail path here follows.
- **Deliverability depends on a verified sending domain in Resend.** Until one exists, Resend only accepts mail to the account owner's own address, and the function log will say exactly that.
- **`URL` is supplied by Netlify** and is what every link in every template is built from. It only needs setting when running outside Netlify; a wrong value sends working emails full of broken links.
- At most one email per user per run, a 20-hour minimum gap between any two, and at most `MAX_USERS_PER_RUN` (50) users per run — so the daily send ceiling is 50 by construction, not by hope.
- Every message carries RFC 8058 one-click unsubscribe headers, which Gmail and Yahoo require of bulk senders. `/unsubscribe` is the human-facing link; the header points straight at the function so the unattended POST never depends on redirect handling. **Do not "tidy" the header to use the pretty path.**
- Opting out sets `emailOptOut` only. It never cancels the risk alerts a user asked for by watching a token.
- Sends, unsubscribes and resubscribes are recorded to the Growth OS (`lifecycle_email_sent` / `lifecycle_unsubscribed` / `lifecycle_resubscribed`, attributed to the `internal` channel), so `/console` can measure whether the sequence works and what it costs.

## Notes

- No backend is required for the MVP.
- No secret keys are required.
- Live Solana token data is fetched in the browser from public APIs.
- Submitted and edited profiles are stored in `localStorage`.
- PDF report export runs fully client-side via `jspdf`.
