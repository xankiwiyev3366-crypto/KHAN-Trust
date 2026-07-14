import { getUserByEmail, createResetToken, jsonResponse } from './_authStore.mjs';
import { sendEmail, isEmailConfigured } from './_email.mjs';
import { enforce, getClientIp } from './_rateLimit.mjs';

const APP_URL = process.env.URL || 'https://khantrust.net';

export async function handler(event) {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { message: 'Method not allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { message: 'Invalid JSON' }); }

  const { email } = body;
  if (!email) return jsonResponse(400, { message: 'Email is required' });

  // Throttle reset-email spam per source IP and per targeted address. Keyed on
  // the request regardless of whether the account exists, so a 429 here still
  // leaks nothing about account existence (the enumeration guarantee holds).
  const ipLimit = await enforce('forgot_ip', getClientIp(event));
  const emailLimit = await enforce('forgot_email', String(email).toLowerCase().trim());
  if (!ipLimit.allowed || !emailLimit.allowed) {
    // Same generic body as the success path so timing/response shape is stable.
    return jsonResponse(200, { message: 'If an account exists with that email, a reset link has been sent.' });
  }

  // Always return the same response to prevent email enumeration
  const user = await getUserByEmail(email);
  if (user && isEmailConfigured()) {
    const token = await createResetToken(email.toLowerCase());
    const link = `${APP_URL}/#/reset-password/${token}`;
    // Routed through the shared sendEmail() (see _email.mjs) instead of a
    // second copy of the raw Resend fetch call - that copy silently
    // discarded the response (.catch(() => {}), no result checked at all),
    // so a delivery failure here was invisible even in the function logs.
    const result = await sendEmail({
      to: email,
      subject: 'Reset your KHAN Trust password',
      html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#c9a227">KHAN Trust</h2>
        <p>Click the button below to reset your password. This link expires in <strong>1 hour</strong>.</p>
        <p><a href="${link}" style="background:#c9a227;color:#000;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:bold">Reset Password</a></p>
        <p style="color:#888;font-size:13px">If you did not request a password reset, ignore this email — your account is safe.</p>
      </div>`,
    });
    if (!result.ok) {
      console.error('[auth-forgot-password] delivery failed', { reason: result.reason, status: result.status, detail: result.detail });
    }
  }

  return jsonResponse(200, { message: 'If an account exists with that email, a reset link has been sent.' });
}
