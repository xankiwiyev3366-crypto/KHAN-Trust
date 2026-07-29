# PHASE 0 — EXPLORATION REPORT

Read-only. No feature code written, nothing committed, nothing pushed. This file is the only artifact.

**Headline:** the spec's mental model of this codebase is roughly two years behind it. This is not a thin SPA with a few functions — it is 155 Netlify Functions, 12 blob stores, a Postgres mirror with a migration runner, an entitlement layer, a feature-gate registry read by both client and server, a server-rendered SEO surface, an edge router, a badge endpoint, an admin-approved verification flow, a Solana payment verifier, and 816 passing tests. **Roughly 60% of what Phases 1–4 ask for already exists in some form.** The work is mostly *extension and correction*, not construction. Estimates at the end are revised down sharply as a result.

---

## A. Repository and deployment

### 1. Structure and conventions

```
netlify/functions/          155 files, all .mjs (ESM), Node
  _*.mjs                    shared modules (not routable — leading underscore is the convention)
  <name>.mjs                one HTTP endpoint each, `export async function handler(event)`
netlify/edge-functions/     token-router.js (Deno runtime) + lib/ua.mjs
src/                        React 19 + Vite SPA, hash-routed
  main.jsx                  12,953 lines — the entire user app
  admin/adminMain.jsx       separate Vite entry (admin.html) for the private /console
  lib/                      pure modules shared across the client/function boundary
  i18n/                     en, az, ru, tr — 4 locales, ~3,000 lines each
db/migrations/              0001_phase1_init.sql
scripts/                    db-migrate, db-backfill, verify-boundary, verify-functions, verify-i18n, verify-stripe
tests/                      59 .mjs test files
```

**Conventions worth respecting** (they are enforced, not stylistic):

- Functions are `.mjs`, plain `export async function handler(event)` — the Lambda-compat signature, *not* the newer Netlify `(req, context) => Response` style. Everything is consistent; do not mix.
- Every non-trivial module opens with a long comment explaining *why* the design is what it is, including what broke previously. This is a genuine engineering asset here. New code should match it.
- `src/lib/*.js` files are deliberately **pure** (no `import.meta.env`, no Node APIs) so they can be imported from both the Vite client and Netlify Functions. `scripts/verify-functions.mjs` enforces this at build time.
- `jsonResponse(status, body)` from `_blobsClient.mjs` is the standard response helper.

### 2. `netlify.toml`

```toml
[build]
  command = "npm run build"
  publish = "dist"
  functions = "netlify/functions"
```

**Critical to Phase 2/4:** there is **no catch-all `/*` redirect**, and the file says so in three separate comments. Every redirect is path-specific and additive:

| From | To | Note |
|---|---|---|
| `/console`, `/console/*` | `/admin.html` (200) | private growth console |
| `/token/:contract` | `token-page` function (200) | SEO surface (fallback behind the edge fn) |
| `/sitemap.xml` | `sitemap` function (200) | |
| `/badge/:projectId` | `verify-badge` function (200) | **the badge surface already exists** |
| `/unsubscribe` | `lifecycle-unsubscribe` (200) | |
| `/signup` | `/index.html` (200) | referral invite links |

Security headers are already set globally (HSTS, X-Frame-Options SAMEORIGIN, nosniff, Referrer-Policy, Permissions-Policy, `CSP: frame-ancestors 'self'`). A resource-restricting CSP is deliberately **not** set yet.

Scheduled functions declared in `netlify.toml`: `growth-compact-cron` (`15 3 * * *`), `growth-analyze-cron` (`0 6 * * 1`).

### 3. Edge / Scheduled / Background functions in use today

**Yes to all three.** This matters enormously for Section 1C.

- **Edge (Deno):** `netlify/edge-functions/token-router.js`, `config = { path: '/token/*' }`. Does User-Agent negotiation — crawlers get server-rendered HTML from `token-page`, humans get the SPA at the same URL.
- **Scheduled** (via `export const config = { schedule }`): `alerts-run` (`15,45 * * * *`), `watch-rescan-cron` (`0,30 * * * *`), `lifecycle-send-cron` (`0 9 * * *`), `early-stage-discover-run` (`0 */2 * * *`), `khan-holders-sync` (`*/10 * * * *`).
- **Background** (`-background` suffix): `watch-rescan-background`, `growth-analyze-background`. The cron function fires the background function and returns instantly — the topology is already established and documented in `netlify.toml` lines 6–18 and `_growthRunAnalysis.mjs`.

**The payment-sweeper pattern the spec asks for in 1C already has a working precedent in this repo.** No new architecture needed.

### 4. Branches

- Production branch: `main`. Remote: `github.com/xankiwiyev3366-crypto/KHAN-Trust`.
- Local branches: `main`, `wip/telegram-enrollment` (built but deliberately unshipped — do not merge), `fix/analysis-audit-dedup-missing-data`, `checkpoint/khan-trust-before-risk-cleanup-20260619`.
- **Deploy previews: cannot be determined from the repo.** Question for you (Q1).

### 5. Package manager, Node, dependencies

- npm (`package-lock.json`). **No `engines` field, no `.nvmrc`, no `NODE_VERSION` in `netlify.toml`** — the Node version is whatever Netlify defaults to. Worth pinning, but out of scope.
- Backend is **JavaScript** (`.mjs`), not TypeScript. `typescript` is a dependency but nothing here is `.ts`.
- Relevant deps already present: `@solana/web3.js`, `@solana/spl-token`, `@solana/wallet-adapter-{react,phantom,solflare,base}`, `bs58`, `tweetnacl`, `pg`, `stripe`, `jspdf`, `@netlify/blobs`, `@anthropic-ai/sdk`, React 19, Vite 7.

**Every dependency Phase 2 needs is already installed.** `tweetnacl` + `bs58` are already used for ed25519 signature verification.

- Build: `vite build && verify-boundary && verify-functions && verify-i18n`. Three guard scripts run on every build and fail it. Phase 1's i18n edits **must** satisfy `verify-i18n` (all 4 locales in sync).

---

## B. Data layer

### 6. Which database

**Two, with a deliberate hierarchy:**

1. **Netlify Blobs is the source of truth.** ~12 named stores accessed through `_blobsClient.mjs` → `getNamedStore(name)`. Everything user-facing reads and writes here. Data model is JSON documents at fixed keys (e.g. `khan-trust-entitlements/entitlements.json`).
2. **PostgreSQL is a best-effort mirror** (`_db.mjs`, `pg` Pool). It exists for longitudinal analytics that a KV store can't serve.

`_db.mjs` has a hard contract, quoted verbatim from its header:

> *"this module must never break a request. Netlify Blobs remains the source of truth. Postgres is a best-effort mirror"*

- No `DATABASE_URL` → every mirror write is a silent no-op.
- `mirror()` never throws, never hangs (1500 ms race), returns `{ok:false}` on failure.
- `readRows()` same posture (2500 ms), returns a discriminated result so callers do Postgres-first-with-Blob-fallback.
- Pool: `max: 3`, `allowExitOnIdle: true`, 3 s connect timeout, 4 s statement timeout.

**This is a direct conflict with the spec.** Section 2.5 requires *"Enforce with a DB constraint, not application logic alone"* for duplicate-order concurrency — but the only store with real constraints is the one this codebase treats as optional and non-authoritative. See §26 for the resolution.

### 7. How schema changes are made

`db/migrations/NNNN_name.sql`, applied by `node scripts/db-migrate.mjs` (**manual only, never wired into the build**), tracked in a `schema_migrations` table. Files use `IF NOT EXISTS` and are idempotent. `--status` lists applied vs pending.

This is exactly the mechanism Phase 2 should use. One new file: `0002_verification.sql`.

### 8. Existing tables / stores

**Postgres** (`0001_phase1_init.sql`): `schema_migrations`, `tokens` (identity PK, contract, chain, name, ticker, category, deployer_address), `corpus_tokens`, `score_history` (PK token_key+observed_date), `watch_snapshots` (append-only observations).

**Netlify Blob stores** (name → what it holds):

| Store | Contents |
|---|---|
| `khan-trust-entitlements` | `entitlements.json` (paid Premium, keyed by subject), `used-signatures.json` |
| `khan-trust-verification` | `requests.json`, `statuses.json` — **the existing verification flow** |
| `khan-trust-auth` | user accounts |
| `khan-trust-premium` | admin/manual Premium grants (isolated from paid) |
| `khan-trust-corpus` | client-lane token verdicts (drives SEO pages + sitemap) |
| `khan-trust-watch-snapshots` | server-lane observations |
| `khan-trust-score-history`, `-alerts`, `-notifications`, `-analytics`, `-rate-limits`, `-referral`, `-lifecycle`, `-retention`, `-scan-quota`, `-support`, `-reports`, `-user-data`, `-early-stage`, `-discovery`, `-growth`, `-token-corpus`, `-wallet-link` | as named |

### 9. Pooling for serverless

Configured but modest: `max: 3` per instance, `allowExitOnIdle`. **The connection string is unknown** — `.netlify/state.json` shows a *local dev* string (`postgres://localhost:55982/postgres`), which tells us nothing about production. Question Q2: which provider, and is it a pooled endpoint (Supabase `:6543` transaction mode / Neon pooler)?

Given `max:3` × N concurrent Lambdas, a direct (non-pooled) Postgres endpoint will exhaust connections under any real load. Right now that fails *safely* — mirror writes silently no-op. If Phase 2 puts verification orders in Postgres, it stops being safe.

---

## C. Existing product surfaces

### 10. Authentication

- **Custom**, home-grown. `_authStore.mjs`: email/password accounts in Blobs, JWTs signed with `AUTH_SECRET` (HS256, hand-rolled with `node:crypto`).
- A function identifies the caller with `verifyJwt(bearerToken(event))` → `payload.sub` is the user id.
- **Second identity system:** proven Solana wallets. `wallet-challenge` issues a nonce message, `wallet-auth` verifies the ed25519 signature and issues a wallet-session token; `provenWallet(event)` in `_walletSession.mjs` resolves it. **This is directly reusable for Phase 2.4 ownership proof — do not build a second nonce system.**
- **Admin role:** a single shared passcode (`KHAN_ADMIN_PASSCODE`) exchanged for an HMAC-signed 12-hour token (`_adminAuth.mjs`). Fails closed in production if unset. There is no per-user admin role.

### 11. Premium subscription — the thing that must not break

Mapped completely. **Three entitlement sources**, merged by one resolver:

```
_premiumAccess.mjs :: resolveVerifiedPremiumAccess(event)
  1. proven wallet  → _entitlementsStore  (LEGACY, keyed by base58 address)
  2. account JWT    → _entitlementsStore  (PRIMARY, keyed by "u:<userId>")
  3. account JWT    → _premiumStore       (admin/manual grants, isolated)
```

- **Storage:** Netlify Blobs, `khan-trust-entitlements/entitlements.json`, keyed by *subject*. Two key spaces that provably cannot collide (base58 never starts with `u:`).
- **Payment providers:** Stripe (`create-stripe-checkout-session` + `stripe-webhook`, currently **off** — `VITE_STRIPE_ENABLED=false`) **and** on-chain Solana (`verify-solana-payment.mjs`, the live path).
- **Prices:** `src/lib/pricing.js` — the single source of truth both sides import. `premium: 9`, `early_supporter: 99`. The **Stripe** price amounts live in the Stripe Dashboard, not here.
- **Gating:** `src/lib/features.js` is a registry read by *both* client and server. Client wraps UI in `<PremiumLock feature="key">`; server calls `requireFeature(event, 'key')` → 402 with `upgradeUrl`. Unknown keys **fail closed** (treated as premium).
- **Fail-open on outage:** `_featureGate.mjs` allows the request if the entitlement store throws, with a long justification. Do not invert this.
- **Subscriber count:** cannot be read from the repo — it lives in production Blobs. `countActivePaidPremium()` in `_entitlementsStore.mjs` is the one canonical definition (dedupes by `transactionHash` so an account+wallet double-write counts one human).

**Spec conflict:** §1B calls Premium *"$9/month — unchanged"* and describes verification as a *new* on-chain billing path. In reality **Premium is already sold on-chain via Solana**, through code that does exactly what §2.3 asks for (server-side verification, mint allow-list, signature replay protection). Verification should extend that machinery, not stand up a parallel one. Also note there is a **third plan** the spec doesn't mention: `early_supporter` / "KHAN Founding Member", $99 one-time, lifetime. Any pricing-page restructure must not erase it.

### 12. Scoring engine — and where a scan actually happens

**There are two independent scoring lanes, and confusing them is the single most dangerous mistake available in this codebase.**

**Lane 1 — client lane.** The full scan runs **in the browser**, in `src/main.jsx` (`lookupTokenByAddress` → `calculateLiveScores`). It fans out to ~18 providers: DexScreener, Jupiter, CoinGecko, GeckoTerminal, GoPlus, block explorers, and Solana RPC *through our own proxy* (`/.netlify/functions/solana-rpc`). Hardened by `src/providers.js` — every call time-boxed at 9 s, non-throwing, source-attributed.

**Lane 2 — server lane.** `_volatileSignals.mjs` + `_rescanEngine.mjs`. Two keyless HTTP calls (DexScreener + GoPlus), a deliberately narrower input set, scored by the same `calculateLiveScores`.

**The two produce different numbers for the same token, by design.** From `_rescanEngine.mjs`:

> *"at the same moment BONK scores 35 (High) from the client's inputs and 76 (Medium) from these. Both are internally consistent; neither is wrong; they are simply not comparable."*

They are kept in separate stores precisely so a server re-scan can never overwrite what a user sees. **Phase 2's `/verify/quote` needs a server-side score and only Lane 2 can produce one — which means a quote's `preview_score` may differ by ~40 points from what the customer sees on the site.** This is the single largest unresolved design problem in the spec. See §26.

**Scan duration:** not measurable from here (client-side, 18 parallel providers, 9 s cap each). Server-lane `fetchVolatileSignals` is 2 parallel calls with an 8 s timeout — comfortably inside a 10 s function.

### 13. Existing verification flow — it already exists

`_verificationStore.mjs` + 5 functions. The current flow:

1. Owner connects a Solana wallet and signs a fixed message (`KHAN Trust Verification Request\nProject:…\nContract:…\nWallet:…\nTimestamp:…`).
2. `verification-request.mjs` verifies the ed25519 signature server-side (`tweetnacl` + `bs58`), stores a pending request.
3. Admin reviews via `verification-admin-list` / `verification-admin-review` (passcode-gated), in the SPA at `#/admin-verify`.
4. `verification-status.mjs` serves the status map; "Verified by KHAN Trust" renders across the site.
5. `verify-badge.mjs` serves an embeddable shields-style SVG at `/badge/:projectId`.

**What's missing vs. Phase 2:** money, tiers, expiry, revocation, `badge_token`, `ownership_method` levels, impressions, the `/verify` sales page (there is no such route — only `admin-verify`), and self-service. What exists and should be *extended*: the store, the signature verification, the admin review path, the status map, the badge endpoint, and the `common.verified` / `pendingReview` / `rejected` i18n keys.

**Notable weakness in the existing signature check:** the signed message has no server-issued nonce — it uses a client-supplied `timestamp`, which is replayable. The `wallet-challenge` / `_walletSession.mjs` nonce system (§10) is the correct primitive and already exists. Phase 2 should use it.

### 14. PDF generation

`src/pdfReport.js`, **jsPDF, entirely client-side, in the browser.** No function involved, no timeout risk. Gated as `pdfReports: { tier: 'premium' }`.

**Conflict with §2.6:** delivering a PDF automatically by email on activation requires PDF generation to move server-side. jsPDF can run in Node, but the current module is coupled to browser fonts/layout. This is real work that the spec's estimate does not account for.

### 15. Telegram bot

**There is no bot host.** `_telegram.mjs` is a ~60-line send-only helper (`sendMessage` over plain fetch, `TELEGRAM_BOT_TOKEN`, server-side only, silent no-op when unset). No long-polling, no webhook, nothing to host. Enrollment (how a user's `chatId` gets recorded) is **built but deliberately unshipped** on the local branch `wip/telegram-enrollment`.

So §2.6 "Telegram if provided" and §5.1 "Approve/Skip buttons" both depend on a webhook receiver that does not exist in production. Phase 5's approve/skip flow needs one; the notify-only paths do not.

### 16. Watchtower

`watch-rescan-cron` (`0,30 * * * *`) fires `watch-rescan-background`, which does the work inside the 15-minute background budget. `alerts-run` (`15,45 * * * *`) compares snapshots and notifies. Tiered in `_watchTiers.mjs`: free = 5 tokens / 12 h, premium = 100 tokens / 30 min. Cap of 400 tokens per run, concurrency 4.

### 17. Phantom wallet connect

`@solana/wallet-adapter-react` + `-phantom` + `-solflare`, wrapped in `src/wallet/WalletContextProvider.jsx` / `useKhanWallet.js`. **Signature verification already exists in two places** — `verification-request.mjs` (project ownership) and `_walletSession.mjs` (session proof). Reuse, don't rewrite.

### 18. Frontend routing

Hand-rolled **hash routing** (`#/page`) read from `window.location.hash` in `main.jsx`, with `src/lib/routes.js` resolving permanent aliases (`dashboard→home`, `comparison→compare`, `alerts→watchlist`). No React Router. Path-based URLs exist only for the additive server-rendered surfaces (`/token/*`, `/badge/*`, `/signup`, `/unsubscribe`).

Meta tags: `index.html` is static; per-token meta is produced server-side by `token-page.mjs`.

---

## D. Solana integration

### 19. RPC and libraries

- `@solana/web3.js` ^1.98.4 present, plus `spl-token`, `bs58`, `tweetnacl`.
- **Three distinct RPC configurations**, and the separation is deliberate and load-bearing:
  - `SOLANA_RPC_URL` — **server-side only**, no `VITE_`. Where a keyed provider URL belongs. Proxied to the browser via `netlify/functions/solana-rpc.mjs`.
  - `VITE_SOLANA_PUBLIC_RPC_URL` — **public**, inlined into the bundle. Used only for wallet tx submission + websocket confirmation, which can't go through a stateless function. Must never carry a privileged key.
  - `HELIUS_API_KEY` — server-side, used by the `khan-holders-*` indexer. **A Helius account may already exist**, which matters for the 1C webhook recommendation (Q3).
- `.env.example` documents a past incident verbatim: *"A previous deployment set VITE_SOLANA_RPC_URL to a keyed Helius endpoint and shipped the key to every browser."*

### 20. Treasury wallet

`VITE_KHAN_PAYMENT_WALLET` — already configured and already receiving Premium payments. A receiving address is public by nature, so the `VITE_` prefix leaks nothing sensitive here. Accepted mints: USDC + USDT (`VITE_USDC_MINT`, `VITE_USDT_MINT`), allow-listed server-side so a worthless SPL token can't be counted as USD.

Phase 2 can use the same treasury or a separate one. **Recommendation: a separate `VERIFY_TREASURY_WALLET`** — mixing a $9 subscription stream and a $149/$399 one-time stream on one address makes reconciliation and webhook filtering needlessly hard.

---

## E. Configuration and quality

### 21. Environment variables

Loaded from `process.env` directly (functions) and `import.meta.env` (client). **No central validation, no startup fail-loud.** Modules degrade individually — `_telegram` no-ops without a token, `_email` no-ops without a key, `_db` no-ops without a URL. That posture is right for optional channels and **wrong for a payment path**, which is exactly what §"Required environment variables" says.

Complete inventory:

**Server-side (safe):** `AUTH_SECRET`, `DATABASE_URL`, `SOLANA_RPC_URL`, `HELIUS_API_KEY`, `ANTHROPIC_API_KEY`, `KHAN_AI_MONTHLY_BUDGET_USD`, `KHAN_ADMIN_PASSCODE`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PREMIUM_PRICE_ID`, `STRIPE_SUPPORTER_PRICE_ID`, `RESEND_API_KEY`, `SUPPORT_FROM_EMAIL`, `KHAN_ADMIN_NOTIFY_EMAIL`, `TELEGRAM_BOT_TOKEN`, `LIFECYCLE_UNSUBSCRIBE_SECRET`, `COINGECKO_API_KEY`, `GITHUB_TOKEN`, `EARLY_STAGE_DISCOVERY_REAL`, `NETLIFY_BLOBS_TOKEN`, `NETLIFY_SITE_ID`, `URL`, `CONTEXT`, `DEPLOY_PRIME_URL`.

**`VITE_`-prefixed (public, inlined into the client bundle):** `VITE_GA_MEASUREMENT_ID`, `VITE_STRIPE_ENABLED`, `VITE_STRIPE_PUBLISHABLE_KEY` (publishable — fine), `VITE_KHAN_PAYMENT_WALLET`, `VITE_USDC_MINT`, `VITE_USDT_MINT`, `VITE_SOLANA_PUBLIC_RPC_URL`, `VITE_ETHERSCAN_API_KEY` / `VITE_BSCSCAN_API_KEY` / `VITE_BASESCAN_API_KEY` / `VITE_POLYGONSCAN_API_KEY`.

**Findings:**

- **No secret is currently exposed.** Payment wallet and mint addresses are public by nature; the Stripe key is the publishable one.
- **Block-explorer API keys are shipped to the browser** (`VITE_*SCAN_API_KEY`). Free-tier keys, low severity — but they are credentials, they are rate-limited per key, and any visitor can lift and burn them. Flagging, not fixing (out of scope).
- **`verify-solana-payment.mjs` reads `process.env.VITE_SOLANA_RPC_URL`** (line 15) — a variable `.env.example` explicitly declares dead (*"that variable is no longer read by any code"* — which is now false). If it is unset in Netlify, the live payment verifier silently falls back to the public `api.mainnet-beta.solana.com` endpoint, which is heavily rate-limited. **On the payment path.** This is a latent production defect worth confirming (Q4).

### 22. Tests

`node --experimental-test-module-mocks --test` (node:test, no framework). 59 files, **816 tests, all passing, ~5.7 s**. Coverage is genuinely good on the load-bearing logic: scoring, trust score, payment verification (`verifySolanaPayment.test.mjs`), routes, feature gate, entitlements, watchtower, lifecycle, referral, growth.

**No CI.** No `.github/` directory. Nothing runs these on push. The three `verify-*` guard scripts run in `npm run build`, so Netlify's build catches boundary/i18n/function-purity violations — but **not** test failures.

### 23. Error tracking and logging

None. No Sentry, no Datadog, no LogRocket. `console.warn` / `console.error` into Netlify function logs, that's it. For a payment path where §Security requires *"Log every payment verification decision with enough detail to reconstruct disputes"*, the existing `debug` object in `verify-solana-payment.mjs` is the right pattern to copy — it records RPC attempts, detected vs expected wallet, amounts, price source, and a `finalDecision`. But it is **returned to the caller and not persisted**. Phase 2 needs an audit log that survives.

---

## F. Required findings

### 24. Fabricated data returned as real — HIGHEST PRIORITY

I searched the whole tree. **The good news first: the scanner does not fabricate.** This codebase already holds the line the spec demands, in several places, explicitly:

- `_volatileSignals.mjs` enforces a three-state contract — `{ok:true, value}` / `{ok:true, empty}` / `{ok:false, reason}` — with the rule *"A FAILED FETCH IS NOT AN OBSERVATION."* Both providers are **required**; a partial fetch returns `{ok:false, reason:'incomplete', failures:[...]}` and no snapshot is written.
- `_rescanEngine.mjs`: *"A partial fetch is not a cheap observation, it is a false one"* — pinned by `tests/trustScore.test.mjs`, which proves an outage alone moves a healthy token 91→72, past the alert threshold.
- `main.jsx handleTokenCheck` catch block: *"Never fabricate a report… We never estimate, mock, or demo a Trust Score when live data is unavailable."* Falls back only to a cached **real** scan (`existing.realData && !existing.realData.isDemo`), otherwise returns the honest `checkToken.liveUnavailable` error.
- `src/lib/storage.js`, `src/tokenCorpus.js`, `src/scoreHistory.js` all filter out `realData.isDemo` records so demo data can never reach the corpus, the SEO pages, or the score history.
- Unknown scoring signals return `null`, never `0`.
- Sui/Aptos holder and security metrics are marked *not supported* rather than estimated.

**Now the finding. There is exactly one real violation, and it is significant:**

**`netlify/functions/_discoveryProviders.mjs` ships ~18 invented crypto projects to production as auto-discovered real ones.**

```js
const REAL_ENABLED = String(process.env.EARLY_STAGE_DISCOVERY_REAL || '') === '1';
...
export function getProviders() {
  if (!REAL_ENABLED) return MOCK_PROVIDERS.filter((p) => p.enabled);   // ← default
  return REAL_PROVIDERS.filter((p) => p.enabled);
}
```

The flag is **not** in `.env.example`, so unless it was set directly in the Netlify UI, the default path is live. The fabricated records include invented names, tickers, descriptions, websites, X handles, community sizes, and **fake contract addresses** (`0xLUMEN00000000000000000000000000000000abcd`, `AURP1111111111111111111111111111111111pump`). They are written into the discovery cache by the `early-stage-discover-run` scheduled job every 2 hours and served by `early-stage-list` merged with real community submissions, badged *"Auto Discovered"* and *"Source: DexScreener"* — attributing invented data to a named third party.

The module's own comment frames this as a feature (*"fully functional end-to-end with zero paid plans or API keys"*), which is a reasonable dev-fixture argument and an indefensible production one. On a trust product, this is the worst bug in the repo.

**Second instance, lower severity:** `src/earlyStage.js` `DISCOVERY_MOCK_SEED` mirrors the same 8 projects client-side. It is documented as a dev-only fallback for `vite dev` with no Functions — but it is **compiled into the production bundle** and renders whenever the `early-stage-list` call fails. So a transient function error shows invented projects to a real visitor.

**Third, borderline:** `_curatedProjects.mjs` `CURATED_PROJECTS` hardcodes KHAN Trust itself into the Early Stage list, shown `verified: true` and `featured: true`, never submitted or discovered. The data is *true*, but self-verifying your own project through a first-party bypass of the verification flow is precisely the conflict of interest §1.3 exists to address.

**Fourth, not fabrication but the same family:** `verify-badge.mjs` renders a gold *"KHAN Trust: Rated"* badge for **any** `projectId`, including one that was never scored. It's careful not to say "Verified" — but an embeddable badge asserting a project is "Rated" when nothing rated it is a claim the system can't back. Phase 3 §3.2 makes this concrete: a badge must resolve to a live, checkable profile.

### 25. Where this spec conflicts with the codebase

| # | Spec says | Reality | Impact |
|---|---|---|---|
| 1 | Premium billed by "existing subscription system", verification is a *new* on-chain path | Premium is **already** billed on-chain (Solana, USDC/USDT/SOL) with server-side verification, mint allow-listing and signature-replay protection. Stripe exists but is **off**. | Reuse `verify-solana-payment`'s verified machinery. Building a second payment verifier from scratch is duplicated risk on the money path. |
| 2 | `user_entitlements` table with `kind`/`ref_id` | An entitlement layer already exists — Blobs-based, subject-keyed, with a three-source resolver (`_premiumAccess.mjs`) and a client/server feature registry (`src/lib/features.js`). | Do **not** add a parallel table. Extend the existing store with a `verification_owner` subject kind, or the 3-month bonus grant will bypass `resolveVerifiedPremiumAccess` and be invisible to every gate. |
| 3 | Concurrency "enforced by a DB constraint" | Postgres is an **optional, best-effort mirror** that silently no-ops without `DATABASE_URL`. Blobs (the real store) has no constraints, no transactions, no compare-and-swap. | Genuine architectural gap. See §26. |
| 4 | Two products, $9 and $149/$399 | **Three** products: Premium $9/mo, KHAN Founding Member $99 one-time lifetime, plus verification. | The `/pricing` restructure must not erase Founding Member. |
| 5 | Ownership verification pseudocode in **Python** | Codebase is JavaScript/`.mjs` throughout. | Cosmetic; noting it because §2.4 and §5.1 ("Pillow") both assume Python. Proof images need a JS path (SVG → PNG, or a rendering service). |
| 6 | `/t/{chain}/{contract}` profile pages | An equivalent SEO surface exists at **`/token/{contract}`**, with an edge router, OG/JSON-LD meta, a sitemap, and shared links already in the wild. | Adding `/t/*` creates two canonical URLs for the same token — duplicate content, split ranking, exactly the SEO harm Phase 4 aims to avoid. **Extend `/token/*`; add the chain segment as an optional path.** Any existing shared link is a promise (`src/lib/routes.js` states this as policy). |
| 7 | Badge is a `<script>` + Shadow DOM widget | A badge already exists as an **SVG** at `/badge/:projectId`, and `netlify.toml` explicitly reasons that framing headers are safe *because the badge is an `<img>`/SVG, not an iframe*. | Not a blocker — Phase 3's `badge.js` is additive and Shadow DOM is unaffected by `frame-ancestors`. But the existing SVG surface must keep working; embeds may already be live. |
| 8 | "Seed ~200 well-known tokens, mark `seeded = true`" (§1.5) | The corpus is written **only** from real completed scans, and `seeded` doesn't exist. §4.3 then requires seeded rows be excluded from the sitemap. | Writing 200 rows into the corpus in the same shape as real scans, then relying on a flag to keep them out of the SEO surface, reintroduces the §24 problem by another door. Recommend seeding via **genuine scans** of 200 real tokens (real data, real scores, no flag needed) — same visible outcome, no fabrication. |
| 9 | PDF delivered by email on activation (§2.6) | PDF generation is **client-side jsPDF**, browser-coupled. | Needs a server-side PDF path. Unbudgeted work. |
| 10 | Telegram approve/skip buttons (§5.1) | Send-only helper; **no bot webhook host**, enrollment parked unshipped on a branch. | Phase 5 needs a webhook receiver, or approvals happen elsewhere. |
| 11 | "Premium frozen; bug fixes only" | `verify-solana-payment.mjs` reads a variable documented as dead (§21). | If confirmed live, this is a Premium payment-path bug that qualifies under "bug fixes only". |
| 12 | Score floor: don't sell below 40 (§2.5) | Which of the **two incomparable scores** (§12)? Lane 1 (browser, 18 providers) and Lane 2 (server, 2 providers) disagree by up to ~40 points on the same token. | A token showing 62 on the site could quote 38 server-side and be refused a sale — or the reverse, which is worse. **This must be decided before Phase 2 begins.** |

### 26. Recommended replacements for the three broken designs

**Broken design 1 — payment poller.** Recommend **A + C, as the spec suggests**, and note this repo already runs the exact topology:

- **A. Helius webhook** on the verification treasury → a new authenticated Netlify Function. Helius is already a known quantity here (`HELIUS_API_KEY` is wired for the holder indexer), so an account likely exists and enhanced webhooks are on the free/developer tier. The handler must be idempotent on `tx_signature` — `_entitlementsStore.mjs` already has `isSignatureUsed` / `markSignatureUsed`, which is the exact primitive, and its rationale comment explains why.
- **C. Scheduled sweeper** every minute over `pending` orders. `alerts-run` and `watch-rescan-cron` are working precedents; the 30 s scheduled cap is ample for a handful of pending orders.
- **B. Client `check-payment`** for UI responsiveness only, never authoritative — which is precisely how `verify-solana-payment` is already called today.

Cost: Helius free tier covers this volume. Netlify scheduled functions are on all plans (confirmed against live docs).

**Broken design 2 — Jinja2 server-rendered pages.** Not applicable and already solved: `token-page.mjs` + `token-router.js` do this today. **Recommend extending the existing surface rather than adding `/t/*`** (see conflict #6). One caveat to verify: the current edge router serves SPA HTML to *human* UAs, so a human with JS disabled gets an empty page. §4.1's test ("must render with JS disabled") **fails today** — fixing it means serving the server-rendered HTML to everyone, or making the SPA shell contain the content. Worth doing; note it changes behaviour for human visitors.

**Broken design 3 — synchronous scans.** Mostly a non-issue: the full scan already runs in the **browser**, not a function. The real problem is the inverse — `/verify/quote` needs a *server-side* score and only the narrower Lane 2 can produce one (conflict #12). Options, in order of preference:

1. **Quote from Lane 2 and be explicit about it** — label the quote score as a preliminary eligibility check, distinct from the public Trust Score. Honest, cheap, and preserves lane separation. Requires the score floor to be defined against Lane 2.
2. **Build a server-side Lane 1** — port the full 18-provider fan-out into a background function, return 202, poll for the result. Correct and expensive; roughly doubles Phase 2.
3. **Quote from the corpus** — use the last real client-lane scan if one exists, else require the customer to run a free scan first. Zero new scoring code, uses genuinely comparable numbers, but adds a step and only works for already-scanned tokens.

**My recommendation: option 3 with option 1 as fallback.** It reuses the number the customer already sees, avoids the two-baseline trap entirely, and turns the free scanner into the top of the verification funnel — which is the synergy §1B is reaching for anyway.

**On concurrency (conflict #3).** Since Blobs has no constraints and Postgres is best-effort, neither can enforce "first paid wins" alone. Recommend:

- Make Postgres **authoritative for verification orders only** — a `UNIQUE INDEX ... WHERE status='active'` on `(chain, contract)` is exactly the constraint §2.5 requires, and it is the only place in this stack that can provide one. This is a deliberate, scoped exception to the "Blobs is truth" rule, and it needs `DATABASE_URL` to become **required** for the verification path (fail loudly, unlike everything else here).
- Or keep Blobs and serialize on the **`tx_signature` uniqueness** already implemented — weaker (it prevents double-*activation* from one payment, not two payments for one contract), but zero new infrastructure.

I'd take the Postgres option, and I want your decision before writing any of it (Q2/Q5).

### 27. Revised phase estimate

The spec's estimates assume greenfield. Adjusted for what exists:

| Phase | Spec | Revised | Why |
|---|---|---|---|
| 0 | 1–2 h | done | |
| 1 | 3 h | **5–7 h** | Copy changes must land in **4 locales** and pass `verify-i18n`. The mock-discovery removal (§24) is the real work and touches a scheduled job, a cache, and a client fallback. The trust-hygiene half is largely already done. |
| 2 | 1.5 days | **3–4 days** | The score-lane decision (#12), Postgres-authoritative orders (#3), extending rather than duplicating the entitlement layer (#2) and the existing verification store (§13), server-side PDF (#9), plus the `/verify` sales page and payment UI which genuinely don't exist. |
| 3 | 0.5 day | **0.5–1 day** | Close to accurate. Existing `/badge/*` SVG must keep working alongside the new widget. |
| 4 | 1 day | **0.5–1 day** | Most of it exists. Cost is the JS-disabled fix, the quality gate, sitemap sharding, and the chain segment — **minus** whatever the `/t/*`-vs-`/token/*` decision costs. |
| 5 | 0.5 day | **1–1.5 days** | Needs a Telegram webhook receiver that doesn't exist, and a JS proof-image path (no Pillow). |

**Total: ~6–8 days**, vs the spec's ~4. The increase is almost entirely integration with existing systems — which is also why the result will be far more robust than a parallel build.

### 28. Questions I need answered before Phase 1

Blocking:

1. **Netlify plan?** Background functions are Pro-only (verified against live docs today); sync timeout is 10 s on Free, 26 s on Pro. This repo already deploys two `-background` functions — if the account is on Free, `watch-rescan-background` and `growth-analyze-background` may be failing silently in production right now. Please confirm the plan and whether deploy previews are enabled.
2. **Postgres provider and connection string** — Supabase / Neon / other, and is the production `DATABASE_URL` a **pooled** endpoint? This decides whether Phase 2 can put orders in Postgres (my recommendation for the concurrency constraint).
3. **Is there a Helius account, and on what tier?** Decides whether the recommended webhook design is free.
4. **Is `VITE_SOLANA_RPC_URL` set in the Netlify environment?** If not, live Premium payment verification is running on the public rate-limited endpoint (§21). Confirm and I'll fix it in Phase 1 as a payment-path bug.
5. **The score-lane decision (conflict #12).** Which score does `preview_score` and the `VERIFY_MIN_SCORE=40` floor refer to? My recommendation is option 3 above — quote from the last real client-lane scan, require a free scan first if none exists.

Non-blocking but needed before Phase 2 ships:

6. **`/t/{chain}/{contract}` vs the existing `/token/{contract}`.** I strongly recommend extending the existing surface. Confirm?
7. **Is `EARLY_STAGE_DISCOVERY_REAL` set to `1` in production?** Determines whether §24's finding is live right now or already mitigated. Either way I recommend deleting the mock providers rather than relying on a flag.
8. **Separate treasury wallet for verification?** Recommended, for reconciliation and webhook filtering.
9. **Approximate active Premium subscriber count** — it's in production Blobs and I can't read it. Needed to size the §1B regression risk.
10. **The KHAN token surface (§1.3).** Removing tokenomics/holder-benefit sections means deleting the `#/khan` ecosystem page, the sidebar promo, and a `nav.khan` entry across 4 locales. Confirm that's the intent, or whether the page stays and only the *product* surfaces are cleaned.

---

**Stopping here as instructed.** No code written, nothing committed, nothing pushed. Working tree contains only this file.
