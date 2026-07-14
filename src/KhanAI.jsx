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

// The four pipeline stages. These map onto work lookupSolanaTokenUncached
// genuinely performs (Dexscreener/RPC/GeckoTerminal, holder analytics, mint +
// GoPlus contract security, then the scoring engine) - the console is a
// checklist of that pipeline, not decorative filler. The underlying fetches
// run in parallel, so this reflects the stages, not a strict ordering.
const SCAN_STAGES = ['blockchain', 'holders', 'contract', 'score'];
const STAGE_MS = 620;

/**
 * Advances through the pipeline stages while a scan is in flight, holding on
 * the final stage until the real request settles - so the console can never
 * claim "done" before the work actually is.
 */
function useScanStages(active) {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    if (!active) {
      setStage(0);
      return undefined;
    }
    setStage(0);
    const timers = SCAN_STAGES.slice(1).map((_, index) =>
      setTimeout(() => setStage(index + 1), (index + 1) * STAGE_MS)
    );
    return () => timers.forEach(clearTimeout);
  }, [active]);

  return stage;
}

/**
 * Inline scan console shown in the hero while a lookup runs.
 *
 * Deliberately inline rather than an overlay: it must never cover buttons,
 * block scrolling, or interrupt what the user is doing.
 */
export function KhanAiScanConsole({ active, error = null }) {
  const { t } = useTranslation();
  const stage = useScanStages(active && !error);

  if (!active && !error) return null;

  const state = error ? 'error' : 'analyzing';

  return (
    <div className={`khan-ai-console is-${state}`}>
      <KhanAiEntity state={state} size="sm" />
      <div className="khan-ai-console-body">
        <p className="khan-ai-console-label">
          <span className="khan-ai-console-name">{t('khanAi.name')}</span>
          <span className="khan-ai-console-status">
            {error ? t('khanAi.console.halted') : t('khanAi.console.running')}
          </span>
        </p>

        {error ? (
          <p className="khan-ai-console-error" role="status">{error}</p>
        ) : (
          <ul className="khan-ai-stages" role="status" aria-live="polite">
            {SCAN_STAGES.map((key, index) => (
              <li
                key={key}
                className={`khan-ai-stage ${index < stage ? 'is-done' : index === stage ? 'is-active' : 'is-pending'}`}
              >
                <span className="khan-ai-stage-dot" aria-hidden="true" />
                <span className="khan-ai-stage-text">{t(`khanAi.stages.${key}`)}</span>
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
export function KhanAiHeroMark({ children }) {
  const { t } = useTranslation();
  return (
    <div className="khan-ai-hero-mark">
      <KhanAiEntity state="idle" size="lg" />
      <div className="khan-ai-hero-copy">
        {children}
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
 * One-shot confirmation glow for the Trust Score reveal. Starts in 'complete',
 * settles to 'idle' once the flash has played, so the score card is never
 * left with a permanently "celebrating" mark.
 */
export function KhanAiVerdictMark() {
  const { t } = useTranslation();
  const [state, setState] = useState('complete');
  const timer = useRef(null);

  useEffect(() => {
    timer.current = setTimeout(() => setState('idle'), 1600);
    return () => clearTimeout(timer.current);
  }, []);

  return (
    <div className="khan-ai-verdict">
      <KhanAiEntity state={state} size="sm" />
      <span className="khan-ai-verdict-text">{t('khanAi.verdict.analyzed')}</span>
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
