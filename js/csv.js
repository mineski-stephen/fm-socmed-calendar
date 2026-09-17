/* ============================================================================
   csv.js — CSV parsing.

   Hand-written character scanner rather than split(',') or a regex, because
   the Copywriting/Caption column routinely contains commas, embedded newlines
   and quotes. Anything simpler silently shreds half the captions.
   ========================================================================== */

import { normKey } from './utils.js';
import { HEADER_ALIASES } from './config.js';

/**
 * Parse CSV text into an array of string arrays.
 * Handles: RFC-4180 "" escapes, quoted fields containing , and newlines,
 * CRLF / LF / lone CR line endings, and a UTF-8 BOM.
 */
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;

  let src = String(text ?? '');
  if (src.charCodeAt(0) === 0xFEFF) src = src.slice(1);   // strip BOM

  const endField = () => { row.push(field); field = ''; };
  const endRow = () => { endField(); rows.push(row); row = []; };

  while (i < src.length) {
    const c = src[i];

    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; }   // escaped quote
        else { quoted = false; i += 1; }                    // closing quote
      } else if (c === '\r') {
        // Normalise line endings INSIDE the scanner, so multi-line captions
        // come out with clean \n and no stray carriage returns.
        if (src[i + 1] === '\n') i += 1;
        field += '\n';
        i += 1;
      } else {
        field += c;
        i += 1;
      }
      continue;
    }

    if (c === '"') { quoted = true; i += 1; }
    else if (c === ',') { endField(); i += 1; }
    else if (c === '\r') { if (src[i + 1] === '\n') i += 1; endRow(); i += 1; }
    else if (c === '\n') { endRow(); i += 1; }
    else { field += c; i += 1; }
  }

  // Flush whatever is still buffered when the text ends without a newline.
  if (field.length || row.length) endRow();

  // A trailing newline leaves one empty row behind.
  while (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') {
    rows.pop();
  }
  return rows;
}

/**
 * Resolve the sheet's header row into our canonical field names.
 * Matching is by NORMALISED header text, so columns can be renamed or
 * reordered in the sheet without breaking the page. Returns a map of
 * canonical field -> column index; unresolved fields are simply absent.
 */
export function resolveColumns(headerRow) {
  const normalised = headerRow.map(normKey);
  const index = {};

  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    let found = -1;

    // exact match wins
    for (const alias of aliases) {
      const at = normalised.indexOf(alias);
      if (at !== -1) { found = at; break; }
    }
    // then prefix, then substring
    if (found === -1) {
      for (const alias of aliases) {
        const at = normalised.findIndex((h) => h.startsWith(alias));
        if (at !== -1) { found = at; break; }
      }
    }
    if (found === -1) {
      for (const alias of aliases) {
        const at = normalised.findIndex((h) => h.includes(alias));
        if (at !== -1) { found = at; break; }
      }
    }
    if (found !== -1) index[field] = found;
  }
  return index;
}

/* ---------------------------------------------------------------------------
   Finding a column by what is IN it, when its header no longer says.

   HEADER_ALIASES survives a column being renamed to something recognisable or
   moved somewhere else. It cannot survive the header being blanked: Google's
   CSV export then emits a placeholder like "Column 1", which matches no alias,
   and the whole sheet is rejected for a missing required column - which is
   exactly what happened the first time somebody cleared cell A1.

   The dates are still sitting in the column underneath. So when the name is no
   help, look for the column whose VALUES parse, and use that. A column is only
   accepted on a clear majority, so this can never latch onto a stray date in a
   notes field.
   ------------------------------------------------------------------------- */
export function findColumnByValue(rows, test, { min = 0.6, skip = [] } = {}) {
  if (rows.length < 2) return -1;
  const body = rows.slice(1, 60);
  const width = Math.max(...rows.map((r) => r.length));

  let best = -1;
  let bestScore = 0;
  for (let c = 0; c < width; c++) {
    if (skip.includes(c)) continue;
    let filled = 0;
    let hits = 0;
    for (const row of body) {
      const v = (row[c] ?? '').trim();
      if (!v) continue;
      filled += 1;
      if (test(v)) hits += 1;
    }
    if (filled < 3) continue;
    const score = hits / filled;
    if (score >= min && score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

/**
 * Turn data rows into objects keyed by our canonical field names.
 * A column the sheet does not have yields '' rather than throwing, and a row
 * that is entirely empty is dropped.
 */
export function rowsToRecords(rows, columns) {
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row.some((cell) => cell && cell.trim())) continue;

    const rec = { _row: r + 1 };   // +1 so it matches the sheet's own row number
    for (const [field, at] of Object.entries(columns)) {
      rec[field] = (row[at] ?? '').trim();
    }
    out.push(rec);
  }
  return out;
}
