/* ============================================================================
   lightbox.js — the blacked-out overlay used for two things:

     * spotlight, opened from one post, and
     * the day carousel, opened from a strip's expand button.

   They are the same component with a different number of entries, so there is
   one implementation rather than two that drift apart. Entries are the same
   { post, platformKey } pairs the day view renders from.

   Two rules shape the whole file:

     1. Every post is laid out SIDE BY SIDE in one track, built once when the
        overlay opens. Moving on slides the track; it does not swap the markup
        under you. That is what makes it read as a carousel rather than as a
        sequence of separate pages, and it means the next post is already drawn
        before you ask for it.

     2. A post always fits the window. If it is taller than the space it has,
        the whole thing is scaled down until it fits, because an overlay opened
        to examine a post that then makes you scroll to see the bottom of it is
        not doing its job.
   ========================================================================== */

import { escapeHtml, clamp, prefersReducedMotion } from './utils.js';
import { brandMeta } from './data.js';
import { postHeaderHTML, noteHTML, simpleCardHTML } from './render-post.js';
import { mockFor } from './mocks.js';

let box = null;          // the overlay element, while open
let viewport = null;     // the window the track slides behind
let track = null;
let entries = [];
let index = 0;
let lastFocus = null;
let detach = null;

/**
 * One post, drawn at its own size.
 *
 * The two branches are deliberately not symmetrical. A mock is only the
 * platform body, so it needs the header and the internal note wrapped around
 * it; simpleCardHTML already builds both itself. Wrapping them around a simple
 * card as well is what used to print the header and the note twice here.
 */
function slideHTML(entry) {
  const { post, platformKey } = entry;
  const mock = mockFor(platformKey);
  const b = brandMeta(post.brandKey);

  const frame = mock
    ? `${postHeaderHTML(post, platformKey)}
       <div class="lb__mock">${mock(post, platformKey)}</div>
       ${noteHTML(post)}`
    : `<div class="lb__mock lb__mock--simple">
         ${simpleCardHTML(post, platformKey, { showMedia: true })}</div>`;

  // lb__fitbox holds the SCALED height so the caption sits right under the
  // post; lb__fit carries the scale itself. A transform alone would leave the
  // element's layout box at full size and strand the caption below the fold.
  return `<article class="lb__slide">
      <div class="lb__fitbox">
        <div class="lb__fit"><div class="lb__frame">${frame}</div></div>
      </div>
      <p class="lb__caption">${escapeHtml(b.label)} · ${escapeHtml(post.dateLabel)}
        · ${escapeHtml(post.timeLabel)}</p>
    </article>`;
}

/* --------------------------------- fitting -------------------------------- */

/*
 * Scale each post down until it fits the height it has.
 *
 * Measured rather than guessed: a Facebook static post, a 9:16 reel and a
 * simple card for a platform with no mock are wildly different heights, and a
 * single hardcoded scale would either crop the tall ones or shrink the short
 * ones for no reason. Each slide gets its own factor, and anything that
 * already fits is left at 1 rather than being scaled up into a blurry poster.
 */
function fitSlide(slide) {
  const fitbox = slide.querySelector('.lb__fitbox');
  const fit = slide.querySelector('.lb__fit');
  const caption = slide.querySelector('.lb__caption');
  if (!fitbox || !fit) return;

  // Measure unscaled. getBoundingClientRect reports the TRANSFORMED size, so
  // the old scale has to come off before the natural height can be read.
  fit.style.transform = '';
  fitbox.style.height = '';
  const natural = fit.getBoundingClientRect().height;
  if (!natural) return;

  const avail = slide.clientHeight - (caption ? caption.offsetHeight + 12 : 0);
  if (avail <= 0) return;

  const k = Math.min(1, avail / natural);
  if (k >= 0.999) return;               // already fits; leave it alone

  fit.style.transform = `scale(${k})`;
  fitbox.style.height = `${Math.floor(natural * k)}px`;
}

function fitAll() {
  if (!track) return;
  for (const slide of track.children) fitSlide(slide);
}

/* --------------------------------- moving --------------------------------- */

function sync() {
  if (!box) return;
  const many = entries.length > 1;
  track.style.setProperty('--i', index);
  box.querySelector('[data-lb-count]').textContent = many
    ? `${index + 1} / ${entries.length}` : '';
  box.querySelector('[data-lb-prev]').disabled = index === 0;
  box.querySelector('[data-lb-next]').disabled = index === entries.length - 1;
  box.querySelectorAll('[data-lb-nav]').forEach((el) => { el.hidden = !many; });

  // Only the post on screen is announced; the rest are inert to a screen
  // reader and to Tab, or the overlay would have nine posts' worth of
  // focusable controls in it at once.
  Array.from(track.children).forEach((slide, i) => {
    slide.classList.toggle('is-current', i === index);
    slide.inert = i !== index;
    slide.setAttribute('aria-hidden', String(i !== index));
  });
}

/** Move by `delta` posts. Clamped, so the ends simply stop. */
export function step(delta) {
  if (!box || entries.length < 2) return;
  const next = clamp(index + delta, 0, entries.length - 1);
  if (next === index) return;
  index = next;
  sync();
  budget = 0;
  cooldownUntil = performance.now() + 340;
}

export function isOpen() { return !!box; }

/**
 * Redraw the current slide in place.
 *
 * This is what makes a control INSIDE the post work here — "See more" on a
 * long caption flips a flag and asks for a re-render, but that re-render only
 * rebuilds the view region behind the overlay, so without this the overlay
 * kept showing the clamped caption and the button looked dead. The post is a
 * different height afterwards, so it is re-fitted.
 */
export function rerender() {
  if (!box || !track) return;
  const slide = track.children[index];
  if (!slide) return;
  slide.outerHTML = slideHTML(entries[index]);
  sync();
  fitSlide(track.children[index]);
}

export function close() {
  if (!box) return;
  if (detach) { detach(); detach = null; }
  box.remove();
  box = null;
  viewport = null;
  track = null;
  entries = [];
  document.documentElement.classList.remove('lb-open');
  // Put focus back where it came from, or the page loses its place entirely.
  if (lastFocus && lastFocus.isConnected) lastFocus.focus({ preventScroll: true });
  lastFocus = null;
}

/* ---------------------------------------------------------------------------
   The wheel moves between posts.

   Nothing scrolls inside the overlay any more - every post is sized to fit -
   so the wheel has one job. It still has to be earned: trackpad momentum keeps
   delivering events long after the fingers have left, and acting on the first
   one would turn a single flick into five posts. So a move costs WHEEL_BUDGET
   pixels of travel, and a short cooldown afterwards swallows the tail.
   ------------------------------------------------------------------------- */

const WHEEL_BUDGET = 120;
let budget = 0;             // signed, so a nudge the other way cancels it
let cooldownUntil = 0;

function onWheel(e) {
  e.preventDefault();
  if (entries.length < 2) return;
  if (performance.now() < cooldownUntil) return;

  // A horizontal trackpad swipe means the same thing here as a vertical one.
  const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  if (!d) return;
  if ((d > 0 && budget < 0) || (d < 0 && budget > 0)) budget = 0;
  budget += d;

  if (budget > WHEEL_BUDGET) step(1);
  else if (budget < -WHEEL_BUDGET) step(-1);
}

/**
 * @param {Array}  list   [{ post, platformKey }]
 * @param {number} start  which entry to open on
 * @param {string} label  heading, e.g. the date for a day carousel
 */
export function open(list, start = 0, label = '') {
  if (!list || !list.length) return;
  close();

  entries = list;
  index = clamp(start, 0, entries.length - 1);
  lastFocus = document.activeElement;
  budget = 0;
  cooldownUntil = 0;

  box = document.createElement('div');
  box.className = 'lb';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', label || 'Post detail');

  // The arrows sit immediately beside the post rather than out at the edges of
  // the screen. At this width the edges are a long way from what is being read,
  // and a control that far from the subject reads as decoration.
  box.innerHTML = `
    <div class="lb__bar">
      <span class="lb__title">${escapeHtml(label || 'Post')}</span>
      <span class="lb__count" data-lb-count></span>
      <span class="lb__hint" data-lb-nav>Scroll, or click a post beside it, to move</span>
      <button class="lb__x" data-act="lightbox-close" aria-label="Close (Esc)">✕</button>
    </div>
    <div class="lb__stage${entries.length > 1 ? '' : ' lb__stage--solo'}" data-lb-stage>
      <button class="lb__nav lb__nav--prev" data-lb-nav data-lb-prev
              data-act="lightbox-prev" aria-label="Previous post">‹</button>
      <div class="lb__viewport" data-lb-viewport>
        <div class="lb__track" data-lb-track>${entries.map(slideHTML).join('')}</div>
      </div>
      <button class="lb__nav lb__nav--next" data-lb-nav data-lb-next
              data-act="lightbox-next" aria-label="Next post">›</button>
    </div>`;

  document.body.appendChild(box);
  document.documentElement.classList.add('lb-open');
  viewport = box.querySelector('[data-lb-viewport]');
  track = box.querySelector('[data-lb-track]');
  if (prefersReducedMotion()) track.classList.add('is-instant');

  sync();
  fitAll();

  /*
   * What a click in the overlay means.
   *
   * Hit-tested against the CARDS, not against their columns. A column is the
   * full height of the stage, so testing those made almost the whole overlay
   * "on a post" and left nowhere to click to dismiss it; a card is the thing
   * you can actually see, so it is the thing the click should be measured
   * against.
   *
   *   on another post   -> bring it over
   *   on this post      -> nothing; its own controls handle themselves
   *   anywhere else     -> close
   *
   * Worked out from WHERE the pointer landed rather than from what it hit: a
   * post that is not the current one is inert, so the event never reaches the
   * card itself and arrives at an ancestor instead. Geometry is the only thing
   * that can tell those clicks apart.
   */
  const cardUnder = (x, y) => Array.from(track.children).findIndex((slide) => {
    const card = slide.querySelector('.lb__frame');
    if (!card) return false;
    const b = card.getBoundingClientRect();
    return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
  });

  const onDown = (e) => {
    // A button owns its own click - the arrows, the close, anything inside the
    // post being read.
    if (e.target.closest?.('[data-act]')) return;

    const hit = cardUnder(e.clientX, e.clientY);
    if (hit === index) return;            // the post being read; leave it alone
    if (hit >= 0) { step(hit - index); return; }
    close();                              // empty space: dismiss
  };
  box.addEventListener('pointerdown', onDown);

  // Not passive: the wheel drives the carousel here, it does not scroll.
  viewport.addEventListener('wheel', onWheel, { passive: false });

  /*
   * Re-fit whenever the space changes. The observer covers a window resize and
   * a pane being dragged, and the timeout covers the case it cannot: the mocks
   * are full of text, and a web font landing after the first measurement makes
   * every post a few pixels taller than it was when we scaled it.
   */
  let ro = null;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(fitAll);
    ro.observe(viewport);
  }
  const settle = setTimeout(fitAll, 220);
  const onFonts = () => fitAll();
  document.fonts?.ready?.then(onFonts);

  detach = () => {
    box.removeEventListener('pointerdown', onDown);
    viewport.removeEventListener('wheel', onWheel);
    if (ro) ro.disconnect();
    clearTimeout(settle);
  };

  box.querySelector('.lb__x').focus({ preventScroll: true });
}

/** Esc and the arrow keys, bound once at boot. */
export function handleKey(e) {
  if (!box) return false;
  if (e.key === 'Escape') { e.preventDefault(); close(); return true; }
  if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); return true; }
  if (e.key === 'ArrowRight') { e.preventDefault(); step(1); return true; }
  return false;
}
