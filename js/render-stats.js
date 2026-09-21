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
import { barsH, donut, legend, dayColumns, lines, markerSwatch } from './charts.js';
import {
  brandGrowth, platformSeries, platformsPresent, platformLatest,
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
      'Weekly count per account and channel. Colour is the platform, shape is the '
      + 'account, and both keys below filter the chart — pick any platforms and '
      + 'accounts to narrow it and rescale the axis.',
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
 * Follower count, week by week.
 *
 * Colour is the PLATFORM and the marker is the ACCOUNT, because those are the
 * two questions people bring to this chart and neither one is a sub-question
 * of the other: "how is Instagram doing across the brands" and "how is this
 * page doing across its channels". One line per account-and-platform answers
 * both; a line per account, summed, answers neither, since a page adding
 * followers on TikTok while losing them on Facebook looks flat.
 *
 * That is up to twenty-four lines, so the platform chips above the chart are
 * the legend AND the filter - one control, and the colours in it are the
 * colours in the plot. Facebook also dwarfs everything else here, which is
 * the other reason the filter matters: hiding it rescales the axis and makes
 * a channel with forty followers readable.
 */
function followersHTML() {
  const data = state.followers;
  if (!data) return '';
  if (!data.weeks.length) {
    return `<div class="empty"><strong>No follower readings yet</strong>
      Fill in a week on the follower tab and the growth chart appears here.</div>`;
  }

  const picked = state.followerPlatforms;
  const pickedAccounts = state.followerAccounts;
  const present = platformsPresent(data);
  const filtered = picked.size || pickedAccounts.size;

  /* ---- legend one: the platforms, by colour ---- */
  const chips = present.map((pk) => {
    const meta = platformMeta(pk);
    // Narrowed by the ACCOUNT filter but not by this one, so a chip says
    // what picking it would get you even while it is switched off.
    const { total, accounts } = platformLatest(data, pk, pickedAccounts);
    const on = !picked.size || picked.has(pk);
    return `<button type="button" class="pfilter${on ? ' is-on' : ''}"
        data-act="follower-platform" data-platform="${escapeHtml(pk)}"
        aria-pressed="${on}"
        title="${escapeHtml(`${meta.label}: ${nf.format(total)} followers across `
          + `${accounts} account${accounts === 1 ? '' : 's'} - click to show only this platform`)}">
        <span class="pfilter__sw" style="background:${meta.hue}"></span>
        ${platformMark(pk, 'pfilter__logo')}
        <span class="pfilter__name">${escapeHtml(meta.label)}</span>
        <span class="pfilter__n">${escapeHtml(nf.format(total))}</span>
      </button>`;
  }).join('');

  const filterBar = `<div class="pfilters" role="group" aria-label="Platforms">
      ${chips}
      ${filtered ? `<button type="button" class="linkbtn"
          data-act="follower-clear">Show all</button>` : ''}
    </div>`;

  /* ---- legend two: the accounts, by marker shape ---- */
  /*
   * Every account in the sheet is listed, including any with nothing on the
   * platforms currently showing. A key that dropped rows as you filtered
   * would be a filter you could switch off but not back on.
   *
   * Each row's figures are narrowed by the PLATFORM filter but not by this
   * one, for the same reason the chips are: a row has to say what it is
   * worth while it is switched off.
   */
  const rows = data.accounts.map((a) => {
    const mine = platformSeries(data, picked).filter((s) => s.account.name === a.name);
    const on = !pickedAccounts.size || pickedAccounts.has(a.name);
    const hue = a.brandKey ? brandMeta(a.brandKey).hue : 'var(--text-dim)';

    if (!mine.length) {
      return `<span class="flist__row is-empty"
          title="${escapeHtml(`${a.name} has no count on the platforms showing`)}">
          ${markerSwatch(a.idx, 'var(--text-faint)')}
          <span class="flist__name">${escapeHtml(a.name)}</span>
          <span class="flist__n">–</span></span>`;
    }

    /*
     * Totalled over the VISIBLE platforms, so the figure matches the plot.
     *
     * Compared by week rather than by "the last two points of each line": a
     * platform added halfway through has fewer points than its neighbours,
     * and pairing them off by position would difference two different weeks.
     */
    const weeksWith = [...new Set(mine.flatMap((s) => s.points.map((p) => p.i)))]
      .sort((x, y) => x - y);
    const sumAt = (wi) => mine.reduce((n, s) =>
      n + (s.points.find((p) => p.i === wi)?.y || 0), 0);

    const now = sumAt(weeksWith[weeksWith.length - 1]);
    const prevWeek = weeksWith[weeksWith.length - 2];
    const d = prevWeek === undefined ? null : now - sumAt(prevWeek);
    const dir = d === null ? 'first' : d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
    const chip = d === null
      ? '<i class="fgrow fgrow--first">first reading</i>'
      : `<i class="fgrow fgrow--${dir}">${d > 0 ? '▲' : d < 0 ? '▼' : '±'} `
        + `${nf.format(Math.abs(d))}</i>`;

    const on2 = mine.map((s) => platformMeta(s.platformKey).label).join(', ');
    return `<button type="button" class="flist__row${on ? ' is-on' : ''}"
        data-act="follower-account" data-account="${escapeHtml(a.name)}"
        aria-pressed="${on}"
        title="${escapeHtml(`${a.name} on ${on2} - click to show only this account`)}">
      ${markerSwatch(a.idx, hue)}
      <span class="flist__name">${escapeHtml(a.name)}</span>
      <span class="flist__n">${escapeHtml(nf.format(now))}</span>
      ${chip}
    </button>`;
  }).join('');

  const accountBar = `<div class="flist" role="group" aria-label="Accounts">${rows}</div>`;

  /* ---- the plot ---- */
  const series = platformSeries(data, picked, pickedAccounts).map((s) => ({
    label: `${s.account.name} on ${platformMeta(s.platformKey).label}`,
    // Under each value on the plot. Colour and shape already encode both of
    // these; spelling them out is what lets a label be read on its own
    // instead of matched back to two keys.
    caption: `${s.account.name} · ${platformMeta(s.platformKey).label}`,
    hue: platformMeta(s.platformKey).hue,
    variant: s.account.idx,
    points: s.points.map((p) => ({
      i: p.i, y: p.y,
      tip: `${s.account.name} · ${platformMeta(s.platformKey).label}
`
         + `${p.week.label}: ${nf.format(p.y)} followers`,
    })),
  }));

  if (!series.length) {
    return filterBar + accountBar + `<div class="empty"><strong>Nothing to show</strong>
      No account you have picked has a count on the platforms you have picked.</div>`;
  }

  const note = data.weeks.length < 2
    ? `<p class="flist__note">One reading so far, from ${escapeHtml(data.weeks[0].label)}.
       Week-on-week growth appears here, and beside each brand in the grid below,
       as soon as a second week is filled in.</p>`
    : '';

  /*
   * Chips, then the account key, then the plot.
   *
   * Both keys sit together above the chart - one per visual channel, colour
   * and shape - so the chart is read with its whole legend already in hand
   * rather than halfway down the card.
   */
  return filterBar + accountBar + lines(series, {
    width: 900, height: 250,
    xLabels: data.weeks.map((w) => w.short),
    fmt: (v) => nf.format(v),
    labels: true,
  }) + note;
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
