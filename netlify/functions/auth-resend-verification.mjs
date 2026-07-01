// POST /.netlify/functions/auth-resend-verification
// Re-sends the account verification email for the CALLER's own account only -
// the target email always comes from the verified JWT (payload.sub), never
// from the request body, so this can't be used to spam an arbitrary address.
// Rate-limited server-side via lastVerificationEmailSentAt on the user record
// so the "duplicate request" guard holds even across tabs/devices or a client
// that ignores its own cooldown timer.
import { verifyJwt, getUserById, updateUser, createVerifyToken, bearerToken, jsonResponse } from './_authStore.mjs';
import { sendVerificationEmail } from './_email.mjs';

const RESEND_COOLDOWN_MS = 60 * 1000;

export async function handler(event) {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { message: 'Method not allowed' });

  const payload = verifyJwt(bearerToken(event));
  if (!payload) return jsonResponse(401, { message: 'Unauthorized' });

  const user = await getUserById(payload.sub);
  if (!user) return jsonResponse(404, { message: 'User not found' });

  if (user.emailVerified) {
    return jsonResponse(400, { message: 'This email is already verified.' });
  }

  const lastSentAt = user.lastVerificationEmailSentAt ? new Date(user.lastVerificationEmailSentAt).getTime() : 0;
  const waitMs = RESEND_COOLDOWN_MS - (Date.now() - lastSentAt);
  if (waitMs > 0) {
    return jsonResponse(429, {
      message: `Please wait ${Math.ceil(waitMs / 1000)}s before requesting another verification email.`,
      retryAfterMs: waitMs,
    });
  }

  const verifyToken = await createVerifyToken(user.email);
  const result = await sendVerificationEmail(user.email, user.name, verifyToken);

  await updateUser(user.id, { lastVerificationEmailSentAt: new Date().toISOString() });

  if (!result.ok) {
    console.error('[auth-resend-verification] delivery failed', {
      userId: user.id,
      reason: result.reason,
      status: result.status,
      detail: result.detail,
    });
    // Only a genuinely missing API key is "not configured" - anything else
    // (Resend rejected the send, network error) is a real delivery failure
    // and must not be reported to the user as a setup problem, since that
    // previously hid actual bugs (e.g. an unverified sending domain, which
    // Resend only allows sending FROM until a domain is verified, TO the
    // account owner's own address - every other recipient gets rejected).
    const message = result.reason === 'missing_api_key'
      ? 'Email delivery is not configured yet - please contact support.'
      : 'We could not send that email right now. Please try again in a few minutes or contact support.';
    return jsonResponse(200, { message, delivered: false, reason: result.reason });
  }
  return jsonResponse(200, { message: 'Verification email sent. Check your inbox.', delivered: true });
}
