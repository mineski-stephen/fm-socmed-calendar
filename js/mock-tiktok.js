/* ============================================================================
   mock-tiktok.js — pairs with css/mock-tiktok.css
   Reference: mock_layouts/tiktok.png

   TikTok is not a card, it is a whole phone screen: the creative fills the
   display edge to edge and everything else floats on top of it. So this mock
   is built on the shared .phone scaffold in css/mock-phone.css rather than on
   the card framing the feed platforms use - drawing it as a card would be a
   picture of the wrong thing.

   There is no phone status bar. A clock and a battery say "phone" but say
   nothing about the post, and on a planning tool a rendered time is the one
   piece of set dressing somebody might read as data.
   ========================================================================== */

import { GLYPHS, TT_ART } from './config.js';
import { escapeHtml, formatCount } from './utils.js';
import { brandMeta } from './data.js';
import { captionHTML, mediaHTML, glyph, clickable, linkAttrs } from './render-post.js';

const MUSIC = `<svg class="mock-tt__note" viewBox="0 0 24 24" aria-hidden="true">
  <path d="M9 18V6l10-2v12" fill="none" stroke="currentColor" stroke-width="1.9"
        stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="6.6" cy="18" r="2.6" fill="currentColor"/>
  <circle cx="16.6" cy="16" r="2.6" fill="currentColor"/>
</svg>`;

const SEARCH = `<svg class="mock-tt__search" viewBox="0 0 24 24" aria-hidden="true">
  <circle cx="10.5" cy="10.5" r="6.6" fill="none" stroke="currentColor" stroke-width="2"/>
  <path d="m15.4 15.4 4.4 4.4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>`;

function avatarHTML(post, small = false) {
  const b = brandMeta(post.brandKey);
  const cls = small ? 'phone__av phone__av--sm' : 'phone__av';
  const inner = b.avatar
    ? `<img class="${cls}" src="${b.avatar}" alt="" loading="lazy">`
    : `<span class="${cls}" style="background:${b.hue}"></span>`;
  if (small) return inner;
  // The red + hanging off the bottom of the avatar is TikTok's follow button.
  // Real artwork rather than a stencil, so it is an <img>: see TT_ART.
  return `<span class="mock-tt__avwrap">${inner}
      <img class="mock-tt__plus" src="${TT_ART.plus}" alt="" loading="lazy">
    </span>`;
}

/** One entry in the right-hand action rail: icon above, count below. */
const railAct = (src, value, cls = '') =>
  `<span class="phone__act ${cls}">${glyph(src)}<b>${escapeHtml(value)}</b></span>`;

/** One entry in the bottom nav: icon above, word below. */
const navItem = (src, label, cls = '') =>
  `<span class="phone__navitem ${cls}">${glyph(src)}<span>${escapeHtml(label)}</span></span>`;

/* ---------------------------------------------------------------------------
   A photo post is a different screen from the video feed.

   Reference: mock_layouts/tiktok_post.png. It is LIGHT, not black; the image
   is contained rather than full-bleed, with carousel dots under it; the
   channel, its sound and a Follow pill sit in a top bar; and the actions run
   along the bottom beside an "Add comment" field instead of down the right
   edge. Drawing a static post in the video chrome would be a picture of the
   wrong screen.
   ------------------------------------------------------------------------- */

const BACK = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" stroke-width="2.1"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

/** Icon over its count, along the bottom of a photo post. */
const photoAct = (src, value, cls = '') =>
  `<span class="mock-tt__pact ${cls}">${glyph(src)}<b>${escapeHtml(value)}</b></span>`;

function photoPostHTML(post, platformKey, b, e) {
  const imgs = post.images || [];
  const n = Math.max(1, imgs.length);
  const dots = n > 1
    ? `<div class="mock-tt__dots">${Array.from({ length: Math.min(n, 10) }, (_, i) =>
        `<i${i === 0 ? ' class="is-on"' : ''}></i>`).join('')}</div>`
    : '';

  return `<article class="mock-tt mock-tt--photo phone">
    <div class="phone__screen">
      <div class="mock-tt__ptop">
        ${BACK}
        ${avatarHTML(post, true)}
        <div class="mock-tt__pwho">
          <div class="mock-tt__pname">${escapeHtml(b.label)}</div>
          <div class="mock-tt__sound">${MUSIC}<span>Original sound \u00b7 ${escapeHtml(b.label)}</span></div>
        </div>
        <span class="mock-tt__follow">Follow</span>
        ${SEARCH}
      </div>

      <div class="mock-tt__pstage" ${clickable(post, 'mock-tt__phit', platformKey)}>
        ${mediaHTML(post, { aspect: 'ph--4x5' })}
      </div>
      ${dots}

      <div class="mock-tt__pcap">
        ${captionHTML(post.caption, { clamp: true, id: post.id, sm: true })}
      </div>

      <div class="mock-tt__pbar">
        <span class="mock-tt__addcomment">Add comment\u2026</span>
        ${photoAct(GLYPHS.ttLike, formatCount(e.likes), 'mock-tt__act--like')}
        ${photoAct(GLYPHS.ttComment, formatCount(e.comments))}
        ${photoAct(GLYPHS.ttBookmark, formatCount(e.saves))}
        ${photoAct(GLYPHS.ttShare, formatCount(e.shares))}
      </div>
    </div>
  </article>`;
}

export function mockTikTokHTML(post, platformKey = 'tiktok') {
  const b = brandMeta(post.brandKey);
  const e = post.engagement[platformKey];

  // Video goes in the feed chrome; anything still is a photo post, which is a
  // different screen entirely.
  const isVideo = ['reels', 'story', 'dynamic'].includes(post.mediaKind);
  if (!isVideo) return photoPostHTML(post, platformKey, b, e);

  // The whole screen is the creative, so the whole screen is the click target.
  return `<article class="mock-tt phone">
    <div class="phone__screen">
      <div class="phone__media" ${clickable(post, 'phone__mediahit', platformKey)}>
        ${mediaHTML(post, { aspect: 'ph--fill' })}
      </div>

      <div class="phone__shade phone__shade--top"></div>
      <div class="phone__shade phone__shade--bottom"></div>

      <div class="mock-tt__tabs">
        <span>Following</span>
        <span class="is-on">For You</span>
        ${SEARCH}
      </div>

      <div class="phone__rail">
        ${avatarHTML(post)}
        ${railAct(GLYPHS.ttLike, formatCount(e.likes), 'mock-tt__act--like')}
        ${railAct(GLYPHS.ttComment, formatCount(e.comments))}
        ${railAct(GLYPHS.ttBookmark, formatCount(e.saves))}
        ${railAct(GLYPHS.ttShare, formatCount(e.shares))}
      </div>

      <div class="phone__meta">
        <div class="phone__handle" ${linkAttrs(post, platformKey)}>@${escapeHtml(b.handle)}</div>
        <div class="phone__cap">${captionHTML(post.caption, { clamp: true, id: post.id, sm: true })}</div>
        <div class="mock-tt__sound">${MUSIC}<span>Original sound · ${escapeHtml(b.label)}</span></div>
      </div>

      <div class="phone__nav">
        ${navItem(GLYPHS.ttHome, 'Home')}
        ${navItem(GLYPHS.ttShop, 'Shop')}
        <span class="phone__navitem mock-tt__upload">
          <img src="${TT_ART.upload}" alt="" loading="lazy"></span>
        ${navItem(GLYPHS.ttInbox, 'Inbox')}
        ${navItem(GLYPHS.ttProfile, 'Profile')}
      </div>
    </div>
  </article>`;
}
