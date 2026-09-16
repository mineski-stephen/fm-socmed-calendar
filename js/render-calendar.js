/* ============================================================================
   render-calendar.js — the month grid.

   The grid skeleton is built once per month and cached. A filter change only
   rewrites each cell's chip strip, so the layout, date numbers and scroll
   position never move.
   ========================================================================== */

import { DAY_ABBR, MONTH_ABBR } from './config.js';
import { escapeHtml } from './utils.js';
import { calendarMatrix, monthLabel, todayKey } from './dates.js';
import { state } from './state.js';
import { getByDay, brandChipsFor, isOverdue } from './selectors.js';
import { brandMeta, platformMeta } from './data.js';
import { emptyViewHTML } from './render-shell.js';
import { platformMark } from './render-post.js';

let built = { key: '', cells: new Map(), root: null };

function chipsHTML(posts) {
  if (!posts || !posts.length) return '';
  return brandChipsFor(posts).map((g) => {
    const b = brandMeta(g.brandKey);
    const chips = g.platforms.map((p) => {
      const meta = platformMeta(p.platformKey);
      return `<span class="chip${meta.unset ? ' chip--unset' : ''}" ` +
             `title="${escapeHtml(`${g.total > 1 ? b.label + ' \u00b7 ' : ''}${meta.label}: ${p.count} post${p.count > 1 ? 's' : ''}`)}">` +
             `${platformMark(p.platformKey)}${p.count}</span>`;
    }).join('');
    return `<div class="bgroup" style="--c:${b.hue}">
        <span class="bgroup__name">${escapeHtml(b.label)}</span>
        <div class="bgroup__chips">${chips}</div>
      </div>`;
  }).join('');
}

/** Build the month shell once; cells are then updated in place. */
function buildSkeleton(y, mo) {
  const key = `${y}-${mo}`;
  if (built.key === key && built.root && built.root.isConnected) return built.root;

  const today = todayKey();
  const cells = calendarMatrix(y, mo);

  const dow = DAY_ABBR.map((d) => `<span>${d}</span>`).join('');
  const html = cells.map((c) => {
    const isToday = c.key === today;
    const dowIndex = new Date(c.y, c.mo, c.d).getDay();
    const cls = ['cell'];
    if (c.out) cls.push('cell--out');
    if (isToday) cls.push('cell--today');
    if (dowIndex === 0 || dowIndex === 6) cls.push('cell--weekend');
    return `<div class="${cls.join(' ')}" data-key="${c.key}"
        ${c.out ? '' : 'data-act="select-day" role="button" tabindex="0"'}
        aria-label="${escapeHtml(`${MONTH_ABBR[c.mo]} ${c.d}`)}">
        <div class="cell__head">
          <span class="cell__date">${c.d}</span>
          <span class="cell__total" data-total></span>
        </div>
        <div class="cell__chips" data-chips></div>
        <span class="cell__more" data-more hidden></span>
      </div>`;
  }).join('');

  const root = document.createElement('div');
  root.className = 'cal';
  root.innerHTML = `<div class="cal__dow">${dow}</div><div class="cal__grid">${html}</div>`;

  const map = new Map();
  root.querySelectorAll('.cell').forEach((el) => map.set(el.dataset.key, el));
  built = { key, cells: map, root };
  return root;
}

export function renderCalendar(container) {
  const { y, mo } = state.month;
  const byDay = getByDay();

  const legend = Array.from(new Set(state.posts.map((p) => p.brandKey)))
    .map((k) => {
      const b = brandMeta(k);
      return `<span><i class="fchip__dot" style="--c:${b.hue}"></i>${escapeHtml(b.label)}</span>`;
    }).join('');

  const head = `<div class="viewhead">
      <div class="viewhead__title">${escapeHtml(monthLabel(y, mo))}
        <small>${byDay.size} day${byDay.size === 1 ? '' : 's'} with posts this month</small>
      </div>
      <div class="viewhead__nav">
        <button class="btn btn--sq" data-act="prev-month" aria-label="Previous month">\u2039</button>
        <button class="btn" data-act="today">Today</button>
        <button class="btn btn--sq" data-act="next-month" aria-label="Next month">\u203a</button>
      </div>
    </div>`;

  // Rebuild the shell only when the month changes.
  if (built.key !== `${y}-${mo}` || !container.querySelector('.cal')) {
    container.innerHTML = head;
    container.appendChild(buildSkeleton(y, mo));
    container.insertAdjacentHTML('beforeend', `<div class="cal__legend">${legend}</div>`);
  } else {
    container.querySelector('.viewhead').outerHTML = head;
  }

  const note = container.querySelector('[data-emptynote]');
  if (note) note.remove();
  if (!byDay.size) {
    container.insertAdjacentHTML('beforeend',
      `<div data-emptynote>${emptyViewHTML('posts')}</div>`);
  }

  // Cheap part: only the chips change when a filter changes. Written in one
  // pass, then measured in a second, so the browser lays out once rather than
  // once per cell.
  for (const [key, el] of built.cells) {
    const posts = byDay.get(key) || [];
    const out = el.classList.contains('cell--out');

    el.querySelector('[data-chips]').innerHTML = out ? '' : chipsHTML(posts);
    const total = el.querySelector('[data-total]');
    total.textContent = posts.length && !out ? posts.length : '';

    // A day in the past still carrying unposted work gets flagged on the grid
    // itself, so the backlog is visible without opening anything.
    const late = out ? 0 : posts.filter(isOverdue).length;
    el.classList.toggle('cell--overdue', late > 0);
    el.title = late ? `${late} post${late === 1 ? '' : 's'} past due` : '';
    el.classList.toggle('cell--selected', key === state.selectedDayKey);
  }

  markOverflow();
}

/**
 * A heavy day used to stretch its cell, and every other cell in that week with
 * it - one busy Wednesday could add 150px to the whole month. The chip area is
 * capped instead, and whatever does not fit is summarised as "+N more", which
 * keeps the grid scannable. Nothing is lost: the cell still opens the full day.
 */
function markOverflow() {
  // Read every cell first, then write, so this costs one layout rather than 42.
  //
  // Measured with rects, not offsetTop: the cell is position:relative, so a
  // chip's offsetTop is counted from the CELL - header included - not from the
  // chip box, which made even a one-chip day look overflowing.
  const overflow = [];
  for (const [, el] of built.cells) {
    const box = el.querySelector('[data-chips]');
    if (!box) continue;
    const limit = box.getBoundingClientRect().bottom;
    let hidden = 0;
    for (const chip of box.querySelectorAll('.chip')) {
      if (chip.getBoundingClientRect().bottom > limit + 1) hidden += 1;
    }
    overflow.push([el, hidden]);
  }

  for (const [el, hidden] of overflow) {
    const more = el.querySelector('[data-more]');
    if (!more) continue;
    more.hidden = hidden === 0;
    more.textContent = hidden ? `+${hidden} more` : '';
    el.classList.toggle('cell--clipped', hidden > 0);
  }
}

/** Force a full rebuild — used after a refresh swaps the dataset. */
export function resetCalendarCache() { built = { key: '', cells: new Map(), root: null }; }
