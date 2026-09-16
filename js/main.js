/* ============================================================================
   main.js — boot, the scoped render dispatcher, and all event handling.

   Events are delegated from `document`: three listeners total, each switching
   on a data-act attribute. Because no node owns a handler, replacing innerHTML
   anywhere can never leak listeners or quietly lose behaviour.
   ========================================================================== */

import { AUTO_REFRESH_MS, LOADER_MIN_MS, ALERT_SNOOZE_MS, SHEET_URL } from './config.js';
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
  hydrateVisible, setStripFilter, clearStripFilters, setRailWidthHook,
} from './render-dayview.js';
import { renderStats } from './render-stats.js';
import { initDayRail, bindCarousels, setCarousel } from './interactions.js';
import { getOverdue, getUpcoming, expandByPlatform, getByDay } from './selectors.js';
import * as lightbox from './lightbox.js';
import { entryKey } from './render-post.js';

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
        // Drop the old controller first: renderDayView re-sizes the rail, and
        // the width hook must not drive a rail that is about to be replaced.
        rail = null;
        rail = initDayRail(renderDayView(container), {
          onDayChange: onRailDay,
          onMoved: hydrateVisible,
        });
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

/*
 * Landing on a day.
 *
 * The readout is updated at once, because that is the feedback that the click
 * registered. The expensive half - measuring thirty strips and building the
 * mocks for whichever came into range - is held back a beat, so a run of rapid
 * clicks along the ruler does that work once for the day you settle on instead
 * of once per day you passed through.
 */
let dayCommit = 0;

function onRailDay(key) {
  state.selectedDayKey = key;

  const pos = $('[data-railpos]');
  if (pos) {
    const p = partsFromKey(key);
    const d = new Date(p.y, p.mo, p.d);
    pos.textContent = d.toLocaleDateString(undefined,
      { weekday: 'short', month: 'short', day: 'numeric' });
  }

  clearTimeout(dayCommit);
  dayCommit = setTimeout(() => {
    // A strip's platform lens belongs to the day you were reading, so moving on
    // drops it. Leaving it set would hide posts on a day nobody ever filtered.
    clearStripFilters(key);
    // The rail can be moved without a scroll event ever firing, so this is
    // where the strips that just came into range get built.
    hydrateVisible();
  }, 110);
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

  // The sheet changed, so whatever was dismissed was dismissed about a
  // different set of postings. Both notices get to speak again.
  state.alertSnoozeUntil = 0;
  state.upcomingSnoozeUntil = 0;
  state.alertAckCount = -1;
  state.upcomingAckCount = -1;

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

  'open-facet'(el) {
    const field = el.dataset.field;
    state.openFacet = state.openFacet === field ? null : field;
    renderFilterBar();
  },

  'toggle-filter'(el) {
    // The dropdown stays open: picking two platforms should not mean opening
    // the menu twice.
    toggleFilter(el.dataset.field, el.dataset.value);
    scheduleRender(SCOPE.FILTERS | SCOPE.VIEW);
  },

  'clear-facet'(el) {
    state.filters[el.dataset.field].clear();
    invalidate();
    scheduleRender(SCOPE.FILTERS | SCOPE.VIEW);
  },

  'toggle-filterbar'() {
    state.filtersOpen = !state.filtersOpen;
    renderFilterBar();
    sizeRail();
  },

  'clear-filters'() {
    state.openFacet = null;
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
    state.alertSnoozeUntil = 0;   // reviewed, not postponed

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

  /* ---------------------------- the overlay ------------------------------ */

  /** One post, examined on its own. */
  spotlight(el) {
    const wanted = el.dataset.entry;
    const all = expandByPlatform(state.posts);
    const at = all.findIndex((e) => entryKey(e.post, e.platformKey) === wanted);
    if (at < 0) return;
    lightbox.open([all[at]], 0, dayTitle(all[at].post.dateKey));
  },

  /**
   * Every post for one day, as a carousel.
   *
   * Built from what the strip behind it is actually showing: the global
   * filters via getByDay, and that strip's own platform lens if one is set.
   * Opening a day narrowed to Instagram and getting the Facebook posts back
   * would make the overlay disagree with the thing it was opened from.
   */
  'expand-day'(el) {
    const key = el.dataset.key;
    const only = el.closest('.strip')?.dataset.only || '';
    let list = expandByPlatform(getByDay().get(key) || []);
    if (only) list = list.filter((e) => e.platformKey === only);
    if (!list.length) return;
    lightbox.open(list, 0, dayTitle(key));
  },

  'lightbox-close'() { lightbox.close(); },
  'lightbox-prev'() { lightbox.step(-1); },
  'lightbox-next'() { lightbox.step(1); },

  /*
   * Narrows to what is about to go out and opens the day the next one sits on,
   * the same way the past-due notice does. The window is a couple of days, so
   * the month is the one the soonest posting is in, not necessarily this one.
   */
  'show-upcoming'() {
    const soon = getUpcoming();
    if (!soon.length) return;

    for (const f of FILTER_FIELDS) state.filters[f].clear();
    state.filters.overdueOnly = false;
    state.upcomingAckCount = soon.length;
    state.upcomingSnoozeUntil = 0;

    const first = soon[0];
    setMonth(+first.monthKey.slice(0, 4), +first.monthKey.slice(5, 7) - 1);
    state.selectedDayKey = first.dateKey;
    pendingScrollDay = first.dateKey;
    state.view = 'day';
    savePrefs();
    resetDayViewCache();
    invalidate();
    scheduleRender(SCOPE.ALL);
  },

  /*
   * Dismissing is "not now", not "never".
   *
   * The count is remembered so the notice returns the moment the number goes
   * up, and a snooze deadline is set so it also returns on its own after
   * ALERT_SNOOZE_MS. Work that is still past due ten minutes later is still
   * past due, and a box that stayed shut for the rest of the session would
   * quietly turn a real backlog into nobody's problem.
   */
  'dismiss-alert'() {
    state.alertAckCount = getOverdue().length;
    state.alertSnoozeUntil = Date.now() + ALERT_SNOOZE_MS;
    renderAlert();
    armSnooze();
  },

  'dismiss-upcoming'() {
    state.upcomingAckCount = getUpcoming().length;
    state.upcomingSnoozeUntil = Date.now() + ALERT_SNOOZE_MS;
    renderAlert();
    armSnooze();
  },

  /*
   * A platform chip in a strip header narrows THAT strip to that platform.
   * Local and temporary by design: the global filter bar would empty every
   * other day in the month, which is not what "show me just the Instagram
   * posts on the 18th" means.
   */
  'strip-platform'(el) {
    const strip = setStripFilter(el.dataset.key, el.dataset.platform);
    // The body was replaced wholesale, so any carousel inside it is new DOM
    // and needs its swipe handler back.
    if (strip) bindCarousels(strip, state.carousels);
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

  /**
   * A click on a day strip: take me to that day.
   *
   * Only reachable on a strip you are NOT on - the contents of the active one
   * handle their own clicks, and the contents of every other one are inert, so
   * a click there lands on the strip itself.
   */
  'goto-day'(el) {
    if (el.classList.contains('strip--active')) return;
    rail?.goToKey(el.dataset.key);
  },

  open(el) {
    const url = el.dataset.url;
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  },

  'expand-caption'(el) {
    const id = el.dataset.post;
    if (state.expanded.has(id)) state.expanded.delete(id);
    else state.expanded.add(id);
    // Re-render just this card's view region rather than the whole app - and
    // the overlay too when it is up, because it sits outside every view and a
    // view-scoped render would leave its caption clamped and the button dead.
    scheduleRender(SCOPE.VIEW);
    lightbox.rerender();
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

/* ------------------------------ notifications ------------------------------ */

/**
 * Bring a dismissed notice back when its snooze runs out.
 *
 * One timer for both notices, re-armed for whichever deadline is nearest, so
 * dismissing twice does not leave two timers racing each other.
 */
let snoozeTimer = 0;
function armSnooze() {
  clearTimeout(snoozeTimer);
  const due = [state.alertSnoozeUntil, state.upcomingSnoozeUntil]
    .filter((t) => t > Date.now());
  if (!due.length) return;
  const wait = Math.min(...due) - Date.now();
  snoozeTimer = setTimeout(() => { renderAlert(); armSnooze(); }, wait + 50);
}

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

/** "Friday, 18 September 2026" for the overlay heading. */
function dayTitle(dateKey) {
  const p = partsFromKey(dateKey);
  if (!p) return '';
  const d = new Date(p.y, p.mo, p.d);
  return d.toLocaleDateString(undefined,
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function afterMonthChange() {
  ensureSelectedDay();
  resetDayViewCache();
  scheduleRender(SCOPE.VIEW | SCOPE.FILTERS);
}

/* ------------------------------ delegation --------------------------------- */

document.addEventListener('click', (e) => {
  // An open filter dropdown closes on any click outside itself.
  if (state.openFacet && !e.target.closest('.facet')) {
    state.openFacet = null;
    renderFilterBar();
  }

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
  // While the overlay is up it owns Escape and the arrow keys; letting them
  // through would step the rail behind it.
  if (lightbox.handleKey(e)) return;

  if (e.key === 'Escape' && state.openFacet) {
    state.openFacet = null;
    renderFilterBar();
    return;
  }

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

  // The sheet address lives in config.js only; the markup carries a placeholder
  // href so the button is never a dead link if this ever fails to run.
  const sheet = $('#btn-sheet');
  if (sheet) sheet.href = SHEET_URL;

  window.addEventListener('hashchange', () => {
    // syncHash() uses replaceState, which fires no event, so anything that
    // lands here was a real navigation: re-apply it.
    applyHash();
    scheduleRender(SCOPE.ALL);
  });

  // Re-centre whenever the strips change width. Every strip moved, so the
  // offset that had the selected day in the middle now has it half off the
  // edge - which is exactly the sliced-off look the fitting is there to avoid.
  setRailWidthHook(() => {
    if (state.view !== 'day' || !rail) return;
    rail.goToKey(state.selectedDayKey, { smooth: false });
    rail.syncBar?.();
  });

  window.addEventListener('resize', () => {
    if (state.view !== 'day') return;
    // sizeRail divides the new width into whole strips, so this is what keeps
    // a resized window from leaving a sliced-off column at each edge.
    sizeRail();
    rail?.syncBar?.();   // the day box is sized from the rail's width
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

  // Keeps the "synced 20s ago" label honest between polls. The notices ride
  // along, because "coming up" is measured against today: a page left open
  // overnight would otherwise still be warning about yesterday's window.
  setInterval(() => {
    if (state.status !== 'ready') return;
    syncSyncLabel();
    renderAlert();
  }, 15000);

  initialLoad();
}

boot();
