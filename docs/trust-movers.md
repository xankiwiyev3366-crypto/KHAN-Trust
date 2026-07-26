# Trust Movers

Trust Movers is KHAN Trust's longitudinal-intelligence product: it surfaces the
projects whose **Trust Score moved the most** over a chosen window, split into
four sections, each mover carrying a **grounded explanation** of *why* its score
changed. It is built entirely on the PostgreSQL score-history series shipped in
Phase 1/2 — it invents nothing.

---

## 1. Architecture

Trust Movers is three layers, matching the platform's existing split (pure core
in `src/lib`, a Netlify Function data layer, a thin HTTP endpoint) plus a
lazy-loaded dashboard.

| Layer | File | Responsibility |
|---|---|---|
| Pure core | [`src/lib/trustMovers.js`](../src/lib/trustMovers.js) | Movement math, classification into the 4 sections, deterministic ranking, **grounded** explanations. No DB/fetch/React — unit-tested in isolation. |
| Data layer | [`netlify/functions/_trustMoversStore.mjs`](../netlify/functions/_trustMoversStore.mjs) | The PostgreSQL query, chain/verified filters, the TTL cache, and honest insufficient-data handling. |
| Endpoint | [`netlify/functions/trust-movers.mjs`](../netlify/functions/trust-movers.mjs) | Public `GET` API: parameter validation + response shaping. |
| UI | [`src/TrustMovers.jsx`](../src/TrustMovers.jsx) | Premium dashboard, lazy-mounted from `main.jsx` (`/trust-movers`). Presentation only. |

**Data source.** The single source is the PostgreSQL `score_history` table — the
daily Trust Score series the Phase 1 schema was explicitly built to power ("THE
Trust Movers source"). Reads go through `_db.readRows` (bounded, never
throws/hangs). Trust Movers reuses `mapScoreHistoryRow` from `_pgReads.mjs`, so
the snapshots it diffs are byte-identical in shape to the live ones, and it
reuses `diffSnapshots` from `src/lib/snapshotDiff.js` — the same change detector
the risk timeline and alert lane use — so explanations can never drift from the
rest of the platform.

**Why explanations are not an LLM call.** Every reason is derived from a real,
measured component delta (liquidity, holder concentration, contract security,
social, market activity). This is deterministic, free, instant, cacheable, and
impossible to hallucinate — which is exactly what "grounded in actual score
component changes, not generic AI text" requires.

---

## 2. PostgreSQL query

For a window of `N` days and an optional chain-alias array, the query takes two
`DISTINCT ON (token_key)` passes over `score_history` and joins them per token:

- **current** — the latest snapshot within the last `N` days (so only recently
  observed tokens are considered movers).
- **previous** — the latest snapshot at or before `today − N` (the score at the
  start of the window). A `LEFT JOIN` keeps tokens that have a current point but
  no earlier one; their `previous` is `NULL` — the honest "no history before the
  window" state, never a fabricated baseline.

```sql
WITH current_snap AS (
  SELECT DISTINCT ON (sh.token_key)
    sh.token_key, to_char(sh.observed_date,'YYYY-MM-DD') AS date,
    sh.score, sh.risk_level, sh.confidence, sh.top_holder_percent,
    sh.liquidity_usd, sh.social_score, sh.asset_category, sh.categories, sh.created_at
  FROM score_history sh
  WHERE sh.observed_date >= CURRENT_DATE - $1::int
  ORDER BY sh.token_key, sh.observed_date DESC
),
previous_snap AS (
  SELECT DISTINCT ON (sh.token_key)
    sh.token_key, to_char(sh.observed_date,'YYYY-MM-DD') AS date,
    sh.score, sh.risk_level, sh.confidence, sh.top_holder_percent,
    sh.liquidity_usd, sh.social_score, sh.asset_category, sh.categories
  FROM score_history sh
  WHERE sh.observed_date <= CURRENT_DATE - $1::int
  ORDER BY sh.token_key, sh.observed_date DESC
)
SELECT c.token_key AS identity, t.contract, t.chain, t.name, t.ticker,
       c.* , p.*  -- aliased c_*/p_* in the real statement
FROM current_snap c
LEFT JOIN previous_snap p ON p.token_key = c.token_key
LEFT JOIN tokens t ON t.identity = c.token_key
WHERE ($2::text[] IS NULL OR lower(coalesce(t.chain,'')) = ANY($2));
```

- `$1` = window length in days (`24H`→1, `7D`→7, `30D`→30, `90D`→90).
- `$2` = chain-alias array (e.g. `bsc` → `{bsc,bnb,'bnb chain',binance,'binance smart chain'}`), or `NULL` for all chains. Fully parameterised — no interpolation of caller input.
- `observed_date` is cast with `to_char(...,'YYYY-MM-DD')` so node-pg's local-midnight `DATE` parsing can never shift a point onto the wrong day.

### Indexes

`Trust Movers rides existing indexes — no new index is required:`

- **`score_history` PRIMARY KEY `(token_key, observed_date)`** — a btree that
  serves both `DISTINCT ON (token_key) … ORDER BY token_key, observed_date DESC`
  passes as ordered index scans (one row per token), not full sorts.
- **`idx_score_hist_date` on `score_history (observed_date DESC)`** — bounds the
  `current` pass to the recent window cheaply.
- **`idx_tokens_chain` on `tokens (chain)`** — supports the chain filter join.

---

## 3. Calculation logic

For every token with a `current` snapshot (`src/lib/trustMovers.js`):

| Field | Definition |
|---|---|
| `currentScore` | `current.score` |
| `previousScore` | `previous.score`, or `null` when there is no prior snapshot |
| `absoluteChange` | `round(currentScore − previousScore)`, or `null` |
| `percentChange` | `round(((cur − prev) / prev) × 100, 1dp)`; `null` when `prev ≤ 0` |
| `trend` | `up` / `down` / `flat` from the sign; `new` when there is no baseline |
| `riskLevel` | stored level, or derived from the score via `scoreToRisk` when null |
| `lastUpdated` | the current snapshot's `created_at` (ISO), else its date |
| `reasons` | grounded explanation (below) |

**Sections & thresholds**

- **Rising Trust** — `absoluteChange ≥ +1`, ranked by movement magnitude.
- **Falling Trust** — `absoluteChange ≤ −1`, most negative first.
- **New High Confidence** — `score ≥ 78` (Low band) **and** `confidence ≥ 70`
  now, and *not* high-confidence at the window start (or brand new).
- **Newly High Risk** — `High` now (stored or `scoreToRisk`-derived), and *not*
  High at the window start (or brand new).

A token may appear in more than one section (e.g. a large drop that also crosses
into High risk).

**Ranking (deterministic, cache/test-stable).** Primary: magnitude of
`absoluteChange`. Ties → magnitude of `percentChange` → most-recent `lastUpdated`
→ `identity`. The "new" sections rank by current score then recency then
identity.

**Grounded explanation.** `explainMovement(previous, current)` runs
`diffSnapshots` and maps each structured change to a short phrase, strongest
first (liquidity normalised by its percent swing so it is comparable to
point-scale deltas), capped at 3:

| Component change | Reason |
|---|---|
| liquidity ↑ / ↓ | Liquidity increased / decreased |
| holder concentration ↓ / ↑ | Holder concentration improved / Large holder accumulation detected |
| contract security ↑ / ↓ | Contract risk decreased / increased |
| social ↑ / ↓ | Social verification improved / weakened |
| market activity ↓ | Trading activity became suspicious |

If no component crossed its threshold but the score moved, the fallback is the
literal delta (`Trust Score rose/fell N pts`) — itself a fact. No previous
snapshot → **no reasons** (history is never invented).

---

## 4. API

`GET /.netlify/functions/trust-movers` — **public**, aggregate, non-sensitive
(same posture as `token-corpus-list`). Stable JSON contract, suitable for a
future mobile app or public API.

### Query parameters (all optional)

| Param | Values | Default |
|---|---|---|
| `period` | `24H` `7D` `30D` `90D` | `7D` |
| `chain` | `all` `solana` `ethereum` `base` `bsc` `arbitrum` `optimism` `polygon` `avalanche` `sui` `aptos` | `all` |
| `audience` | `all` `verified` `premium` | `all` |
| `section` | `rising` `falling` `newHighConfidence` `newlyHighRisk` | *(all four)* |
| `limit` | `1`–`50` per section | `20` |

`verified`/`premium` are **fail-closed**: a mover survives only when it can be
positively matched to a `verified` entry in the verification store (by project
id / contract / identity). An empty verification store yields an empty result —
honest, not an error. (Token-level *premium* tagging does not exist yet, so
`premium` currently uses the same verified set.)

### Response

```json
{
  "period": "7D",
  "chain": "all",
  "audience": "all",
  "generatedAt": "2026-07-27T12:00:00.000Z",
  "cached": false,
  "insufficientData": false,
  "sections": {
    "rising": [
      {
        "identity": "c:ethereum:0xabc…",
        "name": "Example",
        "ticker": "EXM",
        "chain": "ethereum",
        "contract": "0xabc…",
        "currentScore": 82,
        "previousScore": 61,
        "absoluteChange": 21,
        "percentChange": 34.4,
        "trend": "up",
        "riskLevel": "Low",
        "previousRiskLevel": "Medium",
        "confidence": 88,
        "lastUpdated": "2026-07-27T09:00:00.000Z",
        "reasons": ["Liquidity increased", "Holder concentration improved"]
      }
    ],
    "falling": [],
    "newHighConfidence": [],
    "newlyHighRisk": []
  }
}
```

- `insufficientData: true` is returned (with empty sections) when the DB is
  unavailable **or** no rankable movers exist. The UI renders this as
  **"Not enough historical data yet."** — a DB-down result is never cached, so
  the next request retries.
- `cached: true` marks a result served from the TTL cache.

---

## 5. Performance

- **Cache first.** Results are cached in the `khan-trust-movers-cache` Blob store,
  keyed by `period_chain_audience_limit`, TTL **10 minutes**. A burst of requests
  collapses onto one computation; the DB is never scanned per request. Only
  successful computations are cached (never a DB-down result).
- **Bounded, index-served query.** Two `DISTINCT ON` passes over the
  `(token_key, observed_date)` PK, with the current pass bounded to the window —
  one latest + one pre-window row per token, not a full history scan. Scales to
  thousands of projects.
- **Hard read timeout.** `_db.readRows` races a bounded timeout; a sick DB falls
  back to the honest insufficient-data path rather than stalling a page load.

---

## 6. Testing

- [`tests/trustMovers.test.mjs`](../tests/trustMovers.test.mjs) — the pure core:
  sorting, ties (both tie-break levels), missing history, classification of all
  four sections, grounded explanation generation (and the no-history/no-invention
  guarantee), period helpers.
- [`tests/trustMoversStore.test.mjs`](../tests/trustMoversStore.test.mjs) — the
  data layer + endpoint end to end (mocked DB/cache/verification): chain-filter
  parameterisation, empty database, DB-unavailable fallback, ranking through the
  real core, caching (second call served without a DB read), verified fail-closed
  filtering, endpoint validation, and the documented response contract.
