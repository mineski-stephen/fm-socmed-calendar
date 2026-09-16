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
export function dayColumns(series, { width = 900, height = 170, hue = 'var(--accent)' } = {}) {
  if (!series.length) return emptyChart(width, height);

  const max = Math.max(1, ...series.map((d) => d.n));
  const padL = 30, padB = 26, padT = 12;
  const plotW = width - padL - 8;
  const plotH = height - padB - padT;
  const step = plotW / series.length;
  const barW = Math.max(3, step * 0.66);

  // horizontal gridlines at 0 / mid / max
  const ticks = [0, Math.ceil(max / 2), max].filter((v, i, a) => a.indexOf(v) === i);
  const grid = ticks.map((t) => {
    const y = padT + plotH - (t / max) * plotH;
    return `<line class="grid" x1="${padL}" y1="${y}" x2="${width - 8}" y2="${y}"/>
            <text x="0" y="${y + 3.5}" class="t-mut">${t}</text>`;
  }).join('');

  const bars = series.map((d, i) => {
    const x = padL + i * step + (step - barW) / 2;
    const h = d.n ? Math.max(2, (d.n / max) * plotH) : 0;
    const y = padT + plotH - h;
    const day = +d.key.slice(8);
    const label = i % 7 === 0 || i === series.length - 1
      ? `<text x="${x + barW / 2}" y="${height - 5}" text-anchor="middle" class="t-mut">${day}</text>`
      : '';
    const bar = d.n
      ? `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="2.5" fill="${hue}"/>`
      : `<rect x="${x}" y="${padT + plotH - 2}" width="${barW}" height="2" rx="1"
           fill="var(--surface-3)"/>`;
    return `<g><title>${escapeHtml(`${d.key}: ${d.n} post${d.n === 1 ? '' : 's'}`)}</title>
        ${bar}${label}</g>`;
  }).join('');

  return svgWrap(width, height, `${grid}${bars}`, 'Posts per day');
}

function emptyChart(w = 300, h = 90) {
  return svgWrap(w, h,
    `<text x="${w / 2}" y="${h / 2 + 4}" text-anchor="middle" class="t-mut">No data</text>`,
    'No data');
}

const trim = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}\u2026` : String(s));
