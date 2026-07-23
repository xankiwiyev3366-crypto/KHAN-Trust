// Display & formatting helpers, extracted verbatim from src/main.jsx.
//
// Pure presentation utilities: they take a value and return a localized,
// human-readable string (or a normalized display value). Their only
// dependencies are the i18n `translate` and the shared `hasValue` sentinel
// check — no React, no app state — so they are safe to share and unit-testable.
import { translate } from './i18n/index.js';
import { hasValue } from './lib/trustScore.js';

export function translateRiskLevel(level = '') {
  return translate(`common.${level.toLowerCase()}`) || level;
}

export function daysSince(date) {
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
}

export function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export function formatCurrency(value) {
  const number = Number(value || 0);
  if (!number) return translate('common.notAvailable');
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: number >= 1000 ? 0 : 2,
  }).format(number);
}

// formatCurrency rounds sub-cent prices to "$0.00", which looks like
// missing data for memecoin-range prices that are very real (e.g. PEPE's
// $0.0000028 ATH). Use full precision below $1 instead of silently
// truncating to zero.
export function formatTinyOrCurrency(value) {
  const number = Number(value || 0);
  if (!number) return translate('common.notAvailable');
  if (number >= 1) return formatCurrency(number);
  return `$${number.toPrecision(4)}`;
}

export function formatNumber(value) {
  const number = Number(value || 0);
  if (!number) return translate('common.notAvailable');
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(number);
}

export function formatAge(days) {
  if (days === null || days === undefined) return translate('common.notAvailable');
  if (days < 1) return translate('common.ageLessThanDay');
  if (days < 30) return translate('common.ageDays', { count: days });
  if (days < 365) return translate('common.ageMonths', { count: Math.round(days / 30) });
  return translate('common.ageYears', { count: Math.round(days / 365) });
}

export function formatPercent(value) {
  if (value === null || value === undefined) return translate('common.notAvailable');
  return `${Number(value).toFixed(2)}%`;
}

export function formatScore(value) {
  return value === null || value === undefined ? translate('common.notAvailable') : `${value}/100`;
}

export function displayValue(value) {
  return hasValue(value) ? value : translate('common.notAvailable');
}

export function storedMetadataValue(value) {
  if (typeof value === 'number') return value > 0 ? value : undefined;
  if (Array.isArray(value)) return value.length ? value : undefined;
  return hasValue(value) ? value : undefined;
}
