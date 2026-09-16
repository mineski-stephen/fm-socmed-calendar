/* ============================================================================
   mock-linkedin.js — pairs with css/mock-linkedin.css
   Reference: mock_layouts/linkedin.png

   The closest of the six to Facebook — head, caption, media, action bar — so
   it is built the same way. What differs is the chrome, and all of it is
   visible at a glance: a rounded-SQUARE avatar rather than a circle, a Follow
   control in the header, the caption above the media with an inline "more",
   and an action bar whose counts sit beside only the two actions that carry
   them.
   ========================================================================== */

import { GLYPHS } from './config.js';
import { escapeHtml, formatCount } from './utils.js';
import { brandMeta } from './data.js';
import { captionHTML, clickableMediaHTML, glyph, clickable } from './render-post.js';

const GLOBE = `<svg class="mock-li__globe" viewBox="0 0 16 16" aria-hidden="true">
  <circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" stroke-width="1.3"/>
  <ellipse cx="8" cy="8" rx="2.9" ry="6.6" fill="none" stroke="currentColor" stroke-width="1.3"/>
  <path d="M1.7 6h12.6M1.7 10h12.6" stroke="currentColor" stroke-width="1.3"/>
</svg>`;

/* LinkedIn's verified mark is a shield, not the circular tick the other
   platforms use, so it is drawn rather than borrowed from mock-x. */
const VERIFIED = `<svg class="mock-li__check" viewBox="0 0 20 20" aria-label="Verified">
  <path fill="currentColor" d="M10 1.4 3.6 3.9v5.4c0 3.4 2.6 6.6 6.4 7.7 3.8-1.1 6.4-4.3
    6.4-7.7V3.9Z"/>
  <path fill="#fff" d="M8.9 12.6 6 9.8l1.2-1.2 1.7 1.6 3.9-3.9 1.2 1.2z"/>
</svg>`;

const PLUS = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M12 5.5v13M5.5 12h13" fill="none" stroke="currentColor" stroke-width="2.2"
        stroke-linecap="round"/>
</svg>`;

function avatarHTML(post) {
  const b = brandMeta(post.brandKey);
  if (b.avatar) return `<img class="mock-li__av" src="${b.avatar}" alt="" loading="lazy">`;
  const initials = b.label.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return `<span class="mock-li__av mock-li__av--txt" style="background:${b.hue}">` +
         `${escapeHtml(initials)}</span>`;
}

export function mockLinkedInHTML(post, platformKey = 'linkedin') {
  const b = brandMeta(post.brandKey);
  const e = post.engagement[platformKey];

  // Three of LinkedIn's six, drawn from the post's own seed so they never
  // reshuffle between renders.
  const reacts = e.liReacts
    .map((src) => `<img src="${src}" alt="" loading="lazy">`)
    .join('');

  return `<article class="mock-li">
    <div class="mock-li__head">
      <span ${clickable(post, 'mock-li__avlink')}>${avatarHTML(post)}</span>
      <div class="mock-li__who">
        <div class="mock-li__name" ${post.targetUrl
          ? `data-act="open" data-url="${escapeHtml(post.targetUrl)}" role="link" tabindex="0"`
          : 'title="No post link or asset link in the tracker"'}>${escapeHtml(b.label)}${VERIFIED}</div>
        <div class="mock-li__meta">
          <span>${escapeHtml(post.relLabel)}</span>
          <span>·</span>
          ${GLOBE}
        </div>
      </div>
      <span class="mock-li__follow">${PLUS}Follow</span>
      <span class="mock-li__tool" aria-hidden="true">⋯</span>
      <span class="mock-li__tool" aria-hidden="true">✕</span>
    </div>

    <div class="mock-li__cap">${captionHTML(post.caption, { clamp: true, id: post.id })}</div>

    <div class="mock-li__media">${clickableMediaHTML(post, { aspect: 'ph--1x1' })}</div>

    <div class="mock-li__bar">
      <span class="mock-li__act">${glyph(GLYPHS.liLike)}<b>${formatCount(e.likes)}</b></span>
      <span class="mock-li__act">${glyph(GLYPHS.liComment)}<b>${formatCount(e.comments)}</b></span>
      <span class="mock-li__act">${glyph(GLYPHS.liRepost)}<b>${formatCount(e.reposts)}</b></span>
      <span class="mock-li__act">${glyph(GLYPHS.liShare)}</span>
      <span class="mock-li__reacts" title="Reactions">${reacts}</span>
    </div>
  </article>`;
}
