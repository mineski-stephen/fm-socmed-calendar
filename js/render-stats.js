/* ============================================================================
   render-stats.js — KPI cards and charts. Everything respects the active
   filters, so the dashboard answers questions about whatever slice is on
   screen rather than always about the whole sheet.
   ========================================================================== */

import { escapeHtml } from './utils.js';
import { monthLabel } from './dates.js';
import { state } from './state.js';
import { getStats } from './selectors.js';
import { brandMeta, platformMeta, typeMeta, statusMeta } from './data.js';
import { barsH, donut, legend, dayColumns, lines } from './charts.js';
import { brandDistributionHTML, deliverablesHTML, planHints } from './render-plan.js';
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



export function renderStats(container) {
  const s = getStats();

  if (!s.shown) {
    container.innerHTML =
      `<div class="empty"><strong>Nothing matches these filters</strong>
       <button class="btn btn--ghost" data-act="clear-filters">Clear filters</button></div>`;
    return;
  }

  /* ------------------------------- the plan -------------------------------- */

  /*
   * What used to be a row of KPI cards, now laid out the way the client deck
   * lays out the plan: brand distribution, then monthly deliverables, each
   * tile set against its commitment. The status and timing figures the old
   * cards carried are still on the tab - Status breakdown has the posted
   * share, Posts per day has the busiest day and the date range, and the
   * past-due count lives in the filter bar and the notices.
   */
  const hints = planHints();
  const planCards = [
    card('Brand distribution', hints.brands, brandDistributionHTML({ growth: growthChip }), true),
    card('Monthly deliverables', hints.types, deliverablesHTML(), true),
  ];

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
    ...planCards,

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

    card('Content readiness',
      'What the tracker still needs filled in for the posts in view',
      readinessHTML(s), true),
  ];

  container.innerHTML =
    `<div class="charts">${charts.join('')}</div>` +
    `<p class="statgrid-note">\u24d8 Engagement figures shown on the mock layouts are
       generated placeholders, not real platform metrics. Every number on this tab is
       counted from the tracker itself.</p>`;
}

/* ------------------------------ sub-renders -------------------------------- */

/* The same colour for a format everywhere on the tab - its deliverable tile,
   its donut segment. Dynamic used to borrow TikTok's pink, which sat right
   beside Reels' Instagram pink; it is amber now. */
const TYPE_HUES = {
  static:  'var(--tile-static)',
  reels:   'var(--tile-reels)',
  album:   'var(--tile-album)',
  dynamic: 'var(--tile-dynamic)',
  story:   'var(--tile-story)',
  ugc:     'var(--tile-ugc)',
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
 * The follower change beside a brand's name, on its Brand distribution tile.
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
      ${escapeHtml(nf.format(g.now))} <em>followers</em></span>`;
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
       Week-on-week growth appears on each chart, and on each brand's tile at the top
       of the tab, as soon as a second week is filled in.</p>`
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
