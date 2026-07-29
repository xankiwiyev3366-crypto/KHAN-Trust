// THE ONE PLACE THAT DECIDES WHAT A BADGE IS ALLOWED TO CLAIM.
//
// Phase 3 gives the badge three transports — an SVG at /badge/<id>, a JSON
// endpoint the JavaScript widget calls, and the widget's own rendering. Three
// transports is exactly the shape in which a fourth state quietly appears in
// one of them and not the others, or an expiry rule gets applied to the SVG and
// forgotten in the JSON. So the decision lives here, once, and all three read it.
//
// This is the same lesson src/lib/routes.js records about the half-implemented
// route aliases: two halves that must agree, sharing no code, cannot be made to
// agree by care alone.
//
// EVERY STATE IS DERIVED FROM SERVER-HELD DATA. Nothing a caller sends can
// produce a state. The embed carries a contract address and nothing else — no
// status, no score, no expiry, no signature. That is the whole security model
// of an embeddable badge: if the page it is embedded on could influence what it
// says, it would say whatever that page wanted, and every badge on the internet
// would be worthless.
import { isVerificationActive } from '../../src/lib/verificationTiers.js';
import { profileUrlFor } from '../../src/lib/publicProfile.js';

// The five truthful states, and nothing else.
//
// NOTE ON "RATED", WHICH IS NOT HERE. The SVG endpoint used to answer any
// unknown id with a gold "Rated" badge — a claim it could not substantiate,
// since this data is the VERIFICATION store and knows nothing about scoring.
// Phase 1 deleted it. It is not coming back through the widget.
export const BADGE_STATES = {
  VERIFIED: 'verified',
  UNVERIFIED: 'unverified',
  PENDING: 'pending',
  EXPIRED: 'expired',
  REVOKED: 'revoked',
};

const ALL_STATES = new Set(Object.values(BADGE_STATES));

export function isBadgeState(value) {
  return ALL_STATES.has(value);
}

// Shared by BOTH badge transports so the SVG and the JSON cannot cache
// differently — a widget reporting "revoked" beside an <img> still rendering
// green would be worse than either being slow.
//
// A BADGE THAT OUTLIVES ITS REVOCATION IS THE FAILURE THIS BOUNDS. The value
// was max-age=300, s-maxage=600 — up to ten minutes in which a revoked
// project's site kept showing a green KHAN Trust badge, on a page we do not
// control and cannot purge. Two minutes is the trade: still cheap enough that a
// busy embed is not re-invoking a function per view, short enough that a
// withdrawal takes effect while the admin who performed it is still watching.
//
// stale-while-revalidate is deliberately NOT used. It exists to keep serving a
// known-stale answer while a fresh one is fetched, which for an assertion about
// trust is the wrong preference: this is the one case where a slower correct
// answer beats an instant outdated one.
export const BADGE_CACHE_CONTROL = 'public, max-age=120, s-maxage=120';

// ── Chain and contract validation ───────────────────────────────────────────
//
// Mirrors the families in src/chains/registry.js. A contract that does not match
// its chain's shape is rejected BEFORE any store lookup — partly so a malformed
// address cannot become a cache key, and mostly because an address we cannot
// parse is one we certainly have not verified.
const EVM_CHAINS = new Set(['ethereum', 'base', 'bsc', 'arbitrum', 'optimism', 'polygon', 'avalanche']);
const CONTRACT_PATTERNS = {
  solana: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  evm: /^0x[0-9a-fA-F]{40}$/,
  // Sui and Aptos use 0x-prefixed 64-hex object/account ids. They are in the
  // chain registry, so a badge request for one is a legitimate question rather
  // than an attack, and it gets a truthful "unverified" instead of an error.
  sui: /^0x[0-9a-fA-F]{1,64}(::[A-Za-z0-9_]+){0,2}$/,
  aptos: /^0x[0-9a-fA-F]{1,64}(::[A-Za-z0-9_]+){0,2}$/,
};

export function chainFamily(chain) {
  const id = String(chain || '').trim().toLowerCase();
  if (id === 'solana') return 'solana';
  if (EVM_CHAINS.has(id)) return 'evm';
  if (id === 'sui' || id === 'aptos') return id;
  return '';
}

export function isSupportedChain(chain) {
  return chainFamily(chain) !== '';
}

// Returns { ok, chain, contract, reason }. `contract` is returned in its
// ORIGINAL casing, never lowercased: Solana base58 is case-sensitive and
// folding it would address a different mint. Case-insensitivity for EVM is
// handled where it belongs — in contractKey() on the orders side — rather than
// by mutating what the caller asked about.
export function parseBadgeTarget({ contract, chain = 'solana' } = {}) {
  const rawChain = String(chain || 'solana').trim().toLowerCase();
  const rawContract = String(contract || '').trim();

  if (!rawContract) return { ok: false, reason: 'missing_contract' };
  // Hard length ceiling before any regex, so a megabyte of input cannot be
  // pushed through a pattern matcher.
  if (rawContract.length > 128) return { ok: false, reason: 'invalid_contract' };

  const family = chainFamily(rawChain);
  if (!family) return { ok: false, reason: 'unsupported_chain', chain: rawChain };

  const pattern = family === 'evm' ? CONTRACT_PATTERNS.evm : CONTRACT_PATTERNS[family];
  if (!pattern.test(rawContract)) return { ok: false, reason: 'invalid_contract', chain: rawChain };

  return { ok: true, chain: rawChain, contract: rawContract };
}

// ── State resolution ────────────────────────────────────────────────────────
//
// `record` is an entry from the verification statuses map. Absent means the
// project has never been through verification, which is `unverified` — the
// correct default and the one every failure path falls back to.
export function resolveBadgeState(record, now = Date.now()) {
  if (!record || typeof record !== 'object') return BADGE_STATES.UNVERIFIED;

  // REVOCATION OUTRANKS EVERYTHING, including an unexpired term. An admin
  // withdrawing a badge must not be overridden by the clock, by a paid order,
  // or by a stale `status` field that revocation forgot to rewrite.
  if (record.revokedAt || record.status === 'revoked') return BADGE_STATES.REVOKED;

  if (record.status === 'pending') return BADGE_STATES.PENDING;

  if (record.status === 'verified') {
    // isVerificationActive() also treats a record with NO expiresAt as
    // permanent, which is what every admin approval predating paid
    // verification looks like. Expiring those would revoke, in one deploy,
    // every badge the platform has ever granted.
    return isVerificationActive(record, now) ? BADGE_STATES.VERIFIED : BADGE_STATES.EXPIRED;
  }

  // 'rejected' lands here deliberately, and reports UNVERIFIED rather than a
  // state of its own.
  //
  // A rejection is a private review outcome. This badge renders on the
  // project's OWN website, and a KHAN Trust badge announcing "Rejected" to
  // their visitors would be a punishment we never agreed to administer — while
  // also telling every competitor the result of a confidential review. "Not
  // verified" is completely true and is all the public is owed.
  //
  // Pending is different, and IS shown: the owner embedded it themselves while
  // waiting, so it is their own information being displayed by their own choice.
  return BADGE_STATES.UNVERIFIED;
}

// ── The canonical profile link ──────────────────────────────────────────────
//
// /t/<chain>/<contract> — see src/lib/publicProfile.js for the full reasoning.
//
// THIS REVERSES WHAT PHASE 3 WROTE HERE, AND THE OLD ARGUMENT IS STILL RIGHT.
//
// It said: do not point badges at /t/<chain>/<contract>, because "a second URL
// for the same token splits ranking between two canonical pages and competes
// with itself" — and every embed is a backlink, so backlinks pointing at a
// duplicate are worth less than none.
//
// That objection is to having TWO canonicals. It is answered by having ONE:
// token-page.mjs now issues a permanent 301 from /token/<contract> to the URL
// below, which is the redirect shape that TRANSFERS accumulated ranking rather
// than competing with it. Existing embeds in the wild keep working and their
// link equity follows them here.
//
// What forced the change is that /token/<contract> is not merely a different
// spelling, it is wrong: the same 0x address exists on seven EVM chains, so one
// URL claimed to be the trust page for up to seven different tokens — and the
// corpus lookup behind it derived a Solana-shaped identity, so it could never
// resolve an EVM token at all.
export function siteOrigin() {
  return String(process.env.URL || 'https://khantrust.net').replace(/\/+$/, '');
}

// CHAIN IS REQUIRED. It has no default — not even 'solana', which was the old
// implicit one. A badge that guessed the chain would link a Base token's badge
// to a Solana profile page for the same address, which is the precise failure
// this URL shape exists to prevent. A caller without a chain gets the site root,
// which is honest, rather than a confidently wrong deep link.
export function profileUrl(chain, contract) {
  return profileUrlFor(siteOrigin(), chain, contract) || `${siteOrigin()}/`;
}

// The status map is keyed by projectId, and paid verification writes
// `order.projectId || order.contractKey` (see verify-order-activate.mjs), where
// contractKey is "<chain>:<contract>" with EVM addresses case-folded.
//
// A badge embed knows the CONTRACT, not an internal project id, so the lookup
// tries the contract-derived keys first and falls back to an explicit
// projectId. Both spellings are checked because records exist from before paid
// verification, keyed by a project id, and those embeds must keep working.
export function candidateKeys({ contract, chain, projectId }) {
  const keys = [];
  if (projectId) keys.push(String(projectId));
  if (contract && chain) {
    const normalised = contract.startsWith('0x') ? contract.toLowerCase() : contract;
    keys.push(`${chain}:${normalised}`);
    // Solana's identity has always been the bare address in some records.
    keys.push(normalised);
  }
  return [...new Set(keys.filter(Boolean))];
}

export function lookupRecord(statuses, keys) {
  for (const key of keys) {
    const record = statuses?.[key];
    if (record) return record;
  }
  return null;
}
