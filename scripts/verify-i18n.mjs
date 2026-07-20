// Guards against a translation dictionary silently falling behind English.
//
// WHY THIS EXISTS
//
// translate() (src/i18n/index.js) falls back to English for any key a language
// is missing, then to the key itself. That fallback is the right runtime
// behaviour — a missing translation must never blank out the UI — but it means
// an untranslated page looks *fine* in development and ships as English text
// sitting inside an Azerbaijani page. There is no error, no warning, and no
// visible symptom unless you happen to switch languages and read the page.
//
// That is exactly how the Pricing comparison table shipped English-only: every
// label went through t(), the code looked correct, and the keys existed in
// en.js alone.
//
// So this makes the gap loud. Run via `npm run verify:i18n` (and as part of
// `npm run build`).
//
// ── Scope ────────────────────────────────────────────────────────────────────
//
// This checks for STRUCTURAL parity: every key English has, each language has.
// It cannot tell you whether the Azerbaijani string is actually Azerbaijani —
// a copy-pasted English value passes. Deliberate: a heuristic for "is this
// really translated" would be wrong often enough to be ignored, and the honest
// signal (key present / key absent) is the one that catches the real failure.
import en from '../src/i18n/en.js';
import az from '../src/i18n/az.js';
import tr from '../src/i18n/tr.js';
import ru from '../src/i18n/ru.js';

// Leaf paths only. An array value (feature lists, FAQ pairs) is a LEAF, not a
// branch: translations replace the whole array, and recursing into indices
// would report "missing pricing.faq.3.1" noise whenever a language legitimately
// carries a different number of entries.
function leafPaths(node, prefix = '') {
  return Object.entries(node).flatMap(([key, value]) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? leafPaths(value, `${prefix}${key}.`)
      : [`${prefix}${key}`]
  );
}

// ── No exemptions ────────────────────────────────────────────────────────────
//
// The admin console used to be exempted here on the grounds that it is
// internal tooling behind a shared passcode. That exemption is gone: the admin
// dashboard is now fully translated too, so EVERY key in en.js must exist in
// every language, with nothing carved out.
//
// If a namespace ever genuinely needs to stay English-only, add it back as an
// explicit list rather than deleting keys from this check — an undocumented
// gap is indistinguishable from an oversight.
const enPaths = leafPaths(en);
const languages = [['az', az], ['tr', tr], ['ru', ru]];

let failed = false;

for (const [code, dictionary] of languages) {
  const present = new Set(leafPaths(dictionary));
  const missing = enPaths.filter((path) => !present.has(path));

  if (missing.length === 0) {
    console.log(`✓ ${code}: complete (${enPaths.length} keys)`);
    continue;
  }

  failed = true;
  console.error(`\n✗ ${code}: ${missing.length} key(s) missing — these render as ENGLISH inside a ${code.toUpperCase()} page:\n`);
  for (const path of missing) console.error(`    ${path}`);
}

if (failed) {
  console.error('\nAdd the missing keys to the language file(s) above.');
  console.error('Every key in en.js must exist in az.js, tr.js and ru.js.\n');
  process.exit(1);
}

console.log(`✓ i18n parity — all ${languages.length} languages carry every one of English's ${enPaths.length} keys.`);
