// Per-invocation Netlify Blobs credentials.
//
// These functions use the Lambda-compatible `handler(event)` signature. In that
// mode Netlify does NOT put the Blobs context in the environment - it attaches a
// short-lived, site-scoped credential to every invocation as `event.blobs`, and
// the SDK only sees it once connectLambda(event) copies it into
// NETLIFY_BLOBS_CONTEXT. That missing call is why this site once concluded that
// "zero-config Blobs is not available" and fell back to a hand-made Personal
// Access Token (NETLIFY_BLOBS_TOKEN) - which expires or gets revoked, and then
// every blob read on the site fails with a 401 at once (2026-09 incident).
//
// Every handler calls this first. It is a no-op when there is no `event.blobs`
// (tests, local scripts, `netlify dev` without it), so the PAT path in
// _blobsClient.mjs remains the fallback there. It never throws: a malformed
// payload is logged (without its contents - it carries a token) and the request
// proceeds on the fallback path rather than dying before its own auth check.
//
// Kept separate from _blobsClient.mjs on purpose: tests mock that module by its
// exact export list, and this must keep working underneath those mocks.
import { connectLambda } from '@netlify/blobs';

export function connectBlobs(event) {
  if (!event || typeof event.blobs !== 'string' || !event.blobs) return false;
  try {
    connectLambda({ ...event, headers: event.headers || {} });
    return true;
  } catch (error) {
    console.error(`[blobs] could not read the invocation Blobs context: ${error.name}`);
    return false;
  }
}
