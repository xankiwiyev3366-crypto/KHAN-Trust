// Asia/Baku calendar time, shared by the holder-analytics functions and the
// admin page so "today", chart day buckets and every rendered timestamp agree.
//
// A fixed UTC+4 offset, deliberately, instead of Intl timeZone lookups:
// Azerbaijan abolished daylight saving in 2016, so the offset is constant, and
// arithmetic gives the same answer in a Lambda, in Node tests and in any
// browser - never "whatever timezone the viewer's machine is in", which is how
// admin dates used to render.
export const BAKU_TIME_ZONE = 'Asia/Baku';
export const BAKU_OFFSET_MS = 4 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function valid(timestamp) {
  const n = typeof timestamp === 'number' ? timestamp : Number(new Date(timestamp));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Wall-clock parts of `timestamp` as read on a clock in Baku.
function bakuParts(timestamp) {
  const d = new Date(timestamp + BAKU_OFFSET_MS);
  const pad = (v) => String(v).padStart(2, '0');
  return {
    yyyy: String(d.getUTCFullYear()),
    mm: pad(d.getUTCMonth() + 1),
    dd: pad(d.getUTCDate()),
    hh: pad(d.getUTCHours()),
    mi: pad(d.getUTCMinutes()),
    ss: pad(d.getUTCSeconds()),
  };
}

// 'YYYY-MM-DD' of the Baku calendar day containing `timestamp`.
export function bakuDayKey(timestamp) {
  const t = valid(timestamp);
  if (t === null) return null;
  const p = bakuParts(t);
  return `${p.yyyy}-${p.mm}-${p.dd}`;
}

// UTC epoch ms of 00:00:00 Baku on the day containing `timestamp`.
export function startOfBakuDay(timestamp) {
  const t = valid(timestamp);
  if (t === null) return null;
  return Math.floor((t + BAKU_OFFSET_MS) / DAY_MS) * DAY_MS - BAKU_OFFSET_MS;
}

// '26.09.2026, 19:02:00'
export function formatBakuDateTime(timestamp) {
  const t = valid(timestamp);
  if (t === null) return '';
  const p = bakuParts(t);
  return `${p.dd}.${p.mm}.${p.yyyy}, ${p.hh}:${p.mi}:${p.ss}`;
}

// '26.09.2026'
export function formatBakuDate(timestamp) {
  const t = valid(timestamp);
  if (t === null) return '';
  const p = bakuParts(t);
  return `${p.dd}.${p.mm}.${p.yyyy}`;
}

// '19:02:00'
export function formatBakuTime(timestamp) {
  const t = valid(timestamp);
  if (t === null) return '';
  const p = bakuParts(t);
  return `${p.hh}:${p.mi}:${p.ss}`;
}
