// THE PUBLIC TOKEN PROFILE: its URL, its metadata, and the vocabulary it is
// allowed to use.
//
// Phase 4 gives every supported token a real, indexable, server-rendered page at
//
//   /t/<chain>/<contract>
//
// PURE MODULE. No import.meta.env, no Node APIs — imported by the Vite client
// AND bundled into Netlify Functions, the same contract pricing.js,
// trustScore.js, tokenIdentity.js and verificationTiers.js hold (enforced by
// scripts/verify-functions.mjs).
//
// ── WHY THIS URL REPLACES /token/<contract> AS THE CANONICAL ────────────────
//
// _badgeState.mjs used to argue the opposite, and the reasoning it gave was
// sound as far as it went: "a second URL for the same token splits ranking
// between two canonical pages and competes with itself". That objection is to
// having TWO canonicals, and it is still correct. It is answered by making this
// the ONLY one — netlify/functions/token-page.mjs now 301s /token/<contract>
// here — not by keeping the old shape.
//
// The old shape had to go, because it is not merely a different spelling. It is
// WRONG, and provably so:
//
//   1. THE SAME ADDRESS IS SEVEN DIFFERENT TOKENS. An 0x… contract can be
//      deployed on Ethereum AND Base AND BSC AND Arbitrum AND Optimism AND
//      Polygon AND Avalanche, holding completely different assets with
//      completely different risk. /token/0xabc… has no way to say which one it
//      means, so one URL claimed to be the trust page for up to seven tokens at
//      once. src/lib/tokenIdentity.js already settled this for storage — every
//      non-Solana identity carries a `<chainId>:` prefix precisely so their
//      histories do not collide — and the URL was the one place still ignoring
//      it.
//   2. IT COULD NEVER RESOLVE AN EVM TOKEN AT ALL. token-page.mjs derived its
//      corpus key as `c:<contract>`, which is the SOLANA identity spelling. An
//      Ethereum token is stored at `c:ethereum:<contract>`, so the lookup missed
//      100% of them and every EVM /token/ page served the "not analyzed yet"
//      branch forever. A chain-scoped URL removes the guess.
//
// So the chain segment is not decoration and not roadmap wording. It is the
// missing half of the token's identity.
//
// PUBLISHED LINKS SURVIVE. /token/<contract> is not deleted — src/lib/routes.js
// records this platform's rule that "a URL that has been sent to someone is a
// promise" — it becomes a permanent 301 to the canonical here, which is also the
// one redirect shape that TRANSFERS the old URL's accumulated ranking instead of
// competing with it.

import { chainLabel } from '../chains/registry.js';

export { chainLabel };

// ── The canonical URL ───────────────────────────────────────────────────────

// Contract addresses are the one thing in this path that is not from a closed
// vocabulary, so they are encoded. Chain ids are validated against the registry
// before they ever reach here (see parseProfilePath / _badgeState.chainFamily),
// but they are encoded too rather than trusted to be clean — this function is
// pure and must be safe on its own inputs.
export function profilePath(chain, contract) {
  const c = String(chain || '').trim().toLowerCase();
  const addr = String(contract || '').trim();
  if (!c || !addr) return '';
  return `/t/${encodeURIComponent(c)}/${encodeURIComponent(addr)}`;
}

export function profileUrlFor(origin, chain, contract) {
  const path = profilePath(chain, contract);
  if (!path) return '';
  return `${String(origin || '').replace(/\/+$/, '')}${path}`;
}

// Extract { chain, contract } from a /t/<chain>/<contract> pathname. Returns
// nulls when the path is not a profile path at all.
//
// EXACTLY TWO SEGMENTS. /t/solana/abc/extra is not a profile URL and must not be
// silently treated as one: tolerating trailing junk would mint an unbounded
// number of distinct URLs all serving identical content, which is duplicate
// content at infinite scale — the single most effective way to get a site's
// whole token surface demoted.
export function parseProfilePath(pathname) {
  const match = String(pathname || '').match(/^\/t\/([^/?#]+)\/([^/?#]+)\/?$/i);
  if (!match) return { chain: null, contract: null };
  const decode = (value) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };
  return {
    chain: decode(match[1]).trim().toLowerCase(),
    contract: decode(match[2]).trim(),
  };
}

// ── The verification vocabulary the public page may use ─────────────────────
//
// The badge already has five truthful states (_badgeState.mjs BADGE_STATES) and
// this page must not invent a sixth, nor collapse two of them into one. It reads
// the SAME resolver and only renames the outward-facing label:
//
//   badge 'verified' -> profile 'active'
//
// because "Verified: Verified" reads as a tautology in a status row, while the
// badge's own word has to stay 'verified' — it is stamped into embeds already
// live on other people's websites.
export const PROFILE_VERIFICATION = {
  ACTIVE: 'active',
  PENDING: 'pending',
  EXPIRED: 'expired',
  REVOKED: 'revoked',
  UNVERIFIED: 'unverified',
};

const BADGE_TO_PROFILE = {
  verified: PROFILE_VERIFICATION.ACTIVE,
  pending: PROFILE_VERIFICATION.PENDING,
  expired: PROFILE_VERIFICATION.EXPIRED,
  revoked: PROFILE_VERIFICATION.REVOKED,
  unverified: PROFILE_VERIFICATION.UNVERIFIED,
};

export function profileVerificationState(badgeState) {
  return BADGE_TO_PROFILE[badgeState] || PROFILE_VERIFICATION.UNVERIFIED;
}

// The human sentence for each state. Held here rather than in the renderer so
// the page, the OG image and any future consumer cannot describe the same state
// differently.
//
// EXPIRED AND REVOKED DO NOT READ AS "UNVERIFIED". That is the anti-forgery
// requirement expressed as copy: a project whose verification lapsed or was
// withdrawn keeps a visible history, because silently reverting them to a clean
// "not verified yet" would erase the single most useful fact the page holds —
// that this project WAS verified and no longer is.
export const VERIFICATION_LABELS = {
  [PROFILE_VERIFICATION.ACTIVE]: {
    label: 'Verified',
    tone: 'good',
    summary: 'Ownership was proven to KHAN Trust and this verification is currently active.',
  },
  [PROFILE_VERIFICATION.PENDING]: {
    label: 'Verification in review',
    tone: 'neutral',
    summary: 'A verification request for this project is with KHAN Trust reviewers. It is not verified yet.',
  },
  [PROFILE_VERIFICATION.EXPIRED]: {
    label: 'Verification expired',
    tone: 'warn',
    summary: 'This project was verified by KHAN Trust, but the verification term has ended and has not been renewed.',
  },
  [PROFILE_VERIFICATION.REVOKED]: {
    label: 'Verification revoked',
    tone: 'bad',
    summary: 'KHAN Trust withdrew this project’s verification. It is no longer verified.',
  },
  [PROFILE_VERIFICATION.UNVERIFIED]: {
    label: 'Not verified',
    tone: 'neutral',
    summary: 'This project has not completed KHAN Trust ownership verification.',
  },
};

// Only an ACTIVE verification may be described as verified anywhere on the page,
// in the OG image, or in structured data. One predicate, so a future surface
// cannot get this subtly wrong.
export function isProfileVerified(state) {
  return state === PROFILE_VERIFICATION.ACTIVE;
}

// How ownership was proven, in words a visitor can evaluate.
//
// The distinction is preserved rather than flattened into "verified" because it
// is the honest difference between a claim the chain itself confirms and a claim
// a human accepted — see the header of verify-order-activate.mjs, which refuses
// to collapse them at the point of sale for exactly this reason.
export const OWNERSHIP_METHOD_LABELS = {
  mint_authority: 'Signed by the token’s mint authority',
  admin_review: 'Wallet signature, confirmed by KHAN Trust review',
};

export function ownershipMethodLabel(method) {
  return OWNERSHIP_METHOD_LABELS[method] || '';
}

// ── Risk wording ────────────────────────────────────────────────────────────

export function riskWord(riskLevel) {
  const level = String(riskLevel || '');
  if (level === 'Low') return 'lower-risk';
  if (level === 'High') return 'higher-risk';
  return 'medium-risk';
}

// Chain display names come from the registry, NOT from a copy here. It already
// owns "bsc -> BNB Chain" and eight other mappings, and a second table is how
// the profile page ends up calling a chain something the report does not.

// ── SEO metadata ────────────────────────────────────────────────────────────

// Length caps. Not cosmetic: a title Google truncates loses the words after the
// cut, and the words after the cut here are the brand. These trim at a word
// boundary so the visible text never ends mid-word.
const TITLE_MAX = 65;
const DESCRIPTION_MAX = 160;

export function clampText(value, max) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

// The single builder for every piece of head metadata on a profile page.
//
// ONE FUNCTION, because title / og:title / twitter:title disagreeing is the
// classic way a share preview says something the page does not, and three
// separate template literals is exactly how that happens. The renderer receives
// a finished object and only escapes it.
//
// `view` is the assembled profile (see netlify/functions/_profileData.mjs).
export function buildProfileMeta(view, { origin } = {}) {
  const canonical = profileUrlFor(origin, view.chain, view.contract);
  const name = view.name || view.symbol || 'Unknown token';
  const symbolSuffix = view.symbol ? ` (${view.symbol})` : '';
  // Guarded, because registry.chainLabel() answers 'Unknown' for a missing id —
  // correct in the report, but " on Unknown" in a meta description would be a
  // claim about a chain rather than an absence of one.
  const chain = view.chain ? chainLabel(view.chain) : '';
  const hasScore = Number.isFinite(view.trustScore);
  const verified = isProfileVerified(view.verification?.state);

  // The roadmap's title shape, with the score folded in when there is one. A
  // number in the title is the strongest click signal this page has, and it is
  // omitted rather than faked when the token has never been scanned.
  const title = clampText(
    `${name}${symbolSuffix} Trust Score, Risk Analysis & Verification | KHAN Trust`,
    TITLE_MAX,
  );

  const scoreSentence = hasScore
    ? `${name}${symbolSuffix} scores ${view.trustScore}/100 on KHAN Trust (${riskWord(view.riskLevel)})`
    : `${name}${symbolSuffix} has not been scored by KHAN Trust yet`;
  const verificationSentence = verified
    ? 'Ownership is verified.'
    : VERIFICATION_LABELS[view.verification?.state]?.summary || '';
  const description = clampText(
    `${scoreSentence}${chain ? ` on ${chain}` : ''}. ${verificationSentence} Holder concentration, liquidity, contract security and verification status — explained.`,
    DESCRIPTION_MAX,
  );

  return {
    title,
    description,
    canonical,
    robots: view.indexable ? 'index,follow,max-image-preview:large' : 'noindex,follow',
    ogTitle: title,
    ogDescription: description,
    ogUrl: canonical,
    ogImage: view.ogImageUrl || '',
    ogType: 'website',
    // summary_large_image only when there IS an image. Declaring a large card
    // with nothing to put in it renders an empty grey box on X, which looks
    // worse than the plain summary card it replaced.
    twitterCard: view.ogImageUrl ? 'summary_large_image' : 'summary',
    twitterTitle: title,
    twitterDescription: description,
    twitterImage: view.ogImageUrl || '',
  };
}

// ── Structured data ─────────────────────────────────────────────────────────
//
// Two graphs, and the split is deliberate.
//
// The Rating node carries the Trust Score, and it is EMITTED ONLY WHEN A REAL
// SCORE EXISTS. Google treats structured data as a factual claim about the page;
// a Rating node with a missing or invented ratingValue is the kind of thing that
// earns a manual action, and "we have not scored this token" is not a rating of
// zero. Absence is not a zero — the same rule the scan quota, the score floor
// and the growth warehouse all follow.
export function buildProfileJsonLd(view, { origin } = {}) {
  const canonical = profileUrlFor(origin, view.chain, view.contract);
  const name = view.name || view.symbol || view.contract;
  const graph = [];

  graph.push({
    '@type': 'WebPage',
    '@id': `${canonical}#page`,
    url: canonical,
    name: `${name} — KHAN Trust`,
    isPartOf: { '@type': 'WebSite', name: 'KHAN Trust', url: String(origin || '').replace(/\/+$/, '') },
  });

  if (Number.isFinite(view.trustScore)) {
    graph.push({
      '@type': 'Rating',
      '@id': `${canonical}#rating`,
      name: `${name} KHAN Trust Score`,
      ratingValue: view.trustScore,
      bestRating: 100,
      worstRating: 0,
      ratingExplanation: `KHAN Trust Score for ${name}${view.riskLevel ? ` — ${view.riskLevel} risk` : ''}.`,
      author: { '@type': 'Organization', name: 'KHAN Trust' },
    });
  }

  return { '@context': 'https://schema.org', '@graph': graph };
}

// ── Indexability ────────────────────────────────────────────────────────────
//
// WHICH PROFILES DESERVE TO BE IN THE INDEX AT ALL.
//
// The temptation with a URL space this large is to index everything: every
// address anyone ever pastes becomes a page, and pages are traffic. It is the
// wrong trade and it is self-punishing. A crawler that finds ten thousand
// near-identical "we have not scored this yet" pages concludes the SITE is
// low-quality, and the judgement lands on the pages that DO have content.
//
// So a profile earns indexing by having something to say:
//   - a real completed scan (a Trust Score), OR
//   - a real verification record (active, expired or revoked — a project whose
//     verification lapsed is still a genuine, useful, unique page).
//
// Everything else — never scanned, never verified — is served, is useful to the
// human who followed the link, and is noindex. Same posture the existing
// token-page.mjs already took for its not-found branch; this generalises it into
// a rule instead of a special case.
export function isProfileIndexable(view) {
  if (!view || !view.chain || !view.contract) return false;
  if (Number.isFinite(view.trustScore)) return true;
  const state = view.verification?.state;
  return (
    state === PROFILE_VERIFICATION.ACTIVE ||
    state === PROFILE_VERIFICATION.EXPIRED ||
    state === PROFILE_VERIFICATION.REVOKED
  );
}
