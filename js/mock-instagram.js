/* ============================================================================
   mock-instagram.js — pairs with css/mock-instagram.css
   Reference: mock_layouts/instagram.jpg
   ========================================================================== */

import { GLYPHS, CAROUSEL_DEFAULT } from './config.js';
import { escapeHtml, formatCount } from './utils.js';
import { brandMeta } from './data.js';
import { state } from './state.js';
import {
  captionHTML, mediaHTML, glyph, clickable, linkAttrs, isImageSet,
} from './render-post.js';

const VERIFIED = `<svg viewBox="0 0 20 20" width="13" height="13" aria-label="Verified">
  <path fill="#3897f0" d="M10 .8l2.2 2.1 3-.3.6 3 2.6 1.5-1.3 2.7 1.3 2.7-2.6 1.5-.6 3-3-.3L10 19.2
    l-2.2-2.1-3 .3-.6-3L1.6 13l1.3-2.7L1.6 7.6l2.6-1.5.6-3 3 .3z"/>
  <path fill="#fff" d="M8.7 12.9L5.9 10l1.2-1.2 1.6 1.6 4-4L13.9 7.6z"/>
</svg>`;

function avatarHTML(post) {
  const b = brandMeta(post.brandKey);
  const inner = b.avatar
    ? `<img class="mock-ig__av" src="${b.avatar}" alt="" loading="lazy">`
    : `<span class="mock-ig__av" style="background:${b.hue}"></span>`;
  return `<span class="mock-ig__avwrap">${inner}</span>`;
}

/**
 * Album posts get a real swipeable carousel: a flex track offset by a CSS
 * custom property, so moving between slides never re-renders the card.
 * The index lives in state so it survives a filter change or a refresh.
 */
function carouselHTML(post, tiles, hue) {
  const i = state.carousels.get(post.id) || 0;
  const imgs = post.images || [];
  const slides = [];
  for (let s = 0; s < tiles; s++) {
    const img = imgs[s] || null;
    // A real photograph keeps its own colours; only the drawn placeholders are
    // hue-shifted per slide so an empty carousel still reads as several cards.
    const style = img
      ? `--ph-hue:hsl(${hue} 62% 52%)`
      : `--ph-hue:hsl(${(hue + s * 26) % 360} 62% 52%)`;
    slides.push(`<div class="igcar__slide">
      <div class="ph ph--4x5" style="${style}">
        ${img ? `<img class="ph__img" src="${escapeHtml(img.src)}" alt="" loading="lazy"
                  decoding="async" referrerpolicy="no-referrer"
                  data-drive="${escapeHtml(img.id)}">` : ''}
        ${post.files ? `<span class="ph__label">${escapeHtml(post.files)}</span>` : ''}
      </div></div>`);
  }
  const dots = Array.from({ length: tiles }, (_, s) =>
    `<button class="igcar__dot" data-act="carousel-dot" data-post="${escapeHtml(post.id)}" ` +
    `data-i="${s}" aria-current="${s === i}" aria-label="Slide ${s + 1}"></button>`).join('');

  return `<div class="igcar" data-carousel="${escapeHtml(post.id)}" data-n="${tiles}"
               style="--i:${i}">
      <div class="igcar__track">${slides.join('')}</div>
      <span class="igcar__chip" data-carousel-chip>${i + 1}/${tiles}</span>
      <button class="igcar__nav igcar__nav--prev" data-act="carousel-nav"
              data-post="${escapeHtml(post.id)}" data-step="-1"
              aria-label="Previous slide" ${i === 0 ? 'disabled' : ''}>\u2039</button>
      <button class="igcar__nav igcar__nav--next" data-act="carousel-nav"
              data-post="${escapeHtml(post.id)}" data-step="1"
              aria-label="Next slide" ${i === tiles - 1 ? 'disabled' : ''}>\u203a</button>
    </div>
    <div class="igcar__dots">${dots}</div>`;
}

export function mockInstagramHTML(post, platformKey = 'instagram') {
  const b = brandMeta(post.brandKey);
  const e = post.engagement[platformKey];
  /*
   * A carousel whenever there is more than one thing to swipe through: either
   * the tracker says Album, or the sheet turned out to list several files for
   * a row that could be one. isImageSet is what decides that, and it is shared
   * with mediaHTML so the two can never disagree about the same post - a Story
   * or a Reel keeps its own treatment however many files are in its folder.
   */
  const imgCount = (post.images || []).length;
  const isAlbum = isImageSet(post);
  const tiles = isAlbum
    ? Math.max(2, imgCount || post.tiles || CAROUSEL_DEFAULT)
    : 0;

  const media = isAlbum
    ? carouselHTML(post, tiles, post.hue)
    : mediaHTML(post, { aspect: 'ph--4x5' });

  return `<article class="mock-ig">
    <div class="mock-ig__head">
      ${avatarHTML(post)}
      <span class="mock-ig__name" ${linkAttrs(post, platformKey)}>
        ${escapeHtml(b.handle)}${VERIFIED}
      </span>
      <span class="mock-ig__burger">${glyph(GLYPHS.igBurger)}</span>
    </div>

    <div class="mock-ig__media" ${isAlbum ? '' : clickable(post, 'mock-ig__mediahit')}>${media}</div>

    <div class="mock-ig__bar">
      <span class="mock-ig__act mock-ig__act--like">${glyph(GLYPHS.igLike)}${formatCount(e.likes)}</span>
      <span class="mock-ig__act">${glyph(GLYPHS.igComment)}${formatCount(e.comments)}</span>
      <span class="mock-ig__act">${glyph(GLYPHS.igRepost)}${formatCount(e.reposts)}</span>
      <span class="mock-ig__act">${glyph(GLYPHS.igShare)}${formatCount(e.shares)}</span>
      <span class="spacer"></span>
      <span class="mock-ig__save">${glyph(GLYPHS.igBookmark)}</span>
    </div>

    <div class="mock-ig__cap">
      <span class="mock-ig__handle">${escapeHtml(b.handle)}</span>
      ${captionHTML(post.caption, { clamp: true, id: post.id })}
    </div>
    <div class="mock-ig__time">${escapeHtml(post.shortDate)} \u00b7 ${escapeHtml(post.timeLabel)}</div>
  </article>`;
}
