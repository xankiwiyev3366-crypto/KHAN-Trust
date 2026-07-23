// localStorage helpers, extracted verbatim from src/main.jsx.
//
// Thin, self-contained persistence utilities for the per-browser Explore /
// project cache. No React, no app state. `readStorage`/`writeStorage` are the
// generic JSON accessors; the project variants add the legacy "demo" purge.
export const PROJECTS_KEY = 'khan-trust-projects-v1';

export function readStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function writeStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// Legacy purge: earlier builds could persist fabricated ("demo") reports to
// localStorage when live APIs failed. That behaviour is gone — but we still
// strip any such records on read/write so no user ever sees a stale fabricated
// Trust Score. Live data unavailable now returns an honest error instead.
export function readProjectStorage() {
  return readStorage(PROJECTS_KEY, []).filter((project) => !project?.realData?.isDemo);
}

export function writeProjectStorage(projects) {
  writeStorage(PROJECTS_KEY, projects.filter((project) => !project?.realData?.isDemo));
}

export function looksLikeSolanaAddress(value) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,48}$/.test(value.trim());
}
