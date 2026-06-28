import { jsPDF } from 'jspdf';

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 16;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const COLORS = {
  bg: [5, 5, 5],
  gold: [224, 183, 92],
  goldBright: [244, 216, 137],
  text: [28, 24, 16],
  muted: [120, 112, 94],
  danger: [196, 54, 48],
  warning: [178, 122, 18],
  success: [36, 140, 92],
};

function riskColor(level = '') {
  const normalized = String(level).toLowerCase();
  if (normalized === 'low') return COLORS.success;
  if (normalized === 'high') return COLORS.danger;
  return COLORS.warning;
}

// jsPDF's bundled "helvetica" font only covers WinAnsi (Latin) glyphs. English,
// Azerbaijani, and Turkish labels render correctly; Cyrillic (Russian) labels
// will fall back to missing glyphs unless a Unicode font is embedded via
// doc.addFont() - tracked as a follow-up, separate from this translation wiring.
const DEFAULT_LABELS = {
  tagline: 'Trust before hype.',
  reportTitle: 'TOKEN RISK REPORT',
  unknownToken: 'Unknown token',
  unknownChain: 'Unknown chain',
  verifiedBadge: 'VERIFIED BY KHAN TRUST',
  verificationStatusLine: 'Verification status: {{status}}',
  trustScore: 'Trust Score',
  confidenceScore: 'Confidence Score',
  riskLevel: 'Risk Level',
  mainRiskReasons: 'Main Risk Reasons',
  noRiskReasons: 'No major public risk reasons were available for this scan.',
  riskNotesTitle: 'Risk Notes',
  noRiskNotes: 'No additional risk notes were provided.',
  socialLinksTitle: 'Social Links',
  website: 'Website',
  twitter: 'X / Twitter',
  telegram: 'Telegram',
  github: 'GitHub',
  holderDataTitle: 'Holder Data',
  holderCount: 'Holder Count',
  largestHolderPercent: 'Largest Holder %',
  topTenHolderPercent: 'Top 10 Holders %',
  liquidityDataTitle: 'Liquidity Data',
  liquidityUsd: 'Liquidity (USD)',
  marketCapUsd: 'Market Cap (USD)',
  tokenAge: 'Token Age',
  breakdownTitle: 'Trust Score Breakdown',
  noBreakdown: 'Score breakdown data was not available for this report.',
  footerDisclaimer: 'KHAN Trust does not provide financial advice. Scores are for research and risk awareness only.',
  pageOf: 'Page {{current}} of {{total}}',
  scoreLabels: {
    founderActivity: 'Founder activity',
    communityActivity: 'Community activity',
    roadmapClarity: 'Roadmap clarity',
    transparency: 'Transparency',
    tokenRisk: 'Token risk',
    socialProof: 'Social proof',
    marketCapScore: 'Market Cap Score',
    liquidityScore: 'Liquidity Score',
    holderScore: 'Holder Score',
    topHolderScore: 'Top Holder Score',
    topTenHolderScore: 'Top 10 Holder Score',
    tokenAgeScore: 'Token Age Score',
    websiteScore: 'Website Presence',
    twitterScore: 'X/Twitter Presence',
    telegramScore: 'Telegram Presence',
    socialScore: 'Social Score',
    holderGrowthScore: 'Holder Growth Score',
    supplyScore: 'Supply Score',
    finalTrustScore: 'Final Trust Score',
  },
};

function fillTemplate(template, params) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, name) => (params[name] !== undefined ? params[name] : match));
}

function drawHeader(doc, data, labels) {
  doc.setFillColor(...COLORS.bg);
  doc.rect(0, 0, PAGE_WIDTH, 30, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...COLORS.gold);
  doc.text('KHAN TRUST', MARGIN, 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(225, 220, 200);
  doc.text(labels.tagline, MARGIN, 21);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...COLORS.goldBright);
  doc.text(labels.reportTitle, PAGE_WIDTH - MARGIN, 14, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(200, 195, 178);
  doc.text(fillTemplate(labels.generatedDate || 'Generated {{date}}', { date: data.generatedDate }), PAGE_WIDTH - MARGIN, 21, { align: 'right' });
}

function drawFooter(doc, pageNumber, pageCount, labels) {
  doc.setDrawColor(...COLORS.gold);
  doc.setLineWidth(0.4);
  doc.line(MARGIN, PAGE_HEIGHT - 16, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...COLORS.muted);
  doc.text(labels.footerDisclaimer, MARGIN, PAGE_HEIGHT - 11);
  doc.text(fillTemplate(labels.pageOf, { current: pageNumber, total: pageCount }), PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 11, { align: 'right' });
}

function safeFileName(value = 'token') {
  return String(value).replace(/[^a-z0-9]+/gi, '-').replace(/(^-|-$)/g, '').toLowerCase() || 'token';
}

export function generatePdfReport(data = {}) {
  const labels = { ...DEFAULT_LABELS, ...(data.labels || {}), scoreLabels: { ...DEFAULT_LABELS.scoreLabels, ...(data.labels?.scoreLabels || {}) } };
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = 40;

  const ensureSpace = (needed) => {
    if (y + needed > PAGE_HEIGHT - 22) {
      doc.addPage();
      drawHeader(doc, data, labels);
      y = 40;
    }
  };

  const sectionTitle = (title) => {
    ensureSpace(12);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12.5);
    doc.setTextColor(...COLORS.text);
    doc.text(title, MARGIN, y);
    doc.setDrawColor(...COLORS.gold);
    doc.setLineWidth(0.6);
    doc.line(MARGIN, y + 2, PAGE_WIDTH - MARGIN, y + 2);
    y += 9;
  };

  const bodyText = (text, options = {}) => {
    const size = options.size || 9.5;
    doc.setFont('helvetica', options.bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...(options.color || COLORS.text));
    const lines = doc.splitTextToSize(String(text || ''), CONTENT_WIDTH);
    lines.forEach((line) => {
      ensureSpace(size / 2);
      doc.text(line, MARGIN, y);
      y += size / 2 + 1.2;
    });
  };

  const keyValueRow = (label, value) => {
    const valueLines = doc.splitTextToSize(String(value ?? 'N/A'), CONTENT_WIDTH - 55);
    ensureSpace(Math.max(6, valueLines.length * 5));
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...COLORS.muted);
    doc.text(label, MARGIN, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...COLORS.text);
    doc.text(valueLines, MARGIN + 55, y);
    y += Math.max(6, valueLines.length * 5);
  };

  drawHeader(doc, data, labels);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...COLORS.text);
  doc.text(`${data.name || labels.unknownToken} (${data.ticker || 'N/A'})`, MARGIN, y);
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...COLORS.muted);
  doc.text(`${data.chain || labels.unknownChain} - ${data.contract || 'N/A'}`, MARGIN, y);
  y += 7;

  if (data.isVerified) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...COLORS.success);
    doc.text(labels.verifiedBadge, MARGIN, y);
    y += 7;
  } else {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...COLORS.muted);
    doc.text(fillTemplate(labels.verificationStatusLine, { status: data.verificationStatus || 'N/A' }), MARGIN, y);
    y += 7;
  }
  y += 2;

  const boxWidth = (CONTENT_WIDTH - 12) / 3;
  const boxes = [
    [labels.trustScore, `${data.trustScore ?? 'N/A'}/100`, COLORS.gold],
    [labels.confidenceScore, data.confidenceLabel || 'N/A', COLORS.gold],
    [labels.riskLevel, data.riskLevel || 'N/A', riskColor(data.riskLevel)],
  ];
  ensureSpace(28);
  boxes.forEach(([label, value, color], index) => {
    const x = MARGIN + index * (boxWidth + 6);
    doc.setDrawColor(...color);
    doc.setLineWidth(0.5);
    doc.roundedRect(x, y, boxWidth, 22, 2, 2, 'S');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...COLORS.muted);
    doc.text(label, x + 4, y + 7);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...color);
    doc.text(String(value), x + 4, y + 16);
  });
  y += 32;

  sectionTitle(labels.mainRiskReasons);
  if (data.riskReasons?.length) {
    data.riskReasons.forEach((reason) => {
      bodyText(`${reason.label}: ${reason.value}`, { bold: true, size: 9.5 });
      bodyText(reason.detail || '', { size: 8.8, color: COLORS.muted });
      y += 2;
    });
  } else {
    bodyText(labels.noRiskReasons, { color: COLORS.muted });
  }

  sectionTitle(labels.riskNotesTitle);
  bodyText(data.riskNotes || labels.noRiskNotes, { color: COLORS.muted });
  y += 4;

  sectionTitle(labels.socialLinksTitle);
  keyValueRow(labels.website, data.socialLinks?.website);
  keyValueRow(labels.twitter, data.socialLinks?.twitter);
  keyValueRow(labels.telegram, data.socialLinks?.telegram);
  keyValueRow(labels.github, data.socialLinks?.github);
  y += 4;

  sectionTitle(labels.holderDataTitle);
  keyValueRow(labels.holderCount, data.holderData?.holderCount);
  keyValueRow(labels.largestHolderPercent, data.holderData?.topHolderPercent);
  keyValueRow(labels.topTenHolderPercent, data.holderData?.topTenHolderPercent);
  y += 4;

  sectionTitle(labels.liquidityDataTitle);
  keyValueRow(labels.liquidityUsd, data.liquidityData?.liquidityUsd);
  keyValueRow(labels.marketCapUsd, data.liquidityData?.marketCapUsd);
  keyValueRow(labels.tokenAge, data.tokenAge);

  sectionTitle(labels.breakdownTitle);
  const breakdown = Object.entries(data.scoreBreakdown || {});
  if (breakdown.length) {
    breakdown.forEach(([key, value]) => keyValueRow(labels.scoreLabels[key] || key, value === null ? 'N/A' : `${value}/100`));
  } else {
    bodyText(labels.noBreakdown, { color: COLORS.muted });
  }
  y += 4;

  sectionTitle(labels.deepAnalysisTitle || 'Deep Risk Analysis');
  keyValueRow(labels.assetCategory || 'Asset Category', data.assetCategory || 'N/A');
  keyValueRow(labels.confidenceScoreNumeric || 'Data Confidence', data.deepConfidenceScore !== null && data.deepConfidenceScore !== undefined ? `${data.deepConfidenceScore}%` : 'N/A');
  if (data.positiveSignals?.length) {
    bodyText(labels.positiveSignalsTitle || 'Positive Signals:', { bold: true, size: 9 });
    data.positiveSignals.forEach((signal) => bodyText(`+ ${signal}`, { size: 8.8, color: COLORS.success }));
  }
  if (data.hiddenRiskSignals?.length) {
    bodyText(labels.hiddenRiskSignalsTitle || 'Hidden Risk Signals:', { bold: true, size: 9 });
    data.hiddenRiskSignals.forEach((signal) => bodyText(`- ${signal}`, { size: 8.8, color: COLORS.muted }));
  }
  if (data.aiRiskSummary) {
    y += 2;
    bodyText(labels.aiSummaryTitle || 'AI Risk Summary:', { bold: true, size: 9 });
    bodyText(data.aiRiskSummary, { size: 8.8, color: COLORS.muted });
  }

  const pageCount = doc.getNumberOfPages();
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    doc.setPage(pageNumber);
    drawFooter(doc, pageNumber, pageCount, labels);
  }

  doc.save(`khan-trust-report-${safeFileName(data.ticker || data.name)}.pdf`);
}
