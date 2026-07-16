// Tests for account-based entitlements, and for not destroying anybody who
// already paid.
//
// This covers a payment + authorization change, where the two failure modes are
// asymmetric and both unacceptable:
//
//   too strict -> a paying customer is locked out of what they bought
//   too loose  -> Premium is given away, or taken from someone else
//
// So the auth is NOT mocked. Real JWTs and real wallet-session tokens are
// minted with a real AUTH_SECRET and verified by the real verifiers; only the
// blob backend is faked. A test that stubs verifyJwt proves the handler calls a
// function, not that the function protects anything.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

// Must be set before the modules under test are imported: both _authStore and
// _walletSession read it at module scope.
process.env.AUTH_SECRET = 'test-secret-for-entitlement-tests';

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

const entitlementsStore = await import('../netlify/functions/_entitlementsStore.mjs');
const { accountSubject, isAccountSubject, grantEntitlement, getAccountEntitlement, findSubjectByStripeSubscription } = entitlementsStore;
const { resolvePremiumAccess, resolveVerifiedPremiumAccess } = await import('../netlify/functions/_premiumAccess.mjs');
const { issueToken } = await import('../netlify/functions/_authStore.mjs');
const { issueWalletToken } = await import('../netlify/functions/_walletSession.mjs');
const { handler: claimHandler } = await import('../netlify/functions/premium-claim-wallet.mjs');
const { handler: statusHandler } = await import('../netlify/functions/entitlement-status.mjs');

const USER = { id: 'user-123', email: 'paid@example.com', name: 'Paid User' };
const OTHER_USER = { id: 'user-999', email: 'other@example.com', name: 'Other' };
const WALLET = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';

const PAID = { plan: 'premium', provider: 'stripe', verifiedAt: '2026-01-01T00:00:00.000Z' };

function reset() { stores.clear(); }
const jwtFor = (user) => issueToken(user);
const walletProofFor = (wallet) => issueWalletToken(wallet).token;

const req = ({ user, wallet, query } = {}) => ({
  httpMethod: 'POST',
  headers: {
    ...(user ? { authorization: `Bearer ${jwtFor(user)}` } : {}),
    ...(wallet ? { 'x-khan-wallet-auth': walletProofFor(wallet) } : {}),
  },
  queryStringParameters: query || {},
});
const body = (res) => JSON.parse(res.body);

// ── Key spaces ────────────────────────────────────────────────────────────────

test('account and wallet key spaces cannot collide', () => {
  // The whole two-lane design rests on this. A base58 Solana address can never
  // start with "u:", so one entitlements map can hold both safely.
  assert.equal(accountSubject('user-123'), 'u:user-123');
  assert.equal(isAccountSubject('u:user-123'), true);
  assert.equal(isAccountSubject(WALLET), false, 'a wallet must never read as an account key');
  assert.equal(accountSubject(''), '', 'no user id yields no subject, never a bare "u:"');
});

// ── New account-based entitlements ────────────────────────────────────────────

test('a paid account has Premium with no wallet anywhere in sight', async () => {
  reset();
  await grantEntitlement(accountSubject(USER.id), PAID);

  const access = await resolvePremiumAccess({ headers: { authorization: `Bearer ${jwtFor(USER)}` } }, '');

  assert.equal(access.entitled, true);
  assert.equal(access.plan, 'premium');
  assert.equal(access.source, 'account');
  assert.equal(access.storageKey, 'u:user-123');
});

test('an account entitlement is readable without a wallet signature', async () => {
  // A JWT already proves ownership of the account. Requiring a wallet signature
  // on top would reintroduce the exact friction this change removes.
  reset();
  await grantEntitlement(accountSubject(USER.id), PAID);

  const access = await resolveVerifiedPremiumAccess({ headers: { authorization: `Bearer ${jwtFor(USER)}` } });
  assert.equal(access.entitled, true);
  assert.equal(access.source, 'account');
});

test("one account's entitlement never leaks to another account", async () => {
  reset();
  await grantEntitlement(accountSubject(USER.id), PAID);

  const access = await resolvePremiumAccess({ headers: { authorization: `Bearer ${jwtFor(OTHER_USER)}` } }, '');
  assert.equal(access.entitled, false);
});

test('a forged JWT gets nothing', async () => {
  reset();
  await grantEntitlement(accountSubject(USER.id), PAID);

  const access = await resolvePremiumAccess({ headers: { authorization: 'Bearer not.a.jwt' } }, '');
  assert.equal(access.entitled, false);
  assert.equal(access.storageKey, '', 'an unproven caller gets no storage key at all');
});

// ── Legacy wallet users must not lose anything ────────────────────────────────

test('a legacy wallet purchase still grants Premium, exactly as before', async () => {
  reset();
  await grantEntitlement(WALLET, PAID);

  const access = await resolvePremiumAccess({ headers: {} }, WALLET);
  assert.equal(access.entitled, true);
  assert.equal(access.source, 'wallet');
  assert.equal(access.storageKey, WALLET);
});

test('a legacy user KEEPS their wallet storage key when signed in', async () => {
  // THE data-loss trap. Their saved reports and watchlist were written under the
  // wallet key. If signing in resolved them to "u:<id>" instead, every report
  // they own would silently vanish from their account — indistinguishable, to
  // them, from us deleting it.
  reset();
  await grantEntitlement(WALLET, PAID);
  await grantEntitlement(accountSubject(USER.id), { ...PAID, plan: 'premium' });

  const access = await resolveVerifiedPremiumAccess({
    headers: { authorization: `Bearer ${jwtFor(USER)}`, 'x-khan-wallet-auth': walletProofFor(WALLET) },
  });

  assert.equal(access.entitled, true);
  assert.equal(access.storageKey, WALLET, 'the proven wallet key wins, so existing data stays reachable');
  assert.equal(access.source, 'wallet');
});

test('a raw wallet address in the query never proves ownership', async () => {
  // Pre-existing IDOR guard (P0-1) — re-asserted because this change touches
  // the resolver. Wallet addresses are public; only a signature proves control.
  reset();
  await grantEntitlement(WALLET, PAID);

  const access = await resolveVerifiedPremiumAccess({ headers: {}, queryStringParameters: { wallet: WALLET } });
  assert.equal(access.entitled, false, 'an unsigned address must never unlock wallet-keyed data');
});

// ── Access restoration (the claim) ────────────────────────────────────────────

test('claiming binds a legacy purchase to the account', async () => {
  reset();
  await grantEntitlement(WALLET, PAID);

  const res = await claimHandler(req({ user: USER, wallet: WALLET }));
  assert.equal(res.statusCode, 200);
  assert.equal(body(res).claimed, true);

  // ...and now Premium resolves from the ACCOUNT alone, with no wallet.
  const access = await resolvePremiumAccess({ headers: { authorization: `Bearer ${jwtFor(USER)}` } }, '');
  assert.equal(access.entitled, true);
  assert.equal(access.source, 'account');
});

test('a claimed user keeps reading their ORIGINAL wallet-keyed data', async () => {
  // The reason claiming does not copy any data: the account entitlement points
  // back at the wallet storage key. A pointer cannot half-fail the way a bulk
  // copy can, and the user's reports stay exactly where they have always been.
  reset();
  await grantEntitlement(WALLET, PAID);
  await claimHandler(req({ user: USER, wallet: WALLET }));

  // Signed in, NO wallet connected at all.
  const access = await resolvePremiumAccess({ headers: { authorization: `Bearer ${jwtFor(USER)}` } }, '');
  assert.equal(access.storageKey, WALLET, 'the account resolves to the legacy key, so nothing is stranded');
});

test('claiming never revokes the wallet entitlement', async () => {
  // Copy, never move. If anything about the claim were wrong, the user must
  // still have exactly the access they woke up with.
  reset();
  await grantEntitlement(WALLET, PAID);
  await claimHandler(req({ user: USER, wallet: WALLET }));

  const stillThere = await resolvePremiumAccess({ headers: {} }, WALLET);
  assert.equal(stillThere.entitled, true, 'the wallet path must survive the claim');
});

test('claiming is idempotent', async () => {
  reset();
  await grantEntitlement(WALLET, PAID);

  await claimHandler(req({ user: USER, wallet: WALLET }));
  const second = await claimHandler(req({ user: USER, wallet: WALLET }));

  assert.equal(second.statusCode, 200);
  assert.equal(body(second).alreadyClaimed, true, 'a retry or double-click is harmless');
});

// ── Claim security ────────────────────────────────────────────────────────────

test('claiming without wallet PROOF is refused', async () => {
  // The giveaway this prevents: wallet addresses are public and enumerable, so
  // without cryptographic proof anyone could read a paid address off a block
  // explorer and claim that person's Premium onto their own account.
  reset();
  await grantEntitlement(WALLET, PAID);

  const res = await claimHandler(req({ user: USER })); // JWT only
  assert.equal(res.statusCode, 403);
  assert.equal(body(res).reason, 'wallet_proof_required');

  const access = await resolvePremiumAccess({ headers: { authorization: `Bearer ${jwtFor(USER)}` } }, '');
  assert.equal(access.entitled, false, 'nothing may be granted by a refused claim');
});

test('a wallet address in the request body is ignored entirely', async () => {
  // Only provenWallet() is consulted. A body-supplied address must never be
  // honoured, whatever else the request carries.
  reset();
  await grantEntitlement(WALLET, PAID);

  const res = await claimHandler({
    httpMethod: 'POST',
    headers: { authorization: `Bearer ${jwtFor(USER)}` },
    body: JSON.stringify({ wallet: WALLET }),
  });
  assert.equal(res.statusCode, 403, 'a body-supplied wallet is not proof of anything');
});

test('claiming without signing in is refused', async () => {
  reset();
  await grantEntitlement(WALLET, PAID);

  const res = await claimHandler(req({ wallet: WALLET }));
  assert.equal(res.statusCode, 401);
});

test('proof of a wallet with no purchase grants nothing', async () => {
  reset();
  const res = await claimHandler(req({ user: USER, wallet: WALLET }));
  assert.equal(res.statusCode, 404);
  assert.equal(body(res).reason, 'no_purchase_found');
});

test('a second account cannot claim a purchase already claimed', async () => {
  // Both accounts can prove the wallet (they share the keys). Allowing this
  // would silently duplicate one purchase across two accounts. Refusing costs
  // nobody access: the wallet path still works for whoever holds the keys.
  reset();
  await grantEntitlement(WALLET, PAID);
  await claimHandler(req({ user: USER, wallet: WALLET }));

  const res = await claimHandler(req({ user: OTHER_USER, wallet: WALLET }));
  assert.equal(res.statusCode, 409);
  assert.equal(body(res).reason, 'already_claimed');

  const access = await resolvePremiumAccess({ headers: { authorization: `Bearer ${jwtFor(OTHER_USER)}` } }, '');
  assert.equal(access.entitled, false, 'the second account gets nothing');
});

test('claiming never overwrites an existing paid account plan', async () => {
  // Found in review. The claim is a WRITE, not a merge, so without this guard it
  // replaces the account's own paid record wholesale.
  //
  // How that costs someone money: claim a legacy lifetime early_supporter
  // wallet, later also subscribe monthly, then cancel. The cancellation revokes
  // u:<userId> — which by then holds the CLAIMED record — and the lifetime
  // access bought years ago is gone. It would also repoint storageKey at the
  // wallet, stranding anything saved during the subscription.
  reset();
  const ACCOUNT_SUB = { plan: 'premium', provider: 'stripe', stripeSubscriptionId: 'sub_live', verifiedAt: '2026-06-01T00:00:00.000Z' };
  await grantEntitlement(accountSubject(USER.id), ACCOUNT_SUB);
  await grantEntitlement(WALLET, { plan: 'early_supporter', provider: 'stripe', verifiedAt: '2024-01-01T00:00:00.000Z' });

  const res = await claimHandler(req({ user: USER, wallet: WALLET }));
  assert.equal(res.statusCode, 409);
  assert.equal(body(res).reason, 'account_already_has_plan');

  // The account's own subscription record must be exactly as it was.
  const after = await getAccountEntitlement(USER.id);
  assert.deepEqual(after, ACCOUNT_SUB, 'a refused claim must not touch the existing plan');

  // And the user loses nothing: both paths still grant.
  assert.equal((await resolvePremiumAccess({ headers: { authorization: `Bearer ${jwtFor(USER)}` } }, '')).entitled, true);
  assert.equal((await resolvePremiumAccess({ headers: {} }, WALLET)).entitled, true);
});

// ── entitlement-status ────────────────────────────────────────────────────────

test('entitlement-status returns the caller OWN account plan from their JWT', async () => {
  reset();
  await grantEntitlement(accountSubject(USER.id), PAID);

  const res = await statusHandler({ httpMethod: 'GET', headers: { authorization: `Bearer ${jwtFor(USER)}` }, queryStringParameters: {} });
  assert.equal(res.statusCode, 200);
  assert.equal(body(res).entitlement.active, true);
  assert.equal(body(res).entitlement.plan, 'premium');
});

test('entitlement-status never leaks payment identifiers', async () => {
  reset();
  await grantEntitlement(accountSubject(USER.id), {
    ...PAID,
    stripeCustomerId: 'cus_SECRET',
    stripeSubscriptionId: 'sub_SECRET',
    transactionHash: 'cs_SECRET',
    amountPaid: 9,
  });

  const res = await statusHandler({ httpMethod: 'GET', headers: { authorization: `Bearer ${jwtFor(USER)}` }, queryStringParameters: {} });
  const raw = res.body;
  for (const secret of ['cus_SECRET', 'sub_SECRET', 'cs_SECRET', 'amountPaid']) {
    assert.ok(!raw.includes(secret), `${secret} must never reach the browser`);
  }
});

test('the wallet query still works, and is chosen by the QUERY not the header', async () => {
  // A signed-in legacy user asks about their wallet and their account with two
  // separate calls. Dispatching on header presence would let the auth header
  // silently turn the first into the second.
  reset();
  await grantEntitlement(WALLET, PAID);

  const res = await statusHandler({
    httpMethod: 'GET',
    headers: { authorization: `Bearer ${jwtFor(OTHER_USER)}` }, // signed in as someone with no plan
    queryStringParameters: { wallet: WALLET },
  });
  assert.equal(body(res).wallet, WALLET);
  assert.equal(body(res).entitlement.active, true, 'the wallet lookup must not be hijacked by the JWT');
});

// ── Stripe subscription lookup ────────────────────────────────────────────────

test('a cancelled subscription is found by subject, for accounts AND wallets', async () => {
  // If this only ever matched wallets, an account subscription could never be
  // cancelled: the customer stops paying and keeps Premium forever.
  reset();
  await grantEntitlement(accountSubject(USER.id), { ...PAID, stripeSubscriptionId: 'sub_account' });
  await grantEntitlement(WALLET, { ...PAID, stripeSubscriptionId: 'sub_wallet' });

  assert.equal(await findSubjectByStripeSubscription('sub_account'), 'u:user-123');
  assert.equal(await findSubjectByStripeSubscription('sub_wallet'), WALLET);
  assert.equal(await findSubjectByStripeSubscription('sub_unknown'), null);
});
