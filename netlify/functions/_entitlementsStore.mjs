// Persistence layer for paid access. Keyed by Solana wallet address rather
// than a user account, since the site has no auth/accounts system - the
// connected wallet is the identity. Uses Netlify Blobs so entitlements
// survive across deploys/instances instead of living only in a browser.
import { getNamedStore, jsonResponse } from './_blobsClient.mjs';

const STORE_NAME = 'khan-trust-entitlements';
const ENTITLEMENTS_KEY = 'entitlements.json';
const USED_SIGNATURES_KEY = 'used-signatures.json';

function store() {
  return getNamedStore(STORE_NAME);
}

export async function readEntitlements() {
  const data = await store().get(ENTITLEMENTS_KEY, { type: 'json' });
  return data && typeof data === 'object' ? data : {};
}

export async function writeEntitlements(entitlements) {
  await store().setJSON(ENTITLEMENTS_KEY, entitlements);
}

export async function getEntitlement(walletAddress) {
  const entitlements = await readEntitlements();
  return entitlements[walletAddress] || null;
}

export async function grantEntitlement(walletAddress, record) {
  const entitlements = await readEntitlements();
  entitlements[walletAddress] = record;
  await writeEntitlements(entitlements);
}

// A confirmed transaction signature can only ever redeem one entitlement -
// without this, the same paid tx hash could be replayed against the verify
// endpoint repeatedly to grant access to other wallets.
export async function readUsedSignatures() {
  const data = await store().get(USED_SIGNATURES_KEY, { type: 'json' });
  return data && typeof data === 'object' ? data : {};
}

export async function markSignatureUsed(signature, walletAddress) {
  const used = await readUsedSignatures();
  used[signature] = { walletAddress, usedAt: new Date().toISOString() };
  await store().setJSON(USED_SIGNATURES_KEY, used);
}

export async function isSignatureUsed(signature) {
  const used = await readUsedSignatures();
  return Boolean(used[signature]);
}

export { jsonResponse };
