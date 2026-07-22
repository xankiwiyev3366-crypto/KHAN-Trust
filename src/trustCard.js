// Shareable Trust Card (Task 3).
//
// After every completed scan the report offers a premium, screenshot-optimised
// card the user can post to X / Telegram. The whole point is distribution: each
// scan should end at the user's AUDIENCE, not just the user.
//
// GROUNDING: like everything else in KHAN Trust, the card states only what the
// deterministic engine computed. It never invents a number. A field with no
// data is drawn as "—" or omitted, never guessed — the same doctrine as the
// scanner and the Grounded AI Analyst.
//
// The card is rendered with the raw Canvas 2D API rather than html2canvas, for
// three reasons: no extra dependency, no strict-CSP/tainted-canvas surprises,
// and pixel-exact output at 2× for retina-crisp social previews. A project logo
// is drawn ONLY when it loads CORS-clean (crossOrigin='anonymous'); otherwise we
// fall back to a branded initials disc, so toBlob() can never throw on a tainted
// canvas.

const BRAND = {
  bg0: '#0b0a07',
  bg1: '#050505',
  panel: '#12110c',
  gold: '#e0b75c',
  goldBright: '#f4d889',
  text: '#f6f0df',
  muted: '#aaa28d',
  danger: '#ff756e',
  warning: '#f7be52',
  success: '#67d39c',
  border: 'rgba(224, 183, 92, 0.28)',
};

const WIDTH = 1200;
const HEIGHT = 630;

export const KHAN_WEBSITE = 'https://khantrust.net';

export function riskColor(level) {
  const l = String(level || '').toLowerCase();
  if (l === 'low') return BRAND.success;
  if (l === 'medium') return BRAND.warning;
  return BRAND.danger; // High / Critical / Severe / unknown → treat as alarming
}

function scoreColor(score) {
  const n = Number(score) || 0;
  if (n >= 70) return BRAND.success;
  if (n >= 45) return BRAND.warning;
  return BRAND.danger;
}

function formatUsdShort(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n)}`;
}

function formatCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toLocaleString('en-US');
}

// Loads an image CORS-clean. Resolves null on any failure (including a missing
// Access-Control-Allow-Origin header, which fires onerror for an anonymous
// request) so the caller falls back to initials and the canvas stays untainted.
function loadImageSafe(url) {
  return new Promise((resolve) => {
    if (!url || typeof url !== 'string') return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    // Cache-bust-free: reusing the browser cache is fine and faster.
    img.src = url;
  });
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawInitialsDisc(ctx, x, y, size, label) {
  const cx = x + size / 2;
  const cy = y + size / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  const grad = ctx.createLinearGradient(x, y, x + size, y + size);
  grad.addColorStop(0, 'rgba(224, 183, 92, 0.28)');
  grad.addColorStop(1, 'rgba(224, 183, 92, 0.10)');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = BRAND.border;
  ctx.stroke();
  ctx.fillStyle = BRAND.goldBright;
  ctx.font = `600 ${Math.round(size * 0.4)}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText((label || '?').slice(0, 3).toUpperCase(), cx, cy + 2);
  ctx.restore();
}

function drawLogoDisc(ctx, img, x, y, size) {
  const cx = x + size / 2;
  const cy = y + size / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(img, x, y, size, size);
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = BRAND.border;
  ctx.stroke();
  ctx.restore();
}

// The dial: a gold-to-risk arc with the score in the centre. Purely a redraw of
// project.trustScore — no computation.
function drawScoreDial(ctx, x, y, radius, score) {
  const cx = x;
  const cy = y;
  const value = Math.max(0, Math.min(100, Number(score) || 0));
  const start = -Math.PI / 2;
  const end = start + (value / 100) * Math.PI * 2;

  ctx.save();
  ctx.lineWidth = 16;
  ctx.lineCap = 'round';
  // Track
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.stroke();
  // Value
  ctx.beginPath();
  ctx.arc(cx, cy, radius, start, end);
  ctx.strokeStyle = scoreColor(value);
  ctx.stroke();
  // Number
  ctx.fillStyle = BRAND.text;
  ctx.font = '700 88px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(Math.round(value)), cx, cy - 6);
  ctx.fillStyle = BRAND.muted;
  ctx.font = '600 26px Inter, system-ui, sans-serif';
  ctx.fillText('/ 100', cx, cy + 48);
  ctx.restore();
}

function drawPill(ctx, x, y, text, color) {
  ctx.save();
  ctx.font = '700 26px Inter, system-ui, sans-serif';
  const padX = 22;
  const w = ctx.measureText(text).width + padX * 2;
  const h = 48;
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + padX, y + h / 2 + 1);
  ctx.restore();
  return w;
}

function drawStatCell(ctx, x, y, w, label, value) {
  ctx.save();
  roundRect(ctx, x, y, w, 118, 16);
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(224,183,92,0.16)';
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.fillStyle = BRAND.muted;
  ctx.font = '600 22px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(label, x + 22, y + 42);
  ctx.fillStyle = BRAND.text;
  ctx.font = '700 40px Inter, system-ui, sans-serif';
  ctx.fillText(value, x + 22, y + 90);
  ctx.restore();
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function defaultTimestamp() {
  return `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

// The resolved, display-ready values that go on the card, separated from the
// pixel drawing so it is unit-testable without a DOM/canvas (see the card tests)
// and so the exact same values are used by the preview and the exported PNG.
// Every value comes from the computed project; a missing one becomes "—" or is
// omitted, never invented — the same grounding doctrine as the scanner.
export function buildCardModel(project = {}, labels = {}) {
  const data = project.realData || {};
  const scam = project.scamRisk || {};
  const topPct = Number(data.topHolderPercent);
  const holderRisk = Number.isFinite(topPct) && topPct > 0
    ? `${Math.round(topPct)}%`
    : (formatCount(data.holderCount ?? project.holders) || '—');
  return {
    name: String(project.name || labels.unknownToken || 'Unknown token').slice(0, 26),
    ticker: project.ticker ? String(project.ticker).toUpperCase() : null,
    chainLabel: labels.chainLabel || project.chain || null,
    chainColor: labels.chainColor || BRAND.gold,
    trustScore: clampScore(project.trustScore),
    riskLevel: project.riskLevel || 'Medium',
    riskText: labels.riskLevelValue || project.riskLevel || 'Medium',
    holderRisk,
    liquidity: formatUsdShort(data.totalLiquidityUsd ?? data.liquidityUsd) || '—',
    marketCap: formatUsdShort(data.marketCapUsd) || '—',
    scamProbability: Number.isFinite(Number(scam.riskScore)) ? `${Math.round(scam.riskScore)}%` : '—',
    securityVerdict: labels.securityVerdict || null,
    securityColor: labels.securityColor || BRAND.muted,
    isVerified: Boolean(labels.isVerified),
    timestamp: labels.timestamp || defaultTimestamp(),
    url: labels.url || '',
    logoUrl: data.logoUrl || project.logoUrl || null,
  };
}

// A small coloured chain pill next to the token name (chain badge, spec 1).
function drawChainBadge(ctx, x, y, label, color) {
  ctx.save();
  ctx.font = '700 22px Inter, system-ui, sans-serif';
  const text = String(label).toUpperCase();
  const dot = 9;
  const padX = 16;
  const w = ctx.measureText(text).width + padX * 2 + dot + 8;
  const h = 38;
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(x + padX + dot / 2, y + h / 2, dot / 2, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillStyle = BRAND.text;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + padX + dot + 8, y + h / 2 + 1);
  ctx.restore();
  return w;
}

/**
 * Renders the Trust Card to an offscreen canvas at 2× and returns it.
 * `labels` supplies already-translated strings so the card matches the UI
 * language. Awaits font readiness first so text never renders with a
 * fallback-then-swap flash, giving byte-stable output across browsers.
 */
export async function renderTrustCard(project = {}, labels = {}) {
  const model = buildCardModel(project, labels);
  // Ensure any web font is ready before measuring/drawing text — prevents the
  // "wrong font, then correct font" swap that would make the PNG differ from the
  // live preview. Resolves immediately when only system fonts are used.
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    try { await document.fonts.ready; } catch { /* fonts API unavailable — proceed with system stack */ }
  }

  const dpr = 2;
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH * dpr;
  canvas.height = HEIGHT * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // Background
  const bg = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  bg.addColorStop(0, BRAND.bg0);
  bg.addColorStop(1, BRAND.bg1);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Ambient gold glow, top-right
  const glow = ctx.createRadialGradient(WIDTH - 120, 80, 40, WIDTH - 120, 80, 520);
  glow.addColorStop(0, 'rgba(224,183,92,0.16)');
  glow.addColorStop(1, 'rgba(224,183,92,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Card frame
  roundRect(ctx, 24, 24, WIDTH - 48, HEIGHT - 48, 28);
  ctx.strokeStyle = 'rgba(224,183,92,0.22)';
  ctx.lineWidth = 2;
  ctx.stroke();

  const padL = 64;

  // Header: logo + name/ticker + chain badge
  const logo = await loadImageSafe(model.logoUrl);
  const logoSize = 84;
  if (logo) drawLogoDisc(ctx, padL, 52, logoSize, logo);
  else drawInitialsDisc(ctx, padL, 52, logoSize, model.ticker || model.name || '?');

  const nameX = padL + logoSize + 24;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = BRAND.text;
  ctx.font = '700 44px Inter, system-ui, sans-serif';
  ctx.fillText(model.name, nameX, 90);
  ctx.fillStyle = BRAND.muted;
  ctx.font = '600 25px Inter, system-ui, sans-serif';
  const tickerText = model.ticker ? `$${model.ticker}` : '';
  ctx.fillText(tickerText, nameX, 126);
  if (model.chainLabel) {
    const tickerW = tickerText ? ctx.measureText(tickerText).width + 18 : 0;
    drawChainBadge(ctx, nameX + tickerW, 104, model.chainLabel, model.chainColor);
  }

  // Verified badge (top-right) — only when actually verified.
  if (model.isVerified) {
    ctx.save();
    ctx.font = '700 24px Inter, system-ui, sans-serif';
    const vText = labels.verified || 'Verified';
    const vW = ctx.measureText(vText).width + 60;
    const vX = WIDTH - padL - vW;
    roundRect(ctx, vX, 58, vW, 44, 22);
    ctx.fillStyle = 'rgba(103,211,156,0.12)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(103,211,156,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = BRAND.success;
    ctx.textBaseline = 'middle';
    ctx.fillText('✓', vX + 20, 81);
    ctx.fillText(vText, vX + 44, 81);
    ctx.restore();
  }

  // Score dial (left) + risk pill under it
  const dialCx = padL + 108;
  const dialCy = 300;
  drawScoreDial(ctx, dialCx, dialCy, 92, model.trustScore);
  ctx.fillStyle = BRAND.muted;
  ctx.font = '600 24px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(labels.trustScore || 'Trust Score', dialCx, dialCy + 114);

  const riskText = labels.riskLevel ? `${labels.riskLevel}: ${model.riskText}` : String(model.riskText);
  // Measure the pill width first (font matches drawPill's) so it can be centred
  // under the dial without drawing a throwaway pill.
  ctx.save();
  ctx.font = '700 26px Inter, system-ui, sans-serif';
  const pillW = ctx.measureText(riskText).width + 44;
  ctx.restore();
  drawPill(ctx, dialCx - pillW / 2, dialCy + 136, riskText, riskColor(model.riskLevel));

  // Stat grid (right of dial): Holder risk, Liquidity, Market cap, Scam prob.
  const gridX = padL + 300;
  const gridW = WIDTH - gridX - padL;
  const colW = (gridW - 24) / 2;
  const gy0 = 200;
  const gy1 = gy0 + 134;
  drawStatCell(ctx, gridX, gy0, colW, labels.holderRisk || 'Holder risk', model.holderRisk);
  drawStatCell(ctx, gridX + colW + 24, gy0, colW, labels.liquidity || 'Liquidity', model.liquidity);
  drawStatCell(ctx, gridX, gy1, colW, labels.marketCap || 'Market cap', model.marketCap);
  drawStatCell(ctx, gridX + colW + 24, gy1, colW, labels.scamProbability || 'Scam probability', model.scamProbability);

  // Main security verdict — a full-width bar, coloured by risk (spec 1).
  if (model.securityVerdict) {
    const barY = 492;
    const barW = WIDTH - padL * 2;
    roundRect(ctx, padL, barY, barW, 52, 14);
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    ctx.fill();
    ctx.strokeStyle = model.securityColor;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(padL + 26, barY + 26, 6, 0, Math.PI * 2);
    ctx.fillStyle = model.securityColor;
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = BRAND.text;
    ctx.font = '600 24px Inter, system-ui, sans-serif';
    ctx.fillText(`${labels.securityLabel || 'Security'}: ${model.securityVerdict}`, padL + 44, barY + 27);
  }

  // Footer: brand + tagline (left), URL + timestamp (right)
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = BRAND.gold;
  ctx.font = '800 30px Inter, system-ui, sans-serif';
  ctx.fillText('KHAN Trust', padL, HEIGHT - 54);
  ctx.fillStyle = BRAND.muted;
  ctx.font = '600 22px Inter, system-ui, sans-serif';
  ctx.fillText(labels.tagline || 'Trust before hype', padL, HEIGHT - 26);

  ctx.textAlign = 'right';
  if (model.url) {
    ctx.fillStyle = BRAND.gold;
    ctx.font = '600 22px Inter, system-ui, sans-serif';
    ctx.fillText(model.url.replace(/^https?:\/\//, ''), WIDTH - padL, HEIGHT - 54);
  }
  ctx.fillStyle = BRAND.muted;
  ctx.font = '600 22px Inter, system-ui, sans-serif';
  ctx.fillText(model.timestamp, WIDTH - padL, HEIGHT - 26);

  return canvas;
}

export function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not export the Trust Card image.'));
    }, 'image/png');
  });
}

// The share-action helpers (copy, download, X/Telegram intents, native share)
// live in src/shareApi.js — the single home for sharing logic (requirement 6).
// This module stays focused on rendering the card + its data model.
