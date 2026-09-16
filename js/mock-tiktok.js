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
import { captionHTML, mediaHTML, glyph, clickable } from './render-post.js';

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

function avatarHTML(post) {
  const b = brandMeta(post.brandKey);
  const inner = b.avatar
    ? `<img class="phone__av" src="${b.avatar}" alt="" loading="lazy">`
    : `<span class="phone__av" style="background:${b.hue}"></span>`;
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

export function mockTikTokHTML(post, platformKey = 'tiktok') {
  const b = brandMeta(post.brandKey);
  const e = post.engagement[platformKey];

  // The whole screen is the creative, so the whole screen is the click target.
  return `<article class="mock-tt phone">
    <div class="phone__screen">
      <div class="phone__media" ${clickable(post, 'phone__mediahit')}>
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
        <div class="phone__handle" ${post.targetUrl
          ? `data-act="open" data-url="${escapeHtml(post.targetUrl)}" role="link" tabindex="0"`
          : 'title="No post link or asset link in the tracker"'}>@${escapeHtml(b.handle)}</div>
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
