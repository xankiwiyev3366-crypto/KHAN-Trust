// Centralised sharing API (requirement 6).
//
// One home for every share action so the UI never re-implements URL encoding,
// clipboard fallbacks, or the native-share dance. Every function here is pure or
// side-effect-isolated and independently testable; the React component is a thin
// caller. Supports: Copy Link, Copy Text, Download, Share to X, Share to
// Telegram (+ native OS share with the image where available).
//
// Grounding note: these helpers only format and transport values the caller
// already computed. Nothing here reads or invents token data.

import { canvasToBlob, KHAN_WEBSITE } from './trustCard.js';

export { KHAN_WEBSITE };

// Default hashtags appended to the X post (optional, spec 4). Kept short and
// on-brand; the token ticker is added dynamically by buildShareText's caller.
export const DEFAULT_HASHTAGS = ['KHANTrust'];

// The canonical, shareable report URL for a token — the public /token/<contract>
// page (OG-previewable). Falls back to the site root when there is no usable
// contract, never to a broken or fabricated path.
export function reportShareUrl(project = {}) {
  const contract = project.contract;
  const usable = contract && !['Not provided', 'Not available', 'Missing'].includes(contract);
  return usable ? `${KHAN_WEBSITE}/token/${encodeURIComponent(contract)}` : KHAN_WEBSITE;
}

// The share sentence. Includes the token name and Trust Score (spec 4/5). The
// URL is passed separately to the intent so it is never double-encoded.
export function buildShareText({ name, score, template } = {}) {
  const safeName = String(name || 'this token').trim();
  const safeScore = Number.isFinite(Number(score)) ? Math.round(Number(score)) : null;
  if (template) {
    return template
      .replace('{{name}}', safeName)
      .replace('{{score}}', safeScore == null ? '—' : String(safeScore));
  }
  return safeScore == null
    ? `${safeName} — KHAN Trust risk report`
    : `${safeName} scored ${safeScore}/100 on KHAN Trust.`;
}

// X (Twitter) web intent. URLSearchParams encodes text, url and hashtags
// correctly (spec 4). Hashtags are comma-joined and stripped of leading '#'.
export function xIntentUrl({ text, url, hashtags } = {}) {
  const params = new URLSearchParams();
  if (text) params.set('text', text);
  if (url) params.set('url', url);
  const tags = (hashtags || [])
    .map((h) => String(h).replace(/^#/, '').trim())
    .filter(Boolean);
  if (tags.length) params.set('hashtags', tags.join(','));
  return `https://twitter.com/intent/tweet?${params.toString()}`;
}

// Telegram share intent — carries the report link and the share text (spec 5).
export function telegramIntentUrl({ text, url } = {}) {
  const params = new URLSearchParams();
  if (url) params.set('url', url);
  if (text) params.set('text', text);
  return `https://t.me/share/url?${params.toString()}`;
}

// Copies text to the clipboard with a graceful fallback for browsers/contexts
// where the async Clipboard API is unavailable or blocked (permission failure,
// insecure context, older browsers) — spec 3/7. Returns a structured result so
// the caller can toast success or a real failure, never a silent no-op.
export async function copyText(text) {
  const value = String(text ?? '');
  if (!value) return { ok: false, method: 'none' };

  // Preferred path: async Clipboard API (needs a secure context + permission).
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return { ok: true, method: 'clipboard' };
    } catch {
      // Fall through to the legacy path rather than failing outright.
    }
  }

  // Legacy fallback: a hidden textarea + execCommand('copy'). Works in insecure
  // contexts and older browsers where the async API throws.
  if (typeof document !== 'undefined' && document.queryCommandSupported) {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.top = '-9999px';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (ok) return { ok: true, method: 'execCommand' };
    } catch {
      // fall through
    }
  }

  return { ok: false, method: 'none' };
}

// Opens an external intent URL safely in a new tab.
export function openIntent(url) {
  if (typeof window === 'undefined' || !url) return null;
  return window.open(url, '_blank', 'noopener,noreferrer');
}

// Triggers a browser download of a Blob (spec 2). Object-URL is revoked after a
// tick so the download starts but memory is not leaked.
export function downloadBlob(blob, filename) {
  if (typeof document === 'undefined' || !blob) return false;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'download.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

// Exports the rendered card canvas to a high-resolution PNG download (spec 2).
export async function downloadCardPng(canvas, filename) {
  const blob = await canvasToBlob(canvas);
  return downloadBlob(blob, filename);
}

// Rough mobile detection — decides whether to prefer the OS share sheet (which
// can attach the image file) over opening a web intent. Not a security control.
export function isMobile() {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
}

// Native OS share of the card IMAGE plus text/url, where the platform supports
// sharing files (mostly mobile). Returns true when the share sheet handled it,
// false when the caller should fall back to a web intent. Never throws.
export async function shareCardImage({ canvas, text, url, filename } = {}) {
  if (typeof navigator === 'undefined' || !navigator.share || !canvas) return false;
  try {
    const blob = await canvasToBlob(canvas);
    const file = new File([blob], filename || 'khan-trust-card.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], text, url });
      return true;
    }
    await navigator.share({ text, url });
    return true;
  } catch {
    return false;
  }
}
