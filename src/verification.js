// Verified Project system - client module.
//
// Single source of truth: the verification status of every project lives in
// one server-side store (Netlify Blobs, see netlify/functions/_verificationStore.mjs)
// reached through the /.netlify/functions/verification-* endpoints below.
// Explore, Project Profile, Compare, and the PDF report all read from the same
// in-memory map (see fetchVerificationStatuses) so they can never disagree.
//
// Local dev note: when running plain `vite dev` (no Netlify Functions server),
// network calls below fail and each function transparently falls back to a
// localStorage-backed mock with the identical shape, so the full flow
// (request -> pending -> admin approve/reject -> verified badge) can still be
// tested end-to-end. The fallback is clearly isolated in `localFallback` below -
// swap in a real database behind the Netlify functions later without touching
// any UI code.

export const VERIFICATION_STATUS = {
  UNVERIFIED: 'unverified',
  PENDING: 'pending',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
};

const VALID_STATUSES = new Set(Object.values(VERIFICATION_STATUS));

export function normalizeVerificationStatus(value) {
  const normalized = String(value || '').toLowerCase();
  return VALID_STATUSES.has(normalized) ? normalized : VERIFICATION_STATUS.UNVERIFIED;
}

export function verificationStatusLabel(status) {
  const normalized = normalizeVerificationStatus(status);
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

const FALLBACK_KEY = 'khan-trust-verification-fallback-v1';
const ADMIN_TOKEN_KEY = 'khan-trust-admin-token-v1';
// Dev-only fallback passcode, used ONLY when the verification-admin-auth
// Netlify function is unreachable (e.g. plain `vite dev`). Real deployments
// must set the KHAN_ADMIN_PASSCODE server environment variable.
const DEV_FALLBACK_ADMIN_PASSCODE = 'khan-admin-dev';

function readFallbackStore() {
  try {
    const raw = localStorage.getItem(FALLBACK_KEY);
    return raw ? JSON.parse(raw) : { requests: [], statuses: {} };
  } catch {
    return { requests: [], statuses: {} };
  }
}

function writeFallbackStore(store) {
  try {
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(store));
  } catch {
    // ignore - dev fallback only
  }
}

// Only treat the backend as "unavailable" (eligible for the dev-only
// localStorage fallback) when the function genuinely could not be reached:
// a network-level failure (no response.status at all, e.g. plain `vite dev`
// with no Netlify Functions server) or a 404 because the route doesn't
// exist. Any other status (400/401/500/502...) means the function DID run
// and returned a real error - that must surface to the caller, not be
// silently swallowed into the fallback store.
function isFunctionUnavailable(error) {
  return Boolean(error) && (error.status === undefined || error.status === 404);
}

async function callFunction(path, options) {
  const response = await fetch(`/.netlify/functions/${path}`, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(body.message || `Request to ${path} failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export function buildVerificationMessage({ projectName, contract, walletAddress, timestamp }) {
  return [
    'KHAN Trust Verification Request',
    `Project: ${projectName}`,
    `Contract: ${contract}`,
    `Wallet: ${walletAddress}`,
    `Timestamp: ${timestamp}`,
    'I confirm I am the owner or authorized representative of this project and I am requesting KHAN Trust to verify this project profile.',
  ].join('\n');
}

// Wallet connection itself goes through the shared @solana/wallet-adapter
// context (see src/wallet/useKhanWallet.js) - this module only signs the
// ownership message once a wallet is already connected.
export function bytesToBase58(bytes) {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let digits = [0];
  for (let i = 0; i < bytes.length; i += 1) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j += 1) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let leadingZeros = 0;
  while (leadingZeros < bytes.length - 1 && bytes[leadingZeros] === 0) leadingZeros += 1;
  return ALPHABET[0].repeat(leadingZeros) + digits.reverse().map((digit) => ALPHABET[digit]).join('');
}

export async function signVerificationMessage(adapter, message) {
  if (!adapter?.signMessage) {
    throw new Error('Connected wallet does not support message signing.');
  }
  const encoded = new TextEncoder().encode(message);
  const signatureBytes = await adapter.signMessage(encoded);
  return bytesToBase58(signatureBytes instanceof Uint8Array ? signatureBytes : new Uint8Array(signatureBytes));
}

export async function submitVerificationRequest(payload) {
  try {
    return await callFunction('verification-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    if (!isFunctionUnavailable(error)) throw error;
    const store = readFallbackStore();
    const request = {
      ...payload,
      id: `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      status: VERIFICATION_STATUS.PENDING,
      createdAt: new Date().toISOString(),
      adminNote: '',
    };
    store.requests = [request, ...store.requests.filter((item) => item.projectId !== payload.projectId)];
    store.statuses[payload.projectId] = { status: VERIFICATION_STATUS.PENDING, updatedAt: request.createdAt, adminNote: '' };
    writeFallbackStore(store);
    return { ok: true, request, fallback: true };
  }
}

export async function fetchVerificationStatuses() {
  try {
    const data = await callFunction('verification-status', { method: 'GET' });
    return data.statuses || {};
  } catch {
    return readFallbackStore().statuses || {};
  }
}

export async function adminLogin(passcode) {
  try {
    const data = await callFunction('verification-admin-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode }),
    });
    sessionStorage.setItem(ADMIN_TOKEN_KEY, data.token);
    return data.token;
  } catch (error) {
    if (!isFunctionUnavailable(error)) throw error;
    if (passcode !== DEV_FALLBACK_ADMIN_PASSCODE) {
      throw new Error('Incorrect passcode.');
    }
    const token = `dev-fallback-${Date.now()}`;
    sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
    return token;
  }
}

export function getStoredAdminToken() {
  return sessionStorage.getItem(ADMIN_TOKEN_KEY) || '';
}

export function clearAdminToken() {
  sessionStorage.removeItem(ADMIN_TOKEN_KEY);
}

export async function fetchPendingRequests(token) {
  try {
    const data = await callFunction(`verification-admin-list?status=pending`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return data.requests || [];
  } catch (error) {
    if (!isFunctionUnavailable(error) || !token.startsWith('dev-fallback-')) throw error;
    const store = readFallbackStore();
    return store.requests.filter((request) => request.status === VERIFICATION_STATUS.PENDING);
  }
}

export async function fetchAllRequests(token) {
  try {
    const data = await callFunction(`verification-admin-list?status=all`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return data.requests || [];
  } catch (error) {
    if (!isFunctionUnavailable(error) || !token.startsWith('dev-fallback-')) throw error;
    return readFallbackStore().requests;
  }
}

export async function reviewVerificationRequest(token, { requestId, decision, adminNote }) {
  try {
    return await callFunction('verification-admin-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ requestId, decision, adminNote }),
    });
  } catch (error) {
    if (!isFunctionUnavailable(error) || !token.startsWith('dev-fallback-')) throw error;
    const store = readFallbackStore();
    const request = store.requests.find((item) => item.id === requestId);
    if (!request) throw new Error('Request not found.');
    request.status = decision;
    request.adminNote = adminNote || '';
    request.reviewedAt = new Date().toISOString();
    store.statuses[request.projectId] = {
      status: decision,
      updatedAt: request.reviewedAt,
      adminNote: request.adminNote,
    };
    writeFallbackStore(store);
    return { ok: true, request, fallback: true };
  }
}
