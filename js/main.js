/* ============================================================================
   main.js — boot, the scoped render dispatcher, and all event handling.

   Events are delegated from `document`: three listeners total, each switching
   on a data-act attribute. Because no node owns a handler, replacing innerHTML
   anywhere can never leak listeners or quietly lose behaviour.
   ========================================================================== */

import { AUTO_REFRESH_MS, LOADER_MIN_MS } from './config.js';
import { $ } from './utils.js';
import { todayKey, partsFromKey } from './dates.js';
import { loadPosts, buildFacets, monthsWithData } from './data.js';
import {
  state, loadPrefs, savePrefs, syncHash, applyHash, invalidate,
  toggleFilter, clearFilters, setMonth, ensureSelectedDay, FILTER_FIELDS,
} from './state.js';
import { applyTheme, setThemePref, watchSystemTheme } from './theme.js';
import {
  syncShell, syncSyncLabel, renderFilterBar, renderStatus, renderAlert, toast,
} from './render-shell.js';
import { renderCalendar, resetCalendarCache } from './render-calendar.js';
import {
  renderDayView, refreshStripBodies, resetDayViewCache, dayViewKey, sizeRail,
} from './render-dayview.js';
import { renderStats } from './render-stats.js';
import { initDayRail, bindCarousels, setCarousel } from './interactions.js';
import { getOverdue } from './selectors.js';

const SCOPE = { SHELL: 1, FILTERS: 2, VIEW: 4, ALL: 7 };
let pending = 0, queued = false;
let rail = null;

/* A day the next render should scroll the rail to. Needed because the rail is
   only rebuilt on a month or mode change: picking a day inside the month the
   rail already shows would otherwise update state and scroll nowhere. */
let pendingScrollDay = null;

/* ------------------------------- dispatcher -------------------------------- */

function scheduleRender(scope = SCOPE.VIEW) {
  pending |= scope;
  if (queued) return;
  queued = true;

  let ran = false;
  let fallback = 0;

  const run = () => {
    if (ran) return;
    ran = true;
    clearTimeout(fallback);
    const s = pending;
    pending = 0; queued = false;
    render(s);
  };

  requestAnimationFrame(run);

  // requestAnimationFrame stops firing when the window is occluded by another
  // window - and the visibility API still reports "visible" in that case, so
  // there is nothing to detect it by. Without a fallback the UI would freeze
  // while JavaScript carried on running, which is exactly what would happen to
  // a copy of this page left open on an office display. Timers keep firing, so
  // one backstops the frame.
  fallback = setTimeout(run, 250);
}

function render(scope) {
  if (scope & SCOPE.SHELL) { syncShell(); syncSyncLabel(); }

  if (state.status !== 'ready') { renderStatus(); return; }
  renderStatus();

  if (scope & SCOPE.FILTERS) { renderFilterBar(); renderAlert(); }

  if (scope & SCOPE.VIEW) {
    if (state.view === 'calendar') {
      renderCalendar($('#view-calendar'));
    } else if (state.view === 'day') {
      const container = $('#view-day');
      const wanted = `${state.month.y}-${state.month.mo}|${state.mode}`;
      if (dayViewKey() !== wanted || !container.querySelector('.rail')) {
        // Capture the target BEFORE initDayRail: its initial setActive() fires
        // onDayChange, which would otherwise rewrite selectedDayKey to day 1.
        const wantDay = pendingScrollDay || state.selectedDayKey;
        rail = initDayRail(renderDayView(container), { onDayChange: onRailDay });
        if (wantDay) {
          state.selectedDayKey = wantDay;
          rail?.goToKey(wantDay, { smooth: false });
        }
        pendingScrollDay = null;
      } else {
        refreshStripBodies();
        if (pendingScrollDay) {
          const want = pendingScrollDay;
          pendingScrollDay = null;
          state.selectedDayKey = want;
          rail?.goToKey(want);
        }
      }
      bindCarousels(container, state.carousels);
    } else {
      renderStats($('#view-stats'));
    }
  }
  syncHash();
}

function onRailDay(key) {
  state.selectedDayKey = key;
  const pos = $('[data-railpos]');
  if (pos) {
    const p = partsFromKey(key);
    const d = new Date(p.y, p.mo, p.d);
    pos.textContent = d.toLocaleDateString(undefined,
      { weekday: 'short', month: 'short', day: 'numeric' });
  }
}

/* --------------------------------- data ----------------------------------- */

function adoptPosts(posts, fingerprint = '') {
  state.posts = posts;
  state.fingerprint = fingerprint;
  state.facets = buildFacets(posts);
  state.syncedAt = Date.now();
  state.status = 'ready';
  state.error = null;
  invalidate();

  // Open on the first month that actually has posts rather than the real
  // current month, which would often be empty.
  if (!state.month) {
    const months = monthsWithData(posts);
    const t = todayKey().slice(0, 7);
    const pick = months.includes(t) ? t : (months[0] || t);
    state.month = { y: +pick.slice(0, 4), mo: +pick.slice(5, 7) - 1 };
  }
  ensureSelectedDay();
}

async function initialLoad() {
  state.status = 'loading';
  scheduleRender(SCOPE.ALL);

  // Hold the loader for a beat even on a fast connection. A spinner that
  // flashes for 80ms reads as a glitch; a steady one reads as the page working.
  const floor = new Promise((r) => setTimeout(r, LOADER_MIN_MS));

  try {
    const { posts, fingerprint } = await loadPosts();
    await floor;
    adoptPosts(posts, fingerprint);
  } catch (err) {
    await floor;
    state.status = 'error';
    state.error = err;
  }
  resetCalendarCache();
  resetDayViewCache();
  render(SCOPE.ALL);
  hideLoader();
}

function hideLoader() {
  const el = $('#loader');
  if (!el || el.hidden) return;
  el.hidden = true;
  // the CSS keeps it in flow while it fades, then this takes it out entirely
  setTimeout(() => el.remove(), 500);
}

/**
 * Re-read the sheet. The data already on screen stays put throughout: a failed
 * re-fetch must never blank a calendar that was working a second ago.
 *
 * `quiet` is the automatic minute poll. It says nothing on success and, more
 * importantly, does not touch the DOM at all when the sheet has not changed -
 * otherwise the page would rebuild itself under the user every sixty seconds.
 */
async function refresh({ quiet = false } = {}) {
  if (state.refreshing) return;
  if (state.status === 'error') { initialLoad(); return; }

  state.refreshing = true;
  syncSyncLabel();   // paints the red dot; the label only changes when not quiet

  // Preserve exactly where the user was.
  const keepScroll = $('.rail')?.scrollLeft ?? 0;
  const keepDay = state.selectedDayKey;

  try {
    const { posts, fingerprint } = await loadPosts({ bust: true });
    const unchanged = fingerprint === state.fingerprint;

    state.refreshing = false;

    if (unchanged) {
      // Nothing moved in the sheet. Just bump the clock.
      state.syncedAt = Date.now();
      syncSyncLabel();
      if (!quiet) toast('Already up to date', `${posts.length} posts, nothing changed.`, 'ok', 2600);
      return;
    }

    adoptPosts(posts, fingerprint);
    state.selectedDayKey = keepDay;

    resetCalendarCache();
    resetDayViewCache();
    render(SCOPE.ALL);

    const r = $('.rail');
    if (r) r.scrollLeft = keepScroll;

    toast(quiet ? 'Tracker updated' : 'Tracker refreshed',
      `${posts.length} posts loaded.`, 'ok', 3500);
  } catch (err) {
    state.refreshing = false;
    syncSyncLabel();
    // A failed background poll is not worth interrupting anyone over; the next
    // one is only a minute away.
    if (!quiet) toast('Refresh failed', err?.message || 'Could not reach the sheet.', 'error');
  }
}

/* -------------------------------- actions ---------------------------------- */

const ACTIONS = {
  'set-view'(el) {
    state.view = el.dataset.view;
    savePrefs();
    scheduleRender(SCOPE.ALL);
  },

  'set-mode'(el) {
    state.mode = el.dataset.mode;
    savePrefs();
    resetDayViewCache();
    scheduleRender(SCOPE.ALL);
  },

  'set-theme'(el) {
    setThemePref(el.dataset.theme);
    scheduleRender(SCOPE.SHELL);
  },

  'toggle-filter'(el) {
    toggleFilter(el.dataset.field, el.dataset.value);
    scheduleRender(SCOPE.FILTERS | SCOPE.VIEW);
  },

  'toggle-filterbar'() {
    state.filtersOpen = !state.filtersOpen;
    renderFilterBar();
    sizeRail();
  },

  'clear-filters'() {
    clearFilters();
    scheduleRender(SCOPE.FILTERS | SCOPE.VIEW);
  },

  'toggle-overdue'() {
    state.filters.overdueOnly = !state.filters.overdueOnly;
    invalidate();
    scheduleRender(SCOPE.FILTERS | SCOPE.VIEW);
  },

  /*
   * The banner's call to action. It narrows to the backlog AND opens the month
   * the oldest one sits in, so "review them" lands somewhere useful instead of
   * quietly applying a filter to whatever month happened to be on screen.
   */
  'show-overdue'() {
    const late = getOverdue();
    if (!late.length) return;

    for (const f of FILTER_FIELDS) state.filters[f].clear();
    state.filters.overdueOnly = true;
    state.alertAckCount = late.length;

    const first = late[0];
    setMonth(+first.monthKey.slice(0, 4), +first.monthKey.slice(5, 7) - 1);
    state.selectedDayKey = first.dateKey;
    pendingScrollDay = first.dateKey;
    state.view = 'day';
    savePrefs();
    resetDayViewCache();
    invalidate();
    scheduleRender(SCOPE.ALL);
  },

  'dismiss-alert'() {
    state.alertAckCount = getOverdue().length;
    renderAlert();
  },

  'prev-month'() { setMonth(state.month.y, state.month.mo - 1); afterMonthChange(); },
  'next-month'() { setMonth(state.month.y, state.month.mo + 1); afterMonthChange(); },

  today() {
    const t = todayKey();
    const p = partsFromKey(t);
    setMonth(p.y, p.mo);
    state.selectedDayKey = t;
    afterMonthChange();
  },

  'select-day'(el) {
    state.selectedDayKey = el.dataset.key;
    pendingScrollDay = el.dataset.key;
    state.view = 'day';
    savePrefs();
    scheduleRender(SCOPE.ALL);
  },

  'prev-day'() { rail?.goToIndex(rail.currentIndex() - 1); },
  'next-day'() { rail?.goToIndex(rail.currentIndex() + 1); },

  'ruler-day'(el) { rail?.goToIndex(+el.dataset.i); },

  open(el) {
    const url = el.dataset.url;
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  },

  'expand-caption'(el) {
    const id = el.dataset.post;
    if (state.expanded.has(id)) state.expanded.delete(id);
    else state.expanded.add(id);
    // Re-render just this card's view region rather than the whole app.
    scheduleRender(SCOPE.VIEW);
  },

  'carousel-dot'(el) {
    const car = el.closest('.mock-ig, .strip, .view')?.querySelector(
      `.igcar[data-carousel="${CSS.escape(el.dataset.post)}"]`);
    if (car) setCarousel(car, +el.dataset.i, state.carousels);
  },

  'carousel-nav'(el) {
    const car = el.closest('.igcar');
    if (!car) return;
    const now = +getComputedStyle(car).getPropertyValue('--i') || 0;
    setCarousel(car, Math.round(now) + (+el.dataset.step), state.carousels);
  },

  refresh() { refresh(); },

  'toggle-auto'(el) {
    state.autoRefresh = !!el.checked;
    savePrefs();
    syncSyncLabel();
    // Turning it back on should not leave the data a minute out of date.
    if (state.autoRefresh && Date.now() - state.syncedAt > AUTO_REFRESH_MS) {
      refresh({ quiet: true });
    }
  },

  'toggle-collapse'(el) {
    const key = el.dataset.entry;
    const card = el.closest('.postframe, .pcard');
    if (!key || !card) return;

    const nowCollapsed = !state.collapsed.has(key);
    if (nowCollapsed) state.collapsed.add(key); else state.collapsed.delete(key);

    // Toggled directly rather than through a re-render: this has to feel
    // instant, and rebuilding the strip would throw away its scroll position.
    card.classList.toggle('is-collapsed', nowCollapsed);
    el.setAttribute('aria-expanded', String(!nowCollapsed));
    el.setAttribute('title', nowCollapsed ? 'Show this post' : 'Hide this post');
  },

  'copy-caption'(el) {
    const post = state.posts.find((p) => p.id === el.dataset.post);
    if (!post || !post.caption) return;
    copyText(post.caption).then((ok) => {
      if (ok) copyToast('Copied to clipboard');
      else copyToast('Could not copy', true);
    });
  },
};

/**
 * Clipboard write with a fallback.
 *
 * navigator.clipboard is unavailable on insecure origins other than localhost,
 * which includes plenty of internal hosts, so the old execCommand path is kept
 * for those rather than failing silently.
 */
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** The little confirmation that pops out of the middle of the screen. */
let copyTimer = 0;
function copyToast(text, failed = false) {
  document.querySelector('.copytoast')?.remove();
  clearTimeout(copyTimer);

  const el = document.createElement('div');
  el.className = 'copytoast';
  el.innerHTML = (failed
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
      'stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="m4 12.5 5.2 5.2L20 7"/></svg>'
    ) + `<span>${text}</span>`;

  document.body.appendChild(el);
  copyTimer = setTimeout(() => el.remove(), 1500);
}

function afterMonthChange() {
  ensureSelectedDay();
  resetDayViewCache();
  scheduleRender(SCOPE.VIEW | SCOPE.FILTERS);
}

/* ------------------------------ delegation --------------------------------- */

document.addEventListener('click', (e) => {
  // Real links keep their normal behaviour - including the ones inside a
  // caption, which would otherwise be swallowed by click-to-copy.
  if (e.target.closest('a[href]')) return;

  // Form controls are driven by their own "change" event below. Handling them
  // here too would preventDefault the click and stop the box ever ticking.
  if (e.target.closest('input, select, textarea, label')) return;

  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = ACTIONS[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  fn(el, e);
});

// Enter/Space on the elements we made keyboard-reachable with role+tabindex.
document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = ACTIONS[el.dataset.act];
  if (fn) fn(el, e);
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') {
    if (e.key === 'r' || e.key === 'R') {
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      refresh();
    }
    return;
  }
  const el = e.target.closest?.('[data-act][tabindex], [data-act][role="button"]');
  if (!el) return;
  const fn = ACTIONS[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  fn(el, e);
});

/* --------------------------------- boot ------------------------------------ */

function boot() {
  window.__fmcalBooted = true;   // tells the inline watchdog in index.html to stand down
  loadPrefs();
  applyTheme();
  watchSystemTheme(() => scheduleRender(SCOPE.SHELL));

  window.addEventListener('hashchange', () => {
    // syncHash() uses replaceState, which fires no event, so anything that
    // lands here was a real navigation: re-apply it.
    applyHash();
    scheduleRender(SCOPE.ALL);
  });

  window.addEventListener('resize', () => {
    if (state.view !== 'day') return;
    sizeRail();
    rail?.syncBar?.();   // the scrollbar thumb is sized from the rail's width
  });

  // Re-read the sheet every minute. The poll is silent and, when the CSV comes
  // back byte-identical, touches nothing at all - so a page left open on a wall
  // display stays current without redrawing itself under anyone.
  setInterval(() => {
    if (!state.autoRefresh) return;
    if (state.status === 'ready' && !document.hidden) refresh({ quiet: true });
  }, AUTO_REFRESH_MS);

  // Catch up immediately when a backgrounded tab comes back.
  document.addEventListener('visibilitychange', () => {
    if (!state.autoRefresh || document.hidden || state.status !== 'ready') return;
    if (Date.now() - state.syncedAt > AUTO_REFRESH_MS) refresh({ quiet: true });
  });

  // Keeps the "synced 20s ago" label honest between polls.
  setInterval(() => { if (state.status === 'ready') syncSyncLabel(); }, 15000);

  initialLoad();
}

boot();
