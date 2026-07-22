// Minimal Telegram delivery helper — the Watchtower's second push channel
// (Task 5), alongside email (_email.mjs) and the always-on in-app bell.
//
// Uses the Telegram Bot API over plain fetch (no SDK dependency). When
// TELEGRAM_BOT_TOKEN is unset every call is a silent no-op, exactly like
// _email.mjs when RESEND_API_KEY is missing — so the alerts run works
// identically whether or not Telegram is configured. A channel that is not set
// up must degrade to "not delivered here", never to an error that stalls the
// whole notification cycle.
//
// SECURITY: server-side only. TELEGRAM_BOT_TOKEN is a Netlify Function env var
// and is NOT prefixed VITE_, so Vite never bundles it into the browser. Do not
// import this file from anything under src/. The frontend can never reach the
// Telegram API directly; it only stores a chat id on its own alert
// subscription, and this module (running in the scheduled alerts job) is the
// only thing that sends.
//
// HOW A USER GETS A chatId: they open the bot and send /start; a companion
// endpoint (or the bot's own webhook) records the chat id against their
// account. Until then sub.telegramChatId is absent and this channel is simply
// skipped for that user — no guessing, no fabrication.
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const API_BASE = 'https://api.telegram.org';

export function isTelegramConfigured() {
  return Boolean(TELEGRAM_BOT_TOKEN);
}

// Never throws — a Telegram failure must never block the in-app write or the
// email send that run alongside it. Returns a structured result so a caller
// that cares can tell "not configured" apart from "Telegram rejected this
// specific send", matching sendEmail()'s contract.
export async function sendTelegram({ chatId, text }) {
  if (!TELEGRAM_BOT_TOKEN) return { ok: false, reason: 'missing_bot_token' };
  if (!chatId) return { ok: false, reason: 'missing_chat_id' };
  if (!text) return { ok: false, reason: 'missing_text' };

  try {
    const response = await fetch(`${API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        // Plain text: the digest is user-facing prose, and disabling parse_mode
        // avoids a stray * or _ in a token name breaking Telegram's markdown.
        disable_web_page_preview: true,
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error('[sendTelegram] Telegram API rejected the request', {
        status: response.status,
        body: body.slice(0, 300),
      });
      return { ok: false, reason: 'provider_error', status: response.status };
    }
    return { ok: true };
  } catch (error) {
    console.error('[sendTelegram] request to Telegram failed', { message: error.message });
    return { ok: false, reason: 'network_error' };
  }
}
