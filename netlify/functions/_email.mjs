// Minimal email-sending helper. Greenfield - no email provider existed in
// this codebase before. Uses the Resend HTTP API (no SDK dependency needed,
// just a fetch call) when RESEND_API_KEY is set; otherwise every call is a
// silent no-op so the rest of the app (report/ticket submission) keeps
// working exactly the same whether or not email is configured.
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_ADDRESS = process.env.SUPPORT_FROM_EMAIL || 'KHAN Trust <onboarding@resend.dev>';
const ADMIN_NOTIFY_EMAIL = process.env.KHAN_ADMIN_NOTIFY_EMAIL || '';
const APP_URL = process.env.URL || 'https://khantrust.net';

export function isEmailConfigured() {
  return Boolean(RESEND_API_KEY);
}

export function getAdminNotifyEmail() {
  return ADMIN_NOTIFY_EMAIL;
}

// Never throws - a broken email provider must never block a report/ticket
// from being saved. Returns true/false for the caller to log if it wants to.
export async function sendEmail({ to, subject, text, html }) {
  if (!RESEND_API_KEY || !to) return false;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM_ADDRESS, to: [to], subject, ...(html ? { html } : { text }) }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// Shared by auth-register.mjs (first send) and auth-resend-verification.mjs
// (resend) so there is exactly one verification email template, not two
// copies that could quietly drift apart.
export async function sendVerificationEmail(email, name, token) {
  const link = `${APP_URL}/#/verify-email/${token}`;
  return sendEmail({
    to: email,
    subject: 'Verify your KHAN Trust account',
    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto">
      <h2 style="color:#c9a227">KHAN Trust</h2>
      <p>Hi <strong>${name}</strong>,</p>
      <p>Click the button below to verify your email address and activate your account.</p>
      <p><a href="${link}" style="background:#c9a227;color:#000;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:bold">Verify Email</a></p>
      <p style="color:#888;font-size:13px">This link expires in 24 hours. If you did not request this, ignore this email.</p>
    </div>`,
  });
}
