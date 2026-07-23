// Regression tests for the server-rendered /token/<contract> page.
//
// The production bug these lock in: shared links are the pretty path
// /token/<contract> with NO query string. Netlify populates a function's
// event.queryStringParameters from the ORIGINAL client request, not from the
// query string written into the redirect `to`, so the contract must be read
// from the path. Reading it only from the query string returned "Missing token"
// for every real shared link. These cover resolveContract's inputs and the
// pure HTML renderer's not-found / found branches.
import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveContract, renderTokenHtml } from '../netlify/functions/token-page.mjs';

const CONTRACT = '0xaea46a60368a7bd060eec7df8cba43b7ef41ad85';

test('resolveContract reads the contract from the rewritten path (no query string)', () => {
  const event = { path: `/token/${CONTRACT}`, queryStringParameters: {} };
  assert.equal(resolveContract(event), CONTRACT);
});

test('resolveContract falls back to rawUrl when path is absent', () => {
  const event = { rawUrl: `https://khantrust.net/token/${CONTRACT}`, queryStringParameters: {} };
  assert.equal(resolveContract(event), CONTRACT);
});

test('resolveContract still honours a direct ?contract= call (local dev / direct function URL)', () => {
  const event = { path: '/.netlify/functions/token-page', queryStringParameters: { contract: CONTRACT } };
  assert.equal(resolveContract(event), CONTRACT);
});

test('resolveContract decodes a percent-encoded path segment', () => {
  const event = { path: `/token/${encodeURIComponent(CONTRACT)}`, queryStringParameters: {} };
  assert.equal(resolveContract(event), CONTRACT);
});

test('resolveContract returns empty string when there is genuinely no contract', () => {
  assert.equal(resolveContract({ path: '/token/', queryStringParameters: {} }), '');
  assert.equal(resolveContract({}), '');
});

test('renderTokenHtml serves a useful (noindex) page when the token is not in the corpus', () => {
  const html = renderTokenHtml(null, { contract: CONTRACT });
  assert.match(html, /noindex/);
  assert.match(html, new RegExp(CONTRACT));
  assert.doesNotMatch(html, /Missing token/);
});

test('renderTokenHtml renders the trust verdict when the token is known', () => {
  const html = renderTokenHtml(
    { name: 'Weth', ticker: 'WETH', chain: 'ethereum', trustScore: 82, riskLevel: 'Low' },
    { contract: CONTRACT },
  );
  assert.match(html, /82\/100/);
  assert.match(html, /Weth/);
  assert.match(html, new RegExp(`/token/${CONTRACT}`));
});
