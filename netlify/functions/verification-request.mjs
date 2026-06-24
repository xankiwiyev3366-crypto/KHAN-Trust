import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { readRequests, writeRequests, readStatuses, writeStatuses, jsonResponse } from './_verificationStore.mjs';

const REQUIRED_FIELDS = ['projectId', 'projectName', 'contract', 'ownerWallet', 'walletAddress', 'signature', 'timestamp'];

function buildVerificationMessage({ projectName, contract, walletAddress, timestamp }) {
  return [
    'KHAN Trust Verification Request',
    `Project: ${projectName}`,
    `Contract: ${contract}`,
    `Wallet: ${walletAddress}`,
    `Timestamp: ${timestamp}`,
    'I confirm I am the owner or authorized representative of this project and I am requesting KHAN Trust to verify this project profile.',
  ].join('\n');
}

function verifyOwnershipSignature(payload) {
  try {
    const message = buildVerificationMessage(payload);
    const messageBytes = new TextEncoder().encode(message);
    const signatureBytes = bs58.decode(payload.signature);
    const publicKeyBytes = bs58.decode(payload.walletAddress);
    return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
  } catch {
    return false;
  }
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { message: 'Method not allowed' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { message: 'Invalid request body' });
  }

  const missing = REQUIRED_FIELDS.filter((field) => !String(payload[field] || '').trim());
  if (missing.length) {
    return jsonResponse(400, { message: `Missing required fields: ${missing.join(', ')}` });
  }

  if (payload.walletAddress !== payload.ownerWallet) {
    return jsonResponse(400, { message: 'Owner wallet must match the connected and signed wallet.' });
  }

  if (!verifyOwnershipSignature(payload)) {
    return jsonResponse(400, { message: 'Wallet signature could not be verified.' });
  }

  const requests = await readRequests();
  const statuses = await readStatuses();

  const request = {
    id: `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    projectId: payload.projectId,
    projectName: payload.projectName,
    contract: payload.contract,
    website: payload.website || '',
    twitter: payload.twitter || '',
    telegram: payload.telegram || '',
    ownerWallet: payload.ownerWallet,
    walletAddress: payload.walletAddress,
    signature: payload.signature,
    timestamp: payload.timestamp,
    proofNote: payload.proofNote || '',
    status: 'pending',
    adminNote: '',
    createdAt: new Date().toISOString(),
  };

  const dedupedRequests = requests.filter((item) => item.projectId !== payload.projectId);
  await writeRequests([request, ...dedupedRequests]);

  statuses[payload.projectId] = { status: 'pending', updatedAt: request.createdAt, adminNote: '' };
  await writeStatuses(statuses);

  return jsonResponse(200, { ok: true, request });
}
