import en from './en.js';
import az from './az.js';
import tr from './tr.js';
import ru from './ru.js';

export const LANGUAGE_STORAGE_KEY = 'khan-trust-language-v1';
export const DEFAULT_LANGUAGE = 'en';

// Adding a new language only requires: 1) a new dictionary file mirroring
// en.js, 2) one entry here, 3) one entry in SUPPORTED_LANGUAGES below.
const dictionaries = { en, az, tr, ru };

export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'az', label: 'Azərbaycanca', short: 'AZ' },
  { code: 'tr', label: 'Türkçe', short: 'TR' },
  { code: 'ru', label: 'Русский', short: 'RU' },
];

function getByPath(dictionary, path) {
  return path.split('.').reduce((node, key) => (node && node[key] !== undefined ? node[key] : undefined), dictionary);
}

function interpolate(template, params) {
  if (typeof template !== 'string' || !params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name) => (params[name] !== undefined ? params[name] : match));
}

// Module-level mirror so plain (non-component) functions - the scoring engine,
// PDF export, share text - can translate without needing `t` threaded through
// every call site. The React context below stays the single source of truth
// for re-rendering; this mirror is updated synchronously whenever it changes.
let currentLanguage = readStoredLanguage();
const listeners = new Set();

function readStoredLanguage() {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return stored && dictionaries[stored] ? stored : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

export function getLanguage() {
  return currentLanguage;
}

export function setLanguage(language) {
  if (!dictionaries[language] || language === currentLanguage) return;
  currentLanguage = language;
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // ignore storage failures (private mode, quota, etc.)
  }
  listeners.forEach((listener) => listener(language));
}

export function subscribeLanguage(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Plain translate function usable anywhere, including outside React (scoring
// helpers, PDF export). Falls back to English, then to the key itself, so a
// missing translation never breaks the UI.
export function translate(key, params, language = currentLanguage) {
  const value = getByPath(dictionaries[language], key) ?? getByPath(dictionaries[DEFAULT_LANGUAGE], key);
  if (value === undefined) return key;
  if (Array.isArray(value)) return value;
  return interpolate(value, params);
}

export { dictionaries };
