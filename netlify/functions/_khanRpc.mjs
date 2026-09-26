// Solana JSON-RPC for the KHAN holder-analytics modules (_khanIndexer.mjs and
// _khanMarket.mjs). A Helius key, when configured, takes precedence over the
// public endpoint; the key stays server-side and never appears in an error.
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';

export const HAS_DEDICATED_RPC = Boolean(HELIUS_API_KEY);

const RPC_URL = HELIUS_API_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`
  : process.env.SOLANA_RPC_URL || process.env.VITE_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

export async function solanaRpc(method, params) {
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params }),
  });
  if (!response.ok) throw new Error(`${method} failed (${response.status}).`);
  const payload = await response.json();
  if (payload.error) throw new Error(`${method}: ${payload.error.message}`);
  return payload.result;
}
