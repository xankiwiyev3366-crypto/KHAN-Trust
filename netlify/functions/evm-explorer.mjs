// GET /.netlify/functions/evm-explorer?chain=<id>&action=creation|flags&address=0x...
//
// Server-side proxy for the Etherscan-family block-explorer lookups that the
// client used to call directly with an API key baked into the browser bundle
// (VITE_ETHERSCAN_API_KEY etc. — publicly readable). Moving them here keeps the
// keys server-only (P1-4). Behaviour is otherwise identical to the old client
// code, including the "no key configured -> null (Unknown), never a guess"
// contract, so a token whose chain has no key still resolves to Unknown exactly
// as before.
//
// Migration note: the key can stay named VITE_ETHERSCAN_API_KEY in Netlify
// (functions read every env var via process.env regardless of prefix), so no
// dashboard change is required for this to start working; but the recommended
// end state is to rename them to the un-prefixed server names below so the
// VITE_ copies can be deleted and never risk being re-bundled by a future
// client reference.
import { jsonResponse } from './_blobsClient.mjs';

const CHAINS = {
  ethereum: { base: 'https://api.etherscan.io/api', keys: ['ETHERSCAN_API_KEY', 'VITE_ETHERSCAN_API_KEY'] },
  bsc: { base: 'https://api.bscscan.com/api', keys: ['BSCSCAN_API_KEY', 'VITE_BSCSCAN_API_KEY'] },
  base: { base: 'https://api.basescan.org/api', keys: ['BASESCAN_API_KEY', 'VITE_BASESCAN_API_KEY'] },
  polygon: { base: 'https://api.polygonscan.com/api', keys: ['POLYGONSCAN_API_KEY', 'VITE_POLYGONSCAN_API_KEY'] },
};

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const VALID_ACTIONS = new Set(['creation', 'flags']);

function keyFor(chain) {
  const cfg = CHAINS[chain];
  if (!cfg) return '';
  for (const name of cfg.keys) {
    const value = process.env[name];
    if (value) return value;
  }
  return '';
}

// Contract creation timestamp (ms): creation tx -> its block -> block timestamp.
async function lookupCreation(base, apiKey, address) {
  const creationResponse = await fetch(`${base}?module=contract&action=getcontractcreation&contractaddresses=${address}&apikey=${apiKey}`);
  if (!creationResponse.ok) throw new Error('Explorer contract-creation lookup failed.');
  const creationData = await creationResponse.json();
  const txHash = creationData?.result?.[0]?.txHash;
  if (!txHash) return null;
  const txResponse = await fetch(`${base}?module=proxy&action=eth_getTransactionByHash&txhash=${txHash}&apikey=${apiKey}`);
  const txData = await txResponse.json();
  const blockNumber = txData?.result?.blockNumber;
  if (!blockNumber) return null;
  const blockResponse = await fetch(`${base}?module=proxy&action=eth_getBlockByNumber&tag=${blockNumber}&boolean=false&apikey=${apiKey}`);
  const blockData = await blockResponse.json();
  const timestampHex = blockData?.result?.timestamp;
  return timestampHex ? Number(timestampHex) * 1000 : null;
}

// Contract flags: is it an upgradeable proxy, and is the source verified?
async function lookupFlags(base, apiKey, address) {
  const response = await fetch(`${base}?module=contract&action=getsourcecode&address=${address}&apikey=${apiKey}`);
  if (!response.ok) throw new Error('Explorer source-code lookup failed.');
  const data = await response.json();
  const result = data?.result?.[0];
  if (!result) return null;
  return {
    upgradeable: result.Proxy === '1',
    verifiedSource: Boolean(result.SourceCode && String(result.SourceCode).trim()),
  };
}

export async function handler(event) {
  try {
    const params = event.queryStringParameters || {};
    const chain = String(params.chain || '').toLowerCase();
    const action = String(params.action || '').toLowerCase();
    const address = String(params.address || '').trim();

    if (!CHAINS[chain]) return jsonResponse(400, { reason: 'unsupported_chain', message: 'Unsupported chain.' });
    if (!VALID_ACTIONS.has(action)) return jsonResponse(400, { reason: 'invalid_action', message: 'Invalid action.' });
    // Strict allow-list on the address prevents this proxy from being used to
    // reach arbitrary explorer endpoints (SSRF): only a canonical EVM address
    // is ever interpolated into the upstream URL.
    if (!EVM_ADDRESS.test(address)) return jsonResponse(400, { reason: 'invalid_address', message: 'Invalid EVM address.' });

    const apiKey = keyFor(chain);
    // No key configured for this chain -> Unknown, exactly like the old client.
    if (!apiKey) return jsonResponse(200, { ok: true, configured: false, result: null });

    const { base } = CHAINS[chain];
    const result = action === 'creation'
      ? { timestampMs: await lookupCreation(base, apiKey, address) }
      : { flags: await lookupFlags(base, apiKey, address) };

    return jsonResponse(200, { ok: true, configured: true, result });
  } catch (error) {
    // Upstream/parse failure -> Unknown, never a fabricated value.
    return jsonResponse(200, { ok: false, configured: true, result: null, message: error.message });
  }
}
