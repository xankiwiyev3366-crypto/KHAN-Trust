import { getUserByEmail, createResetToken, jsonResponse } from './_authStore.mjs';

const APP_URL = process.env.URL || 'https://khantrust.net';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.SUPPORT_FROM_EMAIL || 'noreply@khantrust.net';

export async function handler(event) {
  if (event.httpMethod !== 'POST') return jsonResponse(405, { message: 'Method not allowed' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return jsonResponse(400, { message: 'Invalid JSON' }); }

  const { email } = body;
  if (!email) return jsonResponse(400, { message: 'Email is required' });

  // Always return the same response to prevent email enumeration
  const user = await getUserByEmail(email);
  if (user && RESEND_API_KEY) {
    const token = await createResetToken(email.toLowerCase());
    const link = `${APP_URL}/#/reset-password/${token}`;
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: email,
        subject: 'Reset your KHAN Trust password',
        html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
          <h2 style="color:#c9a227">KHAN Trust</h2>
          <p>Click the button below to reset your password. This link expires in <strong>1 hour</strong>.</p>
          <p><a href="${link}" style="background:#c9a227;color:#000;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:bold">Reset Password</a></p>
          <p style="color:#888;font-size:13px">If you did not request a password reset, ignore this email — your account is safe.</p>
        </div>`,
      }),
    }).catch(() => {});
  }

  return jsonResponse(200, { message: 'If an account exists with that email, a reset link has been sent.' });
}
