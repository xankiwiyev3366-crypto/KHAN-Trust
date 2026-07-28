// Growth OS instrumentation for the lifecycle mailer.
//
// The mailer is the platform's only outbound retention channel and it ran
// completely unobserved: it sent, and nothing recorded that it had. These tests
// pin the three properties that make the resulting numbers worth trusting —
// the events cannot be forged from a browser, they do not pollute acquisition
// attribution, and recording one can never break the thing being recorded.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

const written = [];
let failNext = false;

mock.module('../netlify/functions/_growthEvents.mjs', {
  namedExports: {
    putEvent: async (event) => {
      if (failNext) throw new Error('blob store unavailable');
      written.push(event);
    },
  },
});

const {
  recordLifecycleEmailSent,
  recordLifecycleUnsubscribed,
  recordLifecycleResubscribed,
} = await import('../netlify/functions/_growthRecord.mjs');

const {
  EVENT_TYPES,
  SERVER_EVENT_TYPES,
  CLIENT_EVENT_TYPES,
  CHANNELS,
} = await import('../netlify/functions/_growthSchema.mjs');

function reset() {
  written.length = 0;
  failNext = false;
}

test('a send is recorded with the stage that was sent', async () => {
  reset();
  await recordLifecycleEmailSent({ userId: 'u1', stage: 'day3' });
  assert.equal(written.length, 1);
  assert.equal(written[0].type, EVENT_TYPES.LIFECYCLE_EMAIL_SENT);
  assert.equal(written[0].userId, 'u1');
  assert.equal(written[0].stage, 'day3',
    'without the stage this is a send count, which cannot tell you which stage loses people');
});

test('opting out and back in are recorded as their own events', async () => {
  reset();
  await recordLifecycleUnsubscribed({ userId: 'u1', stage: 'day1' });
  await recordLifecycleResubscribed({ userId: 'u1' });
  assert.deepEqual(
    written.map((e) => e.type),
    [EVENT_TYPES.LIFECYCLE_UNSUBSCRIBED, EVENT_TYPES.LIFECYCLE_RESUBSCRIBED],
  );
});

// A nightly cron has no visit behind it. Left on buildEvent's `direct` default
// it would add a row of "direct traffic" for every message sent, inflating the
// channel that is already the dumping ground for unknowns.
test('lifecycle events are attributed to INTERNAL, never to direct traffic', async () => {
  reset();
  await recordLifecycleEmailSent({ userId: 'u1', stage: 'welcome' });
  await recordLifecycleUnsubscribed({ userId: 'u1' });
  await recordLifecycleResubscribed({ userId: 'u1' });
  for (const event of written) {
    assert.equal(event.channel, CHANNELS.INTERNAL, `${event.type} leaked into a real channel`);
    assert.equal(event.firstTouchChannel, CHANNELS.INTERNAL);
    assert.notEqual(event.channel, CHANNELS.DIRECT);
  }
});

// The browser must not be able to claim the platform sent mail it never sent,
// nor to suppress the unsubscribe count that measures the sequence's cost.
test('lifecycle events are server-only and unreachable from public ingestion', () => {
  for (const type of [
    EVENT_TYPES.LIFECYCLE_EMAIL_SENT,
    EVENT_TYPES.LIFECYCLE_UNSUBSCRIBED,
    EVENT_TYPES.LIFECYCLE_RESUBSCRIBED,
  ]) {
    assert.ok(SERVER_EVENT_TYPES.has(type), `${type} is not marked server-only`);
    assert.ok(!CLIENT_EVENT_TYPES.has(type), `${type} would be forgeable from a browser`);
  }
});

// FAIL-SOFT BY CONTRACT. Losing an analytics row is strictly better than
// failing the send that produced it — or, worse, throwing after the provider
// accepted the mail and before the write-once record was kept.
test('a store failure is swallowed rather than propagated to the caller', async () => {
  reset();
  failNext = true;
  await assert.doesNotReject(() => recordLifecycleEmailSent({ userId: 'u1', stage: 'day7' }));
  await assert.doesNotReject(() => recordLifecycleUnsubscribed({ userId: 'u1' }));
  await assert.doesNotReject(() => recordLifecycleResubscribed({ userId: 'u1' }));
});

test('missing arguments do not throw or write a malformed event', async () => {
  reset();
  await assert.doesNotReject(() => recordLifecycleEmailSent());
  assert.equal(written.length, 1);
  assert.equal(written[0].userId, null, 'absent, not an empty string');
  assert.equal(written[0].stage, null);
});
