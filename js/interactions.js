/* ============================================================================
   interactions.js — one shared drag primitive, the day rail, the IG carousel.

   Design note on the rail: the horizontal scrolling itself is NATIVE
   (overflow-x + scroll-snap). Pointer drag is only an input adapter that
   writes scrollLeft. Hand-rolling momentum physics would mean re-implementing
   trackpad inertia, touch fling and keyboard scrolling — all of which the
   browser already does better.
   ========================================================================== */

import { clamp, rafThrottle, prefersReducedMotion } from './utils.js';

const DRAG_THRESHOLD = 6;   // px before a press becomes a drag

/**
 * Eased scroll to an exact x, cancellable at any time.
 *
 * CSS scroll-snap on its own lands hard: the moment the pointer is released it
 * jumps the remaining distance. Driving the settle ourselves with an ease-out
 * curve makes the strips glide into place instead. Returns a cancel function so
 * a new gesture can take over mid-flight.
 */
function glideTo(el, target, { duration = 420, onStep } = {}) {
  const from = el.scrollLeft;
  const dist = target - from;

  if (!dist || prefersReducedMotion()) {
    el.scrollLeft = target;
    if (onStep) onStep();
    return () => {};
  }

  const started = performance.now();
  let raf = 0;
  let cancelled = false;

  // easeOutCubic - quick to start, soft to finish, no overshoot
  const ease = (t) => 1 - Math.pow(1 - t, 3);

  const step = (now) => {
    if (cancelled) return;
    const t = Math.min(1, (now - started) / duration);
    el.scrollLeft = from + dist * ease(t);
    if (onStep) onStep();
    if (t < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);

  // If frames never arrive - an occluded window starves rAF - the rail would
  // be left stranded part-way. Land it on the target instead of animating.
  const bail = setTimeout(() => {
    if (!cancelled) { cancelled = true; el.scrollLeft = target; if (onStep) onStep(); }
  }, duration + 260);

  return () => { cancelled = true; cancelAnimationFrame(raf); clearTimeout(bail); };
}

/**
 * Shared horizontal drag. Used by the day rail and the Instagram carousel, so
 * there is exactly one gesture implementation in the codebase.
 *
 * Only mouse pointers are intercepted: touch already scrolls natively, and
 * hijacking it would break momentum and rubber-banding.
 */
export function attachDrag(el, { onStart, onMove, onEnd, ignore } = {}) {
  let active = false;      // pointer is down
  let engaged = false;     // movement has passed the threshold horizontally
  let startX = 0, startY = 0, startT = 0;
  let samples = [];
  let moved = 0;

  const down = (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    if (ignore && e.target.closest(ignore)) return;
    active = true; engaged = false; moved = 0;
    startX = e.clientX; startY = e.clientY; startT = performance.now();
    samples = [{ x: e.clientX, t: startT }];
    if (onStart) onStart();
  };

  const move = (e) => {
    if (!active) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    moved = Math.max(moved, Math.abs(dx));

    if (!engaged) {
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      // A vertical-dominant gesture belongs to whatever is scrolling inside the
      // strip. Abandon for the whole gesture rather than fighting it.
      if (Math.abs(dy) > Math.abs(dx)) { active = false; return; }
      engaged = true;
      el.setPointerCapture?.(e.pointerId);
      el.classList.add('is-dragging');
    }

    samples.push({ x: e.clientX, t: performance.now() });
    if (samples.length > 4) samples.shift();
    if (onMove) onMove(dx, e);
    e.preventDefault();
  };

  const up = (e) => {
    if (!active) return;
    active = false;
    if (!engaged) return;
    engaged = false;
    el.releasePointerCapture?.(e.pointerId);
    el.classList.remove('is-dragging');

    // velocity in px/ms from the last few samples
    let v = 0;
    if (samples.length >= 2) {
      const a = samples[0], b = samples[samples.length - 1];
      const dt = Math.max(1, b.t - a.t);
      v = (b.x - a.x) / dt;
    }
    if (onEnd) onEnd(v, moved);

    // Swallow the click that a drag would otherwise trigger on a card.
    if (moved > DRAG_THRESHOLD) {
      const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      document.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => document.removeEventListener('click', swallow, { capture: true }), 0);
    }
  };

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);

  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
  };
}

/* -------------------------------- day rail --------------------------------- */

export function initDayRail(rail, { onDayChange } = {}) {
  if (!rail) return null;

  const strips = () => Array.from(rail.querySelectorAll('.strip'));

  /** Measured, never hardcoded — the strip width is responsive. */
  const stride = () => {
    const s = strips();
    if (s.length < 2) return rail.clientWidth || 1;
    return s[1].offsetLeft - s[0].offsetLeft;
  };

  const indexOfKey = (key) => strips().findIndex((s) => s.dataset.key === key);

  let cancelGlide = () => {};

  const maxScroll = () => Math.max(0, rail.scrollWidth - rail.clientWidth);

  /** Animate to an exact scroll position, replacing any glide in flight. */
  const snapTo = (left, { duration = 420 } = {}) => {
    cancelGlide();
    // The scrollbar is driven from the glide itself rather than from the
    // rail's scroll event, so the thumb tracks movement we caused without
    // waiting for the event to come back round to us.
    cancelGlide = glideTo(rail, clamp(left, 0, maxScroll()), { duration, onStep: syncBar });
    syncBar();
  };

  /**
   * Scroll offset that centres strip `idx` in the rail.
   *
   * Worked out by measurement - how far the strip's centre currently sits from
   * the rail's centre - rather than from an assumed padding, so it stays right
   * whatever the gutter works out to at this width. The rail carries half a
   * screen of padding either side (set in sizeRail), which is what lets the
   * first and last days reach the middle too.
   */
  function offsetOf(idx) {
    const list = strips();
    if (!list.length) return 0;
    const railBox = rail.getBoundingClientRect();
    const b = list[idx].getBoundingClientRect();
    const delta = (b.left + b.width / 2) - (railBox.left + railBox.width / 2);
    return clamp(rail.scrollLeft + delta, 0, maxScroll());
  }

  function goToIndex(i, { smooth = true, focus = false, duration: ms } = {}) {
    const list = strips();
    if (!list.length) return;
    const idx = clamp(i, 0, list.length - 1);

    const animate = smooth && !prefersReducedMotion();
    const duration = animate ? (ms ?? 460) : 0;
    lockUntil = performance.now() + duration + 80;

    snapTo(offsetOf(idx), { duration });
    if (focus) { list[idx].setAttribute('tabindex', '-1'); list[idx].focus({ preventScroll: true }); }
    setActive(idx);
  }

  function goToKey(key, opts) {
    const i = indexOfKey(key);
    if (i >= 0) goToIndex(i, opts);
  }

  /** Whichever day currently sits nearest the middle of the rail. */
  function currentIndex() {
    const list = strips();
    if (!list.length) return 0;
    const centre = rail.getBoundingClientRect().left + rail.getBoundingClientRect().width / 2;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < list.length; i++) {
      const b = list[i].getBoundingClientRect();
      const d = Math.abs((b.left + b.width / 2) - centre);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  }

  function setActive(i) {
    const list = strips();
    list.forEach((s, n) => {
      s.classList.toggle('strip--active', n === i);
      s.setAttribute('aria-selected', String(n === i));
    });
    const key = list[i]?.dataset.key;
    if (key && onDayChange) onDayChange(key);
  }

  /* ----- drag ----- */

  let lockUntil = 0;   // ignore scroll-derived updates while a programmatic
                       // scroll is still animating

  let startScroll = 0;
  attachDrag(rail, {
    ignore: 'a, button, .igcar',
    onStart: () => { lockUntil = 0; cancelGlide(); startScroll = rail.scrollLeft; },
    onMove: (dx) => { rail.scrollLeft = startScroll - dx; syncBar(); },
    onEnd: (v) => {
      // Carry the throw a little past where it was released, then glide the
      // rest of the way so a day ends up centred rather than half-shown.
      const steps = Math.round((-v * 170) / stride());
      const target = clamp(currentIndex() + steps, 0, strips().length - 1);
      const travel = Math.abs(offsetOf(target) - rail.scrollLeft);
      goToIndex(target, { duration: clamp(260 + travel * 0.55, 260, 620) });
    },
  });

  /*
   * No wheel handler on purpose.
   *
   * The rail used to translate a vertical wheel into horizontal movement,
   * which meant scrolling down a long day fought with moving between days.
   * The wheel now does only what the browser does with it - scroll the post
   * list under the cursor, or the page - and moving across days is the job of
   * the scrollbar above the rail, the strips themselves, or the keyboard.
   * A genuine horizontal trackpad gesture still scrolls the rail natively,
   * because the rail is a real overflow-x scroller.
   */

  let snapTimer = 0;
  const queueSnap = () => {
    clearTimeout(snapTimer);
    snapTimer = setTimeout(() => goToIndex(currentIndex(), { duration: 260 }), 140);
  };

  /* ----- keyboard ----- */

  rail.addEventListener('keydown', (e) => {
    const i = currentIndex();
    const map = {
      ArrowLeft: i - 1, ArrowRight: i + 1,
      PageUp: i - 7, PageDown: i + 7,
      Home: 0, End: strips().length - 1,
    };
    if (!(e.key in map)) return;
    e.preventDefault();
    goToIndex(map[e.key], { focus: true });
  });

  /* ----- scroll -> active strip label, class swaps only, never a render ----- */

  /* ------------------------------- day ruler ------------------------------- */

  /*
   * One slot per day of the month, with a box that tracks whichever day the
   * rail is centred on. It replaces a proportional scrollbar because at this
   * scale the days themselves are the useful landmarks: you scrub to "the
   * 18th", not to "62% of the way along".
   */
  const ruler = document.querySelector('[data-dayruler]');
  const rulerBox = document.querySelector('[data-rulerbox]');
  const rulerDays = ruler ? Array.from(ruler.querySelectorAll('.dayruler__day')) : [];
  let rulerDragging = false;
  let lastMarked = -1;

  function syncBar() {
    if (!ruler || !rulerBox || !rulerDays.length) return;
    const i = clamp(currentIndex(), 0, rulerDays.length - 1);
    if (i === lastMarked) return;              // nothing moved; skip the writes
    lastMarked = i;

    const day = rulerDays[i];
    rulerBox.style.width = `${day.offsetWidth}px`;
    rulerBox.style.transform = `translateX(${day.offsetLeft}px)`;

    for (let n = 0; n < rulerDays.length; n++) {
      rulerDays[n].classList.toggle('is-active', n === i);
      rulerDays[n].setAttribute('aria-current', n === i ? 'true' : 'false');
    }
    ruler.setAttribute('aria-label',
      `Day ${rulerDays[i].querySelector('.dayruler__n').textContent} of the month`);
  }

  /** Which day slot a pointer x falls on. */
  function indexFromRuler(clientX) {
    const box = ruler.getBoundingClientRect();
    const t = clamp((clientX - box.left) / Math.max(1, box.width), 0, 0.999999);
    return clamp(Math.floor(t * rulerDays.length), 0, rulerDays.length - 1);
  }

  if (ruler && rulerDays.length) {
    let pointer = null;
    let engaged = false;
    let startX = 0;

    ruler.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pointer = e.pointerId;
      engaged = false;
      startX = e.clientX;
      lockUntil = 0;
      cancelGlide();
    });

    ruler.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pointer) return;

      // A press that has not moved is still a click on a day button, so the
      // scrub only takes over once the pointer has actually travelled.
      if (!engaged) {
        if (Math.abs(e.clientX - startX) < 4) return;
        engaged = true;
        // Capture can throw if the pointer is already gone; losing it only
        // costs us moves outside the ruler, so it must not abort the gesture.
        try { ruler.setPointerCapture(e.pointerId); } catch { /* not fatal */ }
        ruler.classList.add('is-dragging');
      }
      e.preventDefault();
      // Scrubbing moves the rail with no animation, so it keeps up with the
      // pointer instead of chasing it.
      rail.scrollLeft = offsetOf(indexFromRuler(e.clientX));
      syncBar();
      // Keeps the highlighted strip and the date readout in step with the box.
      setActive(currentIndex());
    });

    const endRulerDrag = (e) => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      if (!engaged) return;               // a plain click; let it through
      engaged = false;
      try { ruler.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
      ruler.classList.remove('is-dragging');

      // Swallow the click the drag would otherwise fire on whichever day the
      // pointer happened to finish over.
      const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      document.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => document.removeEventListener('click', swallow, { capture: true }), 0);
    };
    ruler.addEventListener('pointerup', endRulerDrag);
    ruler.addEventListener('pointercancel', endRulerDrag);

    // Each day is a real button, so Tab reaches it and Enter or Space lands on
    // that day through the delegated click handler. These add the sweep.
    ruler.addEventListener('keydown', (e) => {
      const map = { ArrowLeft: -1, ArrowRight: 1, PageUp: -7, PageDown: 7 };
      const last = rulerDays.length - 1;
      let next = null;
      if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = last;
      else if (e.key in map) next = clamp(currentIndex() + map[e.key], 0, last);
      if (next === null) return;
      e.preventDefault();
      goToIndex(next);
      rulerDays[next].focus({ preventScroll: true });
    });
  }

  rail.addEventListener('scroll', rafThrottle(() => {
    syncBar();
    if (performance.now() < lockUntil) return;
    setActive(currentIndex());
    // Touch flings and horizontal trackpad swipes scroll natively; with CSS
    // snap off, this is what eases them onto a strip edge once they stop.
    // Skipped while either the strips or the bar are being dragged, so the
    // settle never fires under the user's own pointer.
    if (!rail.classList.contains('is-dragging') && !rulerDragging) queueSnap();
  }), { passive: true });

  setActive(currentIndex());
  syncBar();

  // Same reasoning as the hydration observer: the thumb is sized from the
  // rail's width, so it has to be recomputed whenever that width changes -
  // not only when the window itself is resized.
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(syncBar).observe(rail);
  }
  setTimeout(syncBar, 200);

  return { goToKey, goToIndex, currentIndex, strips, syncBar };
}

/* ------------------------------ IG carousel -------------------------------- */

/**
 * Moving between slides writes a CSS custom property on the element and
 * updates state — it never re-renders the card. That keeps the transition
 * smooth and means a later re-render restores the slide the user was on.
 */
export function setCarousel(el, index, store) {
  const n = +el.dataset.n || 1;
  const i = clamp(index, 0, n - 1);

  el.style.setProperty('--i', i);
  const chip = el.querySelector('[data-carousel-chip]');
  if (chip) chip.textContent = `${i + 1}/${n}`;

  const prev = el.querySelector('.igcar__nav--prev');
  const next = el.querySelector('.igcar__nav--next');
  if (prev) prev.disabled = i === 0;
  if (next) next.disabled = i === n - 1;

  const dots = el.parentElement?.querySelectorAll('.igcar__dot') || [];
  dots.forEach((d, k) => d.setAttribute('aria-current', String(k === i)));

  if (store) store.set(el.dataset.carousel, i);
  return i;
}

/** Swipe support for every carousel currently in the DOM. */
export function bindCarousels(root, store) {
  root.querySelectorAll('.igcar').forEach((el) => {
    if (el.dataset.bound === '1') return;
    el.dataset.bound = '1';

    let startIndex = 0;
    attachDrag(el, {
      ignore: 'button',
      onStart: () => { startIndex = +getComputedStyle(el).getPropertyValue('--i') || 0; },
      onMove: (dx) => {
        const frac = dx / Math.max(1, el.clientWidth);
        el.style.setProperty('--i', clamp(startIndex - frac, -0.25, (+el.dataset.n || 1) - 0.75));
      },
      onEnd: (v, moved) => {
        const frac = moved / Math.max(1, el.clientWidth);
        const dir = v < 0 ? 1 : -1;
        const step = (frac > 0.22 || Math.abs(v) > 0.45) ? dir : 0;
        setCarousel(el, startIndex + step, store);
      },
    });
  });
}
