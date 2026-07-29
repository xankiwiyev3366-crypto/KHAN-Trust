// Keeps the two migration directories byte-identical.
//
// ── WHY THERE ARE TWO ───────────────────────────────────────────────────────
//
// db/migrations/            the source of truth. Applied by
//                           scripts/db-migrate.mjs, which is MANUAL and
//                           deliberately not wired into the build.
// netlify/database/migrations/
//                           the same files, applied AUTOMATICALLY by Netlify
//                           immediately before a deploy is published.
//
// The second directory exists because Netlify Managed Database never exposes a
// production connection string to a developer's machine — its environment
// variable is masked to its last four characters and there is no reveal. So the
// only supported way to run DDL against production is to hand the SQL to the
// deploy, which runs inside Netlify's own runtime where the real credential
// lives.
//
// ── WHY THIS CHECK EXISTS ───────────────────────────────────────────────────
//
// Two copies of the same file, in two places, maintained by hand, is the single
// most reliable way to produce two DIFFERENT schemas — and the divergence would
// be invisible until production and local disagreed about a column. This is the
// same failure this codebase has already been bitten by and already guards
// against elsewhere: the half-implemented route aliases (src/lib/routes.js), the
// badge state shared by three transports (_badgeState.mjs), the i18n
// dictionaries (scripts/verify-i18n.mjs). Two halves that must agree, sharing no
// code, cannot be made to agree by care alone.
//
// So the build fails on any drift. To change a migration, edit the file in
// db/migrations/ and re-run `npm run sync:migrations`.
//
// ── ORDERING ────────────────────────────────────────────────────────────────
//
// Netlify sorts migrations LEXICOGRAPHICALLY and applies them in that order, so
// the zero-padded `0001_`, `0002_`, `0003_` prefixes this project already uses
// are exactly right and must stay padded — `10_x` would sort before `2_x`.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = join(process.cwd(), 'db', 'migrations');
const MIRROR = join(process.cwd(), 'netlify', 'database', 'migrations');

// Netlify's rule: <number>_<slug>, slug being lowercase letters, digits,
// hyphens and underscores. Enforced here so a badly-named file is caught at
// build time rather than being silently skipped by the deploy-time runner.
const NAME_PATTERN = /^\d+_[a-z0-9_-]+\.sql$/;

function sqlFiles(dir) {
  try {
    return readdirSync(dir).filter((name) => name.endsWith('.sql')).sort();
  } catch {
    return null;
  }
}

const source = sqlFiles(SOURCE);
if (!source) {
  console.error(`\n✗ No db/migrations directory found at ${SOURCE}.\n`);
  process.exit(1);
}

const mirror = sqlFiles(MIRROR);
if (!mirror) {
  console.error('\n✗ netlify/database/migrations is missing.\n');
  console.error('  Netlify applies migrations from that directory on deploy. Without it,');
  console.error('  nothing reaches the production database.\n');
  console.error('  Fix: npm run sync:migrations\n');
  process.exit(1);
}

const problems = [];

for (const name of source) {
  if (!NAME_PATTERN.test(name)) {
    problems.push(`  ${name}\n    Not a valid Netlify migration name. Expected <number>_<slug>.sql\n    with a zero-padded number and a lowercase slug.`);
  }
}

const missing = source.filter((name) => !mirror.includes(name));
for (const name of missing) {
  problems.push(`  ${name}\n    Present in db/migrations but NOT in netlify/database/migrations,\n    so it would never be applied to production.`);
}

const extra = mirror.filter((name) => !source.includes(name));
for (const name of extra) {
  problems.push(`  ${name}\n    Present in netlify/database/migrations but NOT in db/migrations.\n    Production would run a migration that is not in the source of truth.`);
}

for (const name of source.filter((n) => mirror.includes(n))) {
  const a = readFileSync(join(SOURCE, name), 'utf8');
  const b = readFileSync(join(MIRROR, name), 'utf8');
  // Newline-normalised: this repo is checked out with CRLF on Windows and the
  // difference is not a schema difference.
  if (a.replace(/\r\n/g, '\n') !== b.replace(/\r\n/g, '\n')) {
    problems.push(`  ${name}\n    The two copies have DIFFERENT contents. Local and production would\n    end up with different schemas.`);
  }
}

if (problems.length) {
  console.error('\n✗ Migration directories are out of sync:\n');
  console.error(`${problems.join('\n\n')}\n`);
  console.error('db/migrations is the source of truth. Fix with:\n');
  console.error('  npm run sync:migrations\n');
  process.exit(1);
}

console.log(`✓ migrations in sync — ${source.length} file(s) identical in db/migrations and netlify/database/migrations.`);
