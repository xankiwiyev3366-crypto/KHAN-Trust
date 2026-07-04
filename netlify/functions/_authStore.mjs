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
