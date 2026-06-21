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

function drawHeader(doc, data) {
  doc.setFillColor(...COLORS.bg);
  doc.rect(0, 0, PAGE_WIDTH, 30, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...COLORS.gold);
  doc.text('KHAN TRUST', MARGIN, 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(225, 220, 200);
  doc.text('Trust before hype.', MARGIN, 21);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...COLORS.goldBright);
  doc.text('TOKEN RISK REPORT', PAGE_WIDTH - MARGIN, 14, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(200, 195, 178);
  doc.text(`Generated ${data.generatedDate}`, PAGE_WIDTH - MARGIN, 21, { align: 'right' });
}

function drawFooter(doc, pageNumber, pageCount) {
  doc.setDrawColor(...COLORS.gold);
  doc.setLineWidth(0.4);
  doc.line(MARGIN, PAGE_HEIGHT - 16, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...COLORS.muted);
  doc.text(
    'KHAN Trust does not provide financial advice. Scores are for research and risk awareness only.',
    MARGIN,
    PAGE_HEIGHT - 11
  );
  doc.text(`Page ${pageNumber} of ${pageCount}`, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 11, { align: 'right' });
}

function safeFileName(value = 'token') {
  return String(value).replace(/[^a-z0-9]+/gi, '-').replace(/(^-|-$)/g, '').toLowerCase() || 'token';
}

export function generatePdfReport(data = {}) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = 40;

  const ensureSpace = (needed) => {
    if (y + needed > PAGE_HEIGHT - 22) {
      doc.addPage();
      drawHeader(doc, data);
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
    const valueLines = doc.splitTextToSize(String(value ?? 'Not available'), CONTENT_WIDTH - 55);
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

  drawHeader(doc, data);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...COLORS.text);
  doc.text(`${data.name || 'Unknown token'} (${data.ticker || 'N/A'})`, MARGIN, y);
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...COLORS.muted);
  doc.text(`${data.chain || 'Unknown chain'} - ${data.contract || 'Not provided'}`, MARGIN, y);
  y += 12;

  const boxWidth = (CONTENT_WIDTH - 12) / 3;
  const boxes = [
    ['Trust Score', `${data.trustScore ?? 'N/A'}/100`, COLORS.gold],
    ['Confidence Score', data.confidenceLabel || 'Not available', COLORS.gold],
    ['Risk Level', data.riskLevel || 'Not available', riskColor(data.riskLevel)],
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

  sectionTitle('Main Risk Reasons');
  if (data.riskReasons?.length) {
    data.riskReasons.forEach((reason) => {
      bodyText(`${reason.label}: ${reason.value}`, { bold: true, size: 9.5 });
      bodyText(reason.detail || '', { size: 8.8, color: COLORS.muted });
      y += 2;
    });
  } else {
    bodyText('No major public risk reasons were available for this scan.', { color: COLORS.muted });
  }

  sectionTitle('Risk Notes');
  bodyText(data.riskNotes || 'No additional risk notes were provided.', { color: COLORS.muted });
  y += 4;

  sectionTitle('Social Links');
  keyValueRow('Website', data.socialLinks?.website);
  keyValueRow('X / Twitter', data.socialLinks?.twitter);
  keyValueRow('Telegram', data.socialLinks?.telegram);
  keyValueRow('GitHub', data.socialLinks?.github);
  y += 4;

  sectionTitle('Holder Data');
  keyValueRow('Holder Count', data.holderData?.holderCount);
  keyValueRow('Largest Holder %', data.holderData?.topHolderPercent);
  keyValueRow('Top 10 Holders %', data.holderData?.topTenHolderPercent);
  y += 4;

  sectionTitle('Liquidity Data');
  keyValueRow('Liquidity (USD)', data.liquidityData?.liquidityUsd);
  keyValueRow('Market Cap (USD)', data.liquidityData?.marketCapUsd);

  const pageCount = doc.getNumberOfPages();
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    doc.setPage(pageNumber);
    drawFooter(doc, pageNumber, pageCount);
  }

  doc.save(`khan-trust-report-${safeFileName(data.ticker || data.name)}.pdf`);
}
