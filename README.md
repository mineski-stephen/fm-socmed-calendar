# FUNalo MAX — Social Media Calendar

A statically-hosted page that reads the team's posting tracker straight from its published
Google Sheet and turns it into three views:

- **Calendar** — a month grid showing, for each day, a chip per platform with a post count,
  grouped by brand.
- **Day view** — a horizontal rail of day columns you drag through, where each post can be
  drawn as a mock-up of the platform it is going out on.
- **Stats** — KPI cards and charts covering brand, platform, format, status, pacing and how
  much of the tracker is still unfilled.

Nothing is ever written back. The Google Sheet stays the single source of truth; this page is
a read-only lens over it.

---

## Quick start

The page **must be served over HTTP**. Opening `index.html` by double-clicking it will not
work (see [Why it cannot run from disk](#why-it-cannot-run-from-disk)).

From the project folder:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>.

Any other static server works just as well:

```bash
npx serve .
```

### Hosting it

The site is plain HTML, CSS and JavaScript with no build step and no dependencies, so it can
be dropped onto any static host as-is:

| Host | How |
|---|---|
| GitHub Pages | Commit the folder, then Settings → Pages → deploy from branch |
| Netlify / Vercel | Drag the folder onto the dashboard; no build command, publish directory `.` |
| Internal web server | Copy the folder into any directory the server already serves |

Everyone who opens the page gets the current contents of the sheet, because the fetch happens
in their browser at load time.

### Why it cannot run from disk

Google's published-CSV endpoint answers with a `307` redirect. That redirect carries CORS
headers only when the request comes from a real web origin:

```
Origin: http://localhost:8000   ->  307 Access-Control-Allow-Origin: http://localhost:8000   works
Origin: https://your-host.com   ->  307 Access-Control-Allow-Origin: https://your-host.com   works
Origin: null   (file://)        ->  307 with no CORS header                                  blocked
```

A page opened from disk has the origin `null`, so the browser blocks the request. Separately,
browsers also refuse to load ES modules over `file://`, so the scripts would not start either.

The page detects this and shows an explanation with the fix rather than a blank screen.

---

## The data

Source: the **published CSV** of the tracker sheet
(`File -> Share -> Publish to web -> Comma-separated values`).

The URL lives in one place, `js/config.js`:

```js
export const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/.../pub?gid=...&output=csv';
```

To point the page at a different sheet or tab, publish that tab and replace this one string.

### Column contract

Columns are matched **by name, not by position**, after normalising the header (lowercased,
punctuation and spaces stripped). Columns can be reordered or renamed within their accepted
aliases without breaking the page. A column that is missing entirely is treated as empty
rather than causing an error.

| Column | Required | Accepted aliases | Notes |
|---|---|---|---|
| Posting Date | **yes** | `date`, `postdate` | `Sep 11, 2026 (Fri)`. The `(Fri)` part is ignored — the date itself is authoritative |
| Posting Time | no | `time`, `posttime` | `12:00:00 AM`. Missing or unreadable means midnight |
| Approval Deadline | no | `deadline` | Same date format |
| Brand | **yes** | `account` | See [Brands](#brands) |
| Platform | no | `channel` | Blank renders as `Unspecified` |
| Type of Post | no | `posttype`, `type` | Blank renders as `Unspecified` |
| Description of this Posting | no | `description` | Currently unused by the sheet |
| Owner | no | `assignee` | Shown as the author of an internal note |
| Status | no | — | See [Statuses](#statuses) |
| Files | no | `file`, `asset`, `assets` | Filename or folder label; printed on the media placeholder |
| Copywriting/Caption | no | `caption`, `copywriting`, `copy` | Multi-line, emoji, hashtags and links all supported |
| Post Link | no | `livelink`, `link` | The live post, once published |
| Notes/Comments | no | `notes`, `comments`, `remarks` | Rendered as an internal note on the post |
| Files Chip URL | no | `fileschip`, `fileurl`, `assetlink` | Google Drive link to the creative |

A row with **no readable Posting Date is skipped** — it cannot be placed on a calendar. Every
other blank is handled gracefully.

### How blanks are treated

Rows missing a Platform or a Type of Post are **never hidden**. They appear everywhere with an
`Unspecified` label, a dashed chip outline and a small `!` marker, and they are filterable like
any other value — so a gap in the tracker is visible to the team instead of quietly vanishing.

Where the Type of Post is blank, the page will additionally guess the *format* from the asset
filename (`.gif` implies an animated post, `.mp4` a video, `.jpg`/`.png` a static image) purely
to pick a sensible placeholder. The chip still reads `Unspecified`, with a "looks like ..."
hint, so the guess never masks the missing value.

---

## Brands, platforms, formats and statuses

All four are defined as lookup tables at the top of `js/config.js`. Sheet values are normalised
(lowercased, punctuation stripped) and matched against an alias list, so `Tiktok`, `TikTok` and
`tiktok` all land on the same entry. **Anything unrecognised still renders** — it simply falls
back to a neutral label rather than being dropped.

### Brands

| Sheet value | Display name | Handle | Avatar |
|---|---|---|---|
| `FUNaloMAX` | FUNalo MAX | `@FUNaloMAX` | `img/profile_funalomax.png` |
| `FUNaloMAX Studios` | FUNalo MAX Studios | `@funalomaxstudio` | `img/profile_funalomax_studios.jpg` |
| `Solaire Online` | Solaire Online | `@SolaireOnline` | `img/profile_solaire_online.jpg` |

FUNalo MAX Studios has no rows in the sheet yet. It is wired up in advance, so it will appear
with the right avatar and handle the first time a row uses it.

**To add a brand:** add an entry to `BRAND_META` (label, handle, avatar path, colour) and, if
the sheet spells it differently, an entry in `BRAND_ALIASES`. Drop the avatar into `img/`.
Nothing else needs to change — the filter bar, calendar chips, mock headers and stats all read
from that one table.

### Platforms

| Sheet value | Rendering in Layout mode | Logo |
|---|---|---|
| `Facebook` | Facebook mock | `img/fb.png` |
| `Instagram` | Instagram mock | `img/ig.png` |
| `X` (or `Twitter`) | X mock | `img/x.png` |
| `Tiktok` | TikTok mock — a phone screen | `img/tiktok.png` |
| `YouTube` | YouTube Shorts mock — a phone screen | `img/yt.png` |
| `LinkedIn` | LinkedIn mock | `img/linkedin.png` |
| *(blank)* | simple card | — |

Whether a platform gets a mock is controlled by one field, `mock`, in `PLATFORM_META`: it
names a renderer in `js/mocks.js`, and `null` means the platform has no mock and falls back to
a simple card. That one lookup is the only place the decision is made — there is no
special-casing anywhere else in the code.

**To add a platform:** add an entry to `PLATFORM_META` with a label, a logo path, a colour and
`mock: null`, plus aliases if needed, and add its key to `PLATFORM_ORDER`. It will immediately
appear in the filters, the calendar chips and the stats. To give it a mock later, write the
module and register it in `js/mocks.js`.

### Types of post

| Sheet value | Placeholder |
|---|---|
| `Static Post` | one image block, sized to the platform (1:1 on Facebook, 4:5 on Instagram) |
| `Reels/Shorts` | full-width block with a play badge, a drifting sheen and a scrub bar |
| `Dynamic/Moving` | animated gradient with a `GIF` badge |
| `Album/Carousels` | four blocks, a 2x2 collage on Facebook and a swipeable carousel on Instagram |
| `KOL/UGC Shares` | a quoted creator card, so it reads as someone else's post being amplified |
| `Story` | 9:16 block with story progress segments |
| `Text Only` | no media |
| `Link Share` | wide link-preview block |

Video formats fill the card width rather than sitting in a narrow 9:16 column with dead space
beside them. The play badge and the motion are what say "this one moves".

### Statuses

Seven, ordered the way work actually moves through the pipeline. That order is what the filter
bar and the Stats donut use.

| Status | Meaning |
|---|---|
| `Needs Action` | nobody has picked it up yet |
| `For Revision` | came back with changes to make |
| `For Client Approval` | with the client, waiting |
| `Approved` | signed off, not yet queued |
| `Scheduled` | queued to publish |
| `Posted` | live |
| `Rescheduled` | moved to another date |

`Approved`, `Scheduled` and `Posted` count together as the **Locked in** KPI: everything that
no longer needs anyone to do anything.

---

## Using the page

### Header

| Control | What it does |
|---|---|
| **Refresh** | Re-reads the sheet without reloading the page. Shortcut: `R`. A red dot on the button shows while a read is in flight |
| **Auto** | Ticked by default; re-reads the sheet every minute. Untick to hold the data still. The choice is remembered |
| **Sheet** | Opens the tracker in a new tab. This page is read-only, so this is the way back to where the data is actually edited |
| **Simple / Layout** | Switches how posts are drawn (see below) |
| **Theme** | Light, match-system, or dark |

The line under the title shows the post count and how long ago the data was fetched.

The sheet address lives in `SHEET_URL` in `js/config.js`, next to the `CSV_URL` it publishes
from - so pointing the page at a different tracker means editing one file.

### Keeping up to date

With **Auto** ticked - it is on by default - the page re-reads the sheet every minute. Two
details make that safe to leave running on a wall display:

- Each poll compares a fingerprint of the raw CSV against the last one. When nothing in the
  sheet has changed, the page touches no DOM at all; it only bumps the "synced" clock. It
  never redraws itself under someone who is reading.
- Polling pauses while the tab is in the background and catches up the moment you return.

Untick **Auto** and the page holds whatever it last loaded until you ask for more. Ticking it
again fetches straight away if the data has gone stale.

A **red dot** on the Refresh button shows whenever a read is actually in flight, the silent
minute poll included, so there is always a visible sign that the page is talking to Google.

The **Refresh** button (or `R`) does the same thing on demand and tells you what it found.
Either way the request carries a cache-busting parameter: `no-store` alone only bypasses the
*browser* cache, while Google's own edge keeps serving a cached copy for several minutes.

Everything you were looking at survives a refresh - active filters, collapsed posts, the
month, the selected day and the rail's scroll position. If a refresh fails, the data on screen
stays put; a manual one says so, an automatic one stays quiet, because the next attempt is a
minute away.

### Notifications

Two notices share the bottom-right corner, stacked with past due above coming up, because a
missed deadline outranks an approaching one. Both stay put while open and bounce every few
seconds to keep catching the eye; hovering stops the movement so neither is moving as you
reach for it. Passing toasts queue above them rather than landing on top.

**Dismissing either is "not now", not "never".** A notice comes back when:

- its count goes **up** - acknowledging today's backlog does not also silence tomorrow's;
- a refresh brings **changed** data, because whatever was dismissed was dismissed about a
  different set of postings; or
- **ten minutes** go by. Work that is still past due ten minutes later is still past due, and
  a box that stayed shut for the rest of the session would quietly turn a real backlog into
  nobody's problem. The window is `ALERT_SNOOZE_MS` in `js/config.js`.

A refresh that finds the sheet **unchanged** deliberately does not re-raise anything. Nothing
about the situation changed, and with a poll every minute a notice that returned each time
would just train people to close it without reading it.

#### Coming up

A posting due **today, tomorrow or the day after** that is not yet marked `Posted` is
*coming up*. The notice names how many there are, which brands, and when the soonest one is
due; **Review them** clears the other filters and opens the day the soonest one sits on.

The window is keyed on the **date**, not on the exact timestamp. Every row in this tracker
carries `12:00:00 AM`, so a timestamp window would count today's posts as already in the past
one minute after midnight and never warn anybody about them. The day is the unit the team
plans in, so the day is the unit the warning uses. Change `UPCOMING_WINDOW_DAYS` in
`js/config.js` to look further ahead.

Anything already past its date belongs to the past-due notice instead, so the two never
describe the same posting.

#### Past due

A posting whose date has gone by while it is still not marked `Posted` is **past due**, and
the page goes out of its way to make that hard to miss:

| Where | What you see |
|---|---|
| A notification, bottom right | `5 posts past due`, the brands involved, how old the oldest is, and a **Review them** button |
| The filter bar | A red **Past due** lens; click it to narrow to just those |
| Calendar | The day is tinted red with a red edge, and its count gains a `!` |
| Day view | The strip is outlined red and its header reads `1 past due` |
| The day ruler | That day's number and dot turn red, so the backlog is findable by scrubbing |
| Each post | A red `Past due` badge, right beside the status pill it contradicts |
| Stats | A **Past due** KPI |

**Review them** does more than apply a filter: it clears the other filters, switches to the
day view and opens the month containing the *oldest* one, so the button lands somewhere
useful rather than filtering whatever month happened to be on screen.

Two decisions worth knowing:

- **Today is never past due.** The day is not over yet; the cutoff is strictly *before* today.
- **`Rescheduled` counts as past due.** The row still carries the date that went by, and
  something was meant to go out on it - the note usually says where it moved to. If you would
  rather treat a rescheduled row as handled, exclude it in `isOverdue` in `js/selectors.js`.

### Filters

Four dropdowns - Brand, Platform, Status, Type - built from the values actually present in the
data, each showing its own counts. They are multi-select, and the menu stays open while you
pick so choosing three platforms does not mean opening it three times. The button reports what
is selected, so the bar still reads at a glance when everything is closed.

They were a wall of chips before. With four facets and a dozen values each that pushed the
calendar most of a screen down; as dropdowns the whole bar is one row.

Filters apply to **all three views at once**, including the Stats numbers. Click outside or
press `Escape` to close a menu. On narrow screens the whole bar collapses behind a **Filters**
button with a badge showing how many are active.

### Simple view vs Layout view

- **Simple** lists each day's posts as compact rows grouped by brand: platform, status, format,
  caption, asset links and any note. Best for scanning and for checking what still needs work.
- **Layout** draws each post as a mock-up of the platform it is going out on, so you can see
  roughly how it will read once it ships. All six platforms have one; a row with no platform
  set stays a simple card.

### While it loads, and when nothing matches

The **loading screen** fans the three brand marks out from a single point in the middle, then
settles them into a slow bob. They are written straight into `index.html` rather than built
from `BRAND_META`, because the loader has to be on screen before a single module has parsed —
covering that gap is the whole point of it. It holds for a minimum of `LOADER_MIN_MS`; a
spinner that appears and vanishes inside two frames reads as a glitch, not as loading.

When the filters exclude everything — or a month is simply empty — the notice is **one row**,
not a panel. A blank month is not an error and there is nothing to read about it; the old
block ran to about 175px of mostly empty space, and in the day view that came straight off the
strips, which are sized from wherever the rail ends up sitting. The button now says what the
sentence used to.

### Deep links

The address bar tracks the current view, month, selected day and filters, so a particular day
or a filtered slice can be pasted to a colleague:

```
index.html#v=day&m=2026-09&d=2026-09-18&b=funalomax&p=instagram
```

---

## The views in detail

### Calendar

A month grid running Sunday to Saturday, with the date in the corner of each cell and today
circled. The page opens on the first month that actually contains posts rather than the real
current month, which would often be empty.

Each cell groups its posts **by brand** — a coloured bar and the brand name — and within each
brand shows **one chip per platform with a count**, so `f 2` under FUNalo MAX means two
Facebook posts that day for that brand. Clicking a day switches to the Day view scrolled to it.

On narrow screens the brand names are dropped and only the coloured bars remain; the legend
under the grid maps colours to brands.

**Busy days do not stretch the month.** The chip area of a cell is capped, and anything that
does not fit is summarised as **+N more**. Left uncapped, one heavy day stretches its cell
*and every other cell in that week* - a day with three brands across six platforms took the
grid from 822px to 979px on its own, and a month with a few of those stops being scannable.
Nothing is hidden for good: the count in the corner is always the true total, and clicking
the day opens all of it. The cap is a CSS variable (`--cell-chips-max`) if you want a
different balance, and it is already lower on phones, where a cell is only about 55px wide.

### Day view

A horizontal rail with **one column per day of the month, including empty days** — so a gap in
the schedule is as visible as a busy stretch. Each column fills the height of the window and
scrolls its own posts vertically, at full size; posts are never squeezed to fit.

Ways to move through the days:

| Input | Result |
|---|---|
| **The day ruler above the rail** | Click a date to go to it, or drag across to scrub through the month |
| **Any other day column** | Click anywhere on it to bring it to the middle |
| Drag a strip sideways | Free scroll, with a flick landing on a day |
| Left / Right arrow | One day |
| PageUp / PageDown | One week |
| Home / End | First / last day of the month |
| The arrow buttons | One day |

**The selected day sits in the middle of the rail**, not at the left edge, so you always see
the days either side of whatever you are looking at. The rail carries half a screen of padding
at each end, which is what lets the 1st and the 30th reach the middle too rather than clamping
against the edges.

**Strip width is derived from the window, not fixed.** The day view takes the full window
width, and the rail divides it into a whole number of columns, so every strip on screen is a
*whole* strip. A fixed width leaves the leftover pixels as a sliced-off sliver at each edge -
the centred day fits, and its neighbours get cut by however many pixels do not divide evenly.

The count is forced **odd**, because the active day is centred: with an even count, centring
one column necessarily splits the two at the ends in half, which is the very thing this
avoids. On a 1600px window that works out to three columns of about 520px each, and the two
either side of the middle end exactly at the rail's edges.

Columns stay between 360px and 680px wide. The lower bound is where a mock stops being
readable; the upper is where the posts just get airier rather than clearer. Below about
1150px only one column fits, and it keeps a gutter either side.

Resizing the window re-fits the columns and re-centres the selected day - every strip moved,
so the offset that had it in the middle a moment ago would leave it half off the edge.

Neighbouring strips are **darkened** so the day you are on reads as the subject and the ones
beside it as context. That is a wash painted over them, not reduced opacity: fading a card only
moves it towards whatever is behind it, which on the light theme makes the inactive strips
*lighter* and the active one the heaviest thing on screen — the opposite of what is wanted. The
wash is lighter on the light theme, because the same strength over white goes grey very fast.
It is click-through, so a dimmed neighbour is still perfectly usable.

### The day ruler

A slot per day of the month, with a box that tracks whichever day the rail is centred on:

- **A dot** under a number means that day has posts — so the ruler doubles as a map of where
  the work sits, and empty stretches are obvious at a glance.
- **Weekends** are tinted, and today's date is underlined.
- **Click** a date to glide to it; **drag** across the ruler to scrub through the month. A
  press that has not moved still counts as a click, so a click never turns into an accidental
  scrub.
- **Clicking several dates quickly** re-targets rather than queueing: you land on the last one
  you clicked, and the rail glides faster while you are still clicking rather than playing the
  full easing curve for every date you passed through.
- Every date is a real button, so Tab reaches them and Enter lands on that day.

It replaces a proportional scrollbar because at this scale the days themselves are the useful
landmarks: you scrub to "the 18th", not to "62% of the way along".

**The mouse wheel does not move the rail.** It does only what the browser does with it: scroll
the posts in the day you are on, or the page. Scrolling down a long day and moving between
days were fighting each other, so crossing the month is the ruler's job. A genuine horizontal
trackpad gesture still scrolls the rail, because the rail is a real `overflow-x` scroller.

**A day you are not on takes no input except "bring me here."** Its contents are marked
`inert`, so nothing inside answers a click, a hover, a drag-select or the Tab key: you cannot
copy a caption, open a link, collapse a post or filter by platform on a column that is only
half on screen. A click anywhere on it moves the rail to that day instead — one target from
edge to edge.

The strip element itself stays live, which is what receives that click. The `inert` goes on its
header and body rather than on the strip, so the strip keeps its `role="option"` and
`aria-selected`: marking the whole thing inert would leave the rail's listbox reporting a single
day to a screen reader.

**Only the day you are on scrolls its own posts.** The wheel acts on whatever is under the
cursor, and the strips either side are half under it — so scrolling a busy day used to drag a
neighbour along too, or scroll the wrong day entirely when the pointer drifted.

A wheel over a neighbour is **not swallowed**, though: with nothing to scroll there the browser
hands it to the page, the way the gesture behaves anywhere else on screen. Note the day view is
sized to fit the window on purpose, so the page itself has only a few dozen pixels of travel —
the wheel is no longer dead, but there is not much for it to move either.

### Reading one platform at a time

The per-platform chips in a day's header are buttons, on the day you are on. **Clicking one
narrows that strip to that platform** - a day carrying a Facebook post, an Instagram crosspost and two TikToks can
be read one channel at a time. Click the same chip again, or the **show all** link, to clear
it.

It filters the *placements*, not the rows, so a crosspost shows just the one placement you are
looking at rather than disappearing or dragging its other platform along with it.

The selection is deliberately **local and temporary**: it belongs to the day you are reading,
and it clears the moment the rail settles on a different day. Carrying it along would quietly
hide posts on days nobody ever filtered. Use the filter bar for anything that should apply
across the month.

A day with only one platform on it leaves its chip as a plain label - there is nothing to
narrow to.

### Collapsing a post

**Clicking a post's header collapses it** - the mock or card body folds away and the chevron
turns, leaving the header and any internal note visible. It is the quick way to flatten a busy
day of tall mocks into a scannable list without losing the one thing you probably still want
to read. Click again to reopen. Collapsed posts stay collapsed across filtering and refreshes.

The note deliberately sits outside the collapsible body; collapsing hides the creative, not
the instruction attached to it.

### Examining a post up close

Both of these black out the page and show the post at full size, whatever the Simple/Layout
toggle is set to - a mock is the point when you are inspecting one.

- The **expand button on a post header** opens that post on its own.
- The **expand button on a day's header** opens every post for that day as a carousel, so you
  can step through the day's output without closing and reopening.

**The whole post always fits the window.** Nothing scrolls in this view: if a post is taller
than the space it has, the entire thing is scaled down until it fits. An overlay opened to
examine a post that then makes you scroll to see the bottom of it is not doing its job.

The scale is measured per post, not guessed once. A Facebook static post, a 9:16 reel and a
simple card for a platform with no mock are wildly different heights, and one hardcoded factor
would either crop the tall ones or shrink the short ones for nothing. Anything that already
fits is left alone rather than being blown up into a blurry poster.

**It is laid out exactly like the day rail**, for the same reasons. Every post sits side by
side in one track, the ones either side stay on screen rather than being clipped away, and the
track slides. You can see what is coming, and moving reads as one continuous strip rather than
as a page swap. They are all built when the overlay opens, so the next post is already drawn
before you ask for it.

The posts either side are **darkened** with the same wash the day strips use, so the one you
are reading is the bright one. The wash sits on the card itself, not on its column — a column
is full height, so scrimming that painted a dark band from the top of a neighbour all the way
down the page, past the bottom of the post it was meant to be dimming.

| Input | Result |
|---|---|
| **Scrolling** | One post. There is nothing to scroll inside a post, so the wheel has one job here |
| **Clicking a post beside it** | Brings that one over |
| The **arrows at the edges** | One post |
| Left / Right arrow | One post |
| `Escape`, the ×, or clicking any empty space | Close |

A click is measured against the **cards**, not against the full-height columns they sit in.
Clicking a card always moves to it and never dismisses — so walking along the carousel by
clicking the same spot cannot close the overlay by accident — and everything that is not a
card is backdrop.

Moving on has to be **earned** - 120px of wheel travel, then a short cooldown. Acting on the
first event would turn one trackpad flick into five posts, because momentum keeps delivering
events long after the fingers have left.

In a carousel the posts are **top-aligned**, so stepping between a tall one and a short one
does not jump the header up and down the screen. A single post has nothing to stay in step
with, so it is simply centred.

The carousel shows exactly what the strip behind it shows — the global filters, **and** that
strip's own platform lens if one is set. Opening a day narrowed to Instagram and getting the
Facebook posts back would make the overlay disagree with the thing it was opened from.

Only the post on screen is reachable by Tab or a screen reader, which is also why a click is
resolved from where the pointer landed rather than from what it hit: the posts either side are
inert, so the event never reaches them. Focus returns to whatever opened the overlay.

A post's own controls work here too: **See more** on a long caption expands it in place, and
clicking the caption copies it.

The header is informational in this view rather than a collapse toggle - there is nothing to
collapse into an overlay whose only job is to show the post - and a post that is collapsed
back in the strip still opens in full here.

Day columns are built as you approach them rather than all at once, so switching to Layout
mode over thirty days stays instant.

### Stats

Every number respects the active filters.

**KPI cards**

| Card | Meaning |
|---|---|
| Posts in view | Rows matching the current filters, against the tracker total |
| Posted | How many are `Posted`, and what share of the selection that is |
| Needs action | Rows still marked `Needs Action` |
| Days with content | Distinct dates that have at least one post, plus the average per active day |
| Busiest day | The highest single-day count, and which day |
| Date range | First and last posting date in the selection |
| Past due | Rows whose date has gone by while still not marked `Posted` |
| Incomplete rows | Rows missing a Platform or a Type of Post |

**Charts**

- **Posts per brand** and **Platform mix** — where the volume is going.
- **Status breakdown** — how much of the plan is actually shipped.
- **Type of post** — the format mix.
- **Posts per day** - the month as a stacked column chart: the green foot of each bar is what
  actually shipped that day, the rest is what did not. Every date is labelled, so a spike can
  be named rather than counted along the axis. Each bar carries its **total above it** and its
  **shipped count inside the green**, because reading a stacked bar off a gridline is
  guesswork and the split is the whole point of the chart.
- **Brand x platform** — a heat grid; an empty cell is a channel a brand is not covering.
- **Content readiness** — the share of rows that have a caption, an asset link and a live post
  link. This is the panel that tells the team what is still outstanding.

Charts are hand-built inline SVG with no charting library, which is also why they re-colour
instantly when the theme changes.

**Type and colour on this tab follow a fixed convention**, set as tokens at the top of
`css/stats.css` rather than picked per component. Six sizes (32 / 24 / 16 / 14 / 12 / 11) and
three colour roles: `--text` for the figure or name itself, `--text-dim` for everything
supporting it, and `--text-faint` for the genuinely absent and nothing else.

That last rule is not stylistic. `--text-faint` measures 3.1:1 against a light surface and
4.0:1 against a dark one — both under the 4.5:1 small text needs — and it had been carrying
card hints, table headers, axis labels and the footnote, which is most of the small text here.
It now marks one thing: a matrix cell with nothing in it. If you add to this tab, use the
tokens; a raw `px` or colour in a rule is the bug.

---

## Mock layouts

Reference screenshots used while building these live in `mock_layouts/` for comparison. They
are development references only and are not loaded by the site.

**Shared behaviour**

- Every post carries the **same header strip**, mock or simple card alike: platform logo and
  name, a `crosspost` marker where relevant, the status, the format and the time. However
  convincing a mock looks, which platform it belongs to is never a guess.
- Clicking the media or the page name opens the **Post Link**; if the row has none, it opens
  the **Files Chip URL** instead. If the row has neither, the element is inert and does not
  pretend to be clickable.
- **Clicking a caption copies it** - the whole thing, line breaks and emoji intact - and a
  "Copied to clipboard" confirmation pops out of the middle of the screen. Links inside the
  caption still behave as links.
- The mocks are **not text-selectable**. They are a preview, not a document, so dragging
  across one moves the day rail instead of smearing a selection over it. The caption is the
  one thing worth lifting out, and clicking it does that in full.
- Hashtags, `@mentions` and links are all coloured **blue**, the way the real platforms colour
  them, and both shades adapt to the theme. Bare links such as `bit.ly/FUNaloMAX` are detected
  even without `https://`.
- Long captions clamp with a **See more** toggle.
- **Notes/Comments** render as a mock comment under the post, labelled `Internal note` and
  styled apart from the engagement figures so a scheduling remark is never mistaken for real
  audience activity.

**Facebook** — avatar and page name top-left, posting date and time underneath, the `...` and
`x` controls top-right; caption; media placeholder by format; bottom strip with Like, Comment
and Share each carrying a count, and three reaction emoji on the right. On a narrow card the three words drop and the
glyphs keep their counts, rather than letting the row cram together. The three reaction
bubbles are drawn from Facebook's own set.

**Instagram** — gradient-ringed avatar and handle top-left, hamburger top-right; 4:5 media;
carousels get a `1/4` counter, dot indicators, arrows and swipe; action row of like, comment,
repost and share with a bookmark pushed to the right edge; handle in bold followed by the
caption; date and time underneath.

**X** — avatar on the left; name, `@handle`, a dot and the date in `m/d/yy`; caption; media in
a rounded frame; bottom strip of reply, repost, like, views, bookmark and share.

**LinkedIn** — structurally the Facebook card, which is what it is. What tells them apart at a
glance is LinkedIn's own chrome: a rounded-**square** avatar rather than a circle, a `+ Follow`
control in the header, the caption above the media, and an action bar of outline icons where
only like, comment and repost carry a count. The reactions are LinkedIn's own six — Like,
Celebrate, Support, Love, Insightful, Funny — with three drawn per post from the same seed
everything else uses, so they never reshuffle.

**TikTok** and **YouTube Shorts** are not cards at all — they are **phone screens**. The
creative fills a 9:16 display and everything else floats on top of it: a status bar, the feed
chrome, a right-hand rail of actions with their counts, the handle and caption bottom-left, and
the app's own bottom navigation. Drawing them as cards would be a picture of the wrong thing.

Four things follow from that, and they are deliberate:

- **The screen is always dark, in both themes.** Both apps are black behind the video, and a
  light-mode "phone" would look like neither. The theme tokens are redefined inside `.phone`,
  which is also what lets the shared caption builder come out legible in there with no
  special-casing in JavaScript.
- **The screen is width-capped.** Left to fill a day strip it would be 500px across and read as
  a poster rather than a phone.
- **A play badge appears over video** even though neither app shows one during playback. It is
  our marker for "this one moves", not a copy of their UI, so it is drawn small.
- **There is no status bar.** A clock and a battery say "phone" but say nothing about the post,
  and on a planning tool a rendered time is exactly the sort of set dressing somebody could
  read as data from the tracker.

TikTok adds the follow `+` on the avatar and the sound credit under the caption; Shorts adds a
Subscribe pill beside the channel and labels Save and Share with a word rather than a count,
the way it does.

### About the engagement numbers

The tracker holds no performance data, so the likes, comments, shares and views on the mock
layouts are **fabricated**. They exist to make the mock-ups read like real posts and mean
nothing.

They are generated from a seed derived from each post's own identity, so they stay identical
across re-renders, filter changes, theme switches, refreshes and reloads — a number that
reshuffled every time you touched a filter would make the whole view feel broken. Every figure
on the **Stats** tab, by contrast, is counted from the tracker and is real.

---

## Code map

No build step, no framework, no CDN, no npm. `index.html` links the stylesheets and loads
`js/main.js` as a native ES module.

```
index.html              markup shell only; everything else is rendered
css/
  fonts.css             the two Inter variable faces, loaded from font/
  tokens.css            every colour, light and dark
  base.css              reset, typography, the .glyph icon primitive
  shell.css             app bar, tabs, filter bar
  controls.css          buttons, toggles, chips, status pills
  calendar.css          month grid and its brand-grouped chips
  dayview.css           the rail and the day columns
  post-card.css         simple card, caption and note styling
  media.css             the media placeholders
  mock-facebook.css     |
  mock-instagram.css    |
  mock-x.css            |  one stylesheet per mock, paired 1:1 with its module
  mock-linkedin.css     |
  mock-tiktok.css       |
  mock-youtube.css      |
  mock-phone.css        the phone scaffold TikTok and Shorts share
  lightbox.css          the overlay
  stats.css             KPI cards and charts
  states.css            loading, error and empty states
js/
  config.js             CSV URL and the brand / platform / type / status tables
  utils.js              escaping, formatting, the seeded RNG
  csv.js                CSV parser and header resolution
  dates.js              date parsing and the keys everything buckets on
  data.js               fetch -> parse -> normalise into Post records
  state.js              the store, localStorage, deep links
  selectors.js          filtering, grouping and the stats, memoised
  theme.js              light / dark / system
  render-shell.js       filter bar, the two notifications, status panels, toasts
  render-calendar.js    the month grid
  render-dayview.js     the rail and day columns
  render-post.js        captions, media, notes, the simple card
  mocks.js              the one registry mapping a platform to its renderer
  mock-facebook.js      |
  mock-instagram.js     |
  mock-x.js             |  one module per mock
  mock-linkedin.js      |
  mock-tiktok.js        |
  mock-youtube.js       |
  charts.js             the SVG chart helpers
  lightbox.js           the blacked-out overlay: spotlight and day carousel
  render-stats.js       the dashboard
  interactions.js       drag, the rail, the carousel
  main.js               boot and the render dispatcher
font/                   Inter, self-hosted (two variable .ttf files)
img/                    logos, profile pictures, icons (incl. clip_black.png,
                        the Files paperclip). Everything named *_black is a
                        black stencil used as a CSS mask; tiktok_red_plus.png
                        and tiktok_menu_upload.png are full-colour artwork and
                        are drawn as images (see TT_ART in config.js)
mock_layouts/           reference screenshots (not used by the site)
```

### Typography

The page is set in **Inter**, self-hosted from `font/`. Two files cover all of it:

```
font/Inter-VariableFont_opsz,wght.ttf          upright, every weight
font/Inter-Italic-VariableFont_opsz,wght.ttf   italic, every weight
```

These are **variable** fonts. One file carries the whole 100-900 weight range as a continuous
axis, which is why `css/fonts.css` has two `@font-face` blocks rather than one per weight, and
why there is no weight the page can ask for and not get. The `font-weight: 100 900` descriptor
is what tells the browser the file spans that range - without it the face is treated as a
single static weight and everything else is faked.

Inter also carries an optical-size axis, and `font-optical-sizing: auto` lets the browser drive
it from the font size. That is what keeps a 10px status pill and a 26px KPI number reading as
the same typeface rather than as one scaled up.

`font-display: swap` means text stays readable in the fallback stack while the faces load, and
the upright file is preloaded from `index.html`. The italic is not: almost nothing on the page
is italic, and fetching it up front would compete with the sheet.

Everything inherits `var(--font)` from `body`, so changing the typeface is one line in
`css/base.css` plus the `@font-face` blocks.

Imports run strictly one way, so there are no circular dependencies:

```
config, utils  ->  csv, dates  ->  data  ->  state, selectors
               ->  render-*, mock-*  ->  interactions  ->  main
```

A few conventions worth knowing before editing:

- Functions ending in `HTML` are pure and return strings. Only `render*` and `sync*` functions
  touch the DOM.
- All click handling is delegated from `document` and dispatched on a `data-act` attribute, so
  replacing any chunk of markup can never leave a dead button behind.
- Every value coming from the sheet is HTML-escaped before it reaches the page.
- Switching tabs and switching Simple/Layout are driven by attributes on `<html>` and are pure
  CSS — they rebuild nothing.

### Notes for anyone editing

Two things in here are counter-intuitive enough to be worth flagging, because both were bugs
first:

- **Icon masks are set inline, not in the stylesheet.** A `url()` routed through a CSS custom
  property resolves relative to the stylesheet that *uses* it, so `img/fb_like_black.png`
  declared in `css/base.css` would be fetched as `css/img/fb_like_black.png`. `glyph()` in
  `js/render-post.js` sets `mask-image` on the element instead.
- **Captions are tokenised before escaping, not after.** Escaping first turns an apostrophe
  into `&#39;`, and the hashtag pattern then matches the `#39` inside it and splits the entity,
  which renders as literal `&#39;` on screen. The parser walks the raw text and escapes each
  fragment as it emits it.
- **Strip bodies are built from scroll arithmetic, not an IntersectionObserver.** Browsers
  suspend observer callbacks for occluded or backgrounded windows, and when that happens the
  day view is left showing nothing but skeletons.
- **Every `requestAnimationFrame` has a timer backstop.** An occluded window starves rAF while
  `document.visibilityState` still reports `"visible"`, so there is nothing to feature-detect.
  Without the backstop the UI freezes while JavaScript keeps running - exactly what would
  happen to this page left open on an office display behind another window.
- **The rail re-measures itself with a `ResizeObserver`, not just on window resize.** Strip
  heights, lazy building and the ruler box are all derived from the rail's width, and it
  can be built before the layout has settled - a pane resizing, a sidebar opening, fonts
  swapping in. A window resize listener alone misses all of those and leaves the view showing
  skeletons sized from a width that no longer exists.
- **The ruler is driven from the glide, not from the rail's `scroll` event.** When the page
  moves the rail itself, waiting for the scroll event to come back round leaves the box
  lagging behind the pointer.
- **Calendar overflow is measured with rects, not `offsetTop`.** The cell is
  `position: relative`, so a chip's `offsetTop` is counted from the cell - header included -
  rather than from the chip box, which made even a one-chip day report as overflowing.
- **The post header is a grid, not a wrapping flex row.** With `flex-wrap` every chip found
  its own line independently and a loaded header sprawled over three or four ragged rows.
  As a grid the platform stays pinned left, the time and chevron stay pinned right, and only
  the tags wrap - as one block, in their own column.
- **Strips are built whenever the rail lands on a day, not only on its `scroll` event.** A
  deep link, a ruler click or the keyboard can move the rail without a scroll event ever being
  delivered, which left the day you asked for sitting there as a skeleton.
- **The thumbnail height is handed down through `.mediawrap`.** `clickableMediaHTML` wraps the
  placeholder, so a `height: 100%` on the placeholder alone resolves against an auto-height
  parent and collapses to zero.

---

## Limitations

- **Read-only.** Edits go in the Google Sheet; this page only reflects them.
- **The creative is not shown.** The sheet stores filenames and Drive links, not images, and
  Drive links cannot be embedded, so every image is a labelled placeholder. Click it to open
  the real asset in Drive.
- **Engagement figures on mock layouts are invented** — see above.
- **Engagement figures differ per platform on a crosspost** - deliberately, since the same
  creative would not perform identically on Facebook and Instagram. They are invented either
  way.
- **Album tile counts default to four.** The sheet does not record how many images a carousel
  contains; change `CAROUSEL_DEFAULT` in `js/config.js` if a different default suits better.
- **The sheet must stay published.** Un-publishing it, or regenerating its published link,
  breaks the page until `CSV_URL` is updated.
- **Anyone who can open the page can read the tracker.** A published CSV needs no credentials,
  so treat the page as being as public as the sheet is.

---

## Troubleshooting

**"This page needs to be served over HTTP"** — the file was opened from disk. Start a local
server (`python -m http.server 8000`) or put it on a host.

**"The tracker could not be loaded"** — the sheet is unreachable. Check that it is still
published (`File -> Share -> Publish to web`), that the link in `js/config.js` matches, and
that the network allows `docs.google.com`. The panel links the CSV directly so you can confirm
in a new tab.

**Edits to the CSS or JS do not show up** — the browser cached the old files. Hard-reload with
`Ctrl`+`Shift`+`R` (`Cmd`+`Shift`+`R` on a Mac). `python -m http.server` sends no cache
headers, which makes browsers cache aggressively; proper hosts do not have this problem.

**A post is missing from the calendar** — its Posting Date is empty or unreadable. The expected
form is `Sep 11, 2026 (Fri)`. Rows without a usable date cannot be placed and are skipped.

**A post shows as "Unspecified"** — its Platform or Type of Post cell is blank in the sheet.
That is intentional: the row stays visible so the gap gets noticed. Filter by `Unspecified` to
list them all.

**The page shows the wrong month** — it opens on the first month containing posts. Use the
month arrows, or `Today`.

**The same post appears twice in a day** - it is a crosspost, going out on two platforms. Each
copy is labelled `crosspost` in its header and names the other platform on hover. Filtering to
one platform shows only that copy.

**A caption will not copy** - clipboard access needs a secure context. `https://` and
`localhost` both qualify; a plain `http://` internal host does not, and the page falls back to
an older copy method that some browsers also block. Hosting over HTTPS fixes it.

**The text is not Inter** - the two variable `.ttf` files under `font/` did not upload, or the
folder was renamed. The page falls back to the system UI font and stays perfectly readable;
check the browser console for 404s under `font/`. Note the filenames contain a comma
(`Inter-VariableFont_opsz,wght.ttf`); some upload tools and sync clients rename it, and the
name has to match `css/fonts.css` exactly.

**Bold text looks blurry or too heavy** - the variable font did not load and the browser is
synthesising bold from the fallback. Same check as above.

**The mouse wheel will not move across days** - that is deliberate. Use the day ruler above
the strips, drag a strip sideways, or press the arrow keys. The wheel scrolls the posts within
a day.

**A day is showing fewer posts than its count says** - one of the platform chips in that day's
header is pressed, which narrows the strip to that platform. Click it again, or the **show
all** link beside the chips. Moving to another day clears it automatically.

**A post looks empty** - its header was clicked, which collapses it. Click the header again;
the chevron points right when a post is collapsed.

**The data stopped updating** - check the **Auto** box beside Refresh. Unticked, the page holds
whatever it last loaded until you press Refresh.

**A post opens a link when I wanted to look at it** - the media and the page name are
click-throughs to the real post. Use the expand button in the post's header to examine it
instead.

**A post is flagged past due but it did go out** - its Status in the sheet is not `Posted`.
The flag is driven entirely by that column, so updating the sheet clears it on the next
refresh.

**The past-due notification keeps coming back** - it reappears only when the count goes *up*, which
means another posting has just fallen overdue. Dismissing it again acknowledges the new
number.
