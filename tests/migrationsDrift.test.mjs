// The serverless ops runner (db-admin) executes SQL embedded in
// netlify/functions/_migrations.mjs, because Netlify Functions bundle JS, not
// loose .sql files. db/migrations/*.sql stays the canonical human-readable
// copy. This test guarantees the two can never drift.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PHASE1_INIT_SQL, MIGRATIONS } from '../netlify/functions/_migrations.mjs';

const here = dirname(fileURLToPath(import.meta.url));

test('embedded PHASE1_INIT_SQL is byte-identical to the canonical .sql file', () => {
  const file = readFileSync(join(here, '..', 'db', 'migrations', '0001_phase1_init.sql'), 'utf8');
  assert.equal(PHASE1_INIT_SQL, file);
});

test('MIGRATIONS is ordered, versioned, and points at the embedded SQL', () => {
  assert.equal(MIGRATIONS.length, 1);
  assert.equal(MIGRATIONS[0].version, '0001_phase1_init.sql');
  assert.equal(MIGRATIONS[0].sql, PHASE1_INIT_SQL);
});
