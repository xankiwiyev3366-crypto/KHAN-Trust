// Tests for the Solana approval lane: the scan, and the full revoke flow.
//
// These drive the REAL lane - the real @solana/spl-token instruction builder,
// the real @solana/web3.js Transaction - against a fake `connection` and a fake
// `sendTransaction`. So what is under test is the actual wiring, not a model of
// it. Only the network and the wallet are stood in for, which is the same
// approach tests/alertsRun.test.mjs takes with the blob store and the mailer.
//
// This matters more than usual here, because the alternative way to test a
// revoke is to point a funded mainnet wallet at it, which is not something a
// test suite gets to do. The properties below are therefore the only automated
// evidence that the flow is safe:
//
//   1. Token-2022 accounts are scanned. Missing a whole token program would
//      report "no approvals" to a user who has one - a false all-clear.
//   2. A revoke is built against the account's OWN program. A Token-2022 account
//      revoked against the legacy program id fails on-chain.
//   3. Nothing is sent without an explicit prepare -> execute, and a declined
//      signature is reported as `rejected`, not as a failure.
//   4. A failed scan reports failure, never an empty list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

import { scan, prepareRevoke, executeRevoke, lamportsToSol } from '../src/approvals/solanaLane.js';

const OWNER = Keypair.generate().publicKey;
const DELEGATE = Keypair.generate().publicKey.toString();
const MINT = Keypair.generate().publicKey.toString();
const BLOCKHASH = '11111111111111111111111111111111';

// One entry as getParsedTokenAccountsByOwner returns it.
function parsedAccount({ delegate = DELEGATE, delegated = '1000000', balance = '5000000', decimals = 6, mint = MINT } = {}) {
  return {
    pubkey: Keypair.generate().publicKey,
    account: {
      data: {
        parsed: {
          info: {
            mint,
            owner: OWNER.toString(),
            tokenAmount: { amount: balance, decimals, uiAmount: Number(balance) / 10 ** decimals },
            ...(delegate ? { delegate, delegatedAmount: { amount: delegated, decimals } } : {}),
          },
        },
      },
    },
  };
}

// A connection that returns whatever each token program was configured with.
function fakeConnection({ byProgram = {}, throwOn = null, feeValue = 5000, simulateErr = null, feeThrows = false } = {}) {
  return {
    async getParsedTokenAccountsByOwner(_owner, { programId }) {
      const key = programId.equals(TOKEN_2022_PROGRAM_ID) ? 'token2022' : 'legacy';
      if (throwOn === key || throwOn === 'all') throw new Error('RPC exploded');
      return { value: byProgram[key] || [] };
    },
    async getLatestBlockhash() {
      return { blockhash: BLOCKHASH, lastValidBlockHeight: 1234 };
    },
    async getFeeForMessage() {
      if (feeThrows) throw new Error('fee lookup failed');
      return { value: feeValue };
    },
    async simulateTransaction() {
      return { value: { err: simulateErr } };
    },
    async confirmTransaction() {
      return { value: { err: null } };
    },
  };
}

// ── Scanning ─────────────────────────────────────────────────────────────────

test('an account with a delegate is reported', async () => {
  const connection = fakeConnection({ byProgram: { legacy: [parsedAccount()] } });
  const result = await scan({ connection, publicKey: OWNER });

  assert.equal(result.ok, true);
  assert.equal(result.approvals.length, 1);
  const approval = result.approvals[0];
  assert.equal(approval.chain, 'solana');
  assert.equal(approval.spender, DELEGATE);
  assert.equal(approval.tokenAddress, MINT);
  assert.equal(approval.approvedRaw, '1000000');
  assert.equal(approval.balanceRaw, '5000000');
  assert.equal(approval.decimals, 6);
  assert.equal(approval.programId, TOKEN_PROGRAM_ID.toString());
});

test('accounts WITHOUT a delegate are ignored', async () => {
  // The overwhelming majority of a wallet's token accounts. Reporting them would
  // bury the one that matters.
  const connection = fakeConnection({
    byProgram: { legacy: [parsedAccount({ delegate: null }), parsedAccount({ delegate: null })] },
  });
  const result = await scan({ connection, publicKey: OWNER });
  assert.equal(result.ok, true);
  assert.deepEqual(result.approvals, []);
});

test('Token-2022 approvals are found, not just legacy SPL', async () => {
  // The easy, silent bug: scanning only TOKEN_PROGRAM_ID and telling a
  // Token-2022 user their wallet is clean.
  const connection = fakeConnection({ byProgram: { token2022: [parsedAccount()] } });
  const result = await scan({ connection, publicKey: OWNER });

  assert.equal(result.approvals.length, 1);
  assert.equal(result.approvals[0].standard, 'spl-token-2022');
  assert.equal(
    result.approvals[0].programId,
    TOKEN_2022_PROGRAM_ID.toString(),
    'the record must carry the program that owns it, or the revoke will target the wrong one'
  );
});

test('both token programs are scanned in one pass', async () => {
  const connection = fakeConnection({
    byProgram: { legacy: [parsedAccount()], token2022: [parsedAccount()] },
  });
  const result = await scan({ connection, publicKey: OWNER });
  assert.equal(result.approvals.length, 2);
  assert.deepEqual(result.approvals.map((a) => a.standard).sort(), ['spl-token', 'spl-token-2022']);
});

test('a known mint gets its name; an unknown mint keeps its address', async () => {
  const connection = fakeConnection({ byProgram: { legacy: [parsedAccount()] } });
  const withLookup = await scan({
    connection,
    publicKey: OWNER,
    tokenLookup: { [MINT]: { name: 'Bonk', ticker: 'BONK' } },
  });
  assert.equal(withLookup.approvals[0].tokenSymbol, 'BONK');
  assert.equal(withLookup.approvals[0].tokenName, 'Bonk');

  const without = await scan({ connection, publicKey: OWNER });
  assert.equal(without.approvals[0].tokenSymbol, '', 'an unknown token must not be given an invented symbol');
  assert.equal(without.approvals[0].tokenAddress, MINT);
});

test('a failed scan reports FAILURE, never an empty list', async () => {
  // "No approvals found" and "we could not check" look identical to a user and
  // mean opposite things. One of them is an all-clear we have not earned.
  const connection = fakeConnection({ throwOn: 'all' });
  const result = await scan({ connection, publicKey: OWNER });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'rpc_error');
  assert.deepEqual(result.approvals, []);
  assert.match(result.message, /RPC exploded/);
});

test('one failing program fails the whole scan rather than half-reporting', async () => {
  // A partial result presented as complete is the same false all-clear: the
  // Token-2022 half could be exactly where the dangerous approval is.
  const connection = fakeConnection({ byProgram: { legacy: [parsedAccount()] }, throwOn: 'token2022' });
  const result = await scan({ connection, publicKey: OWNER });
  assert.equal(result.ok, false);
  assert.deepEqual(result.approvals, []);
});

test('no wallet is a clean no-op, not an error', async () => {
  const result = await scan({ connection: fakeConnection(), publicKey: null });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'no_wallet');
  assert.deepEqual(result.approvals, []);
});

test('approval ids are stable across scans of an unchanged wallet', async () => {
  const entry = parsedAccount();
  const connection = fakeConnection({ byProgram: { legacy: [entry] } });
  const first = await scan({ connection, publicKey: OWNER });
  const second = await scan({ connection, publicKey: OWNER });
  assert.equal(first.approvals[0].id, second.approvals[0].id);
});

// ── Preparing a revoke ───────────────────────────────────────────────────────

async function oneApproval(overrides) {
  const connection = fakeConnection({ byProgram: { legacy: [parsedAccount(overrides)] } });
  const result = await scan({ connection, publicKey: OWNER });
  return result.approvals[0];
}

test('prepare builds a signable revoke and prices it from the network', async () => {
  const approval = await oneApproval();
  const connection = fakeConnection({ feeValue: 5000 });
  const prepared = await prepareRevoke({ connection, publicKey: OWNER, approval });

  assert.equal(prepared.ok, true);
  assert.equal(prepared.status, 'ready');
  assert.equal(prepared.feeLamports, 5000);
  assert.equal(prepared.blockhash, BLOCKHASH);
  assert.equal(prepared.lastValidBlockHeight, 1234);
  assert.equal(prepared.transaction.instructions.length, 1, 'a revoke is exactly one instruction');
  assert.ok(prepared.transaction.feePayer.equals(OWNER));
  assert.equal(prepared.transaction.recentBlockhash, BLOCKHASH, 'set explicitly so the wallet can simulate');
});

test('the revoke instruction targets the account, and moves nothing', async () => {
  const approval = await oneApproval();
  const connection = fakeConnection();
  const prepared = await prepareRevoke({ connection, publicKey: OWNER, approval });

  const instruction = prepared.transaction.instructions[0];
  assert.ok(instruction.programId.equals(TOKEN_PROGRAM_ID));
  assert.equal(instruction.keys[0].pubkey.toString(), approval.accountAddress, 'the token account being revoked');
  assert.ok(instruction.keys[1].pubkey.equals(OWNER), 'signed by the owner');
  // SPL Revoke is a single-byte instruction (discriminator 5) with no amount and
  // no destination - there is no field here that could move a token.
  assert.equal(instruction.data.length, 1);
  assert.equal(instruction.data[0], 5);
});

test('a Token-2022 approval is revoked against the Token-2022 program', async () => {
  const connection = fakeConnection({ byProgram: { token2022: [parsedAccount()] } });
  const { approvals } = await scan({ connection, publicKey: OWNER });
  const prepared = await prepareRevoke({ connection: fakeConnection(), publicKey: OWNER, approval: approvals[0] });

  assert.ok(
    prepared.transaction.instructions[0].programId.equals(TOKEN_2022_PROGRAM_ID),
    'revoking against the legacy program id would fail on-chain'
  );
});

test('an unpriceable fee is null, never a guessed number', async () => {
  const approval = await oneApproval();
  const connection = fakeConnection({ feeThrows: true });
  const prepared = await prepareRevoke({ connection, publicKey: OWNER, approval });

  assert.equal(prepared.ok, true, 'an unknown fee must not block a revoke');
  assert.equal(prepared.feeLamports, null, 'the UI says "unknown" rather than quoting an invented fee');
});

test('a transaction that would fail on-chain is caught before the user signs', async () => {
  const approval = await oneApproval();
  const connection = fakeConnection({ simulateErr: { InstructionError: [0, 'InvalidAccountData'] } });
  const prepared = await prepareRevoke({ connection, publicKey: OWNER, approval });

  assert.equal(prepared.ok, false);
  assert.equal(prepared.status, 'simulation_failed');
  assert.match(prepared.message, /InvalidAccountData/);
});

test('preparing without a wallet or a valid approval fails cleanly', async () => {
  assert.equal((await prepareRevoke({ connection: fakeConnection(), publicKey: null, approval: {} })).status, 'no_wallet');
  assert.equal((await prepareRevoke({ connection: fakeConnection(), publicKey: OWNER, approval: {} })).status, 'invalid_approval');
  const bad = await prepareRevoke({ connection: fakeConnection(), publicKey: OWNER, approval: { accountAddress: 'not-base58!', programId: TOKEN_PROGRAM_ID.toString() } });
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 'prepare_failed');
});

// ── Executing a revoke ───────────────────────────────────────────────────────

test('a confirmed revoke returns its signature', async () => {
  const approval = await oneApproval();
  const connection = fakeConnection();
  const prepared = await prepareRevoke({ connection, publicKey: OWNER, approval });

  let sentTx = null;
  const sendTransaction = async (tx) => {
    sentTx = tx;
    return 'sig-abc';
  };

  const result = await executeRevoke({ connection, sendTransaction, prepared });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'confirmed');
  assert.equal(result.signature, 'sig-abc');
  assert.equal(sentTx, prepared.transaction, 'the transaction the user reviewed is the one that is sent - not a rebuild');
});

test('declining in the wallet is REJECTED, not an error', async () => {
  // A user saying no is a legitimate answer to "shall I sign this?" and must not
  // be rendered as though something broke.
  const approval = await oneApproval();
  const connection = fakeConnection();
  const prepared = await prepareRevoke({ connection, publicKey: OWNER, approval });

  for (const message of ['User rejected the request', 'Transaction was denied', 'User cancelled']) {
    const result = await executeRevoke({
      connection,
      sendTransaction: async () => { throw new Error(message); },
      prepared,
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'rejected', `"${message}" must read as a decline`);
  }
});

test('a genuine send failure is an error, not a decline', async () => {
  const approval = await oneApproval();
  const connection = fakeConnection();
  const prepared = await prepareRevoke({ connection, publicKey: OWNER, approval });

  const result = await executeRevoke({
    connection,
    sendTransaction: async () => { throw new Error('Blockhash not found'); },
    prepared,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'failed');
  assert.match(result.message, /Blockhash not found/);
});

test('nothing can be sent without a prepared transaction', async () => {
  // The structural guarantee behind "never revoke automatically": execute has no
  // path that builds its own transaction, so it cannot run without a prepare
  // that the user has seen.
  let called = false;
  const result = await executeRevoke({
    connection: fakeConnection(),
    sendTransaction: async () => { called = true; return 'sig'; },
    prepared: null,
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'not_prepared');
  assert.equal(called, false, 'the wallet must never be asked to sign an unprepared transaction');
});

test('confirmation uses the blockhash the transaction was built with', async () => {
  const approval = await oneApproval();
  const connection = fakeConnection();
  const prepared = await prepareRevoke({ connection, publicKey: OWNER, approval });

  let confirmArgs = null;
  const result = await executeRevoke({
    connection: { ...connection, confirmTransaction: async (args) => { confirmArgs = args; return { value: { err: null } }; } },
    sendTransaction: async () => 'sig-xyz',
    prepared,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(confirmArgs, { signature: 'sig-xyz', blockhash: BLOCKHASH, lastValidBlockHeight: 1234 });
});

// ── Fee display ──────────────────────────────────────────────────────────────

test('lamports convert to SOL, and unknown stays unknown', () => {
  assert.equal(lamportsToSol(5000), 0.000005);
  assert.equal(lamportsToSol(1_000_000_000), 1);
  assert.equal(lamportsToSol(null), null);
  assert.equal(lamportsToSol(undefined), null);
});
