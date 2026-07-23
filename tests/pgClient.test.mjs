// Phase 1 dual-write — the real _db.mjs client's non-negotiable safety
// behaviour: Postgres must NEVER break a request. No mocking here; these drive
// the actual client with a missing and a broken DATABASE_URL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mirror, dbConfigured, closePool } from '../netlify/functions/_db.mjs';

test('mirror is a silent no-op when DATABASE_URL is unset', async () => {
  const prev = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    assert.equal(dbConfigured(), false);
    const res = await mirror('INSERT INTO nope VALUES (1)', []);
    assert.equal(res.ok, false);
    assert.equal(res.skipped, true);
    assert.equal(res.reason, 'no_database_url');
  } finally {
    if (prev === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prev;
    await closePool();
  }
});

test('mirror swallows a connection failure and never throws or hangs', async () => {
  const prev = process.env.DATABASE_URL;
  // Nothing listens on this port → fast ECONNREFUSED, well inside the guard.
  process.env.DATABASE_URL = 'postgresql://user:pass@127.0.0.1:59321/none';
  try {
    const res = await mirror('INSERT INTO nope VALUES (1)', []);
    assert.equal(res.ok, false);
    assert.notEqual(res.skipped, true);              // it attempted, then failed
    assert.equal(typeof res.error, 'string');        // failure captured, not thrown
  } finally {
    await closePool();
    if (prev === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prev;
  }
});

test('dbConfigured reflects the environment live', () => {
  const prev = process.env.DATABASE_URL;
  try {
    process.env.DATABASE_URL = 'postgresql://x';
    assert.equal(dbConfigured(), true);
    delete process.env.DATABASE_URL;
    assert.equal(dbConfigured(), false);
  } finally {
    if (prev === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prev;
  }
});
