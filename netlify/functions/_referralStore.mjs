// Referral & Invite System — persistence + funnel logic.
//
// This is the single source of truth for "who invited whom" and how far each
// referred account travelled down the funnel:
//
//   clicked link → registered → verified email → active → premium → lifetime
//
// DESIGN
//
// Two identity truths already exist in this codebase (see _authStore.mjs and
// _entitlementsStore.mjs). Referrals are keyed ONLY by the auth user id, which
// is the one stable, unforgeable handle every registered person has. A referral
// relationship, once written, is NEVER moved or deleted — the whole product
// promise is "never lose referral relationships", so every write here is either
// an append or a monotonic milestone stamp, never a reassignment.
//
// KEYS (store: khan-trust-referrals)
//   code:<CODE>            → { code, userId, createdAt }      reverse: code → owner
//   owner:<userId>         → { userId, code, createdAt, clicks, lastClickAt }
//   ref:<referredUserId>   → { referrerUserId, code, at }     write-once claim
//   edge:<refr>:<refd>     → relationship w/ milestone timestamps + status
//
// The edge is keyed UNDER the referrer so one promoter's whole downline is a
// single prefix list (owner dashboard). The `ref:` claim is keyed under the
// referred user so any funnel event (which only knows the referred user's id)
// can find the one edge to stamp, and so a second referrer can never overwrite
// the first.
import crypto from 'node:crypto';
import { getNamedStore, jsonResponse } from './_blobsClient.mjs';

const STORE_NAME = 'khan-trust-referrals';

// Unambiguous alphabet: no 0/O, 1/I/L. A code is read aloud and typed by
// humans off a video, so lookalike characters are a support cost, not a feature.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 7;

// Milestones in funnel order. Each is a monotonic, write-once timestamp on the
// edge; a stage can never regress (a churned premium user is still counted as
// having reached premium — the funnel measures furthest progress, not current
// state). `lifetime` implies `premium`, so stamping it fills both.
export const MILESTONES = ['registered', 'verified', 'active', 'premium', 'lifetime'];
const MILESTONE_FIELD = {
  registered: 'registeredAt',
  verified: 'verifiedAt',
  active: 'activeAt',
  premium: 'premiumAt',
  lifetime: 'lifetimeAt',
};
const MILESTONE_RANK = { registered: 1, verified: 2, active: 3, premium: 4, lifetime: 5 };

function store() {
  return getNamedStore(STORE_NAME);
}

// ── Code helpers ──────────────────────────────────────────────────────────────

export function normalizeCode(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 32);
}

function randomCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

// ── Owner (promoter) record ───────────────────────────────────────────────────

export async function getOwnerRecord(userId) {
  if (!userId) return null;
  try {
    return await store().get(`owner:${userId}`, { type: 'json' });
  } catch {
    return null;
  }
}

export async function resolveCodeOwner(code) {
  const norm = normalizeCode(code);
  if (!norm) return null;
  try {
    const rec = await store().get(`code:${norm}`, { type: 'json' });
    return rec?.userId || null;
  } catch {
    return null;
  }
}

// Returns the promoter's stable referral code, creating one on first access.
// Idempotent: an existing owner record is returned untouched, so a code, once
// issued, is permanent (links printed in a video keep working forever).
export async function ensureOwnerRecord(userId) {
  if (!userId) return null;
  const existing = await getOwnerRecord(userId);
  if (existing?.code) return existing;

  // Collision-avoiding allocation: claim the reverse index first, and only keep
  // a code that was actually free. `code:` is the arbiter, so two racing
  // allocations for the same code can't both believe they own it.
  let code = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidate = randomCode();
    const taken = await resolveCodeOwner(candidate);
    if (!taken) {
      code = candidate;
      break;
    }
  }
  if (!code) code = `${randomCode()}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

  const now = new Date().toISOString();
  const record = {
    userId,
    code,
    createdAt: existing?.createdAt || now,
    clicks: existing?.clicks || 0,
    lastClickAt: existing?.lastClickAt || null,
  };
  await store().setJSON(`code:${code}`, { code, userId, createdAt: now });
  await store().setJSON(`owner:${userId}`, record);
  return record;
}

// Regenerate: issue a NEW code for a promoter while keeping the old one alive as
// a permanent alias, so links already shared never 404. The old `code:` index
// row is left in place (it still points at this owner); only the owner's
// "primary" code changes. Downline edges are untouched — they are keyed by user
// id, not by code.
export async function regenerateCode(userId) {
  const owner = await ensureOwnerRecord(userId);
  if (!owner) return null;
  let code = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidate = randomCode();
    if (candidate === owner.code) continue;
    const taken = await resolveCodeOwner(candidate);
    if (!taken) {
      code = candidate;
      break;
    }
  }
  if (!code) code = `${randomCode()}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

  const now = new Date().toISOString();
  await store().setJSON(`code:${code}`, { code, userId, createdAt: now });
  const updated = { ...owner, code };
  await store().setJSON(`owner:${userId}`, updated);
  return updated;
}

// ── Click tracking ────────────────────────────────────────────────────────────

// Increment a promoter's click counter. Clicks are an approximate top-of-funnel
// marketing metric (not money, not entitlement), so a best-effort
// read-modify-write is acceptable; the endpoint rate-limits per IP+code to keep
// the number honest and to bound write amplification. Returns false when the
// code is unknown so the caller never mints a counter for a non-existent link.
export async function recordClick(code) {
  const userId = await resolveCodeOwner(code);
  if (!userId) return false;
  const owner = await getOwnerRecord(userId);
  if (!owner) return false;
  const updated = {
    ...owner,
    clicks: (owner.clicks || 0) + 1,
    lastClickAt: new Date().toISOString(),
  };
  await store().setJSON(`owner:${userId}`, updated);
  return true;
}

// ── Referral edge (the relationship) ──────────────────────────────────────────

async function getClaim(referredUserId) {
  try {
    return await store().get(`ref:${referredUserId}`, { type: 'json' });
  } catch {
    return null;
  }
}

async function getEdge(referrerUserId, referredUserId) {
  try {
    return await store().get(`edge:${referrerUserId}:${referredUserId}`, { type: 'json' });
  } catch {
    return null;
  }
}

// Bind a freshly-registered user to their inviter. Called exactly once, at
// registration. Every guard here is a hard "do nothing and succeed" — a
// referral is a bonus attribution, never a precondition of sign-up, so this can
// never block or fail account creation.
//
// Guards (all silent no-ops):
//   • no/blank/unknown code          → not a referred signup
//   • self-referral (owner == user)  → a link cannot invite its own owner
//   • already claimed                → write-once; the FIRST referrer is kept
//   • 2-cycle loop (inviter was
//     invited by this same user)      → A↔B rings are refused
export async function attachReferral({ referredUserId, code, at }) {
  if (!referredUserId) return { ok: false, reason: 'no_user' };
  const norm = normalizeCode(code);
  if (!norm) return { ok: false, reason: 'no_code' };

  const referrerUserId = await resolveCodeOwner(norm);
  if (!referrerUserId) return { ok: false, reason: 'unknown_code' };
  if (referrerUserId === referredUserId) return { ok: false, reason: 'self_referral' };

  const existingClaim = await getClaim(referredUserId);
  if (existingClaim) return { ok: false, reason: 'already_referred' };

  // Loop guard: refuse if the inviter was themselves invited by this user.
  // Because every user has at most one referrer, the referral graph is a
  // forest; the only cycle that can form is a direct 2-cycle, and this refuses
  // exactly that.
  const referrerClaim = await getClaim(referrerUserId);
  if (referrerClaim?.referrerUserId === referredUserId) {
    return { ok: false, reason: 'loop' };
  }

  const nowIso = at || new Date().toISOString();
  await store().setJSON(`ref:${referredUserId}`, { referrerUserId, code: norm, at: nowIso });
  const edge = {
    referrerUserId,
    referredUserId,
    code: norm,
    status: 'registered',
    registeredAt: nowIso,
    verifiedAt: null,
    activeAt: null,
    premiumAt: null,
    lifetimeAt: null,
    updatedAt: nowIso,
  };
  await store().setJSON(`edge:${referrerUserId}:${referredUserId}`, edge);
  return { ok: true, referrerUserId };
}

// Stamp a funnel milestone on a referred user's edge. Idempotent and monotonic:
// a timestamp is only written the first time, and `status` only ever advances.
// A no-op (user was not referred, or milestone already reached) is a success.
// Best-effort by design — funnel bookkeeping must never break the auth/payment
// flow that triggers it.
export async function markMilestone(referredUserId, milestone, at) {
  try {
    if (!referredUserId || !MILESTONE_FIELD[milestone]) return { ok: false };
    const claim = await getClaim(referredUserId);
    if (!claim?.referrerUserId) return { ok: false, reason: 'not_referred' };
    const referrerUserId = claim.referrerUserId;
    const edge = await getEdge(referrerUserId, referredUserId);
    if (!edge) return { ok: false, reason: 'no_edge' };

    const nowIso = at || new Date().toISOString();
    const updated = { ...edge };
    let changed = false;

    // Real-world implication, not display sugar: you cannot buy Premium without
    // being an active user, and a lifetime buyer is by definition Premium. So a
    // premium stamp also fills `active`, and a lifetime stamp fills both. Email
    // `verified` is deliberately NOT implied — it is a separate action a paying
    // user may never have completed — so it is only ever stamped by real
    // verification.
    const CASCADE = {
      premium: ['active', 'premium'],
      lifetime: ['active', 'premium', 'lifetime'],
    };
    const toStamp = CASCADE[milestone] || [milestone];
    for (const m of toStamp) {
      const field = MILESTONE_FIELD[m];
      if (!updated[field]) {
        updated[field] = nowIso;
        changed = true;
      }
    }

    if (MILESTONE_RANK[milestone] > (MILESTONE_RANK[updated.status] || 0)) {
      updated.status = milestone;
      changed = true;
    }
    if (!changed) return { ok: true, unchanged: true };

    updated.updatedAt = nowIso;
    await store().setJSON(`edge:${referrerUserId}:${referredUserId}`, updated);
    return { ok: true, referrerUserId };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

// ── Aggregation ───────────────────────────────────────────────────────────────

function emptyStats() {
  return {
    clicks: 0,
    signups: 0,
    verified: 0,
    active: 0,
    premium: 0,
    lifetime: 0,
    lastSignupAt: null,
  };
}

// Fold one promoter's edges into the funnel counts shown on both the user
// dashboard and the admin table. Counts are CUMULATIVE by furthest stage
// reached: a lifetime customer also counts as premium/active/verified/signup,
// so the funnel never widens as it deepens.
export function foldEdges(edges) {
  const stats = emptyStats();
  for (const edge of edges) {
    if (!edge) continue;
    stats.signups += 1;
    if (edge.verifiedAt) stats.verified += 1;
    if (edge.activeAt) stats.active += 1;
    if (edge.premiumAt) stats.premium += 1;
    if (edge.lifetimeAt) stats.lifetime += 1;
    const reg = edge.registeredAt || edge.updatedAt;
    if (reg && (!stats.lastSignupAt || Date.parse(reg) > Date.parse(stats.lastSignupAt))) {
      stats.lastSignupAt = reg;
    }
  }
  return stats;
}

export function conversionRate(signups, converted) {
  if (!signups) return 0;
  return Math.round((converted / signups) * 1000) / 10; // one decimal place
}

export async function listReferralsForPromoter(userId) {
  if (!userId) return [];
  try {
    const result = await store().list({ prefix: `edge:${userId}:` });
    const blobs = result.blobs || [];
    const edges = await Promise.all(
      blobs.map((b) => store().get(b.key, { type: 'json' }).catch(() => null))
    );
    return edges.filter(Boolean);
  } catch {
    return [];
  }
}

// One promoter's complete dashboard view: their code + link stats + funnel.
export async function getPromoterView(userId, { siteOrigin } = {}) {
  const owner = await ensureOwnerRecord(userId);
  const edges = await listReferralsForPromoter(userId);
  const stats = foldEdges(edges);
  stats.clicks = owner?.clicks || 0;
  return {
    code: owner?.code || null,
    link: owner?.code ? buildReferralLink(owner.code, siteOrigin) : null,
    createdAt: owner?.createdAt || null,
    lastClickAt: owner?.lastClickAt || null,
    stats: {
      ...stats,
      signupConversion: conversionRate(stats.clicks, stats.signups),
      verifiedRate: conversionRate(stats.signups, stats.verified),
      premiumRate: conversionRate(stats.signups, stats.premium),
    },
    referrals: edges,
  };
}

// Admin: every promoter with at least one edge OR an issued code, aggregated in
// a single pass over all edges (grouped by referrer) joined with owner records.
export async function listAllPromoters() {
  const st = store();
  let ownerBlobs = [];
  let edgeBlobs = [];
  try {
    [ownerBlobs, edgeBlobs] = await Promise.all([
      st.list({ prefix: 'owner:' }).then((r) => r.blobs || []),
      st.list({ prefix: 'edge:' }).then((r) => r.blobs || []),
    ]);
  } catch {
    return [];
  }

  const [owners, edges] = await Promise.all([
    Promise.all(ownerBlobs.map((b) => st.get(b.key, { type: 'json' }).catch(() => null))),
    Promise.all(edgeBlobs.map((b) => st.get(b.key, { type: 'json' }).catch(() => null))),
  ]);

  const byReferrer = new Map();
  for (const edge of edges) {
    if (!edge?.referrerUserId) continue;
    let list = byReferrer.get(edge.referrerUserId);
    if (!list) {
      list = [];
      byReferrer.set(edge.referrerUserId, list);
    }
    list.push(edge);
  }

  const rows = [];
  for (const owner of owners) {
    if (!owner?.userId) continue;
    const promoterEdges = byReferrer.get(owner.userId) || [];
    const stats = foldEdges(promoterEdges);
    stats.clicks = owner.clicks || 0;
    rows.push({
      userId: owner.userId,
      code: owner.code || null,
      createdAt: owner.createdAt || null,
      lastClickAt: owner.lastClickAt || null,
      ...stats,
      signupConversion: conversionRate(stats.clicks, stats.signups),
      premiumRate: conversionRate(stats.signups, stats.premium),
      lastActivityAt: latestActivity(owner, stats),
    });
  }
  return rows;
}

function latestActivity(owner, stats) {
  const candidates = [owner.lastClickAt, stats.lastSignupAt].filter(Boolean);
  if (!candidates.length) return null;
  return candidates.reduce((a, b) => (Date.parse(a) > Date.parse(b) ? a : b));
}

// ── Link building ─────────────────────────────────────────────────────────────

const DEFAULT_ORIGIN = 'https://khantrust.net';

export function buildReferralLink(code, siteOrigin) {
  const origin = (siteOrigin || process.env.URL || process.env.DEPLOY_PRIME_URL || DEFAULT_ORIGIN).replace(/\/+$/, '');
  return `${origin}/signup?ref=${encodeURIComponent(code)}`;
}

export { jsonResponse };
