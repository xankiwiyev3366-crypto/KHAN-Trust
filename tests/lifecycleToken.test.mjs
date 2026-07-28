// The unsubscribe token is a capability that arrives with no session behind it,
// so it has exactly two jobs: be unforgeable, and reveal nothing.
process.env.LIFECYCLE_UNSUBSCRIBE_SECRET = 'test-secret-not-a-real-one';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  unsubscribeTokenFor,
  resubscribeTokenFor,
  verifyUnsubscribeToken,
  verifyLifecycleToken,
  isUnsubscribeConfigured,
} from '../netlify/functions/_lifecycleToken.mjs';
import {
  buildLifecycleEmail,
  listUnsubscribeHeaders,
  unsubscribeUrl,
  TEMPLATE_IDS,
} from '../netlify/functions/_lifecycleTemplates.mjs';

test('a token round-trips to the user it was issued for', () => {
  assert.equal(isUnsubscribeConfigured(), true);
  const token = unsubscribeTokenFor({ id: 'user-123' });
  assert.ok(token);
  assert.equal(verifyUnsubscribeToken(token), 'user-123');
});

test('tokens are deterministic, so an old email still unsubscribes', () => {
  assert.equal(unsubscribeTokenFor({ id: 'u' }), unsubscribeTokenFor({ id: 'u' }));
});

test('a forged or tampered token is refused', () => {
  const token = unsubscribeTokenFor({ id: 'user-123' });
  // Someone else's id with this token's tag.
  assert.equal(verifyUnsubscribeToken(token.replace('user-123', 'user-999')), '');
  // A flipped character in the tag.
  const flipped = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
  assert.equal(verifyUnsubscribeToken(flipped), '');
  // No tag at all — the id alone must never be enough.
  assert.equal(verifyUnsubscribeToken('user-123'), '');
  assert.equal(verifyUnsubscribeToken('user-123.'), '');
});

test('malformed input is refused without throwing', () => {
  for (const bad of ['', null, undefined, 42, {}, '.', '..', 'a.b.c']) {
    assert.doesNotThrow(() => verifyUnsubscribeToken(bad));
    assert.equal(verifyUnsubscribeToken(bad), '');
  }
});

test('an id with dots still round-trips (the tag is split off the LAST dot)', () => {
  const token = unsubscribeTokenFor({ id: 'a.b.c' });
  assert.equal(verifyUnsubscribeToken(token), 'a.b.c');
});

// ── Action scoping ───────────────────────────────────────────────────────────
//
// THE PROPERTY THAT MATTERS: the two capabilities cannot be substituted for one
// another. If they could, a link prefetcher that follows the unsubscribe URL
// could equally undo it, and whichever the scanner fetched last would decide
// the user's preference instead of the user.
test('an unsubscribe token is not a resubscribe token, and vice versa', () => {
  const unsub = unsubscribeTokenFor({ id: 'user-123' });
  const resub = resubscribeTokenFor({ id: 'user-123' });

  assert.ok(unsub && resub);
  assert.notEqual(unsub, resub, 'the same string must not authorise both actions');

  assert.equal(verifyLifecycleToken(unsub, 'unsubscribe'), 'user-123');
  assert.equal(verifyLifecycleToken(resub, 'resubscribe'), 'user-123');

  // Presented for the other action: refused.
  assert.equal(verifyLifecycleToken(unsub, 'resubscribe'), '');
  assert.equal(verifyLifecycleToken(resub, 'unsubscribe'), '');
});

test('resubscribe tokens are deterministic and unforgeable, like unsubscribe ones', () => {
  assert.equal(resubscribeTokenFor({ id: 'u' }), resubscribeTokenFor({ id: 'u' }));
  const token = resubscribeTokenFor({ id: 'user-123' });
  assert.equal(verifyLifecycleToken(token.replace('user-123', 'user-999'), 'resubscribe'), '');
  assert.equal(verifyLifecycleToken('user-123', 'resubscribe'), '');
});

test('an unknown action authorises nothing', () => {
  const token = unsubscribeTokenFor({ id: 'user-123' });
  for (const action of ['delete', '', null, 'UNSUBSCRIBE']) {
    assert.equal(verifyLifecycleToken(token, action), '', `action=${String(action)} must not verify`);
  }
  // Omitting it entirely is NOT unknown — it means unsubscribe, which is what
  // keeps every already-sent link working.
  assert.equal(verifyLifecycleToken(token), 'user-123');
});

// Backwards compatibility. Emails already delivered carry the original token,
// and their opt-out link must keep working forever — the recipient has no way
// to get a newer one.
test('the unsubscribe token format is unchanged, so links in old mail still work', () => {
  const token = unsubscribeTokenFor({ id: 'user-123' });
  assert.match(token, /^user-123\.[0-9a-f]{32}$/);
  assert.equal(verifyUnsubscribeToken(token), 'user-123', 'the default action is still unsubscribe');
});

// ── Templates ────────────────────────────────────────────────────────────────

const ctx = { name: 'Sam', email: 's@x.com', watchedCount: 3 };

test('every stage the engine can select has a template', () => {
  for (const id of ['welcome', 'day1', 'day3', 'day5', 'day7', 'premiumOffer', 'nothingChanged']) {
    assert.ok(TEMPLATE_IDS.includes(id), `${id} has no template`);
    const email = buildLifecycleEmail(id, ctx, 'tok');
    assert.ok(email?.subject, `${id}: no subject`);
    assert.ok(email?.html, `${id}: no body`);
  }
});

test('an unknown stage builds nothing rather than an empty email', () => {
  assert.equal(buildLifecycleEmail('nope', ctx, 'tok'), null);
});

// Non-negotiable: an unattended sender without a working opt-out is how a
// domain's reputation dies.
test('every template carries a working unsubscribe link', () => {
  for (const id of TEMPLATE_IDS) {
    const email = buildLifecycleEmail(id, ctx, 'my-token');
    assert.match(email.html, /\/unsubscribe\?token=my-token/, `${id} has no unsubscribe link`);
  }
});

test('the human-facing opt-out link uses the clean path, not the raw function URL', () => {
  const url = unsubscribeUrl('abc');
  assert.match(url, /\/unsubscribe\?token=abc$/);
  assert.doesNotMatch(url, /\.netlify\/functions/, 'a footer link should look like the product');
});

// RFC 8058. Gmail and Yahoo require these on bulk senders; without them the
// sequence loses the inbox on reputation with no bounce and no error.
test('lifecycle mail carries both one-click unsubscribe headers', () => {
  const headers = listUnsubscribeHeaders('tok-1');
  assert.match(headers['List-Unsubscribe'], /^<https?:\/\/.+>$/, 'must be a bracketed URI');
  assert.match(headers['List-Unsubscribe'], /token=tok-1/);
  assert.equal(headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click',
    'the -Post header is what promises the URL accepts an unattended POST');
});

// The header is machine-consumed and must not depend on redirect handling.
test('the one-click header points straight at the function, not the rewrite', () => {
  const headers = listUnsubscribeHeaders('tok-1');
  assert.match(headers['List-Unsubscribe'], /\.netlify\/functions\/lifecycle-unsubscribe/);
});

test('no token yields no headers rather than a broken one', () => {
  assert.deepEqual(listUnsubscribeHeaders(''), {});
  assert.deepEqual(listUnsubscribeHeaders(null), {});
});

test('templates state that risk alerts are unaffected by unsubscribing', () => {
  const email = buildLifecycleEmail('welcome', ctx, 'tok');
  assert.match(email.html, /alerts .* are separate|separate and are not affected/i);
});

test('user-supplied names are escaped into the body', () => {
  const email = buildLifecycleEmail('welcome', { ...ctx, name: '<script>alert(1)</script>' }, 'tok');
  assert.ok(!email.html.includes('<script>'), 'a name must never reach the body as markup');
  assert.match(email.html, /&lt;script&gt;/);
});

// Telegram is built but deliberately parked, so nothing writes a chat id and no
// user — free or paying — can actually receive a Telegram alert. Selling it in
// an unattended email is a claim that would keep re-sending itself forever.
test('no template promises a delivery channel that does not ship', () => {
  for (const id of TEMPLATE_IDS) {
    const email = buildLifecycleEmail(id, ctx, 'tok');
    assert.doesNotMatch(email.html, /telegram/i, `${id} names Telegram as a delivery channel`);
    assert.doesNotMatch(email.subject, /telegram/i, `${id} names Telegram in its subject`);
  }
});

test('no template invents a statistic — counts come from the user context', () => {
  const email = buildLifecycleEmail('premiumOffer', { ...ctx, watchedCount: 7 }, 'tok');
  assert.match(email.html, /7 tokens/);
  const one = buildLifecycleEmail('premiumOffer', { ...ctx, watchedCount: 1 }, 'tok');
  assert.match(one.html, /1 token\b/, 'singular is handled rather than reading "1 tokens"');
});
