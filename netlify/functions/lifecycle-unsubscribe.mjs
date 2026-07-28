// GET /.netlify/functions/lifecycle-unsubscribe?token=...
//
// One click, no login, no confirmation step. That is deliberate: an unsubscribe
// that demands a sign-in is an unsubscribe that gets replaced by the spam
// button, and the spam button costs the sending domain far more than the
// subscriber does.
//
// GET is correct here despite being state-changing. Mail clients and link
// scanners cannot issue a POST, and RFC 8058 one-click unsubscribe exists for
// exactly this. The token is a single-purpose HMAC capability (see
// _lifecycleToken.mjs), so a prefetching scanner unsubscribing someone is the
// only real risk — and that is a far better failure than the alternative.
//
// It only ever sets `emailOptOut`. It never deletes the account, and it never
// touches the risk alerts a user explicitly asked for by watching a token:
// those are the thing they came for, and silently cancelling them here would be
// a worse betrayal than any marketing email.
import { getUserById, updateUser } from './_authStore.mjs';
import { verifyUnsubscribeToken, isUnsubscribeConfigured } from './_lifecycleToken.mjs';

function page(title, message) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    body: `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} - KHAN Trust</title></head>
<body style="font-family:sans-serif;background:#050505;color:#f3f3f3;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0">
  <div style="max-width:420px;padding:32px;text-align:center">
    <h1 style="color:#c9a227;font-size:1.4rem">KHAN Trust</h1>
    <p style="line-height:1.6">${message}</p>
    <p><a href="/" style="color:#c9a227">Return to KHAN Trust</a></p>
  </div>
</body></html>`,
  };
}

export async function handler(event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  if (!isUnsubscribeConfigured()) {
    return page('Unavailable', 'Email preferences cannot be changed right now. Please contact support and we will remove you manually.');
  }

  const token = event.queryStringParameters?.token || '';
  const userId = verifyUnsubscribeToken(token);
  if (!userId) {
    return page('Link not valid', 'This unsubscribe link is not valid. If you keep receiving emails you did not ask for, reply to any of them and we will remove you.');
  }

  try {
    const user = await getUserById(userId);
    // Already opted out, or the account is gone: report success either way.
    // The user asked for one outcome — no more email — and they have it. An
    // error page here would only prompt them to reach for the spam button.
    if (!user) return page('Unsubscribed', 'You will not receive further KHAN Trust update emails.');
    if (!user.emailOptOut) await updateUser(userId, { emailOptOut: true });
  } catch {
    return page('Something went wrong', 'We could not update your preferences just now. Please reply to any KHAN Trust email and we will remove you manually.');
  }

  return page(
    'Unsubscribed',
    'You will not receive further KHAN Trust update emails.<br /><br />'
    + 'Risk alerts for tokens you chose to watch are separate and are still active — '
    + 'you can turn those off per token from your watchlist.'
  );
}
