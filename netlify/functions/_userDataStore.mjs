// Persistence for Premium/Early Supporter-exclusive user data (saved
// reports, synced watchlist), keyed by wallet address - same identity model
// as _entitlementsStore.mjs since there are no user accounts. Writes are
// gated server-side by checking the entitlement record directly (see
// requireEntitledWallet in user-data-save.mjs) rather than trusting the
// client's view of its own plan.
import { getNamedStore, jsonResponse } from './_blobsClient.mjs';

const STORE_NAME = 'khan-trust-user-data';
const DATA_KEY = 'user-data.json';

function store() {
  return getNamedStore(STORE_NAME);
}

export async function readAllUserData() {
  const data = await store().get(DATA_KEY, { type: 'json' });
  return data && typeof data === 'object' ? data : {};
}

export async function writeAllUserData(allData) {
  await store().setJSON(DATA_KEY, allData);
}

export async function getUserData(walletAddress) {
  const allData = await readAllUserData();
  return allData[walletAddress] || { savedReports: [], watchlist: [] };
}

export async function setUserData(walletAddress, record) {
  const allData = await readAllUserData();
  allData[walletAddress] = record;
  await writeAllUserData(allData);
  return record;
}

export { jsonResponse };
