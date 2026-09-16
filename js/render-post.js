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
  const more = clamp && id
    ? `<button class="cap-more" data-act="expand-caption" data-post="${escapeHtml(id)}"` +
      `${scope ? ` data-scope="${escapeHtml(scope)}"` : ''}>` +
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

/** Class + attributes for something clickable that may have nowhere to go. */
function clickable(post, baseCls) {
  if (post.targetUrl) {
    const label = post.targetKind === 'post' ? 'Open the live post' : 'Open the asset in Drive';
    return `class="${baseCls}" data-act="open" data-url="${escapeHtml(post.targetUrl)}" ` +
           `role="link" tabindex="0" title="${label}"`;
  }
  return `class="${baseCls} is-inert" title="No post link or asset link in the tracker"`;
}

const phLabel = (post) =>
  post.files ? `<span class="ph__label">${escapeHtml(post.files)}</span>` : '';

const hueVar = (post) => `--ph-hue:hsl(${post.hue} 62% 52%)`;

function phBlock(post, shapeCls, inner = '') {
  return `<div class="ph ${shapeCls}" style="${hueVar(post)}">${inner}${phLabel(post)}</div>`;
}

/**
 * @param {object} post
 * @param {string} aspect   shape class for single-image media, per platform
 * @param {number} tiles    album tile count
 */
export function mediaHTML(post, { aspect = 'ph--1x1', tiles = 0 } = {}) {
  const kind = post.mediaKind;
  if (kind === 'none') return '';

  // Video fills the full card width rather than sitting in a 9:16 column with
  // dead space beside it. The drifting gradient plus the play badge is what
  // says "this one moves"; a still block would read as a photo.
  if (kind === 'reels') {
    return phBlock(post, `${aspect} ph--video`,
      `<span class="ph__sheen"></span>` +
      `<img class="ph__play" src="${PLAY_BADGE}" alt="">` +
      `<span class="ph__badge ph__badge--tl">REELS</span>` +
      `<span class="ph__bar"><i></i></span>`);
  }

  if (kind === 'story') {
    return phBlock(post, `${aspect} ph--video ph--story`,
      `<span class="ph__segs"><i></i><i></i><i></i></span>` +
      `<span class="ph__sheen"></span>` +
      `<img class="ph__play" src="${PLAY_BADGE}" alt="">` +
      `<span class="ph__badge ph__badge--tr">STORY</span>`);
  }

  if (kind === 'dynamic') {
    return phBlock(post, `${aspect} ph--dyn`,
      `<img class="ph__play ph__play--sm" src="${PLAY_BADGE}" alt="">` +
      `<span class="ph__badge">GIF</span>`);
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
        ${phBlock(post, aspect)}
      </div>`;
  }

  if (kind === 'album') {
    const n = Math.max(2, tiles || post.tiles || CAROUSEL_DEFAULT);
    const shown = Math.min(4, n);
    const cells = [];
    for (let i = 0; i < shown; i++) {
      const more = (i === shown - 1 && n > shown)
        ? `<span class="phgrid__more">+${n - shown}</span>` : '';
      cells.push(`<div class="ph" style="${hueVar(post)};filter:hue-rotate(${i * 14}deg)">${more}</div>`);
    }
    return `<div class="phgrid">${cells.join('')}</div>`;
  }

  if (kind === 'link') {
    return phBlock(post, 'ph--191', `<span class="ph__badge ph__badge--tl">LINK</span>`);
  }

  return phBlock(post, aspect);
}

/** The media block wrapped so a click opens Post Link, else Files Chip URL. */
export function clickableMediaHTML(post, opts) {
  const inner = mediaHTML(post, opts);
  if (!inner) return '';
  return `<div ${clickable(post, 'mediawrap')}>${inner}</div>`;
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

const linksHTML = (post) => {
  const out = [];
  if (post.postLink) {
    out.push(`<a class="linkbtn" href="${escapeHtml(post.postLink)}" target="_blank" ` +
             `rel="noopener noreferrer">View live post \u2197</a>`);
  }
  if (post.filesUrl) {
    out.push(`<a class="linkbtn" href="${escapeHtml(post.filesUrl)}" target="_blank" ` +
             `rel="noopener noreferrer">Open asset \u2197</a>`);
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
      ${showMedia ? `<div class="pcard__thumb">${clickableMediaHTML(post, { aspect: 'ph--191' })}</div>` : ''}
      ${captionHTML(post.caption, { clamp: true, id: post.id, sm: true })}
      ${post.files
        ? `<div class="pcard__files">${glyph(GLYPHS.clip, 'glyph--clip')}<span>${escapeHtml(post.files)}</span></div>`
        : ''}
      ${linksHTML(post)}
    </div>
    ${noteHTML(post)}
  </article>`;
}
