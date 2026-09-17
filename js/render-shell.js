/* ============================================================================
   render-shell.js — app bar sync label, filter bar, loading/error panels,
   toasts. Everything outside the three views.
   ========================================================================== */

import { CSV_URL, PLATFORM_ORDER, TYPE_ORDER, STATUS_ORDER } from './config.js';
import { escapeHtml, orderedEntries } from './utils.js';
import { sinceLabel, todayKey } from './dates.js';
import { state, hasActiveFilters, FILTER_FIELDS } from './state.js';
import { getFiltered, getOverdue, getUpcoming, countPosts, countAll } from './selectors.js';
import { brandMeta, platformMeta, typeMeta, statusMeta } from './data.js';

const $id = (id) => document.getElementById(id);

/* -------------------------------- app bar --------------------------------- */

export function syncShell() {
  document.documentElement.dataset.view = state.view;
  document.documentElement.dataset.mode = state.mode;

  document.querySelectorAll('.tab').forEach((el) => {
    el.setAttribute('aria-selected', String(el.dataset.view === state.view));
  });
  document.querySelectorAll('[data-act="set-mode"]').forEach((el) => {
    el.setAttribute('aria-pressed', String(el.dataset.mode === state.mode));
  });
  document.querySelectorAll('[data-act="set-theme"]').forEach((el) => {
    el.setAttribute('aria-pressed', String(el.dataset.theme === state.themePref));
  });

  document.querySelectorAll('.view').forEach((el) => {
    el.hidden = (el.id !== `view-${state.view}`) || state.status !== 'ready';
  });
  $id('filterbar').hidden = state.status !== 'ready';
}

export function syncSyncLabel() {
  const el = $id('sync-label');
  const btn = $id('btn-refresh');
  if (!el) return;

  if (state.status === 'loading') { el.textContent = 'Loading the tracker\u2026'; return; }
  if (state.status === 'error') { el.textContent = 'Could not load the tracker'; return; }

  // The page re-reads the sheet every minute on its own, so this line is a
  // reassurance that it is current rather than a warning that it is not.
  el.innerHTML = state.refreshing
    ? 'Checking the sheet\u2026'
    : `<b>${countAll(state.posts)}</b> posts \u00b7 synced ${escapeHtml(sinceLabel(state.syncedAt))}`;

  if (btn) {
    btn.classList.toggle('is-busy', state.refreshing);
    btn.disabled = state.refreshing;
  }

  // A red dot while a read is in flight, including the silent minute poll, so
  // there is always a visible sign that the page is talking to the sheet.
  const dot = document.getElementById('refresh-dot');
  if (dot) dot.hidden = !state.refreshing;

  const chk = document.getElementById('chk-auto');
  if (chk) chk.checked = state.autoRefresh;
}

/* ------------------------------ notifications ------------------------------ */

/*
 * Two notices share one component and one corner of the screen: work whose
 * date has gone by without being posted, and work whose date is about to
 * arrive. They stack bottom-right, past due on top, because a missed deadline
 * outranks an approaching one.
 *
 * Dismissing either is "not now", not "never". Each comes back when its count
 * rises, when a refresh brings changed data, or after ALERT_SNOOZE_MS - so
 * closing the box cannot quietly make a real backlog disappear for the rest of
 * the day.
 */

const WARN_ICON = `
  <svg class="notice__icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3.6 1.8 20.4h20.4L12 3.6Z" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linejoin="round"/>
    <path d="M12 9.6v4.6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
    <circle cx="12" cy="17.4" r="1.25" fill="currentColor"/>
  </svg>`;

const CLOCK_ICON = `
  <svg class="notice__icon" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>
    <path d="M12 6.8V12l3.4 2.1" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

/** Which brands a set of postings belongs to, as a phrase. */
function whoFrom(list) {
  const brands = Array.from(new Set(list.map((p) => brandMeta(p.brandKey).label)));
  return brands.length === 1 ? brands[0] : `${brands.length} brands`;
}

const dayGap = (aKey, bKey) => Math.round(
  (Date.parse(`${bKey}T00:00:00`) - Date.parse(`${aKey}T00:00:00`)) / 86400000);

/** True when a notice is currently allowed to be on screen. */
function noticeLive(n, ackCount, snoozeUntil) {
  if (!n) return false;
  if (n > ackCount) return true;          // it got worse since it was dismissed
  return snoozeUntil > 0 && Date.now() >= snoozeUntil;
}

function noticeHTML({ kind, icon, title, detail, action, act, dismiss }) {
  return `<div class="notice notice--${kind}">
      ${icon}
      <div class="notice__body">
        <b>${title}</b>
        <span>${detail}</span>
        <button class="btn btn--primary" data-act="${act}">${escapeHtml(action)}</button>
      </div>
      <button class="notice__x" data-act="${dismiss}" aria-label="Dismiss">\u2715</button>
    </div>`;
}

/*
 * The rendered markup, so an unchanged notice is left completely alone.
 *
 * This runs on a timer as well as on every filter change, and rewriting the
 * innerHTML restarts the entry and nudge animations - so a notice that had
 * nothing new to say would twitch every fifteen seconds.
 */
let noticeSig = '';

export function renderAlert() {
  const bar = $id('alertbar');
  if (!bar) return;

  const ready = state.status === 'ready';
  const overdue = ready ? getOverdue() : [];
  const upcoming = ready ? getUpcoming() : [];

  const cards = [];

  if (noticeLive(countAll(overdue), state.alertAckCount, state.alertSnoozeUntil)) {
    const n = countAll(overdue);
    const days = Math.max(1, dayGap(overdue[0].dateKey, todayKey()));
    cards.push(noticeHTML({
      kind: 'late',
      icon: WARN_ICON,
      title: `${n} post${n === 1 ? '' : 's'} past due`,
      detail: `${n === 1 ? 'Its date has' : 'Their dates have'} gone by without being marked
        Posted \u00b7 ${escapeHtml(whoFrom(overdue))} \u00b7 oldest is ${days}
        day${days === 1 ? '' : 's'} ago`,
      action: `Review ${n === 1 ? 'it' : 'them'}`,
      act: 'show-overdue',
      dismiss: 'dismiss-alert',
    }));
  }

  if (noticeLive(countAll(upcoming), state.upcomingAckCount, state.upcomingSnoozeUntil)) {
    const n = countAll(upcoming);
    const next = upcoming[0];
    const gap = dayGap(todayKey(), next.dateKey);
    // "at 12:00 AM" on a row nobody actually set a time on would be noise, so
    // the time is only named when the sheet really carries one.
    const when = gap === 0 ? 'today' : (gap === 1 ? 'tomorrow' : `in ${gap} days`);
    const at = next.timeKnown && next.minuteOfDay ? ` at ${escapeHtml(next.timeLabel)}` : '';
    cards.push(noticeHTML({
      kind: 'soon',
      icon: CLOCK_ICON,
      title: `${n} post${n === 1 ? '' : 's'} coming up`,
      detail: `Due today or tomorrow and not posted yet ·
        ${escapeHtml(whoFrom(upcoming))} · next is ${when}${at}`,
      action: `Review ${n === 1 ? 'it' : 'them'}`,
      act: 'show-upcoming',
      dismiss: 'dismiss-upcoming',
    }));
  }

  const html = cards.join('');
  if (html === noticeSig) return;
  noticeSig = html;

  bar.hidden = !cards.length;
  bar.innerHTML = html;
}

/* ---------------------------------------------------------------------------
   The mock-up notice.

   A modal that has to be acknowledged, not a banner. The day view and the
   spotlight now show real creative in platform-accurate chrome, which is
   exactly what makes them easy to mistake for a proof - so the point is made
   once, in the way, and then got out of the way entirely.

   It names the three different kinds of "not real" separately, because they
   are not equally provisional: the engagement figures are invented outright,
   the layouts are approximations, and the creative is simply whatever the
   Drive link holds today.
   ------------------------------------------------------------------------- */

export const mockNoticeOpen = () => !!document.querySelector('.modal');

export function closeMockNotice() {
  const el = document.querySelector('.modal');
  if (!el) return false;
  state.mockNoticeAck = true;
  const back = el.dataset.returnFocus === 'yes' ? lastMockFocus : null;
  el.remove();
  document.documentElement.classList.remove('modal-open');
  if (back && back.isConnected) back.focus({ preventScroll: true });
  lastMockFocus = null;
  return true;
}

let lastMockFocus = null;

/** Shown once per session, the first time the mocks are opened. */
export function maybeShowMockNotice() {
  if (state.mockNoticeAck || mockNoticeOpen()) return;
  if (state.status !== 'ready') return;

  lastMockFocus = document.activeElement;

  const el = document.createElement('div');
  el.className = 'modal';
  el.dataset.returnFocus = 'yes';
  el.setAttribute('role', 'alertdialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'mocknote-title');
  el.innerHTML = `
    <div class="modal__box" role="document">
      <svg class="modal__icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/>
        <path d="M12 7.6v5.2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <circle cx="12" cy="16.4" r="1.2" fill="currentColor"/>
      </svg>
      <h2 class="modal__title" id="mocknote-title">This is a mock-up</h2>
      <p class="modal__body">Everything past this point is a preview built from the tracker,
        not a proof of the finished posting.</p>
      <ul class="modal__list">
        <li><b>The engagement figures are invented.</b> Likes, comments and views are generated
          so the layouts look right. They are not real numbers from anywhere.</li>
        <li><b>The layouts are approximations.</b> Close enough to judge framing and length,
          not pixel-accurate to what each platform will actually render.</li>
        <li><b>The creative is whatever the Drive link holds today.</b> It changes when the
          folder changes, and a placeholder means nothing is attached yet.</li>
      </ul>
      <div class="modal__actions">
        <button class="btn btn--primary" data-act="dismiss-mocknote" autofocus>
          Got it</button>
      </div>
    </div>`;

  document.body.appendChild(el);
  document.documentElement.classList.add('modal-open');
  el.querySelector('button').focus({ preventScroll: true });
}

/* ------------------------------- filter bar -------------------------------- */

/* ---------------------------------------------------------------------------
   Filter bar.

   One dropdown per facet rather than a wall of chips: with four facets and a
   dozen values each, the chips pushed the calendar most of a screen down. Each
   button says what is selected, so the bar still reads at a glance when it is
   closed.
   ------------------------------------------------------------------------- */

/** One row inside an open dropdown. */
const option = (field, key, label, count, active) =>
  `<button class="fopt" role="menuitemcheckbox" aria-checked="${active}"
      data-act="toggle-filter" data-field="${field}" data-value="${escapeHtml(key)}">
    <span class="fopt__box" aria-hidden="true"></span>
    <span class="fopt__label">${label}</span>
    <span class="fopt__n">${count}</span>
  </button>`;

/**
 * @param {string} field    key in state.filters
 * @param {string} title    what the button says when nothing is picked
 * @param {Array}  entries  [key, count] pairs, already ordered
 * @param {Function} render  (key) -> label markup
 */
function facet(field, title, entries, render) {
  const picked = state.filters[field];
  const open = state.openFacet === field;

  const summary = picked.size === 0
    ? title
    : (picked.size === 1
        ? entries.find(([k]) => picked.has(k))?.[1].label ?? title
        : `${title} \u00b7 ${picked.size}`);

  const options = entries.map(([key, meta]) =>
    option(field, key, render(key, meta), meta.count, picked.has(key))).join('');

  return `<div class="facet${open ? ' is-open' : ''}" data-facet="${field}">
      <button class="facet__btn" data-act="open-facet" data-field="${field}"
              aria-expanded="${open}" aria-haspopup="true">
        <span class="facet__title">${escapeHtml(summary)}</span>
        ${picked.size ? `<span class="facet__n">${picked.size}</span>` : ''}
        <svg class="facet__chev" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2"
                stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <div class="facet__menu" role="menu" ${open ? '' : 'hidden'}>
        <div class="facet__head">
          <span>${escapeHtml(title)}</span>
          ${picked.size ? `<button class="linkbtn" data-act="clear-facet"
              data-field="${field}">Clear</button>` : ''}
        </div>
        ${options}
      </div>
    </div>`;
}

export function renderFilterBar() {
  const bar = $id('filterbar');
  if (!bar || !state.facets) return;

  const f = state.facets;
  const withMeta = (map, order, metaFn) => {
    const rows = order
      ? orderedEntries(map, order)
      : Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
    return rows.map(([k, count]) => [k, { ...metaFn(k), count }]);
  };

  const brands = withMeta(f.brands, null, brandMeta);
  const platforms = withMeta(f.platforms, PLATFORM_ORDER, platformMeta);
  const statuses = withMeta(f.statuses, STATUS_ORDER, statusMeta);
  const types = withMeta(f.types, TYPE_ORDER, typeMeta);

  const dot = (hue) => `<span class="fchip__dot" style="--c:${hue}"></span>`;
  const logo = (m) => (m.icon
    ? `<img class="fchip__logo" src="${m.icon}" alt="">`
    : dot(m.hue));

  // Posts, not rows, on both sides of "showing N of M" - see selectors.js.
  const shown = countPosts(getFiltered());
  const overdueCount = countAll(getOverdue());
  const active = FILTER_FIELDS.reduce((n, k) => n + state.filters[k].size, 0)
    + (state.filters.overdueOnly ? 1 : 0);

  bar.classList.toggle('is-open', state.filtersOpen);

  bar.innerHTML = `
    <button class="fbar-toggle" data-act="toggle-filterbar"
            aria-expanded="${state.filtersOpen}">
      <svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 5.5h18M6.5 12h11M10 18.5h4" stroke="currentColor" stroke-width="2"
              stroke-linecap="round"/>
      </svg>
      Filters${active ? `<span class="fbar-toggle__n">${active}</span>` : ''}
    </button>

    <div class="facets">
      ${facet('brands', 'Brand', brands, (k, m) => dot(m.hue) + escapeHtml(m.label))}
      ${facet('platforms', 'Platform', platforms, (k, m) => logo(m) + escapeHtml(m.label))}
      ${facet('statuses', 'Status', statuses, (k, m) => dot(m.hue) + escapeHtml(m.label))}
      ${facet('types', 'Type', types, (k, m) => escapeHtml(m.label))}
    </div>

    <div class="filterbar__tail">
      ${overdueCount ? `<button class="fchip fchip--overdue" data-act="toggle-overdue"
          aria-pressed="${state.filters.overdueOnly}"
          title="Only show postings whose date has passed without being marked Posted">
          \u26a0 Past due<span class="fchip__n">${overdueCount}</span></button>` : ''}
      <span class="filterbar__count">showing <b>${shown}</b> of ${countAll(state.posts)}</span>
      ${hasActiveFilters()
        ? '<button class="btn btn--ghost" data-act="clear-filters">Clear all</button>' : ''}
    </div>`;
}

/* ------------------------------ status panes ------------------------------- */

export function renderStatus() {
  const pane = $id('statuspane');
  if (!pane) return;

  if (state.status === 'ready') { pane.hidden = true; pane.innerHTML = ''; return; }
  pane.hidden = false;

  if (state.status === 'loading') {
    pane.innerHTML = `<div class="skelbar skel"></div>
      <div class="skelcal">${'<div class="skel"></div>'.repeat(35)}</div>`;
    return;
  }

  const err = state.error;
  pane.innerHTML = `<div class="statepanel statepanel--error">
      <h2>The tracker could not be loaded</h2>
      <p>${escapeHtml(err?.message || 'Something went wrong while fetching the sheet.')}</p>
      <p>The page reads the team's Google Sheet live, so it needs the sheet to still be
         published to the web and reachable from this browser.</p>
      <div class="statepanel__actions">
        <button class="btn btn--primary" data-act="refresh">Try again</button>
        <a class="btn" href="${CSV_URL}" target="_blank" rel="noopener noreferrer">
          Open the CSV directly</a>
      </div>
      <span class="statepanel__url">${escapeHtml(CSV_URL)}</span>
    </div>`;
}

/* --------------------------------- toasts ---------------------------------- */

/**
 * Used when a REFRESH fails. The data already on screen stays put — blanking a
 * good calendar because one re-fetch failed would be strictly worse than
 * showing slightly stale data with a warning.
 */
export function toast(title, msg, kind = 'error', ms = 7000) {
  const host = $id('toasts');
  if (!host) return;

  const el = document.createElement('div');
  el.className = `toast toast--${kind}`;
  el.innerHTML = `<div class="toast__body">
      <div class="toast__title">${escapeHtml(title)}</div>
      ${msg ? `<div class="toast__msg">${escapeHtml(msg)}</div>` : ''}
    </div>
    <button class="toast__x" aria-label="Dismiss">\u2715</button>`;
  host.appendChild(el);

  // The only element in the app with its own listener rather than a data-act:
  // it owns a reference to this specific toast, so delegation would buy
  // nothing and the attribute would imply a handler that does not exist.
  const kill = () => el.remove();
  el.querySelector('.toast__x').addEventListener('click', kill);
  if (ms) setTimeout(kill, ms);
}

/**
 * Shown inside a view when the filters exclude everything.
 *
 * One line, not a panel. A month with nothing in it is not an error and there
 * is nothing to read about it - and in the day view every pixel this takes is
 * a pixel off the strips, which are sized from whatever room is left below it.
 * The button says what the sentence used to.
 */
export const emptyViewHTML = (what) =>
  `<div class="empty">
     <strong>No ${escapeHtml(what)} match these filters</strong>
     <button class="btn btn--ghost" data-act="clear-filters">Clear filters</button>
   </div>`;
