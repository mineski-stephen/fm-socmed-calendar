/* ============================================================================
   data.js — fetch, parse, normalise.

   The rest of the app only ever sees the normalised Post shape produced here;
   no render module touches a raw sheet string.
   ========================================================================== */

import {
  CSV_URL, REQUIRED_COLUMNS, DRIVE_IMG, MAX_DRIVE_IMAGES,
  BRAND_META, BRAND_FALLBACK, BRAND_ALIASES,
  PLATFORM_META, PLATFORM_FALLBACK, PLATFORM_ALIASES,
  TYPE_META, TYPE_FALLBACK, TYPE_ALIASES, EXT_HINTS,
  STATUS_META, STATUS_FALLBACK, STATUS_ALIASES,
  FB_REACTS, LI_REACTS, CAROUSEL_DEFAULT,
} from './config.js';
import { parseCSV, resolveColumns, rowsToRecords, findColumnByValue } from './csv.js';
import {
  parseSheetDate, parseSheetTime, makeLocalDate, dateKeyOf, monthKeyOf,
  fmtTime, fmtLongDate, fmtShortDate, fmtSlashDate, relativeLabel, dowName,
} from './dates.js';
import { slug, normKey, hash32, mulberry32, pickN } from './utils.js';

export class DataError extends Error {
  constructor(message, kind) { super(message); this.name = 'DataError'; this.kind = kind; }
}

/**
 * Fetch the published CSV and return normalised posts plus a fingerprint of
 * the raw body, so a caller can tell "nothing changed" from "changed" without
 * diffing the records.
 * `bust` appends a cache-busting param: `cache: 'no-store'` only defeats the
 * BROWSER cache, while Google's edge keeps serving a cached copy for minutes.
 */
export async function loadPosts({ bust = false } = {}) {
  const url = bust ? `${CSV_URL}&_=${Date.now()}` : CSV_URL;

  let res;
  try {
    res = await fetch(url, { cache: 'no-store', credentials: 'omit' });
  } catch (err) {
    throw new DataError(
      'Could not reach the Google Sheet. Check your network connection, then try again.',
      'network');
  }
  if (!res.ok) {
    throw new DataError(
      `The sheet responded with HTTP ${res.status}. It may have been unpublished or its ` +
      'link regenerated.', 'http');
  }

  const text = await res.text();
  const rows = parseCSV(text);

  if (!rows.length || rows[0].length < 2) {
    throw new DataError(
      'The response did not look like CSV. The sheet is probably no longer published ' +
      'to the web.', 'shape');
  }

  const columns = resolveColumns(rows[0]);

  /*
   * The date column is the one the whole page hangs off, and it is the one
   * most likely to lose its header: blank cell A1 in the sheet and Google's
   * CSV export calls it "Column 1", which matches no alias. Rather than reject
   * a sheet whose data is perfectly intact, look for the column that actually
   * holds dates. Only the date is worth rescuing this way - it is the one
   * field with a distinctive enough shape to identify by sight.
   */
  if (!('date' in columns)) {
    const at = findColumnByValue(rows, (v) => !!parseSheetDate(v), {
      skip: Object.values(columns),
    });
    if (at !== -1) columns.date = at;
  }

  const missing = REQUIRED_COLUMNS.filter((f) => !(f in columns));
  if (missing.length) {
    throw new DataError(
      `The sheet is missing a required column (${missing.join(', ')}). Found: ` +
      rows[0].filter(Boolean).join(', '), 'columns');
  }

  const records = rowsToRecords(rows, columns);
  return {
    posts: records.map(normalise).filter(Boolean),
    fingerprint: `${text.length}:${hash32(text)}`,
  };
}

/* -------------------------- key normalisation ----------------------------- */

const lookupKey = (raw, aliases, meta) => {
  const n = normKey(raw);
  if (!n) return null;
  if (aliases[n]) return aliases[n];
  const s = slug(raw);
  if (aliases[s]) return aliases[s];
  if (meta[s]) return s;
  return s || null;
};

export const brandKeyOf    = (raw) => lookupKey(raw, BRAND_ALIASES, BRAND_META);
export const platformKeyOf = (raw) => lookupKey(raw, PLATFORM_ALIASES, PLATFORM_META);

/**
 * One posting can go out on several platforms at once - the tracker writes a
 * crosspost as "Facebook, Instagram". Split on commas, slashes and the word
 * "and", drop blanks, and de-duplicate.
 */
function platformKeysOf(raw) {
  const parts = String(raw ?? '')
    .split(/[,;/|]|and|[+&]/i)
    .map((t) => t.trim())
    .filter(Boolean);
  const keys = [];
  for (const part of parts) {
    const k = platformKeyOf(part);
    if (k && !keys.includes(k)) keys.push(k);
  }
  return keys.length ? keys : ['unspecified'];
}
const typeKeyOf     = (raw) => lookupKey(raw, TYPE_ALIASES, TYPE_META);
const statusKeyOf   = (raw) => lookupKey(raw, STATUS_ALIASES, STATUS_META);

export const brandMeta    = (k) => BRAND_META[k] || BRAND_FALLBACK;
export const platformMeta = (k) => PLATFORM_META[k] || PLATFORM_FALLBACK;
export const typeMeta     = (k) => TYPE_META[k] || TYPE_FALLBACK;
export const statusMeta   = (k) => STATUS_META[k] || STATUS_FALLBACK;

/*
 * The Files cell is the ONLY place the sheet ever states a file type -
 * "FAM_0915_IG_REEL_9X16_V1.mp4" - because the Drive listing is bare URLs and
 * a Drive thumbnail looks the same whether it came from a photo or a clip.
 * So everything below is positive evidence or nothing.
 */
const FILE_EXT = /\.([a-z0-9]{2,5})(?=[\s),]|$)/gi;

const extsIn = (files) =>
  [...String(files ?? '').trim().matchAll(FILE_EXT)].map((m) => m[1].toLowerCase());

/** Guess a media kind from the asset filename when Type of Post is blank. */
function inferTypeFromFiles(files) {
  for (const ext of extsIn(files)) {
    if (EXT_HINTS[ext]) return EXT_HINTS[ext];
  }
  return null;
}

/**
 * Does the sheet actually name a clip for this row?
 *
 * Only formats that could be either need to ask. A Reel is a video whatever
 * the cell says; a Story is a photo about as often as it is a video, and the
 * team writes the filename when there is one.
 */
const namesVideoFile = (files) => extsIn(files).some((ext) => EXT_HINTS[ext] === 'reels');

/* ------------------------------ normalise --------------------------------- */

/* ---------------------------------------------------------------------------
   Post Link, which is not always one link.

   A crosspost carries one URL per platform in the same cell, separated by
   newlines. The cell is also, occasionally, a paragraph of feedback with no
   URL in it at all - so the links are EXTRACTED rather than assumed, and a
   cell with none yields nothing.
   ------------------------------------------------------------------------- */

const LINK_HOSTS = [
  [/(^|\.)facebook\.com$|(^|\.)fb\.(com|watch)$/, 'facebook'],
  [/(^|\.)instagram\.com$/,                        'instagram'],
  [/(^|\.)tiktok\.com$/,                           'tiktok'],
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/,         'youtube'],
  [/(^|\.)linkedin\.com$|(^|\.)lnkd\.in$/,         'linkedin'],
  [/(^|\.)(x|twitter)\.com$/,                      'x'],
];

function postLinksOf(raw) {
  const all = String(raw || '').match(/https?:\/\/[^\s<>"')]+/g) || [];
  const byPlatform = {};

  for (const url of all) {
    let host = '';
    try { host = new URL(url).hostname.toLowerCase(); } catch { continue; }
    const hit = LINK_HOSTS.find(([re]) => re.test(host));
    // First one wins: if a cell somehow holds two Facebook links, the one
    // written first is the post and the rest are almost certainly a repost.
    if (hit && !byPlatform[hit[1]]) byPlatform[hit[1]] = url;
  }
  return { all, byPlatform };
}

/* ---------------------------------------------------------------------------
   The real creative.

   The sheet's folder-listing column holds every file inside the folder that
   Files Chip URL points at; a row whose Files Chip URL is a single file has no
   listing but is itself an image. Both reduce to Drive file ids, which is all
   the thumbnail endpoint needs.
   ------------------------------------------------------------------------- */

const DRIVE_ID = /\/file\/d\/([\w-]{20,})|[?&]id=([\w-]{20,})/g;

function driveIdsIn(text) {
  const out = [];
  for (const m of String(text || '').matchAll(DRIVE_ID)) {
    const id = m[1] || m[2];
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

function driveImagesOf(listCell, filesUrl) {
  const ids = driveIdsIn(listCell);
  // The listing is the richer source, so it wins. A row whose Files Chip URL
  // is a single file has no listing, and that one file is the asset.
  if (!ids.length) ids.push(...driveIdsIn(filesUrl));
  return ids.slice(0, MAX_DRIVE_IMAGES).map((id) => ({ id, src: DRIVE_IMG(id) }));
}

function normalise(rec) {
  const dp = parseSheetDate(rec.date);
  if (!dp) return null;                   // a row with no readable date cannot be placed

  const tp = parseSheetTime(rec.time);
  const date = makeLocalDate(dp, tp.h, tp.min);
  const dateKey = dateKeyOf(dp);

  const brandRaw = (rec.brand || '').trim();
  const platformRaw = (rec.platform || '').trim();
  const typeRaw = (rec.type || '').trim();
  const statusRaw = (rec.status || '').trim();

  const brandKey = brandKeyOf(brandRaw) || 'unknown';
  const platformKeys = platformKeysOf(platformRaw);
  const statusKey = statusRaw ? (statusKeyOf(statusRaw) || 'unspecified') : 'unspecified';

  // Type of Post is blank on a few rows. Fall back to the asset's extension
  // before giving up, but keep the row flagged as unspecified either way so
  // the gap stays visible to the team instead of being silently papered over.
  let typeKey = typeRaw ? (typeKeyOf(typeRaw) || 'unspecified') : 'unspecified';
  const inferred = (typeKey === 'unspecified') ? inferTypeFromFiles(rec.files) : null;

  const tMeta = inferred ? TYPE_META[inferred] : typeMeta(typeKey);
  const mediaKind = tMeta ? tMeta.media : 'single';

  const caption = rec.caption || '';
  const notes = (rec.notes || '').trim();
  const filesUrl = (rec.filesUrl || '').trim();

  const links = postLinksOf(rec.link);
  const images = driveImagesOf(rec.driveList, filesUrl);

  const deadlineParts = parseSheetDate(rec.deadline);

  const post = {
    id: `${dateKey}|${brandKey}|${rec._row}`,
    row: rec._row,

    dateParts: dp,
    date,
    dateKey,
    monthKey: monthKeyOf(dp),
    dow: date.getDay(),
    dowName: dowName(date),
    minuteOfDay: tp.h * 60 + tp.min,
    timeKnown: tp.known,
    timeLabel: fmtTime(tp.h, tp.min),
    dateLabel: fmtLongDate(dp),
    shortDate: fmtShortDate(dp),
    slashDate: fmtSlashDate(dp),

    deadlineKey: deadlineParts ? dateKeyOf(deadlineParts) : '',
    deadlineLabel: deadlineParts ? fmtLongDate(deadlineParts) : '',

    brandRaw, brandKey,
    platformRaw, platformKeys,
    isCrosspost: platformKeys.length > 1,
    typeRaw, typeKey,
    statusRaw, statusKey,

    // Type was blank but the filename told us what it is. The placeholder uses
    // the inference; the chip still reads "Unspecified".
    typeInferred: inferred,
    mediaKind,

    owner: (rec.owner || '').trim(),
    desc: (rec.desc || '').trim(),
    files: (rec.files || '').trim(),
    // Whether the named asset is a clip, for the formats that can be either.
    videoFile: namesVideoFile(rec.files),
    caption,
    hasCaption: !!caption.trim(),
    captionIsLong: caption.length > 200 || caption.split('\n').length > 5,
    notes,
    hasNotes: !!notes,

    /*
     * Post Link can hold one URL, several (a crosspost carries one per
     * platform), or prose - somebody leaves feedback in that cell now and
     * again. `links.byPlatform` maps facebook/instagram/... to the right URL;
     * `links.all` is everything found, in the order written. A cell with no
     * URL in it yields nothing at all, rather than a paragraph of notes being
     * used as an href.
     */
    postLinks: links.byPlatform,
    postLinkList: links.all,
    postLink: links.all[0] || '',
    filesUrl,

    /*
     * The real creative, if the sheet knows where it is. Ordered: the folder
     * listing first, then a direct file link. An empty array is the normal
     * case for a row nobody has attached anything to, and every renderer falls
     * back to the drawn placeholder.
     */
    images,
    hasImages: images.length > 0,

    incomplete: !platformRaw || !typeRaw,

  };

  post.relLabel = relativeLabel(dp, post.timeLabel);

  // The placeholder tint and the album tile count describe the creative, which
  // is the same on every platform of a crosspost, so they sit on the post.
  const look = mulberry32(hash32(post.id));
  post.hue = Math.round(look() * 360);
  post.tiles = CAROUSEL_DEFAULT;

  // One set of figures per platform: a crosspost should not show identical
  // counts on Facebook and Instagram.
  post.engagement = {};
  for (const pk of platformKeys) post.engagement[pk] = makeEngagement(post, pk);

  return post;
}

/* ---------------------------------------------------------------------------
   Mock engagement.

   The mock layouts need like/comment/share counts, and the tracker has none.
   They are generated from a PRNG seeded by a hash of the post's identity, and
   computed ONCE here at normalise time. That means the numbers are identical
   across every re-render, every filter change, every theme flip and every
   refresh — with Math.random() they would reshuffle constantly and the mocks
   would look broken.

   These numbers are fabricated. The README says so, and so does the Stats tab.
   ------------------------------------------------------------------------- */

function makeEngagement(post, platformKey) {
  const rng = mulberry32(hash32(`${post.id}|${platformKey}|${post.caption.slice(0, 40)}`));

  // Video travels further than a static image; posted content has had time to
  // accumulate, scheduled content has not.
  const isVideo = post.mediaKind === 'reels' || post.mediaKind === 'dynamic';
  const live = post.statusKey === 'posted';
  const base = (isVideo ? 820 : 190) * (live ? 1 : 0.35);

  const likes = Math.max(3, Math.round(base * (0.35 + rng() * 2.9)));
  const comments = Math.max(0, Math.round(likes * (0.02 + rng() * 0.09)));
  const shares = Math.max(0, Math.round(likes * (0.015 + rng() * 0.07)));
  const reposts = Math.max(0, Math.round(likes * (0.01 + rng() * 0.06)));
  const saves = Math.max(0, Math.round(likes * (0.03 + rng() * 0.12)));
  const views = isVideo
    ? Math.round(likes * (14 + rng() * 42))
    : Math.round(likes * (6 + rng() * 14));

  return {
    likes, comments, shares, reposts, saves, views,
    reacts: pickN(rng, FB_REACTS, 3),
    // LinkedIn has its own six, so it gets its own draw rather than borrowing
    // Facebook's. Taken after the line above so the Facebook picks on every
    // existing post stay exactly where they were.
    liReacts: pickN(rng, LI_REACTS, 3),
  };
}

/* ------------------------------ facet lists ------------------------------- */

/**
 * Build the filter-bar facets from values actually present in the data, so the
 * bar never offers a platform nobody posts to.
 */
export function buildFacets(posts) {
  /*
   * One per row for brand, status and type. Platforms count per platform, so a
   * crosspost appears under each of its platforms and those counts can sum to
   * more than the number of posts.
   */
  const count = (keyFn) => {
    const m = new Map();
    for (const p of posts) {
      const k = keyFn(p);
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  };
  const platforms = new Map();
  for (const p of posts) {
    for (const pk of p.platformKeys) platforms.set(pk, (platforms.get(pk) || 0) + 1);
  }
  return {
    brands: count((p) => p.brandKey),
    platforms,
    statuses: count((p) => p.statusKey),
    types: count((p) => p.typeKey),
  };
}

/** Months that actually contain posts, ascending. */
export function monthsWithData(posts) {
  return Array.from(new Set(posts.map((p) => p.monthKey))).sort();
}
