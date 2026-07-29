// GET /receipt/<orderId>   (rewritten in netlify.toml)
//
// The customer-facing purchase receipt. Server-rendered, printable, and
// deliberately NOT part of the SPA.
//
// ── WHY NOT A ROUTE IN THE APP ──────────────────────────────────────────────
//
// This URL is put in an email and, from there, into an accountant's folder, a
// support ticket and a browser bookmark. Every one of those wants a page that
// renders immediately, prints correctly, and still works in three years. A hash
// route inside a 13 000-line React bundle satisfies none of them: it needs the
// whole app to boot to show a table of numbers, and it prints as whatever the
// application shell happens to look like.
//
// ── AUTHORISATION, AND WHY KNOWING THE URL IS NOT ENOUGH ────────────────────
//
// Order ids look like `vo-<epoch-ms>-<8 chars>`. The timestamp half is
// guessable to within a day by anyone who knows roughly when a project got
// verified — and verification dates are PUBLIC, printed on the profile page.
// Treating possession of the URL as proof would therefore expose payment
// amounts, a payer wallet and a transaction signature to anyone willing to grind
// 8 characters against a known day.
//
// So this page requires the same proof the JSON endpoint does: the account that
// placed the order, the wallet that paid, or an admin. An unauthenticated
// visitor gets a 401 page telling them how to sign in — never a 404, which would
// let someone probe which order ids exist.
//
// A GET cannot carry an Authorization header from an email link, so the token
// arrives as a query parameter and the page is `no-store`, noindex, and
// referrer-stripped. That is a real trade and it is made consciously: the
// alternative is an unauthenticated receipt.
import { verifyJwt, getUserById } from './_authStore.mjs';
import { provenWallet } from './_walletSession.mjs';
import { verifyToken } from './_adminAuth.mjs';
import { getOrder } from './_verificationOrders.mjs';
import { getReceipt, canViewReceipt } from './_verificationReceipts.mjs';
import { accountSubject } from './_entitlementsStore.mjs';
import { siteOrigin } from './_badgeState.mjs';
import { chainLabel } from '../../src/chains/registry.js';

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function resolveOrderId(event) {
  const source = event.path || event.rawUrl || '';
  let pathname = source;
  if (/^https?:\/\//i.test(source)) {
    try {
      pathname = new URL(source).pathname;
    } catch {
      pathname = source;
    }
  }
  const match = pathname.match(/\/receipt\/([^/?#]+)/i);
  if (match) {
    try {
      return decodeURIComponent(match[1]).trim();
    } catch {
      return match[1].trim();
    }
  }
  return String(event.queryStringParameters?.orderId || '').trim();
}

const STYLES = `
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;background:#f7f6f2;color:#17160f;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.6}
.sheet{max-width:640px;margin:0 auto;padding:32px 20px 60px}
.paper{background:#fff;border:1px solid #e4e0d4;border-radius:14px;padding:28px}
.brand{display:flex;align-items:center;gap:11px;margin:0 0 22px}
.mark{width:36px;height:36px;border-radius:9px;background:linear-gradient(140deg,#e0b75c,#a8802b);color:#120d02;display:flex;align-items:center;justify-content:center;font-weight:800}
h1{font-size:21px;margin:0 0 2px}
.muted{color:#6f6a58;font-size:13.5px;margin:0}
.num{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#f4f1e8;border:1px solid #e4e0d4;border-radius:8px;padding:9px 12px;display:inline-block;margin:14px 0 22px;font-size:14px}
dl{margin:0;display:grid;grid-template-columns:minmax(150px,auto) 1fr;gap:9px 18px}
dt{color:#6f6a58;font-size:13.5px}
dd{margin:0;font-size:13.5px;word-break:break-all}
.total{border-top:1px solid #e4e0d4;margin-top:20px;padding-top:16px;display:flex;justify-content:space-between;font-size:17px;font-weight:700}
.actions{margin-top:22px;display:flex;gap:10px;flex-wrap:wrap}
.btn{display:inline-block;padding:10px 16px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;border:1px solid #e4e0d4;color:#17160f;background:#faf8f2;cursor:pointer;font-family:inherit}
.note{color:#6f6a58;font-size:12.5px;margin-top:22px;border-top:1px solid #e4e0d4;padding-top:14px}
@media(max-width:520px){dl{grid-template-columns:1fr;gap:2px 0}dd{margin:0 0 8px}}
@media print{body{background:#fff}.sheet{padding:0}.paper{border:none;padding:0}.actions{display:none}}
@media(prefers-color-scheme:dark){body{background:#0d0d0b;color:#f6f0df}.paper{background:#141310;border-color:#2b2820}.num{background:#1b1a15;border-color:#2b2820}.muted,dt,.note{color:#a49d88}.btn{background:#1b1a15;border-color:#2b2820;color:#f6f0df}.total{border-color:#2b2820}.note{border-color:#2b2820}}
`.trim();

function page(title, bodyHtml, { origin }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} | KHAN Trust</title>
<meta name="robots" content="noindex, nofollow, noarchive, nosnippet" />
<meta name="referrer" content="no-referrer" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<style>${STYLES}</style>
</head>
<body><div class="sheet"><div class="paper">
<div class="brand"><span class="mark">K</span><div><h1>KHAN Trust</h1><p class="muted">Verification receipt</p></div></div>
${bodyHtml}
</div></div>
<p class="muted" style="text-align:center;margin:18px auto;max-width:640px;font-size:12px"><a href="${escapeHtml(origin)}/" style="color:inherit">khantrust.net</a></p>
</body>
</html>`;
}

function htmlResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Never cached, anywhere. A shared browser or a caching proxy holding one
      // customer's receipt and serving it to the next visitor is the failure
      // this single header prevents.
      'Cache-Control': 'no-store, private',
      'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
      // The receipt URL carries an auth token in its query string (see the
      // header). Without this, clicking any link on this page would send that
      // token to the destination in the Referer.
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
    body,
  };
}

function row(label, value) {
  if (!value && value !== 0) return '';
  return `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`;
}

// Pure renderer — the receipt's content is testable without a store or a session.
export function renderReceiptHtml(receipt, { origin = siteOrigin() } = {}) {
  const rows = [
    row('Receipt number', receipt.receiptNumber),
    row('Order ID', receipt.orderId),
    row('Issued', String(receipt.issuedAt || '').slice(0, 10)),
    row('Tier', receipt.tier === 'verified_pro' ? 'Verified Pro' : 'Verified'),
    // The registry's display name, not the raw id — "Solana" and "BNB Chain",
    // matching what the report and the profile call the same chain.
    row('Chain', receipt.chain ? chainLabel(receipt.chain) : ''),
    row('Contract', receipt.contract),
    row('Payment confirmed', String(receipt.paidAt || '').slice(0, 19).replace('T', ' ')),
    row('Verification activated', String(receipt.activatedAt || '').slice(0, 19).replace('T', ' ')),
    row('Valid until', String(receipt.expiresAt || '').slice(0, 10) || 'No expiry'),
    row('Paid in', receipt.amountPaid != null && receipt.paymentCurrency
      ? `${receipt.amountPaid} ${receipt.paymentCurrency}`
      : ''),
    row('Transaction', receipt.transactionSignature),
    row('Payer wallet', receipt.payerWallet),
    row('Status at issue', receipt.statusAtIssue),
  ].filter(Boolean).join('');

  return page('Verification receipt', `
<div class="num">${escapeHtml(receipt.receiptNumber)}</div>
<dl>${rows}</dl>
<div class="total"><span>Total</span><span>$${escapeHtml(String(receipt.amount))} ${escapeHtml(receipt.currency)}</span></div>
<div class="actions">
<button class="btn" type="button" onclick="window.print()">Print / Save as PDF</button>
<a class="btn" href="${escapeHtml(receipt.profileUrl)}">Public profile</a>
<a class="btn" href="${escapeHtml(receipt.badgeUrl)}">Badge</a>
</div>
<p class="note">
This receipt records the transaction as it stood when it was issued and is never rewritten — that is what makes it usable as proof of purchase.
For the CURRENT status of this verification, which can change, see the <a href="${escapeHtml(receipt.profileUrl)}">public profile</a>.
Verification confirms project ownership. It is not an endorsement, a security audit, or investment advice.
</p>`, { origin });
}

export async function handler(event) {
  const origin = siteOrigin();
  try {
    if (event.httpMethod !== 'GET' && event.httpMethod !== 'HEAD') {
      return { statusCode: 405, headers: { 'Content-Type': 'text/plain' }, body: 'Method not allowed' };
    }

    const orderId = resolveOrderId(event);
    if (!orderId) {
      return htmlResponse(400, page('Receipt not found', '<p class="muted">No order was specified.</p>', { origin }));
    }

    // The token may arrive as a query parameter (an email link cannot set a
    // header) or as a normal Authorization header when the SPA fetches this.
    const query = event.queryStringParameters || {};
    const headerToken = (event.headers?.authorization || '').replace(/^Bearer /, '');
    const token = String(query.t || headerToken || '').trim();

    const auth = verifyJwt(token);
    const wallet = provenWallet(event);
    const isAdmin = verifyToken(token);

    const order = await getOrder(orderId);
    const allowed = canViewReceipt({
      order,
      accountSubject: auth?.sub ? accountSubject(auth.sub) : '',
      wallet,
      isAdmin,
    });

    if (!allowed) {
      // 401 for BOTH "no such order" and "not yours" — see the header. A 404
      // here would confirm which order ids exist and turn the id space into an
      // oracle.
      return htmlResponse(401, page('Sign in to view this receipt', `
<p class="muted">This receipt is private to the account or wallet that made the purchase.</p>
<p class="muted">Open it from the confirmation email, or sign in to KHAN Trust with the account you bought it on.</p>
<div class="actions"><a class="btn" href="${escapeHtml(origin)}/">Go to KHAN Trust</a></div>`, { origin }));
    }

    const receipt = await getReceipt(orderId);
    if (!receipt) {
      // The order exists and is yours, but the receipt job has not run yet.
      // A truthful "not ready" page with a refresh is the correct answer — and
      // this is exactly the recovery path the requirement asks for: the receipt
      // is generated by a durable, retried job, so it WILL appear.
      return htmlResponse(202, page('Receipt is being prepared', `
<p class="muted">Your payment is recorded and your receipt is being generated. This usually takes a few minutes.</p>
<div class="actions"><a class="btn" href="">Refresh</a></div>
<p class="note">Nothing is lost if you close this page — receipt generation is a durable job that retries until it succeeds, and the link in your email will keep working.</p>`, { origin }));
    }

    // The user's own JWT is enough to identify them, but a stale-looking receipt
    // for a deleted account would be odd. Confirmed only for the account lane.
    if (auth?.sub && !isAdmin) {
      const user = await getUserById(auth.sub).catch(() => null);
      if (!user) {
        return htmlResponse(401, page('Sign in to view this receipt', '<p class="muted">This session is no longer valid.</p>', { origin }));
      }
    }

    return htmlResponse(200, renderReceiptHtml(receipt, { origin }));
  } catch (error) {
    console.error(`[receipt-page] failed: ${error.stack || error.message}`);
    return htmlResponse(503, page('Temporarily unavailable', '<p class="muted">We could not load this receipt just now. Please try again shortly.</p>', { origin }));
  }
}
