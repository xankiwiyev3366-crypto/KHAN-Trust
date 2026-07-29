// Assembles the view model behind /t/<chain>/<contract>.
//
// This module reads. It never fetches a price, never calls an RPC, never asks a
// provider anything. Everything it returns is already stored:
//
//   corpus         the last completed client-lane scan (score, risk, name,
//                  ticker, the stable scoring inputs)
//   statuses       the public verification record — the SAME store the badge
//                  reads, resolved through the SAME resolver
//   orders         the paid order behind an active verification, for the term
//                  dates and ownership method
//
// ── WHY NOTHING LIVE IS FETCHED ─────────────────────────────────────────────
//
// This page's job is to be fast, crawlable and always available. A live re-scan
// here would make it none of those: the ~18-provider fan-out that produces a
// Trust Score is a browser-side operation taking many seconds, and a page that
// takes many seconds is a page Google measures as slow and a crawler abandons.
// Worse, it would produce a SECOND scoring lane — the exact trap
// _rescanEngine.mjs documents, where the same token scores 35 and 76 at one
// instant from two different input sets. The public profile must show the number
// the site shows. So it shows the stored one, stamps it with when it was taken,
// and offers a scan CTA for anyone who wants it fresher.
//
// ── EVERY READ IS INDEPENDENTLY SURVIVABLE ──────────────────────────────────
//
// The three reads run in parallel and each degrades on its own. A corpus outage
// must still render the verification status; a verification-store outage must
// still render the score. What it may NEVER do is degrade a verification into a
// better-looking state than the truth: an unreadable status store resolves to
// `unverified`, never to verified, matching the fail-closed posture the badge
// endpoints already take.
import { getCorpusToken } from './_tokenCorpusStore.mjs';
import { readStatuses } from './_verificationStore.mjs';
import { findActiveOrderForContract, contractKey } from './_verificationOrders.mjs';
import {
  resolveBadgeState,
  parseBadgeTarget,
  candidateKeys,
  lookupRecord,
  siteOrigin,
} from './_badgeState.mjs';
import { tokenIdentity } from '../../src/lib/tokenIdentity.js';
import {
  profileUrlFor,
  profileVerificationState,
  isProfileIndexable,
  PROFILE_VERIFICATION,
} from '../../src/lib/publicProfile.js';
import { explorerTokenUrl, getChain } from '../../src/chains/registry.js';

// Hard ceiling on any single store read from this page's critical path. Netlify
// gives a synchronous function ~10s in total; a page that spends all of it
// waiting on a wedged blob read is a 502 to the visitor and a timeout to the
// crawler. Past this, the read is treated as "we could not answer" — which each
// consumer below already knows how to render honestly.
const READ_TIMEOUT_MS = 2500;

// Resolves to `fallback` rather than rejecting, so a caller never needs a
// try/catch per read and a slow store can never become an exception path.
function softRead(promise, fallback, label) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[profile] ${label} read exceeded ${READ_TIMEOUT_MS}ms — rendering without it`);
      resolve(fallback);
    }, READ_TIMEOUT_MS);
    if (timer && typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([
    Promise.resolve(promise).catch((error) => {
      console.warn(`[profile] ${label} read failed — rendering without it: ${error.message}`);
      return fallback;
    }),
    timeout,
  ]).finally(() => clearTimeout(timer));
}

// ── Security flags ──────────────────────────────────────────────────────────
//
// Derived ONLY from stored scoring inputs. Nothing here is invented, inferred
// from a name, or copied from another token.
//
// TRI-STATE IS PRESERVED. `socialMetadataAvailable === null` means the provider
// had no social data at all, which is NOT the same as the project having no
// socials — src/lib/monitoredScore.js scores those two cases differently and
// this page must not flatten them into "no website", which would be an
// accusation rather than an observation.
export function deriveFlags(corpus) {
  const flags = [];
  if (!corpus) return flags;

  const risk = corpus.riskLevel;
  if (risk === 'High') {
    flags.push({
      tone: 'bad',
      title: 'High risk',
      detail: 'KHAN Trust’s scanner rates this token high-risk. Treat any claim about it, including on this page, with caution.',
    });
  }

  const inputs = corpus.scoreInputs;
  if (inputs) {
    if (inputs.socialMetadataAvailable === false) {
      const missing = [];
      if (!inputs.website) missing.push('website');
      if (!inputs.twitter) missing.push('X account');
      if (!inputs.telegram) missing.push('Telegram');
      if (missing.length) {
        flags.push({
          tone: 'warn',
          title: 'Limited public presence',
          detail: `No ${missing.join(', ')} was found for this project when it was last scanned.`,
        });
      }
    }
    if (inputs.socialMetadataAvailable === null) {
      flags.push({
        tone: 'neutral',
        title: 'Project metadata unavailable',
        detail: 'Public metadata providers returned nothing for this token, so its team presence could not be assessed either way.',
      });
    }
    if (Number.isFinite(inputs.confidenceScore) && inputs.confidenceScore < 50) {
      flags.push({
        tone: 'warn',
        title: 'Low data confidence',
        detail: 'Several data sources were unavailable for this token, so the score rests on fewer signals than usual.',
      });
    }
    if (inputs.riskNotes) {
      flags.push({ tone: 'warn', title: 'Scanner notes', detail: inputs.riskNotes });
    }
  }

  return flags;
}

// ── Public links ────────────────────────────────────────────────────────────
//
// ONLY LINKS THAT ARE TRUE BY CONSTRUCTION. The corpus stores whether a project
// HAS a website or an X account (booleans, used for scoring) but not the URLs,
// so this page cannot link to them — and guessing one from a ticker is precisely
// the fabricated-data class Phase 1 removed from this codebase. The block
// explorer link is derived from the chain registry and the contract address, so
// it is correct by construction for every supported chain.
export function publicLinks({ chain, contract }) {
  const links = [];
  const explorer = explorerTokenUrl(chain, contract);
  if (explorer) {
    links.push({ label: `View on ${getChain(chain)?.explorerName || 'block explorer'}`, url: explorer, rel: 'nofollow noopener' });
  }
  return links;
}

// Which channels the project disclosed at last scan. Presented as facts about
// the SCAN, not as links, because that is all the data supports.
export function disclosedChannels(corpus) {
  const inputs = corpus?.scoreInputs;
  if (!inputs || inputs.socialMetadataAvailable === null) return [];
  const out = [];
  if (inputs.website) out.push('Website');
  if (inputs.twitter) out.push('X');
  if (inputs.telegram) out.push('Telegram');
  if (inputs.github) out.push('GitHub');
  return out;
}

// ── The assembler ───────────────────────────────────────────────────────────

// Returns one of:
//   { ok: false, reason: 'unsupported_chain' | 'invalid_contract' }
//   { ok: true, view }
//
// `view.exists` distinguishes "we hold something about this token" from "this is
// a well-formed address we have never heard of". The handler turns the latter
// into a 404 with a useful body — see its header for why that is the correct
// status and not a 200.
export async function buildProfileView({ chain, contract, origin = siteOrigin() }) {
  const target = parseBadgeTarget({ contract, chain });
  if (!target.ok) return { ok: false, reason: target.reason };

  const identity = tokenIdentity({ contract: target.contract, chainId: target.chain });
  const key = contractKey(target.chain, target.contract);

  // All three reads at once. Sequential would be three round trips on the
  // critical path of a page whose entire value proposition is being fast enough
  // to rank.
  const [corpus, statuses, activeOrder] = await Promise.all([
    softRead(identity ? getCorpusToken(identity) : null, null, 'corpus'),
    softRead(readStatuses(), null, 'verification statuses'),
    softRead(findActiveOrderForContract(key), null, 'active order'),
  ]);

  // FAIL CLOSED. `statuses === null` means the store could not be read, and an
  // unreadable store is not evidence of verification — resolveBadgeState(null)
  // answers 'unverified', which is what we want, but the record is looked up
  // only when we actually have a map to look in.
  const record = statuses
    ? lookupRecord(statuses, candidateKeys({
      contract: target.contract,
      chain: target.chain,
      projectId: activeOrder?.projectId || '',
    }))
    : null;

  const state = profileVerificationState(resolveBadgeState(record));

  const view = {
    chain: target.chain,
    contract: target.contract,
    chainName: getChain(target.chain)?.label || target.chain,

    name: corpus?.name || '',
    symbol: corpus?.ticker || '',
    category: corpus?.category || '',
    // No logo source exists in the corpus today. Stated as null rather than
    // pointed at a guessed CDN path, so the renderer falls back to the monogram
    // instead of shipping a broken <img> to every share preview.
    logoUrl: null,

    trustScore: Number.isFinite(corpus?.trustScore) ? corpus.trustScore : null,
    riskLevel: corpus?.riskLevel || '',
    confidenceLabel: corpus?.confidenceLabel || '',
    scannedAt: corpus?.updatedAt || '',

    flags: deriveFlags(corpus),
    links: publicLinks({ chain: target.chain, contract: target.contract }),
    channels: disclosedChannels(corpus),

    verification: {
      state,
      // Everything below is present ONLY when the record actually carries it.
      // A verification approved before paid tiers existed has no tier and no
      // expiry, and inventing "verified" or "permanent" for those fields would
      // misrepresent a real customer's real product.
      tier: record?.tier || '',
      ownershipMethod: record?.ownershipMethod || '',
      issuedAt: record?.updatedAt || '',
      expiresAt: record?.expiresAt || '',
      revokedAt: record?.revokedAt || '',
      // The live lookup. This is the anti-forgery hinge: the page does not
      // assert verification on its own authority, it points at the endpoint that
      // recomputes the state from server-held data on every call, so a
      // screenshot of this page proves nothing that the link cannot disprove.
      badgeUrl: `${origin}/badge/${encodeURIComponent(target.chain)}/${encodeURIComponent(target.contract)}`,
      badgeStatusUrl: `${origin}/badge-status?chain=${encodeURIComponent(target.chain)}&contract=${encodeURIComponent(target.contract)}`,
    },

    canonical: profileUrlFor(origin, target.chain, target.contract),
    ogImageUrl: `${origin}/og/t/${encodeURIComponent(target.chain)}/${encodeURIComponent(target.contract)}.svg`,
    scanUrl: `${origin}/?scan=${encodeURIComponent(target.contract)}`,
    verifyUrl: `${origin}/#/verify?contract=${encodeURIComponent(target.contract)}&chain=${encodeURIComponent(target.chain)}`,

    // Did any store have anything at all about this token? Deliberately
    // includes the non-active verification states: a REVOKED project is
    // emphatically something we hold a record of, and must not 404 into
    // oblivion just because it is no longer verified.
    exists: Boolean(corpus) || state !== PROFILE_VERIFICATION.UNVERIFIED,

    // Set below — isProfileIndexable reads the finished view.
    indexable: false,
  };

  view.indexable = isProfileIndexable(view);
  return { ok: true, view };
}
