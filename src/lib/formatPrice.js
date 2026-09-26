// Dollar amounts at the precision they deserve. Two fraction digits is right
// for a holding worth $1,234.56 and wrong for KHAN's unit price, which it
// rounded to "$0": below one cent, four significant digits are kept instead
// ($0.000003544). A real zero still reads $0. Returns null for a missing or
// non-numeric value so the caller renders "not available" - never $0.
export function formatUsdAmount(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n !== 0 && Math.abs(n) < 0.01) {
    return `$${n.toLocaleString('en-US', { maximumSignificantDigits: 4, maximumFractionDigits: 20 })}`;
  }
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}
