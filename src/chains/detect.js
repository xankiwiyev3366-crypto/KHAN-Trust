// Chain auto-detection from a raw contract/coin address (requirement 4).
//
// Detection is about the ADDRESS FORMAT only — it is deterministic, offline, and
// cannot be wrong about the FAMILY. It deliberately does NOT try to guess the
// specific EVM chain (Ethereum vs Base vs BSC …) because the same 20-byte
// address can be deployed on every EVM chain: which one a given token actually
// lives on is a question for a data provider, not a regex. So detection returns
// a family plus the candidate chain ids, and the adapter layer resolves the
// exact chain by asking Dexscreener which chain has real liquidity for it.
//
// The one honest ambiguity is Move: Sui and Aptos both use 0x-prefixed 32-byte
// addresses and `0x…::module::TYPE` coin types. Detection returns both as
// candidates rather than picking one; the resolver tries each provider.

import { EVM_CHAIN_IDS } from './registry.js';

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
// Base58, no 0x, 32–44 chars — the Solana mint shape. Excludes 0/O/I/l by the
// base58 alphabet, same pattern the app already used for Solana.
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
// A Move 32-byte object/account address (Sui or Aptos), 0x + 64 hex.
const MOVE_ADDRESS = /^0x[0-9a-fA-F]{64}$/;
// A Move coin TYPE, e.g. 0x2::sui::SUI or 0x1::aptos_coin::AptosCoin.
const MOVE_COIN_TYPE = /^0x[0-9a-fA-F]{1,64}::[A-Za-z0-9_]+::[A-Za-z0-9_]+$/;

/**
 * Detects the chain family and candidate chain ids from an address.
 * @returns {{ family: 'evm'|'solana'|'move', candidates: string[], resolved: boolean } | null}
 *   `resolved` is true when the candidate list is a single, certain chain
 *   (Solana today); false when the exact chain still needs provider resolution
 *   (EVM across chains, or Sui-vs-Aptos). null when the string matches no known
 *   address format — the caller must then fall back to a name search, never to
 *   a guessed chain.
 */
export function detectChain(rawAddress) {
  const address = String(rawAddress || '').trim();
  if (!address) return null;

  if (EVM_ADDRESS.test(address)) {
    return { family: 'evm', candidates: EVM_CHAIN_IDS, resolved: false };
  }
  // Move must be tested before Solana: a 0x-prefixed string is never a Solana
  // base58 mint, but keeping the order explicit documents the intent.
  if (MOVE_ADDRESS.test(address) || MOVE_COIN_TYPE.test(address)) {
    return { family: 'move', candidates: ['sui', 'aptos'], resolved: false };
  }
  if (SOLANA_ADDRESS.test(address)) {
    return { family: 'solana', candidates: ['solana'], resolved: true };
  }
  return null;
}

export function looksLikeContractAddress(rawAddress) {
  return detectChain(rawAddress) !== null;
}

// Convenience: true only for the certain single-chain case, used where the UI
// wants to skip the provider round-trip (Solana direct paste).
export function isResolvedChain(rawAddress) {
  const detected = detectChain(rawAddress);
  return Boolean(detected?.resolved);
}
