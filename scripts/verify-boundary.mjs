// Asserts the console/user privacy boundary against the REAL build output.
//
// The requirement this protects: a visitor must never be able to learn that the
// Growth OS exists. The console is a separate Vite entry, but "separate entry"
// is only a convention until something enforces it - one stray
// `import ... from './admin/...'` in the user app silently hoists console code
// into a shared chunk and ships the operator's private strategy to every
// browser. That regression is invisible in code review and invisible in the UI.
//
// Two independent checks, because each catches what the other misses:
//
//   1. SOURCE   - walk the user app's import graph from src/main.jsx and fail
//                 if anything in it reaches src/admin/. Catches the mistake at
//                 its cause, with a useful file path.
//   2. ARTIFACT - walk the built chunk graph from the `main` entry and fail if
//                 any reachable chunk contains a console sentinel string.
//                 Catches leaks the source walk can't see (dynamic imports,
//                 re-exports, bundler chunking changes).
//
// Run via `npm run verify:boundary` (and as part of `npm run build`).
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');
const USER_ENTRY = join(ROOT, 'src', 'main.jsx');
const ADMIN_DIR = join(ROOT, 'src', 'admin');

// Strings that must only ever exist in console chunks. Chosen to be specific
// enough that they cannot plausibly appear in user-facing code by coincidence.
const CONSOLE_SENTINELS = [
  'Growth OS',
  'console-nav-link',
  'Executive Brief',
  'Content Engine',
  'confidence-insufficient',
];

const failures = [];

// ── Check 1: source import graph ──────────────────────────────────────────────

// Resolve a relative import specifier to a real file, trying the extensions
// Vite would. Bare specifiers (react, lucide-react) are skipped - only local
// files can reach src/admin/.
function resolveImport(specifier, fromFile) {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.js`, `${base}.jsx`, `${base}.mjs`, `${base}.ts`, `${base}.tsx`,
    join(base, 'index.js'), join(base, 'index.jsx'),
  ];
  return candidates.find((candidate) => existsSync(candidate) && !candidate.endsWith('/')) || null;
}

const IMPORT_RE = /(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]/g;

function walkSource(entry) {
  const seen = new Set();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);

    // Only JS-ish files have imports worth following; .css is a leaf.
    if (!/\.(jsx?|mjs|tsx?)$/.test(file)) continue;

    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(IMPORT_RE)) {
      const specifier = match[1] || match[2] || match[3];
      if (!specifier) continue;
      const resolved = resolveImport(specifier, file);
      if (!resolved) continue;
      if (resolved.startsWith(ADMIN_DIR)) {
        failures.push(
          `SOURCE LEAK: ${relative(ROOT, file)} imports "${specifier}" from src/admin/.\n` +
          `  The user app must never reach console code. Move the shared piece to src/shared/,\n` +
          `  or duplicate it - do NOT import across the boundary.`
        );
      }
      stack.push(resolved);
    }
  }
  return seen;
}

walkSource(USER_ENTRY);

// ── Check 2: built chunk graph ────────────────────────────────────────────────

const manifestPath = join(DIST, '.vite', 'manifest.json');

if (!existsSync(manifestPath)) {
  // Only meaningful after a build. Skip rather than fail so the source check
  // stays usable on its own (e.g. in a pre-commit hook with no dist/).
  console.log('· No dist/.vite/manifest.json — skipping built-artifact check (run `npm run build` first).');
} else {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  const userEntryKey = Object.keys(manifest).find(
    (key) => manifest[key].isEntry && key.endsWith('index.html')
  );

  if (!userEntryKey) {
    failures.push('ARTIFACT: could not find the index.html entry in the build manifest.');
  } else {
    // Transitively collect every chunk the user bundle can load.
    const reachable = new Set();
    const stack = [userEntryKey];
    while (stack.length) {
      const key = stack.pop();
      const chunk = manifest[key];
      if (!chunk || reachable.has(key)) continue;
      reachable.add(key);
      for (const next of [...(chunk.imports || []), ...(chunk.dynamicImports || [])]) {
        stack.push(next);
      }
    }

    for (const key of reachable) {
      const chunk = manifest[key];
      if (!chunk.file || !chunk.file.endsWith('.js')) continue;
      const filePath = join(DIST, chunk.file);
      if (!existsSync(filePath)) continue;
      const contents = readFileSync(filePath, 'utf8');
      for (const sentinel of CONSOLE_SENTINELS) {
        if (contents.includes(sentinel)) {
          failures.push(
            `ARTIFACT LEAK: console string ${JSON.stringify(sentinel)} found in ${chunk.file},\n` +
            `  which IS reachable from the user's index.html entry. The console is shipping to visitors.`
          );
        }
      }
    }
    console.log(`· Checked ${reachable.size} chunks reachable from the user entry.`);
  }
}

// ── Result ────────────────────────────────────────────────────────────────────

if (failures.length) {
  console.error('\n✗ Console/user boundary VIOLATED:\n');
  for (const failure of failures) console.error(`${failure}\n`);
  process.exit(1);
}

console.log('✓ Console/user boundary intact — no admin code reachable from the user bundle.');
