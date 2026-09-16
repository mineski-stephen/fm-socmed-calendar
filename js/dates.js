/* ============================================================================
   dates.js — date and time parsing, and the string keys everything buckets on.

   Two rules hold this together:
     1. Never `new Date(someString)`. Implementations disagree, and an ISO-ish
        string is parsed as UTC, which slides a midnight post to the previous
        day in any negative-offset timezone.
     2. Never derive a key from a Date via toISOString(). Keys are built with
        string maths from the parsed y/m/d, so they cannot drift.
   ========================================================================== */

import { MONTHS, MONTH_ABBR, MONTH_NAMES, DAY_NAMES } from './config.js';
import { pad2 } from './utils.js';

/**
 * "Sep 11, 2026 (Fri)" -> { y: 2026, mo: 8, d: 11 }
 * The "(Fri)" tail is intentionally ignored: it is derived data in the sheet,
 * and the parsed date is authoritative.
 */
export function parseSheetDate(s) {
  const m = /^\s*([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s*(\d{4})/.exec(String(s ?? ''));
  if (!m) return null;
  const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
  if (mo == null) return null;
  const d = +m[2], y = +m[3];
  if (!(d >= 1 && d <= 31) || !(y >= 1970 && y <= 3000)) return null;
  return { y, mo, d };
}

/** "12:00:00 AM" -> { h: 0, min: 0 }. Missing or unparseable time -> midnight. */
export function parseSheetTime(s) {
  const m = /^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp])?/.exec(String(s ?? ''));
  if (!m) return { h: 0, min: 0, known: false };
  let h = +m[1];
  const min = +m[2];
  const ap = (m[4] || '').toLowerCase();
  if (ap === 'a' && h === 12) h = 0;
  else if (ap === 'p' && h !== 12) h += 12;
  return { h: h % 24, min: min % 60, known: true };
}

/** Local Date. Used only for weekday lookup and display, never for keys. */
export const makeLocalDate = ({ y, mo, d }, h = 0, min = 0) => new Date(y, mo, d, h, min, 0, 0);

export const dateKeyOf = ({ y, mo, d }) => `${y}-${pad2(mo + 1)}-${pad2(d)}`;
export const monthKeyOf = ({ y, mo }) => `${y}-${pad2(mo + 1)}`;

/** Split a "2026-09-11" key back into numbers. */
export function partsFromKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key ?? ''));
  if (!m) return null;
  return { y: +m[1], mo: +m[2] - 1, d: +m[3] };
}

/** Today, as the same kind of key the posts use. */
export function todayKey() {
  const n = new Date();
  return `${n.getFullYear()}-${pad2(n.getMonth() + 1)}-${pad2(n.getDate())}`;
}

export const daysInMonth = (y, mo) => new Date(y, mo + 1, 0).getDate();

/** Every dateKey in a month, in order. */
export function monthDayKeys(y, mo) {
  const n = daysInMonth(y, mo);
  const out = [];
  for (let d = 1; d <= n; d++) out.push(`${y}-${pad2(mo + 1)}-${pad2(d)}`);
  return out;
}

/**
 * The 6x7 grid of a month, Sunday-first, padded with the tail of the previous
 * month and the head of the next so every row is full.
 */
export function calendarMatrix(y, mo) {
  const first = new Date(y, mo, 1);
  const lead = first.getDay();                  // 0 = Sunday
  const total = daysInMonth(y, mo);
  const cells = [];

  const prevMo = mo - 1 < 0 ? 11 : mo - 1;
  const prevY = mo - 1 < 0 ? y - 1 : y;
  const prevTotal = daysInMonth(prevY, prevMo);
  for (let i = lead - 1; i >= 0; i--) {
    const d = prevTotal - i;
    cells.push({ y: prevY, mo: prevMo, d, key: `${prevY}-${pad2(prevMo + 1)}-${pad2(d)}`, out: true });
  }
  for (let d = 1; d <= total; d++) {
    cells.push({ y, mo, d, key: `${y}-${pad2(mo + 1)}-${pad2(d)}`, out: false });
  }
  const nextMo = mo + 1 > 11 ? 0 : mo + 1;
  const nextY = mo + 1 > 11 ? y + 1 : y;
  let d = 1;
  while (cells.length % 7 !== 0) {
    cells.push({ y: nextY, mo: nextMo, d, key: `${nextY}-${pad2(nextMo + 1)}-${pad2(d)}`, out: true });
    d++;
  }
  return cells;
}

/* ------------------------------ formatting -------------------------------- */

export const fmtTime = (h, min) => {
  const ap = h < 12 ? 'AM' : 'PM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${pad2(min)} ${ap}`;
};

export const fmtLongDate = ({ y, mo, d }) => `${MONTH_NAMES[mo]} ${d}, ${y}`;
export const fmtShortDate = ({ y, mo, d }) => `${MONTH_ABBR[mo]} ${d}, ${y}`;
export const fmtSlashDate = ({ y, mo, d }) => `${mo + 1}/${d}/${String(y).slice(2)}`;
export const monthLabel = (y, mo) => `${MONTH_NAMES[mo]} ${y}`;
export const dowName = (date) => DAY_NAMES[date.getDay()];

/**
 * A timestamp a planner can trust. Posts in this tracker are mostly scheduled
 * in the future, and a mock reading "6 hours ago" on a post that has not
 * happened yet is actively misleading — so future posts say so.
 */
export function relativeLabel(parts, timeLabel) {
  const today = todayKey();
  const key = dateKeyOf(parts);
  if (key > today) return `Scheduled \u00b7 ${MONTH_ABBR[parts.mo]} ${parts.d}`;

  const then = makeLocalDate(parts);
  const now = new Date();
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - then) / 86400000);

  if (days <= 0) return timeLabel || 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) { const w = Math.floor(days / 7); return `${w} week${w > 1 ? 's' : ''} ago`; }
  return `${MONTH_ABBR[parts.mo]} ${parts.d}`;
}

/** "synced 2 min ago" for the app bar. */
export function sinceLabel(ms) {
  if (!ms) return 'never';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
