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

/* ---------------------------------------------------------------------------
   COUNTING

   A crosspost is one row in the tracker and several postings in the world: a
   row going out on Facebook and Instagram is two posts, drawn as two cards,
   landing in two feeds, needing two things to go right.

   So the unit every number on this page counts is the PLACEMENT - one post on
   one platform - not the sheet row. The views already worked this way, since
   expandByPlatform draws a crosspost once per platform; it was only the
   totals that still said 1, which is why a day could show two cards under a
   header reading "1 post".

   Two flavours, and the difference matters:

     countPosts    respects the platform filter, because it counts what is on
                   screen. Filtered to Instagram, a Facebook+Instagram row is
                   one post, not two.
     countAll      ignores it. For the "of 76" denominator and for the
                   notices, which deliberately speak about the whole tracker.
   ------------------------------------------------------------------------- */

/** How many postings a row is worth, whatever the filters say. */
export const placementsOf = (post) => post.platformKeys.length;

/** The same, narrowed to the platforms a filter leaves on screen. */
export const shownPlacementsOf = (post) => visiblePlatforms(post).length;

/** Postings in a list, counting only what the platform filter leaves. */
export const countPosts = (list) => list.reduce((n, p) => n + shownPlacementsOf(p), 0);

/** Postings in a list, ignoring the platform filter entirely. */
export const countAll = (list) => list.reduce((n, p) => n + placementsOf(p), 0);

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
      // Placements, so the group total agrees with the chips beside it.
      total: countPosts(list),
      platforms: orderedEntries(byPlatform, PLATFORM_ORDER)
        .map(([platformKey, count]) => ({ platformKey, count })),
    });
  }
  out.sort((a, b) => b.total - a.total || a.brandKey.localeCompare(b.brandKey));
  return out;
}

/* --------------------------------- stats ---------------------------------- */

/*
 * Every breakdown is weighted by placements, so a Facebook+Instagram row adds
 * two to its brand, its type, its status and its day - the same two it already
 * adds to the platform mix. Any other weighting and the charts on this tab
 * would disagree with each other about the same row.
 */
const tally = (list, keyFn) => {
  const m = new Map();
  for (const p of list) {
    const k = keyFn(p);
    m.set(k, (m.get(k) || 0) + shownPlacementsOf(p));
  }
  return m;
};

/** Postings in `list` that satisfy `test`, counted the same way. */
const countWhere = (list, test) => countPosts(list.filter(test));

export function getStats() {
  fresh();
  if (state._cache.stats) return state._cache.stats;

  const all = state.posts;
  const shown = getFiltered();

  const byBrand = tally(shown, (p) => p.brandKey);
  const byType = tally(shown, (p) => p.typeKey);
  const byStatus = tally(shown, (p) => p.statusKey);
  const byDate = tally(shown, (p) => p.dateKey);

  const byPlatform = new Map();
  const matrix = new Map();
  // Shipped placements, counted the same way, so a cell can read "7 of 11"
  // rather than a total that says nothing about progress.
  const matrixPosted = new Map();
  let placements = 0;
  for (const p of shown) {
    if (!matrix.has(p.brandKey)) matrix.set(p.brandKey, new Map());
    if (!matrixPosted.has(p.brandKey)) matrixPosted.set(p.brandKey, new Map());
    const row = matrix.get(p.brandKey);
    const done = matrixPosted.get(p.brandKey);
    for (const pk of visiblePlatforms(p)) {
      byPlatform.set(pk, (byPlatform.get(pk) || 0) + 1);
      row.set(pk, (row.get(pk) || 0) + 1);
      if (p.statusKey === 'posted') done.set(pk, (done.get(pk) || 0) + 1);
      placements += 1;
    }
  }
  // How many ROWS are crossposts - the one figure on this tab that is
  // deliberately about sheet rows, since it exists to explain the gap between
  // the row count and the post count.
  const crossposts = shown.filter((p) => shownPlacementsOf(p) > 1).length;
  const overdue = countWhere(shown, isOverdue);

  const dates = Array.from(byDate.keys()).sort();
  const posted = byStatus.get('posted') || 0;
  const needs = byStatus.get('needs-action') || 0;
  // Everything signed off - approved, scheduled or already live - against
  // everything still needing someone to do something.
  const settled = STATUS_SETTLED.reduce((n, k) => n + (byStatus.get(k) || 0), 0);

  let busiest = { key: '', n: 0 };
  for (const [k, n] of byDate) if (n > busiest.n) busiest = { key: k, n };

  // Content readiness — what the team still has to fill in. Counted in posts
  // like everything else: a crosspost with no caption is two posts with no
  // caption, because it is two things that go out unwritten.
  const withCaption = countWhere(shown, (p) => p.hasCaption);
  const withAsset = countWhere(shown, (p) => p.filesUrl);
  const withLink = countWhere(shown, (p) => p.postLink);
  // Rows, not posts: this one names sheet cells somebody has to go and fill.
  const incomplete = shown.filter((p) => p.incomplete).length;

  const mk = monthKeyOfState();
  const monthKeys = state.month ? monthDayKeys(state.month.y, state.month.mo) : [];
  // Split each day into shipped and not, so the timeline shows progress rather
  // than just volume.
  const postedByDate = new Map();
  for (const p of shown) {
    if (p.statusKey !== 'posted') continue;
    postedByDate.set(p.dateKey, (postedByDate.get(p.dateKey) || 0) + shownPlacementsOf(p));
  }
  const perDay = monthKeys.map((k) => {
    const n = byDate.get(k) || 0;
    const done = postedByDate.get(k) || 0;
    return { key: k, n, posted: done, other: n - done };
  });

  const stats = {
    /*
     * Posts, meaning placements. `rows` and `rowsShown` are the tracker's own
     * row counts, kept for the two figures that are honestly about rows.
     */
    total: countAll(all),
    shown: placements,
    rows: all.length,
    rowsShown: shown.length,
    crossposts,
    overdue,
    byBrand,
    byPlatform: orderedEntries(byPlatform, PLATFORM_ORDER),
    byType: orderedEntries(byType, TYPE_ORDER),
    byStatus: orderedEntries(byStatus, STATUS_ORDER),
    byDate,
    matrix,
    matrixPosted,
    perDay,
    monthKey: mk,
    posted,
    needs,
    settled,
    settledPct: placements ? Math.round((settled / placements) * 100) : 0,
    postedPct: placements ? Math.round((posted / placements) * 100) : 0,
    daysWithContent: dates.length,
    avgPerDay: dates.length ? (placements / dates.length) : 0,
    busiest,
    firstDate: dates[0] || '',
    lastDate: dates[dates.length - 1] || '',
    readiness: [
      { label: 'Has a caption',   n: withCaption, of: placements, hue: 'var(--accent)' },
      { label: 'Has an asset link', n: withAsset, of: placements, hue: 'var(--pf-instagram)' },
      { label: 'Has a live post link', n: withLink, of: placements, hue: 'var(--st-posted)' },
    ],
    incomplete,
    today: todayKey(),
  };
  state._cache.stats = stats;
  return stats;
}
