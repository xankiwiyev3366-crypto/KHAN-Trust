// Isolated, additive record of "which registered account was seen with a
// connected Solana wallet". This exists ONLY to answer the admin panel's
// "Wallet Connected (Yes/No)" column - accounts and wallets are otherwise two
// independent identity systems on this platform (see _premiumAccess.mjs), and
// nothing here changes that:
//  - It never reads or writes the auth, premium, entitlement, or payment
//    stores. It cannot grant, gate, or revoke anything.
//  - It is best-effort telemetry keyed by the account id; a missing entry just
//    means "no wallet observed for this account yet", never an error.
import { getNamedStore } from './_blobsClient.mjs';

const STORE_NAME = 'khan-trust-wallet-links';
const LINKS_KEY = 'links.json';

function store() {
  return getNamedStore(STORE_NAME);
}

export async function readWalletLinks() {
  try {
    const data = await store().get(LINKS_KEY, { type: 'json' });
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

// Record (or refresh) the wallet most recently seen with this account. Keeps
// the first-seen timestamp stable so the admin can tell a long-standing linked
// wallet from a brand-new one.
export async function recordWalletLink(userId, wallet) {
  if (!userId || !wallet) return null;
  const links = await readWalletLinks();
  const prev = links[userId] || null;
  const nowIso = new Date().toISOString();
  const record = {
    wallet,
    firstLinkedAt: prev?.firstLinkedAt || nowIso,
    lastSeenAt: nowIso,
  };
  links[userId] = record;
  await store().setJSON(LINKS_KEY, links);
  return record;
}
