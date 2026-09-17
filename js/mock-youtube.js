/* ============================================================================
   mock-youtube.js — pairs with css/mock-youtube.css
   Reference: mock_layouts/yt.png

   YouTube Shorts, not a watch page: the tracker's YouTube rows are vertical
   video, and Shorts is the surface they actually land on. Same phone scaffold
   as TikTok (css/mock-phone.css), different chrome — a back/search/kebab bar
   instead of feed tabs, labelled rail actions, and a Subscribe pill beside the
   channel. No status bar, for the same reason TikTok has none.
   ========================================================================== */

import { GLYPHS } from './config.js';
import { escapeHtml, formatCount } from './utils.js';
import { brandMeta } from './data.js';
import { captionHTML, mediaHTML, glyph, clickable, linkAttrs } from './render-post.js';

const BACK = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" stroke-width="2.1"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const SEARCH = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <circle cx="10.5" cy="10.5" r="6.6" fill="none" stroke="currentColor" stroke-width="2"/>
  <path d="m15.4 15.4 4.4 4.4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>`;

const KEBAB = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/>
</svg>`;

const PLUS = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M12 6v12M6 12h12" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round"/>
</svg>`;

const YOU = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <circle cx="12" cy="8" r="4" fill="currentColor"/>
  <path d="M4 21a8 8 0 0 1 16 0Z" fill="currentColor"/>
</svg>`;

function avatarHTML(post) {
  const b = brandMeta(post.brandKey);
  return b.avatar
    ? `<img class="phone__av phone__av--sm" src="${b.avatar}" alt="" loading="lazy">`
    : `<span class="phone__av phone__av--sm" style="background:${b.hue}"></span>`;
}

/**
 * One rail entry. Shorts labels two of its actions with a word rather than a
 * number — Save and Share have no count to show — so the caption below the
 * icon takes either.
 */
const railAct = (src, below, cls = '') =>
  `<span class="phone__act ${cls}">${glyph(src)}<b>${escapeHtml(below)}</b></span>`;

const navItem = (icon, label, cls = '') =>
  `<span class="phone__navitem ${cls}">${icon}<span>${escapeHtml(label)}</span></span>`;

export function mockYouTubeHTML(post, platformKey = 'youtube') {
  const b = brandMeta(post.brandKey);
  const e = post.engagement[platformKey];

  return `<article class="mock-yt phone">
    <div class="phone__screen">
      <div class="phone__media" ${clickable(post, 'phone__mediahit', platformKey)}>
        ${mediaHTML(post, { aspect: 'ph--fill' })}
      </div>

      <div class="phone__shade phone__shade--top"></div>
      <div class="phone__shade phone__shade--bottom"></div>

      <div class="mock-yt__top">
        ${BACK}<span class="spacer"></span>${SEARCH}${KEBAB}
      </div>

      <div class="phone__rail">
        ${railAct(GLYPHS.ytLike, formatCount(e.likes), 'mock-yt__act--like')}
        ${railAct(GLYPHS.ytComment, formatCount(e.comments))}
        ${railAct(GLYPHS.ytSave, 'Save')}
        ${railAct(GLYPHS.ytShare, 'Share')}
        ${railAct(GLYPHS.ytRemix, formatCount(e.reposts))}
      </div>

      <div class="phone__meta">
        <div class="mock-yt__channel">
          ${avatarHTML(post)}
          <span class="phone__handle" ${linkAttrs(post, platformKey)}>@${escapeHtml(b.handle)}</span>
          <span class="mock-yt__sub">Subscribe</span>
        </div>
        <div class="phone__cap">${captionHTML(post.caption, { clamp: true, id: post.id, sm: true })}</div>
      </div>

      <div class="phone__nav">
        ${navItem(glyph(GLYPHS.ytHome), 'Home')}
        ${navItem(glyph(GLYPHS.ytShorts), 'Shorts')}
        <span class="phone__navitem mock-yt__plus">${PLUS}</span>
        ${navItem(glyph(GLYPHS.ytSubs), 'Subscriptions')}
        ${navItem(YOU, 'You')}
      </div>
    </div>
  </article>`;
}
