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
// Run via `npm run build` (and `npm run verify:functions`).
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

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
