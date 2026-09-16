/* ============================================================================
   selectors.js — derived data, memoised on a key built from everything that
   can change the answer. Filtering 69 rows is cheap, but the calendar and the
   day rail each ask for the same slices repeatedly during one render.
   ========================================================================== */

import { state, FILTER_FIELDS, monthKeyOfState } from './state.js';
import {
  PLATFORM_ORDER, TYPE_ORDER, STATUS_ORDER, STATUS_SETTLED, UPCOMING_WINDOW_DAYS,
} from './config.js';
import { monthDayKeys, todayKey, shiftKey } from './dates.js';
import { groupBy, orderedEntries } from './utils.js';

function cacheKey() {
  const f = FILTER_FIELDS.map((k) => Array.from(state.filters[k]).sort().join('.')).join('|');
  return `${state.posts.length}|${state.syncedAt}|${monthKeyOfState()}|${f}|` +
         `${state.filters.overdueOnly ? 'od' : ''}`;
}

function fresh() {
  const key = cacheKey();
  if (state._cache.key === key) return false;
  state._cache = { key, filtered: null, byDay: null, stats: null };
  return true;
}

/**
 * A posting whose date has gone by without ever being marked Posted.
 *
 * Derived on demand rather than stored on the record, because "today" moves:
 * a page left open overnight would otherwise keep yesterday's answer.
 *
 * Rescheduled rows count. The row still carries the date that passed, and
 * something was meant to go out on it - the note says where it moved to.
 */
export const isOverdue = (p) => p.statusKey !== 'posted' && p.dateKey < todayKey();

/** Every overdue posting in the tracker, oldest first. Ignores the filters. */
export function getOverdue() {
  return state.posts.filter(isOverdue).sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

/**
 * A posting due today or in the next couple of days that has not gone out yet.
 *
 * Deliberately keyed on the DATE rather than on the exact timestamp. Every row
 * in this tracker carries 12:00 AM, so a timestamp window would count today's
 * posts as already in the past by one minute after midnight and never warn
 * anybody about them. The day is the unit the team plans in, so the day is the
 * unit the warning uses.
 *
 * Anything already past its date is the other notification's problem, so the
 * two never describe the same posting.
 */
export function isUpcoming(p) {
  if (p.statusKey === 'posted') return false;
  const today = todayKey();
  return p.dateKey >= today && p.dateKey <= shiftKey(today, UPCOMING_WINDOW_DAYS);
}

/** Every posting coming up inside that window, soonest first. Ignores filters. */
export function getUpcoming() {
  return state.posts.filter(isUpcoming).sort((a, b) =>
    a.dateKey.localeCompare(b.dateKey) || a.minuteOfDay - b.minuteOfDay);
}

const passes = (p) => {
  const f = state.filters;
  if (f.overdueOnly && !isOverdue(p)) return false;
  if (f.brands.size && !f.brands.has(p.brandKey)) return false;
  // A crosspost survives a platform filter if ANY of its platforms match.
  if (f.platforms.size && !p.platformKeys.some((k) => f.platforms.has(k))) return false;
  if (f.statuses.size && !f.statuses.has(p.statusKey)) return false;
  if (f.types.size && !f.types.has(p.typeKey)) return false;
  return true;
};

/**
 * Which of a post's platforms should actually be drawn.
 *
 * A crosspost is one row in the tracker but two things in the world - a
 * Facebook post and an Instagram post - so every view renders it once per
 * platform. With a platform filter active, only the matching ones are drawn,
 * otherwise filtering to Instagram would still show you the Facebook mock.
 */
export function visiblePlatforms(post) {
  const f = state.filters;
  if (!f.platforms.size) return post.platformKeys;
  return post.platformKeys.filter((k) => f.platforms.has(k));
}

/** Flatten posts into one entry per visible platform, in display order. */
export function expandByPlatform(posts) {
  const rank = new Map(PLATFORM_ORDER.map((k, i) => [k, i]));
  const out = [];
  for (const post of posts) {
    const keys = visiblePlatforms(post).slice()
      .sort((a, b) => (rank.get(a) ?? 99) - (rank.get(b) ?? 99));
    for (const platformKey of keys) {
      out.push({ post, platformKey, key: `${post.id}::${platformKey}` });
    }
  }
  return out;
}

/** Every post matching the filters, regardless of month. Stats uses this. */
export function getFiltered() {
  fresh();
  if (!state._cache.filtered) {
    state._cache.filtered = state.posts.filter(passes);
  }
  return state._cache.filtered;
}

/** Posts in the selected month only, matching the filters. */
export function getMonthPosts() {
  const mk = monthKeyOfState();
  return getFiltered().filter((p) => p.monthKey === mk);
}

/** Map<dateKey, Post[]> for the selected month, each day sorted by time. */
export function getByDay() {
  fresh();
  if (!state._cache.byDay) {
    const m = groupBy(getMonthPosts(), (p) => p.dateKey);
    for (const arr of m.values()) {
      arr.sort((a, b) =>
        a.minuteOfDay - b.minuteOfDay ||
        a.brandKey.localeCompare(b.brandKey) ||
        a.row - b.row);
    }
    state._cache.byDay = m;
  }
  return state._cache.byDay;
}

/**
 * For one calendar cell: posts grouped by brand, and within each brand grouped
 * by platform with a count. This is exactly the shape the cell chips need.
 */
export function brandChipsFor(posts) {
  const byBrand = groupBy(posts, (p) => p.brandKey);
  const out = [];
  for (const [brandKey, list] of byBrand) {
    const byPlatform = new Map();
    for (const p of list) {
      for (const pk of visiblePlatforms(p)) {
        byPlatform.set(pk, (byPlatform.get(pk) || 0) + 1);
      }
    }
    out.push({
      brandKey,
      total: list.length,
      platforms: orderedEntries(byPlatform, PLATFORM_ORDER)
        .map(([platformKey, count]) => ({ platformKey, count })),
    });
  }
  out.sort((a, b) => b.total - a.total || a.brandKey.localeCompare(b.brandKey));
  return out;
}

/* --------------------------------- stats ---------------------------------- */

const tally = (list, keyFn) => {
  const m = new Map();
  for (const p of list) { const k = keyFn(p); m.set(k, (m.get(k) || 0) + 1); }
  return m;
};

export function getStats() {
  fresh();
  if (state._cache.stats) return state._cache.stats;

  const all = state.posts;
  const shown = getFiltered();

  const byBrand = tally(shown, (p) => p.brandKey);
  const byType = tally(shown, (p) => p.typeKey);
  const byStatus = tally(shown, (p) => p.statusKey);
  const byDate = tally(shown, (p) => p.dateKey);

  // A crosspost counts once per platform here, so these totals can exceed the
  // row count. That is the honest answer to "how many Instagram posts?".
  const byPlatform = new Map();
  const matrix = new Map();
  let placements = 0;
  for (const p of shown) {
    if (!matrix.has(p.brandKey)) matrix.set(p.brandKey, new Map());
    const row = matrix.get(p.brandKey);
    for (const pk of visiblePlatforms(p)) {
      byPlatform.set(pk, (byPlatform.get(pk) || 0) + 1);
      row.set(pk, (row.get(pk) || 0) + 1);
      placements += 1;
    }
  }
  const crossposts = shown.filter((p) => visiblePlatforms(p).length > 1).length;
  const overdue = shown.filter(isOverdue).length;

  const dates = Array.from(byDate.keys()).sort();
  const posted = byStatus.get('posted') || 0;
  const needs = byStatus.get('needs-action') || 0;
  // Everything signed off - approved, scheduled or already live - against
  // everything still needing someone to do something.
  const settled = STATUS_SETTLED.reduce((n, k) => n + (byStatus.get(k) || 0), 0);

  let busiest = { key: '', n: 0 };
  for (const [k, n] of byDate) if (n > busiest.n) busiest = { key: k, n };

  // Content readiness — which rows the team still has to fill in.
  const withCaption = shown.filter((p) => p.hasCaption).length;
  const withAsset = shown.filter((p) => p.filesUrl).length;
  const withLink = shown.filter((p) => p.postLink).length;
  const incomplete = shown.filter((p) => p.incomplete).length;

  const mk = monthKeyOfState();
  const monthKeys = state.month ? monthDayKeys(state.month.y, state.month.mo) : [];
  // Split each day into shipped and not, so the timeline shows progress rather
  // than just volume.
  const postedByDate = new Map();
  for (const p of shown) {
    if (p.statusKey !== 'posted') continue;
    postedByDate.set(p.dateKey, (postedByDate.get(p.dateKey) || 0) + 1);
  }
  const perDay = monthKeys.map((k) => {
    const n = byDate.get(k) || 0;
    const done = postedByDate.get(k) || 0;
    return { key: k, n, posted: done, other: n - done };
  });

  const stats = {
    total: all.length,
    shown: shown.length,
    placements,
    crossposts,
    overdue,
    byBrand,
    byBrandPlacements: (() => {
      const m = new Map();
      for (const [bk, row] of matrix) {
        let n = 0;
        for (const v of row.values()) n += v;
        m.set(bk, n);
      }
      return m;
    })(),
    byPlatform: orderedEntries(byPlatform, PLATFORM_ORDER),
    byType: orderedEntries(byType, TYPE_ORDER),
    byStatus: orderedEntries(byStatus, STATUS_ORDER),
    byDate,
    matrix,
    perDay,
    monthKey: mk,
    posted,
    needs,
    settled,
    settledPct: shown.length ? Math.round((settled / shown.length) * 100) : 0,
    postedPct: shown.length ? Math.round((posted / shown.length) * 100) : 0,
    daysWithContent: dates.length,
    avgPerDay: dates.length ? (shown.length / dates.length) : 0,
    busiest,
    firstDate: dates[0] || '',
    lastDate: dates[dates.length - 1] || '',
    readiness: [
      { label: 'Has a caption',   n: withCaption, of: shown.length, hue: 'var(--accent)' },
      { label: 'Has an asset link', n: withAsset, of: shown.length, hue: 'var(--pf-instagram)' },
      { label: 'Has a live post link', n: withLink, of: shown.length, hue: 'var(--st-posted)' },
    ],
    incomplete,
    today: todayKey(),
  };
  state._cache.stats = stats;
  return stats;
}
