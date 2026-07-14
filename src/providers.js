// Provider abstraction for the live token scan (Phase 2, Section F/M).
//
// The scan fans out to ~9 third-party APIs in parallel. The orchestrator
// already isolates a *failing* provider (Promise.allSettled + null fallback),
// but a *hung* provider (a socket that never responds) has no timeout and can
// stall the whole scan indefinitely. This module makes every provider call:
//   - time-bounded  (withTimeout)  -> a hung provider degrades to null, fast
//   - non-throwing   (settleProvider) -> one bad provider never breaks the scan
//   - attributable   (source labels) -> results can say where data came from
// It changes NO scoring or data-merge logic; it only hardens how the raw
// provider values are obtained, so behaviour is identical except that a slow
// or dead provider now fails gracefully instead of hanging.

export const DEFAULT_PROVIDER_TIMEOUT_MS = 9000;

// Races a promise against a timeout. Rejects with a "provider timeout" error if
// the promise doesn't settle in time; always clears the timer so it never keeps
// the event loop (or a test runner) alive.
export function withTimeout(promise, ms = DEFAULT_PROVIDER_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('provider timeout')), ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

// Runs a provider fetcher so it can NEVER throw or hang the caller. Returns a
// uniform shape: { ok, value, source, error }. value is null on any failure or
// timeout, so downstream fallback chains treat a dead provider exactly like one
// that legitimately had no data.
export async function settleProvider(fetcher, { label = 'provider', timeoutMs = DEFAULT_PROVIDER_TIMEOUT_MS } = {}) {
  try {
    const value = await withTimeout(Promise.resolve().then(fetcher), timeoutMs);
    return { ok: value !== null && value !== undefined, value: value ?? null, source: label, error: null };
  } catch (error) {
    return { ok: false, value: null, source: label, error: error?.message || String(error) };
  }
}

// The "?? fallback chain" expressed as data: the first defined, non-null
// candidate wins. Keeps provider-priority logic testable and explicit.
export function firstValue(...candidates) {
  for (const candidate of candidates) {
    if (candidate !== null && candidate !== undefined) return candidate;
  }
  return null;
}

// Deduplicated list of the source labels that actually contributed, for
// attribution in the UI ("Data as of … · Sources: …").
export function collectSources(...labels) {
  return [...new Set(labels.flat().filter(Boolean))];
}
