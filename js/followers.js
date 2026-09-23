/* ============================================================================
   followers.js — the weekly follower count, from the workbook's second tab.

   ---------------------------------------------------------------------------
   THE SHEET

   One row per account per week, laid out as two blocks side by side:

     Date | Account | Facebook Instagram X Tiktok Youtube LinkedIn | | Account | <the same six, as profile URLs>

   The right-hand block is a static directory - the same URL every week - so it
   is read once and kept per account, not per reading.

   ---------------------------------------------------------------------------
   THE THING TO KNOW BEFORE EDITING

   The whole schedule is pre-created. Every week from the first reading to next
   March already exists as rows with empty cells, waiting to be filled in. A
   blank row is therefore a week nobody has collected yet - NOT a week in which
   every account lost all of its followers.

   So a row counts as a reading only when it actually carries a number, and an
   empty platform cell is `null` rather than 0: "not measured" and "nobody is
   following" are different facts, and averaging or differencing them as if
   they were the same would invent a collapse that never happened.

   ---------------------------------------------------------------------------
   ACCOUNTS vs BRANDS

   The tracker plans work per BRAND; this sheet counts followers per ACCOUNT,
   and the two do not line up one-to-one. "FUNalo MAX (Backup)" is a second
   Facebook page for the FUNalo MAX brand and has no brand of its own.

   Where a brand owns several accounts, its figure per platform is the HIGHER
   of them - the parenthetical is a backup, so the live page is whichever one
   is actually carrying the audience. Summing them instead would double-count
   the same brand's reach on the same platform.
   ========================================================================== */

import { FOLLOWERS_CSV_URL, PLATFORM_ORDER, MONTH_ABBR } from './config.js';
import { parseCSV } from './csv.js';
import { parseAnyDate, dateKeyOf, fmtShortDate } from './dates.js';
import { normKey } from './utils.js';
import { brandKeyOf, platformKeyOf, brandMeta } from './data.js';

/* --------------------------------- cells ---------------------------------- */

/**
 * "5,400" -> 5400. An empty cell is null, not 0 - see the header.
 * Anything that is not a plain number (a note, a dash, "n/a") is also null:
 * a figure nobody can read is a figure we do not have.
 */
function count(cell) {
  const t = String(cell ?? '').replace(/[,\s]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const url = (cell) => {
  const t = String(cell ?? '').trim();
  return /^https?:\/\//i.test(t) ? t : '';
};

/**
 * An account name to a brand key.
 *
 * "FUNalo MAX (Backup)" is the FUNalo MAX brand, so a trailing parenthetical
 * is dropped before the usual alias lookup rather than being special-cased by
 * name - the next backup or regional account then resolves on its own.
 */
const brandOfAccount = (name) =>
  brandKeyOf(String(name ?? '').replace(/\s*\([^)]*\)\s*$/, '').trim()) || '';

/* -------------------------------- columns --------------------------------- */

/**
 * Work out which column is which from the header row.
 *
 * Read by header name rather than by index so the team can add a platform,
 * reorder the six, or move the link block without breaking this. The two
 * `Account` columns are told apart by position: the first opens the readings,
 * the second opens the directory.
 */
function readHeader(head) {
  const cols = { date: -1, account: -1, counts: [], linkAccount: -1, links: [] };
  head.forEach((raw, i) => {
    const k = normKey(raw);
    if (!k) return;
    if (k === 'date' && cols.date === -1) { cols.date = i; return; }
    if (k === 'account') {
      if (cols.account === -1) cols.account = i;
      else if (cols.linkAccount === -1) cols.linkAccount = i;
      return;
    }
    const pk = platformKeyOf(raw);
    if (!pk) return;
    // Everything before the second Account block is a count; everything after
    // it is that platform's profile URL.
    if (cols.linkAccount === -1) cols.counts.push([i, pk]);
    else cols.links.push([i, pk]);
  });
  return cols;
}

/* --------------------------------- parse ---------------------------------- */

/**
 * @returns {{
 *   weeks: {key:string,label:string,short:string,by:Map<string,{byPlatform:Map<string,number>,total:number}>}[],
 *   accounts: {name:string,brandKey:string,links:Map<string,string>}[],
 *   brands: Map<string,{name:string,accounts:string[]}>,
 * }}
 */
function normalise(rows) {
  if (!rows.length) return empty();
  const cols = readHeader(rows[0]);
  if (cols.date === -1 || cols.account === -1 || !cols.counts.length) return empty();

  const links = new Map();          // account -> Map<platformKey, url>
  const order = [];                 // accounts, in the order the sheet lists them
  const weeks = new Map();          // dateKey -> Map<account, {byPlatform, total}>

  for (const row of rows.slice(1)) {
    // The directory block is static, so it is harvested from whichever rows
    // happen to carry it rather than only from the first.
    const linkName = (row[cols.linkAccount] ?? '').trim();
    if (linkName) {
      const m = links.get(linkName) || new Map();
      for (const [i, pk] of cols.links) { const u = url(row[i]); if (u) m.set(pk, u); }
      if (m.size) links.set(linkName, m);
    }

    const name = (row[cols.account] ?? '').trim();
    const parts = parseAnyDate(row[cols.date]);
    if (!name || !parts) continue;
    if (!order.includes(name)) order.push(name);

    const byPlatform = new Map();
    let total = 0;
    for (const [i, pk] of cols.counts) {
      const n = count(row[i]);
      if (n === null) continue;
      byPlatform.set(pk, n);
      total += n;
    }
    // A pre-created week nobody has filled in yet. Not a reading.
    if (!byPlatform.size) continue;

    const key = dateKeyOf(parts);
    if (!weeks.has(key)) {
      // `label` names the reading in prose; `short` is for an axis tick, where
      // four dates' worth of ", 2026" would collide into unreadable mush.
      weeks.set(key, {
        label: fmtShortDate(parts),
        short: `${MONTH_ABBR[parts.mo]} ${parts.d}`,
        by: new Map(),
      });
    }
    weeks.get(key).by.set(name, { byPlatform, total });
  }

  /*
   * `idx` is the account's position in the sheet and `nth` its position among
   * its own brand's accounts.
   *
   * `idx` picks the marker shape on the follower chart, where colour is
   * already spoken for by the platform - so every line belonging to one
   * account carries the same marker whichever channel it is. `nth` is what
   * tells a brand's main page from its backup.
   */
  const seen = new Map();
  const accounts = order.map((name, idx) => {
    const brandKey = brandOfAccount(name);
    const nth = brandKey ? (seen.get(brandKey) || 0) : 0;
    if (brandKey) seen.set(brandKey, nth + 1);
    return { name, brandKey, nth, idx, links: links.get(name) || new Map() };
  });

  // Which accounts each brand owns, so a brand tile can say so on hover.
  const brands = new Map();
  for (const a of accounts) {
    if (!a.brandKey) continue;
    if (!brands.has(a.brandKey)) {
      brands.set(a.brandKey, { name: brandMeta(a.brandKey).label, accounts: [] });
    }
    brands.get(a.brandKey).accounts.push(a.name);
  }

  const ordered = Array.from(weeks.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, w]) => ({ key, label: w.label, short: w.short, by: w.by }));

  return { weeks: ordered, accounts, brands };
}

const empty = () => ({ weeks: [], accounts: [], brands: new Map() });

/**
 * Fetch and normalise. Never throws: the follower sheet is a supporting
 * dataset, and a page that refused to show a month of planned posts because a
 * second tab was unreachable would be trading the important thing for the
 * incidental one. A failure yields no weeks, and every consumer treats that
 * as "not collected yet".
 */
export async function loadFollowers({ bust = false } = {}) {
  const src = bust ? `${FOLLOWERS_CSV_URL}&_=${Date.now()}` : FOLLOWERS_CSV_URL;
  try {
    const res = await fetch(src, { cache: 'no-store', credentials: 'omit' });
    if (!res.ok) return empty();
    return normalise(parseCSV(await res.text()));
  } catch {
    return empty();
  }
}

/* -------------------------------- queries --------------------------------- */

const rank = new Map(PLATFORM_ORDER.map((k, i) => [k, i]));

/**
 * One brand's standing in one week: the higher of its accounts on each
 * platform, and the sum of those. Null when no account of the brand was
 * measured that week.
 */
export function brandStanding(week, brandKey, accounts) {
  const mine = accounts.filter((a) => a.brandKey === brandKey);
  if (!mine.length) return null;

  const byPlatform = new Map();
  const from = new Map();          // platform -> the account that supplied it
  for (const a of mine) {
    const rec = week.by.get(a.name);
    if (!rec) continue;
    for (const [pk, n] of rec.byPlatform) {
      if (!byPlatform.has(pk) || n > byPlatform.get(pk)) {
        byPlatform.set(pk, n);
        from.set(pk, a.name);
      }
    }
  }
  if (!byPlatform.size) return null;

  let total = 0;
  for (const n of byPlatform.values()) total += n;
  return {
    total,
    byPlatform: new Map([...byPlatform].sort((a, b) => (rank.get(a[0]) ?? 99) - (rank.get(b[0]) ?? 99))),
    from,
  };
}

/**
 * Week-on-week change for one brand.
 *
 * Measured between the last two weeks that actually have a reading for it, so
 * a skipped collection shifts the comparison rather than reporting a drop to
 * zero. `weeks` is how far apart those two readings were, so the caller can
 * say "over 2 weeks" when a week was missed.
 *
 * Returns null on the very first reading - there is nothing to compare with,
 * and a 0 would read as "flat" rather than as "we only know one week".
 */
export function brandGrowth(data, brandKey) {
  if (!data) return null;
  const standings = [];
  for (const w of data.weeks) {
    const s = brandStanding(w, brandKey, data.accounts);
    if (s) standings.push({ week: w, total: s.total, byPlatform: s.byPlatform });
  }
  const now = standings[standings.length - 1];
  if (!now) return null;

  const prev = standings[standings.length - 2];
  if (!prev) return { now: now.total, at: now.week, delta: null, pct: null, since: null };

  const delta = now.total - prev.total;
  return {
    now: now.total,
    at: now.week,
    since: prev.week,
    delta,
    pct: prev.total ? (delta / prev.total) * 100 : null,
  };
}

/**
 * One series per account on ONE platform - the grain the numbers are
 * collected at, and the grain each chart is drawn at.
 *
 * Summing an account across its platforms hides the thing people come to
 * this for: a page can be adding followers on TikTok while losing them on
 * Facebook, and one total line says neither. So each platform gets its own
 * small chart and each account on it gets a line.
 *
 * `accounts` is the visible set for that chart; empty means all, as
 * everywhere else.
 */
export function seriesOn(data, platformKey, accounts = new Set()) {
  if (!data) return [];
  const out = [];
  for (const a of data.accounts) {
    if (accounts.size && !accounts.has(a.name)) continue;
    const points = [];
    data.weeks.forEach((w, i) => {
      const n = w.by.get(a.name)?.byPlatform.get(platformKey);
      if (n !== undefined) points.push({ i, y: n, week: w });
    });
    if (points.length) out.push({ account: a, platformKey, points });
  }
  return out;
}

/**
 * Every account ever counted on one platform, in sheet order.
 *
 * The roster a chart's filter offers, and it comes from every week rather
 * than the latest one: an account that was measured in March and missed in
 * April still belongs to that platform, and dropping it from the filter
 * would be a switch you could turn off but not back on.
 */
export function accountsOn(data, platformKey) {
  const seen = new Set();
  for (const w of data?.weeks || []) {
    for (const [name, rec] of w.by) if (rec.byPlatform.has(platformKey)) seen.add(name);
  }
  return (data?.accounts || []).filter((a) => seen.has(a.name));
}

/** Which platforms anybody has ever been counted on, in display order. */
export function platformsPresent(data) {
  const seen = new Set();
  for (const w of data?.weeks || []) {
    for (const rec of w.by.values()) for (const pk of rec.byPlatform.keys()) seen.add(pk);
  }
  return PLATFORM_ORDER.filter((k) => seen.has(k));
}

