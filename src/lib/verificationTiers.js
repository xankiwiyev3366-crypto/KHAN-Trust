// SINGLE SOURCE OF TRUTH for paid verification: what a tier costs, how long it
// lasts, and what it actually includes.
//
// Same contract as src/lib/pricing.js, for the same reason: the browser asks a
// wallet to transfer this many dollars, and the server refuses to activate for
// less. Those two numbers living in two files is how a customer pays $149 for
// something the backend thinks costs $399. There is one place to change a price.
//
// PURE MODULE. No import.meta.env, no Node APIs — it is imported by the Vite
// client AND bundled into Netlify Functions (scripts/verify-functions.mjs
// enforces this at build time), exactly as pricing.js and trustScore.js are.
//
// WHAT A TIER MAY PROMISE
//
// Every `includes` key below maps to something that exists and works today.
// Phase 1 deleted two "Future Premium AI features / coming soon" rows from the
// Premium plan for precisely this reason — a paid feature list is not a
// roadmap, and a verification tier is a contract with someone who has just
// handed over $149. If a capability is not shipped, it does not appear here.

// Tier ids are stored on orders and on the public verification status, so they
// are permanent. Renaming one orphans every record that carries it.
export const VERIFICATION_TIERS = {
  verified: {
    id: 'verified',
    usd: 149,
    // One year. Verification is a statement about a project's ownership at a
    // point in time; a permanent badge would keep asserting it long after the
    // team, the contract authorities, or the token itself had changed hands.
    durationDays: 365,
    // Months of Premium included with the purchase. The buyer is a token team,
    // and the tools they need to watch their own token are the Premium ones.
    premiumBonusMonths: 3,
    includes: [
      'publicProfile',      // permanent indexable /token/<contract> profile
      'verifiedBadge',      // "Verified by KHAN Trust" across the platform
      'embeddableBadge',    // the SVG at /badge/<projectId>
      'ownershipProof',     // wallet-signature proof, shown publicly
    ],
  },
  verified_pro: {
    id: 'verified_pro',
    usd: 399,
    durationDays: 365,
    premiumBonusMonths: 12,
    includes: [
      'publicProfile',
      'verifiedBadge',
      'embeddableBadge',
      'ownershipProof',
      'priorityReview',     // moves to the front of the admin review queue
      'watchtowerPremium',  // premium re-scan cadence on the verified token
      'pdfReport',          // the existing jsPDF risk report
    ],
  },
};

export const VERIFICATION_TIER_IDS = Object.keys(VERIFICATION_TIERS);

export function getVerificationTier(tierId) {
  return VERIFICATION_TIERS[tierId] || null;
}

// The required USD for a tier. Returns null rather than defaulting, unlike
// planUsdAmount() in pricing.js: defaulting an unknown plan to the CHEAPEST
// product is a safe mistake for a $9 subscription and an expensive one here —
// a typo'd tier id would let someone buy the $399 product for $149. An unknown
// tier must fail the sale, not discount it.
export function verificationTierUsd(tierId) {
  const tier = getVerificationTier(tierId);
  return tier ? tier.usd : null;
}

export function tierIncludes(tierId, capability) {
  const tier = getVerificationTier(tierId);
  return Boolean(tier && tier.includes.includes(capability));
}

// ── The score floor ─────────────────────────────────────────────────────────
//
// KHAN Trust will not sell a verified badge to a token its own scanner rates as
// high-risk. Not as a favour to the buyer — as the only thing that keeps the
// badge worth buying. A badge that anyone can purchase regardless of what the
// data says is a receipt, not a signal, and the first rug carrying one destroys
// the product.
//
// WHICH SCORE. This is the single most consequential decision in the paid
// verification design, because this codebase computes TWO trust scores that are
// not comparable (see netlify/functions/_rescanEngine.mjs, which documents a
// token scoring 35 from the client's inputs and 76 from the server's at the
// same instant). The floor is measured against the CLIENT-LANE score — the one
// held in the corpus, produced by the full ~18-provider fan-out, and the only
// one a visitor has ever seen on the site.
//
// The consequence is deliberate: a quote requires a completed real scan to
// exist. A team whose token has never been scanned is asked to run the free
// scan first. That is one extra step, and it buys three things — the number in
// the quote is the number on the site, the free scanner becomes the top of the
// verification funnel, and no second scoring lane has to be built or kept in
// sync with the first.
export const DEFAULT_VERIFY_MIN_SCORE = 40;

// Pure predicate so the client can grey out the button for the same reason the
// server will refuse the sale, with no second copy of the rule.
export function meetsScoreFloor(score, minScore = DEFAULT_VERIFY_MIN_SCORE) {
  // ABSENCE IS NOT A PASS. A missing/unparseable score means "we have not
  // scored this", which is exactly the case the floor exists to catch, so it
  // fails closed. The caller distinguishes "no scan yet" (ask for a scan) from
  // "scanned and too low" (refuse the sale) by whether a scan record exists —
  // this function only answers the numeric question.
  if (typeof score !== 'number' || !Number.isFinite(score)) return false;
  return score >= minScore;
}

// ── Expiry ──────────────────────────────────────────────────────────────────

// Verification is time-bounded, so every consumer needs the same answer to
// "is this still valid?". Callers must pass the record; there is no ambient
// clock read here so the whole thing stays pure and testable.
export function isVerificationActive(record, now = Date.now()) {
  if (!record) return false;
  if (record.status !== 'verified') return false;
  if (record.revokedAt) return false;
  // A record with no expiry is a pre-paid, admin-approved verification from
  // before this system existed. Those do not expire — retroactively expiring
  // someone's approved badge because a new product shipped would be theft of
  // something already granted.
  if (!record.expiresAt) return true;
  const expires = Date.parse(record.expiresAt);
  if (!Number.isFinite(expires)) return true;
  return expires > now;
}

export function expiryFromNow(tierId, fromMs = Date.now()) {
  const tier = getVerificationTier(tierId);
  if (!tier) return null;
  return new Date(fromMs + tier.durationDays * 86400000).toISOString();
}

export function premiumBonusExpiry(tierId, fromMs = Date.now()) {
  const tier = getVerificationTier(tierId);
  if (!tier || !tier.premiumBonusMonths) return null;
  const date = new Date(fromMs);
  date.setUTCMonth(date.getUTCMonth() + tier.premiumBonusMonths);
  return date.toISOString();
}
