/* ============================================================================
   charts.js — hand-built inline SVG. No chart library, no canvas.

   Inline SVG wins here for one decisive reason: fill="var(--token)" resolves
   against the document, so every chart re-colours itself the instant the theme
   flips, with no re-render at all. It also gives exact geometry, text anywhere,
   and free tooltips via <title>.
   ========================================================================== */

import { escapeHtml } from './utils.js';

export const svgWrap = (w, h, inner, label) =>
  `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" ` +
  `aria-label="${escapeHtml(label || '')}" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;

/**
 * Horizontal bars. Horizontal rather than vertical on purpose: it sidesteps
 * rotated tick labels, which is where hand-rolled bar charts usually get ugly.
 * @param {{label:string,value:number,hue:string,icon?:string}[]} data
 */
export function barsH(data, { width = 420, rowH = 36, labelW = 140, pad = 8 } = {}) {
  if (!data.length) return emptyChart(width);
  const max = Math.max(1, ...data.map((d) => d.value));
  const h = data.length * rowH + pad * 2;
  const barX = labelW + 8;
  const barW = width - barX - 52;

  const rows = data.map((d, i) => {
    const y = pad + i * rowH;
    const w = Math.max(2, (d.value / max) * barW);
    return `<g>
      <title>${escapeHtml(`${d.label}: ${d.value}`)}</title>
      <text x="0" y="${y + rowH / 2 + 5}" class="t-mut">${escapeHtml(trim(d.label, 18))}</text>
      <rect class="track" x="${barX}" y="${y + 6}" width="${barW}" height="${rowH - 14}" rx="4"/>
      <rect x="${barX}" y="${y + 6}" width="${w}" height="${rowH - 14}" rx="4" fill="${d.hue}"/>
      <text x="${barX + w + 9}" y="${y + rowH / 2 + 5}" class="t-val">${d.value}</text>
    </g>`;
  }).join('');

  return svgWrap(width, h, rows, 'Bar chart');
}

/**
 * Donut. Built from stacked <circle> elements with stroke-dasharray rather than
 * arc-path maths — far fewer ways to get it subtly wrong, and always a perfect
 * ring.
 */
export function donut(data, { size = 172, thickness = 26, centre = '', sub = '' } = {}) {
  const total = data.reduce((n, d) => n + d.value, 0);
  if (!total) return emptyChart(size, size);

  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const mid = size / 2;

  let offset = 0;
  const rings = data.map((d) => {
    const len = (d.value / total) * c;
    const el = `<circle cx="${mid}" cy="${mid}" r="${r}" fill="none" stroke="${d.hue}"
        stroke-width="${thickness}" stroke-dasharray="${len} ${c - len}"
        stroke-dashoffset="${-offset}" transform="rotate(-90 ${mid} ${mid})">
        <title>${escapeHtml(`${d.label}: ${d.value} (${Math.round((d.value / total) * 100)}%)`)}</title>
      </circle>`;
    offset += len;
    return el;
  }).join('');

  const hole = centre
    ? `<text x="${mid}" y="${mid + 2}" text-anchor="middle" class="donut__hole">${escapeHtml(centre)}</text>
       <text x="${mid}" y="${mid + 20}" text-anchor="middle" class="donut__sub">${escapeHtml(sub)}</text>`
    : '';

  return svgWrap(size, size,
    `<circle cx="${mid}" cy="${mid}" r="${r}" fill="none" class="track" stroke="var(--surface-2)"
       stroke-width="${thickness}"/>${rings}${hole}`,
    'Donut chart');
}

/** Legend as HTML, not SVG, so it wraps and truncates like normal text. */
export function legend(data) {
  const total = data.reduce((n, d) => n + d.value, 0) || 1;
  return `<div class="legend">${data.map((d) => `
    <div class="legend__row">
      <span class="legend__sw" style="background:${d.hue}"></span>
      <span class="legend__name">${escapeHtml(d.label)}</span>
      <span class="legend__n">${d.value}</span>
      <span class="legend__pct">${Math.round((d.value / total) * 100)}%</span>
    </div>`).join('')}</div>`;
}

/**
 * Posts-per-day timeline for the selected month. Column chart rather than a
 * line: the values are small integer counts, and a column makes an empty day
 * read as a genuine gap rather than a dip.
 */
export function dayColumns(series, {
  width = 900, height = 190,
  postedHue = 'var(--st-posted)', pendingHue = 'var(--accent)',
} = {}) {
  if (!series.length) return emptyChart(width, height);

  const max = Math.max(1, ...series.map((d) => d.n));
  // padT leaves room for the count that sits above each bar; without it the
  // tallest day's label would be clipped by the top of the viewBox.
  const padL = 30, padB = 34, padT = 26;
  const plotW = width - padL - 8;
  const plotH = height - padB - padT;
  const step = plotW / series.length;
  const barW = Math.max(3, step * 0.66);
  const base = padT + plotH;

  // gridlines at 0 / mid / max
  const ticks = [...new Set([0, Math.ceil(max / 2), max])];
  const grid = ticks.map((t) => {
    const y = base - (t / max) * plotH;
    return `<line class="grid" x1="${padL}" y1="${y}" x2="${width - 8}" y2="${y}"/>
            <text x="0" y="${y + 4}" class="t-mut">${t}</text>`;
  }).join('');

  const bars = series.map((d, i) => {
    const x = padL + i * step + (step - barW) / 2;
    const day = +d.key.slice(8);

    // Every date is labelled, not every seventh: on a month-long axis the
    // whole point is being able to name the day a spike belongs to.
    const label = `<text x="${x + barW / 2}" y="${height - 12}" text-anchor="middle"
        class="t-day">${day}</text>`;

    if (!d.n) {
      return `<g><title>${escapeHtml(`${d.key}: no posts`)}</title>
        <rect x="${x}" y="${base - 2}" width="${barW}" height="2" rx="1"
              fill="var(--surface-3)"/>${label}</g>`;
    }

    const hPosted = (d.posted / max) * plotH;
    const hOther = (d.other / max) * plotH;
    const top = base - hPosted - hOther;

    // The total above the bar, and the shipped count inside the green foot
    // whenever that segment is tall enough to hold it. Reading a stacked bar
    // off a gridline is guesswork; the split is the whole point of the chart,
    // so both numbers are stated rather than estimated.
    const total = `<text x="${x + barW / 2}" y="${top - 6}" text-anchor="middle"
        class="t-count">${d.n}</text>`;
    const inside = (d.posted && hPosted >= 15)
      ? `<text x="${x + barW / 2}" y="${base - hPosted / 2 + 4}" text-anchor="middle"
          class="t-inbar">${d.posted}</text>` : '';

    // pending sits on top of posted, so the green foot of each bar reads as
    // "this much of that day actually shipped"
    const postedRect = d.posted
      ? `<rect x="${x}" y="${base - hPosted}" width="${barW}" height="${Math.max(2, hPosted)}"
              fill="${postedHue}" rx="2"/>` : '';
    const otherRect = d.other
      ? `<rect x="${x}" y="${top}" width="${barW}"
              height="${Math.max(2, hOther)}" fill="${pendingHue}" rx="2"/>` : '';

    return `<g>
      <title>${escapeHtml(`${d.key}: ${d.posted} posted, ${d.other} not posted`)}</title>
      ${postedRect}${otherRect}${inside}${total}${label}
    </g>`;
  }).join('');

  return svgWrap(width, height, `${grid}${bars}`, 'Posts per day, posted against outstanding');
}

function emptyChart(w = 300, h = 90) {
  return svgWrap(w, h,
    `<text x="${w / 2}" y="${h / 2 + 4}" text-anchor="middle" class="t-mut">No data</text>`,
    'No data');
}

const trim = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}\u2026` : String(s));
