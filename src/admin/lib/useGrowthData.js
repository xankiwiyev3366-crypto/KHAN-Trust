// Shared data loading for console pages.
//
// Deliberately not a global store: each page reads exactly what it needs, and
// the console has one operator, so there is no cross-page state worth the
// complexity of a store.
import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from './adminSession.js';

// One loader for every page, so loading/error/empty are handled identically
// everywhere instead of each page inventing its own.
export function useAdminResource(path, token, { auto = true } = {}) {
  const [data, setData] = useState(null);
  const [state, setState] = useState({ status: auto ? 'loading' : 'idle', message: '' });

  const load = useCallback(async () => {
    setState({ status: 'loading', message: '' });
    try {
      setData(await adminFetch(path, { token }));
      setState({ status: 'ready', message: '' });
    } catch (error) {
      // An expired session is handled by the shell (adminSession clears the
      // token and the shell polls for it), so this only needs to surface real
      // failures.
      setState({ status: 'error', message: error.message || 'Load failed.' });
    }
  }, [path, token]);

  useEffect(() => {
    if (auto) load();
  }, [auto, load]);

  return { data, state, reload: load };
}

export function useWarehouse(token, days = 30) {
  return useAdminResource(`growth-metrics?days=${days}`, token);
}

// Percent formatting that never lies about precision.
//
// A null rate means "not measured", which must never render as "0%" — that
// reads as a catastrophic result rather than an absent one, and the distinction
// is the whole point of the Confidence Engine.
export function formatRate(value) {
  if (value === null || value === undefined) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

export function formatUsd(value) {
  if (value === null || value === undefined) return '—';
  return `$${value.toFixed(2)}`;
}

// `lang` is passed in rather than read from the i18n context so this stays a
// plain function usable outside a component. Falls back to the browser's own
// locale if a caller forgets, which is wrong-but-readable rather than a crash.
export function formatDate(iso, lang) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(lang || undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
