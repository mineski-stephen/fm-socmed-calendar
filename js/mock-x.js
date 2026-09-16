/* ============================================================================
   mock-x.js — pairs with css/mock-x.css
   Reference: mock_layouts/x.jpg
   ========================================================================== */

import { GLYPHS, PLATFORM_META } from './config.js';
import { escapeHtml, formatCount } from './utils.js';
import { brandMeta } from './data.js';
import { captionHTML, clickableMediaHTML, glyph } from './render-post.js';

const VERIFIED = `<svg viewBox="0 0 20 20" width="14" height="14" aria-label="Verified">
  <path fill="#1d9bf0" d="M10 .8l2.2 2.1 3-.3.6 3 2.6 1.5-1.3 2.7 1.3 2.7-2.6 1.5-.6 3-3-.3L10 19.2
    l-2.2-2.1-3 .3-.6-3L1.6 13l1.3-2.7L1.6 7.6l2.6-1.5.6-3 3 .3z"/>
  <path fill="#fff" d="M8.7 12.9L5.9 10l1.2-1.2 1.6 1.6 4-4L13.9 7.6z"/>
</svg>`;

function avatarHTML(post) {
  const b = brandMeta(post.brandKey);
  if (b.avatar) return `<img class="mock-x__av" src="${b.avatar}" alt="" loading="lazy">`;
  const initials = b.label.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return `<span class="mock-x__av note__av" style="background:${b.hue};color:#fff">` +
         `${escapeHtml(initials)}</span>`;
}

export function mockXHTML(post, platformKey = 'x') {
  const b = brandMeta(post.brandKey);
  const e = post.engagement[platformKey];

  const nameAttrs = post.targetUrl
    ? `data-act="open" data-url="${escapeHtml(post.targetUrl)}" role="link" tabindex="0"`
    : 'title="No post link or asset link in the tracker"';

  return `<article class="mock-x">
    ${avatarHTML(post)}
    <div class="mock-x__col">
      <div class="mock-x__head">
        <span class="mock-x__name" ${nameAttrs}>${escapeHtml(b.label)}${VERIFIED}</span>
        <span class="mock-x__handle">@${escapeHtml(b.handle)}</span>
        <span class="mock-x__dot">\u00b7</span>
        <span class="mock-x__date">${escapeHtml(post.slashDate)}</span>
        <img class="mock-x__logo" src="${PLATFORM_META.x.icon}" alt="" loading="lazy">
      </div>

      <div class="mock-x__cap">${captionHTML(post.caption, { clamp: true, id: post.id })}</div>

      <div class="mock-x__media">${clickableMediaHTML(post, { aspect: 'ph--16x9' })}</div>

      <div class="mock-x__bar">
        <span class="mock-x__act">${glyph(GLYPHS.xComment)}${formatCount(e.comments)}</span>
        <span class="mock-x__act">${glyph(GLYPHS.xRepost)}${formatCount(e.reposts)}</span>
        <span class="mock-x__act">${glyph(GLYPHS.xLike)}${formatCount(e.likes)}</span>
        <span class="mock-x__act">${glyph(GLYPHS.xViews)}${formatCount(e.views)}</span>
        <span class="mock-x__act mock-x__act--last">
          ${glyph(GLYPHS.xBookmark)}${glyph(GLYPHS.xShare)}
        </span>
      </div>
    </div>
  </article>`;
}
