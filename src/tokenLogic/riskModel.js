// Trust/risk scoring model — the explainable risk factor + confidence logic,
// extracted verbatim from src/main.jsx. Given a computed project it produces the
// risk factors, severities, confidence, badges and plain-language explanations
// the report renders. All module-level and pure (no app state); deps are the
// already-shared i18n, trustScore sentinels/presence helpers, and formatters.
import { translate } from '../i18n/index.js';
import {
  hasValue, firstPresent, socialPresenceState, hasRoadmap, isPublicFounder,
} from '../lib/trustScore.js';
import {
  daysSince, formatAge, formatCurrency, formatNumber, formatPercent,
} from '../format.js';

export function holderConcentrationStatus(data = {}) {
  if (data.topHolderPercent === null || data.topHolderPercent === undefined) {
    return translate('scoring.holderConcentration.unavailable');
  }
  if (data.topHolderPercent > 35 || data.topTenHolderPercent > 70) return translate('scoring.holderConcentration.warning');
  return translate('scoring.holderConcentration.ok');
}

export function holderRiskLevel(data = {}) {
  if (data.topHolderPercent === null || data.topHolderPercent === undefined) return translate('scoring.holderRiskLevel.limited');
  if (data.topHolderPercent > 35 || data.topTenHolderPercent > 70) return translate('scoring.holderRiskLevel.high');
  if (data.topHolderPercent > 20 || data.topTenHolderPercent > 50) return translate('scoring.holderRiskLevel.medium');
  return translate('scoring.holderRiskLevel.low');
}

export function contractSecuritySummary(data = {}) {
  const flags = [];
  if (data.mintAuthorityEnabled === true) flags.push(translate('scoring.factors.mintAuthorityTitle'));
  if (data.freezeAuthorityEnabled === true) flags.push(translate('scoring.factors.freezeAuthorityTitle'));
  if (data.upgradeable === true) flags.push(translate('scoring.factors.upgradeableTitle'));
  if (flags.length) return flags.join(', ');
  const known = [data.mintAuthorityEnabled, data.freezeAuthorityEnabled, data.upgradeable].some((value) => value === false);
  if (known) return translate('scoring.contractSecurity.noKnownRisks');
  return translate('common.notAvailable');
}

// The score bands, defined ONCE. riskKey() is the machine-readable form (a CSS
// hook, a lookup); riskBadge() is the human-readable, translated label built
// from the same bands - so the colour a user sees can never disagree with the
// words next to it, and moving a threshold moves both.
//
// riskBadge returns TRANSLATED text and must never be used as a className: that
// yields `class="High Risk"` in English (two junk classes, no styling) and a
// Cyrillic class name in Russian. Use riskKey for that.
export const RISK_BANDS = [
  { min: 78, key: 'low' },
  { min: 55, key: 'medium' },
  { min: -Infinity, key: 'high' },
];

export function riskKey(score) {
  const band = RISK_BANDS.find((entry) => Number(score) >= entry.min);
  return band ? band.key : 'high';
}

export function riskBadge(score) {
  return translate(`common.${riskKey(score)}Risk`);
}

export function confidenceScore(project = {}) {
  const data = project.realData || {};
  const checks = [
    Number(data.holderCount || project.holders || 0) > 0,
    data.topHolderPercent !== null && data.topHolderPercent !== undefined,
    data.topTenHolderPercent !== null && data.topTenHolderPercent !== undefined,
    data.tokenAgeDays !== null && data.tokenAgeDays !== undefined,
    Number(data.totalLiquidityUsd ?? data.liquidityUsd ?? 0) > 0,
    Number(data.marketCapUsd || 0) > 0,
    socialPresenceState('website', project, data).state !== 'Data unavailable',
    socialPresenceState('twitter', project, data).state !== 'Data unavailable',
    socialPresenceState('telegram', project, data).state !== 'Data unavailable',
  ];
  const available = checks.filter(Boolean).length;
  if (available >= 7) return { label: translate('scoring.confidence.high'), available, total: checks.length };
  if (available >= 5) return { label: translate('scoring.confidence.medium'), available, total: checks.length };
  return { label: translate('scoring.confidence.limited'), available, total: checks.length };
}

export function riskFactors(project = {}) {
  const data = project.realData || {};
  const holders = Number(data.holderCount || project.holderCount || project.holders || project.communitySize || 0);
  const liquidity = Number(data.totalLiquidityUsd ?? data.liquidityUsd ?? 0);
  const tokenAgeDays = data.tokenAgeDays ?? (project.launchDate ? daysSince(project.launchDate) : null);
  const largestHolder = data.topHolderPercent;
  const topTen = data.topTenHolderPercent;
  const website = socialPresenceState('website', project, data);
  const twitter = socialPresenceState('twitter', project, data);
  const telegram = socialPresenceState('telegram', project, data);
  const github = socialPresenceState('github', project, data);

  const factors = [
    holderCountFactor(holders, data.holderSource),
    largestHolderFactor(largestHolder),
    topTenHolderFactor(topTen),
    tokenAgeFactor(tokenAgeDays),
    liquidityFactor(liquidity, data.poolCount),
    presenceFactor('website', website),
    presenceFactor('twitter', twitter),
    presenceFactor('telegram', telegram),
    presenceFactor('github', github),
  ];

  // Only shown when the authority/proxy status is actually known - unknown
  // chains or stale profiles never get a fabricated security verdict.
  if (data.mintAuthorityEnabled !== null && data.mintAuthorityEnabled !== undefined) {
    factors.push(authorityFactor('mint', data.mintAuthorityEnabled));
  }
  if (data.freezeAuthorityEnabled !== null && data.freezeAuthorityEnabled !== undefined) {
    factors.push(authorityFactor('freeze', data.freezeAuthorityEnabled));
  }
  if (data.upgradeable !== null && data.upgradeable !== undefined) {
    factors.push(upgradeableFactor(data.upgradeable));
  }

  return factors.sort((a, b) => riskSeverityRank(b.severity) - riskSeverityRank(a.severity));
}

export function authorityFactor(kind, enabled) {
  const title = translate(kind === 'mint' ? 'scoring.factors.mintAuthorityTitle' : 'scoring.factors.freezeAuthorityTitle');
  if (enabled) {
    return {
      title,
      severity: 'High',
      signal: translate('scoring.factors.authorityEnabledSignal'),
      value: translate('scoring.factors.authorityEnabledValue'),
      explanation: translate(kind === 'mint' ? 'scoring.factors.mintAuthorityEnabledExplain' : 'scoring.factors.freezeAuthorityEnabledExplain'),
    };
  }
  return {
    title,
    severity: 'Low',
    signal: translate('scoring.factors.authorityDisabledSignal'),
    value: translate('scoring.factors.authorityDisabledValue'),
    explanation: translate(kind === 'mint' ? 'scoring.factors.mintAuthorityDisabledExplain' : 'scoring.factors.freezeAuthorityDisabledExplain'),
  };
}

export function upgradeableFactor(upgradeable) {
  const title = translate('scoring.factors.upgradeableTitle');
  if (upgradeable) {
    return {
      title,
      severity: 'High',
      signal: translate('scoring.factors.upgradeableYesSignal'),
      value: translate('scoring.factors.authorityEnabledValue'),
      explanation: translate('scoring.factors.upgradeableYesExplain'),
    };
  }
  return {
    title,
    severity: 'Low',
    signal: translate('scoring.factors.upgradeableNoSignal'),
    value: translate('scoring.factors.authorityDisabledValue'),
    explanation: translate('scoring.factors.upgradeableNoExplain'),
  };
}

export function holderCountFactor(holders, source = '') {
  const title = translate('scoring.factors.holderCountTitle');
  if (!holders) {
    return {
      title,
      severity: 'Limited',
      signal: translate('scoring.factors.holderCountUnavailableSignal'),
      value: translate('common.notAvailable'),
      explanation: translate('scoring.factors.holderCountUnavailableExplain'),
    };
  }
  const sourceText = source ? translate('scoring.factors.viaSource', { source }) : '';
  if (holders < 100) {
    return {
      title,
      severity: 'High',
      signal: translate('scoring.factors.holderCountVeryLowSignal'),
      value: formatNumber(holders),
      explanation: translate('scoring.factors.holderCountVeryLowExplain', { count: formatNumber(holders), sourceText }),
    };
  }
  if (holders < 500) {
    return {
      title,
      severity: 'Medium',
      signal: translate('scoring.factors.holderCountLowSignal'),
      value: formatNumber(holders),
      explanation: translate('scoring.factors.holderCountLowExplain', { count: formatNumber(holders) }),
    };
  }
  return {
    title,
    severity: 'Low',
    signal: translate('scoring.factors.holderCountOkSignal'),
    value: formatNumber(holders),
    explanation: translate('scoring.factors.holderCountOkExplain', { count: formatNumber(holders) }),
  };
}

export function largestHolderFactor(percent) {
  const title = translate('scoring.factors.largestHolderTitle');
  if (percent === null || percent === undefined) {
    return {
      title,
      severity: 'Limited',
      signal: translate('scoring.factors.largestHolderUnavailableSignal'),
      value: translate('common.notAvailable'),
      explanation: translate('scoring.factors.largestHolderUnavailableExplain'),
    };
  }
  if (percent > 35) {
    return {
      title,
      severity: 'High',
      signal: translate('scoring.factors.largestHolderHighSignal'),
      value: formatPercent(percent),
      explanation: translate('scoring.factors.largestHolderHighExplain', { percent: formatPercent(percent) }),
    };
  }
  if (percent > 20) {
    return {
      title,
      severity: 'Medium',
      signal: translate('scoring.factors.largestHolderMediumSignal'),
      value: formatPercent(percent),
      explanation: translate('scoring.factors.largestHolderMediumExplain', { percent: formatPercent(percent) }),
    };
  }
  return {
    title,
    severity: 'Low',
    signal: translate('scoring.factors.largestHolderLowSignal'),
    value: formatPercent(percent),
    explanation: translate('scoring.factors.largestHolderLowExplain', { percent: formatPercent(percent) }),
  };
}

export function topTenHolderFactor(percent) {
  const title = translate('scoring.factors.topTenTitle');
  if (percent === null || percent === undefined) {
    return {
      title,
      severity: 'Limited',
      signal: translate('scoring.factors.topTenUnavailableSignal'),
      value: translate('common.notAvailable'),
      explanation: translate('scoring.factors.topTenUnavailableExplain'),
    };
  }
  if (percent > 70) {
    return {
      title,
      severity: 'High',
      signal: translate('scoring.factors.topTenHighSignal'),
      value: formatPercent(percent),
      explanation: translate('scoring.factors.topTenHighExplain', { percent: formatPercent(percent) }),
    };
  }
  if (percent > 50) {
    return {
      title,
      severity: 'Medium',
      signal: translate('scoring.factors.topTenMediumSignal'),
      value: formatPercent(percent),
      explanation: translate('scoring.factors.topTenMediumExplain', { percent: formatPercent(percent) }),
    };
  }
  return {
    title,
    severity: 'Low',
    signal: translate('scoring.factors.topTenLowSignal'),
    value: formatPercent(percent),
    explanation: translate('scoring.factors.topTenLowExplain', { percent: formatPercent(percent) }),
  };
}

export function tokenAgeFactor(days) {
  const title = translate('scoring.factors.tokenAgeTitle');
  if (days === null || days === undefined || Number.isNaN(days)) {
    return {
      title,
      severity: 'Limited',
      signal: translate('scoring.factors.tokenAgeUnavailableSignal'),
      value: translate('common.notAvailable'),
      explanation: translate('scoring.factors.tokenAgeUnavailableExplain'),
    };
  }
  if (days < 14) {
    return {
      title,
      severity: 'High',
      signal: translate('scoring.factors.tokenAgeHighSignal'),
      value: formatAge(days),
      explanation: translate('scoring.factors.tokenAgeHighExplain', { age: formatAge(days) }),
    };
  }
  if (days < 60) {
    return {
      title,
      severity: 'Medium',
      signal: translate('scoring.factors.tokenAgeMediumSignal'),
      value: formatAge(days),
      explanation: translate('scoring.factors.tokenAgeMediumExplain', { age: formatAge(days) }),
    };
  }
  return {
    title,
    severity: 'Low',
    signal: translate('scoring.factors.tokenAgeLowSignal'),
    value: formatAge(days),
    explanation: translate('scoring.factors.tokenAgeLowExplain', { age: formatAge(days) }),
  };
}

export function liquidityFactor(liquidity, poolCount = 0) {
  const title = translate('scoring.factors.liquidityTitle');
  if (!liquidity) {
    return {
      title,
      severity: 'Limited',
      signal: translate('scoring.factors.liquidityUnavailableSignal'),
      value: translate('common.notAvailable'),
      explanation: translate('scoring.factors.liquidityUnavailableExplain'),
    };
  }
  const poolText = poolCount ? translate('scoring.factors.acrossPools', { count: formatNumber(poolCount) }) : '';
  if (liquidity < 5000) {
    return {
      title,
      severity: 'High',
      signal: translate('scoring.factors.liquidityHighSignal'),
      value: formatCurrency(liquidity),
      explanation: translate('scoring.factors.liquidityHighExplain', { value: formatCurrency(liquidity), poolText }),
    };
  }
  if (liquidity < 50000) {
    return {
      title,
      severity: 'Medium',
      signal: translate('scoring.factors.liquidityMediumSignal'),
      value: formatCurrency(liquidity),
      explanation: translate('scoring.factors.liquidityMediumExplain', { value: formatCurrency(liquidity) }),
    };
  }
  return {
    title,
    severity: 'Low',
    signal: translate('scoring.factors.liquidityLowSignal'),
    value: formatCurrency(liquidity),
    explanation: translate('scoring.factors.liquidityLowExplain', { value: formatCurrency(liquidity), poolText }),
  };
}

export const PRESENCE_FACTOR_KEYS = {
  website: { title: 'presenceWebsiteTitle', ok: 'presenceWebsiteOk', missing: 'presenceWebsiteMissing', explain: 'presenceWebsiteExplain' },
  twitter: { title: 'presenceTwitterTitle', ok: 'presenceTwitterOk', missing: 'presenceTwitterMissing', explain: 'presenceTwitterExplain' },
  telegram: { title: 'presenceTelegramTitle', ok: 'presenceTelegramOk', missing: 'presenceTelegramMissing', explain: 'presenceTelegramExplain' },
  github: { title: 'presenceGithubTitle', ok: 'presenceGithubOk', missing: 'presenceGithubMissing', explain: 'presenceGithubExplain' },
};

export function presenceFactor(kind, presence) {
  const keys = PRESENCE_FACTOR_KEYS[kind];
  const title = translate(`scoring.factors.${keys.title}`);
  if (presence.state === 'Present') {
    const okSignal = translate(`scoring.factors.${keys.ok}`);
    return {
      title,
      severity: 'Low',
      signal: okSignal,
      value: translate('scoring.factors.presenceFound', { value: presence.value }),
      explanation: `${okSignal}: ${presence.value}`,
    };
  }
  if (presence.state === 'Data unavailable') {
    return {
      title,
      severity: 'Limited',
      signal: translate('common.dataUnavailable'),
      value: translate('common.dataUnavailable'),
      explanation: translate('scoring.factors.presenceDataUnavailable', { title: title.toLowerCase() }),
    };
  }
  return {
    title,
    severity: 'Medium',
    signal: translate(`scoring.factors.${keys.missing}`),
    value: translate('common.missing'),
    explanation: translate(`scoring.factors.${keys.explain}`),
  };
}

export function riskSeverityRank(severity) {
  return { Low: 1, Limited: 2, Medium: 3, High: 4 }[severity] || 0;
}

export function riskSignals(project = {}) {
  return riskFactors(project).map((factor) => ({
    label: factor.title,
    value: factor.severity,
    detail: factor.explanation,
  }));
}

export function holderRiskLabel(data = {}, holders = 0) {
  if (data.topHolderPercent > 35 || data.topTenHolderPercent > 70) return 'High';
  if (data.topHolderPercent > 20 || data.topTenHolderPercent > 50 || (holders > 0 && holders < 500)) return 'Medium';
  if (holders >= 500 || data.topHolderPercent !== null) return 'Low';
  return 'Limited data';
}

export function holderRiskDetail(data = {}, holders = 0) {
  if (!holders && data.topHolderPercent === null) return 'Holder count and concentration need more public data.';
  const holderText = holders ? `${formatNumber(holders)} holders found` : 'Holder count not available';
  const topHolderText = data.topHolderPercent === null || data.topHolderPercent === undefined
    ? 'top holder data unavailable'
    : `largest holder at ${formatPercent(data.topHolderPercent)}`;
  return `${holderText}; ${topHolderText}.`;
}

export function liquidityRiskLabel(liquidity = 0) {
  if (!liquidity) return 'Limited data';
  if (liquidity < 5000) return 'High';
  if (liquidity < 50000) return 'Medium';
  return 'Low';
}

export function socialRiskLabel(count = 0) {
  if (count <= 1) return 'High';
  if (count <= 2) return 'Medium';
  return 'Low';
}

export function founderRoadmapLabel(project = {}) {
  if (project.founderStatus?.toLowerCase().includes('anonymous')) return 'High';
  if (!hasRoadmap(project)) return 'Medium';
  if (isPublicFounder(project.founderStatus)) return 'Low';
  return 'Medium';
}

export function plainRiskExplanation(project = {}) {
  const score = project.trustScore || 0;
  if (score >= 78) {
    return translate('scoring.plainExplanation.strong');
  }
  if (score >= 55) {
    return translate('scoring.plainExplanation.mixed');
  }
  return translate('scoring.plainExplanation.weak');
}
