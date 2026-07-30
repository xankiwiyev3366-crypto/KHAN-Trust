// The small presentational pieces the Admin Panel is built out of.
//
// ── WHY THEY MOVED OUT OF main.jsx ──────────────────────────────────────────
//
// They were defined inside src/main.jsx, which was fine while every admin
// screen also lived there. src/adminPages.jsx (Paid Verification, Jobs &
// Delivery) is a second module that needs the same pieces, and it cannot import
// them from main.jsx — main.jsx would then import adminPages.jsx which imports
// main.jsx, and a circular ESM graph gets a half-initialised module rather than
// an error you can read.
//
// The alternative was a second copy of a StatCard. Two copies of a component
// that renders `analytics-stat-card` is how one of them quietly stops matching
// the stylesheet: the CSS changes, one copy is updated, and the other keeps
// rendering the old shape on a screen nobody looks at until it matters.
//
// Nothing here changed in the move. Same markup, same class names, same
// behaviour — main.jsx now imports what it used to declare.
import React, { useEffect, useRef, useState } from 'react';
import { Eye, Info } from 'lucide-react';

import { translate } from '../i18n/index.js';

// Counts up from 0 to `value` once the element scrolls into view, purely as
// a presentational micro-interaction - the underlying number/logic this
// wraps is unchanged, this only affects how it's drawn on screen.
export function AnimatedNumber({ value, duration = 900, format }) {
  const ref = useRef(null);
  const [display, setDisplay] = useState(0);
  const numericValue = Number(value);
  const isAnimatable = Number.isFinite(numericValue);

  useEffect(() => {
    if (!isAnimatable) return;
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setDisplay(numericValue);
      return;
    }
    // A count-up is motion like any other: under prefers-reduced-motion the
    // number is simply the number. CSS cannot reach a rAF loop, so this has to
    // be checked here.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setDisplay(numericValue);
      return;
    }
    let frame;
    const animate = () => {
      const start = performance.now();
      const from = 0;
      const step = (now) => {
        const progress = Math.min((now - start) / duration, 1);
        const eased = 1 - (1 - progress) ** 3;
        setDisplay(Math.round(from + (numericValue - from) * eased));
        if (progress < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    };
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        animate();
        observer.disconnect();
      }
    }, { threshold: 0.3 });
    observer.observe(node);
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [numericValue, duration, isAnimatable]);

  if (!isAnimatable) return <span ref={ref}>{value}</span>;
  return <span ref={ref}>{format ? format(display) : display}</span>;
}

export function SectionTitle({ icon: Icon, eyebrow, title }) {
  return (
    <div className="section-title">
      <span><Icon size={17} /> {eyebrow}</span>
      <h2>{title}</h2>
    </div>
  );
}

// Plain empty state. Deliberately assistant-free: this is what the Admin Panel
// and other internal surfaces use, and KHAN AI must never appear there. The
// user-facing pages use KhanAiEmptyState (src/main.jsx) instead.
export function EmptyState({ title, text }) {
  return (
    <div className="empty-state">
      <Eye size={28} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

export function FormField({ label, value, onChange, type = 'text', required = false, placeholder = '' }) {
  return (
    <label className="form-field">
      <span>{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} required={required} placeholder={placeholder} />
    </label>
  );
}

// `tooltip` explains precisely what the number counts. These metrics are easy
// to misread — "logged in" vs "visited", "today" vs "last 24 hours", "unique
// users" vs "sessions" — and an administrator acting on a misread number is
// the failure this dashboard exists to prevent. The definition is rendered
// as a real focusable element with an accessible name, not a bare `title`
// attribute, so it is reachable by keyboard and screen readers too.
export function StatCard({ icon: Icon, label, value, numericValue, sublabel, tooltip }) {
  return (
    <div className="analytics-stat-card">
      <Icon size={20} />
      <strong>{numericValue !== undefined ? <AnimatedNumber value={numericValue} format={(n) => n.toLocaleString('en-US')} /> : value}</strong>
      <span>
        {label}
        {tooltip && (
          <button type="button" className="metric-info" title={tooltip} aria-label={tooltip}>
            <Info size={12} aria-hidden="true" />
          </button>
        )}
      </span>
      {sublabel && <small>{sublabel}</small>}
    </div>
  );
}

// `wide` adds `scroll-x`, which keeps a table with more columns than the
// viewport scrolling inside its own box instead of dragging the whole page
// sideways. It is opt-in and off by default: the existing analytics tables are
// narrow enough that the mobile-breakpoint `overflow-x` in styles.css already
// covers them, and switching them all to always-scroll would be a visual change
// to screens this work is not about.
export function RankTable({ title, columns, rows, emptyText, wide = false }) {
  return (
    <div className={`analytics-table-card${wide ? ' scroll-x' : ''}`}>
      <h4>{title}</h4>
      {!rows.length ? (
        <EmptyState title={translate('adminAnalytics.noDataTitle')} text={emptyText || translate('adminAnalytics.noDataDefault')} />
      ) : (
        <table className="analytics-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
