// Applies pending SQL migrations in db/migrations, in filename order, exactly
// once each (tracked in the schema_migrations table). MANUAL ONLY — never wired
// into the build. Requires DATABASE_URL.
//
//   node scripts/db-migrate.mjs          # apply pending migrations
//   node scripts/db-migrate.mjs --status # list applied vs pending, apply nothing
//
// Idempotent and safe to re-run: each migration file uses IF NOT EXISTS, and an
// already-recorded version is skipped.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, closePool, dbConfigured } from '../netlify/functions/_db.mjs';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');

function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

// Postgres: "relation does not exist". The ONLY error that legitimately means
// "nothing has been applied yet".
const UNDEFINED_TABLE = '42P01';

async function appliedVersions() {
  // schema_migrations may not exist yet on a fresh DB; the first migration
  // creates it. A MISSING TABLE means "nothing applied".
  //
  // NOTHING ELSE DOES, AND THE CATCH USED TO SAY OTHERWISE.
  //
  // This swallowed every error and returned an empty set, so an unreachable
  // database — wrong credential, network failure, a masked value pasted from a
  // secret env var — reported as "· pending" for every migration. That is not a
  // degraded answer, it is a confident wrong one: an operator reads it as "this
  // database is empty" when the truth is "we could not ask".
  //
  // Found exactly that way. `netlify env:get` masks secret variables to their
  // last four characters, so running this against the injected value produced a
  // connection string that cannot connect — and --status cheerfully listed all
  // three migrations as pending against a production database that is not.
  //
  // Same rule the rest of this codebase enforces (the Watchtower coverage
  // ledger, the scan quota, the score floor, the funnel conversion rate):
  // absence is not a zero, and "we could not measure" is not "there is none".
  // Anything that is not a missing table is re-thrown and surfaces as a failure.
  try {
    const { rows } = await query('SELECT version FROM schema_migrations ORDER BY version');
    return new Set(rows.map((r) => r.version));
  } catch (error) {
    if (error?.code === UNDEFINED_TABLE) return new Set();
    throw new Error(
      `Could not read schema_migrations, so the applied/pending state is UNKNOWN — not empty. `
      + `Refusing to guess. Underlying error: ${error.message}`,
    );
  }
}

async function main() {
  if (!dbConfigured()) {
    console.error('DATABASE_URL is not set. Aborting (no changes made).');
    process.exit(1);
  }
  const statusOnly = process.argv.includes('--status');
  const files = migrationFiles();
  const applied = await appliedVersions();

  if (statusOnly) {
    for (const file of files) {
      console.log(`${applied.has(file) ? '✓ applied' : '· pending'}  ${file}`);
    }
    await closePool();
    return;
  }

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    console.log(`→ applying ${file} ...`);
    // Each file is idempotent DDL; run it, then record the version. If the DDL
    // half-applies and fails, re-running is safe because of IF NOT EXISTS.
    await query(sql);
    await query('INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING', [file]);
    ran += 1;
    console.log(`  ✓ ${file}`);
  }
  console.log(ran ? `Done — ${ran} migration(s) applied.` : 'Up to date — nothing to apply.');
  await closePool();
}

main().catch(async (error) => {
  console.error(`Migration failed: ${error.message}`);
  await closePool();
  process.exit(1);
});
