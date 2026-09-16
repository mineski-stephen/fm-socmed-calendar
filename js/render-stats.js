/* ============================================================================
   render-stats.js — KPI cards and charts. Everything respects the active
   filters, so the dashboard answers questions about whatever slice is on
   screen rather than always about the whole sheet.
   ========================================================================== */

import { escapeHtml } from './utils.js';
import { MONTH_ABBR } from './config.js';
import { partsFromKey, monthLabel } from './dates.js';
import { state } from './state.js';
import { getStats } from './selectors.js';
import { brandMeta, platformMeta, typeMeta, statusMeta } from './data.js';
import { barsH, donut, legend, dayColumns } from './charts.js';

const card = (title, hint, body, wide = false) =>
  `<section class="card${wide ? ' card--wide' : ''}">
     <div class="card__head">
       <h3 class="card__title">${escapeHtml(title)}</h3>
       ${hint ? `<p class="card__hint">${escapeHtml(hint)}</p>` : ''}
     </div>
     <div class="card__body">${body}</div>
   </section>`;

const kpi = (label, value, sub, hue, pct) =>
  `<div class="kpi"${hue ? ` style="--kpi-c:${hue}"` : ''}>
     <span class="kpi__label">${escapeHtml(label)}</span>
     <span class="kpi__value">${escapeHtml(String(value))}</span>
     ${sub ? `<span class="kpi__sub">${escapeHtml(sub)}</span>` : ''}
     ${pct != null ? `<span class="kpi__bar"><i style="width:${Math.min(100, pct)}%"></i></span>` : ''}
   </div>`;

const prettyDate = (key) => {
  const p = partsFromKey(key);
  return p ? `${MONTH_ABBR[p.mo]} ${p.d}` : '\u2014';
};

export function renderStats(container) {
  const s = getStats();

  if (!s.shown) {
    container.innerHTML =
      `<div class="empty"><strong>Nothing matches these filters</strong>
       <button class="btn btn--ghost" data-act="clear-filters">Clear filters</button></div>`;
    return;
  }

  /* ------------------------------- KPIs ---------------------------------- */

  const kpis = [
    kpi('Posts in view', s.shown,
        s.shown === s.total ? 'the whole tracker' : `of ${s.total} in the tracker`),
    kpi('Posted', s.posted, `${s.postedPct}% of what is in view`,
        'var(--st-posted)', s.postedPct),
    kpi('Needs action', s.needs, 'not yet scheduled or approved', 'var(--st-needs)'),
    kpi('Locked in', s.settled, `approved, scheduled or live · ${s.settledPct}%`,
        'var(--st-approved)', s.settledPct),
    kpi('Days with content', s.daysWithContent, `avg ${s.avgPerDay.toFixed(1)} posts per active day`),
    kpi('Busiest day', s.busiest.n || 0,
        s.busiest.key ? `on ${prettyDate(s.busiest.key)}` : '\u2014', 'var(--accent)'),
    kpi('Date range', s.firstDate ? prettyDate(s.firstDate) : '\u2014',
        s.lastDate ? `through ${prettyDate(s.lastDate)}` : ''),
  ];
  if (s.overdue) {
    kpis.push(kpi('Past due', s.overdue,
      'date gone by, still not Posted', 'var(--danger)'));
  }
  if (s.crossposts) {
    kpis.push(kpi('Crossposts', s.crossposts,
      `${s.placements} placements across all platforms`, 'var(--accent-2)'));
  }
  if (s.incomplete) {
    kpis.push(kpi('Incomplete rows', s.incomplete,
      'missing a platform or post type', 'var(--warn)'));
  }

  /* ------------------------------ datasets -------------------------------- */

  const brandData = Array.from(s.byBrand.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ label: brandMeta(k).label, value: v, hue: brandMeta(k).hue }));

  const platformData = s.byPlatform
    .map(([k, v]) => ({ label: platformMeta(k).label, value: v, hue: platformMeta(k).hue }));

  const typeData = s.byType
    .map(([k, v]) => ({ label: typeMeta(k).label, value: v, hue: typeHue(k) }));

  const statusData = s.byStatus
    .map(([k, v]) => ({ label: statusMeta(k).label, value: v, hue: statusMeta(k).hue }));

  /* ------------------------------- charts --------------------------------- */

  const charts = [
    card('Posts per brand', 'Who is publishing how much',
      barsH(brandData, { width: 420 })),

    card('Platform mix',
      s.crossposts
        ? 'Where the content is going. A crosspost counts once per platform.'
        : 'Where the content is going',
      barsH(platformData, { width: 420 })),

    card('Status breakdown', 'How much of the plan is actually shipped',
      `<div class="donutwrap">
         ${donut(statusData, { centre: `${s.postedPct}%`, sub: 'posted' })}
         ${legend(statusData)}
       </div>`),

    card('Type of post', 'Format mix across the selection',
      `<div class="donutwrap">
         ${donut(typeData, { centre: String(s.shown), sub: 'posts' })}
         ${legend(typeData)}
       </div>`),

    card(`Posts per day \u00b7 ${monthLabel(state.month.y, state.month.mo)}`,
      'Clustering and gaps in the schedule, and how much of each day shipped',
      dayColumns(s.perDay, { width: 900 }) +
      legend([
        { label: 'Posted', value: s.posted, hue: 'var(--st-posted)' },
        { label: 'Not posted', value: s.shown - s.posted, hue: 'var(--accent)' },
      ]), true),

    card('Brand \u00d7 platform', 'Which brand covers which channel',
      matrixHTML(s), true),

    card('Content readiness',
      'What the tracker still needs filled in for the posts in view',
      readinessHTML(s), true),
  ];

  container.innerHTML =
    `<div class="kpis">${kpis.join('')}</div>` +
    `<div class="charts">${charts.join('')}</div>` +
    `<p class="statgrid-note">\u24d8 Engagement figures shown on the mock layouts are
       generated placeholders, not real platform metrics. Every number on this tab is
       counted from the tracker itself.</p>`;
}

/* ------------------------------ sub-renders -------------------------------- */

const TYPE_HUES = {
  static:  'var(--accent)',
  reels:   'var(--pf-instagram)',
  album:   'var(--pf-facebook)',
  dynamic: 'var(--pf-tiktok)',
  story:   'var(--accent-2)',
  ugc:     'var(--st-approved)',
  text:    'var(--st-approval)',
  link:    'var(--pf-linkedin)',
};
const typeHue = (k) => TYPE_HUES[k] || 'var(--st-unknown)';

/** Brand x platform heat grid — a cheap way to spot an uncovered channel. */
function matrixHTML(s) {
  const brands = Array.from(s.matrix.keys())
    .sort((a, b) => (s.byBrand.get(b) || 0) - (s.byBrand.get(a) || 0));
  const platforms = s.byPlatform.map(([k]) => k);
  if (!brands.length || !platforms.length) return '<div class="empty">No data</div>';

  const max = Math.max(1, ...brands.flatMap((b) =>
    platforms.map((p) => s.matrix.get(b)?.get(p) || 0)));

  const head = platforms.map((p) => {
    const meta = platformMeta(p);
    return `<th><span class="matrix__hd">${meta.icon
      ? `<img src="${meta.icon}" alt="">` : ''}${escapeHtml(meta.label)}</span></th>`;
  }).join('');

  const rows = brands.map((bk) => {
    const b = brandMeta(bk);
    const cells = platforms.map((p) => {
      const n = s.matrix.get(bk)?.get(p) || 0;
      const w = Math.round((n / max) * 65);
      return `<td><span class="matrix__n${n ? '' : ' matrix__n--zero'}" style="--w:${w}">` +
             `${n || '\u2013'}</span></td>`;
    }).join('');
    // placements, not rows: a crosspost contributes a count to two columns,
    // so summing rows is the only total that reconciles with the cells
    const total = s.byBrandPlacements.get(bk) || 0;
    return `<tr><td><span class="fchip__dot" style="--c:${b.hue}"></span> ` +
           `${escapeHtml(b.label)}</td>${cells}<td class="matrix__tot">${total}</td></tr>`;
  }).join('');

  return `<table class="matrix">
      <thead><tr><th>Brand</th>${head}<th>Placements</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/**
 * The most operationally useful panel on this tab: it names exactly how many
 * rows still need a caption, an asset, or a live link.
 */
function readinessHTML(s) {
  return `<div class="readiness">${s.readiness.map((r) => {
    const pct = r.of ? Math.round((r.n / r.of) * 100) : 0;
    return `<div class="readiness__row" style="--c:${r.hue}">
        <div class="readiness__top">
          <span class="readiness__name">${escapeHtml(r.label)}</span>
          <span class="readiness__n">${r.n} of ${r.of} \u00b7 ${pct}%</span>
        </div>
        <div class="readiness__bar"><i style="width:${pct}%"></i></div>
      </div>`;
  }).join('')}</div>`;
}
