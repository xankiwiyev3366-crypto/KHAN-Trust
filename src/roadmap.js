// Roadmap & updates-timeline helpers, extracted verbatim from src/main.jsx.
// Convert between a roadmap array and its editable text form, and derive the
// project updates timeline. Depend only on i18n translate + the hasValue sentinel.
import { translate } from './i18n/index.js';
import { hasValue } from './lib/trustScore.js';

export function buildUpdatesTimeline(project, now) {
  const date = project.launchDate || now;
  const updates = [{ label: translate('timeline.projectSubmitted'), date: now }];
  if (hasValue(project.website)) updates.push({ label: translate('timeline.websiteAdded'), date });
  if (hasValue(project.twitter)) updates.push({ label: translate('timeline.xAdded'), date });
  if (hasValue(project.telegram)) updates.push({ label: translate('timeline.telegramAdded'), date });
  if (hasValue(project.github)) updates.push({ label: translate('timeline.githubAdded'), date });
  if (hasValue(project.roadmapText) || project.roadmap?.length) updates.push({ label: translate('timeline.roadmapAdded'), date });
  return updates;
}

export function roadmapToText(roadmap = []) {
  return roadmap.map((item) => item.phase).join('\n');
}

export function roadmapFromText(text) {
  if (!text) {
    return [{ phase: translate('scoring.roadmapNeeded'), status: 'Planned' }];
  }
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((phase, index) => ({ phase, status: index === 0 ? 'In progress' : 'Planned' }));
}
