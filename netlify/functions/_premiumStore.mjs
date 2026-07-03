// Persistence layer for ADMIN-GRANTED (manual) Premium access.
//
// This is intentionally isolated from the paid-entitlements store
// (_entitlementsStore.mjs, keyed by Solana wallet) and never touches it.
// Manual premium is keyed by the registered user's account id (see
// _authStore.mjs), so an administrator can grant a free Premium plan to any
// email account without a wallet or a payment. The two systems are read
// together only in memory on the client (see src/main.jsx useWalletEntitlement)
// so unlocking one never rewrites the other's records.
//
// Two blobs:
//   grants.json    { [userId]: GrantRecord }         current manual grant per user
//   audit-log.json [ AuditEntry, ... ]               append-only, never deleted
import { getNamedStore, jsonResponse } from './_blobsClient.mjs';

const STORE_NAME = 'khan-trust-premium';
const GRANTS_KEY = 'grants.json';
const AUDIT_KEY = 'audit-log.json';

const DAY_MS = 24 * 60 * 60 * 1000;

// Plans and sources the admin module recognises. Kept as plain sets so the
// endpoints can validate input without importing from the client bundle.
export const PLANS = new Set(['free', 'premium', 'early_supporter']);
export const SOURCES = new Set(['manual', 'payment', 'giveaway', 'promotion', 'early_supporter']);
export const REASONS = new Set([
  'giveaway_winner', 'early_supporter', 'investor', 'partner',
  'moderator', 'testing', 'promotion', 'other', '',
]);
export const DURATIONS = new Set(['lifetime', 'none', '7d', '30d', '90d', 'custom']);

function store() {
  return getNamedStore(STORE_NAME);
}

// ── Grants ────────────────────────────────────────────────────────────────────
export async function readGrants() {
  try {
    const data = await store().get(GRANTS_KEY, { type: 'json' });
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

export async function writeGrants(grants) {
  await store().setJSON(GRANTS_KEY, grants);
}

export async function getGrant(userId) {
  const grants = await readGrants();
  return grants[userId] || null;
}

export async function setGrant(userId, record) {
  const grants = await readGrants();
  grants[userId] = record;
  await writeGrants(grants);
  return record;
}

// Compute the absolute expiry timestamp (ISO string) for a requested duration.
// Lifetime / "no expiration" -> null (never expires). Custom -> the supplied
// ISO date. Fixed windows -> now + N days.
export function computeExpiry(duration, customExpiry) {
  switch (duration) {
    case '7d': return new Date(Date.now() + 7 * DAY_MS).toISOString();
    case '30d': return new Date(Date.now() + 30 * DAY_MS).toISOString();
    case '90d': return new Date(Date.now() + 90 * DAY_MS).toISOString();
    case 'custom': {
      const ts = Date.parse(customExpiry || '');
      return Number.isNaN(ts) ? null : new Date(ts).toISOString();
    }
    case 'lifetime':
    case 'none':
    default:
      return null;
  }
}

// A grant is only "active" (i.e. actually unlocks Premium) when its status is
// active, it is a premium-tier plan, and it has not passed its expiry. Expiry
// is resolved at read time so a lapsed time-boxed grant silently stops
// unlocking features without needing a cleanup job.
export function isGrantActive(grant, now = Date.now()) {
  if (!grant || grant.status !== 'active') return false;
  if (grant.plan !== 'premium' && grant.plan !== 'early_supporter') return false;
  if (grant.expiresAt && Date.parse(grant.expiresAt) <= now) return false;
  return true;
}

// The plan the platform should treat this user as having, after expiry: an
// active premium/early-supporter grant reports that plan, everything else is
// 'free'. Never mutates storage.
export function effectivePlan(grant, now = Date.now()) {
  return isGrantActive(grant, now) ? grant.plan : 'free';
}

// ── Audit log (append-only, never deleted) ────────────────────────────────────
export async function readAudit() {
  try {
    const data = await store().get(AUDIT_KEY, { type: 'json' });
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function appendAudit(entry) {
  const log = await readAudit();
  log.unshift(entry);
  await store().setJSON(AUDIT_KEY, log);
  return entry;
}

export { jsonResponse };
