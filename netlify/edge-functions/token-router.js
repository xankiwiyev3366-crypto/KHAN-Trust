// Edge router for the shared /token/<contract> pages (Deno runtime).
//
// Runs BEFORE netlify.toml redirects, so it is the single front door for the
// token surface. It inspects the User-Agent and rewrites — at the SAME URL, so
// the shared link and OG previews are preserved and there is never a redirect
// loop (both rewrite targets are OFF the /token/* path, so this function never
// re-triggers itself):
//   - Link-preview crawlers -> the token-page function's SEO/Open-Graph HTML.
//   - Human browsers         -> /index.html, the full React SPA, which reads the
//                               contract from the pathname and loads the report.
//
// All the decision logic lives in the pure, unit-tested _ua.mjs so this handler
// stays a thin adapter over the Netlify edge request/context API.
import { resolveTokenRoute } from './lib/ua.mjs';

export default async function tokenRouter(request, context) {
  const url = new URL(request.url);
  const decision = resolveTokenRoute({
    pathname: url.pathname,
    userAgent: request.headers.get('user-agent') || '',
  });

  if (decision.mode === 'passthrough') {
    return context.next();
  }
  // Same-origin internal rewrite: the visitor keeps seeing /token/<contract>.
  return context.rewrite(new URL(decision.target, url.origin));
}

export const config = { path: '/token/*' };
