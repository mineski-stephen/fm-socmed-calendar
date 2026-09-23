/* ============================================================================
   render-plan.js — the top of the Stats tab: the month's tracker set against
   the monthly content plan, laid out the way the client deck lays out the
   plan itself ("Brand distribution", then "Monthly deliverables").

   Everything here is a pure string builder over getPlanStats(). The numbers
   on every tile are three deep - posted, scheduled, planned - and the bar
   under each one draws all three at once: green for what has shipped, the
   accent for what is scheduled but not yet out, and the empty track for the
   gap still to fill before the plan is met.
   ========================================================================== */

import { PLAN } from './config.js';
import { escapeHtml } from './utils.js';
import { monthLabel } from './dates.js';
import { state, hasActiveFilters } from './state.js';
import { getPlanStats } from './selectors.js';
import { brandMeta, typeMeta } from './data.js';

const PLAN_BRAND_TILES = new Set(['funalomax', 'funalomax-studios', 'solaire-online']);
const PLAN_TYPE_TILES = new Set(['static', 'reels', 'dynamic', 'album', 'ugc', 'story']);

const brandTile = (k) => `var(--tile-${PLAN_BRAND_TILES.has(k) ? k : 'unknown'})`;
const typeTile = (k) => `var(--tile-${PLAN_TYPE_TILES.has(k) ? k : 'other'})`;
const typeName = (k) => PLAN.types[k]?.label || typeMeta(k).label;

const pct = (n, of) => (of ? Math.round((n / of) * 100) : 0);

/**
 * Posted, then scheduled-but-not-posted, against the plan.
 *
 * Scaled to whichever is larger, the plan or what is scheduled, so a line
 * that is OVER plan draws full and says so rather than overflowing its
 * track. Outside the plan there is nothing to measure against, and the bar
 * becomes a plain posted/scheduled split.
 */
function progressBar(c) {
  const scale = Math.max(c.plan, c.actual) || 1;
  const done = (c.posted / scale) * 100;
  const rest = ((c.actual - c.posted) / scale) * 100;
  const tip = c.inPlan
    ? `${c.posted} posted, ${c.actual - c.posted} scheduled, `
      + (c.actual >= c.plan ? `plan of ${c.plan} met` : `${c.plan - c.actual} short of the plan of ${c.plan}`)
    : `${c.posted} posted, ${c.actual - c.posted} scheduled - not in the plan`;
  return `<span class="pbar" title="${escapeHtml(tip)}">
      <i class="pbar__done" style="width:${done.toFixed(1)}%"></i><i
         class="pbar__sched" style="width:${rest.toFixed(1)}%"></i></span>`;
}

/** "49" over "/ 56", or just "3" when there is no plan for it. */
const figure = (c) =>
  `<b>${c.actual}</b>${c.inPlan ? `<i>/ ${c.plan}</i>` : ''}`;

/* ------------------------------ brand tiles ------------------------------- */

/**
 * `growth` draws a brand's follower change for its tile. Passed in rather than
 * imported: it lives with the follower charts in render-stats.js, which
 * already imports this module, and the dependency only runs one way.
 */
export function brandDistributionHTML({ growth = () => '' } = {}) {
  const d = getPlanStats();

  const tiles = d.brands.map((bk) => {
    const c = d.byBrand[bk];
    const share = pct(c.actual, d.total.actual);
    return `<div class="btile" style="--t:${brandTile(bk)}">
        <div class="btile__n">${figure(c)}</div>
        <div class="btile__name">${escapeHtml(brandMeta(bk).label)}</div>
        ${growth(bk) ? `<div class="btile__grow">${growth(bk)}</div>` : ''}
        <div class="btile__sub">${c.inPlan
          ? `${share}% of the month’s creatives · plan ${pct(c.plan, d.total.plan)}%`
          : `${share}% of the month’s creatives · not in the plan`}</div>
        ${progressBar(c)}
      </div>`;
  }).join('');

  // Content type x brand. Cells read "actual / plan", matching the tiles and
  // the brand x platform grid further down the tab.
  const cellHTML = (c) => {
    if (!c.inPlan && !c.actual) return '<td><span class="plan__nil">–</span></td>';
    const mod = !c.inPlan ? ' is-extra' : c.actual >= c.plan ? ' is-met' : '';
    return `<td><span class="plan__cell${mod}" title="${escapeHtml(
        c.inPlan ? `${c.actual} scheduled of ${c.plan} planned, ${c.posted} posted`
                 : `${c.actual} scheduled, not in the plan`)}">`
      + `${figure(c)}</span></td>`;
  };

  const head = d.brands.map((bk) =>
    `<th>${escapeHtml(brandMeta(bk).label)}</th>`).join('');
  const rows = d.types.map((t) => `<tr>
      <td>${escapeHtml(typeName(t))}${d.byType[t].inPlan ? '' : ' <em class="plan__tag">not in plan</em>'}</td>
      ${d.brands.map((bk) => cellHTML(d.cell[t][bk])).join('')}
      ${cellHTML(d.byType[t])}
    </tr>`).join('');
  const foot = `<tr>
      <td>Total</td>
      ${d.brands.map((bk) => cellHTML(d.byBrand[bk])).join('')}
      ${cellHTML(d.total)}
    </tr>`;

  return `<div class="btiles">${tiles}</div>
    <table class="matrix plan__table">
      <thead><tr><th>Content type</th>${head}<th>Total</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot>${foot}</tfoot>
    </table>`;
}

/* ---------------------------- deliverable tiles --------------------------- */

export function deliverablesHTML() {
  const d = getPlanStats();
  // A format with two posts a month is "<1 / wk", not "~0 / wk".
  const perWeek = (n) => (n && n / d.weeks < 0.5 ? '<1' : String(Math.round(n / d.weeks)));

  const tiles = d.types.map((t) => {
    const c = d.byType[t];
    const pace = c.actual ? `${perWeek(c.actual).startsWith('<') ? '' : '~'}${perWeek(c.actual)} / wk`
      : 'none scheduled';
    const planPace = c.inPlan ? ` · plan ~${perWeek(c.plan)}` : '';
    const blurb = PLAN.types[t]?.blurb;
    return `<div class="dtile">
        <div class="dtile__block" style="--t:${typeTile(t)}">${figure(c)}</div>
        <div class="dtile__body">
          <h4 class="dtile__name">${escapeHtml(typeName(t))}</h4>
          <p class="dtile__pace">${escapeHtml(pace + planPace)}</p>
          ${progressBar(c)}
          ${blurb ? `<p class="dtile__blurb">${escapeHtml(blurb)}</p>`
                  : '<p class="dtile__blurb dtile__blurb--extra">In the tracker but not in the monthly plan.</p>'}
        </div>
      </div>`;
  }).join('');

  return `<div class="dtiles">${tiles}</div>
    <div class="plan__total">Total <b>${d.total.actual}</b> of ${d.total.plan}
      creatives / month <span>· ${d.total.posted} posted</span></div>
    <p class="plan__extras">${PLAN.extras.map(escapeHtml).join(' <span>|</span> ')}</p>`;
}

/** The card hints, which say what month and what slice the figures cover. */
export function planHints() {
  const d = getPlanStats();
  const month = state.month ? monthLabel(state.month.y, state.month.mo) : 'this month';
  const filtered = hasActiveFilters() ? ' Under the current filters.' : '';
  return {
    brands: `${d.total.actual} creatives scheduled for ${month} against a monthly plan of `
      + `${d.total.plan}, across the three-brand architecture.${filtered}`,
    types: `What each format is for, and how ${month} is tracking against it. Bars: posted, `
      + `scheduled, and the gap still to the plan.${filtered}`,
  };
}
