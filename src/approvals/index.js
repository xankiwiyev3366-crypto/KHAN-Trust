// Lane registry: maps a chain to the module that knows how to read and remove
// approvals on it. This is the seam that keeps the scanner chain-agnostic.
//
// ADDING EVM LATER
//
// An EVM lane implements the same three functions as solanaLane.js:
//
//   scan({ connection, publicKey, tokenLookup })  -> { ok, status, approvals[], message? }
//   prepareRevoke({ connection, publicKey, approval }) -> { ok, status, ...prepared, feeLamports }
//   executeRevoke({ connection, sendTransaction, prepared }) -> { ok, status, signature?, message? }
//
// ...normalizes its data into the shape src/approvals/approvalEngine.js expects,
// registers itself in LANES below, and the engine, the hook (useApprovalScanner)
// and the page work with zero changes. The risk rules are already chain-neutral.
//
// The honest part of that promise: EVM's wallet connection does NOT exist in
// this app yet (there is no ethers/viem/wagmi - the wallet layer is Solana-only,
// see src/wallet/useKhanWallet.js). EVM chains are read-only here, analysed via
// the block-explorer proxy. So an EVM lane needs a wallet connector and an
// approval-log source before it can implement the interface above. This registry
// is what makes that additive rather than a rewrite; it is not a claim that the
// work is small.
import * as solanaLane from './solanaLane.js';

const LANES = {
  solana: solanaLane,
};

// Chains the scanner can actually scan today. The UI reads this rather than
// hardcoding 'solana', so an added lane appears without a UI change.
export const SUPPORTED_APPROVAL_CHAINS = Object.keys(LANES);

export function laneFor(chain) {
  return LANES[chain] || null;
}

export function isChainSupported(chain) {
  return Boolean(LANES[chain]);
}

export { solanaLane };
