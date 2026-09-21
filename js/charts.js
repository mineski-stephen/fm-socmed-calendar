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

/**
 * Multi-series line chart, for the weekly follower count.
 *
 * A line rather than columns because the question here is a trajectory, not a
 * set of independent tallies - and unlike posts per day there is no such thing
 * as a week with zero followers, so a gap in the line means "not collected"
 * rather than "none". Series are drawn with their points marked, so a reading
 * is always visible as a reading even where the line between two of them is
 * long.
 *
 * With a single reading there is no line to draw at all. Rather than render an
 * empty plot, each series becomes one labelled dot on a single tick: it is an
 * honest picture of "one week in, here is where everybody stands", and it
 * turns into a real chart the moment a second week is collected.
 *
 * @param {{label:string,hue:string,points:{i:number,y:number,tip?:string}[]}[]} series
 * @param {string[]} xLabels  one per x index
 */
export function lines(series, {
  width = 900, height = 240, xLabels = [], fmt = (v) => String(v), labels = false,
} = {}) {
  const pts = series.flatMap((s) => s.points);
  if (!pts.length) return emptyChart(width, height);

  const cols = Math.max(1, xLabels.length);
  const max = Math.max(...pts.map((p) => p.y));
  const top = niceCeil(max);

  const padL = 46, padR = 12, padT = 14, padB = 30;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const base = padT + plotH;
  // A single column sits in the middle of the plot; several span its width, so
  // the first and last readings touch the axis ends.
  const xAt = (i) => (cols === 1 ? padL + plotW / 2 : padL + (i / (cols - 1)) * plotW);
  const yAt = (v) => base - (v / top) * plotH;

  const grid = [0, top / 2, top].map((t) => `
    <line class="grid" x1="${padL}" y1="${yAt(t)}" x2="${width - padR}" y2="${yAt(t)}"/>
    <text x="0" y="${yAt(t) + 4}" class="t-mut">${escapeHtml(fmt(Math.round(t)))}</text>`).join('');

  const ticks = xLabels.map((l, i) => `
    <text x="${xAt(i)}" y="${height - 10}" text-anchor="middle" class="t-day">${escapeHtml(l)}</text>`).join('');

  /*
   * One visual channel: colour. Each series has its own hue and everything
   * else about it is identical - a solid line and a round marker.
   *
   * Earlier versions varied marker shape and dash pattern too, because the
   * colour was spoken for by something else and several lines shared it.
   * Once every line can have a colour of its own, a second channel saying
   * the same thing is just noise on the plot.
   */
  const plots = series.map((s) => {
    if (!s.points.length) return '';
    const path = s.points.map((p, k) =>
      `${k ? 'L' : 'M'}${xAt(p.i).toFixed(1)} ${yAt(p.y).toFixed(1)}`).join(' ');
    const line = s.points.length > 1
      ? `<path d="${path}" fill="none" stroke="${s.hue}" stroke-width="2.25"
               stroke-linecap="round" stroke-linejoin="round"/>` : '';
    const dots = s.points.map((p) => `<g>
        <title>${escapeHtml(p.tip || `${s.label}: ${fmt(p.y)}`)}</title>
        <circle cx="${xAt(p.i).toFixed(1)}" cy="${yAt(p.y).toFixed(1)}" r="4.4"
                fill="${s.hue}" stroke="var(--surface)" stroke-width="1.6"/>
      </g>`).join('');
    return line + dots;
  }).join('');

  return svgWrap(width, height,
    `${grid}${ticks}${plots}${labels ? valueLabels() : ''}`,
    'Follower count by week');

  /*
   * The value beside each dot, captioned with the account it belongs to.
   *
   * On a linear axis most dots land near the floor - Facebook has 7,800
   * followers where X has 14 - so a dozen labels want the same twenty
   * pixels. Stacking them vertically and spreading the stack is what a
   * single lane can do, and it ends with every label a long way from its
   * dot, connected by a fan of near-parallel leader lines.
   *
   * So labels are dealt into LANES side by side instead, and only nudged
   * vertically within a lane. Dealt round-robin down the sorted column, so
   * each lane holds every nth label and its members are already n apart in
   * height: most of them then sit at exactly their own dot's height and
   * their leader line is horizontal.
   *
   * The dot never moves. Where a label still had to, the leader elbows out
   * at the dot's height and turns to meet it, and the label's halo punches
   * a gap in any leader passing behind it.
   */
  function valueLabels() {
    // A value over a caption occupies about 23px, measured against what the
    // text actually renders to. Undersize it and each label collides with
    // the one below it in its lane.
    const ROW = 25;
    const out = [];

    for (let i = 0; i < cols; i++) {
      const here = [];
      for (const s of series) {
        const p = s.points.find((q) => q.i === i);
        if (p) here.push({ y: yAt(p.y), text: fmt(p.y), cap: s.caption || '', hue: s.hue });
      }
      if (!here.length) continue;

      /*
       * Lane width comes from the captions themselves rather than a constant:
       * they name an account and a platform, so they are as long as the names
       * happen to be, and a fixed width would either waste the plot or let
       * one lane's text run into the next. ~5.2px per character at the
       * caption's 9px size, checked against what the browser renders.
       */
      const LANE = Math.max(60,
        Math.round(Math.max(0, ...here.map((l) => l.cap.length)) * 5.2) + 16);

      /*
       * Which way the labels go, and how much room they have. The last
       * reading sits on the right edge and turns inward, where the whole
       * plot is free; every other column writes into the gap before the
       * next one, and a column with less than one label's width of gap is
       * left to its tooltips rather than written over its neighbour.
       */
      const last = cols > 1 && i === cols - 1;
      const dir = last ? -1 : 1;
      const dotX = xAt(i);
      const room = dir > 0
        ? (i + 1 < cols ? xAt(i + 1) : width - padR) - dotX - 10
        : dotX - padL - 10;
      const maxLanes = Math.floor(room / LANE);
      if (maxLanes < 1) continue;

      here.sort((a2, b2) => a2.y - b2.y);
      const n = Math.min(maxLanes, Math.max(1, Math.ceil(here.length / 5)));
      const lanes = Array.from({ length: n }, () => []);
      here.forEach((l, k) => lanes[k % n].push(l));

      for (let L = 0; L < n; L++) {
        const lane = lanes[L];

        // Down from the ceiling, then back up from the floor. Two passes,
        // because one pass that shifts a whole lane to fit carries its top
        // label clean off the chart.
        let prev = padT + 4 - ROW;
        for (const l of lane) { l.at = Math.max(l.y, prev + ROW); prev = l.at; }
        let next = base + 4 + ROW;
        for (let k = lane.length - 1; k >= 0; k--) {
          lane[k].at = Math.min(lane[k].at, next - ROW);
          next = lane[k].at;
        }

        const x = dotX + dir * (10 + L * LANE);
        const anchor = last ? 'end' : 'start';
        for (const l of lane) {
          out.push(leader(dotX, l.y, x, l.at, dir, l.hue));
          out.push(`<text x="${x.toFixed(1)}" y="${(l.at + 1).toFixed(1)}"
            text-anchor="${anchor}" class="t-pt"
            style="fill:${l.hue}">${escapeHtml(l.text)}</text>`);
          if (l.cap) {
            out.push(`<text x="${x.toFixed(1)}" y="${(l.at + 11).toFixed(1)}"
              text-anchor="${anchor}" class="t-cap">${escapeHtml(l.cap)}</text>`);
          }
        }
      }
    }
    return out.join('');
  }

  /** Dot to label: out at the dot's height, then a turn to meet it. */
  function leader(dotX, dotY, labelX, labelY, dir, hue) {
    const from = dotX + dir * 6;
    const to = labelX - dir * 3;
    if (Math.abs(to - from) < 7 && Math.abs(labelY - dotY) < 1.5) return '';
    const bend = to - dir * Math.min(8, Math.abs(to - from) / 2);
    return `<path class="t-lead" stroke="${hue}" d="M${from.toFixed(1)} ${dotY.toFixed(1)}`
         + `L${bend.toFixed(1)} ${dotY.toFixed(1)}L${to.toFixed(1)} ${labelY.toFixed(1)}"/>`;
  }
}

/** A round number at or above `n`, so the top gridline reads as a number. */
function niceCeil(n) {
  if (n <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(n));
  return Math.ceil(n / mag) * mag;
}

function emptyChart(w = 300, h = 90) {
  return svgWrap(w, h,
    `<text x="${w / 2}" y="${h / 2 + 4}" text-anchor="middle" class="t-mut">No data</text>`,
    'No data');
}

const trim = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}\u2026` : String(s));
