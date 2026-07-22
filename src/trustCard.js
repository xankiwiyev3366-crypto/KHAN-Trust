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

// The public token page — the best share target because it renders an OG
// preview and an "Open live report" CTA. Falls back to the site root when the
// project has no usable contract.
export function trustCardShareUrl(project = {}) {
  const contract = project.contract;
  const hasContract = contract && !['Not provided', 'Not available', 'Missing'].includes(contract);
  return hasContract
    ? `${KHAN_WEBSITE}/token/${encodeURIComponent(contract)}`
    : KHAN_WEBSITE;
}

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

/**
 * Renders the Trust Card to an offscreen canvas at 2× and returns it.
 * `labels` supplies already-translated strings so the card matches the UI
 * language. Every value comes from the computed project; nothing is invented.
 */
export async function renderTrustCard(project = {}, labels = {}) {
  const data = project.realData || {};
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

  // Header: logo + name/ticker
  const logo = await loadImageSafe(data.logoUrl);
  const logoSize = 84;
  if (logo) drawLogoDisc(ctx, padL, 60, logoSize, logo);
  else drawInitialsDisc(ctx, padL, 60, logoSize, project.ticker || project.name || '?');

  const nameX = padL + logoSize + 24;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = BRAND.text;
  ctx.font = '700 46px Inter, system-ui, sans-serif';
  const name = String(project.name || 'Unknown token').slice(0, 26);
  ctx.fillText(name, nameX, 98);
  ctx.fillStyle = BRAND.muted;
  ctx.font = '600 26px Inter, system-ui, sans-serif';
  const sub = [project.ticker ? `$${project.ticker}` : null, project.chain].filter(Boolean).join('  ·  ');
  ctx.fillText(sub, nameX, 134);

  // Verified badge (top-right) — only when actually verified.
  if (labels.isVerified) {
    ctx.save();
    ctx.font = '700 24px Inter, system-ui, sans-serif';
    const vText = labels.verified || 'Verified';
    const vW = ctx.measureText(vText).width + 60;
    const vX = WIDTH - padL - vW;
    roundRect(ctx, vX, 66, vW, 44, 22);
    ctx.fillStyle = 'rgba(103,211,156,0.12)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(103,211,156,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = BRAND.success;
    ctx.textBaseline = 'middle';
    ctx.fillText('✓', vX + 20, 89);
    ctx.fillText(vText, vX + 44, 89);
    ctx.restore();
  }

  // Score dial (left) + risk pill under it
  const dialCx = padL + 110;
  const dialCy = 330;
  drawScoreDial(ctx, dialCx, dialCy, 96, project.trustScore);
  ctx.fillStyle = BRAND.muted;
  ctx.font = '600 24px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(labels.trustScore || 'Trust Score', dialCx, dialCy + 118);

  const riskLevel = project.riskLevel || 'Medium';
  const riskText = labels.riskLevel ? `${labels.riskLevel}: ${labels.riskLevelValue || riskLevel}` : String(riskLevel);
  drawPill(ctx, dialCx - 96, dialCy + 140, riskText, riskColor(riskLevel));

  // Stat grid (right of dial): Scam Probability, Liquidity, Holders, Verified
  const gridX = padL + 300;
  const gridW = WIDTH - gridX - padL;
  const colW = (gridW - 24) / 2;
  const scam = project.scamRisk || {};
  const scamPct = Number.isFinite(Number(scam.riskScore)) ? `${Math.round(scam.riskScore)}%` : '—';
  const liq = formatUsdShort(data.totalLiquidityUsd ?? data.liquidityUsd) || '—';
  const holders = formatCount(data.holderCount ?? project.holders) || '—';
  const verifiedVal = labels.isVerified ? (labels.verified || 'Verified') : (labels.unverified || 'Unverified');

  const gy0 = 246;
  const gy1 = gy0 + 134;
  drawStatCell(ctx, gridX, gy0, colW, labels.scamProbability || 'Scam Probability', scamPct);
  drawStatCell(ctx, gridX + colW + 24, gy0, colW, labels.liquidity || 'Liquidity', liq);
  drawStatCell(ctx, gridX, gy1, colW, labels.holders || 'Holders', holders);
  drawStatCell(ctx, gridX + colW + 24, gy1, colW, labels.verifiedStatus || 'Status', verifiedVal);

  // Footer: brand + tagline (left), timestamp (right)
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = BRAND.gold;
  ctx.font = '800 30px Inter, system-ui, sans-serif';
  ctx.fillText('KHAN Trust', padL, HEIGHT - 56);
  ctx.fillStyle = BRAND.muted;
  ctx.font = '600 22px Inter, system-ui, sans-serif';
  ctx.fillText(labels.tagline || 'Trust before hype', padL, HEIGHT - 28);

  const ts = labels.timestamp || new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  ctx.textAlign = 'right';
  ctx.fillStyle = BRAND.muted;
  ctx.font = '600 22px Inter, system-ui, sans-serif';
  ctx.fillText(ts, WIDTH - padL, HEIGHT - 28);

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

export function downloadCanvas(canvas, filename) {
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'khan-trust-card.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function xShareUrl(text, url) {
  const params = new URLSearchParams({ text, url });
  return `https://twitter.com/intent/tweet?${params.toString()}`;
}

export function telegramShareUrl(text, url) {
  const params = new URLSearchParams({ url, text });
  return `https://t.me/share/url?${params.toString()}`;
}
