// Tests for the Growth Data Plane's classification logic.
//
// The channel taxonomy is duplicated across the browser (src/growth.js) and the
// Lambda runtime (netlify/functions/_growthSchema.mjs) because they share no
// module system. Duplication that drifts is worse than no duplication at all -
// a mismatch would misfile traffic silently and no one would notice until a
// channel's numbers looked "a bit off" months later. These tests pin the two
// implementations to the same answers.
import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyChannel } from './growth.js';
import { resolveChannel, channelFromUtmSource, channelFromReferrer, CHANNELS } from '../netlify/functions/_growthSchema.mjs';

// The cases that matter most: the two channels the operator actually markets on
// were BOTH unclassifiable before this system existed.
const CASES = [
  // [utmSource, referrerHost, expectedChannel]
  ['youtube', null, 'youtube'],
  ['yt', null, 'youtube'],
  ['YouTube', null, 'youtube'],
  ['youtube-shorts', null, 'youtube'],
  ['tiktok', null, 'tiktok'],
  ['tt', null, 'tiktok'],
  ['tik-tok', null, 'tiktok'],
  [null, 'www.youtube.com', 'youtube'],
  [null, 'youtu.be', 'youtube'],
  [null, 'm.youtube.com', 'youtube'],
  [null, 'www.tiktok.com', 'tiktok'],
  [null, 'vm.tiktok.com', 'tiktok'],
  [null, 'www.google.com', 'google'],
  [null, 'google.co.uk', 'google'],
  [null, 'x.com', 'x'],
  [null, 't.co', 'x'],
  [null, 't.me', 'telegram'],
  [null, 'www.reddit.com', 'reddit'],
  [null, 'someblog.dev', 'referral'],
  [null, null, 'direct'],
];

test('client and server classify every channel identically', () => {
  for (const [utmSource, referrerHost, expected] of CASES) {
    const client = classifyChannel({ utmSource, referrerHost });
    const server = resolveChannel({ utmSource, referrerHost });
    assert.equal(client, expected, `client misclassified utm=${utmSource} ref=${referrerHost}`);
    assert.equal(server, expected, `server misclassified utm=${utmSource} ref=${referrerHost}`);
  }
});

test('UTM beats referrer', () => {
  // TikTok and YouTube in-app taps routinely arrive with a missing or wrong
  // referrer. If the referrer won, the operator's own tagged campaign traffic
  // would be misfiled - the exact failure that makes social channels look
  // worthless. The operator's own tag is the more reliable signal.
  assert.equal(classifyChannel({ utmSource: 'youtube', referrerHost: 'l.facebook.com' }), 'youtube');
  assert.equal(resolveChannel({ utmSource: 'youtube', referrerHost: 'l.facebook.com' }), 'youtube');
  assert.equal(classifyChannel({ utmSource: 'tiktok', referrerHost: null }), 'tiktok');
  assert.equal(resolveChannel({ utmSource: 'tiktok', referrerHost: null }), 'tiktok');
});

test('an unknown referrer is "referral", never "direct"', () => {
  // Collapsing unknown referrers into "direct" would overstate direct traffic
  // and hide real referral sources worth pursuing. They are different facts.
  assert.equal(channelFromReferrer('news.ycombinator.com'), CHANNELS.REFERRAL);
  assert.equal(channelFromReferrer(null), null);
  assert.equal(resolveChannel({ utmSource: null, referrerHost: null }), CHANNELS.DIRECT);
});

test('the platform\'s own pages are "internal", not an acquisition source', () => {
  assert.equal(channelFromReferrer('khantrust.net'), CHANNELS.INTERNAL);
  assert.equal(channelFromReferrer('www.khantrust.net'), CHANNELS.INTERNAL);
});

test('an unrecognised utm_source falls through to the referrer', () => {
  assert.equal(channelFromUtmSource('some-newsletter'), null);
  assert.equal(resolveChannel({ utmSource: 'some-newsletter', referrerHost: 'youtube.com' }), 'youtube');
  // ...and with no referrer either, it is direct rather than a crash.
  assert.equal(resolveChannel({ utmSource: 'some-newsletter', referrerHost: null }), CHANNELS.DIRECT);
});
