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
import { barsH, donut, legend, dayColumns, lines } from './charts.js';
import {
  brandGrowth, seriesOn, accountsOn, platformsPresent,
} from './followers.js';
import { platformMark } from './render-post.js';

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
    // Why the post count is larger than the number of rows in the sheet.
    kpis.push(kpi('Crossposts', s.crossposts,
      `${s.rowsShown} tracker row${s.rowsShown === 1 ? '' : 's'} make ${s.shown} posts`,
      'var(--accent-2)'));
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

    card('Follower growth',
      'One chart per channel, each scaled to its own numbers. The account key above '
      + 'a chart is also its filter — pick accounts to narrow that chart alone.',
      followersHTML(), true),

    card('Brand \u00d7 platform',
      'Posted against planned, per channel. The last column reads the total, then '
      + 'posted / for posting; the figure beside a brand is its follower change.',
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

/* ------------------------------- followers --------------------------------- */

const nf = new Intl.NumberFormat('en-US');
/* One shared empty set, so an unfiltered panel allocates nothing per render. */
const EMPTY_SET = new Set();

/*
 * An account's colour on the follower charts, by its position in the sheet.
 *
 * Not its brand's colour: a brand can own a page and a backup of that page,
 * and both land on the same chart, so brand colour would draw them as one.
 * Telling the lines apart is the job here, and the palette in tokens.css is
 * picked for exactly that.
 */
const ACCOUNT_HUES = 6;
const accountHue = (acc) => `var(--acc-${acc.idx % ACCOUNT_HUES})`;

/** The round swatch that ties an account's filter chip to its line. */
const accountDot = (hue) => `<span class="legend__sw legend__sw--dot"
  style="background:${hue}"></span>`;

const sign = (n) => (n > 0 ? '+' : n < 0 ? '−' : '±');
const signed = (n) => `${sign(n)}${nf.format(Math.abs(n))}`;
const signedPct = (n) => `${sign(n)}${Math.abs(n).toFixed(1)}%`;

/**
 * The follower change beside a brand's name in the matrix.
 *
 * Nothing is drawn on the very first reading. A "0" there would read as "flat
 * this week", which is a claim about a week we have not measured; the absence
 * of a chip, with the whole story on the card above, is the truthful version.
 * The brand's current standing still rides along as a tooltip either way.
 */
function growthChip(brandKey) {
  const data = state.followers;
  if (!data?.weeks.length) return '';
  const g = brandGrowth(data, brandKey);
  if (!g) return '';

  const owned = data.brands.get(brandKey)?.accounts || [];
  const via = owned.length > 1 ? ` · best of ${owned.join(' / ')}` : '';
  const now = `${nf.format(g.now)} followers across all platforms on ${g.at.label}${via}`;

  if (g.delta === null) {
    return `<span class="fgrow fgrow--first"
      title="${escapeHtml(`${now} - first reading, so there is nothing to compare it with yet`)}">
      ${escapeHtml(nf.format(g.now))}<em>followers</em></span>`;
  }

  const dir = g.delta > 0 ? 'up' : g.delta < 0 ? 'down' : 'flat';
  // Direction rides on the arrow and the sign as well as the colour, so it
  // survives a greyscale print and a red-green colourblind reader.
  const arrow = g.delta > 0 ? '▲' : g.delta < 0 ? '▼' : '±';
  const pct = g.pct === null ? '' : ` (${signedPct(g.pct)})`;
  return `<span class="fgrow fgrow--${dir}" title="${escapeHtml(
      `${now} · ${signed(g.delta)}${pct} since ${g.since.label}`)}">
      ${arrow} ${escapeHtml(nf.format(Math.abs(g.delta)))}</span>`;
}

/**
 * Follower count, week by week - one small chart per platform.
 *
 * One combined chart could not be read. Facebook dwarfs every other channel,
 * so a shared axis pinned a page with forty YouTube subscribers to the floor,
 * and a dozen lines in one frame needed three lanes of labels to say which
 * was which. Split by platform, each chart scales to its own numbers and
 * carries at most a handful of lines.
 *
 * Within a chart the platform is a given, so the lines are all its colour and
 * the ACCOUNT is what varies: marker shape, dash pattern, and the caption
 * under each value. The account key above each chart is also its filter, and
 * each chart keeps its own - hiding a brand's backup page where it competes
 * with the main one on Facebook should not hide that brand from Instagram.
 */
function followersHTML() {
  const data = state.followers;
  if (!data) return '';
  if (!data.weeks.length) {
    return `<div class="empty"><strong>No follower readings yet</strong>
      Fill in a week on the follower tab and the growth charts appear here.</div>`;
  }

  const panels = platformsPresent(data).map((pk) => panelHTML(data, pk)).join('');
  const note = data.weeks.length < 2
    ? `<p class="flist__note">One reading so far, from ${escapeHtml(data.weeks[0].label)}.
       Week-on-week growth appears on each chart, and beside each brand in the grid
       below, as soon as a second week is filled in.</p>`
    : '';

  return `<div class="fpanels">${panels}</div>${note}`;
}

/** The change chip shared by a panel head and its account rows. */
function deltaChip(d, since, extra = '') {
  if (d === null) return '<i class="fgrow fgrow--first">first reading</i>';
  const dir = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
  const arrow = d > 0 ? '▲' : d < 0 ? '▼' : '±';
  const title = since ? ` title="${escapeHtml(`${signed(d)}${extra} since ${since}`)}"` : '';
  return `<i class="fgrow fgrow--${dir}"${title}>${arrow} ${nf.format(Math.abs(d))}</i>`;
}

/**
 * One platform's chart, with its own account key and filter.
 *
 * Figures on a row are that account's own, so a switched-off row still says
 * what turning it back on would get. Figures in the head are the visible
 * accounts summed, so they describe the chart as drawn.
 */
function panelHTML(data, pk) {
  const meta = platformMeta(pk);
  const roster = accountsOn(data, pk);
  const picked = state.followerAccounts.get(pk) || EMPTY_SET;

  // Compared by week rather than by "the last two points": an account added
  // halfway through has fewer readings, and pairing by position would
  // difference two different weeks.
  const weeksOf = (list) =>
    [...new Set(list.flatMap((sr) => sr.points.map((p) => p.i)))].sort((x, y) => x - y);
  const sumAt = (list, wi) =>
    list.reduce((n, sr) => n + (sr.points.find((p) => p.i === wi)?.y || 0), 0);
  const standing = (list) => {
    const ws = weeksOf(list);
    if (!ws.length) return { now: 0, delta: null, since: '' };
    const now = sumAt(list, ws[ws.length - 1]);
    const prev = ws[ws.length - 2];
    return {
      now,
      delta: prev === undefined ? null : now - sumAt(list, prev),
      since: prev === undefined ? '' : data.weeks[prev].label,
    };
  };

  /* ---- the key, which is also the filter ---- */
  const rows = roster.map((acc) => {
    const mine = seriesOn(data, pk, new Set([acc.name]));
    const st = standing(mine);
    const on = !picked.size || picked.has(acc.name);
    return `<button type="button" class="flist__row${on ? ' is-on' : ''}"
        data-act="follower-account" data-platform="${escapeHtml(pk)}"
        data-account="${escapeHtml(acc.name)}" aria-pressed="${on}"
        title="${escapeHtml(`${acc.name} on ${meta.label} - click to show only this account`)}">
      ${accountDot(accountHue(acc))}
      <span class="flist__name">${escapeHtml(acc.name)}</span>
      <span class="flist__n">${escapeHtml(nf.format(st.now))}</span>
      ${deltaChip(st.delta, st.since)}
    </button>`;
  }).join('');

  /* ---- the plot ---- */
  const drawn = seriesOn(data, pk, picked);
  const head = standing(drawn);
  const body = drawn.length
    ? lines(drawn.map((sr) => ({
        label: sr.account.name,
        // The platform is the panel's own title, so the caption names only
        // what varies inside it.
        caption: sr.account.name,
        hue: accountHue(sr.account),
        points: sr.points.map((p) => ({
          i: p.i, y: p.y,
          tip: `${sr.account.name} · ${meta.label}
`
             + `${p.week.label}: ${nf.format(p.y)} followers`,
        })),
      })), {
        width: 460, height: 200,
        xLabels: data.weeks.map((w) => w.short),
        fmt: (v) => nf.format(v),
        labels: true,
      })
    : `<div class="empty empty--sm"><strong>No account showing</strong>
       Pick one above to draw the chart.</div>`;

  return `<section class="fpanel" style="--pf:${meta.hue}">
      <header class="fpanel__head">
        ${platformMark(pk, 'fpanel__logo')}
        <h4 class="fpanel__name">${escapeHtml(meta.label)}</h4>
        <span class="fpanel__n">${escapeHtml(nf.format(head.now))}</span>
        ${deltaChip(head.delta, head.since, ` on ${meta.label}`)}
        ${picked.size ? `<button type="button" class="linkbtn"
            data-act="follower-clear" data-platform="${escapeHtml(pk)}">All</button>` : ''}
      </header>
      <div class="flist" role="group" aria-label="${escapeHtml(`${meta.label} accounts`)}">${rows}</div>
      ${body}
    </section>`;
}

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
    const growth = growthChip(bk);
    const cells = platforms.map((p) => {
      const n = s.matrix.get(bk)?.get(p) || 0;
      if (!n) return `<td><span class="matrix__n matrix__n--zero">–</span></td>`;
      const done = s.matrixPosted.get(bk)?.get(p) || 0;
      const w = Math.round((n / max) * 65);
      // Shipped against planned. A bare total says how much work there is but
      // nothing about how much of it is done, which is the question this grid
      // is usually being asked.
      return `<td><span class="matrix__n" style="--w:${w}" ` +
             `title="${escapeHtml(`${done} of ${n} posted`)}">` +
             `<b>${done}</b><i>/${n}</i></span></td>`;
    }).join('');
    /*
     * The row total, split the way the cells are: how many posts in all, and
     * of those how many have shipped against how many are still to go. A bare
     * total says how much work there is and nothing about how much is done.
     */
    const total = s.byBrand.get(bk) || 0;
    let done = 0;
    for (const n of (s.matrixPosted.get(bk)?.values() || [])) done += n;
    const togo = total - done;

    return `<tr>
      <td><span class="fchip__dot" style="--c:${b.hue}"></span>
        ${escapeHtml(b.label)}${growth}</td>
      ${cells}
      <td class="matrix__tot" title="${escapeHtml(
        `${total} post${total === 1 ? '' : 's'} · ${done} posted · ${togo} for posting`)}">
        <b>${total}</b><i>${done}/${togo}</i>
      </td></tr>`;
  }).join('');

  return `<table class="matrix">
      <thead><tr><th>Brand</th>${head}<th>Total<br><span class="matrix__sub">posted / for posting</span></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/**
 * The most operationally useful panel on this tab: it names exactly how many
 * posts still need a caption, an asset, or a live link.
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
