// Reads the server-recorded entitlement (see netlify/functions/entitlement-status.mjs)
// for the currently connected wallet, so Premium/Early Supporter UI can be
// gated on a real verified payment instead of a "team will handle it
// manually" message.
const ENTITLEMENT_ENDPOINT = '/.netlify/functions/entitlement-status';

export async function fetchEntitlement(walletAddress) {
  if (!walletAddress) return null;
  try {
    const response = await fetch(`${ENTITLEMENT_ENDPOINT}?wallet=${encodeURIComponent(walletAddress)}`);
    if (!response.ok) return null;
    const data = await response.json();
    return data?.entitlement || null;
  } catch {
    return null;
  }
}

export function hasPlanAccess(entitlement, plan) {
  if (!entitlement) return false;
  if (plan === 'premium') return entitlement.plan === 'premium' || entitlement.plan === 'early_supporter';
  return entitlement.plan === plan;
}
