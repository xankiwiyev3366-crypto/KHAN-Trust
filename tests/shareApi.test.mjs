// Tests for the centralised sharing API and the Trust Card data model.
//
// These cover the pure, transport-and-format logic: canonical URL building,
// share-text templating, X/Telegram intent encoding, the clipboard-copy result
// contract (including the graceful fallback when no clipboard exists), and the
// exact set of values the card renders. The canvas pixel draw and native OS
// share sheet require a real browser and are verified in-app, not here.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  reportShareUrl, buildShareText, xIntentUrl, telegramIntentUrl,
  copyText, DEFAULT_HASHTAGS, isMobile,
} from '../src/shareApi.js';
import { buildCardModel } from '../src/trustCard.js';

const project = {
  name: 'Test Token', ticker: 'tst', chain: 'Ethereum', chainId: 'ethereum',
  contract: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  trustScore: 82, riskLevel: 'Low',
  scamRisk: { level: 'Low', riskScore: 12 },
  realData: {
    marketCapUsd: 5_400_000, totalLiquidityUsd: 820_000,
    holderCount: 4213, topHolderPercent: 18, logoUrl: 'https://x/y.png',
  },
};

test('reportShareUrl builds the canonical /token/<contract> URL', () => {
  assert.equal(
    reportShareUrl(project),
    'https://khantrust.net/token/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  );
});

test('reportShareUrl falls back to the site root when there is no usable contract', () => {
  assert.equal(reportShareUrl({ contract: 'Not provided' }), 'https://khantrust.net');
  assert.equal(reportShareUrl({}), 'https://khantrust.net');
});

test('buildShareText fills the template with name + score', () => {
  const text = buildShareText({
    name: 'Test Token', score: 82,
    template: '{{name}} scored {{score}}/100 on KHAN Trust.',
  });
  assert.equal(text, 'Test Token scored 82/100 on KHAN Trust.');
});

test('buildShareText has a sensible default and handles a missing score', () => {
  assert.match(buildShareText({ name: 'Foo', score: 50 }), /Foo scored 50\/100/);
  assert.match(buildShareText({ name: 'Foo' }), /Foo/);
  assert.doesNotThrow(() => buildShareText({}));
});

test('xIntentUrl encodes text, url and hashtags correctly', () => {
  const url = xIntentUrl({
    text: 'A & B risk 100%', url: 'https://khantrust.net/token/0xabc',
    hashtags: ['#KHANTrust', 'crypto'],
  });
  assert.match(url, /^https:\/\/twitter\.com\/intent\/tweet\?/);
  const q = new URL(url).searchParams;
  assert.equal(q.get('text'), 'A & B risk 100%');
  assert.equal(q.get('url'), 'https://khantrust.net/token/0xabc');
  assert.equal(q.get('hashtags'), 'KHANTrust,crypto', 'leading # stripped, comma-joined');
});

test('telegramIntentUrl includes both the url and the text', () => {
  const url = telegramIntentUrl({ text: 'hi', url: 'https://khantrust.net/token/0xabc' });
  assert.match(url, /^https:\/\/t\.me\/share\/url\?/);
  const q = new URL(url).searchParams;
  assert.equal(q.get('url'), 'https://khantrust.net/token/0xabc');
  assert.equal(q.get('text'), 'hi');
});

test('copyText uses the async Clipboard API when available', async () => {
  // navigator is a read-only global getter in modern Node — override its
  // descriptor for the test, then restore it exactly.
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let written = null;
  Object.defineProperty(globalThis, 'navigator', {
    value: { clipboard: { writeText: async (v) => { written = v; } } },
    configurable: true, writable: true,
  });
  try {
    const res = await copyText('hello');
    assert.deepEqual(res, { ok: true, method: 'clipboard' });
    assert.equal(written, 'hello');
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete globalThis.navigator;
  }
});

test('copyText fails cleanly (not silently) when no clipboard mechanism exists', async () => {
  // No navigator.clipboard and no document → structured failure, never a throw.
  const res = await copyText('hello');
  assert.equal(res.ok, false);
  assert.equal(res.method, 'none');
});

test('copyText refuses empty input', async () => {
  assert.deepEqual(await copyText(''), { ok: false, method: 'none' });
});

test('DEFAULT_HASHTAGS is on-brand', () => {
  assert.ok(DEFAULT_HASHTAGS.includes('KHANTrust'));
});

test('isMobile is false in a non-browser env', () => {
  assert.equal(isMobile(), false);
});

// ── The card contains every required field (spec 3) ──────────────────────────
test('buildCardModel surfaces every required card field from real data', () => {
  const model = buildCardModel(project, {
    chainLabel: 'Ethereum', chainColor: '#627eea',
    securityVerdict: 'No critical security flags detected', securityColor: '#67d39c',
    url: 'https://khantrust.net/token/0xC02',
    isVerified: true, timestamp: '2026-07-22 10:00 UTC',
  });
  assert.equal(model.name, 'Test Token');
  assert.equal(model.ticker, 'TST', 'ticker upper-cased');
  assert.equal(model.chainLabel, 'Ethereum');
  assert.equal(model.chainColor, '#627eea');
  assert.equal(model.trustScore, 82);
  assert.equal(model.riskLevel, 'Low');
  assert.equal(model.marketCap, '$5.40M');
  assert.equal(model.liquidity, '$820.0K');
  assert.equal(model.holderRisk, '18%', 'top-holder concentration is the holder-risk figure');
  assert.equal(model.securityVerdict, 'No critical security flags detected');
  assert.equal(model.url, 'https://khantrust.net/token/0xC02');
  assert.equal(model.timestamp, '2026-07-22 10:00 UTC');
  assert.equal(model.isVerified, true);
  assert.equal(model.logoUrl, 'https://x/y.png');
});

test('buildCardModel never fabricates a missing metric — it shows "—"', () => {
  const model = buildCardModel({ name: 'Thin', trustScore: 40, realData: {} });
  assert.equal(model.marketCap, '—');
  assert.equal(model.liquidity, '—');
  assert.equal(model.holderRisk, '—');
  assert.equal(model.scamProbability, '—');
});

test('buildCardModel clamps the score to 0..100', () => {
  assert.equal(buildCardModel({ trustScore: 140 }).trustScore, 100);
  assert.equal(buildCardModel({ trustScore: -5 }).trustScore, 0);
  assert.equal(buildCardModel({ trustScore: NaN }).trustScore, 0);
});
