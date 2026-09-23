/* ============================================================================
   render-dayview.js — the horizontal rail of day strips.

   Every day of the month gets a strip, empty ones included, so a gap in the
   schedule is as visible as a busy day.

   Strip bodies are built lazily as they come into range: in Layout mode 30 days
   of platform mocks is a lot of DOM, and building it all up front makes the
   first paint crawl. Un-built strips hold a fixed-height skeleton so the rail's
   scroll geometry never shifts underneath the user.
   ========================================================================== */

import { DAY_NAMES, DAY_ABBR, MONTH_ABBR, PLATFORM_ORDER } from './config.js';
import { escapeHtml, groupBy, orderedEntries, rafThrottle } from './utils.js';
import { monthDayKeys, partsFromKey, monthLabel, todayKey } from './dates.js';
import { state } from './state.js';
import {
  getByDay, expandByPlatform, visiblePlatforms, isOverdue, countPosts,
} from './selectors.js';
import { brandMeta, platformMeta } from './data.js';
import {
  simpleCardHTML, platformMark, postHeaderHTML, noteHTML, entryKey,
} from './render-post.js';
import { emptyViewHTML } from './render-shell.js';
import { syncCaptionMore } from './captions.js';
import { mockFor } from './mocks.js';

let builtKey = '';
let detachHydration = null;

/**
 * One post on one platform.
 *
 * In Layout mode a platform renders as a mock only if the registry in mocks.js
 * has one for it - that single lookup is why a row with no platform set stays
 * a simple card, with no special-casing here.
 *
 * Every mock is wrapped in the same header strip the simple cards use, so the
 * platform a post belongs to is always named, even when the mock already looks
 * the part - and especially when one row is drawn twice as a crosspost.
 */
export function postHTML(entry) {
  const { post, platformKey } = entry;

  if (state.mode === 'layout') {
    const mock = mockFor(platformKey);
    if (mock) {
      // The note sits outside the body on purpose: collapsing hides the mock,
      // but a scheduling remark is exactly what you still want to see.
      const collapsed = state.collapsed.has(entryKey(post, platformKey)) ? ' is-collapsed' : '';
      return `<article class="postframe${collapsed}">
          ${postHeaderHTML(post, platformKey)}
          <div class="postframe__body">${mock(post, platformKey)}</div>
          ${noteHTML(post)}
        </article>`;
    }
    return simpleCardHTML(post, platformKey, { showMedia: true });
  }
  return simpleCardHTML(post, platformKey, { showMedia: false });
}

/**
 * A day's posts, grouped by brand under a brand heading.
 *
 * `only` is the strip's own platform lens, set by clicking one of the chips in
 * its header. It filters the ENTRIES rather than the posts, so a crosspost
 * shows just the one placement being looked at rather than disappearing or
 * dragging its other platform along with it.
 */
function stripBodyHTML(posts, only = '') {
  if (!posts.length) {
    return `<div class="strip__none">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
          <rect x="3" y="5" width="18" height="16" rx="2"/>
          <path d="M3 10h18M8 3v4M16 3v4"/>
        </svg>
        <span>No posts scheduled</span>
      </div>`;
  }
  // Expand first: a crosspost is one tracker row but two posts in the world,
  // so it is drawn once per platform it actually goes out on.
  let entries = expandByPlatform(posts);
  if (only) entries = entries.filter((e) => e.platformKey === only);
  if (!entries.length) {
    return `<div class="strip__none">
        <span>Nothing on ${escapeHtml(platformMeta(only).label)} this day</span>
      </div>`;
  }
  const byBrand = groupBy(entries, (e) => e.post.brandKey);
  const out = [];
  for (const [brandKey, list] of byBrand) {
    const b = brandMeta(brandKey);
    out.push(`<div class="strip__brand" style="--c:${b.hue}">${escapeHtml(b.label)}</div>`);
    out.push(list.map(postHTML).join(''));
  }
  return out.join('');
}

function stripHeadHTML(key, posts, only = '') {
  // Posts, not cards: a crosspost is one post but is drawn once per platform
  // below, each copy marked "crosspost".
  const n = countPosts(posts);
  const parts = partsFromKey(key);
  const d = new Date(parts.y, parts.mo, parts.d);
  const tally = new Map();
  for (const p of posts) {
    for (const pk of visiblePlatforms(p)) tally.set(pk, (tally.get(pk) || 0) + 1);
  }

  // Buttons, not labels: clicking one narrows this strip to that platform.
  // With a single platform on the day there is nothing to narrow to, so the
  // chips stay plain and unclickable rather than offering a no-op.
  const soloDay = tally.size < 2;
  const chips = orderedEntries(tally, PLATFORM_ORDER).map(([pk, n]) => {
    const meta = platformMeta(pk);
    const cls = `chip${meta.unset ? ' chip--unset' : ''}`;
    if (soloDay) {
      return `<span class="${cls}" title="${escapeHtml(`${meta.label}: ${n}`)}">` +
             `${platformMark(pk)}${n}</span>`;
    }
    const on = only === pk;
    return `<button type="button" class="${cls}" data-act="strip-platform" ` +
           `data-key="${key}" data-platform="${escapeHtml(pk)}" aria-pressed="${on}" ` +
           `title="${escapeHtml(on
              ? `Showing only ${meta.label} on this day - click to show everything`
              : `Show only ${meta.label} on this day`)}">` +
           `${platformMark(pk)}${n}</button>`;
  }).join('');

  const onlyNote = only
    ? `<div class="strip__only">${escapeHtml(platformMeta(only).label)} only
         <button type="button" data-act="strip-platform" data-key="${key}"
                 data-platform="${escapeHtml(only)}">show all</button></div>`
    : '';

  return `<div class="strip__head">
      <div class="strip__dow">${DAY_NAMES[d.getDay()]}</div>
      <div class="strip__date">
        <span class="strip__num">${parts.d}</span>
        <span class="strip__mon">${MONTH_ABBR[parts.mo]} ${parts.y}</span>
        <span class="strip__count">${n} post${n === 1 ? '' : 's'}</span>
        ${posts.length ? `<button class="strip__zoom" data-act="expand-day" data-key="${key}"
            title="Examine this day's posts" aria-label="Examine this day's posts">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7" fill="none"
                    stroke="currentColor" stroke-width="2" stroke-linecap="round"
                    stroke-linejoin="round"/>
            </svg></button>` : ''}
        ${(() => { const late = countPosts(posts.filter(isOverdue));
           return late ? `<span class="strip__late">⚠ ${late} past due</span>` : ''; })()}
      </div>
      ${chips ? `<div class="strip__chips">${chips}${onlyNote}</div>` : ''}
    </div>`;
}

/* ----------------------------- lazy hydration ----------------------------- */

/**
 * A day you are not on is a picture of that day, not a working copy of it.
 *
 * Its header and body are marked `inert`, so nothing inside answers a click, a
 * hover, a drag-select or the Tab key: no copying a caption, opening a link,
 * collapsing a post or filtering by platform on a strip that is only half on
 * screen. The strip element ITSELF stays live, which is what lets a click on
 * it mean "bring this day over".
 *
 * Applied to the two children rather than to the strip so the strip keeps its
 * role="option" and aria-selected in the accessibility tree - inert on the
 * strip would leave the rail's listbox reporting a single day.
 */
function syncInert(strip) {
  const on = strip.classList.contains('strip--active');
  for (const part of strip.children) part.inert = !on;
}

function hydrate(strip) {
  if (strip.dataset.hydrated === '1') return;
  const key = strip.dataset.key;
  const posts = getByDay().get(key) || [];
  strip.querySelector('.strip__body').innerHTML = stripBodyHTML(posts, strip.dataset.only || '');
  strip.dataset.hydrated = '1';
  syncInert(strip);
  syncCaptionMore(strip);
}

/**
 * Build the strips that are on screen, plus a screen's worth either side.
 *
 * This is measured from the rail's own scroll position rather than delegated
 * to an IntersectionObserver. An observer is the tidier-looking solution, but
 * browsers suspend observer callbacks for occluded or backgrounded tabs - and
 * when that happens the day view is left showing nothing but skeletons. Doing
 * the arithmetic ourselves means the content is always there.
 */
function hydrateNear(rail) {
  if (!rail) return;
  const box = rail.getBoundingClientRect();
  const pad = box.width * 1.25;

  for (const strip of rail.querySelectorAll('.strip')) {
    if (strip.dataset.hydrated === '1') continue;
    const b = strip.getBoundingClientRect();
    if (b.right > box.left - pad && b.left < box.right + pad) hydrate(strip);
  }
}

function watchHydration(rail) {
  if (detachHydration) detachHydration();

  const onScroll = rafThrottle(() => hydrateNear(rail));
  rail.addEventListener('scroll', onScroll, { passive: true });

  /*
   * The rail can be built before the layout has settled - a pane being resized,
   * a sidebar opening, fonts swapping in - and everything here is measured from
   * its width. Watching the element itself catches all of those, where a window
   * resize listener alone would miss most of them and leave the view stuck
   * showing skeletons sized from a width that no longer exists.
   */
  let ro = null;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(() => { sizeRail(); hydrateNear(rail); });
    ro.observe(rail);
  }

  // Belt and braces: observers can be suspended for an occluded window, so
  // re-measure once shortly after the build regardless.
  const settle = setTimeout(() => { sizeRail(); hydrateNear(rail); }, 200);

  detachHydration = () => {
    rail.removeEventListener('scroll', onScroll);
    if (ro) ro.disconnect();
    clearTimeout(settle);
  };

  hydrateNear(rail);
}

/** Everything on show this month, in posts - one per tracker row. */
const monthTotal = (byDay) =>
  Array.from(byDay.values()).reduce((n, a) => n + countPosts(a), 0);

/** "76 posts across 30 days" - the month subtitle. */
function monthCountText(byDay, days) {
  const total = monthTotal(byDay);
  return `${total} post${total === 1 ? '' : 's'} across ${days} days`;
}

/**
 * Apply a filter change to a rail that is already built.
 *
 * Headers are refreshed for EVERY strip, not just hydrated ones: the count and
 * the platform chips describe the filtered set, so leaving them alone would
 * show "7 posts" above a strip now displaying one. Bodies are only rebuilt
 * where they were already built, so the lazy ones stay lazy.
 */
export function refreshStripBodies() {
  const rail = document.querySelector('.rail');
  if (!rail) return;
  const byDay = getByDay();

  // Built with the month skeleton, which a filter change does not rebuild, so
  // it has to be rewritten here or it keeps reporting the unfiltered month.
  const sub = document.querySelector('[data-monthcount]');
  if (sub) sub.textContent = monthCountText(byDay, monthDayKeys(state.month.y, state.month.mo).length);

  rail.querySelectorAll('.strip').forEach((strip) => {
    const key = strip.dataset.key;
    const posts = byDay.get(key) || [];

    strip.querySelector('.strip__head').outerHTML =
      stripHeadHTML(key, posts, strip.dataset.only || '');
    strip.classList.toggle('strip--empty', posts.length === 0);
    syncInert(strip);   // the header element was replaced, so re-mark it

    if (strip.dataset.hydrated !== '1') return;
    strip.dataset.hydrated = '0';
    hydrate(strip);
  });

  hydrateNear(rail);
}

/* --------------------------- per-strip platform lens ----------------------- */

const stripEl = (key) => document.querySelector(`.rail .strip[data-key="${CSS.escape(key)}"]`);

/** Rebuild one strip's head and body from its current lens. */
function repaintStrip(strip) {
  const key = strip.dataset.key;
  const posts = getByDay().get(key) || [];
  const only = strip.dataset.only || '';
  strip.querySelector('.strip__head').outerHTML = stripHeadHTML(key, posts, only);
  strip.querySelector('.strip__body').innerHTML = stripBodyHTML(posts, only);
  strip.dataset.hydrated = '1';
  strip.classList.toggle('strip--lensed', !!only);
  syncInert(strip);   // the header element was replaced, so re-mark it
  syncCaptionMore(strip);
}

/**
 * Narrow one strip to a single platform, or clear it when the same chip is
 * pressed again. Returns the strip so the caller can rebind anything inside it.
 */
export function setStripFilter(key, platformKey) {
  const strip = stripEl(key);
  if (!strip) return null;
  const now = strip.dataset.only || '';
  const next = now === platformKey ? '' : platformKey;
  if (next) strip.dataset.only = next; else delete strip.dataset.only;
  repaintStrip(strip);
  // The body is taller or shorter than it was; start at the top rather than
  // part-way down a list that no longer has that many posts in it.
  strip.querySelector('.strip__body').scrollTop = 0;
  return strip;
}

/**
 * Drop the lens on every strip except the one named.
 *
 * Called when the rail settles on a new day: the lens is a way of reading ONE
 * day, so carrying it along as you move would quietly hide posts on days you
 * never touched.
 */
export function clearStripFilters(exceptKey = '') {
  const rail = document.querySelector('.rail');
  if (!rail) return false;
  let changed = false;
  rail.querySelectorAll('.strip[data-only]').forEach((strip) => {
    if (strip.dataset.key === exceptKey) return;
    delete strip.dataset.only;
    if (strip.dataset.hydrated === '1') repaintStrip(strip);
    else strip.classList.remove('strip--lensed');
    changed = true;
  });
  return changed;
}

/* -------------------------------- render ---------------------------------- */

export function renderDayView(container) {
  const { y, mo } = state.month;
  const byDay = getByDay();
  const keys = monthDayKeys(y, mo);
  const today = todayKey();
  const total = monthTotal(byDay);

  const head = `<div class="dayview__head">
      <div class="viewhead__title">${escapeHtml(monthLabel(y, mo))}
        <small data-monthcount>${monthCountText(byDay, keys.length)}</small>
      </div>
      <div class="railnav">
        <button class="btn btn--sq" data-act="prev-day" aria-label="Previous day">\u2039</button>
        <span class="railnav__pos" data-railpos></span>
        <button class="btn btn--sq" data-act="next-day" aria-label="Next day">\u203a</button>
      </div>
      <div class="viewhead__nav">
        <button class="btn" data-act="prev-month">\u2039 Prev month</button>
        <button class="btn" data-act="today">Today</button>
        <button class="btn" data-act="next-month">Next month \u203a</button>
      </div>
    </div>`;

  const strips = keys.map((key) => {
    const posts = byDay.get(key) || [];
    const cls = ['strip'];
    if (key === today) cls.push('strip--today');
    if (!posts.length) cls.push('strip--empty');
    if (posts.some(isOverdue)) cls.push('strip--overdue');
    /*
     * The whole strip is the navigation target, not just its header. Its
     * contents are inert unless it is the day you are on (see syncInert), so
     * on any other day a click lands here and means "bring this day over".
     */
    return `<section class="${cls.join(' ')}" data-key="${key}" data-hydrated="0"
              data-act="goto-day"
              role="option" aria-selected="${key === state.selectedDayKey}"
              aria-label="${escapeHtml(key)}">
        ${stripHeadHTML(key, posts)}
        <div class="strip__body"><div class="strip__skeleton"></div></div>
      </section>`;
  }).join('');

  // A ruler rather than a plain scrollbar: one slot per day of the month, so
  // it doubles as an overview of where the work sits. A dot marks a day that
  // has posts, and the box tracks whichever day the rail is centred on.
  const ruler = keys.map((key, i) => {
    const parts = partsFromKey(key);
    const d = new Date(parts.y, parts.mo, parts.d);
    const dayPosts = byDay.get(key) || [];
    const n = countPosts(dayPosts);
    const late = countPosts(dayPosts.filter(isOverdue));
    const cls = ['dayruler__day'];
    if (!n) cls.push('is-empty');
    if (late) cls.push('is-overdue');
    if (d.getDay() === 0 || d.getDay() === 6) cls.push('is-weekend');
    if (key === today) cls.push('is-today');
    return `<button class="${cls.join(' ')}" data-act="ruler-day" data-key="${key}"
        data-i="${i}" type="button"
        title="${escapeHtml(`${DAY_ABBR[d.getDay()]} ${MONTH_ABBR[parts.mo]} ${parts.d} \u00b7 ` +
          `${n} post${n === 1 ? '' : 's'}${late ? ` \u00b7 ${late} past due` : ''}`)}">
        <span class="dayruler__n">${parts.d}</span>
        <span class="dayruler__dot"${n ? '' : ' hidden'}></span>
      </button>`;
  }).join('');

  const scrollbar = `<div class="railbar">
      <div class="dayruler" data-dayruler role="group"
           aria-label="Days of ${escapeHtml(monthLabel(y, mo))}">
        <span class="dayruler__box" data-rulerbox aria-hidden="true"></span>
        ${ruler}
      </div>
    </div>`;

  const emptyNote = total ? '' : `<div class="dayview__head">${emptyViewHTML('posts')}</div>`;

  container.innerHTML =
    `<div class="dayview">${head}${emptyNote}${scrollbar}` +
    `<div class="rail" id="day-rail" tabindex="0" role="listbox" ` +
    `aria-label="Days of the month">${strips}</div></div>`;

  builtKey = `${y}-${mo}|${state.mode}`;
  const rail = container.querySelector('.rail');
  sizeRail();
  watchHydration(rail);
  return rail;
}

/*
 * Strip width is DERIVED from the rail width, not fixed.
 *
 * A fixed width leaves whatever is left over as a sliced-off sliver at each
 * edge - the centred day fits, and its neighbours get cut by however many
 * pixels do not divide evenly. Dividing the rail into a whole number of
 * columns instead means every strip on screen is a whole strip.
 *
 * The count is forced ODD because the active day is centred: with an even
 * count, centring one column necessarily splits the two at the ends in half,
 * which is the very thing this avoids.
 */
const STRIP_MIN = 360;    // below this a mock stops being readable
const STRIP_MAX = 680;    // above it the posts just get airier, not clearer

function fitStripWidth(rail) {
  const cs = getComputedStyle(rail);
  const gap = parseFloat(cs.columnGap) || 14;
  const gutter = parseFloat(cs.getPropertyValue('--gutter')) || 20;
  const avail = rail.clientWidth;
  if (!avail) return null;

  // Largest odd column count whose strips are still wide enough to read.
  let n = 1;
  for (let k = 3; k <= 9; k += 2) {
    if (k * STRIP_MIN + (k - 1) * gap <= avail) n = k; else break;
  }

  // A single column keeps a gutter either side - filling the window edge to
  // edge would leave the one strip on screen with no margin at all.
  const w = n === 1
    ? Math.min(STRIP_MAX, avail - gutter * 2)
    : Math.min(STRIP_MAX, (avail - (n - 1) * gap) / n);

  return { w: Math.max(240, Math.floor(w)), n, gap, avail };
}

/*
 * Called when the strip width actually changes, so whoever owns the rail can
 * put the selected day back in the middle. Every strip moved, so the scroll
 * offset that centred one a moment ago now centres nothing.
 *
 * A hook rather than an import: interactions.js sits downstream of this module,
 * and reaching across for it would be the first circular import in the app.
 */
let onWidthChange = null;
export function setRailWidthHook(fn) { onWidthChange = fn; }

/**
 * Size the rail: strip width across, strip height down.
 *
 * The height is measured from the rail's real position on screen rather than
 * guessed as a viewport fraction, so a day column always ends exactly at the
 * bottom of the window and its posts scroll inside it at full size. It is
 * recomputed whenever the app bar rolls away, which is what gives the strips
 * that height back.
 */
export function sizeRail() {
  const rail = document.querySelector('.rail');
  if (!rail) return;

  const before = rail.style.getPropertyValue('--strip-w');
  const avail = applyFit(rail);

  /*
   * Measure again if the width moved under us.
   *
   * Everything here is derived from rail.clientWidth, and applying the result
   * changes the page's own height - which can add or remove the window's
   * vertical scrollbar, which changes clientWidth. Reading it back forces the
   * layout and settles it. One extra pass is always enough: a scrollbar can
   * only appear or disappear once.
   */
  if (rail.clientWidth !== avail) applyFit(rail);

  hydrateNear(rail);
  if (rail.style.getPropertyValue('--strip-w') !== before && onWidthChange) onWidthChange();
}

/** Write the strip width, strip height and rail padding. Returns the width used. */
function applyFit(rail) {
  const fit = fitStripWidth(rail);
  if (fit) rail.style.setProperty('--strip-w', `${fit.w}px`);

  const top = rail.getBoundingClientRect().top;
  const h = Math.max(320, window.innerHeight - top - 54);   // 54px: hint row + padding
  rail.style.setProperty('--strip-h', `${Math.round(h)}px`);

  // Half a screen of padding either side, so the FIRST and LAST days can reach
  // the middle of the rail too. Without it they would clamp against the ends
  // and never become the centred day.
  if (fit) {
    const gutter = parseFloat(getComputedStyle(rail).getPropertyValue('--gutter')) || 20;
    rail.style.setProperty('--rail-pad',
      `${Math.round(Math.max(gutter, (fit.avail - fit.w) / 2))}px`);
  }
  return fit ? fit.avail : rail.clientWidth;
}

/**
 * Build whatever is now on screen.
 *
 * Called whenever the rail lands on a new day, not only on its scroll event:
 * a programmatic jump - a deep link, a ruler click, the keyboard - can move the
 * rail without a scroll event ever being delivered, which used to leave the day
 * you asked for sitting there as a skeleton.
 */
export function hydrateVisible() {
  hydrateNear(document.querySelector('.rail'));
}

export const dayViewKey = () => builtKey;
export function resetDayViewCache() {
  builtKey = '';
  if (detachHydration) { detachHydration(); detachHydration = null; }
}
