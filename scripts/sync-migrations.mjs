// Copies db/migrations → netlify/database/migrations.
//
// db/migrations is the source of truth; the Netlify directory is a mirror that
// exists only because Netlify applies migrations from it at deploy time (see the
// header of scripts/verify-migrations.mjs for why production cannot be migrated
// any other way).
//
// COPIES ONLY, NEVER DELETES. A file that exists in the mirror but not in the
// source is reported and left alone rather than removed: Netlify's own docs are
// explicit that an already-applied migration "cannot be edited or deleted", so
// silently deleting one here would produce a deploy-time failure that is very
// hard to trace back to this script. verify-migrations.mjs fails the build on
// that case so a human decides what to do.
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = join(process.cwd(), 'db', 'migrations');
const MIRROR = join(process.cwd(), 'netlify', 'database', 'migrations');

mkdirSync(MIRROR, { recursive: true });

const source = readdirSync(SOURCE).filter((name) => name.endsWith('.sql')).sort();
const mirror = new Set(readdirSync(MIRROR).filter((name) => name.endsWith('.sql')));

let written = 0;
for (const name of source) {
  const from = readFileSync(join(SOURCE, name), 'utf8');
  const target = join(MIRROR, name);
  const existing = mirror.has(name) ? readFileSync(target, 'utf8') : null;
  if (existing !== null && existing.replace(/\r\n/g, '\n') === from.replace(/\r\n/g, '\n')) continue;
  writeFileSync(target, from);
  console.log(`${existing === null ? '+ added  ' : '~ updated'} ${name}`);
  written += 1;
}

const orphans = [...mirror].filter((name) => !source.includes(name));
for (const name of orphans) {
  console.warn(`! orphan  ${name} — in the mirror but not in db/migrations. Left in place; remove it by hand if it was never applied.`);
}

console.log(written ? `Done — ${written} file(s) synced.` : 'Up to date — nothing to sync.');
