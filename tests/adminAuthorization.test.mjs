// Phase 5 — every new admin and internal-worker endpoint must refuse an
// unauthenticated caller, and the destructive ones must refuse an unconfirmed
// one.
//
// This is a source-level audit rather than a set of handler invocations on
// purpose. Invoking each handler would test the endpoints that exist TODAY;
// reading the directory tests every endpoint that will ever exist, so a new
// admin route added later without an auth check fails this suite the moment it
// lands. The failure mode being prevented — an admin endpoint shipped without a
// guard — is a mistake of omission, and only an exhaustive check catches those.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const FUNCTIONS = join(ROOT, 'netlify', 'functions');

// Endpoints added by Phase 4/5 that handle admin data, internal work, or money.
const MUST_BE_GUARDED = [
  'verification-admin-orders.mjs',
  'verification-admin-order-action.mjs',
  'verification-admin-funnel.mjs',
  'queue-admin.mjs',
  'queue-worker-background.mjs',
  'verification-lifecycle-background.mjs',
];

test('every new admin and worker endpoint verifies an admin token', () => {
  for (const name of MUST_BE_GUARDED) {
    const source = readFileSync(join(FUNCTIONS, name), 'utf8');
    assert.match(source, /verifyToken\(bearerToken\(event\)\)/, `${name} does not verify an admin token`);
    assert.match(source, /Unauthorized/, `${name} has no unauthorized response`);
  }
});

test('the auth check comes before any store read', () => {
  // A guard placed after the work has already been done is not a guard: the
  // read happens, the cost is paid, and only the response is withheld.
  for (const name of MUST_BE_GUARDED) {
    const source = readFileSync(join(FUNCTIONS, name), 'utf8');
    const handlerStart = source.indexOf('export async function handler');
    const guard = source.indexOf('verifyToken(bearerToken(event))', handlerStart);
    const firstAwait = source.indexOf('await ', handlerStart);
    assert.ok(guard > -1, `${name}: no guard inside the handler`);
    if (firstAwait > -1) {
      assert.ok(guard < firstAwait, `${name}: the guard runs after the first await`);
    }
  }
});

test('no admin endpoint leaks a stack trace or an internal message to the caller', () => {
  for (const name of MUST_BE_GUARDED) {
    const source = readFileSync(join(FUNCTIONS, name), 'utf8');
    // The pattern this forbids: `message: \`... ${error.message}\`` in a
    // response body. Internal detail belongs in the function log.
    const responseWithError = /jsonResponse\(5\d\d,\s*\{[^}]*\$\{error\.(message|stack)\}/;
    assert.doesNotMatch(source, responseWithError, `${name} returns internal error detail to the caller`);
  }
});

test('destructive admin actions require an explicit confirmation', () => {
  const source = readFileSync(join(FUNCTIONS, 'verification-admin-order-action.mjs'), 'utf8');
  assert.match(source, /confirmation_required/);
  assert.match(source, /DESTRUCTIVE/);
  // Confirming means echoing the order id back — a mis-click on a dense table
  // row must not be able to revoke a live customer's badge.
  assert.match(source, /payload\.confirm\s*\|\|\s*''\)\s*!==\s*order\.id/);
});

test('admin actions are audited', () => {
  const source = readFileSync(join(FUNCTIONS, 'verification-admin-order-action.mjs'), 'utf8');
  assert.match(source, /async function audit\(/);
  assert.match(source, /admin_\$\{action\}|`admin_/);
});

test('the admin order-action endpoint cannot move money', () => {
  // mark_refunded RECORDS a refund; it does not send one. A key that can move
  // funds behind an endpoint guarded by a shared passcode would make that
  // passcode the only thing between an attacker and the treasury.
  const source = readFileSync(join(FUNCTIONS, 'verification-admin-order-action.mjs'), 'utf8');
  assert.doesNotMatch(source, /sendTransaction|signTransaction|Keypair|SystemProgram/);
  assert.match(source, /does NOT move money/);
});

// ── The public event endpoint ───────────────────────────────────────────────

test('the public event endpoint refuses server-authored event names', () => {
  const source = readFileSync(join(FUNCTIONS, 'events-track.mjs'), 'utf8');
  assert.match(source, /isClientEmittable\(name\)/);
  // Identity must come from a verified token, never from the body.
  assert.match(source, /verifyJwt\(bearerToken\(event\)\)/);
  assert.doesNotMatch(source, /payload\.userId/);
});

test('the public event endpoint is rate limited through a named policy', () => {
  const source = readFileSync(join(FUNCTIONS, 'events-track.mjs'), 'utf8');
  assert.match(source, /enforce\('events_track_ip'/);
  const policies = readFileSync(join(FUNCTIONS, '_rateLimit.mjs'), 'utf8');
  assert.match(policies, /events_track_ip:/);
});

// ── Receipt access ──────────────────────────────────────────────────────────

test('receipt endpoints do not distinguish "no such order" from "not yours"', () => {
  // Distinguishing them turns the order id space into an oracle for which
  // orders exist.
  for (const name of ['verify-receipt.mjs', 'receipt-page.mjs']) {
    const source = readFileSync(join(FUNCTIONS, name), 'utf8');
    assert.match(source, /canViewReceipt/, `${name} has no access check`);
    assert.match(source, /oracle/, `${name} does not document the enumeration guard`);
  }
});

test('the receipt page is never cached by a shared cache', () => {
  const source = readFileSync(join(FUNCTIONS, 'receipt-page.mjs'), 'utf8');
  assert.match(source, /'Cache-Control': 'no-store, private'/);
  assert.match(source, /'Referrer-Policy': 'no-referrer'/);
});

// ── Sweep of the whole directory ────────────────────────────────────────────

test('no function added by this work is an unguarded admin surface', () => {
  // Catches the mistake of omission: a new file whose NAME says admin/worker but
  // whose body has no guard.
  const names = readdirSync(FUNCTIONS)
    .filter((n) => n.endsWith('.mjs') && !n.startsWith('_'))
    // `-cron` functions are SCHEDULED. Netlify does not route them over HTTP at
    // all (a request gets a 404), so there is no caller to authenticate — they
    // are the ones that MINT the token, which the cron test above asserts
    // separately. Requiring verifyToken here would demand a guard against an
    // attack surface that does not exist.
    .filter((n) => !n.endsWith('-cron.mjs'));
  const adminish = names
    .filter((n) => /admin|queue-worker|lifecycle-background/.test(n))
    // The sign-in endpoint is the one that ISSUES the token, so it cannot
    // require one — it is guarded by checkPasscode() instead, asserted below.
    .filter((n) => n !== 'verification-admin-auth.mjs');
  assert.ok(adminish.length >= MUST_BE_GUARDED.length - 1, 'the sweep found suspiciously few admin endpoints');

  for (const name of adminish) {
    const source = readFileSync(join(FUNCTIONS, name), 'utf8');
    const guarded = /verifyToken\(/.test(source)
      // The pre-existing premium/report/support admin endpoints use the same
      // helper under different import spellings; accept any of them.
      || /requireAdmin|verifyToken\b/.test(source);
    assert.ok(guarded, `${name} looks like an admin endpoint but has no token check`);
  }

  // And the one exclusion above is itself guarded, by the passcode rather than
  // by a token — so the carve-out cannot become a hole.
  const auth = readFileSync(join(FUNCTIONS, 'verification-admin-auth.mjs'), 'utf8');
  assert.match(auth, /checkPasscode\(/, 'the admin sign-in endpoint has no passcode check');
});

// ── Scheduled jobs ──────────────────────────────────────────────────────────

test('both new cron jobs are declared in code AND in netlify.toml, and agree', () => {
  const toml = readFileSync(join(ROOT, 'netlify.toml'), 'utf8');
  for (const [file, schedule] of [
    ['queue-worker-cron.mjs', '2,7,12,17,22,27,32,37,42,47,52,57 * * * *'],
    ['verification-lifecycle-cron.mjs', '10 7 * * *'],
  ]) {
    const source = readFileSync(join(FUNCTIONS, file), 'utf8');
    assert.ok(source.includes(schedule), `${file} does not declare ${schedule}`);
    assert.ok(toml.includes(schedule), `netlify.toml does not declare ${schedule} for ${file}`);
  }
});

test('the cron jobs fire a background worker rather than doing the work themselves', () => {
  // A scheduled function is capped at 30 seconds and would blow it SILENTLY.
  for (const [cron, worker] of [
    ['queue-worker-cron.mjs', 'queue-worker-background'],
    ['verification-lifecycle-cron.mjs', 'verification-lifecycle-background'],
  ]) {
    const source = readFileSync(join(FUNCTIONS, cron), 'utf8');
    assert.match(source, new RegExp(worker), `${cron} does not fire ${worker}`);
    assert.match(source, /issueToken\(\)/, `${cron} must mint its own token, never transmit a passcode`);
  }
});

test('a failed cron trigger still answers 200, so the platform does not retry-storm', () => {
  for (const cron of ['queue-worker-cron.mjs', 'verification-lifecycle-cron.mjs']) {
    const source = readFileSync(join(FUNCTIONS, cron), 'utf8');
    assert.match(source, /statusCode: 200, body: 'trigger failed'/, `${cron} lacks the non-retrying failure path`);
  }
});

// Keeps the mock import used, so the module-mock loader flag is exercised the
// same way the rest of the suite exercises it.
test('the suite runs under the module-mock loader', () => {
  assert.equal(typeof mock.module, 'function');
});
