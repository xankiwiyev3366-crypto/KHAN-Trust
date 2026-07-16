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

import { useT } from '../i18n/ConsoleI18nProvider.jsx';
import { renderReason } from '../lib/reason.js';

// NOTE ON WHAT IS AND IS NOT TRANSLATED HERE.
//
// The LABELS and headings below are console copy, translated at render time.
//
// The recommendation's own prose - title, reasoning, expectedImpact,
// roiEstimate, risks - is data, rendered exactly as stored. It is not
// translated HERE because it was already WRITTEN in the operator's language:
// the console passes its active language to the analysts, who compose in it
// directly (see _growthAnalyst.mjs languageDirective).
//
// That distinction matters. Composing in Azerbaijani produces native prose;
// post-translating an English report would produce a translation, and would
// push an evidence-gated document through a second model that the fabrication
// validator never checked.
//
// The consequence is that a stored report is immutable: one written in English
// stays English even if the console later switches to Azerbaijani. OverviewPage
// says so explicitly rather than leaving the operator to wonder.
export function RecommendationCard({ recommendation, onAccept, accepting }) {
  const { t } = useT();
  const rec = recommendation;
  return (
    <article className="rec-card">
      <header>
        <span className={`rec-priority rec-${rec.priority}`}>{rec.priority}</span>
        <h4>{rec.title}</h4>
      </header>

      <div className="rec-chips">
        <span className={`rec-confidence rec-conf-${rec.confidence}`}>
          {t(`recConfidence.${rec.confidence}`)}
        </span>
        <span className="rec-chip">{t(`objectives.${rec.objective}`)}</span>
        <span className="rec-chip">{t('rec.complexity', { level: t(`complexity.${rec.complexity}`) })}</span>
      </div>

      <dl className="rec-detail">
        <dt>{t('rec.why')}</dt><dd>{rec.reasoning}</dd>
        <dt>{t('rec.expectedImpact')}</dt><dd>{rec.expectedImpact}</dd>
        <dt>{t('rec.roi')}</dt><dd>{rec.roiEstimate}</dd>
        <dt>{t('rec.risks')}</dt><dd>{rec.risks}</dd>
      </dl>

      {onAccept && (
        <button type="button" className="primary-button" onClick={() => onAccept(rec)} disabled={accepting}>
          {accepting ? t('rec.adding') : t('rec.trackAsInitiative')} <ArrowRight size={15} />
        </button>
      )}
    </article>
  );
}

// The team's honest statement of what it could and could not conclude. Rendered
// ABOVE the recommendations, deliberately: it frames how much weight everything
// below it deserves, and that framing is worthless after the fact.
export function DataVerdict({ verdict }) {
  const { t } = useT();
  if (!verdict) return null;
  return (
    <div className="console-callout">
      <strong>{t('rec.dataVerdictTitle')}</strong>
      {/* The verdict itself is the model's own words — data, not copy. */}
      <p>{verdict}</p>
    </div>
  );
}

// Surfaced, never hidden. A model that starts inventing statistics is a
// regression in the prompt or the model, and the operator needs to see it
// happening rather than silently receive a shorter list.
export function FabricationNotice({ rejected }) {
  const { t, lang } = useT();
  if (!rejected?.length) return null;
  return (
    <div className="console-callout console-callout-warn">
      <strong>{t('rec.fabricationTitle', { count: rejected.length })}</strong>
      <p>{t('rec.fabricationBody')}</p>
      <ul>
        {rejected.map((entry, index) => (
          <li key={index}>
            <em>{entry.finding.title}</em> — {renderReason(lang, entry)}
          </li>
        ))}
      </ul>
    </div>
  );
}
