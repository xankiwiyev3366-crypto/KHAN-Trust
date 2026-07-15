// Renders one AI recommendation with its full decision record.
//
// Every field the founder asked for is present and NON-OPTIONAL: reasoning,
// expected impact, priority, complexity, ROI and risks. A recommendation
// without them is an opinion; with them it is a decision someone can actually
// make, argue with, or reject on the merits.
//
// `confidence` is rendered as prominently as the title on purpose. An
// AI-authored idea labelled "speculative" and one labelled "grounded_in_data"
// deserve very different amounts of the founder's trust, and burying that
// distinction is how an assistant quietly starts driving the business.
import React from 'react';
import { ArrowRight } from 'lucide-react';

const CONFIDENCE_LABELS = {
  grounded_in_data: 'Grounded in data',
  informed_judgement: 'Informed judgement',
  speculative: 'Speculative',
};

const OBJECTIVE_LABELS = {
  registrations: 'Registrations',
  active_users: 'Active users',
  retention: 'Retention',
  user_experience: 'UX',
  conversion: 'Conversion',
  trust: 'Trust',
  brand_awareness: 'Brand awareness',
  positioning: 'Positioning',
  new_opportunity: 'New opportunity',
  investor_readiness: 'Investor readiness',
  data_quality: 'Data quality',
};

export function RecommendationCard({ recommendation, onAccept, accepting }) {
  const rec = recommendation;
  return (
    <article className="rec-card">
      <header>
        <span className={`rec-priority rec-${rec.priority}`}>{rec.priority}</span>
        <h4>{rec.title}</h4>
      </header>

      <div className="rec-chips">
        <span className={`rec-confidence rec-conf-${rec.confidence}`}>
          {CONFIDENCE_LABELS[rec.confidence] || rec.confidence}
        </span>
        <span className="rec-chip">{OBJECTIVE_LABELS[rec.objective] || rec.objective}</span>
        <span className="rec-chip">{rec.complexity} complexity</span>
      </div>

      <dl className="rec-detail">
        <dt>Why</dt><dd>{rec.reasoning}</dd>
        <dt>Expected impact</dt><dd>{rec.expectedImpact}</dd>
        <dt>ROI</dt><dd>{rec.roiEstimate}</dd>
        <dt>Risks</dt><dd>{rec.risks}</dd>
      </dl>

      {onAccept && (
        <button type="button" className="primary-button" onClick={() => onAccept(rec)} disabled={accepting}>
          {accepting ? 'Adding…' : 'Track as initiative'} <ArrowRight size={15} />
        </button>
      )}
    </article>
  );
}

// The team's honest statement of what it could and could not conclude. Rendered
// ABOVE the recommendations, deliberately: it frames how much weight everything
// below it deserves, and that framing is worthless after the fact.
export function DataVerdict({ verdict }) {
  if (!verdict) return null;
  return (
    <div className="console-callout">
      <strong>What the data can actually support</strong>
      <p>{verdict}</p>
    </div>
  );
}

// Surfaced, never hidden. A model that starts inventing statistics is a
// regression in the prompt or the model, and the operator needs to see it
// happening rather than silently receive a shorter list.
export function FabricationNotice({ rejected }) {
  if (!rejected?.length) return null;
  return (
    <div className="console-callout console-callout-warn">
      <strong>{rejected.length} recommendation(s) were dropped for citing invented numbers.</strong>
      <p>
        These cited figures that do not appear anywhere in the source metrics, so they were removed
        automatically before reaching this page. Shown here because a model that fabricates is worth
        knowing about.
      </p>
      <ul>
        {rejected.map((entry, index) => (
          <li key={index}>
            <em>{entry.finding.title}</em> — {entry.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}
