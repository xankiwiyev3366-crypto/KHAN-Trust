/*!
 * KHAN Trust verification badge widget.
 * https://khantrust.net  —  embed docs: https://khantrust.net/#/verify
 *
 * <script src="https://khantrust.net/badge.js" async></script>
 * <div data-khan-badge data-contract="<address>" data-chain="solana"></div>
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS SCRIPT IS NOT ALLOWED TO DO, AND WHY THAT IS THE ENTIRE DESIGN
 *
 * It runs on websites KHAN Trust does not control, owned by the very people
 * whose projects it makes claims about. So the embedding page is treated as
 * untrusted input, not as a host:
 *
 *   - The STATE is never read from the page. There is no data-state,
 *     data-verified or data-score attribute, and adding one would end the
 *     product — a badge whose host page can set what it says is a badge that
 *     says whatever that page wants. The only thing the page supplies is which
 *     token to ask about; the answer comes from the server, every time.
 *   - Nothing from the page or the network is ever assigned to innerHTML. The
 *     badge is built from createElement/textContent, so a contract address
 *     containing markup renders as characters, not as elements.
 *   - The link target is validated to be an https URL on the origin this
 *     script was loaded from, before it is used. Defence in depth: if a
 *     response were ever tampered with, a javascript: URL is the payload it
 *     would carry.
 *   - Rendering happens inside a Shadow DOM, so the host page's CSS cannot
 *     restyle the badge into saying something it does not, and the badge's CSS
 *     cannot leak into the host page.
 *
 * No cookies, no storage, no tracking, no third-party requests, no secrets.
 * One GET to one public endpoint.
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  // Where to ask. Derived from this script's own src so a self-hosted or
  // preview deployment talks to itself rather than to production — and so the
  // origin is never something the embedding page can point elsewhere.
  var ORIGIN = (function () {
    try {
      var self = document.currentScript;
      if (!self) {
        var all = document.getElementsByTagName('script');
        for (var i = all.length - 1; i >= 0; i--) {
          if (all[i].src && all[i].src.indexOf('badge.js') !== -1) { self = all[i]; break; }
        }
      }
      if (self && self.src) return new URL(self.src, window.location.href).origin;
    } catch (e) { /* fall through */ }
    return 'https://khantrust.net';
  })();

  // The five states, their wording, and their colours.
  //
  // This table is a SECOND copy of the vocabulary in
  // netlify/functions/_badgeState.mjs — unavoidable, because this file is
  // served verbatim to third-party pages and cannot import from the build.
  // tests/badgeWidget.test.mjs asserts the two stay in step rather than
  // trusting that they will; an unknown state falls back to "Unverified",
  // so a server that learned a sixth state before this file did would
  // under-claim rather than render something meaningless.
  var STATES = {
    verified:   { text: 'Verified',   accent: '#2f9e5f', dot: '#2f9e5f' },
    unverified: { text: 'Unverified', accent: '#6b6b6b', dot: '#6b6b6b' },
    pending:    { text: 'Pending',    accent: '#a8891f', dot: '#a8891f' },
    expired:    { text: 'Expired',    accent: '#8a6a34', dot: '#8a6a34' },
    revoked:    { text: 'Revoked',    accent: '#c0453a', dot: '#c0453a' }
  };

  // Compact, readable on light AND dark host pages, and legible at the size a
  // footer actually uses. The default follows the host's colour scheme; a page
  // that knows better can force it with data-theme="light" / "dark".
  //
  // System font stack on purpose: a webfont would be a second network request
  // to a third party from someone else's site, which is not a cost this badge
  // gets to impose.
  var CSS = [
    ':host{all:initial;display:inline-block;max-width:100%}',
    '.k{',
      'display:inline-flex;align-items:center;gap:7px;',
      'box-sizing:border-box;max-width:100%;',
      'padding:6px 11px;border-radius:7px;',
      'border:1px solid rgba(0,0,0,.16);background:#fff;color:#12100b;',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;',
      'font-size:12.5px;line-height:1.35;font-weight:500;',
      'text-decoration:none;white-space:nowrap;',
    '}',
    '.k:hover{border-color:rgba(0,0,0,.32)}',
    // A visible focus ring is not optional: this is a link on someone else's
    // site and keyboard users must be able to see where they are.
    '.k:focus-visible{outline:2px solid #c9a227;outline-offset:2px}',
    '.d{width:7px;height:7px;border-radius:50%;flex:0 0 auto}',
    '.n{font-weight:650;letter-spacing:.01em}',
    '.s{opacity:.72;overflow:hidden;text-overflow:ellipsis}',
    '@media (prefers-color-scheme:dark){',
      '.k{background:#131210;color:#f4f1e8;border-color:rgba(255,255,255,.16)}',
      '.k:hover{border-color:rgba(255,255,255,.34)}',
    '}',
    ':host([data-theme="dark"]) .k{background:#131210;color:#f4f1e8;border-color:rgba(255,255,255,.16)}',
    ':host([data-theme="light"]) .k{background:#fff;color:#12100b;border-color:rgba(0,0,0,.16)}'
  ].join('');

  function safeUrl(candidate) {
    try {
      var url = new URL(String(candidate), ORIGIN);
      // Scheme allow-list, not a blocklist. Anything that is not plain http(s)
      // — javascript:, data:, blob: — is discarded rather than sanitised.
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
      if (url.origin !== ORIGIN) return null;
      return url.href;
    } catch (e) {
      return null;
    }
  }

  function render(host, state, profileUrl) {
    var presentation = STATES[state] || STATES.unverified;
    var root = host.shadowRoot || host.attachShadow({ mode: 'open' });
    while (root.firstChild) root.removeChild(root.firstChild);

    var style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);

    var href = safeUrl(profileUrl);
    // An anchor only when there is a real place to go. A link element with no
    // destination is a keyboard trap and a lie about being interactive.
    var box = document.createElement(href ? 'a' : 'span');
    box.setAttribute('class', 'k');
    if (href) {
      box.setAttribute('href', href);
      box.setAttribute('target', '_blank');
      // noopener is the security-relevant half (it denies the opened page a
      // handle on the opener); noreferrer is included because the embedding
      // site's URL is theirs, not ours to forward.
      box.setAttribute('rel', 'noopener noreferrer');
    }
    // One accessible name covering both halves, so a screen reader announces
    // "KHAN Trust: Verified" rather than two disconnected fragments.
    box.setAttribute('aria-label', 'KHAN Trust: ' + presentation.text);

    var dot = document.createElement('span');
    dot.setAttribute('class', 'd');
    dot.style.background = presentation.dot;
    // Decorative — the state is already in the text and the aria-label.
    dot.setAttribute('aria-hidden', 'true');

    var name = document.createElement('span');
    name.setAttribute('class', 'n');
    name.textContent = 'KHAN Trust';

    var status = document.createElement('span');
    status.setAttribute('class', 's');
    status.style.color = presentation.accent;
    // textContent, never innerHTML.
    status.textContent = presentation.text;

    box.appendChild(dot);
    box.appendChild(name);
    box.appendChild(status);
    root.appendChild(box);
    host.setAttribute('data-khan-badge-state', state);
  }

  function mount(host) {
    if (host.getAttribute('data-khan-badge-mounted') === '1') return;
    host.setAttribute('data-khan-badge-mounted', '1');

    var contract = (host.getAttribute('data-contract') || '').trim();
    var chain = (host.getAttribute('data-chain') || 'solana').trim();
    var projectId = (host.getAttribute('data-project-id') || '').trim();

    // Render the honest default immediately, before the network answers. The
    // badge must never flash "Verified" and settle into something else, so the
    // pre-answer state is the weakest one rather than the expected one.
    render(host, 'unverified', null);

    var query = [];
    if (contract) query.push('contract=' + encodeURIComponent(contract));
    if (chain) query.push('chain=' + encodeURIComponent(chain));
    if (projectId) query.push('projectId=' + encodeURIComponent(projectId));
    if (!query.length) return;

    // The documented public alias (netlify.toml), not the raw function path,
    // so this script asks for its status the same way any other integrator
    // would — and a broken alias fails here, in the code we test, rather than
    // only for someone following the docs.
    var endpoint = ORIGIN + '/badge-status?' + query.join('&');

    fetch(endpoint, { method: 'GET', credentials: 'omit', mode: 'cors' })
      .then(function (response) {
        // A non-2xx, or a 200 carrying something that is not JSON, is a
        // failure — not an empty success. Treating it as "no data" would leave
        // the badge sitting on its placeholder with no way to tell a real
        // unverified project from a broken request.
        if (!response.ok) throw new Error('badge status ' + response.status);
        return response.json();
      })
      .then(function (data) {
        var state = data && typeof data.state === 'string' ? data.state : 'unverified';
        // Server states are still checked against the local vocabulary. An
        // unrecognised value renders as Unverified rather than as itself.
        if (!Object.prototype.hasOwnProperty.call(STATES, state)) state = 'unverified';
        render(host, state, data && data.profileUrl);
      })
      .catch(function () {
        // Fail closed and stay quiet. The placeholder is already the correct
        // conservative answer, and a console error on a customer's production
        // site is not ours to write.
      });
  }

  function scan() {
    var nodes = document.querySelectorAll('[data-khan-badge]');
    for (var i = 0; i < nodes.length; i++) mount(nodes[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scan);
  } else {
    scan();
  }

  // Re-scan for badges added after load (SPAs, CMS previews, lazy sections).
  // mount() is idempotent, so a re-scan cannot double-render or re-request.
  if (typeof MutationObserver === 'function') {
    new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  }

  // A deliberately tiny surface for pages that build their own markup. It
  // mounts an element — it cannot set a state, which is the same rule the
  // attributes follow.
  window.KhanTrustBadge = { mount: mount, refresh: scan };
})();
