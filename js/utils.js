/* ============================================================================
   utils.js — tiny, dependency-free helpers. Imported by nearly everything, so
   nothing here may import from another app module.
   ========================================================================== */

export const $  = (sel, root = document) => root.querySelector(sel);

export const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);
export const pad2  = (n) => String(n).padStart(2, '0');

/**
 * Escape for HTML text and attribute contexts. Applied to EVERY value that
 * comes from the sheet, without exception, before it is interpolated.
 */
export function escapeHtml(v) {
  if (v == null) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Lowercase, strip accents, collapse everything else to single hyphens. */
export function slug(s) {
  return String(s ?? '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Same as slug() but with no separators at all — used for header matching. */
export const normKey = (s) =>
  String(s ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');

/** 1234 -> "1.2K", 1250000 -> "1.3M". Mock engagement counts only. */
export function formatCount(n) {
  if (!Number.isFinite(n)) return '0';
  if (n < 1000) return String(n);
  if (n < 1e6) {
    const v = n / 1000;
    return (v < 10 ? v.toFixed(1).replace(/\.0$/, '') : Math.round(v)) + 'K';
  }
  const v = n / 1e6;
  return (v < 10 ? v.toFixed(1).replace(/\.0$/, '') : Math.round(v)) + 'M';
}

export function groupBy(list, keyFn) {
  const out = new Map();
  for (const item of list) {
    const k = keyFn(item);
    const arr = out.get(k);
    if (arr) arr.push(item); else out.set(k, [item]);
  }
  return out;
}

/** Stable sort of map entries by a fixed key order, unknown keys last. */
export function orderedEntries(map, order) {
  const rank = new Map(order.map((k, i) => [k, i]));
  return Array.from(map.entries()).sort((a, b) => {
    const ra = rank.has(a[0]) ? rank.get(a[0]) : 999;
    const rb = rank.has(b[0]) ? rank.get(b[0]) : 999;
    return ra - rb || String(a[0]).localeCompare(String(b[0]));
  });
}

/* --------------------------- deterministic RNG ---------------------------- */

/** FNV-1a. Fast, stable across reloads, good enough to seed a PRNG. */
export function hash32(str) {
  let h = 2166136261 >>> 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * mulberry32 — seeded PRNG. Mock engagement numbers are generated from a seed
 * derived from the post's identity, so they are identical on every render, on
 * every refresh, and in every browser. Never use Math.random() for them: the
 * counts would reshuffle every time a filter changed.
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministically take `n` distinct items from a list. */
export function pickN(rng, list, n) {
  const pool = list.slice();
  const out = [];
  const take = Math.min(n, pool.length);
  for (let i = 0; i < take; i++) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return out;
}

/**
 * Coalesce calls to one per frame, with a timer backstop.
 *
 * requestAnimationFrame stops firing while the window is occluded by another
 * window, and the visibility API still reports "visible" then - so without the
 * timer, scroll-driven work (the day rail's active strip, lazy strip building)
 * would simply stop while the page looked fine.
 */
export const rafThrottle = (fn) => {
  let queued = false, lastArgs = null;
  return (...args) => {
    lastArgs = args;
    if (queued) return;
    queued = true;

    let ran = false;
    let timer = 0;
    const run = () => {
      if (ran) return;
      ran = true;
      clearTimeout(timer);
      queued = false;
      fn(...lastArgs);
    };
    requestAnimationFrame(run);
    timer = setTimeout(run, 120);
  };
};


export const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
