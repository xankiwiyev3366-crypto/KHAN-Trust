// The embeddable badge: what it may claim, and what it must refuse to claim.
//
// This badge renders on websites KHAN Trust does not control, owned by the
// people whose projects it makes claims about. That makes the embedding page
// untrusted input and makes every test here a test about a claim rather than
// about a feature. The asymmetry runs one way throughout: rendering
// "Unverified" for a verified project costs one customer a badge; rendering
// "Verified" for anything else costs the badge its meaning everywhere it is
// already embedded.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

class FakeStore {
  constructor() { this.data = new Map(); }
  async setJSON(key, value) { this.data.set(key, JSON.parse(JSON.stringify(value))); }
  async get(key) { return this.data.has(key) ? JSON.parse(JSON.stringify(this.data.get(key))) : null; }
  async delete(key) { this.data.delete(key); }
  async list() { return { blobs: [] }; }
}

const stores = new Map();
const storeFor = (name) => {
  if (!stores.has(name)) stores.set(name, new FakeStore());
  return stores.get(name);
};

mock.module('../netlify/functions/_blobsClient.mjs', {
  namedExports: {
    getNamedStore: storeFor,
    jsonResponse: (statusCode, body) => ({
      statusCode,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  },
});

const {
  BADGE_STATES,
  BADGE_CACHE_CONTROL,
  resolveBadgeState,
  parseBadgeTarget,
  candidateKeys,
  profileUrl,
} = await import('../netlify/functions/_badgeState.mjs');
const { renderBadgeSvg, handler: badgeHandler } = await import('../netlify/functions/verify-badge.mjs');
const { handler: statusHandler } = await import('../netlify/functions/verify-badge-status.mjs');

// Strips comments so the source-level assertions below test CODE rather than
// prose. Without it, badge.js explaining "there is no data-state attribute and
// no secrets here" fails the very greps searching for `data-state` and
// `SECRET` — the documentation of a guarantee reading as its violation. A
// regex cannot do this safely (`https://…` inside a string literal looks
// exactly like a line comment), so this tracks string and template state.
function codeOnly(source) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (quote) {
      out += ch;
      if (ch === '\\') { out += next ?? ''; i += 2; continue; }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; out += ch; i += 1; continue; }
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (ch === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      i = end === -1 ? source.length : end;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

const VERIFICATION_STORE = 'khan-trust-verification';
const SOLANA_MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const EVM_TOKEN = '0xAbCdEf0000000000000000000000000000000001';

async function seedStatuses(statuses) {
  await storeFor(VERIFICATION_STORE).setJSON('statuses.json', statuses);
}

const svgFor = (event) => badgeHandler({ httpMethod: 'GET', queryStringParameters: {}, ...event });
const jsonFor = async (event) => {
  const response = await statusHandler({ httpMethod: 'GET', queryStringParameters: {}, ...event });
  return { response, body: JSON.parse(response.body) };
};

// ── The five states, end to end through both transports ─────────────────────

test('a verified project reads Verified in the SVG and the JSON', async () => {
  await seedStatuses({
    [`solana:${SOLANA_MINT}`]: { status: 'verified', expiresAt: '2099-01-01T00:00:00.000Z' },
  });

  const svg = await svgFor({ queryStringParameters: { contract: SOLANA_MINT, chain: 'solana' } });
  assert.equal(svg.statusCode, 200);
  assert.match(svg.body, /Verified/);

  const { body } = await jsonFor({ queryStringParameters: { contract: SOLANA_MINT, chain: 'solana' } });
  assert.equal(body.state, BADGE_STATES.VERIFIED);
  assert.equal(body.verifiedUntil, '2099-01-01T00:00:00.000Z');
});

test('a project nothing knows about reads Unverified, not an error', async () => {
  await seedStatuses({});
  const svg = await svgFor({ queryStringParameters: { contract: SOLANA_MINT, chain: 'solana' } });
  // 200 with an honest badge, never a 404: a broken <img> on a customer's
  // website communicates nothing except that KHAN Trust is broken.
  assert.equal(svg.statusCode, 200);
  assert.match(svg.body, /Unverified/);

  const { response, body } = await jsonFor({ queryStringParameters: { contract: SOLANA_MINT, chain: 'solana' } });
  assert.equal(response.statusCode, 200);
  assert.equal(body.state, BADGE_STATES.UNVERIFIED);
  assert.equal(body.verifiedUntil, null);
});

test('a pending review reads Pending, distinctly from Unverified', async () => {
  await seedStatuses({ [`solana:${SOLANA_MINT}`]: { status: 'pending' } });
  const svg = await svgFor({ queryStringParameters: { contract: SOLANA_MINT, chain: 'solana' } });
  assert.match(svg.body, /Pending/);
  assert.doesNotMatch(svg.body, /Verified/);

  const { body } = await jsonFor({ queryStringParameters: { contract: SOLANA_MINT, chain: 'solana' } });
  assert.equal(body.state, BADGE_STATES.PENDING);
});

test('a lapsed term reads Expired without waiting for any sweeper', async () => {
  await seedStatuses({
    [`solana:${SOLANA_MINT}`]: { status: 'verified', expiresAt: '2020-01-01T00:00:00.000Z' },
  });
  const svg = await svgFor({ queryStringParameters: { contract: SOLANA_MINT, chain: 'solana' } });
  assert.match(svg.body, /Expired/);

  const { body } = await jsonFor({ queryStringParameters: { contract: SOLANA_MINT, chain: 'solana' } });
  assert.equal(body.state, BADGE_STATES.EXPIRED);
  // Never advertise an expiry as if it were still running.
  assert.equal(body.verifiedUntil, null);
});

test('a revoked verification reads Revoked even with an unexpired term', async () => {
  // THE CASE THAT MATTERS MOST. An admin withdrawing a badge must not be
  // overridden by a stale `status: 'verified'` or by a term with months to run.
  await seedStatuses({
    [`solana:${SOLANA_MINT}`]: {
      status: 'verified',
      expiresAt: '2099-01-01T00:00:00.000Z',
      revokedAt: '2026-07-29T00:00:00.000Z',
    },
  });
  const svg = await svgFor({ queryStringParameters: { contract: SOLANA_MINT, chain: 'solana' } });
  assert.match(svg.body, /Revoked/);

  const { body } = await jsonFor({ queryStringParameters: { contract: SOLANA_MINT, chain: 'solana' } });
  assert.equal(body.state, BADGE_STATES.REVOKED);
});

test('a rejected review is reported as Unverified, never as "Rejected"', async () => {
  // A rejection is a private review outcome. Publishing it on the applicant's
  // own website would be a punishment we never agreed to administer, and would
  // tell their competitors the result of a confidential review.
  await seedStatuses({ [`solana:${SOLANA_MINT}`]: { status: 'rejected' } });
  const svg = await svgFor({ queryStringParameters: { contract: SOLANA_MINT, chain: 'solana' } });
  assert.match(svg.body, /Unverified/);
  assert.doesNotMatch(svg.body, /Reject/i);
});

// ── Malformed and hostile input ─────────────────────────────────────────────

test('an invalid contract is refused before any lookup and reads Unverified', async () => {
  await seedStatuses({ 'solana:not a real address': { status: 'verified' } });

  assert.equal(parseBadgeTarget({ contract: 'not a real address', chain: 'solana' }).ok, false);
  assert.equal(parseBadgeTarget({ contract: '0xshort', chain: 'ethereum' }).ok, false);
  assert.equal(parseBadgeTarget({ contract: '', chain: 'solana' }).reason, 'missing_contract');
  // A megabyte of input must not reach a regex engine.
  assert.equal(parseBadgeTarget({ contract: 'A'.repeat(5000), chain: 'solana' }).reason, 'invalid_contract');

  // Even though a matching key was planted in the store, the malformed address
  // never becomes a lookup key, so the seeded "verified" record is unreachable.
  const svg = await svgFor({ queryStringParameters: { contract: 'not a real address', chain: 'solana' } });
  assert.match(svg.body, /Unverified/);
});

test('an unsupported chain is refused rather than guessed at', async () => {
  const target = parseBadgeTarget({ contract: SOLANA_MINT, chain: 'dogecoin' });
  assert.equal(target.ok, false);
  assert.equal(target.reason, 'unsupported_chain');

  const { response, body } = await jsonFor({
    queryStringParameters: { contract: SOLANA_MINT, chain: 'dogecoin' },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(body.state, BADGE_STATES.UNVERIFIED);
  assert.equal(body.reason, 'unsupported_chain');
  // No canonical page exists for a chain we do not index, so no link is
  // offered — inventing one sends the visitor to a 404.
  assert.equal(body.profileUrl, null);
});

test('a forged status parameter cannot manufacture a Verified badge', async () => {
  // THE ATTACK THE WHOLE DESIGN EXISTS TO STOP. The embedding page controls the
  // query string. If any of these could set the state, every badge on the
  // internet would say whatever its host page wanted.
  await seedStatuses({});
  const forgeries = [
    { contract: SOLANA_MINT, chain: 'solana', status: 'verified' },
    { contract: SOLANA_MINT, chain: 'solana', state: 'verified' },
    { contract: SOLANA_MINT, chain: 'solana', verified: 'true' },
    { contract: SOLANA_MINT, chain: 'solana', expiresAt: '2099-01-01T00:00:00.000Z' },
    { contract: SOLANA_MINT, chain: 'solana', revokedAt: '' },
    { projectId: '__proto__' },
    { projectId: 'constructor' },
  ];
  for (const queryStringParameters of forgeries) {
    const svg = await svgFor({ queryStringParameters });
    assert.doesNotMatch(svg.body, />Verified/, `forged params produced a verified badge: ${JSON.stringify(queryStringParameters)}`);
    const { body } = await jsonFor({ queryStringParameters });
    assert.notEqual(body.state, BADGE_STATES.VERIFIED, `forged params produced a verified state: ${JSON.stringify(queryStringParameters)}`);
  }
});

test('markup in a parameter cannot escape into the SVG', async () => {
  // Belt and braces. The renderer draws only from a closed vocabulary, so
  // caller input has no path into the body at all — this asserts the stronger
  // property rather than merely that escaping happened.
  const hostile = '"><script>alert(1)</script><text x="0';
  const svg = await svgFor({ queryStringParameters: { projectId: hostile } });
  assert.equal(svg.statusCode, 200);
  assert.doesNotMatch(svg.body, /<script/i);
  assert.doesNotMatch(svg.body, /alert\(1\)/);
  assert.match(svg.body, /Unverified/);

  // And the renderer itself refuses to render an unknown state as itself.
  const unknown = renderBadgeSvg('totally-made-up');
  assert.match(unknown, /Unverified/);
  assert.doesNotMatch(unknown, /totally-made-up/);
});

test('the badge never reintroduces the unbacked "Rated" claim', () => {
  for (const state of [...Object.values(BADGE_STATES), 'rated', '', undefined, null]) {
    assert.doesNotMatch(renderBadgeSvg(state), /Rated/, `state "${state}" rendered a Rated badge`);
  }
});

// ── The canonical profile link ──────────────────────────────────────────────

// THIS TEST CHANGED IN PHASE 4, AND THE INVARIANT IT PROTECTS DID NOT.
//
// It used to assert `doesNotMatch(profileUrl, /\/t\//)` — the badge must link to
// /token/<contract> and never to a /t/ route. The reason given was correct: a
// SECOND canonical URL for one token splits its search ranking, and these embeds
// are precisely the backlinks that would be split.
//
// Phase 4 did not add a second canonical. It moved the only one, because
// /token/<contract> could not identify a token at all — the same 0x address is a
// different asset on seven EVM chains, and the corpus lookup behind that URL
// derived a Solana-shaped identity so it never resolved an EVM token. The old
// URL now issues a permanent 301 here, which TRANSFERS its accumulated ranking
// rather than competing with it.
//
// So the assertion below is the same invariant restated against the new
// canonical: ONE profile URL, chain-scoped, and no badge may point anywhere else.
test('the badge links to the single canonical /t/<chain>/<contract> profile', async () => {
  await seedStatuses({ [`solana:${SOLANA_MINT}`]: { status: 'verified' } });
  const { body } = await jsonFor({ queryStringParameters: { contract: SOLANA_MINT, chain: 'solana' } });

  assert.ok(body.profileUrl.endsWith(`/t/solana/${SOLANA_MINT}`), `unexpected profile URL: ${body.profileUrl}`);
  // The superseded shape must not come back: two live canonicals is the harm.
  assert.doesNotMatch(body.profileUrl, /\/token\//);
  assert.equal(profileUrl('solana', SOLANA_MINT), body.profileUrl);
});

test('the profile link is chain-scoped, so one address on two chains is two pages', () => {
  const evm = '0xaea46a60368a7bd060eec7df8cba43b7ef41ad85';
  assert.notEqual(profileUrl('ethereum', evm), profileUrl('base', evm));
});

test('a badge with no chain links to the site root rather than guessing one', () => {
  // Guessing 'solana' would send a Base token's badge to a Solana profile page
  // for the same address — a confidently wrong deep link.
  const url = profileUrl('', SOLANA_MINT);
  assert.doesNotMatch(url, /\/t\//);
  assert.ok(url.endsWith('/'), `unexpected fallback URL: ${url}`);
});

test('the profile link is URL-encoded, so an address cannot inject a path', () => {
  const url = profileUrl('solana', 'abc/../../evil?x=1');
  assert.doesNotMatch(url.split('/t/solana/')[1], /[/?]/);
});

// ── Identity rules shared with the rest of the platform ─────────────────────

test('lookup keys follow the canonical identity rules for each chain family', () => {
  // EVM checksum casing is cosmetic, so an EVM address is folded — otherwise
  // the same verified token would miss its own record depending on how the
  // embedder happened to type it.
  const evm = candidateKeys({ contract: EVM_TOKEN, chain: 'ethereum' });
  assert.ok(evm.includes(`ethereum:${EVM_TOKEN.toLowerCase()}`));

  // Solana base58 is case-sensitive and must NOT be folded: two different
  // mints would collide onto one key.
  const sol = candidateKeys({ contract: SOLANA_MINT, chain: 'solana' });
  assert.ok(sol.includes(`solana:${SOLANA_MINT}`));
  assert.ok(!sol.some((key) => key.includes(SOLANA_MINT.toLowerCase()) && SOLANA_MINT.toLowerCase() !== SOLANA_MINT));
});

test('an EVM badge resolves regardless of the casing the embedder used', async () => {
  await seedStatuses({ [`ethereum:${EVM_TOKEN.toLowerCase()}`]: { status: 'verified' } });
  for (const spelling of [EVM_TOKEN, EVM_TOKEN.toLowerCase(), EVM_TOKEN.toUpperCase().replace('0X', '0x')]) {
    const { body } = await jsonFor({ queryStringParameters: { contract: spelling, chain: 'ethereum' } });
    assert.equal(body.state, BADGE_STATES.VERIFIED, `casing "${spelling}" failed to resolve`);
  }
});

test('the original /badge/<projectId> form still resolves', async () => {
  // Embeds using it are already live on other people's websites, and a
  // published URL is a promise.
  await seedStatuses({ 'legacy-project-id': { status: 'verified' } });
  const svg = await svgFor({ queryStringParameters: { projectId: 'legacy-project-id' } });
  assert.match(svg.body, /Verified/);
});

// ── Caching and CORS ────────────────────────────────────────────────────────

test('both transports cache identically, and briefly enough for a revocation to land', async () => {
  await seedStatuses({ [`solana:${SOLANA_MINT}`]: { status: 'verified' } });
  const svg = await svgFor({ queryStringParameters: { contract: SOLANA_MINT, chain: 'solana' } });
  const { response } = await jsonFor({ queryStringParameters: { contract: SOLANA_MINT, chain: 'solana' } });

  assert.equal(svg.headers['Cache-Control'], BADGE_CACHE_CONTROL);
  assert.equal(response.headers['Cache-Control'], BADGE_CACHE_CONTROL);

  // A revoked badge must not keep asserting itself for long on a page we
  // cannot purge. Both the browser and the CDN bound are checked.
  const maxAge = Number(/max-age=(\d+)/.exec(BADGE_CACHE_CONTROL)[1]);
  const sMaxAge = Number(/s-maxage=(\d+)/.exec(BADGE_CACHE_CONTROL)[1]);
  assert.ok(maxAge <= 300, `browser cache ${maxAge}s is too long for a revocable claim`);
  assert.ok(sMaxAge <= 300, `CDN cache ${sMaxAge}s is too long for a revocable claim`);
  // stale-while-revalidate would keep serving a known-stale trust claim.
  assert.doesNotMatch(BADGE_CACHE_CONTROL, /stale-while-revalidate/);
});

test('a revocation is reflected on the next uncached read', async () => {
  await seedStatuses({ [`solana:${SOLANA_MINT}`]: { status: 'verified', expiresAt: '2099-01-01T00:00:00.000Z' } });
  assert.equal((await jsonFor({ queryStringParameters: { contract: SOLANA_MINT, chain: 'solana' } })).body.state, BADGE_STATES.VERIFIED);

  await seedStatuses({
    [`solana:${SOLANA_MINT}`]: { status: 'revoked', expiresAt: '2099-01-01T00:00:00.000Z', revokedAt: new Date().toISOString() },
  });
  assert.equal((await jsonFor({ queryStringParameters: { contract: SOLANA_MINT, chain: 'solana' } })).body.state, BADGE_STATES.REVOKED);
});

test('the JSON endpoint is readable cross-origin but carries no credentials', async () => {
  const { response } = await jsonFor({ queryStringParameters: { contract: SOLANA_MINT, chain: 'solana' } });
  assert.equal(response.headers['Access-Control-Allow-Origin'], '*');
  // With `*` a credentialed response is rejected by browsers anyway; its
  // presence would imply this endpoint has a notion of a signed-in caller.
  assert.equal(response.headers['Access-Control-Allow-Credentials'], undefined);
  assert.equal(response.headers['X-Content-Type-Options'], 'nosniff');

  const preflight = await statusHandler({ httpMethod: 'OPTIONS', queryStringParameters: {} });
  assert.equal(preflight.statusCode, 204);
});

test('the JSON endpoint publishes only what a badge needs', async () => {
  // Everything here is served to every visitor of every embedding site.
  await seedStatuses({
    [`solana:${SOLANA_MINT}`]: {
      status: 'verified',
      expiresAt: '2099-01-01T00:00:00.000Z',
      ownerWallet: 'OwnerWallet1111111111111111111111111111111',
      adminNote: 'internal reviewer note',
      badgeToken: 'deadbeefdeadbeefdeadbeefdeadbeef',
      orderId: 'vo-123',
      tier: 'verified_pro',
    },
  });
  const { response } = await jsonFor({ queryStringParameters: { contract: SOLANA_MINT, chain: 'solana' } });
  for (const secret of ['OwnerWallet1111111111111111111111111111111', 'internal reviewer note', 'deadbeefdeadbeefdeadbeefdeadbeef', 'vo-123']) {
    assert.ok(!response.body.includes(secret), `the badge endpoint leaked "${secret}"`);
  }
});

// ── The widget script ───────────────────────────────────────────────────────

test('the widget ships no secret and talks only to its own origin', () => {
  const source = codeOnly(readFileSync(join(ROOT, 'public', 'badge.js'), 'utf8'));
  assert.doesNotMatch(source, /API_KEY|SECRET|Bearer |Authorization/i);
  // Origin is derived from the script's own src, so an embedding page cannot
  // repoint it at a server it controls.
  assert.match(source, /document\.currentScript/);
  assert.match(source, /credentials:\s*'omit'/);
});

test('the widget never assigns untrusted data to innerHTML', () => {
  const source = codeOnly(readFileSync(join(ROOT, 'public', 'badge.js'), 'utf8'));
  assert.doesNotMatch(source, /\.innerHTML\s*=/);
  assert.doesNotMatch(source, /\.outerHTML\s*=/);
  assert.doesNotMatch(source, /insertAdjacentHTML/);
  assert.doesNotMatch(source, /document\.write/);
  // The status text is the only network-derived string rendered, and it goes
  // through textContent.
  assert.match(source, /textContent = presentation\.text/);
});

test('the widget reads no state from the embedding page', () => {
  const source = codeOnly(readFileSync(join(ROOT, 'public', 'badge.js'), 'utf8'));
  for (const forbidden of ['data-state', 'data-status', 'data-verified', 'data-score', 'data-expires']) {
    assert.ok(!source.includes(forbidden), `the widget reads "${forbidden}" from the host page`);
  }
  // Only the identity of the token may come from the page.
  assert.match(source, /getAttribute\('data-contract'\)/);
});

test('the widget only follows http(s) links back to its own origin', () => {
  const source = codeOnly(readFileSync(join(ROOT, 'public', 'badge.js'), 'utf8'));
  // A scheme ALLOW-list, not a blocklist: javascript: and data: are discarded
  // rather than sanitised.
  assert.match(source, /protocol !== 'https:' && url\.protocol !== 'http:'/);
  assert.match(source, /url\.origin !== ORIGIN/);
  assert.match(source, /rel', 'noopener noreferrer'/);
});

test('the widget knows exactly the five server states and no more', () => {
  // The widget is served verbatim to third-party pages and cannot import from
  // the build, so its vocabulary is a second copy. This is the guard that keeps
  // the copies in step instead of trusting that they will be.
  const source = readFileSync(join(ROOT, 'public', 'badge.js'), 'utf8');
  const table = /var STATES = \{([\s\S]*?)\n  \};/.exec(source);
  assert.ok(table, 'the widget state table could not be located');

  const declared = [...table[1].matchAll(/^\s*([a-z_]+):\s*\{/gm)].map((match) => match[1]).sort();
  assert.deepEqual(declared, [...Object.values(BADGE_STATES)].sort(),
    'the widget and _badgeState.mjs disagree about which states exist');

  // An unrecognised server state must fall back rather than render itself.
  assert.match(source, /hasOwnProperty\.call\(STATES, state\)/);
  assert.match(source, /state = 'unverified'/);
});

test('the widget renders its conservative state before the network answers', () => {
  // A badge that flashes "Verified" and then settles into something else has
  // already made the claim, however briefly.
  const source = codeOnly(readFileSync(join(ROOT, 'public', 'badge.js'), 'utf8'));
  const preRender = source.indexOf("render(host, 'unverified', null)");
  const fetchCall = source.indexOf('fetch(endpoint');
  assert.ok(preRender > -1, 'no pre-answer render found');
  assert.ok(preRender < fetchCall, 'the placeholder must render before the request is made');
});

// ── Wiring that is easy to get silently wrong ───────────────────────────────

test('the documented badge routes exist', () => {
  const toml = readFileSync(join(ROOT, 'netlify.toml'), 'utf8');
  assert.match(toml, /from = "\/badge\/:chain\/:contract"/);
  assert.match(toml, /from = "\/badge\/:projectId"/);
  // The widget asks for /badge-status; if this alias were dropped the widget
  // would fail silently on every embedding site.
  assert.match(toml, /from = "\/badge-status"/);

  const widget = codeOnly(readFileSync(join(ROOT, 'public', 'badge.js'), 'utf8'));
  assert.match(widget, /'\/badge-status\?'/);
});

// Phase 4 replaced the old "there must be no /t/ route at all" assertion, which
// existed to stop a SECOND canonical appearing. /t/ is now the ONLY canonical
// and /token/ redirects to it, so the invariant is restated as what actually
// matters: exactly one of the two may serve a page, and the other must redirect.
test('exactly one token URL serves a page; the legacy one permanently redirects', () => {
  const toml = readFileSync(join(ROOT, 'netlify.toml'), 'utf8');
  assert.match(toml, /from = "\/t\/:chain\/:contract"/, 'the canonical profile route is missing');

  const tokenPage = readFileSync(join(ROOT, 'netlify', 'functions', 'token-page.mjs'), 'utf8');
  assert.match(tokenPage, /statusCode: 301/, '/token/<contract> must 301 to the canonical, not serve a competing page');
});

test('the two-segment badge route is declared before the one-segment route', () => {
  // Netlify evaluates redirects in order. Declared the other way round this
  // still works today, but the ordering is load-bearing enough to pin.
  const toml = readFileSync(join(ROOT, 'netlify.toml'), 'utf8');
  assert.ok(toml.indexOf('/badge/:chain/:contract') < toml.indexOf('/badge/:projectId'));
});

test('resolveBadgeState defaults to unverified for anything it does not understand', () => {
  for (const record of [null, undefined, {}, 'verified', 42, { status: 'nonsense' }]) {
    assert.equal(resolveBadgeState(record), BADGE_STATES.UNVERIFIED, `record ${JSON.stringify(record)} was not treated as unverified`);
  }
});
