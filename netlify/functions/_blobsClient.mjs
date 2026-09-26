// Shared Netlify Blobs connection helper.
//
// CREDENTIALS, in order of preference:
//   1. The per-invocation context Netlify attaches to every request, copied into
//      the environment by connectBlobs(event) (_blobsConnect.mjs) at the top of
//      each handler. Site-scoped, minted by Netlify, never expires on us. This is
//      what production uses.
//   2. SITE_ID + NETLIFY_BLOBS_TOKEN (a Personal Access Token). Only for code that
//      runs outside a Netlify invocation - local scripts such as
//      scripts/db-backfill.mjs. It used to be production's only path; when that
//      token expired every blob read on the site returned 401 at once.
//   3. Plain getStore(name), for `netlify dev` / anything that sets the
//      environment itself.
// All three address the same site-wide store by name, so switching between them
// reads and writes exactly the same data.
import { getStore } from '@netlify/blobs';

const SITE_ID = process.env.SITE_ID || process.env.NETLIFY_SITE_ID;
const BLOBS_TOKEN = process.env.NETLIFY_BLOBS_TOKEN;

function invocationContext() {
  const raw = process.env.NETLIFY_BLOBS_CONTEXT;
  return typeof raw === 'string' && raw ? raw : null;
}

// Store handles are reused within a warm function instance, but keyed by the
// credential they were built with: the invocation context carries a short-lived
// token that changes between requests, and a handle holding last request's token
// would 401 on this one.
const handles = new Map();

const IS_DEPLOYED = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) || (Boolean(process.env.CONTEXT) && process.env.CONTEXT !== 'dev');
let warnedPatFallback = false;

// Every failed blob operation logs which store, which operation, which
// credential path and the HTTP status - enough to tell "token rejected" from
// "store missing" from "network" in the function log. Never the token itself.
function withDiagnostics(store, name, authMode) {
  return new Proxy(store, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      return (...args) => {
        const result = value.apply(target, args);
        if (!result || typeof result.then !== 'function') return result;
        return result.then(undefined, (error) => {
          const status = /\((\d{3}) status code\)/.exec(error?.message || '')?.[1] || 'n/a';
          const hint = status === '401' || status === '403'
            ? (authMode === 'pat'
              ? ' - NETLIFY_BLOBS_TOKEN was rejected (expired or revoked); in production the per-invocation context should be in use instead: is connectBlobs(event) called at the top of this handler?'
              : ' - the invocation Blobs credential was rejected')
            : '';
          console.error(`[blobs] store="${name}" op=${String(prop)} auth=${authMode} status=${status}: ${error?.message}${hint}`);
          throw error;
        });
      };
    },
  });
}

export function getNamedStore(name) {
  const context = invocationContext();
  const authMode = context ? 'invocation' : (SITE_ID && BLOBS_TOKEN ? 'pat' : 'environment');
  const key = `${name}\u0000${authMode}\u0000${context || ''}`;
  const cached = handles.get(key);
  if (cached) return cached;
  if (authMode === 'pat' && IS_DEPLOYED && !warnedPatFallback) {
    // Never silent: in production this path means a handler reached Blobs
    // without connectBlobs(event), or an invocation arrived without
    // `event.blobs` - and the PAT behind it is the credential that already
    // expired once and took every blob read down with it.
    warnedPatFallback = true;
    console.warn(`[blobs] store="${name}" is using the NETLIFY_BLOBS_TOKEN fallback in a deployed function (${process.env.AWS_LAMBDA_FUNCTION_NAME || 'unknown'}); the per-request Blobs context was not present.`);
  }
  try {
    const store = authMode === 'pat'
      ? getStore({ name, siteID: SITE_ID, token: BLOBS_TOKEN })
      : getStore(name);
    const wrapped = withDiagnostics(store, name, authMode);
    // Superseded invocation handles for this name are dead weight; drop them so
    // a long-lived instance does not accumulate one handle per request served.
    for (const existing of handles.keys()) {
      if (existing.startsWith(`${name}\u0000`)) handles.delete(existing);
    }
    handles.set(key, wrapped);
    return wrapped;
  } catch (error) {
    console.error(`[blobs] getStore("${name}") failed auth=${authMode}: ${error.message}`);
    throw new Error(`Netlify Blobs getStore("${name}") failed: ${error.message}`);
  }
}

export function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
