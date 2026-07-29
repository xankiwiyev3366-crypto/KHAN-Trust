// Phase 4 — the public token profile: its URL, its metadata, its indexing rules
// and the HTTP status codes it answers with.
//
// The renderers are pure by design, so almost everything here runs by handing a
// plain object to a function — no Blobs, no network, no Netlify.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  profilePath,
  profileUrlFor,
  parseProfilePath,
  buildProfileMeta,
  buildProfileJsonLd,
  isProfileIndexable,
  profileVerificationState,
  isProfileVerified,
  clampText,
  PROFILE_VERIFICATION,
} from '../src/lib/publicProfile.js';
import {
  renderProfileHtml,
  renderRejectionHtml,
  resolveTarget,
} from '../netlify/functions/token-profile.mjs';
import { renderOgSvg, renderFallbackSvg } from '../netlify/functions/profile-og.mjs';
import { isEligible, buildSitemapXml } from '../netlify/functions/sitemap.mjs';

const ROOT = process.cwd();
const SOL = 'So11111111111111111111111111111111111111112';
const EVM = '0xaea46a60368a7bd060eec7df8cba43b7ef41ad85';
const ORIGIN = 'https://khantrust.net';

// `verification` is merged rather than replaced. Spreading `overrides` wholesale
// would let a test that only sets `{ verification: { state } }` silently drop
// badgeStatusUrl and every other field — and the test would then "pass" against
// a page that was missing them.
function view(overrides = {}) {
  const { verification: verificationOverride, ...rest } = overrides;
  const base = {
    chain: 'solana',
    contract: SOL,
    chainName: 'Solana',
    name: 'Wrapped SOL',
    symbol: 'SOL',
    category: '',
    logoUrl: null,
    trustScore: 82,
    riskLevel: 'Low',
    confidenceLabel: '',
    scannedAt: '2026-07-20T10:00:00.000Z',
    flags: [],
    links: [],
    channels: [],
    verification: {
      state: PROFILE_VERIFICATION.UNVERIFIED,
      tier: '',
      ownershipMethod: '',
      issuedAt: '',
      expiresAt: '',
      revokedAt: '',
      badgeUrl: `${ORIGIN}/badge/solana/${SOL}`,
      badgeStatusUrl: `${ORIGIN}/badge-status?chain=solana&contract=${SOL}`,
    },
    canonical: `${ORIGIN}/t/solana/${SOL}`,
    ogImageUrl: `${ORIGIN}/og/t/solana/${SOL}.svg`,
    scanUrl: `${ORIGIN}/?scan=${SOL}`,
    verifyUrl: `${ORIGIN}/#/verify?contract=${SOL}&chain=solana`,
    exists: true,
    indexable: true,
    ...rest,
  };
  if (verificationOverride) base.verification = { ...base.verification, ...verificationOverride };
  return base;
}

// ── The URL ─────────────────────────────────────────────────────────────────

test('the canonical URL is chain-scoped, so one address on two chains is two pages', () => {
  assert.notEqual(profilePath('ethereum', EVM), profilePath('base', EVM));
  assert.equal(profilePath('solana', SOL), `/t/solana/${SOL}`);
});

test('the URL encodes its segments, so a contract cannot inject a path', () => {
  const path = profilePath('solana', '../../admin?x=1');
  assert.doesNotMatch(path.slice('/t/solana/'.length), /[/?]/);
});

test('parseProfilePath accepts exactly two segments and rejects trailing junk', () => {
  assert.deepEqual(parseProfilePath(`/t/solana/${SOL}`), { chain: 'solana', contract: SOL });
  // A trailing segment must NOT resolve: tolerating it would mint unlimited
  // distinct URLs all serving identical content — duplicate content at infinite
  // scale.
  assert.deepEqual(parseProfilePath(`/t/solana/${SOL}/extra`), { chain: null, contract: null });
  assert.deepEqual(parseProfilePath('/t/solana'), { chain: null, contract: null });
  assert.deepEqual(parseProfilePath('/token/abc'), { chain: null, contract: null });
});

test('parseProfilePath tolerates a trailing slash but lower-cases only the chain', () => {
  // Solana base58 is case-sensitive; folding a contract would address a
  // different mint.
  const parsed = parseProfilePath(`/t/SOLANA/${SOL}/`);
  assert.equal(parsed.chain, 'solana');
  assert.equal(parsed.contract, SOL);
});

test('resolveTarget reads the path first and the query only as a fallback', () => {
  assert.deepEqual(
    resolveTarget({ path: `/t/base/${EVM}`, queryStringParameters: {} }),
    { chain: 'base', contract: EVM },
  );
  // Netlify populates queryStringParameters from the ORIGINAL request, not from
  // the redirect target — the production bug tokenPage.test.mjs locks in.
  assert.deepEqual(
    resolveTarget({ rawUrl: `https://khantrust.net/t/bsc/${EVM}`, queryStringParameters: {} }),
    { chain: 'bsc', contract: EVM },
  );
  assert.deepEqual(
    resolveTarget({ path: '/.netlify/functions/token-profile', queryStringParameters: { chain: 'Solana', contract: SOL } }),
    { chain: 'solana', contract: SOL },
  );
});

// ── Metadata ────────────────────────────────────────────────────────────────

test('every head tag the requirement lists is present and non-empty', () => {
  const html = renderProfileHtml(view(), { origin: ORIGIN });
  for (const pattern of [
    /<title>[^<]+<\/title>/,
    /<meta name="description" content="[^"]+"/,
    /<link rel="canonical" href="https:\/\/khantrust\.net\/t\/solana\//,
    /<meta property="og:title" content="[^"]+"/,
    /<meta property="og:description" content="[^"]+"/,
    /<meta property="og:image" content="[^"]+"/,
    /<meta property="og:url" content="[^"]+"/,
    /<meta name="twitter:card" content="summary_large_image"/,
    /<meta name="twitter:title" content="[^"]+"/,
    /<meta name="twitter:description" content="[^"]+"/,
    /<meta name="robots" content="[^"]+"/,
    /<script type="application\/ld\+json">/,
  ]) {
    assert.match(html, pattern, `missing head tag: ${pattern}`);
  }
});

test('title, og:title and twitter:title cannot disagree', () => {
  const meta = buildProfileMeta(view(), { origin: ORIGIN });
  assert.equal(meta.title, meta.ogTitle);
  assert.equal(meta.title, meta.twitterTitle);
  assert.equal(meta.description, meta.ogDescription);
  assert.equal(meta.description, meta.twitterDescription);
});

test('the title follows the documented shape and stays within the SERP cut', () => {
  const meta = buildProfileMeta(view({ name: 'Wrapped SOL', symbol: 'SOL' }), { origin: ORIGIN });
  assert.match(meta.title, /Wrapped SOL \(SOL\)/);
  assert.match(meta.title, /Trust Score/);
  assert.ok(meta.title.length <= 65, `title too long: ${meta.title.length}`);
  assert.ok(meta.description.length <= 160, `description too long: ${meta.description.length}`);
});

test('clampText trims at a word boundary rather than mid-word', () => {
  assert.equal(clampText('short', 40), 'short');
  // 'hello world again' at 12 keeps the last WHOLE word that fits.
  assert.equal(clampText('hello world again', 12), 'hello world…');
  // The invariant that actually matters: never longer than the cap, and never
  // ending mid-word when a usable boundary exists.
  for (const max of [10, 20, 40, 65]) {
    const out = clampText('Wrapped SOL Trust Score Risk Analysis and Verification KHAN Trust', max);
    assert.ok(out.length <= max, `exceeded ${max}: ${out.length}`);
  }
  // A single word longer than the cap has no boundary to use and is cut hard
  // rather than returned whole.
  assert.ok(clampText('supercalifragilisticexpialidocious', 10).length <= 10);
});

test('a card with no image declares the small twitter card, not an empty large one', () => {
  const meta = buildProfileMeta(view({ ogImageUrl: '' }), { origin: ORIGIN });
  assert.equal(meta.twitterCard, 'summary');
  const html = renderProfileHtml(view({ ogImageUrl: '' }), { origin: ORIGIN });
  assert.doesNotMatch(html, /property="og:image"/);
});

test('a token field containing </script> cannot break out of the JSON-LD block', () => {
  const html = renderProfileHtml(view({ name: '</script><script>alert(1)</script>' }), { origin: ORIGIN });
  const ld = html.slice(html.indexOf('application/ld+json'), html.indexOf('</head>'));
  assert.doesNotMatch(ld, /<\/script><script>/);
  assert.match(ld, /\\u003c/);
});

test('a token name containing HTML is escaped in the body and the meta', () => {
  const html = renderProfileHtml(view({ name: '<img src=x onerror=alert(1)>' }), { origin: ORIGIN });
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x/);
});

// ── Structured data ─────────────────────────────────────────────────────────

test('the Rating node is emitted only when a real score exists', () => {
  const withScore = buildProfileJsonLd(view({ trustScore: 82 }), { origin: ORIGIN });
  assert.ok(withScore['@graph'].some((node) => node['@type'] === 'Rating'));

  // Absence is not a zero. A Rating node with an invented ratingValue is a
  // factual claim we cannot support.
  const without = buildProfileJsonLd(view({ trustScore: null }), { origin: ORIGIN });
  assert.ok(!without['@graph'].some((node) => node['@type'] === 'Rating'));
});

// ── Indexing rules ──────────────────────────────────────────────────────────

test('a scored token is indexable', () => {
  assert.equal(isProfileIndexable(view({ trustScore: 61 })), true);
});

test('an unscored, unverified token is NOT indexable', () => {
  // The whole /t/ URL space is infinite. Indexing thin placeholders invites a
  // sitewide quality judgement that lands on the pages which DO have content.
  assert.equal(isProfileIndexable(view({ trustScore: null, verification: { state: PROFILE_VERIFICATION.UNVERIFIED } })), false);
});

test('an expired or revoked verification keeps the page indexable even with no score', () => {
  for (const state of [PROFILE_VERIFICATION.EXPIRED, PROFILE_VERIFICATION.REVOKED, PROFILE_VERIFICATION.ACTIVE]) {
    assert.equal(
      isProfileIndexable(view({ trustScore: null, verification: { state } })),
      true,
      `${state} should be indexable — it is a genuine, unique record`,
    );
  }
});

test('a non-indexable page says noindex in its meta AND is still useful', () => {
  const html = renderProfileHtml(view({ trustScore: null, indexable: false, verification: { state: PROFILE_VERIFICATION.UNVERIFIED } }), { origin: ORIGIN });
  assert.match(html, /<meta name="robots" content="noindex,follow"/);
  // Still a real page for the human who followed the link.
  assert.match(html, /Run a live trust scan/);
});

// ── Verification states ─────────────────────────────────────────────────────

test('badge states map onto the profile vocabulary with no state lost', () => {
  assert.equal(profileVerificationState('verified'), PROFILE_VERIFICATION.ACTIVE);
  assert.equal(profileVerificationState('expired'), PROFILE_VERIFICATION.EXPIRED);
  assert.equal(profileVerificationState('revoked'), PROFILE_VERIFICATION.REVOKED);
  assert.equal(profileVerificationState('pending'), PROFILE_VERIFICATION.PENDING);
  assert.equal(profileVerificationState('unverified'), PROFILE_VERIFICATION.UNVERIFIED);
  // Anything unrecognised fails closed.
  assert.equal(profileVerificationState('nonsense'), PROFILE_VERIFICATION.UNVERIFIED);
  assert.equal(profileVerificationState(undefined), PROFILE_VERIFICATION.UNVERIFIED);
});

test('only an ACTIVE verification counts as verified', () => {
  assert.equal(isProfileVerified(PROFILE_VERIFICATION.ACTIVE), true);
  for (const state of ['expired', 'revoked', 'pending', 'unverified']) {
    assert.equal(isProfileVerified(state), false, `${state} must not read as verified`);
  }
});

test('an expired project retains its history rather than reading as never-verified', () => {
  const html = renderProfileHtml(view({
    verification: { state: PROFILE_VERIFICATION.EXPIRED, expiresAt: '2026-01-01T00:00:00.000Z', tier: 'verified' },
  }), { origin: ORIGIN });
  assert.match(html, /Verification expired/);
  assert.match(html, /was verified by KHAN Trust/);
  assert.match(html, /2026-01-01/);
});

test('a revoked project says so plainly and is never described as unverified', () => {
  const html = renderProfileHtml(view({
    verification: { state: PROFILE_VERIFICATION.REVOKED, revokedAt: '2026-06-01T00:00:00.000Z' },
  }), { origin: ORIGIN });
  assert.match(html, /Verification revoked/);
  assert.match(html, /withdrew/);
});

// ── Anti-forgery ────────────────────────────────────────────────────────────

test('the page links verification to the LIVE lookup and says a screenshot proves nothing', () => {
  const html = renderProfileHtml(view({ verification: { state: PROFILE_VERIFICATION.ACTIVE } }), { origin: ORIGIN });
  assert.match(html, /badge-status\?chain=solana/);
  assert.match(html, /screenshot proves nothing/i);
  // And it re-checks itself client-side, so a cached page cannot keep asserting
  // a verification that has since been revoked.
  assert.match(html, /data-badge-pill/);
});

test('the live re-check updates EVERY claim on the page, not just one pill', () => {
  // FOUND BY OPENING THE PAGE IN A BROWSER, not by a test. The re-check
  // rewrote the verification pill to "Not verified" and left the sentence
  // beneath it reading "this verification is currently active" — the page
  // contradicting itself in two adjacent lines. A stale badge is one wrong
  // claim; a half-updated page is two, and a reader cannot tell which to
  // believe.
  const html = renderProfileHtml(view({ verification: { state: PROFILE_VERIFICATION.ACTIVE, tier: 'verified' } }), { origin: ORIGIN });

  // Both copies of the status are addressable...
  const pillCount = (html.match(/data-badge-pill/g) || []).length;
  assert.ok(pillCount >= 2, `expected the header and section pills to be addressable, found ${pillCount}`);
  // ...the summary sentence is...
  assert.match(html, /data-badge-summary/);
  // ...and so are the term dates, which belong to the superseded verification.
  assert.match(html, /data-badge-rows/);

  // The script must update all of them.
  const script = html.slice(html.lastIndexOf('<script>'));
  assert.match(script, /querySelectorAll\('\[data-badge-pill\]'\)/);
  assert.match(script, /summary\.textContent = next\.summary/);
  assert.match(script, /next\.summary/);
});

// ── Progressive enhancement ─────────────────────────────────────────────────

test('the page is complete with JavaScript disabled', () => {
  const html = renderProfileHtml(view({ trustScore: 82, riskLevel: 'Low' }), { origin: ORIGIN });
  const noScript = html.replace(/<script[\s\S]*?<\/script>/g, '');
  // Score, risk, contract, verification state and both CTAs survive.
  assert.match(noScript, /82/);
  assert.match(noScript, /Low/);
  assert.match(noScript, new RegExp(SOL));
  assert.match(noScript, /Run a live trust scan/);
  assert.match(noScript, /Start verification/);
  // The copy button is the ONLY thing that needs JS, and it ships hidden.
  assert.match(html, /data-copy hidden/);
});

test('an unscored token says so rather than showing a zero', () => {
  const html = renderProfileHtml(view({ trustScore: null }), { origin: ORIGIN });
  assert.match(html, /Not yet scored/);
  assert.match(html, /not a zero/);
  assert.doesNotMatch(html, /<b>0<\/b>/);
});

// ── Rejections ──────────────────────────────────────────────────────────────

test('each rejection reason gets the sentence that is actually true', () => {
  assert.match(renderRejectionHtml('unsupported_chain', { origin: ORIGIN }), /does not support that blockchain/);
  assert.match(renderRejectionHtml('invalid_contract', { origin: ORIGIN }), /valid contract address/);
  // A 503 must NOT tell someone their perfectly good address is malformed.
  const unavailable = renderRejectionHtml('unavailable', { origin: ORIGIN });
  assert.match(unavailable, /Temporarily unavailable/);
  assert.doesNotMatch(unavailable, /valid contract address/);
});

test('every rejection page is noindex', () => {
  for (const reason of ['unsupported_chain', 'invalid_contract', 'unavailable']) {
    assert.match(renderRejectionHtml(reason, { origin: ORIGIN }), /noindex/);
  }
});

// ── Social image ────────────────────────────────────────────────────────────

test('the share card renders score, verification state and branding', () => {
  const svg = renderOgSvg(view({ trustScore: 82, riskLevel: 'Low', verification: { state: PROFILE_VERIFICATION.ACTIVE } }));
  assert.match(svg, /^<svg /);
  assert.match(svg, /1200/);
  assert.match(svg, /KHAN Trust/);
  assert.match(svg, /82/);
  assert.match(svg, /Verified/);
  assert.match(svg, /Solana/);
});

test('the share card shows "not yet scored" rather than a zero', () => {
  const svg = renderOgSvg(view({ trustScore: null }));
  assert.match(svg, /Not yet scored/);
});

test('the share card escapes token names and cannot be broken by markup', () => {
  const svg = renderOgSvg(view({ name: '</text><script>x</script>', symbol: '<b>' }));
  assert.doesNotMatch(svg, /<script>/);
  assert.match(svg, /&lt;/);
});

test('the fallback card is always a valid KHAN Trust card', () => {
  const svg = renderFallbackSvg();
  assert.match(svg, /^<svg /);
  assert.match(svg, /KHAN Trust/);
});

// ── Sitemap ─────────────────────────────────────────────────────────────────

test('the sitemap lists canonical /t/ URLs, never the redirecting /token/ one', () => {
  const xml = buildSitemapXml([{ chain: 'solana', contract: SOL, trustScore: 70, updatedAt: '2026-07-20T00:00:00Z' }], { siteUrl: ORIGIN });
  assert.match(xml, new RegExp(`/t/solana/${SOL}`));
  assert.doesNotMatch(xml, /\/token\//);
  assert.match(xml, /<lastmod>2026-07-20<\/lastmod>/);
});

test('the sitemap excludes unsupported chains, malformed addresses and unscored tokens', () => {
  assert.equal(isEligible({ chain: 'solana', contract: SOL, trustScore: 70 }), true);
  assert.equal(isEligible({ chain: 'dogechain', contract: SOL, trustScore: 70 }), false, 'unsupported chain');
  assert.equal(isEligible({ chain: 'ethereum', contract: 'not-an-address', trustScore: 70 }), false, 'malformed');
  assert.equal(isEligible({ chain: 'solana', contract: SOL, trustScore: null }), false, 'thin page');
  assert.equal(isEligible({ chain: 'solana', trustScore: 70 }), false, 'no contract');
  assert.equal(isEligible(null), false);
});

test('sitemap eligibility and the page robots rule cannot disagree', () => {
  // A page saying noindex while the sitemap begs Google to index it is the most
  // common self-inflicted SEO fault there is. Both read isProfileIndexable.
  const entry = { chain: 'solana', contract: SOL, trustScore: 70 };
  assert.equal(isEligible(entry), isProfileIndexable({ ...entry, verification: { state: 'unverified' } }));
});

test('the sitemap escapes XML and always contains the home page', () => {
  const xml = buildSitemapXml([], { siteUrl: ORIGIN });
  assert.match(xml, /<loc>https:\/\/khantrust\.net\/<\/loc>/);
  assert.match(xml, /^<\?xml/);
});

// ── robots.txt and the noindex headers ──────────────────────────────────────

test('robots.txt disallows every private surface and points at the sitemap', () => {
  const robots = readFileSync(join(ROOT, 'public', 'robots.txt'), 'utf8');
  for (const path of ['/console', '/admin.html', '/receipt/', '/.netlify/', '/badge-status']) {
    assert.match(robots, new RegExp(`Disallow: ${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), `${path} is not disallowed`);
  }
  assert.match(robots, /Sitemap: https:\/\/khantrust\.net\/sitemap\.xml/);
});

test('robots.txt does NOT block the og:image path', () => {
  // Twitterbot and facebookexternalhit honour robots.txt when fetching og:image;
  // blocking /og/ would silently strip the preview from every shared link.
  const robots = readFileSync(join(ROOT, 'public', 'robots.txt'), 'utf8');
  assert.doesNotMatch(robots, /Disallow: \/og\//);
});

test('every private surface also carries an X-Robots-Tag header', () => {
  // Disallow stops a FETCH; only the header keeps a URL out of the index.
  const toml = readFileSync(join(ROOT, 'netlify.toml'), 'utf8');
  for (const path of ['/console', '/admin.html', '/receipt/*', '/unsubscribe', '/badge-status', '/.netlify/functions/*']) {
    const block = toml.slice(toml.indexOf(`for = "${path}"`));
    assert.ok(toml.includes(`for = "${path}"`), `no header block for ${path}`);
    assert.match(block.slice(0, 300), /X-Robots-Tag/, `${path} has no X-Robots-Tag`);
  }
});

test('the profile and og routes are wired', () => {
  const toml = readFileSync(join(ROOT, 'netlify.toml'), 'utf8');
  assert.match(toml, /from = "\/t\/:chain\/:contract"/);
  assert.match(toml, /from = "\/og\/t\/:chain\/:contract"/);
  assert.match(toml, /from = "\/receipt\/:orderId"/);
});

test('profileUrlFor returns empty rather than a half-built URL when inputs are missing', () => {
  assert.equal(profileUrlFor(ORIGIN, '', SOL), '');
  assert.equal(profileUrlFor(ORIGIN, 'solana', ''), '');
});
