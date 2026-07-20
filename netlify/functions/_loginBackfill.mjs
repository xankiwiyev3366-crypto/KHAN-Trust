// One-time migration for accounts created BEFORE login tracking existed.
//
// ── WHAT CANNOT BE RECOVERED, AND WHY ────────────────────────────────────────
//
// There is no login history to restore. The platform never stored one. The
// only record that a login had happened was a `user_login` event in the
// analytics log, and that log is CAPPED AT 20 000 EVENTS with oldest-first
// eviction (_analyticsStore.mjs). Every login older than the current window
// has been permanently overwritten. It is not archived, not in a backup table,
// not reconstructible from anything — the bytes are gone.
//
// So this migration cannot answer "did this user ever log in?" for every
// account. What it can do is find POSITIVE EVIDENCE that an account must have
// authenticated at some point, and mark those. Absence of evidence is left as
// `hasLoggedIn: false`.
//
// ── WHY THAT ASYMMETRY IS THE RIGHT WAY ROUND ────────────────────────────────
//
// Every rule below only ever moves an account from "never logged in" to
// "logged in", and only on evidence that could not exist otherwise. It never
// moves an account the other way, and never guesses.
//
// The alternative — assuming legacy accounts probably logged in, since most
// people who register do — would manufacture data. "Probably" is not a
// measurement. It would also be unfalsifiable: nobody could ever tell the
// invented logins from the real ones, and every future retention number would
// be built on top of them.
//
// The residual error is therefore ONE-DIRECTIONAL and known: some accounts
// that really did log in long ago will still read as "never logged in", until
// they next open the site. That is a conservative undercount of Logged In
// Users, and it is stated on the dashboard rather than hidden.
//
// ── IT SELF-HEALS ────────────────────────────────────────────────────────────
//
// The residual error drains on its own. Any legacy user who still has a valid
// session hits auth-me on their next visit, which sets hasLoggedIn (a validly
// signed, unexpired JWT proves they authenticated). Anyone else is corrected
// the moment they sign in again. No further migration is needed — this runs
// once and the system converges.
//
// ── WHAT IS DELIBERATELY *NOT* EVIDENCE ──────────────────────────────────────
//
//   emailVerified   Clicking a link in an email is not authenticating. The
//                   verify flow issues a token TODAY (see auth-verify-email),
//                   but historically a user could verify and never sign in.
//                   Using it would inflate the count with the exact population
//                   we most need to measure: people who signed up and bounced.
//   createdAt       Registration is not a login. It is the opposite: the
//                   "Never Logged In" metric exists precisely to count people
//                   who registered and never came back.
//   passwordHash    Present on every account from the moment of registration.
import { getNamedStore } from './_blobsClient.mjs';
import { readEvents } from './_analyticsStore.mjs';
import { readAllUserData } from './_userDataStore.mjs';
import { readWalletLinks } from './_walletLinkStore.mjs';
import { readGrants } from './_premiumStore.mjs';

const STORE_NAME = 'khan-trust-auth';
// Marker so the migration is idempotent — re-running it must not re-derive
// anything or overwrite state that live logins have since corrected.
const MIGRATION_KEY = 'migration:login-backfill-v1';

function store() {
  return getNamedStore(STORE_NAME);
}

export async function backfillStatus() {
  try {
    return await store().get(MIGRATION_KEY, { type: 'json' });
  } catch {
    return null;
  }
}

// Collects every user id for which some surviving artefact PROVES the account
// was authenticated at least once. Each source is independent; a user needs
// only one.
//
// Returns Map(userId -> { at: ISO|null, evidence: string }) where `at` is the
// earliest defensible timestamp, used to seed firstLoginAt. A null `at` means
// "we know it happened, we do not know when" — recorded honestly as null
// rather than back-dated to a made-up time.
export async function gatherLoginEvidence() {
  const evidence = new Map();

  const note = (userId, at, source) => {
    if (!userId) return;
    const existing = evidence.get(userId);
    if (!existing) {
      evidence.set(userId, { at: at || null, evidence: source });
      return;
    }
    // Keep the EARLIEST known timestamp — firstLoginAt must be a floor.
    if (at && (!existing.at || at < existing.at)) {
      existing.at = at;
      existing.evidence = source;
    }
  };

  // 1. Surviving `user_login` events. The strongest evidence: an explicit,
  //    server-written record of a password login. Only covers the tail of
  //    history that has not been evicted.
  // 2. ANY event carrying a userId. platformAnalytics.js only attaches a
  //    userId once the user is signed in, so a scan/view/search stamped with
  //    an account id could not have been produced by an anonymous visitor.
  try {
    const events = await readEvents();
    for (const evt of events) {
      if (!evt?.userId) continue;
      // user_registered is stamped with a userId at signup and is NOT proof of
      // a login — excluded explicitly, or every account would qualify.
      if (evt.type === 'user_registered') continue;
      note(evt.userId, evt.timestamp, evt.type === 'user_login' ? 'login_event' : 'attributed_event');
    }
  } catch {
    // A missing/unreadable event log costs evidence, never correctness.
  }

  // 3. Account-scoped saved data (watchlist / saved reports) under "u:<id>".
  //    user-data-save.mjs only writes that key for a caller whose JWT it
  //    verified, so the data cannot exist without a successful authentication.
  try {
    const allUserData = await readAllUserData();
    for (const key of Object.keys(allUserData || {})) {
      if (!key.startsWith('u:')) continue;
      const record = allUserData[key];
      const hasContent = Array.isArray(record?.watchlist) ? record.watchlist.length > 0
        : Boolean(record && Object.keys(record).length);
      if (hasContent) note(key.slice(2), record?.updatedAt || null, 'account_data');
    }
  } catch {
    // ignore
  }

  // 4. Observed wallet link. recordWalletLink is only ever called from a
  //    signed-in client session (see src/walletLink.js), so a link keyed by
  //    user id means that account was authenticated at the time.
  try {
    const links = await readWalletLinks();
    for (const [userId, link] of Object.entries(links || {})) {
      note(userId, link?.linkedAt || link?.updatedAt || null, 'wallet_link');
    }
  } catch {
    // ignore
  }

  // 5. An ACCOUNT-keyed premium grant. Admin-granted premium is keyed by user
  //    id and does not require the user to log in, so a grant alone is not
  //    proof — only grants whose source records the user acting are counted.
  //    Kept narrow deliberately: a giveaway to a dormant account must not be
  //    reported as that account having signed in.
  try {
    const grants = await readGrants();
    for (const [userId, grant] of Object.entries(grants || {})) {
      if (grant?.source === 'payment') note(userId, grant?.grantedAt || null, 'paid_account');
    }
  } catch {
    // ignore
  }

  return evidence;
}

// Applies the evidence to user records. Idempotent: skips accounts that
// already carry login state, so a re-run can never clobber a real login that
// happened after the first pass.
//
// `dryRun` returns exactly what WOULD change without writing, so the migration
// can be inspected against production before it touches anything.
export async function runLoginBackfill({ dryRun = false, force = false } = {}) {
  const already = await backfillStatus();
  if (already && !force && !dryRun) {
    return { skipped: true, reason: 'already_run', ranAt: already.ranAt, ...already.summary };
  }

  const evidence = await gatherLoginEvidence();

  const result = await store().list({ prefix: 'user:email:' });
  const blobs = result.blobs || [];
  const users = await Promise.all(
    blobs.map((b) => store().get(b.key, { type: 'json' }).catch(() => null))
  );
  const records = users.filter(Boolean);

  let marked = 0;
  let untouched = 0;
  let alreadyTracked = 0;
  const byEvidence = {};

  for (const user of records) {
    // Already has durable state (a real login since tracking shipped, or a
    // previous backfill run). Never overwrite it.
    if (user.hasLoggedIn === true) { alreadyTracked += 1; continue; }

    const proof = evidence.get(user.id);
    if (!proof) { untouched += 1; continue; }

    byEvidence[proof.evidence] = (byEvidence[proof.evidence] || 0) + 1;
    marked += 1;

    if (!dryRun) {
      const updated = {
        ...user,
        hasLoggedIn: true,
        firstLoginAt: user.firstLoginAt || proof.at || null,
        lastLoginAt: user.lastLoginAt || proof.at || null,
        lastActiveAt: user.lastActiveAt || proof.at || null,
        // Flags the value as DERIVED, not observed. Anyone reading this record
        // later can tell a reconstructed login from a recorded one, which
        // matters because the timestamp may be null or approximate.
        loginStateSource: 'backfill-v1',
      };
      await store().setJSON(`user:email:${user.email.toLowerCase()}`, updated);
    }
  }

  const summary = {
    totalUsers: records.length,
    alreadyTracked,
    markedFromEvidence: marked,
    noEvidence: untouched,
    byEvidence,
  };

  if (!dryRun) {
    await store().setJSON(MIGRATION_KEY, { ranAt: new Date().toISOString(), summary });
  }

  return { skipped: false, dryRun, ...summary };
}
