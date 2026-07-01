// Minimal email-sending helper. Greenfield - no email provider existed in
// this codebase before. Uses the Resend HTTP API (no SDK dependency needed,
// just a fetch call) when RESEND_API_KEY is set; otherwise every call is a
// silent no-op so the rest of the app (report/ticket submission) keeps
// working exactly the same whether or not email is configured.
//
// SECURITY: this module and RESEND_API_KEY are Netlify Functions-only (Node,
// server-side). Do not import this file from anything under src/ - Vite only
// ever bundles env vars explicitly prefixed VITE_ into the browser build, and
// RESEND_API_KEY deliberately is not one, so it never reaches the client.
// The only way to trigger an email from the frontend is through one of our
// own endpoints (auth-resend-verification, auth-forgot-password, etc.) -
// the frontend must never call api.resend.com directly.
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
// from being saved. Returns a structured result instead of a bare boolean so
// callers that DO care why delivery failed (auth-resend-verification.mjs)
// can tell "key missing" apart from "Resend rejected this specific send" -
// collapsing those into one boolean is what previously made every failure
// report as "not configured" even when the key was present and the real
// cause was something else entirely (see reason: 'provider_error' below).
// Existing fire-and-forget callers (report-submit.mjs) that only `await`
// this without reading the result are unaffected - {ok: false, ...} is
// still falsy-safe to ignore.
export async function sendEmail({ to, subject, text, html }) {
  if (!RESEND_API_KEY) return { ok: false, reason: 'missing_api_key' };
  if (!to) return { ok: false, reason: 'missing_recipient' };
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM_ADDRESS, to: [to], subject, ...(html ? { html } : { text }) }),
    });
    if (!response.ok) {
      // Resend's error body names the actual problem (e.g. "You can only
      // send testing emails to your own email address" when no sending
      // domain is verified yet) - logged here so it shows up in Netlify
      // function logs instead of being discarded, since that's the one
      // piece of information needed to actually diagnose a delivery failure.
      const detail = await response.text().catch(() => '');
      console.error('[sendEmail] Resend API rejected the request', {
        status: response.status,
        detail,
        to,
        from: FROM_ADDRESS,
      });
      return { ok: false, reason: 'provider_error', status: response.status, detail };
    }
    return { ok: true };
  } catch (error) {
    console.error('[sendEmail] request to Resend failed', { message: error.message, to, from: FROM_ADDRESS });
    return { ok: false, reason: 'network_error', detail: error.message };
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
