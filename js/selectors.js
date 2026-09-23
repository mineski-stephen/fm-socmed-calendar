/* ============================================================================
   selectors.js — derived data, memoised on a key built from everything that
   can change the answer. Filtering 69 rows is cheap, but the calendar and the
   day rail each ask for the same slices repeatedly during one render.
   ========================================================================== */

import { state, FILTER_FIELDS, monthKeyOfState } from './state.js';
import {
  PLATFORM_ORDER, TYPE_ORDER, STATUS_ORDER, STATUS_SETTLED, UPCOMING_WINDOW_DAYS, PLAN,
} from './config.js';
import { monthDayKeys, todayKey, shiftKey, daysInMonth } from './dates.js';
import { groupBy, orderedEntries } from './utils.js';

function cacheKey() {
  const f = FILTER_FIELDS.map((k) => Array.from(state.filters[k]).sort().join('.')).join('|');
  return `${state.posts.length}|${state.syncedAt}|${monthKeyOfState()}|${f}|` +
         `${state.filters.overdueOnly ? 'od' : ''}`;
}

function fresh() {
  const key = cacheKey();
  if (state._cache.key === key) return false;
  state._cache = { key, filtered: null, byDay: null, stats: null, plan: null };
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

   One row in the tracker is one post, however many platforms it goes out on.
   A Facebook+Instagram crosspost is one piece of creative and one deliverable
   against the monthly plan, so it counts once - in the app bar, "showing N of
   M", a day strip, a calendar cell, the notices, and every total on Stats.

   Two things deliberately do NOT follow that, because they are about
   platforms rather than posts:

     - The day view still DRAWS a crosspost once per platform, since what it
       looks like on Facebook and on Instagram are two different mocks. A
       strip can show more cards than its header counts; the extra ones carry
       a "crosspost" marker.
     - Per-platform breakdowns - the platform chips on a strip or calendar
       cell, the Platform mix chart, the brand x platform cells - put a
       crosspost under each platform it is on, and so sum to more than the
       post count.

   This has changed once already (for a while a crosspost counted once per
   platform), so every count goes through countPosts rather than `.length` at
   the call site. If it changes again, it changes here.
   ------------------------------------------------------------------------- */

/** How many posts a list is worth: one per tracker row. */
export const countPosts = (list) => list.length;

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
      // Posts: a crosspost counts once here, and under each platform chip.
      total: countPosts(list),
      platforms: orderedEntries(byPlatform, PLATFORM_ORDER)
        .map(([platformKey, count]) => ({ platformKey, count })),
    });
  }
  out.sort((a, b) => b.total - a.total || a.brandKey.localeCompare(b.brandKey));
  return out;
}

/* --------------------------------- stats ---------------------------------- */

/* One post per row - see COUNTING. The platform breakdowns are the only
   per-platform counts, and they are built separately below. */
const tally = (list, keyFn) => {
  const m = new Map();
  for (const p of list) {
    const k = keyFn(p);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
};

/** Posts in `list` that satisfy `test`. */
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
  for (const p of shown) {
    for (const pk of visiblePlatforms(p)) byPlatform.set(pk, (byPlatform.get(pk) || 0) + 1);
  }
  const crossposts = shown.filter((p) => visiblePlatforms(p).length > 1).length;
  const overdue = countWhere(shown, isOverdue);

  const dates = Array.from(byDate.keys()).sort();
  const posted = byStatus.get('posted') || 0;
  const needs = byStatus.get('needs-action') || 0;
  // Everything signed off - approved, scheduled or already live - against
  // everything still needing someone to do something.
  const settled = STATUS_SETTLED.reduce((n, k) => n + (byStatus.get(k) || 0), 0);

  let busiest = { key: '', n: 0 };
  for (const [k, n] of byDate) if (n > busiest.n) busiest = { key: k, n };

  // Content readiness — what the team still has to fill in.
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
    postedByDate.set(p.dateKey, (postedByDate.get(p.dateKey) || 0) + 1);
  }
  const perDay = monthKeys.map((k) => {
    const n = byDate.get(k) || 0;
    const done = postedByDate.get(k) || 0;
    return { key: k, n, posted: done, other: n - done };
  });

  const n = countPosts(shown);
  const stats = {
    total: countPosts(all),
    shown: n,
    crossposts,
    overdue,
    byBrand,
    byPlatform: orderedEntries(byPlatform, PLATFORM_ORDER),
    byType: orderedEntries(byType, TYPE_ORDER),
    byStatus: orderedEntries(byStatus, STATUS_ORDER),
    byDate,
    perDay,
    monthKey: mk,
    posted,
    needs,
    settled,
    settledPct: n ? Math.round((settled / n) * 100) : 0,
    postedPct: n ? Math.round((posted / n) * 100) : 0,
    daysWithContent: dates.length,
    avgPerDay: dates.length ? (n / dates.length) : 0,
    busiest,
    firstDate: dates[0] || '',
    lastDate: dates[dates.length - 1] || '',
    readiness: [
      { label: 'Has a caption',   n: withCaption, of: n, hue: 'var(--accent)' },
      { label: 'Has an asset link', n: withAsset, of: n, hue: 'var(--pf-instagram)' },
      { label: 'Has a live post link', n: withLink, of: n, hue: 'var(--st-posted)' },
    ],
    incomplete,
    today: todayKey(),
  };
  state._cache.stats = stats;
  return stats;
}

/* ---------------------------------- plan ---------------------------------- */

/**
 * The selected month's tracker against the monthly plan in config.js.
 *
 * MONTH-scoped, unlike the rest of the Stats tab: the plan is a monthly
 * commitment, so 58 posts across two months set against a plan of 112 would
 * be a comparison that means nothing. Filters still apply, like everywhere
 * else - narrowed to Posted, it reads as "delivered against committed".
 *
 * Every figure is kept three ways, which is what the tiles draw:
 *
 *   plan       what the retainer commits to
 *   actual     what the tracker has scheduled this month, any status
 *   posted     of those, what is marked Posted
 *
 * Brands and formats in the plan are always present, even at zero - a plan
 * line with nothing against it is the most useful thing this can show.
 * Anything the tracker has that the plan does not (a Story, an unassigned
 * brand) is added after them and marked as outside the plan.
 */
export function getPlanStats() {
  fresh();
  if (state._cache.plan) return state._cache.plan;

  const posts = getMonthPosts();
  const grid = PLAN.grid;

  const planTypes = Object.keys(grid);
  const planBrands = [];
  for (const row of Object.values(grid)) {
    for (const b of Object.keys(row)) if (!planBrands.includes(b)) planBrands.push(b);
  }

  const extraTypes = TYPE_ORDER.concat(['unspecified'])
    .filter((t) => !planTypes.includes(t) && posts.some((p) => p.typeKey === t));
  const extraBrands = [...new Set(posts.map((p) => p.brandKey))]
    .filter((b) => !planBrands.includes(b)).sort();

  const types = planTypes.concat(extraTypes);
  const brands = planBrands.concat(extraBrands);

  const zero = () => ({ plan: 0, actual: 0, posted: 0, inPlan: false });
  const cell = {};
  for (const t of types) {
    cell[t] = {};
    for (const b of brands) {
      const planned = grid[t]?.[b];
      cell[t][b] = { ...zero(), plan: planned || 0, inPlan: planned !== undefined };
    }
  }
  for (const p of posts) {
    const c = cell[p.typeKey]?.[p.brandKey];
    if (!c) continue;
    c.actual += 1;
    if (p.statusKey === 'posted') c.posted += 1;
  }

  const sum = (cells) => cells.reduce((acc, c) => ({
    plan: acc.plan + c.plan, actual: acc.actual + c.actual,
    posted: acc.posted + c.posted, inPlan: acc.inPlan || c.inPlan,
  }), zero());

  const byType = Object.fromEntries(types.map((t) => [t, sum(brands.map((b) => cell[t][b]))]));
  const byBrand = Object.fromEntries(brands.map((b) => [b, sum(types.map((t) => cell[t][b]))]));
  const total = sum(Object.values(byType));

  const { y, mo } = state.month || { y: 0, mo: 0 };
  const plan = {
    types, brands, cell, byType, byBrand, total,
    // Weeks in the selected month, for the "~7 / wk" pace on each tile.
    weeks: state.month ? daysInMonth(y, mo) / 7 : 4,
  };
  state._cache.plan = plan;
  return plan;
}
