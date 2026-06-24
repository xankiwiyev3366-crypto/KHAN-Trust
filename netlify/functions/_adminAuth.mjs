import crypto from 'node:crypto';

// Admin auth is intentionally simple: one shared passcode (server-side env
// var, never shipped to the client) exchanged for an HMAC-signed, time-limited
// token. Good enough to gate the verification review page without a full
// user/account system; replace with real auth when KHAN Trust grows accounts.
const ADMIN_PASSCODE = process.env.KHAN_ADMIN_PASSCODE || '';
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

function secret() {
  return ADMIN_PASSCODE || 'khan-trust-dev-secret';
}

export function checkPasscode(passcode) {
  return Boolean(ADMIN_PASSCODE) && passcode === ADMIN_PASSCODE;
}

export function issueToken() {
  const expires = Date.now() + TOKEN_TTL_MS;
  const signature = crypto.createHmac('sha256', secret()).update(String(expires)).digest('hex');
  return `${expires}.${signature}`;
}

export function verifyToken(token) {
  if (!token) return false;
  const [expiresRaw, signature] = String(token).split('.');
  const expires = Number(expiresRaw);
  if (!expires || !signature || Date.now() > expires) return false;
  const expected = crypto.createHmac('sha256', secret()).update(String(expires)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export function bearerToken(event) {
  const header = event.headers?.authorization || event.headers?.Authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}
