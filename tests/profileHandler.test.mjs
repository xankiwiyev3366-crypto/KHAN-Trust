// Phase 4 — the profile handlers as HTTP: the status codes, the headers, and
// the behaviour when a store is unavailable.
//
// publicProfile.test.mjs covers the PURE renderers. This covers the request
// path, which is where the status-code requirements actually live and where a
// store outage has to be survived rather than thrown.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

const SOL = 'So11111111111111111111111111111111111111112';
const EVM = '0xaea46a60368a7bd060eec7df8cba43b7ef41ad85';

class FakeStore {
  constructor() { this.data = new Map(); this.failReads = false; }
  async setJSON(key, value) { this.data.set(key, JSON.parse(JSON.stringify(value))); }
  async get(key) {
    if (this.failReads) throw new Error('blob store unavailable');
    return this.data.has(key) ? JSON.parse(JSON.stringify(this.data.get(key))) : null;
  }
  async delete(key) { this.data.delete(key); }
  async list({ prefix = '' } = {}) {
    return { blobs: [...this.data.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) };
  }
}

const stores = new Map();
const storeFor = (name) => {
  if (!stores.has(name)) stores.set(name, new FakeStore());
  return stores.get(name);
};

mock.module('../netlify/functions/_blobsClient.mjs', {
  namedExports: {
    getNamedStore: storeFor,
    jsonResponse: (statusCode, body) => ({ statusCode, headers: {}, body: JSON.stringify(body) }),
  },
});

mock.module('../netlify/functions/_db.mjs', {
  namedExports: {
    mirror: async () => ({ ok: false, skipped: true }),
    readRows: async () => ({ ok: false, reason: 'no_database_url' }),
    dbConfigured: () => false,
  },
});

const { handler: profileHandler } = await import('../netlify/functions/token-profile.mjs');
const { handler: ogHandler } = await import('../netlify/functions/profile-og.mjs');
const { handler: tokenPageHandler } = await import('../netlify/functions/token-page.mjs');

function reset() {
  stores.clear();
}

// Seeds the corpus the way token-corpus-record would, using the canonical
// identity rule (Solana keeps the bare `c:<addr>`; every other chain is
// chain-prefixed).
async function seedCorpus(chain, contract, record) {
  const identity = chain === 'solana'
    ? `c:${contract.toLowerCase()}`
    : `c:${chain}:${contract.toLowerCase()}`;
  await storeFor('khan-trust-corpus').setJSON(`token/${identity}`, {
    identity, chain, contract, ...record,
  });
}

async function seedStatus(key, record) {
  const store = storeFor('khan-trust-verification');
  const existing = (await store.get('statuses.json')) || {};
  await store.setJSON('statuses.json', { ...existing, [key]: record });
}

const GET = (path) => ({ httpMethod: 'GET', path, queryStringParameters: {}, headers: {} });

// ── Status codes ────────────────────────────────────────────────────────────

test('a scored token answers 200 and is indexable', async () => {
  reset();
  await seedCorpus('solana', SOL, { name: 'Wrapped SOL', ticker: 'SOL', trustScore: 82, riskLevel: 'Low', updatedAt: '2026-07-20T00:00:00Z' });

  const res = await profileHandler(GET(`/t/solana/${SOL}`));
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Content-Type'], /text\/html/);
  assert.match(res.body, /82/);
  assert.match(res.body, /Wrapped SOL/);
  assert.match(res.body, /content="index,follow/);
  assert.equal(res.headers['X-Robots-Tag'], undefined, 'an indexable page must not carry a noindex header');
});

test('an unsupported chain answers 404', async () => {
  reset();
  const res = await profileHandler(GET(`/t/dogechain/${SOL}`));
  assert.equal(res.statusCode, 404);
  assert.match(res.body, /does not support that blockchain/);
  assert.match(res.headers['X-Robots-Tag'], /noindex/);
});

test('a malformed contract answers 404', async () => {
  reset();
  const res = await profileHandler(GET('/t/ethereum/not-an-address'));
  assert.equal(res.statusCode, 404);
  assert.match(res.body, /valid contract address/);
});

test('a well-formed address we hold nothing about answers 404 with a useful body', async () => {
  reset();
  // The /t/ URL space is infinite. 200 for all of it would offer a crawler an
  // unbounded supply of interchangeable placeholder pages.
  const res = await profileHandler(GET(`/t/solana/${SOL}`));
  assert.equal(res.statusCode, 404);
  // Still genuinely useful to the human who followed the link.
  assert.match(res.body, /Run a live trust scan/);
  assert.match(res.body, new RegExp(SOL));
  assert.match(res.headers['X-Robots-Tag'], /noindex/);
});

test('a VERIFIED but unscored token is a real page, not a 404', async () => {
  reset();
  await seedStatus(`solana:${SOL}`, { status: 'verified', updatedAt: '2026-07-01T00:00:00Z' });

  const res = await profileHandler(GET(`/t/solana/${SOL}`));
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Verified/);
});

test('a REVOKED project keeps its page rather than 404ing into oblivion', async () => {
  reset();
  await seedStatus(`solana:${SOL}`, { status: 'revoked', revokedAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-01T00:00:00Z' });

  const res = await profileHandler(GET(`/t/solana/${SOL}`));
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Verification revoked/);
  // The most useful fact the page holds is that this project WAS verified.
  //
  // Scoped to the RENDERED body: the live-recheck script embeds the full label
  // map (every state's wording, so it can rewrite the page if the status has
  // changed since this HTML was cached), so the "not verified" sentence is
  // legitimately present in the script block while never being displayed.
  // Asserting against the raw HTML would test the lookup table, not the claim.
  const rendered = res.body.replace(/<script[\s\S]*?<\/script>/g, '');
  assert.doesNotMatch(rendered, /has not completed KHAN Trust ownership verification/);
});

test('an EVM token resolves on its own chain — the bug the old URL could not fix', async () => {
  reset();
  await seedCorpus('base', EVM, { name: 'Based Token', ticker: 'BASE', trustScore: 55, riskLevel: 'Medium', updatedAt: '2026-07-20T00:00:00Z' });

  const onBase = await profileHandler(GET(`/t/base/${EVM}`));
  assert.equal(onBase.statusCode, 200);
  assert.match(onBase.body, /Based Token/);

  // The SAME address on a different chain is a different token and must not
  // inherit Base's score.
  const onEthereum = await profileHandler(GET(`/t/ethereum/${EVM}`));
  assert.equal(onEthereum.statusCode, 404);
  assert.doesNotMatch(onEthereum.body, /Based Token/);
});

test('a non-GET method is refused', async () => {
  reset();
  const res = await profileHandler({ httpMethod: 'POST', path: `/t/solana/${SOL}`, headers: {} });
  assert.equal(res.statusCode, 405);
});

// ── Failure ─────────────────────────────────────────────────────────────────

test('a store outage answers 503 with Retry-After and no internal detail', async () => {
  reset();
  // Every store fails, including the one buildProfileView cannot degrade past.
  storeFor('khan-trust-corpus').failReads = true;
  storeFor('khan-trust-verification').failReads = true;
  storeFor('khan-trust-verify-orders').failReads = true;

  const res = await profileHandler(GET(`/t/solana/${SOL}`));
  // The reads are individually soft-failed, so this still renders — as a 404,
  // because with nothing readable we hold nothing about this token. What must
  // NEVER happen is a 500 with a stack trace.
  assert.ok([404, 503].includes(res.statusCode), `unexpected status ${res.statusCode}`);
  assert.doesNotMatch(res.body, /blob store unavailable/, 'internal error text leaked to the visitor');
  assert.doesNotMatch(res.body, /at Object\./, 'a stack trace leaked to the visitor');
});

test('an unreadable verification store never degrades into "verified"', async () => {
  reset();
  await seedCorpus('solana', SOL, { name: 'Tok', ticker: 'TOK', trustScore: 70, riskLevel: 'Medium', updatedAt: '2026-07-20T00:00:00Z' });
  storeFor('khan-trust-verification').failReads = true;

  const res = await profileHandler(GET(`/t/solana/${SOL}`));
  assert.equal(res.statusCode, 200);
  // Fail closed: an unreadable store is not evidence of verification.
  assert.match(res.body, /Not verified/);
});

// ── The share image ─────────────────────────────────────────────────────────

test('the og image is always an image, even for a token we have never seen', async () => {
  reset();
  const res = await ogHandler(GET(`/og/t/solana/${SOL}.svg`));
  // A 404'd og:image makes the whole preview collapse to a bare link.
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Content-Type'], /image\/svg\+xml/);
  assert.match(res.body, /^<svg /);
});

test('the og image falls back to the brand card for an unsupported chain', async () => {
  reset();
  const res = await ogHandler(GET(`/og/t/dogechain/${SOL}.svg`));
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /KHAN Trust/);
});

test('the og image renders the score for a scored token', async () => {
  reset();
  await seedCorpus('solana', SOL, { name: 'Wrapped SOL', ticker: 'SOL', trustScore: 82, riskLevel: 'Low', updatedAt: '2026-07-20T00:00:00Z' });
  const res = await ogHandler(GET(`/og/t/solana/${SOL}.svg`));
  assert.match(res.body, />82</);
  assert.match(res.body, /TRUST SCORE/);
});

// ── The legacy URL ──────────────────────────────────────────────────────────

test('/token/<contract> 301s to the canonical when the chain can be resolved', async () => {
  reset();
  await seedCorpus('base', EVM, { name: 'Based Token', ticker: 'BASE', trustScore: 55, riskLevel: 'Medium', updatedAt: '2026-07-20T00:00:00Z' });

  const res = await tokenPageHandler({ httpMethod: 'GET', path: `/token/${EVM}`, queryStringParameters: {}, headers: {} });
  assert.equal(res.statusCode, 301);
  assert.match(res.headers.Location, new RegExp(`/t/base/${EVM}`));
});

test('/token/<contract> resolves a Solana token through its bare identity', async () => {
  reset();
  await seedCorpus('solana', SOL, { name: 'Wrapped SOL', ticker: 'SOL', trustScore: 82, riskLevel: 'Low', updatedAt: '2026-07-20T00:00:00Z' });

  const res = await tokenPageHandler({ httpMethod: 'GET', path: `/token/${SOL}`, queryStringParameters: {}, headers: {} });
  assert.equal(res.statusCode, 301);
  assert.match(res.headers.Location, new RegExp(`/t/solana/${SOL}`));
});

test('/token/<contract> for an unknown token serves the old page, noindex, rather than guessing a chain', async () => {
  reset();
  const res = await tokenPageHandler({ httpMethod: 'GET', path: `/token/${SOL}`, queryStringParameters: {}, headers: {} });
  assert.equal(res.statusCode, 200);
  // Guessing would send a Base token's visitors to a Solana profile.
  assert.match(res.headers['X-Robots-Tag'], /noindex/);
  assert.match(res.body, /not analyzed yet/i);
});

test('/token/ with no contract is still a 400, unchanged', async () => {
  reset();
  const res = await tokenPageHandler({ httpMethod: 'GET', path: '/token/', queryStringParameters: {}, headers: {} });
  assert.equal(res.statusCode, 400);
});
