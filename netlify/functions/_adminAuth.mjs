import crypto from 'node:crypto';

// Admin auth is intentionally simple: one shared passcode (server-side env
// var, never shipped to the client) exchanged for an HMAC-signed, time-limited
// token. Good enough to gate the verification review page without a full
// user/account system; replace with real auth when KHAN Trust grows accounts.
const ADMIN_PASSCODE = process.env.KHAN_ADMIN_PASSCODE || '';
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

// Fail closed: in a deployed environment the token-signing secret must come
// from KHAN_ADMIN_PASSCODE. If it is unset in production, secret() returns null
// so verifyToken rejects EVERY token instead of validating tokens forged with a
// public default. A clearly-insecure dev secret is used ONLY in local dev.
const IS_DEPLOYED = (process.env.CONTEXT && process.env.CONTEXT !== 'dev') || process.env.NODE_ENV === 'production';
const DEV_ONLY_ADMIN_SECRET = 'khan-trust-admin-dev-INSECURE-do-not-use-in-prod';

function secret() {
  if (ADMIN_PASSCODE) return ADMIN_PASSCODE;
  return IS_DEPLOYED ? null : DEV_ONLY_ADMIN_SECRET;
}

export function checkPasscode(passcode) {
  return Boolean(ADMIN_PASSCODE) && passcode === ADMIN_PASSCODE;
}

export function issueToken() {
  const key = secret();
  if (!key) throw new Error('KHAN_ADMIN_PASSCODE is not configured');
  const expires = Date.now() + TOKEN_TTL_MS;
  const signature = crypto.createHmac('sha256', key).update(String(expires)).digest('hex');
  return `${expires}.${signature}`;
}

export function verifyToken(token) {
  if (!token) return false;
  const key = secret();
  if (!key) return false; // unconfigured in production -> reject everything
  const [expiresRaw, signature] = String(token).split('.');
  const expires = Number(expiresRaw);
  if (!expires || !signature || Date.now() > expires) return false;
  const expected = crypto.createHmac('sha256', key).update(String(expires)).digest('hex');
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  // Length guard: timingSafeEqual throws on unequal-length buffers.
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

export function bearerToken(event) {
  const header = event.headers?.authorization || event.headers?.Authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}
