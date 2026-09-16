/* ============================================================================
   render-shell.js — app bar sync label, filter bar, loading/error panels,
   toasts. Everything outside the three views.
   ========================================================================== */

import { CSV_URL, PLATFORM_ORDER, TYPE_ORDER, STATUS_ORDER } from './config.js';
import { escapeHtml, orderedEntries } from './utils.js';
import { sinceLabel, todayKey } from './dates.js';
import { state, hasActiveFilters, FILTER_FIELDS } from './state.js';
import { getFiltered, getOverdue } from './selectors.js';
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
    : `<b>${state.posts.length}</b> posts \u00b7 synced ${escapeHtml(sinceLabel(state.syncedAt))}`;

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

/* ------------------------------ overdue alert ------------------------------ */

/**
 * The attention-grabber for postings whose date has gone by while they were
 * still not marked Posted.
 *
 * Dismissing it is per session and per count: it stays down until the number
 * goes UP, so acknowledging today's backlog does not also silence tomorrow's.
 * An auto-refresh every minute that kept re-raising a dismissed banner would
 * train people to ignore it.
 */
export function renderAlert() {
  const bar = $id('alertbar');
  if (!bar) return;

  const overdue = state.status === 'ready' ? getOverdue() : [];
  const n = overdue.length;

  if (!n || n <= state.alertAckCount) {
    bar.hidden = true;
    bar.innerHTML = '';
    return;
  }

  const oldest = overdue[0];
  const days = Math.max(1, Math.round(
    (Date.parse(`${todayKey()}T00:00:00`) - Date.parse(`${oldest.dateKey}T00:00:00`)) / 86400000));

  const brands = Array.from(new Set(overdue.map((p) => brandMeta(p.brandKey).label)));
  const who = brands.length === 1 ? brands[0] : `${brands.length} brands`;

  bar.hidden = false;
  bar.innerHTML = `
    <svg class="alertbar__icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.6 1.8 20.4h20.4L12 3.6Z" fill="none" stroke="currentColor"
            stroke-width="2" stroke-linejoin="round"/>
      <path d="M12 9.6v4.6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
      <circle cx="12" cy="17.4" r="1.25" fill="currentColor"/>
    </svg>
    <div class="alertbar__body">
      <b>${n} post${n === 1 ? '' : 's'} past due</b>
      <span>${n === 1 ? 'Its date has' : 'Their dates have'} gone by without being marked
        Posted \u00b7 ${escapeHtml(who)} \u00b7 oldest is ${days} day${days === 1 ? '' : 's'} ago</span>
    </div>
    <button class="btn btn--primary" data-act="show-overdue">Review ${n === 1 ? 'it' : 'them'}</button>
    <button class="alertbar__x" data-act="dismiss-alert" aria-label="Dismiss">\u2715</button>`;
}

/* ------------------------------- filter bar -------------------------------- */

const chip = (field, key, label, count, active, extra = '') =>
  `<button class="fchip${extra}" data-act="toggle-filter" data-field="${field}" ` +
  `data-value="${escapeHtml(key)}" aria-pressed="${active}">` +
  `${label}<span class="fchip__n">${count}</span></button>`;

export function renderFilterBar() {
  const bar = $id('filterbar');
  if (!bar || !state.facets) return;

  const f = state.facets;

  const brandChips = Array.from(f.brands.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => {
      const m = brandMeta(k);
      return chip('brands', k,
        `<span class="fchip__dot" style="--c:${m.hue}"></span>${escapeHtml(m.label)}`,
        n, state.filters.brands.has(k));
    }).join('');

  const platformChips = orderedEntries(f.platforms, PLATFORM_ORDER).map(([k, n]) => {
    const m = platformMeta(k);
    const icon = m.icon
      ? `<img class="fchip__logo" src="${m.icon}" alt="">`
      : `<span class="fchip__dot" style="--c:${m.hue}"></span>`;
    return chip('platforms', k, `${icon}${escapeHtml(m.label)}`, n,
      state.filters.platforms.has(k), m.unset ? ' fchip--unset' : '');
  }).join('');

  const statusChips = orderedEntries(f.statuses, STATUS_ORDER).map(([k, n]) => {
    const m = statusMeta(k);
    return chip('statuses', k,
      `<span class="fchip__dot" style="--c:${m.hue}"></span>${escapeHtml(m.label)}`,
      n, state.filters.statuses.has(k), m.unset ? ' fchip--unset' : '');
  }).join('');

  const typeChips = orderedEntries(f.types, TYPE_ORDER).map(([k, n]) => {
    const m = typeMeta(k);
    return chip('types', k, escapeHtml(m.label), n,
      state.filters.types.has(k), m.unset ? ' fchip--unset' : '');
  }).join('');

  const shown = getFiltered().length;
  const overdueCount = getOverdue().length;
  const active = FILTER_FIELDS.reduce((n, f) => n + state.filters[f].size, 0)
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
    <div class="fgroup"><span class="fgroup__label">Brand</span>${brandChips}</div>
    <div class="fgroup"><span class="fgroup__label">Platform</span>${platformChips}</div>
    <div class="fgroup"><span class="fgroup__label">Status</span>${statusChips}</div>
    <div class="fgroup"><span class="fgroup__label">Type</span>${typeChips}</div>
    <div class="filterbar__tail">
      ${overdueCount ? `<button class="fchip fchip--overdue" data-act="toggle-overdue"
          aria-pressed="${state.filters.overdueOnly}"
          title="Only show postings whose date has passed without being marked Posted">
          ⚠ Past due<span class="fchip__n">${overdueCount}</span></button>` : ''}
      <span class="filterbar__count">showing <b>${shown}</b> of ${state.posts.length}</span>
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

/** Shown inside a view when filters exclude everything. */
export const emptyViewHTML = (what) =>
  `<div class="empty"><strong>No ${escapeHtml(what)} match these filters</strong>
     Try clearing a filter to widen the selection.
     <div class="statepanel__actions">
       <button class="btn" data-act="clear-filters">Clear all filters</button>
     </div>
   </div>`;
