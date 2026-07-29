// Operator notifications for the verification lifecycle, over the existing
// Telegram channel (_telegram.mjs).
//
// ── THE DESTINATION MAY BE A GROUP, AND THAT CHANGES EVERYTHING ─────────────
//
// KHAN_ADMIN_TELEGRAM_CHAT_ID is whatever the operator configured. In practice
// that is often a small team group, and a Telegram group is a surface with no
// access control we administer: members get added, chat history is retained
// indefinitely and is fully searchable, and Telegram desktop syncs it to every
// device any member has ever signed in on.
//
// So this module treats every message as if it will be read by someone who
// should not see a customer's private details, because eventually it will be.
// Nothing here carries:
//
//   - a full payer wallet address        (truncated to 4+4)
//   - a transaction signature            (omitted entirely)
//   - a customer email or account id     (never included)
//   - a buyer subject                    (never included)
//   - an admin note or review comment    (never included)
//
// What it carries instead is an order id and a deep link into the admin console,
// where the same operator can see the full record behind the passcode gate. The
// notification's job is to say "something needs you and here is where", not to
// be the record itself. A notification that contains everything is a
// notification that leaks everything.
//
// ── FAILURES ARE NON-BLOCKING AND RETRYABLE ─────────────────────────────────
//
// sendTelegram() never throws and returns a structured result. This module maps
// that into the queue's retry contract so a Telegram outage becomes a retried
// job rather than either a lost alert or a failed activation.
import { sendTelegram, isTelegramConfigured } from './_telegram.mjs';
import { siteOrigin } from './_badgeState.mjs';

function adminChatId() {
  return process.env.KHAN_ADMIN_TELEGRAM_CHAT_ID || '';
}

export function isAdminAlertConfigured() {
  return isTelegramConfigured() && Boolean(adminChatId());
}

// 4 leading + 4 trailing characters. Enough for an operator to match it against
// the console; useless to anyone trying to identify a person from it.
export function shortAddress(value) {
  const clean = String(value || '').trim();
  if (!clean) return '—';
  if (clean.length <= 12) return clean;
  return `${clean.slice(0, 4)}…${clean.slice(-4)}`;
}

// One builder per alert, all pure, so what is (and is not) in a message can be
// asserted in a test rather than reviewed by eye.
export const ADMIN_ALERTS = {
  order_paid: (ctx) => [
    '💰 New paid verification order',
    `Order: ${ctx.order.id}`,
    `Tier: ${ctx.order.tierId} ($${ctx.order.usd})`,
    `Token: ${shortAddress(ctx.order.contract)} on ${ctx.order.chain}`,
    `Payer: ${shortAddress(ctx.order.ownerWallet)}`,
  ],
  ownership_review: (ctx) => [
    '🔍 Ownership needs manual review',
    `Order: ${ctx.order.id}`,
    `Token: ${shortAddress(ctx.order.contract)} on ${ctx.order.chain}`,
    'The buyer proved a wallet but not its link to this token.',
    `Review: ${siteOrigin()}/console#/verification`,
  ],
  activated: (ctx) => [
    '✅ Verification activated',
    `Order: ${ctx.order.id}`,
    `Token: ${shortAddress(ctx.order.contract)} on ${ctx.order.chain}`,
    `Expires: ${String(ctx.order.expiresAt || '').slice(0, 10) || 'no expiry'}`,
  ],
  expiring: (ctx) => [
    '⏳ Verification expiring soon',
    `Order: ${ctx.order.id}`,
    `Token: ${shortAddress(ctx.order.contract)} on ${ctx.order.chain}`,
    `Expires: ${String(ctx.order.expiresAt || '').slice(0, 10)} (${ctx.days} day${ctx.days === 1 ? '' : 's'})`,
  ],
  expired: (ctx) => [
    '🕒 Verification expired',
    `Order: ${ctx.order.id}`,
    `Token: ${shortAddress(ctx.order.contract)} on ${ctx.order.chain}`,
  ],
  revoked: (ctx) => [
    '⛔ Verification revoked',
    `Order: ${ctx.order.id}`,
    `Token: ${shortAddress(ctx.order.contract)} on ${ctx.order.chain}`,
  ],
  duplicate_sale: (ctx) => [
    '⚠️ Duplicate sale — REFUND REQUIRED',
    `Order: ${ctx.order.id}`,
    `Token: ${shortAddress(ctx.order.contract)} on ${ctx.order.chain}`,
    `Superseded by: ${ctx.order.supersededBy || 'unknown'}`,
    'The payment is recorded and refundable. The signature is in the admin console.',
  ],
  payment_failure: (ctx) => [
    '🚨 Payment or refund processing failed',
    `Order: ${ctx.orderId || 'unknown'}`,
    `Stage: ${ctx.stage || 'unknown'}`,
    // The error text is truncated hard. Provider errors routinely echo the
    // request back, and the request contains the things this file exists not to
    // publish.
    `Detail: ${String(ctx.detail || '').slice(0, 120)}`,
  ],
  dead_letter: (ctx) => [
    '☠️ Queue job dead-lettered',
    `Type: ${ctx.type}`,
    `Job: ${ctx.jobId}`,
    `Attempts: ${ctx.attempts}`,
    `Last error: ${String(ctx.lastError || '').slice(0, 160)}`,
    `Queue: ${siteOrigin()}/console#/queue`,
  ],
  reconciliation: (ctx) => [
    '🧾 Reconciliation found paid orders that never activated',
    `Count: ${ctx.count}`,
    `Oldest: ${String(ctx.oldest || '').slice(0, 10)}`,
    `Review: ${siteOrigin()}/console#/verification`,
  ],
};

export function buildAdminAlert(kind, ctx) {
  const builder = ADMIN_ALERTS[kind];
  if (!builder) return '';
  return builder(ctx).join('\n');
}

// Returns the same discriminated shape the mail path uses, for the same reason:
// "Telegram is not configured" must not be retried five times and shelved, while
// "Telegram rejected this send" must be.
export async function notifyAdmin(kind, ctx = {}) {
  const text = buildAdminAlert(kind, ctx);
  if (!text) return { ok: false, retryable: false, reason: 'unknown_alert' };
  if (!isAdminAlertConfigured()) return { ok: true, skipped: 'not_configured' };

  const result = await sendTelegram({ chatId: adminChatId(), text });
  if (result.ok) return { ok: true };
  if (result.reason === 'missing_bot_token' || result.reason === 'missing_chat_id') {
    return { ok: true, skipped: 'not_configured' };
  }
  return { ok: false, retryable: true, reason: result.reason || 'provider_error' };
}
