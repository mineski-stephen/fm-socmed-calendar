/* ============================================================================
   mock-facebook.js — pairs with css/mock-facebook.css
   Reference: mock_layouts/facebook.png
   ========================================================================== */

import { GLYPHS } from './config.js';
import { escapeHtml, formatCount } from './utils.js';
import { brandMeta } from './data.js';
import { captionHTML, clickableMediaHTML, glyph, clickable } from './render-post.js';

const GLOBE = `<svg class="mock-fb__globe" viewBox="0 0 16 16" aria-hidden="true">
  <circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" stroke-width="1.3"/>
  <ellipse cx="8" cy="8" rx="2.9" ry="6.6" fill="none" stroke="currentColor" stroke-width="1.3"/>
  <path d="M1.7 6h12.6M1.7 10h12.6" stroke="currentColor" stroke-width="1.3"/>
</svg>`;

function avatarHTML(post) {
  const b = brandMeta(post.brandKey);
  if (b.avatar) {
    return `<img class="mock-fb__av" src="${b.avatar}" alt="" loading="lazy">`;
  }
  const initials = b.label.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return `<span class="mock-fb__av note__av" style="background:${b.hue};color:#fff">` +
         `${escapeHtml(initials)}</span>`;
}

export function mockFacebookHTML(post, platformKey = 'facebook') {
  const b = brandMeta(post.brandKey);
  const e = post.engagement[platformKey];

  const reacts = e.reacts
    .map((src) => `<img src="${src}" alt="" loading="lazy">`)
    .join('');

  return `<article class="mock-fb">
    <div class="mock-fb__head">
      <span ${clickable(post, 'mock-fb__avlink')}>${avatarHTML(post)}</span>
      <div class="mock-fb__who">
        <div class="mock-fb__name" ${post.targetUrl
          ? `data-act="open" data-url="${escapeHtml(post.targetUrl)}" role="link" tabindex="0"`
          : 'title="No post link or asset link in the tracker"'}>${escapeHtml(b.label)}</div>
        <div class="mock-fb__meta">
          <span>${escapeHtml(post.shortDate)}</span>
          <span>\u00b7</span>
          <span>${escapeHtml(post.timeLabel)}</span>
          <span>\u00b7</span>
          ${GLOBE}
        </div>
      </div>
      <div class="mock-fb__tools" aria-hidden="true">
        <span class="mock-fb__tool">\u22ef</span>
        <span class="mock-fb__tool">\u2715</span>
      </div>
    </div>

    <div class="mock-fb__cap">${captionHTML(post.caption, { clamp: true, id: post.id })}</div>

    <div class="mock-fb__media">${clickableMediaHTML(post, { aspect: 'ph--1x1' })}</div>

    <div class="mock-fb__bar">
      <span class="mock-fb__btn">${glyph(GLYPHS.fbLike)}<span class="mock-fb__label">Like</span><b>${formatCount(e.likes)}</b></span>
      <span class="mock-fb__btn">${glyph(GLYPHS.fbComment)}<span class="mock-fb__label">Comment</span><b>${formatCount(e.comments)}</b></span>
      <span class="mock-fb__btn">${glyph(GLYPHS.fbShare)}<span class="mock-fb__label">Share</span><b>${formatCount(e.shares)}</b></span>
      <span class="mock-fb__reacts" title="Reactions">${reacts}</span>
    </div>
  </article>`;
}
