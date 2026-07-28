// POST /.netlify/functions/solana-rpc
//
// Server-side proxy for the Solana JSON-RPC calls the token scanner makes.
//
// WHY THIS EXISTS
//
// The scanner's RPC endpoint came from `VITE_SOLANA_RPC_URL`. Vite inlines
// every VITE_-prefixed variable into the browser bundle, so when that variable
// was pointed at a keyed provider — as the deployment notes recommend, because
// the public endpoint rate-limits browser traffic — the provider's API key was
// shipped to every visitor and visible in the network tab of any scan. The
// project's own .env.example documents the key as "server-side only, never
// shipped to the browser"; the deployment contradicted that.
//
// A leaked RPC key is not only a billing problem. The scanner degrades to
// "holder count unavailable / mint authority unknown" the moment the quota is
// burned, so anyone who lifted it could quietly reduce the product's core
// output to blanks. This proxy keeps the credential server-side.
//
// WHY IT IS NOT AN OPEN RELAY
//
// Moving a key behind an unrestricted proxy just relocates the abuse. So:
//   - only the read-only methods this app actually calls are accepted; anything
//     else is refused without being forwarded (no transaction submission, no
//     subscriptions, no account mutation surface);
//   - single requests only — a JSON-RPC batch array is rejected, because one
//     request must not be able to fan out into hundreds of upstream calls;
//   - per-IP rate limiting through the shared sliding-window limiter.
//
// WHAT STILL TALKS TO A PUBLIC RPC DIRECTLY
//
// Wallet connection, payment verification and Launchpad minting keep using a
// browser-facing endpoint (VITE_SOLANA_PUBLIC_RPC_URL, which MUST be keyless).
// Those paths submit transactions and rely on websocket confirmation, neither
// of which survives a 10-second stateless function, and routing them here would
// risk breaking payments to fix a read-path leak.
import { checkRateLimit, getClientIp } from './_rateLimit.mjs';

// Server-side only. Falls back to the public endpoint so a deployment that has
// not set a provider still works, exactly as before.
const UPSTREAM_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// Exactly the methods src/providers/lookups.js calls, and nothing else.
// Adding one here is a deliberate act; a typo or an unexpected method name
// fails closed rather than being forwarded.
export const ALLOWED_METHODS = new Set([
  'getTokenSupply',
  'getTokenLargestAccounts',
  'getAccountInfo',
  'getProgramAccounts',
  'getSignaturesForAddress',
]);

const RATE_LIMIT = { max: 240, windowMs: 60_000 };

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

// A JSON-RPC error shaped like the upstream's, so the client's existing
// `if (payload.error) throw` path handles a refusal identically to any other
// RPC failure and needs no special case.
function rpcError(statusCode, id, message) {
  return json(statusCode, { jsonrpc: '2.0', id: id ?? null, error: { code: -32600, message } });
}

export function validateRpcRequest(body) {
  if (!body || typeof body !== 'object') return { ok: false, message: 'Malformed JSON-RPC request.' };
  if (Array.isArray(body)) return { ok: false, message: 'Batched JSON-RPC requests are not accepted.' };
  const method = typeof body.method === 'string' ? body.method : '';
  if (!method) return { ok: false, message: 'Missing JSON-RPC method.' };
  if (!ALLOWED_METHODS.has(method)) return { ok: false, message: `Method not allowed: ${method}` };
  if (body.params !== undefined && !Array.isArray(body.params)) {
    return { ok: false, message: 'JSON-RPC params must be an array.' };
  }
  return { ok: true, method };
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { message: 'Method not allowed' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return rpcError(400, null, 'Malformed JSON-RPC request.');
  }

  const validation = validateRpcRequest(body);
  if (!validation.ok) return rpcError(400, body?.id, validation.message);

  // Fails OPEN on a limiter outage, consistent with every other limiter in this
  // codebase: a blob outage must not take the scanner down.
  const limit = await checkRateLimit({
    bucket: 'solana-rpc',
    identifier: getClientIp(event),
    max: RATE_LIMIT.max,
    windowMs: RATE_LIMIT.windowMs,
  });
  if (!limit.allowed) {
    return rpcError(429, body.id, 'Too many RPC requests. Please retry shortly.');
  }

  try {
    const upstream = await fetch(UPSTREAM_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Rebuilt rather than forwarded verbatim, so no caller-supplied field
      // reaches the provider beyond the validated method and params.
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: body.id ?? validation.method,
        method: validation.method,
        params: body.params ?? [],
      }),
    });
    const payload = await upstream.text();
    return {
      statusCode: upstream.ok ? 200 : 502,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: payload,
    };
  } catch (error) {
    // The upstream URL may contain a credential — never echo it into a response
    // or a log line.
    console.error('[solana-rpc] upstream request failed', { method: validation.method, message: error.message });
    return rpcError(502, body.id, 'Solana RPC is temporarily unavailable.');
  }
}
