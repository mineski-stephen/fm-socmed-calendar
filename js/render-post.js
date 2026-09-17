/* ============================================================================
   render-post.js — the shared building blocks every card and mock is made of:
   captions, media placeholders, the internal-note comment, and the simple card
   used in Simple mode and for platforms that have no mock.

   Everything here is a pure string builder. Nothing touches the DOM.
   ========================================================================== */

import { GLYPHS, PLAY_BADGE, CAROUSEL_DEFAULT } from './config.js';
import { escapeHtml } from './utils.js';
import { platformMeta, typeMeta, statusMeta } from './data.js';
import { state } from './state.js';
import { isOverdue } from './selectors.js';

/**
 * <i class="glyph"> backed by a PNG used as a CSS mask, so it takes
 * currentColor and works in both themes from a single black asset.
 *
 * mask-image is set here rather than in base.css on purpose: a url() routed
 * through a CSS custom property resolves against the stylesheet that consumes
 * it, which would turn "img/x.png" into "css/img/x.png".
 */
export const glyph = (src, cls = '') =>
  `<i class="glyph ${cls}" aria-hidden="true" ` +
  `style="-webkit-mask-image:url('${src}');mask-image:url('${src}')"></i>`;

/* ------------------------------- captions --------------------------------- */

/*
 * Caption tokenising.
 *
 * The obvious approach — escape the whole string, then regex over it — is
 * subtly wrong: escaping turns an apostrophe into "&#39;", and the hashtag
 * pattern then matches the "#39" inside that entity, splits it with a <span>,
 * and the caption renders a literal "&#39;" on screen. Any numeric entity
 * would break the same way.
 *
 * So we tokenise the RAW text and escape each piece as we emit it. The regex
 * never sees an entity, and nothing reaches the DOM unescaped.
 *
 * The pattern must also catch bare, protocol-less links: the only URL anywhere
 * in this sheet is "bit.ly/FUNaloMAX", which a naive /https?:\/\// misses.
 */
const TOKEN_RE =
  /(https?:\/\/[^\s<]+|\b(?:www\.|bit\.ly\/)[^\s<]+|\b[a-z0-9-]+\.(?:com|net|org|ly|ph|co|io|tv|gg)\/[^\s<]*)|(#[\p{L}\p{N}_]+)|(@[A-Za-z0-9_.]{2,})/giu;

const href = (raw) => (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);

const TRAILING_PUNCT = /[.,!?)\]]+$/;

function tokenise(raw) {
  let out = '';
  let last = 0;
  TOKEN_RE.lastIndex = 0;

  for (let m = TOKEN_RE.exec(raw); m; m = TOKEN_RE.exec(raw)) {
    out += escapeHtml(raw.slice(last, m.index));
    const [full, link, tag, at] = m;

    if (link) {
      // Trailing punctuation belongs to the sentence, not to the URL.
      const trail = TRAILING_PUNCT.exec(link);
      const url = trail ? link.slice(0, -trail[0].length) : link;
      out += `<a class="cap-link" href="${escapeHtml(href(url))}" target="_blank" ` +
             `rel="noopener noreferrer">${escapeHtml(url)}</a>` +
             (trail ? escapeHtml(trail[0]) : '');
    } else if (tag) {
      out += `<span class="cap-tag">${escapeHtml(tag)}</span>`;
    } else if (at) {
      out += `<span class="cap-at">${escapeHtml(at)}</span>`;
    } else {
      out += escapeHtml(full);
    }
    last = m.index + full.length;
  }
  return out + escapeHtml(raw.slice(last));
}

/* ---------------------------------------------------------------------------
   Which context a caption is being drawn in.

   The same post appears in a day strip AND, at the same moment, inside the
   spotlight over the top of it. They are two separate things to read, so
   expanding one must not expand the other - and expanding the one you cannot
   see is worse than useless, because rebuilding the strip underneath the
   overlay is work nobody asked for.

   A module-level value rather than an argument threaded through every mock:
   captionHTML is called from six mock builders, none of which have any other
   reason to know where their output is going. It is set and cleared around one
   synchronous build, so there is never more than one scope in play.
   ------------------------------------------------------------------------- */
let captionScope = '';

/** Build `fn`'s markup with captions keyed to `scope`. Restores on the way out. */
export function withCaptionScope(scope, fn) {
  const prev = captionScope;
  captionScope = scope;
  try { return fn(); } finally { captionScope = prev; }
}

/** The key a caption's expanded state is stored under, for a given context. */
export const captionKey = (id, scope = '') => (scope ? `${scope}::${id}` : id);

export function captionHTML(text, { clamp = false, id = '', sm = false } = {}) {
  const raw = String(text ?? '');
  if (!raw.trim()) {
    return `<div class="cap cap--none${sm ? ' cap--sm' : ''}">No caption in the tracker</div>`;
  }

  const body = tokenise(raw);

  const scope = captionScope;
  const expanded = id && state.expanded.has(captionKey(id, scope));
  const doClamp = clamp && !expanded;
  const cls = `cap${sm ? ' cap--sm' : ''}${doClamp ? ' cap--clamp' : ''}`;
  /*
   * Emitted HIDDEN. Whether a caption is actually clipped depends on how it
   * wraps at the width it ends up with, which no string builder can know, so
   * syncCaptionMore in captions.js measures each one after layout and reveals
   * only the buttons that have something to reveal. An already-expanded
   * caption keeps its button either way - it is the only way back.
   */
  const more = clamp && id
    ? `<button class="cap-more" data-act="expand-caption" data-post="${escapeHtml(id)}"` +
      `${scope ? ` data-scope="${escapeHtml(scope)}"` : ''}` +
      `${expanded ? '' : ' hidden'}>` +
      `${expanded ? 'See less' : 'See more'}</button>`
    : '';

  // Clicking the caption copies it. The raw text is not duplicated into a data
  // attribute - the handler looks the post up by id - so long captions are not
  // written into the DOM twice.
  const copy = id
    ? ` data-act="copy-caption" data-post="${escapeHtml(id)}" role="button" tabindex="0"` +
      ' title="Click to copy this caption"'
    : '';

  return `<div class="${cls}${id ? ' cap--copy' : ''}"${copy}>${body}</div>${more}`;
}


/* ---------------------------- media placeholders -------------------------- */

/*
 * The tracker gives us filenames and Drive links, never an image we can embed,
 * so every placeholder is drawn in CSS. Each is tinted from a per-post hue so
 * a strip of posts stays visually distinguishable, and labelled with the
 * filename so it reads as deliberate rather than as a broken image.
 */

/**
 * Where a click on this post should go, for the platform being drawn.
 *
 * A crosspost carries one Post Link per platform in the same cell, so the
 * Facebook mock must open the Facebook post and the Instagram mock the
 * Instagram one. Falling back in order: this platform's own link, then any
 * link in the cell, then the asset in Drive, then nowhere.
 */
export function targetFor(post, platformKey = '') {
  const own = platformKey && post.postLinks?.[platformKey];
  if (own) return { url: own, kind: 'post', exact: true };
  if (post.postLink) return { url: post.postLink, kind: 'post', exact: false };
  if (post.filesUrl) return { url: post.filesUrl, kind: 'files', exact: false };
  return { url: null, kind: null, exact: false };
}

/**
 * Attributes for a page name or handle that links to the live post. Same
 * resolution as clickable(), without the class - the callers style their own.
 */
export function linkAttrs(post, platformKey = '') {
  const t = targetFor(post, platformKey);
  return t.url
    ? `data-act="open" data-url="${escapeHtml(t.url)}" role="link" tabindex="0"`
    : 'title="No post link or asset link in the tracker"';
}

/** Class + attributes for something clickable that may have nowhere to go. */
function clickable(post, baseCls, platformKey = '') {
  const t = targetFor(post, platformKey);
  if (t.url) {
    const label = t.kind === 'post'
      ? (t.exact ? 'Open the live post' : 'Open the live post (this row has one link)')
      : 'Open the asset in Drive';
    return `class="${baseCls}" data-act="open" data-url="${escapeHtml(t.url)}" ` +
           `role="link" tabindex="0" title="${label}"`;
  }
  return `class="${baseCls} is-inert" title="No post link or asset link in the tracker"`;
}

const phLabel = (post) =>
  post.files ? `<span class="ph__label">${escapeHtml(post.files)}</span>` : '';

const hueVar = (post) => `--ph-hue:hsl(${post.hue} 62% 52%)`;

/*
 * The real creative, laid over the drawn placeholder rather than instead of it.
 *
 * The Drive thumbnail endpoint is undocumented and has changed before, and a
 * link can be made private at any moment, so an image that does not arrive
 * must not leave a broken frame in a client's face. The placeholder stays in
 * the box underneath; main.js hides a failed <img> on its error event and the
 * placeholder is simply what is already there.
 *
 * It also covers the filename label, so a post with real creative shows the
 * creative and a post without shows what the file is called.
 *
 * referrerpolicy="no-referrer" is NOT optional. Drive refuses the request when
 * it carries a Referer from an origin it does not know - every image 403s from
 * localhost or any host that is not Google's - and the page falls back to
 * placeholders across the board. Suppress the header and the same URL serves
 * the asset at full resolution.
 */
const imgHTML = (img, i = 0) => (img
  ? `<img class="ph__img" src="${escapeHtml(img.src)}" alt="" loading="lazy" decoding="async"` +
    ` referrerpolicy="no-referrer" data-drive="${escapeHtml(img.id)}"` +
    `${i ? ` data-i="${i}"` : ''}>`
  : '');

/**
 * @param {object} post
 * @param {string} shapeCls  aspect class
 * @param {string} inner     overlays drawn ON TOP of any real image
 * @param {object} img       the asset to show, if the sheet knows of one
 */
function phBlock(post, shapeCls, inner = '', img = null) {
  return `<div class="ph ${shapeCls}" style="${hueVar(post)}">` +
         `${imgHTML(img)}${inner}${phLabel(post)}</div>`;
}

/*
 * Formats that can be a SET of images. Nothing else qualifies, however many
 * files the sheet lists for the row.
 *
 * A Story with three files in its folder is still a story, and a Reel with two
 * is still a reel - those extra files are versions, sizes and re-cuts, not
 * slides somebody will swipe through. Only a Static Post that turned out to
 * have several images, or a row explicitly marked Album, becomes one.
 */
const SET_KINDS = new Set(['single', 'album']);

/** Should this post be drawn as several images rather than one? */
export const isImageSet = (post) =>
  SET_KINDS.has(post.mediaKind)
  && (post.mediaKind === 'album' || (post.images?.length || 0) > 1);

/**
 * @param {object} post
 * @param {string} aspect   shape class for single-image media, per platform
 * @param {number} tiles    album tile count
 */
export function mediaHTML(post, { aspect = 'ph--1x1', tiles = 0 } = {}) {
  const kind = post.mediaKind;
  if (kind === 'none') return '';

  const imgs = post.images || [];
  const first = imgs[0] || null;

  // Video fills the full card width rather than sitting in a 9:16 column with
  // dead space beside it. The drifting gradient plus the play badge is what
  // says "this one moves"; a still block would read as a photo. With real
  // creative the first frame is the poster and the badge sits over it.
  if (kind === 'reels') {
    return phBlock(post, `${aspect} ph--video`,
      `<span class="ph__sheen"></span>` +
      `<img class="ph__play" src="${PLAY_BADGE}" alt="">` +
      `<span class="ph__badge ph__badge--tl">REELS</span>` +
      `<span class="ph__bar"><i></i></span>`, first);
  }

  if (kind === 'story') {
    return phBlock(post, `${aspect} ph--video ph--story`,
      `<span class="ph__segs"><i></i><i></i><i></i></span>` +
      `<span class="ph__sheen"></span>` +
      `<img class="ph__play" src="${PLAY_BADGE}" alt="">` +
      `<span class="ph__badge ph__badge--tr">STORY</span>`, first);
  }

  if (kind === 'dynamic') {
    return phBlock(post, `${aspect} ph--dyn`,
      `<img class="ph__play ph__play--sm" src="${PLAY_BADGE}" alt="">` +
      `<span class="ph__badge">GIF</span>`, first);
  }

  // A KOL or UGC share is someone else's post being amplified, so it is drawn
  // as a quoted card rather than as our own creative.
  if (kind === 'ugc') {
    return `<div class="ph-ugc">
        <div class="ph-ugc__head">
          <span class="ph-ugc__av"></span>
          <span class="ph-ugc__who">Creator post</span>
          <span class="ph__badge ph__badge--inline">KOL / UGC</span>
        </div>
        ${phBlock(post, aspect, '', first)}
      </div>`;
  }

  if (kind === 'link') {
    return phBlock(post, 'ph--191',
      `<span class="ph__badge ph__badge--tl">LINK</span>`, first);
  }

  // An album, either because the tracker says so or because the sheet turned
  // out to list more than one file for a row that could be one.
  if (isImageSet(post)) return albumHTML(post, aspect, tiles);

  return phBlock(post, aspect, '', first);
}

/**
 * Facebook's and LinkedIn's album grid: up to four tiles with a +N on the last.
 *
 * The tile count comes from the creative when the sheet lists it, and from the
 * declared type when it does not - a row marked Album with nothing attached
 * still has to look like an album.
 */
export function albumHTML(post, aspect = 'ph--1x1', tiles = 0) {
  const imgs = post.images || [];
  const n = Math.max(2, imgs.length || tiles || post.tiles || CAROUSEL_DEFAULT);
  const shown = Math.min(4, n);
  const cells = [];

  for (let i = 0; i < shown; i++) {
    const more = (i === shown - 1 && n > shown)
      ? `<span class="phgrid__more">+${n - shown}</span>` : '';
    const img = imgs[i] || null;
    // Only the placeholders are hue-shifted per tile; a real photograph does
    // not want a filter over it.
    const style = img ? hueVar(post) : `${hueVar(post)};filter:hue-rotate(${i * 14}deg)`;
    cells.push(`<div class="ph" style="${style}">${imgHTML(img, i)}${more}</div>`);
  }
  return `<div class="phgrid" data-n="${n}">${cells.join('')}</div>`;
}

/** The media block wrapped so a click opens Post Link, else Files Chip URL. */
export function clickableMediaHTML(post, opts = {}) {
  const inner = mediaHTML(post, opts);
  if (!inner) return '';
  return `<div ${clickable(post, 'mediawrap', opts.platformKey)}>${inner}</div>`;
}

export { clickable };

/* --------------------------- internal note -------------------------------- */

/**
 * Notes/Comments rendered as a mock comment on the post. It is deliberately
 * marked "Internal note" and styled apart from the fabricated engagement, so
 * nobody mistakes a scheduling remark for a real audience comment.
 */
export function noteHTML(post) {
  if (!post.hasNotes) return '';
  const who = post.owner || 'Tracker';
  const initials = who.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return `<div class="note">
      <span class="note__av">${escapeHtml(initials)}</span>
      <div class="note__bub">
        <div class="note__who">${escapeHtml(who)}<span class="note__tag">Internal note</span></div>
        <div class="note__txt">${escapeHtml(post.notes)}</div>
      </div>
    </div>`;
}

/* ------------------------------ small parts ------------------------------- */

export function platformMark(platformKey, cls = 'chip__logo') {
  const meta = platformMeta(platformKey);
  if (!meta.icon) return `<span class="${cls.replace('logo', 'ph')} chip__ph">?</span>`;
  return `<img class="${cls}" src="${meta.icon}" alt="" loading="lazy">`;
}

export const statusPill = (post) => {
  const meta = statusMeta(post.statusKey);
  return `<span class="pill pill--${escapeHtml(post.statusKey)}">${escapeHtml(meta.label)}</span>`;
};

const incompleteMark = (post) => post.incomplete
  ? `<span class="warnmark" title="This row is missing its Platform or Type of Post ` +
    `in the tracker">!</span>` : '';

const linksHTML = (post, platformKey = '') => {
  const out = [];
  // A crosspost's cell holds one link per platform; show this platform's.
  const t = targetFor(post, platformKey);
  if (t.kind === 'post') {
    const label = t.exact && platformKey
      ? `View on ${platformMeta(platformKey).label}`
      : 'View live post';
    out.push(`<a class="linkbtn" href="${escapeHtml(t.url)}" target="_blank" ` +
             `rel="noopener noreferrer">${escapeHtml(label)} ↗</a>`);
  }
  if (post.filesUrl) {
    out.push(`<a class="linkbtn" href="${escapeHtml(post.filesUrl)}" target="_blank" ` +
             `rel="noopener noreferrer">Open asset ↗</a>`);
  }
  return out.length ? `<div class="pcard__links">${out.join('')}</div>` : '';
};

/* ------------------------------ post header -------------------------------- */

/**
 * The header strip that sits above EVERY post, simple card and mock alike, so
 * it is always obvious which platform a post belongs to - especially now that
 * one tracker row can be a crosspost drawn once per platform.
 */
export function postHeaderHTML(post, platformKey) {
  const pMeta = platformMeta(platformKey);
  const tMeta = typeMeta(post.typeKey);
  const key = entryKey(post, platformKey);
  const isCollapsed = state.collapsed.has(key);

  const typeLabel = post.typeInferred
    ? `${tMeta.label} \u00b7 looks like ${post.typeInferred}`
    : tMeta.label;

  // The whole header is the collapse toggle, so a day full of tall mocks can be
  // flattened into a scannable list without losing the internal notes.
  return `<header class="pcard__top" data-act="toggle-collapse"
      data-entry="${escapeHtml(key)}" role="button" tabindex="0"
      aria-expanded="${!isCollapsed}"
      title="${isCollapsed ? 'Show this post' : 'Hide this post'}">
      ${platformMark(platformKey, 'pcard__logo')}
      <span class="pcard__pf">${escapeHtml(pMeta.label)}</span>
      <span class="pcard__tags">
        ${post.isCrosspost ? crosspostMark(post, platformKey) : ''}
        ${incompleteMark(post)}
        ${overdueMark(post)}
        ${statusPill(post)}
        <span class="pcard__type">${escapeHtml(typeLabel)}</span>
      </span>
      <span class="pcard__time">${escapeHtml(post.timeLabel)}</span>
      <button class="pcard__zoom" data-act="spotlight" data-entry="${escapeHtml(key)}"
              title="Examine this post" aria-label="Examine this post">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7" fill="none" stroke="currentColor"
                stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <svg class="pcard__chev" viewBox="0 0 24 24" aria-hidden="true">
        <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2"
              stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </header>`;
}

/** Identifies one post on one platform; a crosspost has one key per platform. */
export const entryKey = (post, platformKey) => `${post.id}::${platformKey}`;

/**
 * Marks a posting whose date went by while it was still not Posted. Sits right
 * before the status pill, so the pill that should say "Posted" and the warning
 * that it does not are read together.
 */
function overdueMark(post) {
  if (!isOverdue(post)) return '';
  return `<span class="overduemark" title="${escapeHtml(
    `This was due ${post.dateLabel} and is still marked ${statusMeta(post.statusKey).label}`)}">` +
    `⚠ Past due</span>`;
}

/** Marks a post that is going out on more than one platform at once. */
function crosspostMark(post, platformKey) {
  const others = post.platformKeys
    .filter((k) => k !== platformKey)
    .map((k) => platformMeta(k).label)
    .join(', ');
  return `<span class="crossmark" title="${escapeHtml('Also posted on ' + others)}">` +
         `\u21c4 crosspost</span>`;
}

/* ------------------------------ simple card ------------------------------- */

/**
 * Simple mode's card. Also the Layout-mode renderer for TikTok, YouTube,
 * LinkedIn and Unspecified, because PLATFORM_META[key].mock is null for them.
 */
export function simpleCardHTML(post, platformKey, { showMedia = false } = {}) {
  const collapsed = state.collapsed.has(entryKey(post, platformKey)) ? ' is-collapsed' : '';
  return `<article class="pcard${showMedia ? '' : ' pcard--compact'}${collapsed}">
    ${postHeaderHTML(post, platformKey)}
    <div class="pcard__body">
      ${showMedia ? `<div class="pcard__thumb">${
        clickableMediaHTML(post, { aspect: 'ph--191', platformKey })}</div>` : ''}
      ${captionHTML(post.caption, { clamp: true, id: post.id, sm: true })}
      ${post.files
        ? `<div class="pcard__files">${glyph(GLYPHS.clip, 'glyph--clip')}<span>${escapeHtml(post.files)}</span></div>`
        : ''}
      ${linksHTML(post, platformKey)}
    </div>
    ${noteHTML(post)}
  </article>`;
}
