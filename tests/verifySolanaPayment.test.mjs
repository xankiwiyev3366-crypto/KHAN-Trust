// Tests for account-linked wallet payments (P1).
//
// A verified crypto payment must:
//   - still grant the paying WALLET, exactly as before (legacy + anonymous);
//   - ADDITIONALLY grant the signed-in ACCOUNT when a valid JWT rides along, so
//     the buyer has Premium on their account immediately with no "claim wallet";
//   - take the account id ONLY from the verified token, never from the body, so
//     a payment can never be redirected to grant Premium to a stranger.
//
// The auth is NOT mocked — a real JWT is minted with a real AUTH_SECRET and
// verified by the real verifier. Only the blob backend and the Solana RPC are
// faked. A USDC (SPL) payment is simulated so no SOL/USD price fetch is needed.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.AUTH_SECRET = 'test-secret-for-verify-solana-tests';
process.env.VITE_SOLANA_RPC_URL = 'https://rpc.example.test';
process.env.VITE_KHAN_PAYMENT_WALLET = 'PAY1111111111111111111111111111111111111111';

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const PAYMENT_WALLET = process.env.VITE_KHAN_PAYMENT_WALLET;
const BUYER_WALLET = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

class FakeStore {
  constructor() { this.data = new Map(); }
  async setJSON(key, value) { this.data.set(key, JSON.parse(JSON.stringify(value))); }
  async get(key) { return this.data.has(key) ? JSON.parse(JSON.stringify(this.data.get(key))) : null; }
  async list({ prefix } = {}) {
    return { blobs: Array.from(this.data.keys()).filter((k) => !prefix || k.startsWith(prefix)).map((key) => ({ key })) };
  }
  async delete(key) { this.data.delete(key); }
}

const stores = new Map();
const storeFor = (name) => {
  if (!stores.has(name)) stores.set(name, new FakeStore());
  return stores.get(name);
};

mock.module('../netlify/functions/_blobsClient.mjs', {
  namedExports: {
    getNamedStore: (name) => storeFor(name),
    jsonResponse: (statusCode, body) => ({ statusCode, body: JSON.stringify(body) }),
  },
});

const { getEntitlement, getAccountEntitlement } = await import('../netlify/functions/_entitlementsStore.mjs');
const { issueToken } = await import('../netlify/functions/_authStore.mjs');
const { handler } = await import('../netlify/functions/verify-solana-payment.mjs');

const USER = { id: 'user-123', email: 'buyer@example.com', name: 'Buyer' };
const OTHER_USER = { id: 'user-999', email: 'victim@example.com', name: 'Victim' };

// A getTransaction result for a confirmed USDC transfer of `uiAmount` to the
// payment wallet, paid by BUYER_WALLET (accountKeys[0]).
function usdcTxResult(uiAmount) {
  return {
    meta: {
      err: null,
      preTokenBalances: [{ accountIndex: 1, owner: PAYMENT_WALLET, mint: USDC_MINT, uiTokenAmount: { uiAmount: 0 } }],
      postTokenBalances: [{ accountIndex: 1, owner: PAYMENT_WALLET, mint: USDC_MINT, uiTokenAmount: { uiAmount } }],
    },
    transaction: { message: { accountKeys: [BUYER_WALLET, PAYMENT_WALLET], instructions: [] } },
  };
}

// Fakes the Solana RPC: getTransaction returns the prepared tx result.
function stubRpc(uiAmount) {
  return async () => ({
    ok: true,
    json: async () => ({ jsonrpc: '2.0', id: 1, result: usdcTxResult(uiAmount) }),
  });
}

const SIG = () => Array.from({ length: 88 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789'[Math.floor(Math.random() * 57)]).join('');

const post = (body, { user, authHeader } = {}) => ({
  httpMethod: 'POST',
  headers: {
    ...(user ? { authorization: `Bearer ${issueToken(user)}` } : {}),
    ...(authHeader ? { authorization: authHeader } : {}),
  },
  body: JSON.stringify(body),
});
const parse = (res) => JSON.parse(res.body);

function reset() { stores.clear(); }

test('a signed-in buyer gets Premium on BOTH the account and the paying wallet', async () => {
  reset();
  const originalFetch = global.fetch;
  global.fetch = stubRpc(99);
  try {
    const res = await handler(post({ transactionHash: SIG(), plan: 'early_supporter' }, { user: USER }));
    const data = parse(res);
    assert.equal(data.status, 'verified');
    assert.equal(data.debug.grantedToAccount, true);

    const account = await getAccountEntitlement(USER.id);
    assert.equal(account?.plan, 'early_supporter', 'account must have Premium immediately');
    assert.equal(account?.wallet, BUYER_WALLET, 'paying wallet is recorded as context on the account record');

    const wallet = await getEntitlement(BUYER_WALLET);
    assert.equal(wallet?.plan, 'early_supporter', 'the paying wallet is still granted, exactly as before');
  } finally {
    global.fetch = originalFetch;
  }
});

test('an anonymous buyer still gets the wallet grant, and nothing account-side', async () => {
  reset();
  const originalFetch = global.fetch;
  global.fetch = stubRpc(9);
  try {
    const res = await handler(post({ transactionHash: SIG(), plan: 'premium' }));
    const data = parse(res);
    assert.equal(data.status, 'verified');
    assert.equal(data.debug.grantedToAccount, false, 'no account to grant to');

    const wallet = await getEntitlement(BUYER_WALLET);
    assert.equal(wallet?.plan, 'premium', 'the legacy wallet-only flow is byte-for-byte unchanged');
  } finally {
    global.fetch = originalFetch;
  }
});

test('a forged token grants no account access — the flow falls back to wallet-only', async () => {
  reset();
  const originalFetch = global.fetch;
  global.fetch = stubRpc(9);
  try {
    const res = await handler(post({ transactionHash: SIG(), plan: 'premium' }, { authHeader: 'Bearer forged.token.here' }));
    const data = parse(res);
    assert.equal(data.status, 'verified');
    assert.equal(data.debug.grantedToAccount, false);

    const victim = await getAccountEntitlement(OTHER_USER.id);
    assert.equal(victim, null, 'no account may be granted from an unverifiable token');
  } finally {
    global.fetch = originalFetch;
  }
});

test('the account is taken from the JWT, not the body — a body userId cannot redirect the grant', async () => {
  reset();
  const originalFetch = global.fetch;
  global.fetch = stubRpc(9);
  try {
    // USER is signed in, but the body tries to name OTHER_USER as the subject.
    const res = await handler(post({ transactionHash: SIG(), plan: 'premium', userId: OTHER_USER.id, accountUserId: OTHER_USER.id }, { user: USER }));
    assert.equal(parse(res).status, 'verified');

    assert.equal((await getAccountEntitlement(USER.id))?.plan, 'premium', 'only the token-proven account is granted');
    assert.equal(await getAccountEntitlement(OTHER_USER.id), null, 'the body-named account gets nothing');
  } finally {
    global.fetch = originalFetch;
  }
});
