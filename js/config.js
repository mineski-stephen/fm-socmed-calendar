/* ============================================================================
   config.js — every constant the app needs. No imports, no side effects.

   The META registries below are what keep platform/brand/type handling out of
   the render code: everything downstream does a lookup by key instead of
   branching on a raw sheet string.
   ========================================================================== */

/** Published CSV of the team's tracker sheet. */
export const CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vR26NJiJz14xBD0dY69D_RnA9F-JNtxqRDnQfUEKfnJVZtpPZHGfNH5Xj3mKIlz-s7lATp3gEk_WYDo/pub?gid=1769957223&single=true&output=csv';

/**
 * Second tab of the same workbook: a weekly follower count per account.
 *
 * One row per account per week, with the whole schedule pre-created - every
 * week from here to next March already exists with empty cells. So a row is
 * only a reading when it actually carries numbers; a blank row is a week
 * nobody has collected yet, not a week where everybody lost all their
 * followers. followers.js drops them.
 */
export const FOLLOWERS_CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vR26NJiJz14xBD0dY69D_RnA9F-JNtxqRDnQfUEKfnJVZtpPZHGfNH5Xj3mKIlz-s7lATp3gEk_WYDo/pub?gid=398055717&single=true&output=csv';

/**
 * The editable sheet behind that CSV. The page is read-only by design, so the
 * app bar carries a way back to the place where the data is actually changed.
 */
export const SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1L4t2KJTiqGpbkXegZUmaJEfNhB4_jT_3QpH9kSpQmA0/edit?usp=sharing';

export const STORAGE_KEY = 'fmcal.v1';

/** How often the page re-reads the sheet on its own. */
export const AUTO_REFRESH_MS = 60 * 1000;

/**
 * Minimum time the full-page loader stays up. A spinner that appears and
 * vanishes within a frame or two reads as a flicker, not as loading.
 */
export const LOADER_MIN_MS = 1000;

/**
 * How long a dismissed notification stays down before it raises itself again.
 * Dismissing is "not now", not "never" - a past-due posting does not stop
 * being past due because someone closed a box.
 */
export const ALERT_SNOOZE_MS = 10 * 60 * 1000;

/**
 * How far ahead the "coming up" notification looks, in days beyond today.
 * One means today and tomorrow - near enough that there is still something to
 * be done about it, rather than a list of everything vaguely ahead.
 */
export const UPCOMING_WINDOW_DAYS = 1;

export const MONTHS = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday',
  'Friday', 'Saturday'];
export const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ---------------------------------------------------------------------------
   Column resolution. Headers are matched by NORMALISED name (lowercased, all
   non-alphanumerics stripped) so the team can rename or reorder sheet columns
   without breaking the page. First alias that resolves wins.
   ------------------------------------------------------------------------- */
export const HEADER_ALIASES = {
  date:     ['postingdate', 'date', 'postdate'],
  time:     ['postingtime', 'time', 'posttime'],
  deadline: ['approvaldeadline', 'deadline'],
  brand:    ['brand', 'account'],
  platform: ['platform', 'channel'],
  type:     ['typeofpost', 'posttype', 'type'],
  desc:     ['descriptionofthisposting', 'description'],
  owner:    ['owner', 'assignee'],
  status:   ['status'],
  files:    ['files', 'file', 'asset', 'assets'],
  caption:  ['copywritingcaption', 'caption', 'copywriting', 'copy'],
  link:     ['postlink', 'livelink', 'link'],
  notes:    ['notescomments', 'notes', 'comments', 'remarks'],
  filesUrl: ['fileschipurl', 'fileschip', 'fileurl', 'fileslink', 'assetlink'],
  // Every file inside the folder that filesUrl points at, written into the
  // sheet by an Apps Script. This is what lets the page show the real creative:
  // a folder link on its own is not something a browser can look inside.
  driveList: ['drivefolderfilelist', 'folderfilelist', 'filelist', 'drivefiles'],
};

/** Columns without which the page cannot render anything meaningful. */
export const REQUIRED_COLUMNS = ['date', 'brand'];

/* ---------------------------------------------------------------------------
   Brands. FUNaloMAX Studios has no rows in the sheet yet, but its avatar is on
   disk, so it is wired now and will light up the moment a row uses it.
   ------------------------------------------------------------------------- */
export const BRAND_META = {
  'funalomax': {
    label: 'FUNalo MAX',
    handle: 'FUNaloMAX',
    avatar: 'img/profile_funalomax.png',
    hue: 'var(--brand-funalomax)',
  },
  'funalomax-studios': {
    label: 'FUNalo MAX Studios',
    handle: 'funalomaxstudio',
    avatar: 'img/profile_funalomax_studios.jpg',
    hue: 'var(--brand-funalomax-studios)',
  },
  'solaire-online': {
    label: 'Solaire Online',
    handle: 'SolaireOnline',
    avatar: 'img/profile_solaire_online.jpg',
    hue: 'var(--brand-solaire-online)',
  },
};

export const BRAND_FALLBACK = {
  label: 'Unassigned',
  handle: 'unknown',
  avatar: null,
  hue: 'var(--brand-unknown)',
};

/** Sheet spellings that collapse onto a canonical brand key. */
export const BRAND_ALIASES = {
  'funalomax': 'funalomax',
  'funalo-max': 'funalomax',
  'fam': 'funalomax',
  'funalomax-studios': 'funalomax-studios',
  'funalo-max-studios': 'funalomax-studios',
  'funalomaxstudios': 'funalomax-studios',
  'solaire-online': 'solaire-online',
  'solaire': 'solaire-online',
};

/* ---------------------------------------------------------------------------
   Platforms. `mock` names the Layout-mode renderer in js/mocks.js; null means
   this platform has none and is always drawn as a simple card. That one field
   is the whole decision - there is no special case for it anywhere else.
   ------------------------------------------------------------------------- */
export const PLATFORM_META = {
  facebook:  { label: 'Facebook',  icon: 'img/fb.png',       hue: 'var(--pf-facebook)',  mock: 'fb' },
  instagram: { label: 'Instagram', icon: 'img/ig.png',       hue: 'var(--pf-instagram)', mock: 'ig' },
  x:         { label: 'X',         icon: 'img/x.png',        hue: 'var(--pf-x)',         mock: 'x'  },
  tiktok:    { label: 'TikTok',    icon: 'img/tiktok.png',   hue: 'var(--pf-tiktok)',    mock: 'tt' },
  youtube:   { label: 'YouTube',   icon: 'img/yt.png',       hue: 'var(--pf-youtube)',   mock: 'yt' },
  linkedin:  { label: 'LinkedIn',  icon: 'img/linkedin.png', hue: 'var(--pf-linkedin)',  mock: 'li' },
};

export const PLATFORM_FALLBACK = {
  label: 'Unspecified', icon: null, hue: 'var(--pf-unspecified)', mock: null, unset: true,
};

export const PLATFORM_ALIASES = {
  facebook: 'facebook', fb: 'facebook', meta: 'facebook',
  instagram: 'instagram', ig: 'instagram', insta: 'instagram',
  x: 'x', twitter: 'x', xtwitter: 'x',
  tiktok: 'tiktok', tt: 'tiktok',
  youtube: 'youtube', yt: 'youtube', youtubeshorts: 'youtube',
  linkedin: 'linkedin', li: 'linkedin',
};

/** Display order wherever platforms are listed. */
export const PLATFORM_ORDER =
  ['facebook', 'instagram', 'x', 'tiktok', 'youtube', 'linkedin', 'unspecified'];

/* ---------------------------------------------------------------------------
   Types of post. `media` picks the placeholder renderer in render-post.js.
   ------------------------------------------------------------------------- */
export const TYPE_META = {
  static:  { label: 'Static Post',      media: 'single' },
  reels:   { label: 'Reels/Shorts',     media: 'reels' },
  dynamic: { label: 'Dynamic/Moving',   media: 'dynamic' },
  album:   { label: 'Album/Carousels',  media: 'album' },
  ugc:     { label: 'KOL/UGC Shares',   media: 'ugc' },
  story:   { label: 'Story',            media: 'story' },
  text:    { label: 'Text Only',        media: 'none' },
  link:    { label: 'Link Share',       media: 'link' },
};

export const TYPE_FALLBACK = { label: 'Unspecified', media: 'single', unset: true };

export const TYPE_ALIASES = {
  staticpost: 'static', static: 'static', statispost: 'static',
  image: 'static', photo: 'static', singleimage: 'static', poster: 'static',

  reelsshorts: 'reels', reels: 'reels', reel: 'reels',
  shorts: 'reels', short: 'reels', video: 'reels',

  dynamicmoving: 'dynamic', dynamic: 'dynamic', moving: 'dynamic',
  gif: 'dynamic', animated: 'dynamic', motion: 'dynamic',

  albumcarousels: 'album', albumcarousel: 'album', album: 'album',
  carousel: 'album', carousels: 'album', multipleimages: 'album', gallery: 'album',

  kolugcshares: 'ugc', kolugc: 'ugc', ugc: 'ugc', kol: 'ugc',
  ugcshare: 'ugc', ugcshares: 'ugc', influencer: 'ugc',

  story: 'story', stories: 'story',
  textonly: 'text', text: 'text', copyonly: 'text',
  link: 'link', linkshare: 'link',
};

export const TYPE_ORDER = [
  'static', 'reels', 'album', 'dynamic', 'story', 'ugc',
  'text', 'link', 'unspecified',
];

/** File extensions used to infer a media kind when Type of Post is blank. */
export const EXT_HINTS = {
  gif: 'dynamic',
  mp4: 'reels', mov: 'reels', webm: 'reels', avi: 'reels',
  jpg: 'static', jpeg: 'static', png: 'static', webp: 'static',
};

/* --------------------------------- status --------------------------------- */

/* Ordered the way work actually moves through the pipeline, which is also the
   order they appear in the filter bar and the Stats donut. */
export const STATUS_META = {
  'needs-action':        { label: 'Needs Action',        hue: 'var(--st-needs)' },
  'for-revision':        { label: 'For Revision',        hue: 'var(--st-revision)' },
  'for-client-approval': { label: 'For Client Approval', hue: 'var(--st-approval)' },
  'approved':            { label: 'Approved',            hue: 'var(--st-approved)' },
  'scheduled':           { label: 'Scheduled',           hue: 'var(--st-scheduled)' },
  'posted':              { label: 'Posted',              hue: 'var(--st-posted)', done: true },
  'rescheduled':         { label: 'Rescheduled',         hue: 'var(--st-resched)' },
};

export const STATUS_FALLBACK = { label: 'Unspecified', hue: 'var(--st-unknown)', unset: true };

export const STATUS_ORDER = [
  'needs-action', 'for-revision', 'for-client-approval', 'approved',
  'scheduled', 'posted', 'rescheduled', 'unspecified',
];

export const STATUS_ALIASES = {
  needsaction: 'needs-action', needaction: 'needs-action',
  todo: 'needs-action', pending: 'needs-action',

  forrevision: 'for-revision', revision: 'for-revision',
  revise: 'for-revision', forrevisions: 'for-revision',

  forclientapproval: 'for-client-approval', clientapproval: 'for-client-approval',
  forapproval: 'for-client-approval', approval: 'for-client-approval',
  review: 'for-client-approval', forreview: 'for-client-approval',

  approved: 'approved', clientapproved: 'approved', ok: 'approved',

  scheduled: 'scheduled', queued: 'scheduled',

  posted: 'posted', published: 'posted', live: 'posted', done: 'posted',

  rescheduled: 'rescheduled', reschedule: 'rescheduled', moved: 'rescheduled',
};

/** Statuses that mean the creative is signed off and no longer needs work. */
export const STATUS_SETTLED = ['approved', 'scheduled', 'posted'];

/* ------------------------------ mock assets ------------------------------- */

/** Full-colour reaction emoji. NEVER apply a CSS filter to these. */
export const FB_REACTS = [
  'img/fb_react_like.png',
  'img/fb_react_love.png',
  'img/fb_react_laugh.png',
  'img/fb_react_wow.png',
  'img/fb_react_hug.png',
  'img/fb_react_cry.png',
  'img/fb_react_angry.png',
];

/** Black-on-transparent glyphs, used as CSS masks so they take currentColor. */
export const GLYPHS = {
  clip:      'img/clip_black.png',

  fbLike:    'img/fb_like_black.png',
  fbComment: 'img/fb_comment_black.png',
  fbShare:   'img/fb_share_black.png',

  igLike:     'img/ig_like_black.png',
  igComment:  'img/ig_comment_black.png',
  igRepost:   'img/ig_repost_black.png',
  igShare:    'img/ig_share_black.png',
  igBookmark: 'img/ig_bookmark_black.png',
  igBurger:   'img/ig_hamburger_black.png',

  xComment:  'img/x_comment_black.png',
  xRepost:   'img/x_repost_black.png',
  xLike:     'img/x_like_black.png',
  xViews:    'img/x_views_black.png',
  xBookmark: 'img/x_bookmark_black.png',
  xShare:    'img/x_share_black.png',

  ttLike:     'img/tiktok_like_black.png',
  ttComment:  'img/tiktok_comment_black.png',
  ttBookmark: 'img/tiktok_bookmark_black.png',
  ttShare:    'img/tiktok_share_black.png',
  ttHome:     'img/tiktok_menu_home_black.png',
  ttShop:     'img/tiktok_menu_shop_black.png',
  ttInbox:    'img/tiktok_menu_inbox.png',
  ttProfile:  'img/tiktok_menu_profile.png',

  ytLike:    'img/yt_like_black.png',
  ytComment: 'img/yt_comment_black.png',
  ytSave:    'img/yt_save_black.png',
  ytShare:   'img/yt_share_black.png',
  ytRemix:   'img/yt_remix_black.png',
  ytHome:    'img/yt_menu_home_black.png',
  ytShorts:  'img/yt_menu_shorts_black.png',
  ytSubs:    'img/yt_menu_subscriptions_black.png',

  liLike:    'img/linkedin_like_black.png',
  liComment: 'img/linkedin_comment_black.png',
  liRepost:  'img/linkedin_repost_black.png',
  liShare:   'img/linkedin_share_black.png',
};

/**
 * TikTok chrome that is NOT a stencil.
 *
 * Everything in GLYPHS is black ink on transparency, which is what lets it be
 * used as a CSS mask and take its colour from the page. These two are the real
 * artwork - the follow button is TikTok red with a white cross, the create
 * button carries its cyan and red fringes - and they are almost fully opaque.
 * Run through the mask primitive they come out as solid blocks, so they are
 * drawn as ordinary images instead. Do not move them into GLYPHS.
 */
export const TT_ART = {
  plus:   'img/tiktok_red_plus.png',
  upload: 'img/tiktok_menu_upload.png',
};

/**
 * LinkedIn's own six reactions, in its own order: Like, Celebrate, Support,
 * Love, Insightful, Funny. Full-colour artwork like FB_REACTS, so they are
 * drawn as images rather than tinted.
 */
export const LI_REACTS = [
  'img/linkedin_react_like.png',
  'img/linkedin_react_clap.png',
  'img/linkedin_react_give.png',
  'img/linkedin_react_heart.png',
  'img/linkedin_react_idea.png',
  'img/linkedin_react_laugh.png',
];

export const PLAY_BADGE = 'img/fb_play.png';

/** Tile count for an album/carousel when the sheet does not say otherwise. */
export const CAROUSEL_DEFAULT = 4;

/* ---------------------------------------------------------------------------
   Real creative, out of Google Drive.

   A Drive share link serves an HTML page, not an image, so the id is pulled
   out of it and handed to the thumbnail endpoint instead. `sz` is a request
   rather than a cap: Drive returns up to the asset's own resolution, so a
   1080x1920 reel comes back at 1080x1920.

   This endpoint is NOT documented or supported, and Google has changed it
   before. Everything that uses it therefore keeps the CSS placeholder
   underneath and falls back to it when an image does not arrive - see the
   delegated error handler in main.js. A broken frame in front of a client is
   worse than a placeholder.
   ------------------------------------------------------------------------- */
export const DRIVE_IMG = (id, w = 1200) =>
  `https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w${w}`;

/** How many real images a single post will draw before it stops. */
export const MAX_DRIVE_IMAGES = 10;
