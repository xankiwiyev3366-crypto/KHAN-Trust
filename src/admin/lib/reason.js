// Renders a server-generated explanation in the operator's language.
//
// The warehouse emits both an English `reason` string and a `reasonCode` +
// `reasonParams` pair (see _growthConfidence.mjs / _growthWarehouse.mjs). The
// prose is what the AI reads and what older stored data carries; the code is
// what the console translates.
//
// The fallback chain matters. If a code is missing — an older stored report, a
// new server reason that has not been given a translation yet — this falls back
// to the server's English prose rather than rendering blank or a raw key. A
// sentence in the wrong language is a blemish; a missing explanation next to a
// number the operator is about to act on is a hazard.
import { translate } from '../i18n/index.js';

// Params that name a funnel stage carry a stage ID ('activated'), not an
// English label, precisely so the label can be translated here too. Without
// this, an otherwise-Azerbaijani sentence would read
// "…konversiya “Scanned a token” addımındadır".
const STAGE_PARAMS = ['stage', 'upstreamStage'];

export function renderReason(lang, { reason, reasonCode, reasonParams } = {}) {
  if (!reasonCode) return reason || '';

  const key = `reasons.${reasonCode}`;
  const translated = translate(lang, key, localiseStageParams(lang, reasonParams));

  // translate() returns the key path when it finds nothing — treat that as a
  // miss and prefer the server's own words.
  return translated === key ? (reason || '') : translated;
}

function localiseStageParams(lang, params) {
  if (!params) return params;

  const out = { ...params };
  for (const name of STAGE_PARAMS) {
    if (typeof out[name] !== 'string') continue;
    const stageKey = `funnel.stages.${out[name]}`;
    const label = translate(lang, stageKey);
    // An unknown stage id keeps its raw value rather than rendering the key
    // path — odd but truthful, and greppable.
    if (label !== stageKey) out[name] = label;
  }
  return out;
}

// Notes use `note` / `noteCode` / `noteParams` instead of the reason triple.
// Same rules, different field names.
export function renderNote(lang, { note, noteCode, noteParams } = {}) {
  return renderReason(lang, { reason: note, reasonCode: noteCode, reasonParams: noteParams });
}
