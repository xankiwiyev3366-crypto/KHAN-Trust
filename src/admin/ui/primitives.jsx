// Presentational primitives for the private console.
//
// These intentionally MIRROR (rather than import) their counterparts in
// src/main.jsx. The duplication is ~120 lines and is a deliberate trade:
// importing them from main.jsx would make every one of them a module shared by
// both entries, which is exactly the coupling that would start pulling console
// code back toward the user bundle. Two applications that should be free to
// diverge visually do not share a component library.
//
// They reuse the existing class names from src/styles.css, so the console
// inherits the platform's look with no new stylesheet.
import React from 'react';

export function SectionTitle({ icon: Icon, eyebrow, title }) {
  return (
    <div className="section-title">
      <span>{Icon ? <Icon size={17} /> : null} {eyebrow}</span>
      <h2>{title}</h2>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, text }) {
  return (
    <div className="empty-state">
      {Icon ? <Icon size={28} /> : null}
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

export function FormField({ label, value, onChange, type = 'text', required = false, placeholder = '' }) {
  return (
    <label className="form-field">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        placeholder={placeholder}
      />
    </label>
  );
}

export function StatCard({ icon: Icon, label, value, sublabel, tone }) {
  return (
    <div className={`analytics-stat-card${tone ? ` tone-${tone}` : ''}`}>
      {Icon ? <Icon size={20} /> : null}
      <strong>{typeof value === 'number' ? value.toLocaleString('en-US') : value}</strong>
      <span>{label}</span>
      {sublabel && <small>{sublabel}</small>}
    </div>
  );
}

export function Sparkline({ data, color = 'var(--gold)', height = 64 }) {
  if (!data?.length) return null;
  const max = Math.max(1, ...data.map((point) => point.count));
  const width = 100;
  const stepX = width / Math.max(1, data.length - 1);
  const points = data
    .map((point, index) => `${(index * stepX).toFixed(2)},${(height - (point.count / max) * height).toFixed(2)}`)
    .join(' ');
  return (
    <svg className="analytics-sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" />
    </svg>
  );
}

export function MiniBarChart({ data, color = 'var(--gold)' }) {
  if (!data?.length) return null;
  const max = Math.max(1, ...data.map((item) => item.value));
  return (
    <div className="analytics-bar-chart">
      {data.map((item) => (
        <div className="analytics-bar-row" key={item.label}>
          <span className="analytics-bar-label">{item.label}</span>
          <div className="analytics-bar-track">
            <div
              className="analytics-bar-fill"
              style={{ width: `${(item.value / max) * 100}%`, background: item.color || color }}
            />
          </div>
          <span className="analytics-bar-value">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

export function DataTable({ columns, rows, emptyText = 'No data yet.' }) {
  if (!rows.length) return <EmptyState title="No data" text={emptyText} />;
  return (
    <div className="analytics-table-card">
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
    </div>
  );
}

// Renders a metric's statistical standing next to the number itself.
//
// This is the console's single most important presentational rule: at ~115
// users most metrics are noise, and a bare number invites the operator (and
// the AI) to over-read it. Every figure that comes out of the warehouse
// carries a confidence verdict, and this chip is how that verdict stays
// attached to the number on screen instead of being quietly dropped.
export function ConfidenceChip({ confidence }) {
  if (!confidence) return null;
  const { level, sampleSize, reason } = confidence;
  const label = {
    sufficient: 'Reliable',
    directional: 'Directional',
    insufficient: 'Not enough data',
  }[level] || level;
  return (
    <span className={`confidence-chip confidence-${level}`} title={reason || ''}>
      {label}
      {typeof sampleSize === 'number' ? ` · n=${sampleSize}` : ''}
    </span>
  );
}
