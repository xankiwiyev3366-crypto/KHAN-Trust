// Email preferences for lifecycle mail, driven entirely by a capability token.
//
//   GET  ?token=<unsub>                    → opt out, show a page
//   POST ?token=<unsub>                    → opt out, no body (RFC 8058)
//   POST ?token=<resub>&action=resubscribe → opt back in, show a page
//
// One click, no login, no confirmation step. That is deliberate: an unsubscribe
// that demands a sign-in is an unsubscribe that gets replaced by the spam
// button, and the spam button costs the sending domain far more than the
// subscriber does.
//
// WHY GET UNSUBSCRIBES DESPITE BEING STATE-CHANGING
//
// Mail clients and link scanners cannot issue a POST from a footer link, so the
// visible opt-out has to work as a GET. The token is a single-purpose HMAC
// capability, so the real cost is a prefetching scanner opting someone out
// without them clicking — which is why the reverse action now exists.
//
// WHY RESUBSCRIBE IS POST-ONLY
//
// The same prefetcher that can trip a GET unsubscribe would, if the result page
// offered a resubscribe LINK, immediately follow that too and undo it. The two
// actions would cancel out and the user's real choice would be decided by
// whichever URL the scanner fetched last. So the way back is a form button:
// scanners do not POST. It is also why the two tokens are separate capabilities
// (see _lifecycleToken.mjs) rather than one token with an action parameter.
//
// It only ever sets `emailOptOut`. It never deletes the account, and it never
// touches the risk alerts a user explicitly asked for by watching a token:
// those are the thing they came for, and silently cancelling them here would be
// a worse betrayal than any marketing email.
import { getUserById, updateUser } from './_authStore.mjs';
import { verifyLifecycleToken, resubscribeTokenFor, isUnsubscribeConfigured } from './_lifecycleToken.mjs';
import { recordLifecycleUnsubscribed, recordLifecycleResubscribed } from './_growthRecord.mjs';

function page(title, message, extraHtml = '') {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    body: `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>${title} - KHAN Trust</title></head>
<body style="font-family:sans-serif;background:#050505;color:#f3f3f3;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0">
  <div style="max-width:420px;padding:32px;text-align:center">
    <h1 style="color:#c9a227;font-size:1.4rem">KHAN Trust</h1>
    <p style="line-height:1.6">${message}</p>
    ${extraHtml}
    <p><a href="/" style="color:#c9a227">Return to KHAN Trust</a></p>
  </div>
</body></html>`,
  };
}

// The undo, rendered as a form so only a deliberate click can submit it.
function resubscribeForm(user) {
  const token = resubscribeTokenFor(user);
  if (!token) return '';
  return `<form method="POST" action="/.netlify/functions/lifecycle-unsubscribe?token=${encodeURIComponent(token)}&action=resubscribe" style="margin:24px 0">
      <button type="submit" style="background:none;border:1px solid #444;color:#c9a227;padding:10px 18px;border-radius:6px;cursor:pointer;font-size:14px">
        Undo — I did not mean to unsubscribe
      </button>
    </form>`;
}

// RFC 8058 expects a plain 200 for the one-click POST. The mail client is not
// rendering anything, so there is nothing to say.
const ACK = { statusCode: 200, headers: { 'Cache-Control': 'no-store' }, body: '' };

export async function handler(event) {
  const method = event.httpMethod;
  if (method !== 'GET' && method !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  if (!isUnsubscribeConfigured()) {
    return page('Unavailable', 'Email preferences cannot be changed right now. Please contact support and we will remove you manually.');
  }

  const token = event.queryStringParameters?.token || '';
  const wantsResubscribe = event.queryStringParameters?.action === 'resubscribe';

  // A resubscribe may only ever arrive as a POST — see the header comment.
  if (wantsResubscribe && method !== 'POST') {
    return page('Link not valid', 'This link cannot be opened directly. Please use the button on the unsubscribe confirmation page.');
  }

  const action = wantsResubscribe ? 'resubscribe' : 'unsubscribe';
  const userId = verifyLifecycleToken(token, action);
  if (!userId) {
    // A one-click POST gets a bare acknowledgement: there is no human reading,
    // and telling an automated caller that a token was rejected achieves
    // nothing except confirming which tokens are valid.
    if (method === 'POST' && !wantsResubscribe) return ACK;
    return page('Link not valid', 'This link is not valid. If you keep receiving emails you did not ask for, reply to any of them and we will remove you.');
  }

  let user;
  try {
    user = await getUserById(userId);
    if (user) {
      const optOut = action === 'unsubscribe';
      // Only write when it actually changes, so a re-clicked link or a second
      // scanner fetch is not a write.
      if (Boolean(user.emailOptOut) !== optOut) {
        await updateUser(userId, { emailOptOut: optOut });
        if (optOut) await recordLifecycleUnsubscribed({ userId });
        else await recordLifecycleResubscribed({ userId });
      }
    }
  } catch {
    if (method === 'POST' && !wantsResubscribe) return ACK;
    return page('Something went wrong', 'We could not update your preferences just now. Please reply to any KHAN Trust email and we will remove you manually.');
  }

  if (method === 'POST' && !wantsResubscribe) return ACK;

  if (action === 'resubscribe') {
    return page('Subscribed again', 'You will receive KHAN Trust update emails again. You can unsubscribe from any of them at any time.');
  }

  // Already opted out, or the account is gone: report success either way. The
  // user asked for one outcome — no more email — and they have it. An error
  // page here would only prompt them to reach for the spam button.
  return page(
    'Unsubscribed',
    'You will not receive further KHAN Trust update emails.<br /><br />'
    + 'Risk alerts for tokens you chose to watch are separate and are still active — '
    + 'you can turn those off per token from your watchlist.',
    user ? resubscribeForm(user) : '',
  );
}
