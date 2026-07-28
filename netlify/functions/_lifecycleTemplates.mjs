// The lifecycle email bodies. Pure string building — no store, no provider, no
// clock — so the copy can be asserted in tests.
//
// EVERY CLAIM IN HERE MUST BE TRUE. These emails go out unattended, so a line
// that overstates what the product does is a lie that keeps sending itself. No
// fabricated statistics, no invented user counts, no manufactured urgency, no
// "only 3 spots left". Where a number appears it is the user's own (how many
// tokens they watch), never an aggregate we have not measured.
//
// Every message carries a one-click unsubscribe. It is not a footer courtesy —
// it is the thing that keeps the domain's reputation intact, and the reason the
// engine can be reasonably aggressive about the early sequence.

const APP_URL = (process.env.URL || 'https://khantrust.net').replace(/\/$/, '');

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function button(href, label) {
  return `<p style="margin:26px 0"><a href="${href}" style="background:#c9a227;color:#000;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:bold">${escapeHtml(label)}</a></p>`;
}

function shell(bodyHtml, unsubscribeUrl) {
  return `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a;line-height:1.55">
  <h2 style="color:#c9a227;margin-bottom:4px">KHAN Trust</h2>
  ${bodyHtml}
  <hr style="border:none;border-top:1px solid #e6e6e6;margin:32px 0 14px" />
  <p style="color:#8a8a8a;font-size:12px;margin:0">
    You are receiving this because you created a KHAN Trust account.
    <a href="${unsubscribeUrl}" style="color:#8a8a8a">Unsubscribe from these emails</a>.
    Risk alerts for tokens you watch are separate and are not affected.
  </p>
  <p style="color:#8a8a8a;font-size:12px;margin:8px 0 0">
    KHAN Trust is a risk-analysis tool. It does not provide financial advice and makes no claim about profit or returns.
  </p>
</div>`;
}

export function unsubscribeUrl(token) {
  return `${APP_URL}/.netlify/functions/lifecycle-unsubscribe?token=${encodeURIComponent(token || '')}`;
}

// One builder per stage. Each returns { subject, html }. `ctx` is the same
// decision context the engine used, so a template can never describe a state
// the engine did not verify.
const BUILDERS = {
  welcome(ctx, unsub) {
    const name = escapeHtml(ctx.name || 'there');
    return {
      subject: 'Your KHAN Trust account is ready',
      html: shell(`
        <p>Hi ${name},</p>
        <p>KHAN Trust checks a token's holders, liquidity, contract authorities and market activity, and gives you one clear risk verdict — with the reasoning shown, not hidden.</p>
        <p><strong>The part most people miss:</strong> you can have us keep watching a token after you scan it. Open any report and press <em>Watch Project</em>. We re-check it and email you if its risk rises. Five tokens, free.</p>
        ${button(APP_URL, 'Scan a token')}
        <p style="color:#666;font-size:14px">Paste any Solana or EVM contract address. No wallet needed.</p>
      `, unsub),
    };
  },

  day1(ctx, unsub) {
    return {
      subject: 'Nothing is watching your tokens yet',
      html: shell(`
        <p>A scan tells you what a token looks like right now. It does not tell you what happens next — and with the tokens most people hold, what happens next is the part that costs money.</p>
        <p>Put one on your watchlist and we will re-check it for you and email you if its risk rises: liquidity draining, a large holder exiting, a mint or freeze authority coming back to life.</p>
        ${button(APP_URL, 'Watch your first token')}
        <p style="color:#666;font-size:14px">Free accounts can watch 5 tokens, re-checked every 12 hours.</p>
      `, unsub),
    };
  },

  day3(ctx, unsub) {
    return {
      subject: 'How to read a KHAN Trust score',
      html: shell(`
        <p>A score on its own is not worth much, so KHAN Trust always shows the evidence under it.</p>
        <p>Three things worth checking on any token you are about to buy:</p>
        <ul>
          <li><strong>Mint authority.</strong> If it is still live, the deployer can create unlimited new supply at any moment. We cap the score hard when we see this.</li>
          <li><strong>Top-10 concentration.</strong> A handful of wallets holding most of the supply is the shape of an exit waiting to happen.</li>
          <li><strong>Liquidity vs market cap.</strong> A large "market cap" backed by a shallow pool is a number, not a market.</li>
        </ul>
        <p>Every report shows all three, with the actual figures and where they came from.</p>
        ${button(APP_URL, 'Check a token')}
      `, unsub),
    };
  },

  day5(ctx, unsub) {
    return {
      subject: 'The risk that is already in your wallet',
      html: shell(`
        <p>Most wallet drains do not come from a token you bought. They come from a token approval you granted months ago and forgot — a permission that is still live and still spendable.</p>
        <p>KHAN Trust can list the open approvals on a Solana wallet and show you which ones still carry real exposure, so you can revoke them.</p>
        ${button(`${APP_URL}/#/approvals`, 'Check my approvals')}
        <p style="color:#666;font-size:14px">Read-only. Connecting a wallet never moves funds, and KHAN Trust never asks for a seed phrase or private key.</p>
      `, unsub),
    };
  },

  day7(ctx, unsub) {
    const watched = Number(ctx.watchedCount || 0);
    const line = watched > 0
      ? `<p>You are watching ${watched} token${watched === 1 ? '' : 's'}. We re-check ${watched === 1 ? 'it' : 'them'} every 12 hours on the free plan.</p>`
      : '<p>You are not watching any tokens yet — that is the one feature worth setting up, and it is free.</p>';
    return {
      subject: 'A week with KHAN Trust',
      html: shell(`
        <p>It has been about a week since you signed up.</p>
        ${line}
        <p>If KHAN Trust has not been useful yet, replying to this email works — it reaches a person, and specific criticism is more useful to us than none.</p>
        ${button(APP_URL, 'Open KHAN Trust')}
      `, unsub),
    };
  },

  // DO NOT re-add "and Telegram" to the delivery line. The Telegram channel is
  // built but deliberately unshipped (parked on wip/telegram-enrollment), so
  // nothing writes a chat id and no Premium user can receive a Telegram alert.
  // Naming a channel that cannot deliver is exactly the kind of claim this file
  // exists to prevent — and it would be charged for.
  premiumOffer(ctx, unsub) {
    const watched = Number(ctx.watchedCount || 0);
    return {
      subject: 'Faster warnings on the tokens you watch',
      html: shell(`
        <p>You are watching ${watched} token${watched === 1 ? '' : 's'}, and on the free plan we re-check ${watched === 1 ? 'it' : 'them'} every 12 hours.</p>
        <p>For most tokens that is fine. For anything moving quickly, twelve hours is the difference between a warning and a post-mortem.</p>
        <p>Premium re-checks every 30 minutes, emails you the moment something moves, and raises the limit from 5 tokens to 100. It also removes the daily scan cap and unlocks the full analysis and export tools.</p>
        ${button(`${APP_URL}/#/pricing`, 'See Premium')}
        <p style="color:#666;font-size:14px">Cancel any time. The free scanner stays free either way.</p>
      `, unsub),
    };
  },

  nothingChanged(ctx, unsub) {
    const watched = Number(ctx.watchedCount || 0);
    return {
      subject: `No risk changes on your ${watched} watched token${watched === 1 ? '' : 's'}`,
      html: shell(`
        <p>We re-checked the ${watched} token${watched === 1 ? '' : 's'} you are watching this week. Nothing crossed a risk threshold — no liquidity drain, no authority change, no holder-base collapse.</p>
        <p>That is the intended result. The point of watching is that quiet weeks stay quiet and you only hear from us when something actually moves.</p>
        ${button(`${APP_URL}/#/watchlist`, 'View my watchlist')}
      `, unsub),
    };
  },
};

export function buildLifecycleEmail(stageId, ctx, token) {
  const builder = BUILDERS[stageId];
  if (!builder) return null;
  return builder(ctx, unsubscribeUrl(token));
}

export const TEMPLATE_IDS = Object.keys(BUILDERS);
