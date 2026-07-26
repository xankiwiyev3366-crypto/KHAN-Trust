// Trust Movers — the premium intelligence dashboard.
//
// A self-contained, lazy-loaded surface (mounted from main.jsx like
// EarlyStage.jsx) that reads the public /trust-movers API and renders the four
// ranked sections. It never computes movements itself: all the intelligence
// lives server-side (netlify/functions/_trustMoversStore.mjs +
// src/lib/trustMovers.js) so the exact same numbers can later feed a mobile app
// or public API. This file is presentation only.
//
// Honesty: when the API reports insufficientData (no history yet, or the DB
// could not serve the read) the dashboard shows "Not enough historical data
// yet." — it never fabricates a card. The AI explanation lines come straight
// from the server, each grounded in a real score-component change.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  TrendingUp, TrendingDown, Minus, ShieldCheck, AlertTriangle, Sparkles, RefreshCw,
} from 'lucide-react';
import { CHAINS } from './chains/registry.js';

const PERIODS = ['24H', '7D', '30D', '90D'];

// Canonical chain ids the API accepts, in display order, plus the "all" option.
const CHAIN_OPTIONS = [
  { id: 'all', label: 'All Chains' },
  { id: 'solana', label: 'Solana' },
  { id: 'ethereum', label: 'Ethereum' },
  { id: 'base', label: 'Base' },
  { id: 'bsc', label: 'BNB Chain' },
  { id: 'arbitrum', label: 'Arbitrum' },
  { id: 'optimism', label: 'Optimism' },
  { id: 'polygon', label: 'Polygon' },
  { id: 'avalanche', label: 'Avalanche' },
  { id: 'sui', label: 'Sui' },
  { id: 'aptos', label: 'Aptos' },
];

const AUDIENCES = [
  { id: 'all', label: 'All projects' },
  { id: 'verified', label: 'Verified only' },
];

// The four sections, their headline, accent tone, and icon.
const SECTION_META = [
  { key: 'rising', title: 'Rising Trust', subtitle: 'Largest Trust Score increases', tone: 'up', icon: TrendingUp },
  { key: 'falling', title: 'Falling Trust', subtitle: 'Largest Trust Score decreases', tone: 'down', icon: TrendingDown },
  { key: 'newHighConfidence', title: 'New High Confidence', subtitle: 'Newly high-confidence projects', tone: 'up', icon: ShieldCheck },
  { key: 'newlyHighRisk', title: 'Newly High Risk', subtitle: 'Projects that just turned high risk', tone: 'down', icon: AlertTriangle },
];

function chainMeta(chainId) {
  const chain = CHAINS[chainId];
  if (chain) return { label: chain.label, color: chain.color };
  // Unknown/label-form chain string: show it verbatim with a neutral accent
  // rather than inventing a mapping.
  return { label: chainId || 'Unknown', color: '#8a8f98' };
}

function scoreTone(score) {
  if (typeof score !== 'number') return 'unknown';
  if (score >= 78) return 'low';       // Low risk
  if (score >= 55) return 'medium';
  return 'high';
}

function riskTone(riskLevel) {
  if (riskLevel === 'Low') return 'low';
  if (riskLevel === 'Medium') return 'medium';
  if (riskLevel === 'High') return 'high';
  return 'unknown';
}

// "3h ago" / "2d ago" / "just now" from an ISO timestamp or a YYYY-MM-DD date.
function relativeTime(value) {
  if (!value) return '';
  const then = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (!Number.isFinite(then)) return '';
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 90) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function initialFor(mover) {
  const source = (mover.ticker || mover.name || '?').trim();
  return source ? source[0].toUpperCase() : '?';
}

function TrendArrow({ trend }) {
  if (trend === 'up') return <TrendingUp size={16} aria-hidden />;
  if (trend === 'down') return <TrendingDown size={16} aria-hidden />;
  if (trend === 'new') return <Sparkles size={16} aria-hidden />;
  return <Minus size={16} aria-hidden />;
}

function MoverCard({ mover, tone }) {
  const chain = chainMeta(mover.chain);
  const change = mover.absoluteChange;
  const changeSign = change > 0 ? '+' : '';
  const pct = mover.percentChange;
  return (
    <article className={`tm-card tm-card--${tone}`}>
      <header className="tm-card__head">
        <span className="tm-logo" style={{ background: chain.color }} aria-hidden>{initialFor(mover)}</span>
        <div className="tm-card__id">
          <h4 className="tm-card__name" title={mover.name}>{mover.name}</h4>
          <span className="tm-chain" style={{ color: chain.color }}>{chain.label}</span>
        </div>
        <span className={`tm-risk tm-risk--${riskTone(mover.riskLevel)}`}>{mover.riskLevel || '—'}</span>
      </header>

      <div className="tm-scores">
        <div className="tm-score-block">
          <span className="tm-score-label">Now</span>
          <span className={`tm-score tm-score--${scoreTone(mover.currentScore)}`}>
            {mover.currentScore ?? '—'}
          </span>
        </div>
        <div className={`tm-change tm-change--${tone}`}>
          <TrendArrow trend={mover.trend} />
          {change === null || change === undefined ? (
            <span className="tm-change__new">New</span>
          ) : (
            <span className="tm-change__val">{changeSign}{change}
              {typeof pct === 'number' && <em className="tm-change__pct"> ({changeSign}{pct}%)</em>}
            </span>
          )}
        </div>
        <div className="tm-score-block tm-score-block--prev">
          <span className="tm-score-label">Prev</span>
          <span className="tm-score tm-score--prev">{mover.previousScore ?? '—'}</span>
        </div>
      </div>

      {mover.reasons && mover.reasons.length > 0 && (
        <ul className="tm-reasons">
          {mover.reasons.map((reason) => (
            <li key={reason} className="tm-reason"><Sparkles size={12} aria-hidden /> {reason}</li>
          ))}
        </ul>
      )}

      <footer className="tm-card__foot">
        <span className="tm-updated">Updated {relativeTime(mover.lastUpdated) || '—'}</span>
      </footer>
    </article>
  );
}

function Section({ meta, movers }) {
  const Icon = meta.icon;
  return (
    <section className={`tm-section tm-section--${meta.tone}`}>
      <header className="tm-section__head">
        <span className={`tm-section__icon tm-section__icon--${meta.tone}`}><Icon size={18} aria-hidden /></span>
        <div>
          <h3 className="tm-section__title">{meta.title}</h3>
          <p className="tm-section__subtitle">{meta.subtitle}</p>
        </div>
        <span className="tm-section__count">{movers.length}</span>
      </header>
      {movers.length === 0 ? (
        <p className="tm-empty">Not enough historical data yet.</p>
      ) : (
        <div className="tm-grid">
          {movers.map((mover) => <MoverCard key={mover.identity} mover={mover} tone={meta.tone} />)}
        </div>
      )}
    </section>
  );
}

export default function TrustMovers() {
  const [period, setPeriod] = useState('7D');
  const [chain, setChain] = useState('all');
  const [audience, setAudience] = useState('all');
  const [state, setState] = useState({ loading: true, error: null, data: null });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const params = new URLSearchParams({ period, chain, audience, limit: '12' });
      const response = await fetch(`/.netlify/functions/trust-movers?${params.toString()}`);
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      const data = await response.json();
      setState({ loading: false, error: null, data });
    } catch (error) {
      setState({ loading: false, error: error.message || 'Failed to load Trust Movers', data: null });
    }
  }, [period, chain, audience]);

  useEffect(() => { load(); }, [load]);

  const sections = state.data?.sections || {};
  const insufficient = state.data?.insufficientData;
  const totalMovers = useMemo(
    () => SECTION_META.reduce((sum, meta) => sum + (sections[meta.key]?.length || 0), 0),
    [sections],
  );

  return (
    <section className="page-section tm-page">
      <div className="tm-hero">
        <div className="tm-hero__text">
          <span className="tm-eyebrow">KHAN Trust Intelligence</span>
          <h1 className="tm-title">Trust Movers</h1>
          <p className="tm-intro">
            Projects whose Trust Score moved the most — with the real reason behind every move,
            grounded in liquidity, holder, contract, social and market-activity signals.
          </p>
        </div>
        <button type="button" className="tm-refresh" onClick={load} disabled={state.loading}>
          <RefreshCw size={16} className={state.loading ? 'tm-spin' : ''} aria-hidden /> Refresh
        </button>
      </div>

      <div className="tm-controls">
        <div className="tm-tabs" role="tablist" aria-label="Time window">
          {PERIODS.map((p) => (
            <button
              key={p}
              role="tab"
              aria-selected={period === p}
              className={`tm-tab ${period === p ? 'tm-tab--active' : ''}`}
              onClick={() => setPeriod(p)}
            >{p}</button>
          ))}
        </div>
        <div className="tm-filters">
          <label className="tm-select">
            <span>Chain</span>
            <select value={chain} onChange={(e) => setChain(e.target.value)}>
              {CHAIN_OPTIONS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <label className="tm-select">
            <span>Audience</span>
            <select value={audience} onChange={(e) => setAudience(e.target.value)}>
              {AUDIENCES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </label>
        </div>
      </div>

      {state.loading && <p className="tm-status">Loading Trust Movers…</p>}
      {state.error && <p className="tm-status tm-status--error">Could not load Trust Movers: {state.error}</p>}

      {!state.loading && !state.error && insufficient && totalMovers === 0 && (
        <div className="tm-insufficient">
          <AlertTriangle size={22} aria-hidden />
          <p>Not enough historical data yet.</p>
          <span>Trust Movers needs at least two score snapshots across the selected window. Check back soon.</span>
        </div>
      )}

      {!state.loading && !state.error && !(insufficient && totalMovers === 0) && (
        <div className="tm-sections">
          {SECTION_META.map((meta) => (
            <Section key={meta.key} meta={meta} movers={sections[meta.key] || []} />
          ))}
        </div>
      )}
    </section>
  );
}
