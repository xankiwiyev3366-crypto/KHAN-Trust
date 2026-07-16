// Guards the Netlify Functions directory against files that are not functions.
//
// WHY THIS EXISTS
//
// `netlify/functions/` is a DEPLOY SURFACE, not an ordinary source folder.
// Netlify scans it for entry points and bundles what it finds through esbuild
// targeting CJS. Anything in there that is not a deployable function is a
// deploy risk, and the failure lands at deploy time — long after tests pass,
// the build goes green, and the change looks finished.
//
// This is not hypothetical. Colocating `*.test.mjs` next to the modules they
// test (the convention the rest of this repo follows in `src/`) broke
// production deploys with:
//
//   "Top-level await is currently not supported with the cjs output format"
//
// ...because a test used `await import(...)` at module scope for mock.module.
// Every local signal was green; only the deploy knew. Tests now live in
// `tests/`, and this check fails the BUILD so the same mistake surfaces in
// seconds rather than in a failed deploy.
//
// TWO CHECKS LIVE HERE
//
//   1. No non-function files in the directory (the filename rules below).
//   2. Every function actually BUNDLES to CJS (bundleCheck at the bottom).
//
// (2) was added when the functions gained their first import out of `src/`:
// _rescanEngine.mjs pulls in src/lib/trustScore.js so the server and the
// browser score tokens with one implementation instead of two. That is the
// right architecture — a second copy would drift, and drift between the scorer
// that writes a baseline and the scorer that writes the next snapshot is
// indistinguishable from a real risk change, i.e. false "your token got
// riskier" emails. But it means the deploy surface now depends on a file
// outside its own directory, so a change over in `src/` (a top-level await, a
// browser-only import, a bad path) can break the DEPLOY while every local
// signal stays green.
//
// The filename rules in (1) are only a proxy for that failure. Bundling is the
// actual test, so we do the actual test: esbuild, same settings Netlify uses,
// in memory. Costs a couple of seconds and turns a class of deploy-time
// breakage into a build-time error.
//
// Run via `npm run build` (and `npm run verify:functions`).
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';

const FUNCTIONS_DIR = join(process.cwd(), 'netlify', 'functions');

// Patterns that must never appear in the functions directory.
const FORBIDDEN = [
  {
    test: (name) => /\.test\.mjs$/.test(name),
    why: 'Test files are bundled as functions and break the deploy (top-level await → CJS). Put them in tests/ instead.',
  },
  {
    test: (name) => /\.spec\.mjs$/.test(name),
    why: 'Spec files are bundled as functions. Put them in tests/ instead.',
  },
  {
    test: (name) => name === '__mocks__' || name.startsWith('fixture'),
    why: 'Test fixtures are bundled as functions. Put them in tests/ instead.',
  },
];

let entries;
try {
  entries = readdirSync(FUNCTIONS_DIR);
} catch {
  console.log('· No netlify/functions directory — skipping function checks.');
  process.exit(0);
}

const failures = [];
for (const name of entries) {
  for (const rule of FORBIDDEN) {
    if (rule.test(name)) {
      failures.push(`  netlify/functions/${name}\n    ${rule.why}`);
    }
  }
}

if (failures.length) {
  console.error('\n✗ Non-function files found in the Netlify Functions directory:\n');
  console.error(`${failures.join('\n\n')}\n`);
  console.error('These would be bundled as Netlify Functions and can fail the deploy.\n');
  process.exit(1);
}

console.log(`✓ netlify/functions is clean — ${entries.length} deployable files, no test artefacts.`);

// ── Bundle check ──────────────────────────────────────────────────────────────

// Netlify treats every non-underscore file here as a function entry point;
// `_`-prefixed files are shared modules, reached only via import (and so
// covered transitively by whichever entry points import them).
const entryPoints = entries
  .filter((name) => name.endsWith('.mjs') && !name.startsWith('_'))
  .map((name) => join(FUNCTIONS_DIR, name));

try {
  await build({
    entryPoints,
    bundle: true,
    platform: 'node',
    // Matches Netlify's function runtime and, critically, the CJS output format
    // that top-level await is illegal in.
    target: 'node18',
    format: 'cjs',
    logLevel: 'silent',
    // In-memory: we only care whether it compiles, not about the artefact.
    // `outdir` is still required by esbuild for multi-entry builds even when
    // nothing is written — nothing is created on disk.
    write: false,
    outdir: join(FUNCTIONS_DIR, '.verify-tmp'),
  });
} catch (error) {
  console.error('\n✗ A Netlify Function does not bundle to CJS. This WILL fail the deploy:\n');
  for (const message of error.errors || []) {
    const where = message.location ? `${message.location.file}:${message.location.line}` : 'unknown location';
    console.error(`  ${where}\n    ${message.text}`);
  }
  if (!error.errors?.length) console.error(`  ${error.message}`);
  console.error('\nCommon causes: top-level await, a browser-only import reached from a function,');
  console.error('or a bad path in an import out of src/.\n');
  process.exit(1);
}

console.log(`✓ all ${entryPoints.length} functions bundle to CJS (incl. imports out of src/).`);
