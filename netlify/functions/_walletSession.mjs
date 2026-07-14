// Wallet ownership proof (P0-1). Closes the IDOR where premium user-data was
// keyed by a raw, unproven wallet address that anyone could supply. Flow:
//
//   1. client POSTs its wallet to wallet-challenge  -> server stores a one-time
//      nonce message and returns it.
//   2. the wallet signs that exact message (ed25519 signMessage - free, not a
//      transaction).
//   3. client POSTs {wallet, signature} to wallet-auth -> server verifies the
//      signature against the wallet's public key with tweetnacl, then issues a
//      short-lived HMAC wallet-session token bound to that wallet.
//   4. user-data-get/save only trust a wallet identity when a valid token for
//      that exact wallet is presented (x-khan-wallet-auth header). A raw
//      ?wallet= with no token is never treated as owning that wallet's data.
//
// The token is signed with AUTH_SECRET using the same fail-closed rule as the
// user JWTs: in a deployed environment with no secret, signing/verifying is
// disabled (nothing validates) rather than falling back to a guessable default.
import crypto from 'node:crypto';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { getNamedStore } from './_blobsClient.mjs';

const STORE_NAME = 'khan-trust-wallet-sessions';
const CHALLENGE_TTL_MS = 5 * 60 * 1000;      // 5 minutes to sign
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;    // 24h session

const AUTH_SECRET_RAW = process.env.AUTH_SECRET || '';
const IS_DEPLOYED = (process.env.CONTEXT && process.env.CONTEXT !== 'dev') || process.env.NODE_ENV === 'production';
const DEV_ONLY_SECRET = 'khan-trust-wallet-dev-INSECURE-do-not-use-in-prod';

function secret() {
  if (AUTH_SECRET_RAW) return AUTH_SECRET_RAW;
  return IS_DEPLOYED ? null : DEV_ONLY_SECRET;
}

const BASE58_WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isValidWallet(wallet) {
  return BASE58_WALLET.test(String(wallet || '').trim());
}

function store() {
  return getNamedStore(STORE_NAME);
}

// ── Challenge (nonce) ────────────────────────────────────────────────────────
function buildChallengeMessage(wallet, nonce, issuedIso) {
  return [
    'KHAN Trust — verify wallet ownership',
    '',
    'Sign this message to access your saved reports and watchlist.',
    'This is free and does NOT authorize any transaction or transfer.',
    '',
    `Wallet: ${wallet}`,
    `Nonce: ${nonce}`,
    `Issued: ${issuedIso}`,
  ].join('\n');
}

export async function createChallenge(wallet, { getStoreFn = store } = {}) {
  const nonce = crypto.randomBytes(24).toString('hex');
  const issuedIso = new Date().toISOString();
  const message = buildChallengeMessage(wallet, nonce, issuedIso);
  await getStoreFn().setJSON(`challenge:${wallet}`, { message, expires: Date.now() + CHALLENGE_TTL_MS });
  return message;
}

async function consumeChallenge(wallet, { getStoreFn = store } = {}) {
  try {
    const data = await getStoreFn().get(`challenge:${wallet}`, { type: 'json' });
    if (!data || data.expires < Date.now()) return null;
    await getStoreFn().delete(`challenge:${wallet}`);
    return data.message;
  } catch {
    return null;
  }
}

// ── Signature verification ───────────────────────────────────────────────────
// Verifies an ed25519 signMessage() signature (base64) against the wallet's
// public key (the base58 address decodes to the 32-byte pubkey).
export function verifyWalletSignature(wallet, message, signatureB64) {
  try {
    const pub = bs58.decode(wallet);
    if (pub.length !== 32) return false;
    const msgBytes = new TextEncoder().encode(message);
    const sigBytes = Buffer.from(String(signatureB64 || ''), 'base64');
    if (sigBytes.length !== 64) return false;
    return nacl.sign.detached.verify(msgBytes, sigBytes, pub);
  } catch {
    return false;
  }
}

// Full server step: verify the signature for the wallet's outstanding challenge
// and, on success, issue a session token. Returns the token or null.
export async function verifyAndIssue(wallet, signatureB64, opts = {}) {
  if (!isValidWallet(wallet)) return null;
  const message = await consumeChallenge(wallet, opts);
  if (!message) return null;
  if (!verifyWalletSignature(wallet, message, signatureB64)) return null;
  return issueWalletToken(wallet);
}

// ── Session token (HMAC, bound to the wallet) ────────────────────────────────
export function issueWalletToken(wallet) {
  const key = secret();
  if (!key) throw new Error('AUTH_SECRET is not configured');
  const expires = Date.now() + TOKEN_TTL_MS;
  const payload = `${wallet}.${expires}`;
  const sig = crypto.createHmac('sha256', key).update(payload).digest('hex');
  return { token: `${payload}.${sig}`, expires };
}

// Returns the wallet address the token proves ownership of, or null.
export function walletFromToken(token) {
  if (!token) return null;
  const key = secret();
  if (!key) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const [wallet, expiresRaw, sig] = parts;
  const expires = Number(expiresRaw);
  if (!wallet || !expires || Date.now() > expires) return null;
  const expected = crypto.createHmac('sha256', key).update(`${wallet}.${expires}`).digest('hex');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  return wallet;
}

// Pulls the wallet-session token from the request and returns the proven wallet.
export function provenWallet(event) {
  const headers = event?.headers || {};
  const token = headers['x-khan-wallet-auth'] || headers['X-Khan-Wallet-Auth'] || '';
  return walletFromToken(token);
}
