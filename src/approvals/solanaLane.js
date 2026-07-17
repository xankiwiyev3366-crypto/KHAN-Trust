// The Solana lane: the ONLY file that knows how a token approval is represented
// on Solana, or how to remove one. Everything chain-specific lives behind the
// three functions at the bottom (scan / prepareRevoke / executeRevoke), which is
// the interface src/approvals/index.js registers and the UI consumes. An EVM
// lane implements the same three and drops in without touching the engine, the
// hook, or the page.
//
// SOLANA CALLS IT A DELEGATE
//
// EVM's `approve(spender, amount)` sets an allowance on a token contract.
// Solana's equivalent is `approve(delegate, amount)` on a TOKEN ACCOUNT: the
// delegate may transfer up to `delegatedAmount` out of that one account. So a
// Solana approval is per-account, not per-(token, spender) - which is why
// `accountAddress` is the thing being revoked here, and why the token PROGRAM
// that owns the account has to travel with the record (see programId below).
//
// BOTH TOKEN PROGRAMS ARE SCANNED
//
// Legacy SPL Token and Token-2022 are separate on-chain programs with separate
// account sets. Scanning only the legacy one - the easy mistake, since it is
// what `TOKEN_PROGRAM_ID` alone gives you - would silently miss every Token-2022
// approval and report "no approvals found" to a user who has one. A security
// scanner that misses a whole program class is worse than none, because it is
// believed.
//
// REVOKING IS NOT A TRANSFER
//
// `createRevokeInstruction` removes the delegate from a token account. It moves
// no tokens, takes no amount, and has no recipient - the only cost is the
// network fee. There is no path in this file that can transfer a user's funds,
// and nothing here ever touches a private key or seed phrase: the transaction is
// built here and signed inside the user's own wallet extension, which is the
// only thing that holds the key.
import { PublicKey, Transaction } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createRevokeInstruction,
} from '@solana/spl-token';

export const CHAIN = 'solana';

// Fallback only for DISPLAY when the RPC cannot price the message (see
// prepareRevoke). A revoke is a single-instruction, single-signature
// transaction, so this is the base signature fee. It is never used to decide
// whether to send - only ever to avoid showing a blank where a fee belongs, and
// the UI marks an estimate as approximate.
const LAMPORTS_PER_SOL = 1_000_000_000;

// Which token programs own approvable accounts. Adding a future program is one
// entry here; nothing else in the lane changes.
const TOKEN_PROGRAMS = [
  { programId: TOKEN_PROGRAM_ID, standard: 'spl-token' },
  { programId: TOKEN_2022_PROGRAM_ID, standard: 'spl-token-2022' },
];

export function lamportsToSol(lamports) {
  if (!Number.isFinite(lamports)) return null;
  return lamports / LAMPORTS_PER_SOL;
}

// Normalizes one parsed token account into the engine's chain-agnostic shape,
// or null when the account carries no delegate (the overwhelming majority).
//
// `tokenLookup` maps a mint address to a token the user has already scanned, so
// a name/symbol is shown when the app genuinely knows one. It is NOT filled in
// from a third-party list: an unknown mint stays unknown and the UI shows the
// raw address. Labelling the wrong token here would tell someone their USDC is
// safe while a drainer sits on a different mint.
function normalizeAccount(entry, standard, tokenLookup) {
  const info = entry?.account?.data?.parsed?.info;
  if (!info) return null;

  const delegate = info.delegate;
  if (!delegate) return null; // no approval on this account - nothing to report

  const decimalsRaw = info.tokenAmount?.decimals;
  const decimals = Number.isInteger(decimalsRaw) ? decimalsRaw : null;
  const mint = info.mint || '';
  const known = tokenLookup?.[mint] || null;

  return {
    // Stable across scans: the same approval keeps its identity, so React keys
    // and any per-row UI state survive a re-scan after a revoke.
    id: `${CHAIN}:${entry.pubkey.toString()}:${delegate}`,
    chain: CHAIN,
    standard,
    // Solana revokes a token ACCOUNT's delegate, so this - not the mint - is
    // what the revoke instruction needs.
    accountAddress: entry.pubkey.toString(),
    // The token program that owns this account. createRevokeInstruction MUST be
    // given the matching program or the instruction is rejected on-chain; a
    // Token-2022 account revoked against the legacy program id fails. This is
    // why the standard travels with the record instead of being re-derived.
    programId: standard === 'spl-token-2022' ? TOKEN_2022_PROGRAM_ID.toString() : TOKEN_PROGRAM_ID.toString(),
    tokenAddress: mint,
    tokenName: known?.name || '',
    tokenSymbol: known?.ticker || '',
    decimals,
    spender: delegate,
    approvedRaw: info.delegatedAmount?.amount || '0',
    balanceRaw: info.tokenAmount?.amount || '0',
  };
}

// Reads every approval on the wallet, across both token programs.
//
// Two RPC calls total, regardless of how many tokens the wallet holds - the
// delegate and the balance both arrive inside the parsed account, so there is no
// per-token follow-up request. Neither call is a signature request: scanning is
// a pure read and never prompts the wallet.
export async function scan({ connection, publicKey, tokenLookup = {} }) {
  if (!connection || !publicKey) {
    return { ok: false, status: 'no_wallet', approvals: [] };
  }

  try {
    const perProgram = await Promise.all(
      TOKEN_PROGRAMS.map(async ({ programId, standard }) => {
        const response = await connection.getParsedTokenAccountsByOwner(publicKey, { programId });
        return (response?.value || [])
          .map((entry) => normalizeAccount(entry, standard, tokenLookup))
          .filter(Boolean);
      })
    );
    return { ok: true, status: 'ok', approvals: perProgram.flat() };
  } catch (error) {
    // A failed scan must report FAILURE, never an empty list. "No approvals
    // found" and "we could not check" look identical to a user and mean opposite
    // things - one is an all-clear we have not earned.
    return {
      ok: false,
      status: 'rpc_error',
      approvals: [],
      message: String(error?.message || error || 'RPC request failed'),
    };
  }
}

// Builds, prices and pre-flights a revoke WITHOUT sending it.
//
// Split from executeRevoke on purpose: the user is shown the real network fee
// and a transaction that has already been simulated against the live chain
// BEFORE they are asked to approve anything. A confirmation dialog quoting a
// guessed fee for an unbuilt transaction is theatre.
//
// Nothing here signs, sends, or prompts the wallet.
export async function prepareRevoke({ connection, publicKey, approval }) {
  if (!connection || !publicKey) return { ok: false, status: 'no_wallet' };
  if (!approval?.accountAddress) return { ok: false, status: 'invalid_approval' };

  try {
    // The connected wallet must be the account's owner; the on-chain program
    // enforces this, but failing here gives a precise reason instead of an
    // opaque simulation error.
    const account = new PublicKey(approval.accountAddress);
    const programId = new PublicKey(approval.programId);

    const transaction = new Transaction();
    transaction.feePayer = publicKey;

    // Set explicitly rather than left to wallet-adapter internals: Phantom
    // simulates before showing its approval popup and needs a blockhash already
    // bound into the message. Leaving it implicit is what produced "Unable to
    // simulate the result of this request" in the payment flow - same fix here,
    // same reason. lastValidBlockHeight is kept so executeRevoke can confirm
    // with the non-deprecated form.
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;

    // The whole operation: remove the delegate from this one account. No amount,
    // no destination.
    transaction.add(createRevokeInstruction(account, publicKey, [], programId));

    // The network's real fee for this exact message, not a guess.
    let feeLamports = null;
    try {
      const fee = await connection.getFeeForMessage(transaction.compileMessage(), 'confirmed');
      feeLamports = Number.isFinite(fee?.value) ? fee.value : null;
    } catch {
      // Leave null - the UI says "unknown" rather than inventing a number.
      feeLamports = null;
    }

    // Run the same simulation the wallet will run, so a transaction that cannot
    // succeed is caught here with a specific reason rather than surfacing as the
    // wallet's generic, undiagnosable failure after the user has already
    // committed to signing.
    const preflight = await connection.simulateTransaction(transaction);
    if (preflight?.value?.err) {
      return {
        ok: false,
        status: 'simulation_failed',
        message: JSON.stringify(preflight.value.err),
      };
    }

    return { ok: true, status: 'ready', transaction, blockhash, lastValidBlockHeight, feeLamports };
  } catch (error) {
    return { ok: false, status: 'prepare_failed', message: String(error?.message || error || 'Could not prepare the revoke') };
  }
}

// Sends a PREPARED revoke and waits for confirmation.
//
// Takes the prepared transaction rather than rebuilding one, so what the user
// approved in the dialog is byte-for-byte what gets signed - there is no window
// in which the reviewed transaction and the sent transaction can differ.
//
// The signature happens inside the user's wallet. This function never sees a
// key, and cannot proceed if the user declines.
export async function executeRevoke({ connection, sendTransaction, prepared }) {
  if (!prepared?.transaction) return { ok: false, status: 'not_prepared' };
  try {
    const signature = await sendTransaction(prepared.transaction, connection);
    await connection.confirmTransaction(
      { signature, blockhash: prepared.blockhash, lastValidBlockHeight: prepared.lastValidBlockHeight },
      'confirmed'
    );
    return { ok: true, status: 'confirmed', signature };
  } catch (error) {
    const message = String(error?.message || error || '');
    // A user declining in their wallet is a normal outcome, not an error. Same
    // detection the payment flow uses (see cryptoPayment.js).
    if (/reject|denied|cancel/i.test(message)) {
      return { ok: false, status: 'rejected', message };
    }
    return { ok: false, status: 'failed', message: message || 'The revoke transaction failed' };
  }
}
