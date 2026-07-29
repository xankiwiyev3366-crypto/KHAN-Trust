// THE CANONICAL KEY FOR A TOKEN, in one place.
//
// Score history, watch snapshots, alerts and the Trust Graph corpus are all
// keyed by this string. Two callers that spell it differently do not produce an
// error — they produce two separate histories for one token, and neither of
// them is visibly wrong, which is the worst kind of bug to find later.
//
// It lived inside historyKeyFor() in src/scoreHistory.js, a module that imports
// React and therefore cannot be bundled into a Netlify Function. Paid
// verification needs to look a token up in the corpus SERVER-side (see
// verify-quote.mjs), so the choice was to re-implement the rule in a function or
// to lift it somewhere both sides can import. Re-implementing an identity rule
// is how the two copies drift and a paying customer is quoted against an empty
// history for a token that has been scanned fifty times.
//
// PURE MODULE — no React, no import.meta.env, no Node APIs — so it bundles into
// both the Vite client and a Function, the same contract pricing.js and
// trustScore.js hold. Enforced by scripts/verify-functions.mjs.

// Native chain coins (BTC, ETH, SOL, BNB, ...) all share the same literal
// placeholder contract string (see lookupNativeCoinGeckoAsset in main.jsx) —
// without this exclusion they'd all collide onto one shared key. Their
// project.id (e.g. "native-bitcoin") is the real unique identity.
export const NO_CONTRACT_PLACEHOLDERS = new Set(['not provided', 'native asset (no contract)']);

// Stable identity for a token regardless of how many times it is rescanned.
//
// Multi-chain safety: the SAME EVM/Move address can be deployed on many chains
// (0x… on Ethereum AND Base AND BSC …). Without the chain in the key their
// score history, watch snapshots and alerts would all collide onto one identity.
// Non-Solana chains therefore carry a `<chainId>:` prefix.
//
// Solana KEEPS the bare `c:<addr>` key it has always used: its base58 mints are
// globally unique so they never collide, and preserving the exact format keeps
// every pre-multichain Solana history/watch record intact. Changing it would
// orphan real data, so this asymmetry is permanent, not a wart to tidy up.
export function tokenIdentity({ contract, chainId, id } = {}) {
  const clean = String(contract || '').trim().toLowerCase();
  if (clean && !NO_CONTRACT_PLACEHOLDERS.has(clean)) {
    if (chainId && chainId !== 'solana') return `c:${chainId}:${clean}`;
    return `c:${clean}`;
  }
  return id ? `id:${id}` : '';
}
