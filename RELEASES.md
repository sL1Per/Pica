# Release notes

Human-readable history of Pica releases. Format follows the
[Keep a Changelog](https://keepachangelog.com) convention. Most recent
entries are at the top.

Each release corresponds to a point-in-time build — during development the
build artifacts are named `pica-m<milestone>[-suffix].zip`. Versions are
tagged as `0.N.0` where N matches the milestone number.

## [Unreleased]

_Nothing yet — this section fills up as we work toward the next release._

---

## [0.11.0] — 2026-04-26 — Milestone 8c: PWA + offline clock-in

This release ships the two M8c items: installable PWA and offline-friendly
clock-in with idempotent replay. After this drop, the app can be installed
to the home screen on mobile/desktop, loads instantly from cache on
revisits, and accepts clock-in/out clicks even when the network is down —
queueing them in `localStorage` and replaying when connectivity returns.

### Added — Installable PWA

- **`/manifest.json`** with name, short_name, start_url, scope, display
  `standalone`, theme color matching `--accent` (#2e7d32), background
  color matching `--bg` (#0f1115).
- **`/icon.svg`** — a 512×512 SVG "P" mark on the accent green, declared
  with `purpose: "any maskable"` so OS icon-mask shapes (Android adaptive
  icons, iOS rounded corners) crop correctly. Going SVG-only avoids the
  zero-deps PNG generation problem; modern browsers (Chrome/Edge/Safari
  16.4+) accept SVG manifest icons for installability.
- **Manifest `<link>` + `<meta name="theme-color">` + apple-touch-icon**
  added to the `<head>` of all 15 HTML pages.

### Added — Service worker (`/sw.js`)

- **Cache-first** strategy for fingerprintable static assets (CSS, JS,
  SVG, manifest) so the app shell loads instantly and works offline.
- **Network-first with cache fallback** for HTML pages and same-origin
  GET API calls so signed-in users still see their data offline.
- **Versioned cache name** (`pica-cache-v1`) — bumping the version on
  any deploy invalidates the cache wholesale via the activate event,
  avoiding the "users stuck on old build" trap.
- Pre-caches the app shell (`/`, `/punch`, `/leaves`, `/leaves/calendar`,
  `/preferences`, plus their CSS/JS) on install.
- Cross-origin requests (e.g. OpenStreetMap tiles) bypass the SW
  entirely and go straight to network — they fail gracefully when
  offline; the punch page already handles map absence.
- The SW does NOT handle the offline punch queue. That lives in the
  punch page so it works on iOS Safari (which doesn't support the
  Background Sync API).
- SW registered from `topbar.js` (`navigator.serviceWorker.register`),
  which is loaded on every page including login + setup.

### Added — Offline clock-in queue

- **localStorage queue** under key `pica-pending-punches`. Every clock
  attempt now generates a `clientId` (UUID) and `clientTs` (current ISO
  string) regardless of whether it's offline or live.
- **On network failure** the punch is enqueued instead of erroring.
  User sees "Saved offline — will sync when online." A queue-badge near
  the buttons reads "N punch(es) waiting to sync".
- **Drain triggers**: on every page load + on `window.online` event.
  Drains in chronological order by `clientTs`; successes and idempotent
  duplicates are removed; transient failures stay for the next attempt.
- **Stale-queue handling**: if the server rejects a queued item with a
  business-logic error (e.g. "you are already clocked in" because state
  diverged), the client drops it from the queue rather than retrying
  forever. Surfacing every stale rejection would be more annoying than
  helpful — the page already shows the real state.

### Added — Backend support

- **`clientId`** (alphanumeric ± dashes/underscores, max 64 chars) is
  persisted on the plaintext line header of each punch. Stored
  plaintext (not in the encrypted blob) so `findByClientId()` can scan
  files without decrypting every line. The ID itself is not sensitive.
- **`POST /api/punches/clock-in`** and **`/clock-out`**: both routes now
  perform an idempotency lookup at the top. If the supplied `clientId`
  matches a previously-stored punch for this user (within the last 3
  months), the prior record is returned with `{duplicate: true}` and no
  new punch is created. Lets the offline queue retry safely.
- **`clientTs`** is honored as the authoritative timestamp on the punch
  if present and within ±7 days of server "now". Outside that window
  (or absent) the server stamps the time itself. The 7-day bound
  prevents trivial backdating without committing to crypto signing yet
  (deferred to M11 hardening).
- **`/api/punches/today`** and similar read endpoints now expose the
  `clientId` field.
- Forward-compatible: old punch lines without a `clientId` read back
  with `clientId: null`. No data migration needed.

### Files touched
- `public/manifest.json`, `icon.svg`, `sw.js` — new files.
- All 15 `public/*.html` — manifest link, theme-color, apple-touch-icon.
- `public/topbar.js` — service worker registration.
- `public/punch.{html,js,css}` — offline queue, badge UI, drain logic,
  payload always carries `clientId` + `clientTs`.
- `src/storage/punches.js` — `append()` accepts `clientId`; new
  `findByClientId()`; read path surfaces clientId.
- `src/routes/punches.js` — `validClientId`, `validClientTs`;
  idempotency check; honors clientTs within ±7 days.
- `tests/test-punches.mjs` — 4 new tests for clientId persistence and
  scoped lookup.
- `package.json` — version bump to 0.11.0.
- `README.md` — M8c ticked.

### What's NOT in this drop (deferred to M11)
- Cryptographic signing of offline timestamps (currently trusted within
  ±7 days; sufficient for honest-user offline replay, weak against an
  adversary).
- Conflict-resolution UI when a queued punch is rejected because state
  diverged (e.g. employer force-clocked someone out while they were
  offline).
- Background Sync API integration (needs different code path; iOS
  Safari doesn't support it anyway).

### Test totals
- 9 suites, 245 passing, 0 failing (was 241; +4 new in test-punches).

---

## [0.10.2] — 2026-04-26 — Mandatory location with graceful failure

### Changed
- **Location sharing on the punch page is now mandatory** — the
  "Share my location" checkbox and its privacy hint are removed. Every
  page load attempts geolocation, every punch attempts geolocation.
- **But punches still go through when geolocation fails** for technical
  or permission reasons. We don't want a low signal, denied permission,
  or a flaky Wi-Fi triangulation backend to block someone from clocking
  in or out — that hurts honest workers more than dishonest ones.
- The user-facing message on failure now reads "The punch will still be
  recorded" so the worker isn't surprised when it does.

### Added
- **`geoSkipReason` field on every punch.** Whitelisted to one of:
  `denied`, `timeout`, `unavailable`, `unsupported`, or `null` when geo
  was successfully captured.
  - Stored encrypted alongside `comment` and `geo` (privacy-relevant).
  - Returned on read so future audit/reporting can surface "punches
    without location" if the employer wants to investigate patterns.
  - Old records read with `geoSkipReason: null` (forward-compatible
    payload format — adding a third field doesn't break old NDJSON lines).
- **Frontend captures the reason** when the geolocation API errors out:
  - `PERMISSION_DENIED` → `'denied'`
  - `TIMEOUT` → `'timeout'`
  - any other geolocation error → `'unavailable'`
  - browser doesn't support geolocation → `'unsupported'`

### Notes — design choice
- Permission denial is treated the same as a technical failure (punch
  goes through, reason logged). Alternative would have been blocking the
  punch and forcing the user to re-grant permission — but that creates
  exploitation surface free recovery for legit users (Chrome's
  permissions can get into weird states; slow networks; corporate
  policies). The honest audit trail comes from the `geoSkipReason` flag,
  which is enforceable later via reports/dashboards (deferred to M11).
- The reason is privacy-relevant (it tells you whether someone *blocked*
  location vs *couldn't get* a fix) so it goes inside the encrypted blob
  with the other sensitive fields, not on the plaintext line header.

### Files touched
- `src/storage/punches.js` — `append()` accepts `geoSkipReason`; encrypted
  payload now carries the third field; read path returns it.
- `src/routes/punches.js` — `validGeoSkipReason()` whitelist; clock-in
  and clock-out routes pass it through.
- `public/punch.html` — share-geo checkbox + privacy hint removed.
- `public/punch.js` — `shareGeo` references gone; geo always attempted;
  `lastGeoSkipReason` captured on terminal failure; included in the
  punch payload when geo is null.
- `package.json` — patch bump.

### Test totals
- 9 suites, 241 passing, 0 failing.

---

## [0.10.1] — 2026-04-26 — Fix: overlap status filter + nav highlighting

### Fixed
- **Cancelled (and pending/rejected) leaves were counted as overlaps in
  the concurrent-leaves warning.** The overlap endpoint passed
  `{status: 'approved'}` to `leavesStore.list()`, but `list()` only
  destructures `{employeeId}` and silently ignores any other filter
  fields. Result: the SQL-style filter was a no-op, and every leave of
  every status leaked through the date-range check. Replaced with an
  explicit JS filter `.filter(l => l.status === 'approved')`. Confirmed
  by smoke: an approved-then-cancelled leave no longer shows in the
  overlap list; an approved leave still does.
- **Both "Leaves" and "Calendar" highlighted in the top nav while on
  `/leaves/calendar`.** The `isActive(currentPath, href)` check was
  `currentPath === href || currentPath.startsWith(href + '/')`. With
  href `/leaves`, the path `/leaves/calendar` matched the prefix rule
  even though `/leaves/calendar` was its own nav entry. Now `isActive`
  takes the full list of nav hrefs and applies a sibling-precedence
  rule: a less-specific href (`/leaves`) does NOT match if a
  more-specific sibling (`/leaves/calendar`) covers the path.

### Files touched
- `src/routes/leaves.js` — explicit status filter on the overlap query.
- `public/topbar.js` — `isActive()` signature + both call sites.
- `package.json` — patch bump.

---

## [0.10.0] — 2026-04-26 — Leave rules: cap enforcement + concurrent warning

This release closes the two remaining behavioural items in M8b that were
spec'd in M7 but never enforced.

### Added — Leave-cap enforcement

- **`leavesStore.wouldExceedCap({userId, type, additionalDays, year, …})`**
  helper. Returns `{exceeds, allowance, currentBooked, wouldBe, type}`.
  Allowance is read from `orgSettings.leaves.defaultAllowances[type]`,
  with `perEmployeeOverrides[userId][type]` taking precedence.
  Allowance of `0` is the existing "no cap" semantic — never exceeds.
- **`POST /api/leaves`** now rejects with 400 when creating a request
  whose days would push the user's booked total over the cap.
- **`POST /api/leaves/:id/approve`** now rejects with 400 when approving
  would push booked over the cap. This catches the case where the
  request was created when the cap had room, then someone else got
  approved first.
- Error messages include the allowance, current booked, request size,
  and resulting total: e.g. *"Cannot book leave: allowance for vacation
  is 22 days; you currently have 5 booked, this request adds 20 (would
  total 25)."*
- 8 new tests in `test-leaves.mjs` covering:
  unlimited (allowance=0) accepts any amount; positive cap allows up to
  exact limit; rejects beyond; pending doesn't count, only booked;
  per-employee override beats default; cancellation frees up space;
  year-scoped (last year doesn't block this year); hours-unit
  conversion (8h = 1d) for cap math.

### Added — Concurrent-leaves warning

- **`GET /api/leaves/:id/overlaps`** (employer-only) returns the list of
  approved leaves of *other* users that overlap with the given leave's
  date range, plus the current `concurrentAllowed` setting from
  org-settings.
- **Approval flow on the leave detail page** now calls this endpoint
  before sending the approve POST. If overlaps exist *and*
  `concurrentAllowed === false`, a confirm dialog lists the overlapping
  employees and asks "Approve anyway?". Setting === true → silent
  approval as before.
- The setting governs *whether the warning fires*, not whether approval
  is allowed — the employer always has the final call. This matches the
  M8b README spec ("Concurrent-leaves warning on approve").

### Changed — UI display

- Balance table: when allowance is 0 (no cap), the Allowance and
  Remaining columns now show "—" instead of `0`. Same for the employer
  matrix view, where the cell shows `<booked> / —` instead of
  `<remaining> / 0`. Prevents the "I have zero days" misread for
  unlimited types.

### Cap semantics — settled

- `allowance === 0` means **unlimited** (existing semantic, comment in
  org-settings.js line 35: *"0 = no cap by default"*).
- `allowance > 0` means **enforced cap**.
- Cap counts **booked only**, not pending. Multiple pending requests can
  exist; the cap becomes real at approval time. This way employees can
  always submit requests, and the employer chooses what to approve.

### Files touched
- `src/storage/leaves.js` — `wouldExceedCap()` helper.
- `src/routes/leaves.js` — cap check in create + approve; new
  `/overlaps` endpoint.
- `tests/test-leaves.mjs` — 8 new tests for the cap helper.
- `public/leave.js` — `approveWithConcurrencyCheck()` wraps the approve
  click; fetches overlaps, conditionally confirms.
- `public/leaves.js` — "—" display when allowance is 0.
- `package.json` — version + date bump.

### Test totals
- 9 suites, 241 passing, 0 failing (was 233 before this release).
  Net new: 8 tests in leaves.

---

## [0.9.17] — 2026-04-26 — Dashboard: role-filtered nav cards

### Added
- Dashboard (`/`) now renders quick-nav cards above the placeholder.
  One card per top-bar nav entry, role-filtered:
  - **Employer:** Employees · Calendar · Leaves · Punches · Reports · Settings
  - **Employee:** Punches · Calendar · Leaves · Reports
- Card titles match the top-bar nav labels exactly. Each card has a
  short one-line description.
- Responsive grid: 1 column on mobile, 2 on tablet (≥600px), 3 on
  desktop (≥1000px). Hover shows accent border + subtle lift.
- The Dashboard placeholder card stays below for the future at-a-glance
  widgets.

### Notes
- "My profile" and "Today" — the two cards from the original 0.0.x
  dashboard that aren't in the current top-bar nav — were intentionally
  omitted to match the spec ("text should match the links in the menu").
  Profile is reachable via the avatar dropdown; "Today's punches" is
  reachable from inside the Punches page.

### Files touched
- `public/index.html` — `<nav id="nav-cards">` container.
- `public/index.js` — NAV_EMPLOYER / NAV_EMPLOYEE definitions + renderer.
- `public/index.css` — `.nav-cards` grid, `.nav-card` block styles.
- `package.json` — version + date bump.

---

## [0.9.16] — 2026-04-26 — Preferences page also full-width

### Changed
- Preferences page (`/preferences`) switched from narrow `.container` to
  `.container--wide`. Missed in 0.9.15.
- Other narrow form pages (login, setup, leaves/new, leave detail,
  employee/new) intentionally stay on `.container` since their inputs
  read better at form widths. If any of those should go wide too,
  one-line change each.

### Files touched
- `public/preferences.html` — `<main>` class.
- `package.json` — version + date bump.

---

## [0.9.15] — 2026-04-26 — Containers: full-width, single source of truth

### Fixed
- **Major hidden technical debt:** `.container--wide` was redefined four
  times across `leaves.css` (1100px), `settings.css` (860px),
  `reports.css` (960px), and `leaves-calendar.css` (960px) with
  conflicting max-widths. Worse, `punch.html` referenced
  `.container--wide` but didn't load any CSS file that defined it — so
  the punch page silently fell back to the narrow `.container` rule,
  which is why the wide-layout screenshots showed cramped columns
  centered in a sea of empty space.

### Changed
- **`.container` and `.container--wide` are now defined in `app.css` as
  the single source of truth.** Every page inherits the same rules:
  - `.container` — 640px max (was 480px), used for forms and tight
    reading-line content.
  - `.container--wide` — 1600px max (was 1100px or 860/960 depending
    on which page you were on), used for two-column layouts, tables,
    and dashboards.
- All four per-page overrides removed. The legitimate `@media print`
  rule in `reports.css` stays (it widens both containers to 100% for
  print, which is the right behavior).
- **Pages switched from narrow to wide:** dashboard (`/`), employees
  list, employee detail, punches-today. Two-column pages (punch,
  leaves) now actually render as wide as intended.
- **Pages staying narrow** (forms benefit from shorter line lengths):
  login, setup, preferences, leaves/new, leave detail, employee/new.

### Why not full-width on every page
- Login / setup / preferences / new-leave / new-employee / leave detail
  are tight forms. Stretching their inputs to 1600px hurts usability.
  The two-tier system (narrow / wide) gives forms readable line lengths
  and dashboards/tables generous space, with consistent rules now
  centrally defined.

### Files touched
- `public/app.css` — canonical container definitions added.
- `public/leaves.css`, `settings.css`, `reports.css`,
  `leaves-calendar.css` — duplicate `.container--wide` overrides
  removed.
- `public/index.html`, `employees.html`, `employee.html`,
  `punches-today.html` — switched to `.container--wide`.
- `package.json` — version + date bump.

---

## [0.9.14] — 2026-04-26 — Punch: even two-column split

### Changed
- The punch page two-column grid was `minmax(420px, 55%) 1fr`, which gave
  the right column the leftovers. With the wide container that left only
  ~250px for the today's-list — too narrow, forcing each punch card to
  wrap "OUT 14:06 50.4808, 5.9912" into three lines.
- New split: `1fr 1fr` — equal columns. Both panels get ~530px on a
  1100px container; the list breathes without dominating the buttons +
  map column. Mobile single-column unchanged.

### Files touched
- `public/punch.css` — grid-template-columns at the 900px breakpoint.
- `package.json` — version + date bump.

---

## [0.9.13] — 2026-04-26 — Punch: two-column layout (desktop)

### Changed
- Punch page now uses a two-column grid on desktop ≥900px: punch-card
  (status block, buttons, comment, map) on the left, today's punch list
  on the right. Mirrors the leaves page layout (`minmax(420px, 55%) 1fr`).
- Container widened to `container--wide` (1100px max).
- "See everyone's punches today" link moved inside the today section so
  it stays anchored to the list on the right column.
- Mobile (<900px) keeps the single-column stack — punch card on top,
  today list below — exactly as before.

### Files touched
- `public/punch.html` — wrapped the two existing sections in a
  `.punch-layout` grid container, moved the all-today link into the
  today-section column, switched the main container class.
- `public/punch.css` — appended grid layout + breakpoint.
- `package.json` — version + date bump.

---

## [0.9.12] — 2026-04-26 — Punch: status block tint + daily total

### Added
- **Today section header** now shows the cumulative worked time on the
  right (e.g. "4 minutes" / "1h 23m"). Pairs each in→out, ignores any
  unmatched in (defensive against data anomalies). If the user is
  currently clocked in, the open session counts up to "now". Uses
  tabular-nums and `--text-muted` for a calm, neutral display — not red.
- The label is hidden when there are no punches today.

### Changed
- **Status block** ("Clocked in" / "Clocked out") now matches the
  Clock-in / Clock-out button colors:
  - Clocked in → `--success-soft` background, `--success` border,
    bright green dot with a halo.
  - Clocked out → `--danger-soft` background, `--danger` border, red
    dot with a halo.
  Strong visual coupling between current state and the relevant action
  button. Subtle enough not to compete with the buttons themselves.

### Files touched
- `public/punch.{html,js,css}` — three small additions.
- `package.json` — version + date bump.

### Note on the "red" question
- The screenshot showed the daily total in red. I went with neutral
  muted instead — red conventionally signals errors/warnings, and the
  status block above already conveys the "currently clocked out" state
  in red. Two reds competing diluted the signal. Easy to flip if you
  prefer the original.

---

## [0.9.11] — 2026-04-26 — Footer link + geolocation cache

### Added
- **Footer version label is now a link** to `RELEASES.md` on GitHub
  (`{repository}/blob/main/RELEASES.md`). Clicking the version takes
  you straight to the changelog. The separate "GitHub" link still
  points to the repo root.
- **Geolocation cache in `sessionStorage`.** The last successful fix
  is persisted under `pica-last-geo-fix` and reused on subsequent
  page loads within the same browser session. Navigating to `/punch`
  no longer re-triggers the platform geolocation backend if a fix is
  already known — the map renders instantly with the last-known
  position. The cache is per-tab (sessionStorage), so closing the tab
  forgets it.
- **"Failed this session" sentinel.** When geolocation fails twice
  (low-accuracy then high-accuracy fallback both error/timeout), the
  sentinel `pica-geo-failed-this-session` is set. The `/punch`
  bootstrap reads it on subsequent loads and shows the Retry button
  *without* auto-triggering a fresh attempt — preventing the macOS
  `kCLErrorLocationUnknown` console error from repeating on every
  navigation when location is genuinely unavailable. Clicking Retry
  clears the sentinel.

### Process notes (carried forward)
- Every release bumps `version` AND `releaseDate` in `package.json`.
  The footer auto-updates from these fields.
- Every change updates `RELEASES.md` with an entry describing what
  shipped and why.

### Files touched
- `public/topbar.js` — version text wraps in an anchor pointing at
  `RELEASES.md`.
- `public/punch.js` — sessionStorage cache helpers, smarter bootstrap.
- `package.json` — version + date bump.

---

## [0.9.10] — 2026-04-26 — Fix: theme FOUC on every page navigation

### Fixed
- A flash of dark theme appeared briefly on every page load when the
  user's preference was "Light" but their OS was set to dark. Root
  cause: the color preference was fetched over the network in `app.js`,
  so between HTML paint and JS-executed `setAttribute('data-theme')`,
  the browser rendered the page using the default
  `@media (prefers-color-scheme: dark)` fallback (~50–200ms of dark).
- Fix: a tiny synchronous `<script>` block in every page's `<head>`
  reads the persisted color-mode from `localStorage` and sets
  `data-theme` *before* the stylesheet loads. The first paint now
  matches the chosen theme — no flash.
- The async IIFE in `app.js` continues to refresh from the server (so
  changes from another tab/device propagate) and writes the result back
  to `localStorage` for the next page's synchronous boot.
- `preferences.js` writes to `localStorage` immediately on save, so
  navigating away from `/preferences` carries the new theme without a
  flash.

### Notes
- First-ever page load on a new browser still has a brief flash since
  there's no `localStorage` value yet. Subsequent loads (and all
  in-session navigation) are flash-free.
- The inline script is identical across all 15 HTML files. It's small
  and stable; if it ever needs changing the canonical version is in
  this RELEASES entry, plus an inline comment in each file.

### Files touched
- All 15 HTML files in `public/` — added the synchronous theme bootstrap
  script in `<head>` before the stylesheet.
- `public/app.js` — IIFE writes the fetched color-mode to `localStorage`.
- `public/preferences.js` — `applyColorMode()` writes to `localStorage`.
- `package.json` — version bump.

---

## [0.9.9] — 2026-04-25 — Fix: dashboard color-mode + sticky footer

### Fixed
- **Dashboard always rendered dark, regardless of preference.** The
  color-mode bootstrap IIFE in `app.js` only ran on pages that imported
  `app.js`. Most pages do (for `postJson` / `showMessage` / `setBusy`),
  but the dashboard imports only `topbar.js` — so its color mode never
  applied and it inherited whatever the OS reported via
  `prefers-color-scheme: dark`.
- Real fix: `topbar.js` now does `import '/app.js'` at the top for the
  side effect. Every page that mounts the top bar inherits the
  color-mode bootstrap automatically — present and future.

### Changed
- **Footer now sticks to the viewport bottom on short pages.** `<body>`
  becomes a flex column with `min-height: 100vh`; `<main>` grows to fill
  the remaining space; `.app-footer` sits at the bottom regardless of
  content length. On long pages, the footer scrolls naturally at the
  end of content.
- Footer padding tightened (was `var(--gap-7)` margin-top + `var(--gap-4)`
  padding; now `var(--gap-5)` margin-top + `var(--gap-4)` padding all
  around). The flex layout already provides the spacing.

### Files touched
- `public/topbar.js` — added `import '/app.js'` side effect.
- `public/app.css` — body flex-column, footer margin tightened.
- `package.json` — version bump.

---

## [0.9.8] — 2026-04-25 — Preferences split + version footer

### Added
- New **Preferences** page at `/preferences` containing the per-user
  language and color-mode controls. Accessible to every authenticated
  user (employee or employer) via a new "Preferences" entry in the
  avatar dropdown, between "View my profile" and "Sign out".
- New **`GET /api/version`** endpoint (unauthenticated) returning
  `{version, releaseDate, repository}` from `package.json`. Single read
  at server startup; no per-request file I/O.
- New `mountFooter()` exported from `public/topbar.js`. Fetches
  `/api/version` once per session (cached in module scope), renders a
  centered footer at the bottom of the page reading
  "Pica v{version} · {date} · GitHub" with the repo URL linked.
- `package.json` gains `releaseDate` and `repository` fields. Version
  bumped to `0.9.8`. The release process now includes bumping these.

### Changed
- The Account section moved out of `/settings`. `/settings` is now
  **employer-only**: route handler in `pages.js` redirects non-employer
  users to `/preferences`. Page renders only the Company / Organization
  / Backups sections.
- The "Settings" link added to employee nav back in 0.9.1 is **removed**.
  Employees access their preferences via the avatar dropdown only.
  Employer top-bar nav still contains "Settings" (they need it for
  company config). Reports stays for both roles.
- `/api/health` now reports the real version from `package.json`
  (was hardcoded to `0.1.0`).
- Footer is mounted on **every** page including login and setup, by
  calling `mountFooter()` directly from each page's JS module.

### Files touched
- `package.json` — version bump + new fields.
- `server.js` — read package.json once, expose `/api/version`,
  update `/api/health` version field.
- `src/routes/pages.js` — `/preferences` route, `/settings` redirect for
  non-employers.
- `public/preferences.{html,js,css}` — new page.
- `public/topbar.js` — Preferences in dropdown, Settings out of employee
  nav, `mountFooter()` export with version cache.
- `public/app.css` — `.app-footer` styles.
- `public/settings.{html,js}` — Account section removed.
- 14 page modules (`employee.js`, `employee-new.js`, …, `login.js`,
  `setup.js`) — added `mountFooter()` call.

### Notes
- Footer position is "end of body content with margin-top + border-top",
  not sticky-to-viewport. Sticky-to-viewport would need turning `<body>`
  into a flex column on every page — too invasive for a low-value gain.
  Pages with short content show the footer just below; long pages let
  it scroll naturally.

---

## [0.9.7] — 2026-04-25 — Punch: geolocation timeout resilience

### Changed
- `getGeo()` is now resilient to the common Chrome pattern where the
  first fix succeeds but subsequent calls time out:
  - Increased `timeout` from 8s to 15s (low-accuracy attempt) and 20s
    (high-accuracy attempt).
  - Increased `maximumAge` from 60s to 300s so the browser can return a
    recently-cached fix instead of forcing a fresh hardware/network
    request every time.
  - On low-accuracy timeout, automatically retry once with
    `enableHighAccuracy: true`. Some platforms only fill in a position
    when explicitly asked.
  - On final failure, distinguish "Location request timed out" from other
    errors in the user-facing message.

### Added
- A "Retry location" button appears next to the geo-status text when
  geolocation fails. Clicking it re-runs the full `getGeo()` flow and
  refreshes the map on success — no page reload needed.

---

## [0.9.6] — 2026-04-25 — Punch page: two-button + live map

### Added
- Two side-by-side buttons (**Clock in** / **Clock out**) on the punch
  page, replacing the single context-flipping button. Only the action
  that makes sense is clickable; the other is `disabled` but visually
  identical (no greyed-out wash) so the button is "unclickable" rather
  than "broken-looking".
- Live OpenStreetMap tile preview when location sharing is enabled.
  Fetched on page load (preview), refreshed after each punch (captured
  position). Single static `<img>` from `tile.openstreetmap.org` — no
  JS library, no API key, no third-party billing. CSS-positioned pin
  centered on the tile, with attribution per OSM's usage policy.
- Privacy hint under the Share-my-location checkbox, mentioning that
  enabling location sharing also fetches a map tile from OSM.

### Changed
- `punch.css` rewritten: two-button row replaces the old single-button
  block. New `.map-card` component with frame, tile, pin, meta, and
  attribution. Old `.punch-action--in/--out` styles dropped.
- Disabled-button override (`.punch-btn:disabled { opacity: 1; cursor: default }`)
  matches user's request to keep the inactive button looking normal
  while still being unclickable.

### Notes
- Backend untouched. Punches already store `geo: {lat, lng, accuracy}`
  and the `/api/punches/status` endpoint already reports clocked-in
  state. The page now uses both more directly.
- Map uses zoom level 16 (a single tile covers ~600m at most latitudes)
  and computes (x, y) tile coordinates locally via standard slippy-map
  Mercator math. No reverse-geocoding (no address line) — that's a
  separate feature requiring a Nominatim call, deferred.

---

## [0.9.5] — 2026-04-25 — Profile: date of birth replaces age

### Changed
- Employee profile field `age` (integer) replaced with `dateOfBirth`
  (YYYY-MM-DD string). Native `<input type="date">` picker on both the
  detail and new-employee pages. Age is computed live and shown next to
  the picker as "N years old" — updates as the user changes the date.
- Hidden when no DOB, future date, or absurd values (>130).
- The legacy `age` field is removed from the storage whitelist, so any
  old `age` data on existing profiles is silently dropped on first save.
  This was an explicit "clean slate" choice over carrying both fields.
- Test fixtures + assertions updated to use `dateOfBirth: '1990-04-12'`
  in place of `age: 29`.

### Files touched
- `src/storage/employees.js` — whitelist `dateOfBirth` instead of `age`.
- `public/employee.html`, `employee-new.html` — DOB picker + age sidecar.
- `public/employee.js`, `employee-new.js` — load/send DOB; live age compute.
- `public/app.css` — `.dob-row` flex layout for picker + age side-by-side.
- `tests/test-employees.mjs` — fixture + assertions.

---

## [0.9.4] — 2026-04-25 — Display fullName everywhere a user appears

### Added
- `/api/me` now returns `fullName` alongside `id`, `username`, and `role`.
  Looked up via `employeesStore.readProfile(req.user.id)`. Returns `null`
  when no profile exists (e.g. an employer who hasn't created a profile
  for themselves).
- `enrich()` in leaves routes now adds `fullName` to every leave payload.
  All seven endpoints that return leaves (list, single, approved, create,
  approve, reject, cancel) now include it.

### Changed
- Frontend now prefers `fullName` (with `username` as fallback) in seven
  user-facing places:
  - **Top bar avatar dropdown** — name shown in the menu header.
  - **Top bar avatar initials** — derived from fullName when available.
  - **Dashboard welcome line** — "Welcome to Pica, signed in as Alice Lopes".
  - **Leaves list (employer view)** — row label uses fullName.
  - **Leave detail page** — "Employee" field.
  - **Calendar bubbles** — visible label and tooltip.
- Spots that already preferred fullName remain unchanged: employees list
  + detail, settings overrides table, reports picker, today's punches
  groupings.

### Fixed
- The leaves matrix endpoint (`GET /api/leaves/balances`) was reading
  `u.fullName` from `usersStore.list()`, which never has a `fullName`
  field — that data lives in the encrypted employee profile. The matrix
  was silently returning `null` for every row's fullName, with the UI
  falling back to username every time. Now uses a `Map(userId →
  fullName)` built from `employeesStore.list()`. Confirmed in the smoke:
  alice now shows as `fullName: 'Alice Lopes'` in the matrix; admin shows
  `null` (no profile, correct fallback).

### Files touched
- `src/routes/auth.js` — accepts `employeesStore`; `/api/me` reads profile.
- `src/routes/leaves.js` — accepts `employeesStore`; new `fullNameMap()`
  helper; `enrich()` adds `fullName`; matrix endpoint uses the map.
- `server.js` — passes `employeesStore` to auth and leaves route registration.
- `public/topbar.js` — initials and dropdown name use fullName.
- `public/index.js` — welcome line uses fullName.
- `public/leaves.js` — employer list row uses fullName.
- `public/leaves-calendar.js` — bubble label and tooltip use fullName.
- `public/leave.js` — detail page Employee field uses fullName.

---

## [0.9.3] — 2026-04-24 — Fix: leaves balance table column alignment

### Fixed
- Balance table header cells and body cells were computing different
  column widths (the header got the natural-width of its labels,
  ALLOWANCE / PENDING / BOOKED / REMAINING, which are all different
  lengths; the body got whatever space was left after the type tag).
  This made the table look like the numbers were in the wrong columns,
  even though the math was correct.
- Fix: `table-layout: fixed` + explicit per-column widths (28% for Type,
  18% each for the four numeric columns). Header and body now share
  the same grid.

### Changed
- Balance panel widened from `minmax(360px, 42%)` to `minmax(420px, 55%)`,
  giving the table more breathing room and shrinking the list column.

---

## [0.9.2] — 2026-04-24 — Leaves: balance system

### Added
- `leavesStore.computeBalances({userId, year, orgSettings, leaveTypes, daysOf})`
  returns `[{type, allowance, pending, booked, remaining}]`. Approved →
  booked, pending → pending, rejected and cancelled excluded. Uses
  per-employee override from org settings when present, else default
  allowance. Half-day precision via round-to-0.5.
- `GET /api/leaves/balances?year=YYYY` — employer only, matrix across all
  users. Returns `{year, rows: [{userId, username, fullName, role, balances}]}`.
- `GET /api/leaves/balances/:userId?year=YYYY` — self or employer via
  `requireOwnerOrEmployer` logic inline in the handler. Returns
  `{year, userId, balances}`.
- `/leaves` page: two-column layout on desktop (balance panel left,
  list panel right), stacked on mobile. Balance panel has a year
  selector (previous / current / next year) and renders a 5-column
  table for employees or a matrix (rows × type columns) for employers.
  List, filters, and existing item styling preserved.
- Tests: 9 new tests in `test-leaves.mjs` covering the balance math —
  baseline, per-employee override, year filtering, user isolation,
  hours-to-days (h÷8) conversion, unknown-type rejection in overrides,
  negative-remaining overbook case, input validation.

### Changed
- `src/storage/reports.js` — exported `approxDaysOff(leave)` so the leaves
  balance computation reuses the existing hours-to-days convention
  (h÷8 for hours-unit leaves, inclusive day-count for days-unit leaves).
- Leaves container widened to 1100px (from 480px) to host the two panels.
- Filter bar restyled as a segmented control using the new design tokens.

### Carried over (not yet implemented)
- **Carry-forward** of unused allowance from the previous year is not yet
  applied. The balance panel notes this, and the `leaves.carryForward`
  org setting continues to be stored without enforcement.
- **Concurrent-leaves warning** (the M7-stored setting) also still
  unenforced — will land in a later drop.

---

## [0.9.1] — 2026-04-21 — Nav + link tweaks

### Changed
- Employees now see **Settings** and **Reports** in the top nav. Backend
  scoping already existed — Settings page gates Organization/Backups/Company
  sections to employer only, and `/api/reports/*` uses `requireOwnerOrEmployer`
  so employees can only pull their own data. The nav bar was the only
  missing piece.
- Links no longer underline on hover (default `text-decoration: none` on
  both states; hover shifts to `--accent-hover` for affordance instead).

---

## [0.9.0] — 2026-04-21 — Milestone 8b.0: UI polish foundations

### Added
- New design tokens layered on the existing palette/spacing scale:
  - `--accent-soft` for tinted hover/active backgrounds
  - `--accent-ring` for focus-ring color (3px, branded)
  - `--surface-2`, `--border-strong` for elevation/depth nuance
  - Semantic colors: `--warning`, `--info` (each with `-soft` variant)
  - Modular type scale: `--text-xs..--text-3xl` at 1.2 ratio
  - `--leading-tight`, `--leading-normal` for line-height vocabulary
  - `--shadow-sm/--shadow/--shadow-lg` for three elevation levels
  - `--t-fast/--t-base` motion timing functions
  - `--radius-sm/--radius/--radius-lg/--radius-xl` for radii consistency
- New shared component classes (in `app.css`):
  - **Buttons:** `.btn-primary`, `.btn-secondary`, `.btn-danger`,
    `.btn-ghost`, `.btn-sm`, `.btn-row`. Loading state via
    `data-loading="true"` attribute (CSS spinner overlay preserves the
    label). 40px min-height on desktop, 44px on mobile (touch target).
  - **Forms:** unified `.form-control` shape — inputs, selects, and
    textareas share styles. Custom select chevron via inline data-URI SVG.
    Custom checkbox/radio with branded focus ring. `aria-invalid="true"`
    triggers a red border.
  - **Tables:** `.data-table` with sticky thead, hover row, tabular-nums.
  - **Badges:** `.badge--neutral/success/warning/danger/info/accent`.
  - **Alerts:** `.alert--error/success/warning/info` with semantic
    coloring. Existing `.message.error/success` kept for back-compat.
  - **Empty states:** `.empty-state` with `__title` and `__action` slots.
  - **Skeletons:** `.skeleton` with pulse animation; `.spinner` for
    inline use.
  - **Toasts:** `#toast-root` container plus `.toast` + `.toast--*`
    variants. Slide-in/slide-out animations.
  - **Utilities:** `.sr-only` for screen-reader-only text.
- New `app.js` helpers:
  - `setLoading(button, loading)` — alternative to `setBusy()` that uses
    the CSS spinner overlay and preserves the original label.
  - `toast(message, kind, options)` — programmatic toasts with
    `success/error/warning/info` kinds, configurable duration, optional
    dismiss button, ARIA `role=alert/status` based on kind.

### Changed
- **Palette refined:** navy accent moved from `#2b4a6f` to `#284a72` for
  better contrast at small sizes. Neutrals warmer on light, cooler on
  dark. Borders gain a `--border-strong` companion for hover affordance.
- **Typography tightened** to a 1.2 modular scale; h1 is now `--text-3xl`
  (32px), h2 `--text-2xl` (26px), h3 `--text-lg` (18px). Letter-spacing
  set to `-0.02em` on h1 for a more deliberate look.
- **Form controls** unified across all input types — same height,
  padding, border treatment, focus ring. Selects get a custom chevron.
  Checkboxes and radios fully custom-styled (no more native browser UI).
  3px branded focus ring (`--accent-ring`) replaces the old 2px outline.
- **Buttons** now use `inline-flex` so icon+label combinations align
  cleanly. Default min-height 40px (44px on mobile) for accessibility.
  Press feedback via subtle `translateY(1px)`. Loading spinner overlay
  via `data-loading` attribute.
- **Cards** gain `--shadow-sm` for subtle depth.
- **Smooth color-mode transitions:** explicit `transition` on root layout
  elements so theme flips don't snap. Disabled by `prefers-reduced-motion`.
- **Focus visibility:** `:focus-visible` ring is now consistent across all
  interactive controls (2px solid + 2px offset) — keyboard users get a
  visible indicator without flashing it on every mouse click.
- **Dark mode tuned:** richer surface tokens, stronger shadow tokens,
  semantic colors with appropriate `-soft` variants for both light and
  dark contexts.

### Accessibility
- Global `prefers-reduced-motion` media query disables transitions and
  animations app-wide.
- `:focus-visible` rather than `:focus` so the ring appears only for
  keyboard navigation, not mouse clicks.
- Toasts respect ARIA: `role="alert"` + `aria-live="assertive"` for
  errors, `role="status"` + `aria-live="polite"` for everything else.
- `.sr-only` utility class for screen-reader-only labels on icon-only
  buttons (will be applied per-page in M8b.1+).

### Strategy
- Foundations only. **No per-page HTML/JS touched** — every page inherits
  the new tokens via existing CSS variables. This means `app.css` got a
  full rewrite while every per-page CSS file (`employee.css`, `punch.css`,
  etc.) continues to work unchanged.
- Token names from the previous palette were preserved (`--accent`,
  `--gap-4`, `--text-sm`, etc.) so existing references resolve correctly.
- Bare element selectors (`input`, `button`, `h1`) still work — page CSS
  using these without explicit classes inherits the new look.
- Per-page polish starts in M8b.1 with the **Settings page** (most
  form-dense, stress-tests new input/select/checkbox styles).

### Files touched
- `public/app.css` — full rewrite, 13 sections, ~700 lines
- `public/app.js` — added `setLoading()` and `toast()`. Original
  `postJson`, `showMessage`, `setBusy`, color-mode IIFE preserved unchanged.

### Known
- Per-page CSS files have not been audited against the new tokens. They
  resolve at runtime since token names are preserved, but visual fit will
  be addressed in M8b.1+.
- The dark-mode token block is duplicated between `[data-theme="dark"]`
  and `@media (prefers-color-scheme: dark)`. Could be DRYed via a CSS
  custom-property indirection but the duplication is contained and
  obvious; left as-is for clarity.

---

## [0.8.2] — 2026-04-20 — Fix: make [hidden] bulletproof app-wide

### Fixed
- Same drawer-visibility bug from 0.8.1, reported again — the previous fix
  (scoping `display: flex` to `:not([hidden])` on just the drawer) was
  correct in isolation but fragile: any future CSS rule that sets `display`
  on an element using the `hidden` attribute would bring the bug back. With
  27+ elements across the app relying on `hidden` for show/hide, that's a
  big surface area for repeat mistakes.
- Real fix: a single global rule in `app.css`:
  ```css
  [hidden] { display: none !important; }
  ```
  This guarantees that any element with `hidden` is always hidden, no
  matter what other CSS says. Reverted the `:not([hidden])` scope on the
  drawer back to a plain `display: flex` since the global rule now
  enforces correctness.

### Lesson
- The browser's built-in `[hidden] { display: none }` rule has the same
  specificity as any class selector, so `.foo { display: flex }` wins by
  virtue of coming later — even though it wasn't meant to. Design systems
  like Bootstrap, Tailwind, and MUI all apply this `!important` rule
  globally for exactly this reason. Adopting the same pattern now.

---

## [0.8.1] — 2026-04-20 — Fix: top-bar drawer bug (superseded by 0.8.2)

### Fixed
- The mobile hamburger drawer (`.topbar__drawer`) had `display: flex` set
  unconditionally. This overrode the browser's built-in `[hidden] { display: none }`
  rule, leaving the drawer permanently visible on desktop — a vertical list
  of nav links hanging below the top bar on top of page content. As a side
  effect, the drawer also covered the area where the avatar dropdown would
  open, making avatar clicks appear to do nothing (the menu *was* opening,
  but the drawer was on top of it at the same `z-index` and vertical
  position).
- Initial fix: scoped `display: flex` to `:not([hidden])` on just the
  drawer. Superseded by 0.8.2's global solution.

---

## [0.8.0] — 2026-04-20 — Milestone 8a: Navigation shell + company identity ✅

### Added
- **Sticky top navigation bar** on every authenticated page, via a shared
  `public/topbar.js` module that mounts itself on DOM load. No per-page
  markup required.
- **Role-filtered nav**: employers see Employees · Calendar · Leaves ·
  Punches · Reports · Settings. Employees see Calendar · Leaves · Punches.
- **Avatar dropdown** on the right: user's name + role, "View my profile",
  and "Sign out". Click avatar to open; click elsewhere or press Escape
  to close.
- **Mobile hamburger drawer** below 900px — same nav items, touch-target
  sized.
- **Company logo upload** — encrypted at rest with AAD `"company:logo"`,
  same pattern as employee pictures. Client-side resize to 256×256 PNG
  before upload.
- **Company name** field (up to 80 chars), stored in `org-settings.json`
  alongside existing organization settings.
- **New Settings section "Company"** on `/settings` — logo preview, file
  picker, remove button, name input. Employer only.
- **New endpoints:**
  - `GET /api/branding` — company name + hasLogo flag. Authenticated, any role.
  - `GET /api/branding/logo` — decrypted image bytes. Authenticated, any role.
  - `PUT /api/branding/logo` — multipart upload, employer only.
  - `DELETE /api/branding/logo` — employer only.
- Test suites:
  - `tests/test-company-logo.mjs` — 14 tests covering round-trip, AAD
    binding against the master key, mode 0600, overwrite, remove
    idempotency, persistence.
  - `tests/test-org-settings.mjs` — 9 new tests for the company-name
    field: defaults, trim, null handling, type validation, 80-char cap.

### Changed
- `src/storage/org-settings.js` — added a `company` block to the default
  settings with a `name` field. Validation trims and caps at 80 chars.
  Partial-merge semantics: patching company alone doesn't disturb leaves
  or backups (and vice versa).
- `src/routes/settings.js` — extended with the four branding endpoints
  above.
- `public/index.html` — old home page (which duplicated nav as cards) replaced
  by a minimal dashboard placeholder. Ready for future iteration.
- All 11 authenticated pages updated: `<link rel="stylesheet" href="/topbar.css">`
  in `<head>`, and `import { mountTopBar }` + `mountTopBar();` at the top
  of each module.
- Redundant "← Home" back-links removed from pages where the top bar now
  provides equivalent navigation. Context-specific back-links ("← Back to
  list") preserved.

### Roadmap
- Milestone 8 split into three tracks:
  - **M8a** (this release): navigation shell + company identity ✅
  - **M8b**: per-page visual polish, design tokens, component refinement,
    a11y pass, concurrent-leaves warning banner. Iterative — one page per
    small drop.
  - **M8c**: PWA manifest + offline-friendly clock-in.
- Also shipped in this drop: the earlier roadmap swap between M9 and M10.
  M9 is now **i18n**, M10 is now **Backups**. All forward-reference copy
  and code comments updated (language field hint, backup-section notice,
  user-prefs / org-settings docstrings). Legacy `TODO(M10)` comments in
  `employees.js` and the password-change hint on `employee-new.html`
  repointed to M11 (Hardening).

### Files touched
- `src/storage/company-logo.js` (new)
- `src/storage/org-settings.js` (added company block + validation)
- `src/routes/settings.js` (added branding endpoints)
- `server.js` (wire-up)
- `public/topbar.js` (new, shared module)
- `public/topbar.css` (new)
- `public/settings.html`, `.css`, `.js` (+Company section)
- `public/index.html`, `.js`, `.css` (dashboard placeholder)
- Every other authenticated page's HTML (+topbar.css link) and JS
  (+mountTopBar import + call)
- `tests/test-company-logo.mjs` (new)
- `tests/test-org-settings.mjs` (extended)
- `README.md` (M8 split into M8a/M8b/M8c, M8a ticked)

---

## [0.7.0] — 2026-04-20 — Milestone 7: Settings page ✅

### Added
- New storage modules:
  - `src/storage/user-prefs.js` — per-user language + color mode, plaintext
    `data/user-prefs.json` keyed by user id. Atomic writes, mode 0600.
  - `src/storage/org-settings.js` — company-wide policy: default leave
    allowances per type (vacation / sick / appointment / other), per-employee
    overrides, carry-forward flag, concurrent-leaves policy, backup
    scheduler scaffold. Plaintext `data/org-settings.json`, mode 0600.
- New routes in `src/routes/settings.js`:
  - `GET /api/settings/me` — current user's prefs (authenticated)
  - `PUT /api/settings/me` — update own prefs
  - `GET /api/settings/org` — employer only
  - `PUT /api/settings/org` — employer only
- New page `/settings` with three sections:
  - **Account** — language + color mode (light / dark / system). Visible
    to all users.
  - **Organization** — default leave allowances per type, per-employee
    override table, carry-forward toggle, concurrent-leaves toggle.
    Employer only.
  - **Backups** — enabled flag, schedule (off/hourly/daily/weekly),
    retention count, three action buttons (run full, run delta, browse).
    Scaffold only — all controls disabled with a "coming in M9" notice.
- Home nav card "Settings".
- Color mode applied immediately on every page via a boot IIFE in
  `public/app.js` that reads `/api/settings/me` and sets
  `<html data-theme="light|dark">`. `system` removes the attribute and
  defers to `@media (prefers-color-scheme: dark)`.
- Dark-mode tokens added to `public/app.css` for both explicit
  (`[data-theme="dark"]`) and system-follow (`@media ... :not([data-theme])`)
  paths.
- Test suites:
  - `tests/test-user-prefs.mjs` — 17 tests covering defaults, validation,
    persistence, removeUser, cache invalidation, corrupt-file recovery.
  - `tests/test-org-settings.mjs` — 26 tests covering the leave allowance
    partial-merge contract, per-employee override replacement, backup
    validation, persistence, and the defaultAllowances per-type merge bug
    found and fixed during testing.

### Changed
- Roadmap reshuffled: Settings is the new M7. UI polish shifts to M8,
  Backups to M9, i18n to M10, Hardening to M11.

### Fixed
- `orgSettingsStore.update()` was replacing `defaultAllowances` wholesale
  on partial patches — a patch setting `vacation: 25` would nuke `sick`,
  `appointment`, and `other`. Caught by the unit tests, fixed with an
  explicit per-type merge for `defaultAllowances` (while keeping the
  "replace whole map" semantics for `perEmployeeOverrides`, which is what
  the UI expects).

### Known
- Deleting a user leaves their entry in `user-prefs.json` orphaned. Harmless
  (no sensitive data, ~100 bytes per user), fix deferred to a future pass
  when the employees route is touched again.

### Files touched
- `src/storage/user-prefs.js` (new)
- `src/storage/org-settings.js` (new)
- `src/routes/settings.js` (new)
- `src/routes/pages.js` (+`/settings`)
- `server.js` (wire-up)
- `public/settings.{html,css,js}` (new)
- `public/app.js` (color-mode bootstrap)
- `public/app.css` (dark-mode tokens)
- `public/index.html` (Settings nav card)
- `tests/test-user-prefs.mjs` (new)
- `tests/test-org-settings.mjs` (new)
- `README.md` (roadmap renumber + M7 ticked)

---

## [0.6.1] — 2026-04-20 — Cache + picture-rendering fixes

### Fixed
- Profile detail page (`/employees/:id`) no longer probes `/picture` with a
  `HEAD` request that returned `405 Method Not Allowed`. The `/api/employees/:id`
  payload now includes `profile.hasPicture`, and the client reads it directly.
- Static-file caching now uses a weak ETag derived from mtime+size, honors
  `If-None-Match` with `304 Not Modified`, and sends
  `Cache-Control: no-store, must-revalidate`. Browsers will pick up edits
  immediately on the next request instead of serving stale cached assets.

### Changed
- `serveStatic(urlPath, res, rootDir)` now accepts an optional `req` argument
  to read `If-None-Match`. `server.js` updated to pass it through.

### Files touched
- `src/http/static.js`
- `src/routes/employees.js`
- `public/employee.js`
- `server.js`

---

## [0.6.0] — 2026-04-20 — Milestone 6: Reports ✅

### Added
- New storage module `src/storage/reports.js` — pure aggregation functions
  over the plaintext fields of punches and leaves. No decryption needed.
- New routes:
  - `GET /api/reports/hours/:id` — per day/week/month hour totals
  - `GET /api/reports/hours/:id.csv` — same data, CSV download
  - `GET /api/reports/leaves/:id` — monthly leaves summary
  - `GET /api/reports/leaves/:id.csv` — CSV download
  - `GET /api/reports/summary` — employer-only team dashboard
- New page `/reports` with employee picker (employer only), date-range
  controls, day/week/month chips, stats grid for leaves, CSV download
  buttons, and a print-friendly view via `@media print`.
- ISO 8601 week grouping, overnight shift splitting at midnight, open-shift
  clipping to "now".
- Home nav card "Reports".
- Test suite `tests/test-reports.mjs` — 24 tests.

### Fixed
- Router was registering `/:id` before `/:id.csv`, so CSV requests were
  greedy-matched as JSON with the `.csv` in the id, returning 403. Specific
  routes now register first (first-match-wins stays consistent).

### Security
- CSV responses include `Content-Disposition: attachment` and
  `Cache-Control: private, no-store` so sensitive reports don't leak via
  shared caches.

---

## [0.5.1] — 2026-04-19 — Team calendar (M5 addition)

### Added
- New route `GET /api/leaves/approved` — returns approved leaves only with
  `reason` and `notes` stripped. Lets employees plan around colleagues
  without exposing private details.
- New page `/leaves/calendar` — month grid, prev/next nav, type-colored
  bars overlaid on day cells. Own leaves highlighted with an inset border.
- Home nav card "Team calendar".
- "View calendar" button on `/leaves` next to "+ Request leave".
- Responsive CSS — usernames hide on ≤600px screens, leaving color-coded
  bars only.

### Security
- The new endpoint only shows `approved` leaves; `pending`, `rejected`, and
  `cancelled` never appear. Server-side field stripping verified end-to-end
  against a full-response-body substring check.

### Documentation
- No README task added — this is an enhancement to the already-✅ M5.

---

## [0.5.0] — 2026-04-19 — Milestone 5: Leaves ✅

### Added
- New storage `src/storage/leaves.js` — NDJSON event log partitioned by
  creation month, one event per workflow transition (created / approved /
  rejected / cancelled). A reducer folds the stream into current state.
- New routes:
  - `GET /api/leaves` — list (role-filtered)
  - `GET /api/leaves/:id` — detail (owner or employer)
  - `POST /api/leaves` — create request
  - `POST /api/leaves/:id/approve` — employer only
  - `POST /api/leaves/:id/reject` — employer only, with encrypted notes
  - `POST /api/leaves/:id/cancel` — owner (pending only) or employer
- New pages `/leaves`, `/leaves/new`, `/leaves/:id`.
- Leave types: vacation, sick, appointment, other.
- Leave units: days (YYYY-MM-DD range) or hours (intraday time range).
- Workflow state machine with proper transition validation.
- Home nav card "Leaves".
- Test suite `tests/test-leaves.mjs` — 28 tests.

### Changed
- Updated README Milestone 8 from "Mobile polish" to "UI polish (desktop,
  mobile, general look & feel)" with a broader checklist.

### Security
- `reason` (create) and `notes` (reject) fields encrypted with AES-256-GCM
  and AAD-bound to the leave id. Status, dates, and types stay plaintext
  for calendar and reports.

---

## [0.4.0] — 2026-04-19 — Milestone 4: Clock in / out ✅

### Added
- New storage `src/storage/punches.js` — NDJSON per employee per month with
  plaintext `ts` + `type` (for reports) and encrypted `comment` + `geo`
  (optional). AAD = `"punch:<employeeId>:<ts>"`.
- New routes:
  - `GET /api/punches/status` — am I clocked in?
  - `POST /api/punches/clock-in` — with optional comment and geolocation
  - `POST /api/punches/clock-out` — with the same optional fields
  - `GET /api/punches/today` — self-filtered for employees, all for employers
  - `GET /api/punches/by-employee/:id` — day or month of one employee
- New pages `/punch` (big primary button, live status, today's list) and
  `/punches/today` (employer grouped-by-employee view with worked-hours tally).
- Home nav cards "Clock in / out" and "Today" (employer only).
- Guard: can't clock in while already clocked in; can't clock out when not
  clocked in.
- Browser geolocation capture via `navigator.geolocation` (opt-in checkbox).
- Month-boundary edge case handled: `latest()` peeks into previous month
  when current is empty.
- Test suite `tests/test-punches.mjs` — 22 tests.

### Security
- Geolocation coordinates and free-form comments are never in plaintext on
  disk; AAD prevents line swapping between employees.
- Decryption failures on tampered lines return `{ decryptFailed: true,
  comment: null, geo: null }` rather than surfacing the ciphertext.

---

## [0.3.0] — 2026-04-18 — Milestone 3: Employee management ✅

### Added
- New storage `src/storage/employees.js` — encrypted profile JSON and
  encrypted picture bytes, one file per user id. AAD = `"employee:<id>"`.
- Field-level allowlists `EMPLOYEE_EDITABLE` (fullName, age, address,
  contacts) vs `ALL_EDITABLE` (adds position, comments — employer only).
- New routes:
  - `GET /api/employees` — employer only
  - `POST /api/employees` — employer only, transactional (rollback on
    profile failure)
  - `GET /api/employees/:id` — owner or employer
  - `PUT /api/employees/:id` — role-filtered field updates
  - `DELETE /api/employees/:id` — employer only, with self-delete guard
  - `GET/PUT/DELETE /api/employees/:id/picture`
- New pages `/employees`, `/employees/new`, `/profile`, `/employees/:id`.
- Home page: role-aware nav cards (Employees card visible only to employers).
- Client-side picture resize via `<canvas>` to 400×400 JPEG — keeps the
  server dependency-free.
- `usersStore.deleteById()` helper.
- Home, login, setup pages refactored to split CSS/JS into separate files
  (no inline styles or scripts anywhere in `public/`).
- Test suite `tests/test-employees.mjs` — 28 tests including AAD swap-
  detection.

### Changed
- `public/index.html` rewritten as a logged-in landing page with the nav
  grid and a sign-out button.

### Security
- Picture route sends `Cache-Control: private, no-store`.
- `Set-Cookie` flag `Secure` is controlled by `NODE_ENV=production`.

---

## [0.2.0] — 2026-04-18 — Milestone 2: Security foundation ✅

### Added
- Passphrase prompt on startup (hidden-echo TTY or `PICA_PASSPHRASE` env var).
- Master key derived from passphrase via `crypto.scrypt` (N=2¹⁷), lives in
  RAM only. Verifier in `config.json` confirms correctness.
- AES-256-GCM helpers: `encryptBlob`, `decryptBlob`, `encryptField`,
  `decryptField`, all with optional AAD.
- Password hashing: `hashPassword`, `verifyPassword` via `crypto.scrypt`
  (N=2¹⁵), inline `scrypt$N$r$p$salt$hash` format.
- Signed session cookies (HMAC-SHA256, key derived from master key so
  sessions survive restart). 7-day fixed expiry.
- Users store `src/auth/users.js` — plaintext JSON with hashed passwords,
  atomic writes, 0600 file permissions.
- RBAC middleware: `requireAuth`, `requireRole('employer')`,
  `requireOwnerOrEmployer`.
- In-memory sliding-window rate limiter (10 attempts / 60s per IP).
- Login / logout / first-run setup routes.
- First-run setup wizard: prompts for passphrase and creates the first
  employer account.
- Front-end pages `setup.html`, `login.html` with CSS + JS split out.
- Test suites `tests/test-crypto.mjs` (23) and `tests/test-auth.mjs` (33).

### Security
- Config file written with mode 0600 and gitignored.
- Session key is deterministic from the master key but never written — if
  the master key changes, all sessions invalidate automatically.
- Generic "Invalid username or password" on login (no account-existence
  disclosure); fake `verifyPassword` run even for missing usernames to
  narrow the timing gap.

---

## [0.1.0] — 2026-04-18 — Milestone 1: Server foundation ✅

### Added
- Minimal HTTP server (Node stdlib only) with graceful shutdown on
  SIGINT/SIGTERM.
- Router with method+path matching and `:param` capture. Returns 405 for
  method mismatch, 404 for unknown paths.
- Body parser: JSON, `application/x-www-form-urlencoded`,
  `multipart/form-data` (binary-safe).
- Cookie parser and `Set-Cookie` serializer with HttpOnly/SameSite/Secure.
- Response helpers: `json`, `html`, `text`, `redirect`, `noContent`,
  `notFound`, `forbidden`, `unauthorized`, `badRequest`, `serverError`.
- Static file server with MIME types and path-traversal protection.
- Config loader `config.json.example` with defaults and validation.
- Timestamped logger with level filtering and color-free access logs.
- Placeholder landing page at `public/index.html`.

### Fixed
- Multipart parser initially returned empty fields; root cause was
  lowercasing the entire Content-Type header, which broke boundary case
  preservation. Fixed by keeping the original header for boundary
  extraction.

---

## [0.0.0] — 2026-04-18 — Milestone 0: Project bootstrap ✅

### Added
- `README.md` with goal, requirements, threat model, security model,
  architecture, and ten-milestone roadmap.
- `LICENSE` — MIT.
- `.gitignore` — protects runtime data (`/data`, `/backups`, `/config.json`)
  and keys (`*.key`, `.passphrase`, etc.), plus standard OS and editor
  cruft. Defensive `node_modules/` rule even though Pica has no npm deps.
- `.editorconfig` — LF, UTF-8, 2-space indent, trim whitespace except in
  Markdown.
- Repository layout skeleton under `src/` and `public/`.
