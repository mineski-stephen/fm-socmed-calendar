/* ============================================================================
   theme.js — tri-state theme (light / dark / system).

   The PREFERENCE lives in state; a RESOLVED value ("light" or "dark") is what
   gets written to <html data-theme>. CSS therefore only ever reads one of two
   values and never has to duplicate the token block inside a media query.
   ========================================================================== */

import { state, savePrefs } from './state.js';

const mq = window.matchMedia('(prefers-color-scheme: dark)');
let themingTimer = 0;

export function resolveTheme() {
  if (state.themePref === 'dark') return 'dark';
  if (state.themePref === 'light') return 'light';
  return mq.matches ? 'dark' : 'light';
}

export function applyTheme({ animate = false } = {}) {
  const resolved = resolveTheme();
  state.theme = resolved;
  document.documentElement.setAttribute('data-theme', resolved);

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0e1013' : '#ffffff');

  // Transition colours only on an actual theme change, never during a render.
  if (animate) {
    document.documentElement.classList.add('theming');
    clearTimeout(themingTimer);
    themingTimer = setTimeout(
      () => document.documentElement.classList.remove('theming'), 200);
  }
}

export function setThemePref(pref) {
  if (!['system', 'light', 'dark'].includes(pref)) return;
  state.themePref = pref;
  savePrefs();
  applyTheme({ animate: true });
}

/** Follow the OS while the preference is "system". */
export function watchSystemTheme(onChange) {
  const handler = () => {
    if (state.themePref !== 'system') return;
    applyTheme({ animate: true });
    if (onChange) onChange();
  };
  if (mq.addEventListener) mq.addEventListener('change', handler);
  else mq.addListener(handler);
}
