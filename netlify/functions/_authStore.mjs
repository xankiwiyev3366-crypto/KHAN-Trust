// Auth persistence layer: users, JWT tokens, email verification, password reset.
// Users keyed by email (lowercase) with an ID→email index for JWT lookups.
// Passwords hashed with PBKDF2-SHA512 (100 000 iterations) via Node crypto.
// JWT-like tokens signed with HMAC-SHA256 using AUTH_SECRET env var.
import crypto from 'node:crypto';
import { getNamedStore, jsonResponse } from './_blobsClient.mjs';

const STORE_NAME = 'khan-trust-auth';
// Fail closed: NEVER sign or verify tokens with a public fallback secret in a
// deployed environment. If AUTH_SECRET is unset in production, auth is treated
// as unconfigured (issueToken throws, verifyJwt returns null) rather than
// silently using a guessable default that would let anyone forge user JWTs.
// A clearly-insecure dev secret is allowed ONLY in local dev (netlify dev /
// tests) so the flow stays runnable without configuring env there.
const AUTH_SECRET_RAW = process.env.AUTH_SECRET || '';
const IS_DEPLOYED = (process.env.CONTEXT && process.env.CONTEXT !== 'dev') || process.env.NODE_ENV === 'production';
const DEV_ONLY_AUTH_SECRET = 'khan-trust-auth-dev-INSECURE-do-not-use-in-prod';

function authSecret() {
  if (AUTH_SECRET_RAW) return AUTH_SECRET_RAW;
  return IS_DEPLOYED ? null : DEV_ONLY_AUTH_SECRET;
}

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;   // 7 days
const RESET_TTL_MS = 60 * 60 * 1000;             // 1 hour
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;       // 24 hours

function store() {
  return getNamedStore(STORE_NAME);
}

// ── Password hashing ──────────────────────────────────────────────────────────
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  try {
    const [salt, hash] = stored.split(':');
    const test = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
  } catch {
    return false;
  }
}

// ── JWT-like tokens ───────────────────────────────────────────────────────────
function b64u(str) {
  return Buffer.from(str).toString('base64url');
}

export function issueToken(user) {
  const secret = authSecret();
  if (!secret) throw new Error('AUTH_SECRET is not configured');
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64u(JSON.stringify({
    sub: user.id,
    email: user.email,
    name: user.name,
    iat: Date.now(),
    exp: Date.now() + TOKEN_TTL_MS,
  }));
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

export function verifyJwt(token) {
  if (!token) return null;
  const secret = authSecret();
  if (!secret) return null; // unconfigured in production -> reject everything
  try {
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    const [header, payload, sig] = parts;
    const expected = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
    if (sig.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

export function bearerToken(event) {
  const header = event.headers?.authorization || event.headers?.Authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

// ── User CRUD ─────────────────────────────────────────────────────────────────
export async function getUserByEmail(email) {
  try {
    return await store().get(`user:email:${email.toLowerCase()}`, { type: 'json' });
  } catch {
    return null;
  }
}

export async function getUserById(id) {
  try {
    const email = await store().get(`user:id:${id}`, { type: 'text' });
    if (!email) return null;
    return getUserByEmail(email);
  } catch {
    return null;
  }
}

export async function saveUser(user) {
  await store().setJSON(`user:email:${user.email.toLowerCase()}`, user);
  await store().set(`user:id:${user.id}`, user.email.toLowerCase());
  return user;
}

export async function updateUser(id, updates) {
  const user = await getUserById(id);
  if (!user) return null;
  const updated = { ...user, ...updates, id: user.id, email: user.email };
  return saveUser(updated);
}

export async function countRegisteredUsers() {
  try {
    const result = await store().list({ prefix: 'user:email:' });
    return result.blobs?.length || 0;
  } catch {
    return 0;
  }
}

// ── Login state: DURABLE, on the user record ─────────────────────────────────
//
// Before this, "has this user ever logged in?" was answered by scanning the
// analytics event log for a `user_login` event. That was wrong in two
// independent ways, and both produced the same visible symptom — a wildly
// inflated "Never Logged In" count:
//
//   1. The event log is CAPPED at 20 000 events and evicts oldest-first
//      (_analyticsStore.mjs). "Has ever logged in" was therefore really "logged
//      in recently enough to survive the cap". A user who signed in months ago
//      silently reverted to "never logged in" as their event aged out. No query
//      can fix that; the row is gone.
//   2. Only auth-login.mjs ever wrote `user_login`. Registration auto-login,
//      email-verification auto-login and session restoration all issue or
//      accept a token — genuine successful authentications — and recorded
//      nothing at all.
//
// So login state now lives on the user record, where it is written once and
// never expires. An append-only fact about an account belongs on the account,
// not in a rolling telemetry buffer.
//
// FIELDS
//   hasLoggedIn   boolean  — true after the first successful authentication.
//   firstLoginAt  ISO      — set once, never overwritten.
//   lastLoginAt   ISO      — most recent successful authentication.
//   lastActiveAt  ISO      — most recent authenticated activity of any kind.
//
// `lastLoginAt` and `lastActiveAt` are separate on purpose: a session that is
// restored from a stored token is real authenticated ACTIVITY but it is not a
// fresh LOGIN, and collapsing the two would make "logged in today" indis-
// tinguishable from "had the tab open today".

// Which kinds of successful authentication exist. Recorded so the admin view
// can tell a real credential login from an auto-login, rather than guessing.
export const AUTH_METHOD = {
  PASSWORD: 'password',        // auth-login.mjs — email + password
  REGISTRATION: 'registration',// auth-register.mjs — token issued at signup
  EMAIL_VERIFY: 'email_verify',// auth-verify-email.mjs — token issued on verify
  SESSION: 'session',          // auth-me.mjs — valid stored JWT presented
};

// Records ONE successful authentication. Call this ONLY after credentials (or a
// valid signed token) have actually been verified — never on a failed attempt,
// never before the check. Every call site sits after its auth guard.
//
// `isLogin` distinguishes a fresh authentication (password, registration,
// email-verify) from a restored session. A restored session updates activity
// and, for a legacy account, proves the user HAS authenticated at some point —
// a valid signed JWT cannot exist otherwise — but it does not move
// `lastLoginAt`, because nobody typed a password.
//
// Best-effort and never throws: analytics must never be able to fail a login.
export async function recordSuccessfulAuth(userId, { method = AUTH_METHOD.PASSWORD, isLogin = true, now = Date.now() } = {}) {
  try {
    const user = await getUserById(userId);
    if (!user) return null;
    const iso = new Date(now).toISOString();

    const updates = {
      hasLoggedIn: true,
      // Set once. Overwriting it on every login would turn "first seen" into
      // "last seen" and quietly destroy cohort/retention analysis.
      firstLoginAt: user.firstLoginAt || iso,
      lastActiveAt: iso,
      lastAuthMethod: method,
    };
    if (isLogin) updates.lastLoginAt = iso;
    // A restored session for an account with no recorded login history still
    // needs SOME login timestamp, or the account shows as "logged in, never".
    else if (!user.lastLoginAt) updates.lastLoginAt = user.firstLoginAt || iso;

    return await updateUser(userId, updates);
  } catch {
    return null;
  }
}

// Reads every user once and returns the authoritative account-level metrics.
//
// This is THE source for the admin dashboard's user cards. It is computed from
// the user records themselves — not from telemetry, not from a counter, not
// from a cache — so `registered === loggedIn + neverLoggedIn` holds by
// construction: every account falls in exactly one of the two buckets, because
// the buckets are defined by a single boolean on that account.
//
// `now` is injectable so tests can pin day boundaries.
export async function getUserLoginStats({ now = Date.now() } = {}) {
  const result = await store().list({ prefix: 'user:email:' });
  const blobs = result.blobs || [];
  const users = await Promise.all(
    blobs.map((b) => store().get(b.key, { type: 'json' }).catch(() => null))
  );
  const records = users.filter(Boolean);

  const today = new Date(now).toISOString().slice(0, 10);
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

  let loggedIn = 0;
  let neverLoggedIn = 0;
  // Sets, not counters: one user active five times today must count ONCE.
  // Keyed by user id, so duplicate sessions/requests collapse.
  const activeTodayIds = new Set();
  const activeWeekIds = new Set();

  for (const user of records) {
    if (user.hasLoggedIn === true) loggedIn += 1;
    else neverLoggedIn += 1;

    // Activity requires having authenticated. An account that never logged in
    // cannot be "active", regardless of any stray timestamp.
    if (user.hasLoggedIn !== true) continue;
    const activeAt = user.lastActiveAt || user.lastLoginAt;
    if (!activeAt) continue;
    const ts = Date.parse(activeAt);
    if (Number.isNaN(ts)) continue;

    // Today = UTC calendar day, matching every other day-bucket in this
    // codebase (scan quota, retention streaks, analytics dateKey).
    if (activeAt.slice(0, 10) === today) activeTodayIds.add(user.id);
    // This week = ROLLING 7 days, not "sum of the last 7 daily counts" — a
    // user active on three of those days still counts once.
    if (ts >= weekAgo && ts <= now) activeWeekIds.add(user.id);
  }

  return {
    registeredUsers: records.length,
    loggedInUsers: loggedIn,
    neverLoggedInUsers: neverLoggedIn,
    activeToday: activeTodayIds.size,
    activeLast7Days: activeWeekIds.size,
  };
}

export async function listRegisteredUsers(limit = 100) {
  try {
    const result = await store().list({ prefix: 'user:email:' });
    const blobs = (result.blobs || []).slice(0, limit);
    const users = await Promise.all(blobs.map((b) => store().get(b.key, { type: 'json' }).catch(() => null)));
    return users.filter(Boolean).map(({ passwordHash, ...u }) => u);
  } catch {
    return [];
  }
}

// ── One-time tokens ───────────────────────────────────────────────────────────
function randomToken() {
  return crypto.randomBytes(32).toString('hex');
}

export async function createVerifyToken(email) {
  const token = randomToken();
  await store().setJSON(`verify:${token}`, { email: email.toLowerCase(), expires: Date.now() + VERIFY_TTL_MS });
  return token;
}

export async function consumeVerifyToken(token) {
  try {
    const data = await store().get(`verify:${token}`, { type: 'json' });
    if (!data || data.expires < Date.now()) return null;
    await store().delete(`verify:${token}`);
    return data.email;
  } catch {
    return null;
  }
}

export async function createResetToken(email) {
  const token = randomToken();
  await store().setJSON(`reset:${token}`, { email: email.toLowerCase(), expires: Date.now() + RESET_TTL_MS });
  return token;
}

export async function consumeResetToken(token) {
  try {
    const data = await store().get(`reset:${token}`, { type: 'json' });
    if (!data || data.expires < Date.now()) return null;
    await store().delete(`reset:${token}`);
    return data.email;
  } catch {
    return null;
  }
}

export { jsonResponse };
