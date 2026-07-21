// KHAN AI — the platform's digital security-intelligence entity.
//
// Self-contained module (imports nothing from main.jsx, so there is no risk of
// a circular import): the entity mark, the scan console shown while a token
// lookup is in flight, and the calm empty/error panels built around it.
//
// Design constraints this file deliberately honours:
//  - Enterprise security analyst, not a mascot. Abstract aperture + shield,
//    no face, no expressions, no gestures.
//  - Black & gold only; every colour comes from the existing CSS custom
//    properties in styles.css rather than new hardcoded values.
//  - Glow is painted with radial gradients, never feGaussianBlur: SVG blur
//    filters re-rasterise each frame and are the main cause of dropped frames
//    on mobile Safari. Every animation drives only `transform` / `opacity` so
//    the work stays on the compositor.
//  - prefers-reduced-motion freezes all motion (see the .khan-ai rules in
//    styles.css); the entity stays fully legible when static.
//  - Purely decorative, so the SVG is aria-hidden and all meaning is carried
//    by the adjacent live-region text.
import React, { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from './i18n/I18nContext.jsx';

// Geometry for a pointy-top hexagon centred at (60,60) in a 120x120 viewBox.
// Precomputed rather than derived at runtime - it never changes, and this
// keeps the render path free of trigonometry.
const SHIELD_OUTER = '60 16 98.1 38 98.1 82 60 104 21.9 82 21.9 38';
const SHIELD_INNER = '60 26 89.4 43 89.4 77 60 94 30.6 77 30.6 43';

// Orbiting data particles: angle (deg) + radius, spread so they never bunch up.
const PARTICLES = [
  { angle: 12, radius: 52 },
  { angle: 78, radius: 46 },
  { angle: 145, radius: 54 },
  { angle: 208, radius: 44 },
  { angle: 272, radius: 51 },
  { angle: 330, radius: 47 },
];

function particlePoint({ angle, radius }) {
  const rad = (angle * Math.PI) / 180;
  return { cx: 60 + radius * Math.cos(rad), cy: 60 + radius * Math.sin(rad) };
}

/**
 * The KHAN AI entity mark.
 *
 * state: 'idle'      - slow breathing pulse, resting watch
 *        'analyzing' - faster pulse + aperture scan sweep + live data ring
 *        'complete'  - one-shot confirmation glow, then settles to idle
 *        'error'     - dimmed, motion stilled, aperture narrowed
 * size:  'sm' | 'md' | 'lg'
 */
function KhanAiEntity({ state = 'idle', size = 'md', className = '' }) {
  // Gradient ids must be unique per instance: several entities can be mounted
  // at once (hero + score card), and duplicate ids would cross-wire their fills.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const coreGlow = `khanAiCore-${uid}`;
  const iris = `khanAiIris-${uid}`;
  const edge = `khanAiEdge-${uid}`;
  const clip = `khanAiClip-${uid}`;

  return (
    <div className={`khan-ai khan-ai--${size} is-${state} ${className}`.trim()} aria-hidden="true">
      <svg viewBox="0 0 120 120" role="presentation" focusable="false">
        <defs>
          {/* Ambient core glow. A radial gradient is ~free to composite; an
              feGaussianBlur of the same radius is not. */}
          <radialGradient id={coreGlow} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--gold-bright)" stopOpacity="0.5" />
            <stop offset="45%" stopColor="var(--gold)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--gold)" stopOpacity="0" />
          </radialGradient>

          <radialGradient id={iris} cx="50%" cy="45%" r="60%">
            <stop offset="0%" stopColor="#fff8e6" stopOpacity="0.95" />
            <stop offset="35%" stopColor="var(--gold-bright)" stopOpacity="0.85" />
            <stop offset="100%" stopColor="var(--gold)" stopOpacity="0.35" />
          </radialGradient>

          {/* Holographic edge: brighter at the top, fading down the shield. */}
          <linearGradient id={edge} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="var(--gold-bright)" stopOpacity="0.9" />
            <stop offset="55%" stopColor="var(--gold)" stopOpacity="0.55" />
            <stop offset="100%" stopColor="var(--gold)" stopOpacity="0.25" />
          </linearGradient>

          <clipPath id={clip}>
            <polygon points={SHIELD_INNER} />
          </clipPath>
        </defs>

        {/* Counter-rotating data rings. Dashed strokes read as telemetry
            without needing per-dash elements. */}
        <g className="khan-ai-rings">
          <circle className="khan-ai-ring khan-ai-ring--outer" cx="60" cy="60" r="55" />
          <circle className="khan-ai-ring khan-ai-ring--inner" cx="60" cy="60" r="49" />
        </g>

        {/* Orbiting gold particles - one rotating group, so the browser
            animates a single transform rather than six. */}
        <g className="khan-ai-particles">
          {PARTICLES.map((particle, index) => {
            const { cx, cy } = particlePoint(particle);
            return <circle key={index} className="khan-ai-particle" cx={cx} cy={cy} r={index % 2 ? 1.1 : 1.6} />;
          })}
        </g>

        <polygon className="khan-ai-shield" points={SHIELD_OUTER} stroke={`url(#${edge})`} />
        {/* Dedicated fill layer for the 'complete' confirmation. Flashing this
            element's opacity keeps the animation on the compositor; animating
            the shield's own `fill` would repaint it every frame instead. */}
        <polygon className="khan-ai-shield-flash" points={SHIELD_OUTER} />
        <polygon className="khan-ai-shield-inner" points={SHIELD_INNER} />

        {/* Aperture: glow -> vesica lens -> iris -> pupil. Abstract on purpose;
            an eye communicates watchfulness where a face would communicate
            personality. */}
        <g className="khan-ai-core" clipPath={`url(#${clip})`}>
          <circle className="khan-ai-core-glow" cx="60" cy="60" r="34" fill={`url(#${coreGlow})`} />
          <path className="khan-ai-lens" d="M60 42 Q78 60 60 78 Q42 60 60 42 Z" />
          <circle className="khan-ai-iris" cx="60" cy="60" r="7.5" fill={`url(#${iris})`} />
          <circle className="khan-ai-pupil" cx="60" cy="60" r="2.6" />
          {/* Scan sweep: only visible while analyzing. */}
          <rect className="khan-ai-scanline" x="24" y="0" width="72" height="2.5" />
        </g>
      </svg>
    </div>
  );
}

// The scan pipeline, in the order it is presented. Every stage is backed by
// real network or scoring work in main.jsx's lookup layer (see the taps in
// lookupSolanaTokenUncached / lookupGenericChainTokenUncached /
// lookupNativeCoinGeckoAsset and runTrustEngine). Nothing here is on a timer:
// a stage only ever completes because the promises behind it settled.
const SCAN_STAGES = ['connect', 'liquidity', 'contract', 'holders', 'engine', 'score', 'finalize'];

/**
 * Telemetry sink the lookup layer writes real completions into.
 *
 * `complete(stage)` - that stage's real work finished.
 * `skip(stage)`     - this lookup path genuinely does not perform that work
 *                     (a native coin has no contract to verify), so it is shown
 *                     as skipped rather than as a passing check.
 * `completeAll()`   - a cache hit did no network work at all; replaying the
 *                     animation would be theatre.
 */
export function createScanReporter(onChange) {
  const done = new Set();
  const skipped = new Set();
  const emit = () => onChange({ done: new Set(done), skipped: new Set(skipped) });
  return {
    complete(stage) { if (!done.has(stage)) { done.add(stage); emit(); } },
    skip(stage) { if (!skipped.has(stage)) { skipped.add(stage); emit(); } },
    completeAll() { SCAN_STAGES.forEach((stage) => done.add(stage)); emit(); },
  };
}

/**
 * Inline scan console shown while a lookup runs.
 *
 * Deliberately inline rather than an overlay: it must never cover buttons,
 * block scrolling, or interrupt what the user is doing.
 *
 * Ordering: the underlying providers resolve in parallel and in nondeterministic
 * order, so a later stage's fetch can genuinely settle before an earlier one's.
 * Rather than reorder the list (which would read as chaos) or fake a sequence
 * (which would lie), a stage is only shown as finished once its own work AND
 * every stage above it has settled. The list therefore reads top-to-bottom and
 * still never runs a single millisecond ahead of the backend.
 */
export function KhanAiScanConsole({ active, progress, error = null }) {
  const { t } = useTranslation();

  if (!active && !error) return null;

  const state = error ? 'error' : 'analyzing';
  const done = progress?.done || new Set();
  const skipped = progress?.skipped || new Set();
  const settled = (key) => done.has(key) || skipped.has(key);

  let cursor = SCAN_STAGES.findIndex((key) => !settled(key));
  if (cursor === -1) cursor = SCAN_STAGES.length;

  const stageClass = (key, index) => {
    if (index > cursor) return 'is-pending';
    if (index === cursor) return 'is-active';
    return skipped.has(key) ? 'is-skipped' : 'is-done';
  };

  return (
    <div className={`khan-ai-console is-${state}`}>
      <KhanAiEntity state={state} size="sm" />
      <div className="khan-ai-console-body">
        <p className="khan-ai-console-label">
          <span className="khan-ai-console-name">{t('khanAi.name')}</span>
          <span className="khan-ai-console-status">
            {error ? t('khanAi.console.halted') : t('khanAi.console.initializing')}
          </span>
        </p>

        {error ? (
          <p className="khan-ai-console-error" role="status">{error}</p>
        ) : (
          <ul className="khan-ai-stages" role="status" aria-live="polite">
            {SCAN_STAGES.map((key, index) => (
              <li key={key} className={`khan-ai-stage ${stageClass(key, index)}`}>
                <span className="khan-ai-stage-dot" aria-hidden="true" />
                <span className="khan-ai-stage-text">{t(`khanAi.stages.${key}`)}</span>
                {skipped.has(key) && index < cursor && (
                  <span className="khan-ai-stage-note">{t('khanAi.stages.notApplicable')}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Homepage hero lockup: the entity standing beside the headline, with a live
 * status line underneath. Wraps the existing eyebrow + h1 (passed as children)
 * rather than replacing them, so the established wordmark is untouched and the
 * entity reads as part of the same mark.
 *
 * Idle breathing only - the hero must stay calm.
 */
export function KhanAiHeroMark({ children, title }) {
  const { t } = useTranslation();
  return (
    <div className="khan-ai-hero-mark">
      <KhanAiEntity state="idle" size="lg" />
      <div className="khan-ai-hero-copy">
        {children}
        {/* Living metal. The sweep is painted by a duplicate of the title
            clipped to the glyphs (data-text), so the highlight follows the
            letterforms like light across polished titanium rather than sliding
            a bar over a box. `title` must be plain text for that duplicate to
            match. */}
        {title && <h1 className="khan-living-metal" data-text={title}>{title}</h1>}
        <p className="khan-ai-hero-status">
          <span className="khan-ai-online-dot" aria-hidden="true" />
          <span className="khan-ai-hero-name">{t('khanAi.name')}</span>
          <span className="khan-ai-hero-state">{t('khanAi.hero.status')}</span>
        </p>
      </div>
    </div>
  );
}

/**
 * One elegant confirmation pulse for the Trust Score reveal, then calm. Only
 * pulses when the card was actually reached by a completed scan; otherwise it
 * mounts idle. Enterprise software confirms, it does not celebrate - so this
 * fires once and settles to 'idle' rather than looping.
 */
export function KhanAiVerdictMark({ revealed = false }) {
  const { t } = useTranslation();
  const [state, setState] = useState(revealed ? 'complete' : 'idle');
  const timer = useRef(null);

  useEffect(() => {
    if (!revealed) return undefined;
    timer.current = setTimeout(() => setState('idle'), 1600);
    return () => clearTimeout(timer.current);
  }, [revealed]);

  return (
    <div className="khan-ai-verdict">
      <KhanAiEntity state={state} size="sm" />
      <span className="khan-ai-verdict-text">{t('khanAi.verdict.analyzed')}</span>
    </div>
  );
}

// Blockchain node network: a fixed, hand-placed graph. Deliberately not random
// per render - a stable topology reads as infrastructure, whereas re-rolled
// noise reads as decoration. Coordinates are in a 1200x800 viewBox.
const NET_NODES = [
  [90, 120], [260, 68], [430, 150], [610, 90], [780, 170], [950, 110], [1120, 190],
  [150, 330], [340, 280], [520, 360], [700, 300], [880, 380], [1060, 320],
  [70, 560], [250, 620], [440, 540], [620, 640], [800, 560], [980, 650], [1140, 540],
];

// Only short-span edges are drawn, so the graph reads as a mesh rather than a
// starburst. Precomputed at module load, never per frame.
const NET_EDGES = (() => {
  const edges = [];
  for (let i = 0; i < NET_NODES.length; i++) {
    for (let j = i + 1; j < NET_NODES.length; j++) {
      const [ax, ay] = NET_NODES[i];
      const [bx, by] = NET_NODES[j];
      if (Math.hypot(bx - ax, by - ay) < 240) edges.push([ax, ay, bx, by]);
    }
  }
  return edges;
})();

// Light packets: a handful of edges carry a faint pulse of data. Chosen from
// the fixed edge list at module load (never re-rolled), long durations and long
// delays so any given packet crosses roughly once every 5-10s. The travel is a
// single translate driven by CSS custom properties, so each packet is one
// composited transform rather than a per-frame path calculation.
const NET_PACKETS = [2, 7, 11, 16, 21, 26].map((edgeIndex, i) => {
  const edge = NET_EDGES[edgeIndex % NET_EDGES.length];
  const [ax, ay, bx, by] = edge;
  return {
    x: ax,
    y: ay,
    dx: bx - ax,
    dy: by - ay,
    duration: 6 + i * 0.8,
    delay: i * 1.6,
  };
});

/**
 * Enterprise cyber environment behind the page: hex security grid, blockchain
 * node network, telemetry sweep and drifting particles, over layered gradients
 * for depth.
 *
 * Fixed, pointer-events:none, aria-hidden and z-index 0, so it sits strictly
 * behind content and can never intercept a click or be read by a screen reader.
 * The hex grid is an SVG <pattern> (one tile, GPU-tiled) rather than thousands
 * of elements, and the whole layer is static except three slow transform/opacity
 * animations - it must never compete with the content.
 */
export function KhanAiBackdrop() {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const hex = `khanBgHex-${uid}`;
  const fade = `khanBgFade-${uid}`;
  const sweep = `khanBgSweep-${uid}`;

  return (
    <div className="khan-bg" aria-hidden="true">
      <div className="khan-bg-depth" />
      <svg className="khan-bg-svg" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice">
        <defs>
          {/* One hexagon tile, repeated by the renderer. */}
          <pattern id={hex} width="56" height="48.5" patternUnits="userSpaceOnUse">
            <path
              d="M14 0.5 L42 0.5 L56 24.25 L42 48 L14 48 L0 24.25 Z"
              fill="none"
              stroke="var(--gold)"
              strokeOpacity="0.07"
              strokeWidth="1"
            />
          </pattern>

          {/* Vignette: keeps the grid off the centre, where the copy sits. */}
          <radialGradient id={fade} cx="50%" cy="42%" r="72%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.85" />
            <stop offset="60%" stopColor="#fff" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <mask id={`${fade}-mask`}>
            <rect width="1200" height="800" fill={`url(#${fade})`} />
          </mask>

          <linearGradient id={sweep} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="var(--gold)" stopOpacity="0" />
            <stop offset="50%" stopColor="var(--gold-bright)" stopOpacity="0.5" />
            <stop offset="100%" stopColor="var(--gold)" stopOpacity="0" />
          </linearGradient>
        </defs>

        <g mask={`url(#${fade}-mask)`}>
          <rect className="khan-bg-grid" width="1200" height="800" fill={`url(#${hex})`} />

          <g className="khan-bg-net">
            {NET_EDGES.map(([ax, ay, bx, by], i) => (
              <line key={i} x1={ax} y1={ay} x2={bx} y2={by} stroke="var(--gold)" strokeOpacity="0.12" strokeWidth="0.75" />
            ))}
            {NET_NODES.map(([cx, cy], i) => (
              <circle key={i} className="khan-bg-node" cx={cx} cy={cy} r={i % 4 === 0 ? 2.4 : 1.5} style={{ animationDelay: `${(i % 7) * 0.9}s` }} />
            ))}
            {NET_PACKETS.map((p, i) => (
              <circle
                key={`p${i}`}
                className="khan-bg-packet"
                cx={p.x}
                cy={p.y}
                r="1.8"
                style={{
                  '--dx': `${p.dx}px`,
                  '--dy': `${p.dy}px`,
                  animationDuration: `${p.duration}s`,
                  animationDelay: `${p.delay}s`,
                }}
              />
            ))}
          </g>

          {/* AI telemetry line: one slow horizontal sweep. */}
          <rect className="khan-bg-telemetry" x="-1200" y="0" width="1200" height="800" fill={`url(#${sweep})`} />
        </g>
      </svg>
      <div className="khan-bg-particles">
        {Array.from({ length: 7 }, (_, i) => (
          <span key={i} className="khan-bg-particle" style={{ left: `${8 + i * 13}%`, animationDelay: `${i * 3.5}s`, animationDuration: `${26 + i * 4}s` }} />
        ))}
      </div>
    </div>
  );
}

// The verification rows, mapped onto values the scoring engine genuinely
// produces. The first four are real TRUST_CATEGORIES (see riskHistory.js);
// founder and roadmap are not categories of their own - they are individual
// score keys folded into `community` - so they are read straight off
// scoreBreakdown rather than invented as categories.
const VERIFY_ROWS = [
  { key: 'holderHealth', from: 'category' },
  { key: 'liquidity', from: 'category' },
  { key: 'contractSecurity', from: 'category' },
  { key: 'community', from: 'category' },
  { key: 'founderActivity', from: 'breakdown' },
  { key: 'roadmapClarity', from: 'breakdown' },
];

function readVerifyValue(project, row) {
  if (row.from === 'category') {
    const found = (project.categoryBreakdown || []).find((c) => c.key === row.key);
    return found && found.available && found.score !== null ? found.score : null;
  }
  const value = project.scoreBreakdown?.[row.key];
  return typeof value === 'number' ? value : null;
}

/**
 * KHAN AI verification sequence for the project profile.
 *
 * Runs only after a completed real scan, and every row reports a value the
 * scoring engine actually computed. A signal with no data reads "not assessed"
 * rather than a green tick: this engine's policy is that unknown is not the
 * same as bad, and a checkmark over missing data would be exactly the kind of
 * false assurance a security product must never give.
 *
 * The stagger is pure CSS delay, so no JS timer runs and nothing re-renders
 * once the sequence has played.
 */
export function KhanAiVerificationPanel({ project, revealed = false }) {
  const { t } = useTranslation();
  if (!revealed) return null;

  const rows = VERIFY_ROWS.map((row) => ({ ...row, value: readVerifyValue(project, row) }));

  return (
    <div className="khan-verify">
      <div className="khan-verify-head">
        <KhanAiEntity state="idle" size="sm" />
        <div>
          <span className="khan-verify-name">{t('khanAi.name')}</span>
          <span className="khan-verify-sub">{t('khanAi.verify.title')}</span>
        </div>
      </div>
      <ul className="khan-verify-list">
        {rows.map((row, index) => (
          <li
            key={row.key}
            className={`khan-verify-row ${row.value === null ? 'is-unknown' : 'is-verified'}`}
            style={{ animationDelay: `${index * 120}ms` }}
          >
            <span className="khan-verify-tick" aria-hidden="true">{row.value === null ? '—' : '✓'}</span>
            <span className="khan-verify-label">{t(`khanAi.verify.rows.${row.key}`)}</span>
            <span className="khan-verify-state">
              {row.value === null ? t('khanAi.verify.notAssessed') : t('khanAi.verify.verified')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Calm panel used for empty and error states. `tone` picks the entity state;
 * the copy is always measured and non-alarming.
 */
export function KhanAiPanel({ tone = 'idle', title, text, children }) {
  return (
    <div className={`khan-ai-panel is-${tone}`}>
      <KhanAiEntity state={tone} size="md" />
      <div className="khan-ai-panel-body">
        {title && <h3>{title}</h3>}
        {text && <p>{text}</p>}
        {children}
      </div>
    </div>
  );
}
