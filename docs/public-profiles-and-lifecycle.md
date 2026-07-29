# Public token profiles, events, and the verification lifecycle

Phases 4 and 5 of the monetization roadmap. Phase 4 gives every supported token a
public, indexable, server-rendered profile. Phase 5 makes everything that happens
around a paid verification durable, observable and idempotent.

Phases 1–3 (fabricated-data purge, paid verification, the badge widget) are
unchanged. Nothing here alters the $9/month Premium product, the verification
payment flow, ownership proof, or the embeddable badge — except where noted in
"The canonical URL moved", which is the one deliberate change to existing
behaviour.

---

## Phase 4 — the public profile

### The URL

```
/t/<chain>/<contract>
```

Served by `netlify/functions/token-profile.mjs` through a `status = 200` rewrite
in `netlify.toml`. Everything about the shape and the metadata lives in the pure
module `src/lib/publicProfile.js`, which both the browser and the functions
import.

### The canonical URL moved, and why

`/token/<contract>` was the canonical page before Phase 4. It now issues a
permanent **301** to `/t/<chain>/<contract>`.

Phase 3 explicitly argued against a `/t/` route, in `_badgeState.mjs`:

> a second URL for the same token splits ranking between two canonical pages and
> competes with itself

That objection is to having **two** canonicals and it is still correct. It is
answered by having **one** — the old URL redirects, which is the shape that
*transfers* accumulated ranking rather than competing with it. Published links
keep working, per the rule `src/lib/routes.js` records: a URL that has been sent
to someone is a promise.

The old shape had to go because it was not merely a different spelling:

1. **The same address is up to seven different tokens.** An `0x…` contract can be
   deployed on Ethereum, Base, BSC, Arbitrum, Optimism, Polygon and Avalanche.
   One URL claimed to be the trust page for all of them.
2. **It could never resolve an EVM token at all.** `token-page.mjs` derived its
   corpus key as `c:<contract>` — the *Solana* identity spelling. EVM tokens are
   stored at `c:<chain>:<contract>`, so the lookup missed 100% of them and every
   EVM `/token/` page served the "not analyzed yet" branch forever. This was a
   live bug, and `tests/profileHandler.test.mjs` locks the fix in.

`profileUrl()` in `_badgeState.mjs` now takes `(chain, contract)` and has **no
default chain** — a badge without one links to the site root rather than sending
a Base token's visitors to a Solana page.

### Rendering

No UA sniffing. Everyone — crawler, human, human with JavaScript disabled —
receives the same server-rendered HTML. The existing `/token/*` edge router
(which does split by User-Agent) is untouched and now only matters for humans
following old links.

A small inline script adds a copy button and re-checks the badge against
`/badge-status`. With it blocked, the page is complete.

### Data sources

`_profileData.mjs` reads three stores **in parallel**, each with a 2.5s timeout
and its own degradation:

| Store | Provides | On failure |
|---|---|---|
| corpus | score, risk, name, ticker, scoring inputs | page renders without a score |
| verification statuses | the badge state | **fails closed** → `unverified` |
| verification orders | tier, term dates, ownership method | those rows omitted |

Nothing is fetched live. No RPC, no price API, no re-scan. The score shown is the
stored client-lane score — the same number the site shows — stamped with when it
was taken.

### HTTP status codes

| Case | Status | Notes |
|---|---|---|
| Token with a score, or a verification record | `200` | indexable if eligible |
| Well-formed address we hold nothing about | `404` | body is still useful; noindex |
| Unsupported chain / malformed contract | `404` | noindex |
| Store outage | `503` + `Retry-After` | no stack trace in the body |

The 404 for unknown-but-valid addresses is the load-bearing one. The `/t/` URL
space is infinite (any 32–44 base58 characters is a syntactically valid Solana
mint). Answering 200 for all of it would offer a crawler an unbounded supply of
interchangeable placeholder pages, and the sitewide quality judgement that
follows lands on the pages that *do* have content.

### Indexing

`isProfileIndexable()` is the single predicate, read by **both** the page's
`robots` meta and the sitemap — a page saying `noindex` while the sitemap begs
Google to index it is the most common self-inflicted SEO fault there is.

A profile is indexable when it has a real score **or** a real verification record
(active, expired or revoked — a lapsed verification is still a genuine, unique
page). Everything else is served, useful, and `noindex`.

Private surfaces carry `X-Robots-Tag` headers in `netlify.toml` **and** a
`Disallow` in `robots.txt`. Both are needed: `Disallow` stops a fetch, only the
header keeps a known URL out of the index. `/.netlify/functions/*` is covered by
one rule, so a *new* payment or admin endpoint is noindex by default rather than
by somebody remembering.

`/og/` is deliberately **not** disallowed — Twitterbot and facebookexternalhit
honour robots.txt when fetching `og:image`.

> **Note on `/app/*`.** The roadmap asks for `/app/*` to be noindex. This SPA has
> no such path — it is hash-routed, so its internal pages are `/#/...` and are not
> separately crawlable. The equivalent real surfaces (`/console`, `/admin.html`,
> `/receipt/*`, `/signup`, `/unsubscribe`, `/badge-status`, every function
> endpoint) are covered instead.

### Social share image

`/og/t/<chain>/<contract>.svg` → `profile-og.mjs`. SVG rather than a rendered
PNG: a headless browser does not fit in a function's bundle or its 10s budget,
and `node-canvas` is a native module the deploy guard exists to keep out.

Three layers of fallback, and **nothing here can return a non-image**:

1. Unknown token → a valid card saying so (never a 404; a 404'd `og:image`
   collapses the whole preview to a bare link).
2. Any internal error → the static brand card, served 200 with a short cache.
3. No logo → a monogram from the symbol. The corpus stores no logo today, so
   this is the normal path; a guessed CDN path would be fabricated data.

---

## Phase 5 — events, queue, receipts, lifecycle

### Product events

- Vocabulary: `src/lib/productEvents.js` (pure, shared client/server). Closed
  set — an unknown name is refused at the door, not stored.
- Store: `netlify/functions/_productEvents.mjs`. One blob key per event under a
  day prefix, mirroring the Growth OS shape, so concurrent writes cannot collide
  and history is unbounded. **Not** `_analyticsStore.mjs` (single capped array,
  lost writes) and **not** the growth warehouse (which measures the public
  funnel and would be skewed by server-authored lifecycle events).
- Client emitter: `src/productEvents.js` → `POST /.netlify/functions/events-track`.

Only a small allowlist is client-emittable. `verification_activated` and every
other revenue event is server-authored — otherwise anyone could set the
platform's reported conversion rate. `badge_impression` is recorded server-side
by `verify-badge-status.mjs`, because the embedding page is by definition not
under our control.

`sanitizeMetadata()` strips a denylist of keys (signatures, wallets, tokens,
emails, admin notes), refuses nested objects, caps values and bounds the key
count. Referrers are truncated to their **origin** — a full referrer routinely
carries a token or an email in its query string.

Dedup keys are derived from *what happened*, not from the clock: order-derived
for state transitions, `(contract, session, day)` for views and impressions.

### The durable outbox

`netlify/functions/_eventQueue.mjs`.

| Concern | Where it lives |
|---|---|
| Job content | Netlify Blobs, one key per job |
| Lease (no two workers on one job) | Postgres `queue_leases`, single atomic upsert |
| Reporting projection | Postgres `queue_jobs` |

States: `pending` → `processing` → `completed` \| `failed` (retry) \|
`dead_letter`. Five attempts, exponential backoff capped at 30 minutes.

Without `DATABASE_URL` the lease degrades to a write-then-reread check, which is
racy in principle. This is survivable because **every handler is idempotent
anyway** — the mail ledger, the write-once receipt, the shared signature ledger,
`grantTimedBonus`'s monotonic rule. The lease prevents wasted work, not
corruption; a lease never can be the last line of defence.

Dead letters are **moved, not deleted**, keeping payload and last error, and an
operator can requeue them from the console. The requeue drops the consumed dedup
key (otherwise the retry would be a silent no-op) and gets a new job id (so the
incident record survives).

Handlers (`_queueHandlers.mjs`): `receipt.ensure`, `mail.send`, `admin.alert`,
`watch.enroll`, `watch.status`. `admin.alert` is deliberately **not**
deduplicated — a duplicate Telegram line is noise, a suppressed one is a missed
refund.

### Receipts

`_verificationReceipts.mjs`. **Write-once and never rewritten**: the order is a
live object whose status moves, but a receipt records what was true at purchase.
`statusAtIssue` is the status at issue; the live status is one link away.

Receipt numbers are a deterministic HMAC of the order id (`KT-<year>-<8 chars>`).
Not a counter (needs a lock Blobs cannot give, and leaks sales volume), not
random (a retry would mint a second number for one purchase).

- `/receipt/<orderId>` → `receipt-page.mjs`, printable, `no-store`, noindex,
  `Referrer-Policy: no-referrer`.
- `GET /.netlify/functions/verify-receipt?orderId=` → JSON, with a `202 pending`
  state so the client polls instead of showing a buyer "not found".

Access requires the buying account, the paying wallet, or an admin. Knowing the
order id is **not** enough — ids are `vo-<epoch-ms>-<8 chars>` and verification
dates are public. Both endpoints answer the same way for "no such order" and
"not yours", so the id space is not an oracle.

### Email

`_verificationEmails.mjs`, over the existing Resend helper. Eleven stages:
payment confirmed, ownership required, activated, ownership failed, expiring
30/7/1, expired, revoked, refunded, renewal reminder.

Idempotent via a per-`(order, stage)` ledger, written **after** the provider
accepts — writing first means an outage silently consumes the customer's one
send. A wallet-only buyer resolves to `no_recipient` (not a failure, so it does
not fill the dead-letter shelf); a missing API key resolves to `not_configured`.

**No unsubscribe header.** These are transactional, unlike
`_lifecycleTemplates.mjs` which is bulk retention mail and needs RFC 8058. A
customer cannot opt out of being told their paid product is about to lapse.

### Telegram

`_verificationAlerts.mjs`. The destination may be a team group — no access
control we administer, indefinite retention, fully searchable — so no message
carries a payment signature, a full wallet, an email, a buyer subject or an admin
note. Wallets are truncated to 4+4. Messages point at the passcode-gated console.

### Scheduled jobs

| Function | Schedule (UTC) | Does |
|---|---|---|
| `queue-worker-cron` | every 5 min (`2,7,…,57 * * * *`) | fires `queue-worker-background` |
| `verification-lifecycle-cron` | `10 7 * * *` | fires `verification-lifecycle-background` |

Both follow the cron→background split this codebase already uses: a scheduled
function is capped at 30s and is not HTTP-routable, so it mints an admin HMAC
token, fires the 15-minute background worker, and returns. A failed trigger still
answers 200 so the platform does not retry-storm.

The lifecycle sweep is safe to run repeatedly: expiry is derived from
`expiresAt`, every notification is enqueued with an `(order, stage)` dedup key,
and `releaseContract` is scoped to the holding order id.

It deliberately does **not** rewrite the verification status record on expiry —
`resolveBadgeState()` already derives `EXPIRED` from the stored timestamp, so the
badge is correct the instant the clock passes, with no dependency on the sweep
having run.

### Premium integration

- Verified owners are auto-enrolled into Watchtower (`watch.enroll`) by
  **adding** to their subscription — `toggleToken()` would have *removed* it on a
  retry.
- Watchers are notified of verification changes (`watch.status`) through a new
  `verification_status` notification type. The positive transition is
  Premium-gated; **a revocation is delivered to everyone**, because withholding
  "this token's verification was withdrawn" to sell an upgrade would monetise the
  exact harm the product prevents.
- The three-month Premium bonus is unchanged and still granted **inline** at
  activation, not on the queue: it is an entitlement the buyer paid for, and the
  response reports it. `grantTimedBonus` is already monotonic and idempotent.

### Admin console

Two new pages at `/console`: **Verification** (orders, verified projects, funnel,
revenue by tier, refund/revoke/receipt actions) and **Jobs & delivery** (queue
counts, live jobs, dead letters, requeue).

Every admin endpoint verifies the HMAC token before its first `await`. Destructive
actions require echoing the order id back as `confirm`. All actions are audited
into the existing analytics event log.

`mark_refunded` **records** a refund; it does not send one. Putting a key that
can move money behind an endpoint guarded by a shared passcode would make that
passcode the only thing between an attacker and the treasury.

---

## Migrations

`db/migrations/0003_events_queue_receipts.sql`, mirrored to
`netlify/database/migrations/`.

### Why the same files live in two directories

This project is on **Netlify Managed Database**, which never exposes a
production connection string to a developer's machine. `DATABASE_URL` is a
*secret* environment variable: `netlify env:get` returns only its last four
characters (`****************uire`), there is no reveal in the UI, and
`netlify dev:exec` injects that same mask. `netlify database connect` targets a
local PGlite instance on an ephemeral port, not production.

That is deliberate, not a gap. Netlify's documented model is that **the deploy
applies migrations**, inside its own runtime where the real credential lives:

> On deploy, Netlify applies migrations automatically as part of the deploy
> lifecycle.

Migrations are applied **immediately before a deploy is published**, and a
failing migration **blocks the publish**. Deploy previews get the same treatment
against a branch database.

So `netlify/database/migrations/` is the path to production, and `db/migrations/`
remains the source of truth for the manual runner. Both directories hold
byte-identical files, enforced at build time by
`scripts/verify-migrations.mjs` — two hand-maintained copies of the same schema
is the most reliable way to end up with two different schemas, and this codebase
already guards the same class of problem for route aliases, badge state and i18n.

**To change a migration:** edit it in `db/migrations/`, then

```bash
npm run sync:migrations
```

The build fails if the two ever diverge.

### Applying

- **Production** — push. Netlify applies pending migrations before publishing.
- **Locally** — `netlify dev` in one terminal, then `netlify database migrations apply`
  (Netlify's own engine, local database only).
- **Any database you hold a connection string for** — `node scripts/db-migrate.mjs`,
  which keeps its own `schema_migrations` ledger, independent of Netlify's.

### Did it actually land?

A deploy can only migrate the database *Netlify* manages. If `DATABASE_URL`
points somewhere else, the deploy reports success and the app's database stays
empty — a silent no-op that looks exactly like a success.

**Console → Jobs & delivery** answers this from inside the function runtime,
using the same `DATABASE_URL` the app uses: it reports the host, the database
name, whether the Phase 5 tables are present, and whether the queue lease is
enforced by Postgres or has degraded to the Blobs check. Compare the host it
shows against the one on the Netlify Database page. Credentials are never read
or reported.

Adds `product_events`, `queue_jobs`, `queue_leases`, `verification_receipts`, and
`badge_token` / `refunded_at` columns on `verification_orders`. Uniqueness on
transaction signatures, badge tokens, receipt numbers and both idempotency keys.

Everything except `queue_leases` is a reporting projection and degrades to
Blobs-only without `DATABASE_URL`, exactly like every other mirror in this
codebase.

---

## Environment variables

All optional; see `.env.example` for the full notes.

| Variable | Adds |
|---|---|
| `KHAN_ADMIN_TELEGRAM_CHAT_ID` | operator alerts (needs `TELEGRAM_BOT_TOKEN`) |
| `RECEIPT_NUMBER_SALT` | a deployment-specific receipt number series |
| `DATABASE_URL` | the queue lease + fast funnel reads (already documented) |

`RESEND_API_KEY` (existing) enables lifecycle email. Without it, sends resolve to
`not_configured` and nothing else changes.
