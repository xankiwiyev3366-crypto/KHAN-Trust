// Holder Cluster Map (Task 4) — a BubbleMap-style visualisation of the REAL
// observed top-holder distribution.
//
// THE HONESTY CONTRACT (this is the whole design, not a footnote):
//
// Every bubble is a genuine on-chain balance the scan observed
// (project.realData.topHolders, built from getTokenLargestAccounts / the RPC
// token-account scan). Bubble area is proportional to the holder's share of
// supply. Nothing here is synthesised.
//
// What we DO NOT do: draw "connection" lines between wallets. Proving that two
// wallets are related (same owner, co-funded, coordinated) needs transaction-
// graph data we do not have from free public sources. Per KHAN Trust doctrine,
// an unprovable link is never drawn. Instead we group bubbles by magnitude TIER
// (whale / large / mid / small) — a real property of the observed balances —
// and state plainly, with a confidence line, that cross-wallet RELATIONSHIPS are
// not established. A fabricated link on a platform named Trust is disqualifying.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from './i18n/I18nContext.jsx';

const VIEW = 520; // square viewBox
const CENTER = VIEW / 2;

// Magnitude tiers — a real property of the balance, not an inferred relationship.
function tierOf(pct) {
  if (pct >= 10) return 'whale';
  if (pct >= 3) return 'large';
  if (pct >= 1) return 'mid';
  return 'small';
}

const TIER_COLOR = {
  whale: '#ff756e',
  large: '#f7be52',
  mid: '#e0b75c',
  small: '#8a856f',
};

function truncateAddress(address) {
  if (!address || typeof address !== 'string') return null;
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

// Deterministic circle packing for ≤20 bubbles. Largest first, placed at the
// centre; each subsequent bubble spirals outward to the first spot where it does
// not overlap an already-placed one. O(n²) with tiny n — instant and stable.
function packBubbles(holders) {
  const maxPct = Math.max(...holders.map((h) => h.pct), 1);
  // Area ∝ pct → radius ∝ sqrt(pct). Scale so the biggest bubble is readable but
  // fits the viewBox.
  const maxR = 92;
  const minR = 16;
  const scaled = holders.map((h) => {
    const r = Math.max(minR, maxR * Math.sqrt(h.pct / maxPct));
    return { ...h, r };
  });

  const placed = [];
  for (const bubble of scaled) {
    if (!placed.length) {
      placed.push({ ...bubble, x: CENTER, y: CENTER });
      continue;
    }
    let best = null;
    // Spiral search for a free position.
    for (let angle = 0; angle < 360 * 6 && !best; angle += 11) {
      const rad = (angle * Math.PI) / 180;
      const dist = 20 + angle * 0.55;
      const x = CENTER + Math.cos(rad) * dist;
      const y = CENTER + Math.sin(rad) * dist;
      if (x - bubble.r < 6 || x + bubble.r > VIEW - 6 || y - bubble.r < 6 || y + bubble.r > VIEW - 6) continue;
      const overlaps = placed.some((p) => Math.hypot(p.x - x, p.y - y) < p.r + bubble.r + 4);
      if (!overlaps) best = { x, y };
    }
    placed.push({ ...bubble, x: best?.x ?? CENTER, y: best?.y ?? CENTER });
  }
  return placed;
}

export default function HolderClusterMap({ project }) {
  const { t } = useTranslation();
  const holders = project?.realData?.topHolders;
  const holderCount = project?.realData?.holderCount ?? project?.holders ?? null;
  const topTen = project?.realData?.topTenHolderPercent ?? null;

  const [zoom, setZoom] = useState(1);
  const [hovered, setHovered] = useState(null);
  const [mounted, setMounted] = useState(false);
  const svgRef = useRef(null);

  useEffect(() => {
    const id = window.setTimeout(() => setMounted(true), 30);
    return () => window.clearTimeout(id);
  }, []);

  const bubbles = useMemo(
    () => (Array.isArray(holders) && holders.length ? packBubbles(holders) : []),
    [holders],
  );

  const tierCounts = useMemo(() => {
    const counts = { whale: 0, large: 0, mid: 0, small: 0 };
    for (const h of holders || []) counts[tierOf(h.pct)] += 1;
    return counts;
  }, [holders]);

  if (!bubbles.length) {
    return (
      <div className="cluster-empty">
        <p className="inline-note">{t('clusterMap.noData')}</p>
      </div>
    );
  }

  const clampZoom = (z) => Math.max(1, Math.min(3, z));

  return (
    <div className="cluster-map">
      <div className="cluster-toolbar">
        <div className="cluster-legend">
          {['whale', 'large', 'mid', 'small'].map((tier) => (
            tierCounts[tier] > 0 && (
              <span key={tier} className="cluster-legend-item">
                <span className="cluster-dot" style={{ background: TIER_COLOR[tier] }} />
                {t(`clusterMap.tier.${tier}`)} · {tierCounts[tier]}
              </span>
            )
          ))}
        </div>
        <div className="cluster-zoom">
          <button type="button" aria-label={t('clusterMap.zoomOut')} onClick={() => setZoom((z) => clampZoom(z - 0.5))}>−</button>
          <button type="button" aria-label={t('clusterMap.zoomIn')} onClick={() => setZoom((z) => clampZoom(z + 0.5))}>+</button>
        </div>
      </div>

      <div className="cluster-canvas">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW} ${VIEW}`}
          className="cluster-svg"
          role="img"
          aria-label={t('clusterMap.ariaLabel')}
          onMouseLeave={() => setHovered(null)}
        >
          <g style={{ transform: `scale(${zoom})`, transformOrigin: 'center', transition: 'transform 0.25s ease' }}>
            {bubbles.map((b, i) => {
              const tier = tierOf(b.pct);
              const isHover = hovered === i;
              return (
                <g
                  key={`${b.rank}-${b.address || i}`}
                  onMouseEnter={() => setHovered(i)}
                  style={{ cursor: 'pointer' }}
                >
                  <circle
                    cx={b.x}
                    cy={b.y}
                    r={mounted ? b.r : 0}
                    fill={TIER_COLOR[tier]}
                    fillOpacity={isHover ? 0.9 : 0.55}
                    stroke={TIER_COLOR[tier]}
                    strokeWidth={isHover ? 3 : 1.5}
                    style={{ transition: 'r 0.5s cubic-bezier(0.22,1,0.36,1), fill-opacity 0.2s ease, stroke-width 0.2s ease' }}
                  />
                  {b.r >= 26 && (
                    <text
                      x={b.x}
                      y={b.y + 4}
                      textAnchor="middle"
                      className="cluster-bubble-label"
                      style={{ opacity: mounted ? 1 : 0, transition: 'opacity 0.6s ease' }}
                    >
                      {b.pct}%
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {hovered !== null && bubbles[hovered] && (
          <div className="cluster-tooltip" role="status">
            <strong>#{bubbles[hovered].rank} · {bubbles[hovered].pct}%</strong>
            <span className="cluster-tooltip-tier" style={{ color: TIER_COLOR[tierOf(bubbles[hovered].pct)] }}>
              {t(`clusterMap.tier.${tierOf(bubbles[hovered].pct)}`)}
            </span>
            {truncateAddress(bubbles[hovered].address) && (
              <code className="cluster-tooltip-addr">{truncateAddress(bubbles[hovered].address)}</code>
            )}
          </div>
        )}
      </div>

      <div className="cluster-summary">
        {topTen !== null && (
          <p className="inline-note">{t('clusterMap.topTenLine', { pct: topTen })}</p>
        )}
        {holderCount ? (
          <p className="inline-note">{t('clusterMap.coverageLine', { shown: bubbles.length, total: holderCount.toLocaleString() })}</p>
        ) : (
          <p className="inline-note">{t('clusterMap.coverageLineNoTotal', { shown: bubbles.length })}</p>
        )}
        {/* The confidence line — the honesty contract, on screen. */}
        <p className="cluster-confidence">{t('clusterMap.relationshipConfidence')}</p>
      </div>
    </div>
  );
}
