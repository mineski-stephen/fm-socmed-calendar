/* ============================================================================
   state.js — the single mutable store, plus persistence and deep links.
   ========================================================================== */

import { STORAGE_KEY } from './config.js';
import { todayKey, partsFromKey } from './dates.js';

export const state = {
  status: 'loading',          // loading | ready | error
  error: null,

  posts: [],
  facets: null,
  fingerprint: '',        // hash of the raw CSV, to spot a no-op refresh
  syncedAt: 0,
  refreshing: false,
  autoRefresh: true,          // the minute poll; persisted, on by default

  view: 'calendar',           // calendar | day | stats
  mode: 'layout',             // simple | layout
  themePref: 'system',        // system | light | dark
  theme: 'light',             // resolved; mirrored to <html data-theme>

  filters: {
    brands: new Set(),
    platforms: new Set(),
    statuses: new Set(),
    types: new Set(),
    overdueOnly: false,       // not a Set: it is a single on/off lens
  },

  month: null,                // { y, mo }
  selectedDayKey: null,

  filtersOpen: false,         // narrow screens only; wide screens always show them
  openFacet: null,            // which filter dropdown is currently open
  carousels: new Map(),       // postId -> slide index
  expanded: new Set(),        // postId -> caption un-clamped
  collapsed: new Set(),       // "postId::platform" -> body hidden, note kept
  /*
   * Notification bookkeeping, one pair per notice.
   *
   * ackCount is the count the notice was dismissed at, so it comes straight
   * back if the number goes UP. snoozeUntil is when a dismissal expires, so a
   * notice that is still true reappears rather than being silenced for the
   * rest of the session.
   */
  alertAckCount: -1,          // overdue count when the notice was last dismissed
  alertSnoozeUntil: 0,
  upcomingAckCount: -1,
  upcomingSnoozeUntil: 0,


  _cache: { key: '', filtered: null, byDay: null, stats: null },
};

/** Any filter set being non-empty means "only these". Empty means "all". */
export const FILTER_FIELDS = ['brands', 'platforms', 'statuses', 'types'];

export const hasActiveFilters = () =>
  FILTER_FIELDS.some((f) => state.filters[f].size > 0) || state.filters.overdueOnly;

export function clearFilters() {
  for (const f of FILTER_FIELDS) state.filters[f].clear();
  state.filters.overdueOnly = false;
  invalidate();
}

export function toggleFilter(field, value) {
  const set = state.filters[field];
  if (!set) return;
  if (set.has(value)) set.delete(value); else set.add(value);
  invalidate();
}

/** Drop memoised selector results. Called by every mutation that affects them. */
export function invalidate() { state._cache.key = ''; }

/* ----------------------------- persistence -------------------------------- */

export function loadPrefs() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
  catch { saved = null; }

  if (saved && typeof saved === 'object') {
    if (['system', 'light', 'dark'].includes(saved.themePref)) state.themePref = saved.themePref;
    if (['simple', 'layout'].includes(saved.mode)) state.mode = saved.mode;
    if (['calendar', 'day', 'stats'].includes(saved.view)) state.view = saved.view;
    if (typeof saved.autoRefresh === 'boolean') state.autoRefresh = saved.autoRefresh;
  }
  // A hash deep link is an explicit intent, so it outranks what was persisted.
  applyHash();
}

export function savePrefs() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      themePref: state.themePref, mode: state.mode, view: state.view,
      autoRefresh: state.autoRefresh,
    }));
  } catch { /* private mode, quota, blocked storage — never fatal */ }
}

/* ------------------------------ deep links -------------------------------- */

/** #v=day&m=2026-09&d=2026-09-16&b=funalomax&p=facebook */
export function applyHash() {
  const raw = location.hash.replace(/^#/, '');
  if (!raw) return;
  const q = new URLSearchParams(raw);

  const v = q.get('v');
  if (['calendar', 'day', 'stats'].includes(v)) state.view = v;

  const mode = q.get('l');
  if (['simple', 'layout'].includes(mode)) state.mode = mode;

  const m = q.get('m');
  if (m && /^\d{4}-\d{2}$/.test(m)) {
    state.month = { y: +m.slice(0, 4), mo: +m.slice(5, 7) - 1 };
  }

  const d = q.get('d');
  if (d && partsFromKey(d)) {
    state.selectedDayKey = d;
    if (!state.month) {
      const p = partsFromKey(d);
      state.month = { y: p.y, mo: p.mo };
    }
  }

  const pairs = [['b', 'brands'], ['p', 'platforms'], ['s', 'statuses'], ['t', 'types']];
  for (const [param, field] of pairs) {
    const val = q.get(param);
    if (!val) continue;
    state.filters[field] = new Set(val.split(',').filter(Boolean));
  }
  invalidate();
}

/** Keep the address bar in step so a view can be shared with the team. */
export function syncHash() {
  const q = new URLSearchParams();
  q.set('v', state.view);
  if (state.month) {
    q.set('m', `${state.month.y}-${String(state.month.mo + 1).padStart(2, '0')}`);
  }
  if (state.view === 'day' && state.selectedDayKey) q.set('d', state.selectedDayKey);

  const pairs = [['b', 'brands'], ['p', 'platforms'], ['s', 'statuses'], ['t', 'types']];
  for (const [param, field] of pairs) {
    const set = state.filters[field];
    if (set.size) q.set(param, Array.from(set).join(','));
  }
  const next = `#${q.toString()}`;
  if (next !== location.hash) history.replaceState(null, '', next);
}

/* -------------------------------- helpers --------------------------------- */

export function setMonth(y, mo) {
  if (mo < 0) { y -= 1; mo = 11; }
  if (mo > 11) { y += 1; mo = 0; }
  state.month = { y, mo };
  invalidate();
}

export const monthKeyOfState = () =>
  state.month ? `${state.month.y}-${String(state.month.mo + 1).padStart(2, '0')}` : '';

export function ensureSelectedDay() {
  if (state.selectedDayKey && state.selectedDayKey.startsWith(monthKeyOfState())) return;
  const t = todayKey();
  state.selectedDayKey = t.startsWith(monthKeyOfState()) ? t : `${monthKeyOfState()}-01`;
}
