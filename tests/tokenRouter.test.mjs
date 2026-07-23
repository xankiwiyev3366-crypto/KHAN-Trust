// Regression tests for the /token/<contract> edge routing decision.
//
// The production bug these lock in: routing every /token/:contract browser
// request straight to the SEO HTML function rendered raw, unstyled HTML to
// humans. The edge function now negotiates by User-Agent — humans get the React
// SPA at the same URL, crawlers get the OG/SEO HTML. These cover both audiences
// plus the in-app-browser edge cases that must NOT be misread as crawlers.
import test from 'node:test';
import assert from 'node:assert/strict';

import { isCrawler, tokenContractFromPath, resolveTokenRoute } from '../netlify/edge-functions/lib/ua.mjs';

const CONTRACT = '0xaea46a60368a7bd060eec7df8cba43b7ef41ad85';

// Real crawler / link-preview User-Agents.
const CRAWLERS = {
  WhatsApp: 'WhatsApp/2.23.20.0',
  Telegram: 'TelegramBot (like TwitterBot)',
  Facebook: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  Twitter: 'Twitterbot/1.0',
  LinkedIn: 'LinkedInBot/1.0 (compatible; Mozilla/5.0; +http://www.linkedin.com)',
  Discord: 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
  Slack: 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
  Google: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  Bing: 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
};

// Real human browser User-Agents, including in-app webviews that must resolve
// to a HUMAN (the SPA), not the crawler branch.
const HUMANS = {
  'Desktop Chrome': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mobile Safari': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
  Firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
  Edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  'Facebook in-app (human)': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/440.0.0]',
  'Instagram in-app (human)': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 302.0',
};

for (const [name, ua] of Object.entries(CRAWLERS)) {
  test(`${name} preview bot is classified as a crawler`, () => {
    assert.equal(isCrawler(ua), true);
  });
}

for (const [name, ua] of Object.entries(HUMANS)) {
  test(`${name} is classified as a human browser`, () => {
    assert.equal(isCrawler(ua), false);
  });
}

test('tokenContractFromPath extracts a single-segment contract, ignores non-token paths', () => {
  assert.equal(tokenContractFromPath(`/token/${CONTRACT}`), CONTRACT);
  assert.equal(tokenContractFromPath(`/token/${CONTRACT}/`), CONTRACT);
  assert.equal(tokenContractFromPath('/'), '');
  assert.equal(tokenContractFromPath('/console'), '');
  assert.equal(tokenContractFromPath('/token/'), '');
  assert.equal(tokenContractFromPath('/token/a/b'), '');
});

test('resolveTokenRoute serves the SPA to human browsers at the same URL', () => {
  const decision = resolveTokenRoute({ pathname: `/token/${CONTRACT}`, userAgent: HUMANS['Desktop Chrome'] });
  assert.equal(decision.mode, 'spa');
  assert.equal(decision.target, '/index.html');
  assert.equal(decision.contract, CONTRACT);
});

test('resolveTokenRoute serves SEO/OG HTML to crawlers, passing the contract as a query param', () => {
  const decision = resolveTokenRoute({ pathname: `/token/${CONTRACT}`, userAgent: CRAWLERS.WhatsApp });
  assert.equal(decision.mode, 'seo');
  assert.equal(decision.target, `/.netlify/functions/token-page?contract=${CONTRACT}`);
  assert.equal(decision.contract, CONTRACT);
});

test('resolveTokenRoute passes through non-token paths untouched', () => {
  assert.deepEqual(resolveTokenRoute({ pathname: '/', userAgent: CRAWLERS.Google }), { mode: 'passthrough' });
  assert.deepEqual(resolveTokenRoute({ pathname: '/console', userAgent: HUMANS.Firefox }), { mode: 'passthrough' });
});

test('an empty User-Agent is treated as a human (never starves the SPA)', () => {
  assert.equal(isCrawler(''), false);
  assert.equal(isCrawler(undefined), false);
  assert.equal(resolveTokenRoute({ pathname: `/token/${CONTRACT}`, userAgent: '' }).mode, 'spa');
});
