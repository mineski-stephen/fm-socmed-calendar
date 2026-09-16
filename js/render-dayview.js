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
  getByDay, expandByPlatform, visiblePlatforms, isOverdue,
} from './selectors.js';
import { brandMeta, platformMeta } from './data.js';
import {
  simpleCardHTML, platformMark, postHeaderHTML, noteHTML, entryKey,
} from './render-post.js';
import { emptyViewHTML } from './render-shell.js';
import { mockFacebookHTML } from './mock-facebook.js';
import { mockInstagramHTML } from './mock-instagram.js';
import { mockXHTML } from './mock-x.js';

const MOCKS = { fb: mockFacebookHTML, ig: mockInstagramHTML, x: mockXHTML };

let builtKey = '';
let detachHydration = null;

/**
 * One post on one platform.
 *
 * In Layout mode a platform renders as a mock only if PLATFORM_META gives it
 * one - that single lookup is why TikTok, YouTube, LinkedIn and Unspecified
 * stay simple cards with no special-casing here.
 *
 * Every mock is wrapped in the same header strip the simple cards use, so the
 * platform a post belongs to is always named, even when the mock already looks
 * the part - and especially when one row is drawn twice as a crosspost.
 */
export function postHTML(entry) {
  const { post, platformKey } = entry;

  if (state.mode === 'layout') {
    const mock = platformMeta(platformKey).mock;
    if (mock && MOCKS[mock]) {
      // The note sits outside the body on purpose: collapsing hides the mock,
      // but a scheduling remark is exactly what you still want to see.
      const collapsed = state.collapsed.has(entryKey(post, platformKey)) ? ' is-collapsed' : '';
      return `<article class="postframe${collapsed}">
          ${postHeaderHTML(post, platformKey)}
          <div class="postframe__body">${MOCKS[mock](post, platformKey)}</div>
          ${noteHTML(post)}
        </article>`;
    }
    return simpleCardHTML(post, platformKey, { showMedia: true });
  }
  return simpleCardHTML(post, platformKey, { showMedia: false });
}

/** A day's posts, grouped by brand under a brand heading. */
function stripBodyHTML(posts) {
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
  const entries = expandByPlatform(posts);
  const byBrand = groupBy(entries, (e) => e.post.brandKey);
  const out = [];
  for (const [brandKey, list] of byBrand) {
    const b = brandMeta(brandKey);
    out.push(`<div class="strip__brand" style="--c:${b.hue}">${escapeHtml(b.label)}</div>`);
    out.push(list.map(postHTML).join(''));
  }
  return out.join('');
}

function stripHeadHTML(key, posts) {
  const parts = partsFromKey(key);
  const d = new Date(parts.y, parts.mo, parts.d);
  const tally = new Map();
  for (const p of posts) {
    for (const pk of visiblePlatforms(p)) tally.set(pk, (tally.get(pk) || 0) + 1);
  }

  const chips = orderedEntries(tally, PLATFORM_ORDER).map(([pk, n]) => {
    const meta = platformMeta(pk);
    return `<span class="chip${meta.unset ? ' chip--unset' : ''}" ` +
           `title="${escapeHtml(`${meta.label}: ${n}`)}">` +
           `${platformMark(pk)}${n}</span>`;
  }).join('');

  return `<div class="strip__head">
      <div class="strip__dow">${DAY_NAMES[d.getDay()]}</div>
      <div class="strip__date">
        <span class="strip__num">${parts.d}</span>
        <span class="strip__mon">${MONTH_ABBR[parts.mo]} ${parts.y}</span>
        <span class="strip__count">${posts.length || 0} post${posts.length === 1 ? '' : 's'}</span>
        ${(() => { const n = posts.filter(isOverdue).length;
           return n ? `<span class="strip__late">⚠ ${n} past due</span>` : ''; })()}
      </div>
      ${chips ? `<div class="strip__chips">${chips}</div>` : ''}
    </div>`;
}

/* ----------------------------- lazy hydration ----------------------------- */

function hydrate(strip) {
  if (strip.dataset.hydrated === '1') return;
  const key = strip.dataset.key;
  const posts = getByDay().get(key) || [];
  strip.querySelector('.strip__body').innerHTML = stripBodyHTML(posts);
  strip.dataset.hydrated = '1';
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

  rail.querySelectorAll('.strip').forEach((strip) => {
    const key = strip.dataset.key;
    const posts = byDay.get(key) || [];

    strip.querySelector('.strip__head').outerHTML = stripHeadHTML(key, posts);
    strip.classList.toggle('strip--empty', posts.length === 0);

    if (strip.dataset.hydrated !== '1') return;
    strip.dataset.hydrated = '0';
    hydrate(strip);
  });

  hydrateNear(rail);
}

/* -------------------------------- render ---------------------------------- */

export function renderDayView(container) {
  const { y, mo } = state.month;
  const byDay = getByDay();
  const keys = monthDayKeys(y, mo);
  const today = todayKey();

  const total = Array.from(byDay.values()).reduce((n, a) => n + a.length, 0);

  const head = `<div class="dayview__head">
      <div class="viewhead__title">${escapeHtml(monthLabel(y, mo))}
        <small>${total} post${total === 1 ? '' : 's'} across ${keys.length} days</small>
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
    return `<section class="${cls.join(' ')}" data-key="${key}" data-hydrated="0"
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
    const n = dayPosts.length;
    const late = dayPosts.filter(isOverdue).length;
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

  const hint = `<div class="railhint">
      <span>Drag the bar above, or the strips themselves, to move across the month.
        <span class="kbd">\u2190</span> <span class="kbd">\u2192</span> steps a day,
        <span class="kbd">PgUp</span> <span class="kbd">PgDn</span> a week.
        The mouse wheel scrolls a day's posts.</span>
    </div>`;

  const emptyNote = total ? '' : `<div class="dayview__head">${emptyViewHTML('posts')}</div>`;

  container.innerHTML =
    `<div class="dayview">${head}${emptyNote}${scrollbar}` +
    `<div class="rail" id="day-rail" tabindex="0" role="listbox" ` +
    `aria-label="Days of the month">${strips}</div>` +
    `${hint}</div>`;

  builtKey = `${y}-${mo}|${state.mode}`;
  const rail = container.querySelector('.rail');
  sizeRail();
  watchHydration(rail);
  return rail;
}

/**
 * Give the strips a real height instead of a guessed viewport fraction, so a
 * day column always ends exactly at the bottom of the window and its posts
 * scroll inside it at full size.
 */
export function sizeRail() {
  const rail = document.querySelector('.rail');
  if (!rail) return;
  const top = rail.getBoundingClientRect().top;
  const h = Math.max(320, window.innerHeight - top - 54);   // 54px: hint row + padding
  rail.style.setProperty('--strip-h', `${Math.round(h)}px`);

  // Half a screen of padding either side, so the FIRST and LAST days can reach
  // the middle of the rail too. Without it they would clamp against the ends
  // and never become the centred day.
  const strip = rail.querySelector('.strip');
  const gutter = parseFloat(getComputedStyle(rail).getPropertyValue('--gutter')) || 20;
  if (strip) {
    const pad = Math.max(gutter, (rail.clientWidth - strip.getBoundingClientRect().width) / 2);
    rail.style.setProperty('--rail-pad', `${Math.round(pad)}px`);
  }

  hydrateNear(rail);
}

export const dayViewKey = () => builtKey;
export function resetDayViewCache() {
  builtKey = '';
  if (detachHydration) { detachHydration(); detachHydration = null; }
}
