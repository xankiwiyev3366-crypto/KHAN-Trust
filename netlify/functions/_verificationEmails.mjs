// Transactional email for the paid verification lifecycle.
//
// ── THESE ARE TRANSACTIONAL, AND THAT IS A DECISION ─────────────────────────
//
// _lifecycleTemplates.mjs puts an RFC 8058 one-click List-Unsubscribe on every
// message it sends, because those are BULK retention mail and Gmail/Yahoo filter
// bulk senders that omit it. The messages here are the opposite kind: a receipt
// for $149, a notice that ownership proof is needed, a warning that a paid
// verification expires in seven days. A customer cannot opt out of being told
// their purchase is about to lapse, and offering an unsubscribe on it would be
// worse than useless — it would let someone silence the only warning that their
// product is ending.
//
// So: no unsubscribe header, no marketing content, and nothing sent to anyone
// who has not bought something. That is what keeps them transactional in fact
// and not merely in label.
//
// ── IDEMPOTENT SENDING ──────────────────────────────────────────────────────
//
// Every send goes through sendVerificationEmailOnce(), which consults a ledger
// keyed by (orderId, stage). A retried job, a re-run cron and a double-fired
// activation all resolve to one email.
//
// The ledger is written AFTER the provider accepts the message, never before —
// the same rule _lifecycleStore.mjs records: writing first means a provider
// outage silently consumes the customer's one notification, and for an expiry
// warning that is the difference between a renewal and a lapse.
import { getNamedStore } from './_blobsClient.mjs';
import { sendEmail } from './_email.mjs';
import { getUserById } from './_authStore.mjs';
import { isAccountSubject } from './_entitlementsStore.mjs';
import { siteOrigin } from './_badgeState.mjs';

const STORE_NAME = 'khan-trust-verify-mail';

export const MAIL_STAGES = {
  PAYMENT_CONFIRMED: 'payment_confirmed',
  OWNERSHIP_REQUIRED: 'ownership_required',
  ACTIVATED: 'activated',
  OWNERSHIP_FAILED: 'ownership_failed',
  EXPIRING_30: 'expiring_30',
  EXPIRING_7: 'expiring_7',
  EXPIRING_1: 'expiring_1',
  EXPIRED: 'expired',
  REVOKED: 'revoked',
  REFUNDED: 'refunded',
  RENEWAL_REMINDER: 'renewal_reminder',
};

function store() {
  return getNamedStore(STORE_NAME);
}

function ledgerKey(orderId) {
  return `order/${orderId}`;
}

export async function getMailLedger(orderId) {
  const data = await store().get(ledgerKey(orderId), { type: 'json' }).catch(() => null);
  return data && typeof data === 'object' ? data : { orderId, sent: {} };
}

export async function wasSent(orderId, stage) {
  const ledger = await getMailLedger(orderId);
  return Boolean(ledger.sent?.[stage]);
}

async function recordSent(orderId, stage, now = Date.now()) {
  const ledger = await getMailLedger(orderId);
  ledger.sent = { ...ledger.sent, [stage]: new Date(now).toISOString() };
  ledger.updatedAt = new Date(now).toISOString();
  await store().setJSON(ledgerKey(orderId), ledger).catch(() => {});
}

// ── Recipient resolution ────────────────────────────────────────────────────
//
// An order's buyer is a SUBJECT — "u:<userId>" for an account, or a bare wallet
// address for the anonymous lane that verify-order-create deliberately allows
// (requiring an account before taking payment is the exact friction that broke
// Premium checkout). A wallet has no inbox.
//
// So "no email" is a NORMAL outcome, not an error, and it is reported as
// 'no_recipient' rather than swallowed. The alternative — treating it as a
// failure — would retry five times and dead-letter a job for a customer who
// simply paid with a wallet and was never going to receive mail. The admin
// Telegram notification is what covers those orders.
export async function resolveRecipient(order) {
  const subject = order?.buyerSubject || '';
  if (!subject || !isAccountSubject(subject)) return { email: '', name: '', reason: 'no_recipient' };
  const userId = subject.slice(2);
  try {
    const user = await getUserById(userId);
    if (!user?.email) return { email: '', name: '', reason: 'no_recipient' };
    return { email: user.email, name: user.name || '', reason: '' };
  } catch {
    // A store failure is NOT "no recipient" — it is "we could not find out", and
    // collapsing the two would burn the customer's one send. Reported as
    // retryable so the queue tries again.
    return { email: '', name: '', reason: 'lookup_failed' };
  }
}

// ── Templates ───────────────────────────────────────────────────────────────

const APP_URL = () => siteOrigin();

function shell(bodyHtml) {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;color:#1c1c1c">
  <h2 style="color:#8a6b23;margin:0 0 18px">KHAN Trust</h2>
  ${bodyHtml}
  <hr style="border:none;border-top:1px solid #e6e6e6;margin:26px 0 14px" />
  <p style="color:#8a8a8a;font-size:12px;line-height:1.5">
    You are receiving this because you purchased KHAN Trust verification. This is a transactional message about your order.
    Verification confirms project ownership; it is not an endorsement or a security audit.
  </p>
</div>`;
}

function button(href, label) {
  return `<p><a href="${href}" style="background:#c9a227;color:#000;padding:12px 22px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:bold">${label}</a></p>`;
}

function tokenLabel(order) {
  return order.contract ? `${order.contract.slice(0, 6)}…${order.contract.slice(-4)}` : 'your token';
}

function dateOnly(iso) {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : '';
}

// Every builder returns { subject, html }. Pure — no store, no provider, no
// clock — so subject lines and links are unit-testable without sending anything.
//
// SUBJECT LINES NAME THE TOKEN AND THE ACTION. "Your KHAN Trust order" tells a
// customer with three tokens nothing, and an expiry warning that does not say
// what expires gets read after it has expired.
export const MAIL_TEMPLATES = {
  [MAIL_STAGES.PAYMENT_CONFIRMED]: (ctx) => ({
    subject: `Payment received — KHAN Trust verification for ${tokenLabel(ctx.order)}`,
    html: shell(`
      <p>We have received your payment of <strong>$${ctx.order.usd} USD</strong> for KHAN Trust verification.</p>
      <p><strong>Order:</strong> ${ctx.order.id}<br /><strong>Token:</strong> ${ctx.order.contract} (${ctx.order.chain})</p>
      <p>Your verification is not active yet — the next step is proving ownership of this project.</p>
      ${ctx.receipt ? button(ctx.receipt.receiptUrl, 'View your receipt') : ''}`),
  }),

  [MAIL_STAGES.OWNERSHIP_REQUIRED]: (ctx) => ({
    subject: `Action needed: prove ownership for ${tokenLabel(ctx.order)}`,
    html: shell(`
      <p>Your payment is confirmed, but we could not automatically confirm that your wallet controls this token.</p>
      <p>Our reviewers are checking your request by hand. No further action is needed from you right now — we will email you as soon as it is decided.</p>
      <p><strong>Order:</strong> ${ctx.order.id}<br /><strong>Token:</strong> ${ctx.order.contract} (${ctx.order.chain})</p>
      <p style="color:#6a6a6a;font-size:13px">Your badge stays inactive until ownership is confirmed. We do not activate verification on payment alone — that is what makes it worth having.</p>`),
  }),

  [MAIL_STAGES.ACTIVATED]: (ctx) => ({
    subject: `Verified — ${tokenLabel(ctx.order)} is now verified on KHAN Trust`,
    html: shell(`
      <p>Ownership is proven and your verification is <strong>active</strong>.</p>
      <p><strong>Valid until:</strong> ${dateOnly(ctx.order.expiresAt) || 'no expiry'}</p>
      ${ctx.profileUrl ? button(ctx.profileUrl, 'View your public profile') : ''}
      <p>Embed your badge anywhere:</p>
      <p style="background:#f4f4f4;padding:10px;border-radius:5px;font-family:monospace;font-size:12px;word-break:break-all">${ctx.badgeUrl || ''}</p>
      ${ctx.receipt ? `<p><a href="${ctx.receipt.receiptUrl}">View your receipt</a></p>` : ''}`),
  }),

  [MAIL_STAGES.OWNERSHIP_FAILED]: (ctx) => ({
    subject: `Ownership could not be confirmed for ${tokenLabel(ctx.order)}`,
    html: shell(`
      <p>We were unable to confirm that you control this project, so we cannot activate verification.</p>
      <p><strong>Order:</strong> ${ctx.order.id}<br /><strong>Token:</strong> ${ctx.order.contract} (${ctx.order.chain})</p>
      <p>Your payment has not been kept for a product you did not receive. Reply to this email and we will arrange a refund or help you complete the proof.</p>`),
  }),

  [MAIL_STAGES.EXPIRING_30]: (ctx) => expiringMail(ctx, 30),
  [MAIL_STAGES.EXPIRING_7]: (ctx) => expiringMail(ctx, 7),
  [MAIL_STAGES.EXPIRING_1]: (ctx) => expiringMail(ctx, 1),

  [MAIL_STAGES.EXPIRED]: (ctx) => ({
    subject: `Verification expired — ${tokenLabel(ctx.order)}`,
    html: shell(`
      <p>Your KHAN Trust verification for <strong>${ctx.order.contract}</strong> expired on ${dateOnly(ctx.order.expiresAt)}.</p>
      <p>Your badge now shows <strong>Expired</strong> wherever it is embedded, and your public profile shows the verification history rather than claiming you are still verified.</p>
      ${ctx.renewUrl ? button(ctx.renewUrl, 'Renew verification') : ''}`),
  }),

  [MAIL_STAGES.REVOKED]: (ctx) => ({
    subject: `Verification revoked — ${tokenLabel(ctx.order)}`,
    html: shell(`
      <p>KHAN Trust has withdrawn verification for <strong>${ctx.order.contract}</strong>.</p>
      <p>Your badge now shows <strong>Revoked</strong>. If you believe this is a mistake, reply to this email and we will review it.</p>`),
  }),

  [MAIL_STAGES.REFUNDED]: (ctx) => ({
    subject: `Refund processed — KHAN Trust order ${ctx.order.id}`,
    html: shell(`
      <p>We have processed a refund of <strong>$${ctx.order.usd} USD</strong> for order ${ctx.order.id}.</p>
      <p><strong>Token:</strong> ${ctx.order.contract} (${ctx.order.chain})</p>
      <p>Depending on the network and your wallet, the funds may take a short time to appear.</p>`),
  }),

  [MAIL_STAGES.RENEWAL_REMINDER]: (ctx) => ({
    subject: `Renew your KHAN Trust verification for ${tokenLabel(ctx.order)}`,
    html: shell(`
      <p>Your verification for <strong>${ctx.order.contract}</strong> has ended and the badge is no longer active.</p>
      <p>Renewing restores the badge and your verified public profile immediately once ownership is re-confirmed.</p>
      ${ctx.renewUrl ? button(ctx.renewUrl, 'Renew verification') : ''}`),
  }),
};

function expiringMail(ctx, days) {
  return {
    subject: `Your KHAN Trust verification expires in ${days} day${days === 1 ? '' : 's'} — ${tokenLabel(ctx.order)}`,
    html: shell(`
      <p>Your KHAN Trust verification for <strong>${ctx.order.contract}</strong> expires on <strong>${dateOnly(ctx.order.expiresAt)}</strong>, in ${days} day${days === 1 ? '' : 's'}.</p>
      <p>When it expires your badge changes to <strong>Expired</strong> on every site it is embedded on, and your public profile stops showing an active verification.</p>
      ${ctx.renewUrl ? button(ctx.renewUrl, 'Renew now') : ''}
      <p style="color:#6a6a6a;font-size:13px">Renewing before the expiry date means the badge never lapses.</p>`),
  };
}

export function buildMail(stage, ctx) {
  const builder = MAIL_TEMPLATES[stage];
  return builder ? builder(ctx) : null;
}

// ── The one send path ───────────────────────────────────────────────────────
//
// Returns a discriminated result rather than a boolean so the queue can tell the
// three outcomes apart, because they need three different responses:
//
//   { ok: true }                        done, ledger written
//   { ok: true, skipped: 'already_sent' | 'no_recipient' | 'not_configured' }
//                                       nothing to do — do NOT retry
//   { ok: false, retryable: true }      the provider failed — DO retry
//
// Collapsing "no email address on this order" into a failure is what would
// otherwise fill the dead-letter shelf with orders that were always going to be
// wallet-only, drowning the real failures the shelf exists to surface.
export async function sendVerificationEmailOnce({ order, stage, ctx = {}, now = Date.now() }) {
  if (!order?.id || !MAIL_TEMPLATES[stage]) return { ok: false, retryable: false, reason: 'unknown_stage' };

  if (await wasSent(order.id, stage)) return { ok: true, skipped: 'already_sent' };

  const recipient = await resolveRecipient(order);
  if (recipient.reason === 'lookup_failed') return { ok: false, retryable: true, reason: 'lookup_failed' };
  if (!recipient.email) {
    // Recorded in the ledger so the cron does not re-derive this decision on
    // every run forever — the same reason _lifecycleStore keeps `skipped`.
    await recordSent(order.id, stage, now);
    return { ok: true, skipped: 'no_recipient' };
  }

  const mail = buildMail(stage, { order, ...ctx, appUrl: APP_URL() });
  if (!mail) return { ok: false, retryable: false, reason: 'unknown_stage' };

  const result = await sendEmail({ to: recipient.email, subject: mail.subject, html: mail.html });

  if (result.ok) {
    await recordSent(order.id, stage, now);
    // Delivery STATE only. Never the rendered message, never the recipient's
    // address in a log line that outlives the send.
    console.log(`[verify-mail] ${stage} sent for order ${order.id}`);
    return { ok: true };
  }

  if (result.reason === 'missing_api_key') {
    // Not configured is not a failure to retry five times over half an hour. It
    // is a deployment fact that will still be true on the fifth attempt.
    await recordSent(order.id, stage, now);
    return { ok: true, skipped: 'not_configured' };
  }

  return { ok: false, retryable: true, reason: result.reason || 'provider_error' };
}
