// Minimal email-sending helper. Greenfield - no email provider existed in
// this codebase before. Uses the Resend HTTP API (no SDK dependency needed,
// just a fetch call) when RESEND_API_KEY is set; otherwise every call is a
// silent no-op so the rest of the app (report/ticket submission) keeps
// working exactly the same whether or not email is configured.
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_ADDRESS = process.env.SUPPORT_FROM_EMAIL || 'KHAN Trust <onboarding@resend.dev>';
const ADMIN_NOTIFY_EMAIL = process.env.KHAN_ADMIN_NOTIFY_EMAIL || '';

export function isEmailConfigured() {
  return Boolean(RESEND_API_KEY);
}

export function getAdminNotifyEmail() {
  return ADMIN_NOTIFY_EMAIL;
}

// Never throws - a broken email provider must never block a report/ticket
// from being saved. Returns true/false for the caller to log if it wants to.
export async function sendEmail({ to, subject, text }) {
  if (!RESEND_API_KEY || !to) return false;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM_ADDRESS, to: [to], subject, text }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
