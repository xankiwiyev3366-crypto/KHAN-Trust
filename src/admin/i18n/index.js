// Console i18n — the pure part. English + Azerbaijani only.
//
// Self-contained inside src/admin/ rather than reusing src/i18n/. That module
// belongs to the user app, so putting console copy in it would ship strings like
// "Executive Brief" to every visitor — the exact leak scripts/verify-boundary.mjs
// exists to catch.
//
// No JSX here on purpose: this file is plain JS so Node can import it directly
// in tests/consoleI18n.test.mjs without a build step. The React provider lives
// next door in ConsoleI18nProvider.jsx.
//
// Deliberately tiny: two dictionaries and `{var}` interpolation. The console has
// one operator; a full i18n library would be more machinery than the problem
// deserves.
import en from './en.js';
import az from './az.js';

const DICTIONARIES = { en, az };

export const LANGUAGES = [
  { code: 'en', label: 'EN', name: 'English' },
  { code: 'az', label: 'AZ', name: 'Azərbaycanca' },
];

const STORAGE_KEY = 'khan-console-lang-v1';
export const DEFAULT_LANG = 'en';

export function readStoredLang() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return DICTIONARIES[stored] ? stored : DEFAULT_LANG;
  } catch {
    // Private mode / disabled storage. English is the documented default.
    return DEFAULT_LANG;
  }
}

export function persistLang(lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // The choice simply won't survive a refresh. Not worth failing over.
  }
}

export function isKnownLang(lang) {
  return Boolean(DICTIONARIES[lang]);
}

function lookup(dict, path) {
  return path.split('.').reduce((node, key) => (node == null ? undefined : node[key]), dict);
}

// Resolves a key, falling back to English and then to the key itself.
//
// The English fallback is load-bearing: a key present in en.js but missing from
// az.js must render readable English, never blank and never a raw key path. A
// half-translated console is usable; one with holes in it is not. (The dictionary
// test keeps the two in sync, so this should stay theoretical.)
export function translate(lang, path, vars) {
  const value = lookup(DICTIONARIES[lang] || DICTIONARIES[DEFAULT_LANG], path)
    ?? lookup(DICTIONARIES[DEFAULT_LANG], path);

  if (typeof value !== 'string') return path;
  if (!vars) return value;

  return value.replace(/\{(\w+)\}/g, (match, name) => (
    vars[name] === undefined || vars[name] === null ? match : String(vars[name])
  ));
}
