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

## [0.16.4] — 2026-05-02 — Employee summary page (employer view)

Clicking an employee from the Employees list used to drop you straight
into the profile editor. That's overkill when you just want to know
"how is this person doing?" — so 0.16.4 introduces a summary page.

### What's new

When an employer clicks an employee, they now land on a summary view
showing:

- **Profile header** — avatar, name, role, position, plus two action
  buttons (Reset password, Go to profile)
- **Stats row** — three widget-style cards:
  - This week's worked hours (with the user's weekly target as the
    caption)
  - Bank balance (or "no bank time owed" if zero)
  - Pending approvals counts (leaves + corrections, or "all caught up")
- **Upcoming leaves** — approved leaves whose date range either starts
  in the next 30 days or is currently in progress
- **Items awaiting your decision** — full list of pending leaves and
  corrections from this employee, with click-through to review

The full profile editor moved to `/employees/:id/profile` (a new
sub-route). The "Go to profile →" button on the summary takes you
there.

### URL changes

| Before                       | After                              |
|------------------------------|------------------------------------|
| `/employees/:id` (editor)    | `/employees/:id` (summary)         |
| —                            | `/employees/:id/profile` (editor)  |

The employees-list and any "go to this employee" link still target
`/employees/:id` — the destination just renders differently. From the
profile editor, the back-link returns to the summary instead of the
employees list (it's the more useful place to go after editing).

### Reset password button

Disabled with a tooltip saying it's coming in a future release. The
button has a click handler attached anyway (showing a "not yet
available" message) so when M12 lands and we just remove the
`disabled` attribute, the button is already wired.

### Backend — `GET /api/employees/:id/summary`

New employer-only endpoint returning the page's data in one round-trip.
Computed:
- **week**: `{ from, to, hours, scheduled }` — Mon-Sun ISO week
  containing today, hours from `hoursReport`, scheduled from the
  user's resolved working-time settings (with per-employee override
  honored).
- **bankHours**: from `correctionsStore.computeBank({ userId })`.
- **upcomingLeaves**: approved leaves whose `[start, end]` window
  intersects `[today, today+30d]`. Sorted by start date.
- **pending.leaves** + **pending.corrections**: pending items from
  this employee, sorted by start date.

The 30-day horizon is fixed for now; when M12 adds password reset
we may also want to make this configurable.

### Files touched
- **New**: `public/employee.html`, `public/employee.js`,
  `public/employee.css` — the summary page
- **Renamed**: the old summary→`/employees/:id` route's files moved
  from `employee.{html,js,css}` to `employee-profile.{html,js,css}`.
  Internal asset references and the URL-parsing logic in
  `employee-profile.js` updated to handle the new
  `/employees/:id/profile` path.
- `src/routes/pages.js` — added `/employees/:id/profile` route
  before the existing `/employees/:id` route. Order matters
  (more-specific paths first).
- `src/routes/employees.js` — added `GET /api/employees/:id/summary`
  endpoint. The route module's destructure now also accepts
  `punchesStore`, `leavesStore`, `correctionsStore`,
  `orgSettingsStore`. Imported `hoursReport` from the reports
  storage module.
- `server.js` — pass the new stores into the employees route
  registration.
- `public/locales/en-US.js` + `pt-PT.js` — 18 new keys under
  `employee.summary.*` and `title.employeeSummary`.
- `public/sw.js` — `CACHE_VERSION` bumped to `pica-cache-v16`.
- `package.json` — patch bump to 0.16.4.
- `docs/architecture.md` — updated the repository layout to
  reflect the new file split. Last-touched bumped.

### Tests
- 12-suite regression: 363 passing, 0 failing (was 361; +3 from
  the frontend-imports audit picking up the new `employee.js`).
- No backend test added for the new summary endpoint yet — the
  primitives it composes (`hoursReport`, `computeBank`,
  `leavesStore.list`, `correctionsStore.list`) are all covered by
  existing tests. A `test-employees-summary.mjs` is a reasonable
  follow-up.

### Honest disclosures
- **The "upcoming leaves" widget shows leaves intersecting [today,
  today+30d]**, not just leaves starting in that window. So a leave
  that started yesterday and ends next week shows up — which feels
  right (the person *is* on leave) but might surprise someone reading
  "upcoming" strictly. Tell me if you want a stricter "starts in the
  next 30 days" filter.
- **Approved leaves more than 30 days out vanish from the summary.**
  They're still in the full leaves list, just not surfaced on the
  summary card. Reasonable for a "what should I be aware of soon"
  view but worth noting.
- **The summary's pending-detail card duplicates the count widget.**
  The stats row says "2 leaves pending"; the detail card lists those
  same 2 leaves with click-through. Could feel redundant — but the
  count is for a glance, the detail is for action. Keeping both.
- **No live updates.** Page loads once, doesn't auto-refresh. The
  dashboard auto-refreshes on visibilitychange; I considered adding
  the same here but the summary page is a dive-in destination, not
  an at-a-glance view, so a stale refresh felt less valuable. Easy
  to add.
- **"Reset password" is non-functional by design.** Disabled button
  with a tooltip and a click handler that shows a placeholder
  message. Will become real in M12.
- **The backend route is new and untested by automated tests.**
  Smoke-verified end-to-end (alice's leave moves from `pending` to
  `upcomingLeaves` after admin approves it; bank balance reads
  correctly; 403 for non-employer; 404 for unknown id). I'd rather
  ship it now than block on writing the test suite first.
- **Employer viewing themselves** lands on a summary of themselves.
  No special-case. The "This week" stat reads correctly, bank reads
  correctly, pending shows their own approvals queue (typically 0
  for an employer). Acceptable.

---

## [0.16.3] — 2026-05-02 — Reports: fix chip selector clash from 0.16.2

The 0.16.2 team-overview added period chips (Today / This week /
This month) using class `.chip` — same class as the existing
group-by chips (Day / Week / Month) in the per-employee detail
section below. The existing reports.js had a global handler:

```js
for (const chip of document.querySelectorAll('.chip')) { ... }
```

That selector now matched both chip groups. Clicking a team-overview
chip would:
1. Set `groupBy = chip.dataset.groupby` — which is `undefined` for
   team chips (they use `data-period`).
2. Fire `refresh()` → `GET /api/reports/hours/:id?groupBy=undefined`
   → server replied 400 with `groupBy must be day, week or month`.
3. Stomp the active state of the per-employee chips along the way.

User reported the visible 400 errors and a red banner with the
groupBy validation message. Smoke missed it because the smoke didn't
exercise chip interactions.

### Fix

Scoped the existing handler to `.controls-grid .chip[data-groupby]` —
exactly the chips it was meant to handle. The team-overview chips
already had their own scoped handler in `wireTeamPeriodChips()` that
listens on the chips' parent element and matches `[data-period]`,
so nothing changed there.

### Files touched
- `public/reports.js` — narrowed the global `.chip` querySelectorAll
  to a card-scoped, attribute-qualified selector.
- `public/sw.js` — `CACHE_VERSION` bumped to `pica-cache-v15`.
- `package.json` — patch bump to 0.16.3.

### Tests
- 12-suite regression: 361 passing, 0 failing. No code or test
  changes beyond the selector.

### Honest disclosures
- **Smoke didn't catch this in 0.16.2** because it didn't simulate
  chip clicks. A regression test would either need a real browser
  (out of scope until M12 E2E) or a structural lint rule
  ("don't use bare `.classname` selectors when multiple sections
  use the same class"). Practical follow-up: when adding a new
  card/section that reuses common class names like `.chip`, scope
  any `querySelectorAll` to the section's container.
- **The fix is minimal on purpose** — I considered renaming the
  team-overview chips' class to `.team-chip` to make them
  structurally distinct, but that would either require duplicating
  the existing `.chip` styling or adding a `.chip.team-chip` cascade
  that buys nothing the attribute selector doesn't already give us.

---

## [0.16.2] — 2026-05-02 — Reports: team overview table

The Reports page now starts with a cross-employee at-a-glance table
(employer only). One row per user, switchable between today / this
week / this month, showing scheduled vs actually-worked hours.

The previous reports page was per-employee only — to compare staff
you had to switch the employee picker for each one. The new section
flips that: see everyone in one glance, then drill in via the
existing per-employee detail below.

### Added — `GET /api/reports/team-hours?period=today|week|month`

Employer-only. Returns:

```json
{
  "period": "month",
  "label": "2026-05",
  "from": "2026-05-01",
  "to":   "2026-05-31",
  "rows": [
    { "id": "...", "username": "alice", "fullName": "Alice Anders",
      "hasPicture": true, "scheduled": 168, "worked": 87.5,
      "role": "employee" },
    ...
  ]
}
```

Computation:
- **Today**: `[today, today]`. Scheduled = the user's `dailyHours`.
- **Week**: ISO week (Mon-Sun) containing today. Scheduled = `weeklyHours`.
- **Month**: the calendar month containing today. Scheduled =
  `dailyHours × number of weekdays in the month`. Excludes Sat/Sun;
  doesn't yet account for public holidays.
- **Worked**: reuses the existing `hoursReport()` storage helper
  (which pairs in/out punches and clips intervals to the requested
  range, ±0.1h precision).

Per-employee `dailyHours`/`weeklyHours` come from `org-settings`
via `resolveWorkingTimeFor(userId)` — the same resolver used by the
punch page's daily indicator. So per-employee overrides set in
Settings → Organization → Working time are honored automatically.

### Added — Team overview section on `/reports`

A new card, employer-only, at the top of the page:

- Section title: "Team overview"
- Period switcher chips: Today / This week / This month (defaults to month)
- Period range label (e.g. "2026-05" or "2026-04-27 → 2026-05-03")
- Table with four columns: Period · Staff · Scheduled · Timesheets
- Avatar in the Staff column: profile picture if available, otherwise
  a circle with the first letter of the name as a placeholder
- Empty state for "no employees yet"
- Error state with the i18n "Couldn't load" message if the fetch fails

The original per-employee detail sections (Worked hours, Leaves)
stay below, unchanged. Mobile gets the same scroll-wrap pattern as
the overrides table from 0.15.4 (smaller font, tighter padding,
horizontal scroll if the columns don't fit).

### Files touched
- `src/routes/reports.js` — new `/api/reports/team-hours` route +
  private `computePeriod` / `isWeekday` / `ymdOf` / `pad2` / `round1`
  helpers. Function signature now also accepts `employeesStore` and
  `orgSettingsStore` (passed in from server.js).
- `server.js` — wired `employeesStore` + `orgSettingsStore` into
  the reports route registration.
- `public/reports.html` — new `<section id="team-section">` between
  the message div and the controls card.
- `public/reports.js` — `loadTeamOverview()`, `renderTeamRows()`,
  `wireTeamPeriodChips()`, plus initialization in the existing
  employer branch of the IIFE.
- `public/reports.css` — `.team-table`, `.team-staff`,
  `.team-avatar`, `.team-avatar--placeholder`, `#team-range`,
  mobile breakpoint at ≤600px.
- `public/locales/en-US.js` + `pt-PT.js` — 9 new keys
  (`reports.teamOverview`, `reports.periodToday|Week|Month`,
  `reports.teamPeriod|Staff|Scheduled|Worked|Empty`).
- `public/sw.js` — `CACHE_VERSION` bumped to `pica-cache-v14`.
- `package.json` — patch bump to 0.16.2.
- `docs/architecture.md` — last-touched footer bumped.

### Tests
- 12-suite regression: 361 passing, 0 failing. No backend tests
  changed; the new route is exercised by smoke tests but not yet
  by an automated suite. Adding a `test-reports-team.mjs` is a
  reasonable follow-up — the existing `test-reports.mjs` already
  exercises `hoursReport` heavily, so the new test would mostly
  cover the period-boundary helpers and the org-settings
  integration.

### Honest disclosures
- **No automated test for the new route yet.** Verified by smoke
  test (alice 8am→5pm = 9h worked, 8h scheduled today, 168h
  scheduled this month). I'd rather ship this and add the test
  next turn than gate on test coverage for a thin aggregation
  endpoint that reuses well-tested primitives.
- **Monthly scheduled hours are an approximation.** Mon-Fri ×
  `dailyHours` is the most common European workweek model, but it
  doesn't account for: public holidays (which we don't track),
  approved leaves (which would reduce the scheduled hours for
  that user), or non-Mon-Fri schedules (which we don't model
  either). For most teams this is fine — the column is intended
  as a rough comparison baseline, not a payroll-grade calculation.
  If your team has a non-standard work week, the "Scheduled"
  column should be read with a grain of salt.
- **No "currently working" indicator.** I considered adding a
  green dot next to anyone with an open clock-in, but it adds a
  second API call (or a second pass over today's punches) that's
  noticeably out of scope for a UI sketch matching your example
  image. Easy follow-up if useful.
- **Avatar fallback is a single letter, not the silhouette in your
  example.** I went with the simpler placeholder so we don't need
  a new SVG asset. The colored circle with an initial reads cleanly
  enough; if you want a generic person silhouette, send the SVG
  and I'll swap it in.
- **Period switcher resets to "This month" on every page load.**
  No state persistence (localStorage / URL). Felt too small to
  justify the persistence layer; tell me if you'd like it sticky.
- **Sorted alphabetically by name.** No column-click sorting yet.
  The example image was unsorted (or sorted by ID); alphabetical
  felt more useful as a default. If you want click-to-sort by
  Worked or Scheduled, that's another small follow-up.
- **The route accepts only fixed periods** (today/week/month). It
  doesn't take arbitrary `from`/`to` because the per-employee
  detail section below already does that for cases where you need
  custom ranges.

---

## [0.16.1] — 2026-05-02 — Fix broken leave-new + leave detail pages

User reported the leave-request form didn't work. Console:

```
Uncaught ReferenceError: applyTranslations is not defined
  at leave-new.js:6:1
```

Two pages — `/leaves/new` and `/leaves/:id` — were calling
`applyTranslations()` and (in leave-new's case) `translateError()` and
`t()` without importing them from `/i18n.js`. The module crashed at
load time, which meant the form's submit handler never got attached
and the page silently did nothing on click.

### Why this slipped through M9 Drop 2

The batch-translation Python scripts I ran during M9 Drop 2 to add
i18n to dozens of pages had a fragile sed-style heuristic: they
prepended a new import line before existing imports, which worked
for most files but missed the case where I prepended the import
before `import { showMessage` BUT the source code for that file
already had a different shape. The scripts didn't verify their work,
so the failures were silent.

318 tests caught zero of these because the test suite is backend-only
— no test exercises a frontend module load.

### Fix

- **`public/leave-new.js`**: added the missing
  `import { t, translateError, applyTranslations } from '/i18n.js';`
- **`public/leave.js`**: added the same import (uses `t`,
  `translateError`, `applyTranslations`).

### Added — Static import audit test (`tests/test-frontend-imports.mjs`)

To prevent this class of bug from happening again without waiting
for the M12 full E2E browser tests, this drop adds a cheap
static-analysis test that walks every JS file under `public/` and
verifies that any imported i18n function used in the body is
actually in the import list.

The test:
- Knows the i18n.js export list (hardcoded — update when i18n.js
  changes).
- For each `.js` file, finds the destructured import block from
  `/i18n.js` (if any) and the body's function calls.
- Reports a failure for each `name(` call where `name` is an
  i18n.js export but isn't in the file's imports.
- Has an explicit exemption for files that define a local function
  with the same name (preferences.js has its own
  `applyTranslations`).

The test catches the exact bug from this drop in <100ms, runs as
part of the regression alongside the other 11 suites. Verified by
deliberately re-introducing the bug and confirming the test fails
loudly with a clear message pointing at the file and symbol.

This is not a substitute for full module-load testing (which would
need jsdom or a real browser), but it catches the most common
class of bug — missing imports after a refactor — at near-zero
cost.

### Files touched
- `public/leave-new.js` — added missing i18n import.
- `public/leave.js` — added missing i18n import.
- `tests/test-frontend-imports.mjs` — new file: 43 import checks
  across all i18n-using pages.
- `public/sw.js` — `CACHE_VERSION` bumped to `pica-cache-v13` so
  users pick up the fixed JS.
- `package.json` — patch bump to 0.16.1.

### Tests
- 12-suite regression: 361 passing, 0 failing (was 318;
  +43 from the new frontend-imports suite, +0 elsewhere).

### Honest disclosures
- **318 tests passed yesterday and the leave-new page was broken.**
  That's the gap this static audit closes. Backend tests don't
  protect the frontend; the M12 plan calls for full E2E browser
  tests but that's months away. The 100-line static audit added
  here is the 80/20 fix.
- **The audit is narrow on purpose.** It only checks i18n.js
  imports today. Could be extended to other modules
  (`/topbar.js`, `/app.js`) but those have a smaller surface area
  and haven't broken in the same way. If any does, the test is
  easy to extend.
- **The audit doesn't catch every possible runtime error.** A
  typo in a key (e.g. `t('punc.heading')` instead of `t('punch.heading')`)
  would render `[punc.heading]` in the UI but pass the audit.
  That class of bug surfaces immediately on visual inspection — it's
  the silent module-load crash that hurts.
- **No M9-era pages have been re-tested manually after this fix.**
  Just verified the two known-broken files now have the right
  imports and the audit is green across all files. If any other
  page has a similar bug that the audit doesn't catch (e.g.
  hardcoded `punch.heading` typo), please send a screenshot of
  the symptom + console output and I'll patch.

---

## [0.16.0] — 2026-05-01 — Milestone 10: Dashboard widgets

The dashboard placeholder card (which has been promising "at-a-glance
widgets in a future milestone" since M8) is now real. The home page
shows live, role-appropriate widgets above the quick-nav cards.

Milestone 9 (i18n) is closed. Roadmap re-numbered: M10 is dashboard
widgets (this drop), M11 is backups, M12 is the hardening grab-bag
including password management.

### Added — Employer widgets

1. **Pending approvals**: row count of pending leaves and pending
   corrections, with click-through links to the respective list
   pages. Empty state: "All caught up — nothing pending."
2. **Working today**: two sections.
   - *Currently working* — every employee with an open clock-in,
     showing their start time and accumulated duration so far.
   - *Done for the day* — employees who clocked in and out, with
     their punch pairs (e.g. "08:00–12:00, 13:00–17:30") and total
     worked time.
   - Empty state: "No one has clocked in yet today."
3. **On leave today** (full-width): employees with an approved leave
   covering today's date, with their leave type. Click-through to the
   individual leave detail. Empty state: "No one is on leave today."

### Added — Employee widgets

1. **My pending approvals**: count of own pending leaves + own
   pending corrections.
2. **Today's hours**: big-number display of total worked time today,
   accumulating live for the currently-clocked-in case (open in-punch
   counts up to "now"). Below: caption with current clock-in time, or
   the daily target if not currently clocked in. Empty state: "You
   haven't clocked in yet today" + a link to /punch.
3. **Time bank** (full-width): big-number of bank balance, with a
   one-line explanation and a link to /corrections. If balance is
   zero, says so plainly without the explanation noise.

### Layout
- Mobile: single-column stack.
- Desktop (≥900px): 2-column grid. The third widget (on-leave-today
  / bank summary) spans both columns to give it room.
- Each widget is a card with a title bar (title + optional "View
  all →" action link), a body that renders independently, and clear
  loading / empty / error states.

### Auto-refresh on tab focus
The dashboard listens for `visibilitychange`. When the tab returns
to visible (user comes back from another tab), all widgets re-fetch.
This gives a "live" feel without polling — punches and approvals
that happened while you were away update on your next glance.

### Per-widget independent failure
Each widget renders independently. If `/api/leaves` is slow or
fails, the punches widget still renders. Failed widgets show
"Couldn't load" + a retry button that re-runs the whole load
cycle (cheap, network round-trips are small here).

### Implementation notes
- **All client-side aggregation**: no new backend endpoints. The
  dashboard fetches existing endpoints in parallel
  (`Promise.allSettled`) and assembles the views.
- **Endpoints used**: `/api/employees`, `/api/leaves` (filtered to
  pending client-side, since the route doesn't accept ?status),
  `/api/corrections?status=pending`, `/api/punches/today`,
  `/api/leaves/approved`, `/api/corrections/bank`,
  `/api/settings/working-time`.
- **Punch grouping**: a small helper on the client groups raw
  punches into in/out pairs per employee, identifies the open
  in-punch (if any) for "currently working" status, and computes
  total worked time by summing closed pairs and adding the open
  duration.
- **Translations**: 26 new keys under `widgets.*` in both en-US
  and pt-PT. All visible strings use `t()` / `tn()`.

### Files touched
- `public/index.html` — replaced the placeholder card with a
  `<div id="widget-grid">` container; widgets are JS-rendered.
- `public/index.js` — full rewrite (~ 400 lines): widget framework,
  6 render functions (3 employer, 3 employee), parallel-fetch
  orchestration, visibility-based refresh.
- `public/index.css` — widget grid + widget card styles.
  Big-number, count pill, list-row, section-head primitives.
- `public/locales/en-US.js` + `pt-PT.js` — added 26 `widgets.*`
  keys per locale.
- `public/sw.js` — `CACHE_VERSION` bumped to `pica-cache-v12`.
- `package.json` — minor bump to 0.16.0.
- `README.md` — closed M9, re-numbered M10/M11/M12.

### Tests
- 11-suite regression: 318 passing, 0 failing. No backend changes,
  no test changes.
- Integration smoke verified end-to-end with two users (admin +
  alice): all 7 dashboard endpoints return the expected shapes
  with realistic data (alice clocked in, alice's pending leave +
  correction visible to admin, alice's bank=0, etc).

### Honest disclosures
- **No automated UI tests for the widgets.** Verified by smoke +
  hand-running. If a widget renders weirdly with edge data
  (employee with only out-punches, leave that started yesterday
  and ends today, etc.), please send a screenshot and I'll patch.
- **Auto-refresh-on-visibility is the only refresh mechanism.**
  No periodic polling, no live-update websocket. If you sit on
  the dashboard tab for 30 minutes, the data is stale until you
  switch to another tab and back, or reload. Acceptable for the
  use case (this isn't a stock ticker), but worth noting.
- **The "On leave today" widget shows leaves whose date range
  *includes today*** based on the leave's `start` and `end` fields
  treated as YYYY-MM-DD. For day-unit leaves this is exactly right;
  for hour-unit leaves we treat the start day as "on leave" the
  whole day, which is slightly fuzzy but matches normal expectation
  of "is this person off today?". If it ever shows someone who's
  technically only off for a 2pm appointment, that's why.
- **The bank-summary widget is full-width on the employee view.**
  In retrospect this is a lot of horizontal space for one number.
  Trivial to change to side-by-side with today's-hours by removing
  the `widget--wide` flag — let me know if you'd prefer that
  layout. I went wide because it keeps the widget grid balanced
  visually (3 widgets total → odd one spans, like the employer
  on-leave widget).
- **Quick-nav cards stayed at the bottom**, somewhat redundant
  with the always-visible sidebar. Kept because they make sense
  as a launcher on mobile (where the sidebar is hidden behind a
  hamburger) and they don't cost much. If you want them gone, easy.
- **Refresh on tab focus may feel laggy** if a user expects an
  immediate refresh after, say, approving a leave on the leaves
  page. Right now the dashboard only refreshes when the tab
  visibility changes — not on `pageshow`, so navigating back from
  another in-app page via browser back-button might show stale
  data. Could add a router-level event later in M12.

---

## [0.15.4] — 2026-05-01 — Settings: per-employee overrides table — mobile overflow + i18n fix

User reported a visual bug on mobile: the per-employee leave-overrides
table was wider than the viewport, causing the entire Organization
section card to be clipped on the left. Column headers also showed
in English (`VACATION`, `SICK`, `APPOINTMENT`, `OTHER`) on a
Portuguese page.

### Two bugs in one screenshot

1. **Mobile overflow**: The table has 5 columns × number inputs at
   80px each + an employee-name column. Roughly 500px minimum width.
   On a 380px phone viewport, the table forced its parent card to
   stretch beyond the viewport, clipping the left edge of all
   content (including the employee name column users actually need
   to read).
2. **Hardcoded English headers**: M9 Drop 2 translated almost
   everything but missed the dynamically-rendered column headers in
   `renderOverridesTable()` and `renderWorkingTimeOverridesTable()`
   — they were inside `innerHTML` template literals as raw
   English strings.

### Fixes

**Visual / overflow.** Wrapped both overrides tables in a
`<div class="overrides-scroll">` container with `overflow-x: auto`.
The card now keeps a sane width; if the table is wider than the
container, it scrolls horizontally inside that wrapper. On viewports
≤600px, the table also tightens up: `min-width: 0` so it shrinks to
fit, smaller font (`--text-xs`), tighter padding, narrower number
inputs (56px down from 80px). For typical employee counts this means
no horizontal scrolling is needed at all on phones; for larger
teams the scroll kicks in cleanly.

**i18n.** Column headers now use existing dictionary keys:
- Employee → `t('reports.employee')`
- Vacation/Sick/Appointment/Other → `t('leaves.type.*')`
- Daily hours / Weekly hours → new keys
  `settings.dailyHoursShort` / `settings.weeklyHoursShort` (the
  long forms `Daily hours target` / `Weekly hours target` are
  too verbose for a column header).

Also fixed an incidental bug while I was in there: both render
functions had `const t = document.createElement('table')` which
shadowed the imported `t()` translation function in their scope.
That meant any future `t('some.key')` call inside those functions
would have crashed with a "t is not a function" error. The variable
is now named `tbl`. Caught preemptively; no observable regression
in the field.

### Files touched
- `public/settings.js` — both render functions: scroll wrapper class,
  translated column headers, renamed `t` → `tbl` to avoid shadowing.
- `public/settings.css` — added `.overrides-scroll` rule, expanded
  `.overrides-table` rules with a mobile breakpoint at ≤600px.
- `public/locales/en-US.js` + `pt-PT.js` — added
  `settings.dailyHoursShort` / `settings.weeklyHoursShort` keys.
- `public/sw.js` — `CACHE_VERSION` bumped to `pica-cache-v11` so
  users pick up the new CSS+JS.
- `package.json` — patch bump to 0.15.4.

### Tests
- 11-suite regression: 318 passing, 0 failing.
- Dictionary parity verified by the i18n test suite (21/21).

### Honest disclosures
- **No automated visual-regression test.** The fix was verified by
  a smoke test (HTML+CSS+JS shape) and reasoning about CSS layout
  semantics. If the scroll wrapper looks weird in some browser/zoom
  combination I haven't seen, ping me with a screenshot.
- **The mobile breakpoint is at ≤600px.** That's narrower than the
  app shell's main breakpoint (900px) on purpose — between 600px and
  900px the card is wide enough for the full table without needing
  the tighter mobile styling. The 600px boundary roughly matches
  "phone landscape or small tablet portrait".
- **A more ambitious version of this fix** would replace the table
  with a card-per-employee layout on mobile (each row becomes a
  vertical stack: name + 4 labeled inputs). That would be more
  touch-friendly than a horizontally-scrolling table. Not done in
  this drop because the scroll-wrapper fix is faithful to the
  existing table structure and ships in 30 minutes; the card layout
  would be an hour or two and a noticeable UX shift. Easy follow-up
  if you want it.

---

## [0.15.3] — 2026-05-01 — Move Working time into Organization settings

The Working time section is no longer a separate top-level settings
card with its own nav link. It now lives inside the Organization
section, after the leave allowances + per-employee leave overrides
+ leave policy form, separated by a horizontal divider.

This makes the Settings page shorter — three cards instead of four
(Company / Organization / Backups) — and groups the working-time
target with the rest of the company-wide policy where it
conceptually belongs.

### Changed
- **`public/settings.html`**: removed the standalone
  `<section id="working-time">` element and the
  `<a href="#working-time" id="nav-wt">` link from the section
  nav. The working-time `<form>` is now a sibling of the org-form
  inside the existing `<section id="organization">`. The form's
  former `<h2>` heading is now an `<h3>` (it's a sub-section of
  Organization). The form's internal sub-headings ("Default for
  everyone", "Per-employee overrides") are now `<h4>` to keep the
  hierarchy consistent.
- **The duplicate "Per-employee overrides" h-heading** is gone:
  the existing org-form keeps `Per-employee overrides` (for
  leave caps), and the working-time form uses the new
  `settings.wtOverridesHeading` key →
  `Per-employee working-time overrides` /
  `Substituições de horário por funcionário`. Easier to scan,
  no ambiguity which "overrides" applies to what.
- **`public/settings.css`**: added `.section-divider` rule
  (1px top border with vertical spacing) and an `h4` rule
  (smaller, uppercase, muted — clearly subordinate to h3).
- **`public/settings.js`**: removed the dead `navWt` and
  `workingTimeSection` `getElementById` calls and their
  visibility toggles. The working-time form is automatically
  visible alongside the org form because both live inside the
  org section, which is shown to employers as before.
- **`public/locales/en-US.js` + `pt-PT.js`**: added
  `settings.wtOverridesHeading` key in both locales.

### NOT changed
- **The two forms still save independently.** Each has its own
  submit button and POSTs to its own API endpoint. A future drop
  could merge into a single form with one save button if that's
  the preferred UX, but that's a different question — this drop
  is a pure visual restructure faithful to "move it in".
- **Backend API endpoints**: `/api/settings/org` and
  `/api/settings/working-time` both work as before. No data
  schema change. Existing stored settings unaffected.
- **Tests**: 318 across 11 suites, no changes needed (no logic
  changed).

### Files touched
- `public/settings.html` — section restructure
- `public/settings.css` — divider + h4 styling
- `public/settings.js` — removed dead refs (10-line cleanup)
- `public/locales/en-US.js` + `pt-PT.js` — one new key each
- `public/sw.js` — `CACHE_VERSION` bumped to v10 (settings.css/js
  are runtime-cached cache-first; bump invalidates the old copies)
- `package.json` — patch bump to 0.15.3

### Tests
- 11-suite regression: 318 passing, 0 failing. No changes to
  business logic or API.

### Honest disclosures
- **Two save buttons in one card is a minor UX wart.** It's
  unusual to have two submit buttons in a single visual card, and
  on a quick scan a user might wonder which one "saves
  everything". The h3 + divider clearly signals two distinct
  sub-forms, and each save button's label is specific (`Save
  organization settings` vs `Save working-time settings`), but
  there's a tiny cognitive cost. If this becomes annoying, the
  fix is to merge into a single form with one save button — about
  20 lines of JS to coordinate the two API calls.
- **Heading semantics**: the working-time form's inner
  sub-sections are now h4. Visually they're styled as small
  uppercase labels (clearly subordinate to h3). Screen readers
  will announce them at the right level. No accessibility
  regression.

---

## [0.15.2] — 2026-05-01 — Service Worker HTML caching fix (i18n correctness)

The user reported "all pages still in English" after upgrading to
0.15.1, despite a hard refresh. Diagnosis:

- Server is correctly injecting `<html lang="pt-PT">` and
  `<meta name="pica-locale" content="pt-PT">` per-request.
- The user's `<html lang>` was correctly `pt-PT` in the live DOM.
- But `document.querySelector('meta[name="pica-locale"]')` returned
  no element. So `i18n.js` fell back to `en-US` and showed English
  fallbacks everywhere.
- Service Worker (from the previous version's pre-cache install)
  was serving stale HTML that lacked the meta tag.

### Root cause — two SW bugs working together

1. **HTML pages were in the SW pre-cache list.** At install time,
   the SW fetches `/`, `/punch`, `/leaves`, etc. with no cookie —
   the server's `injectLocale()` sees an unauthenticated request
   and emits the default en-US meta. That's then served on every
   subsequent navigation as a cache-first hit, regardless of who's
   logged in or what their locale preference is.
2. **The runtime `networkFirst` handler also cached HTML responses.**
   Even after pre-cache eviction, every successful HTML fetch was
   stored in the cache by URL. Caches are keyed by URL, but HTML
   pages now embed per-user state (the locale meta). So user A's
   locale could be served to user B as an offline fallback for the
   same path — incorrect.

### Fix

- **Removed all HTML pages** from the SW pre-cache list (`PRECACHE_URLS`).
  Static assets (CSS/JS/SVG/manifest/i18n dictionaries) stay
  pre-cached because they're identical for every user.
- **`networkFirst` no longer caches HTML responses.** It only caches
  JSON API responses going forward. HTML pages always go to the
  network; if the network is down, no offline HTML is served (the
  browser shows its standard offline UI).
- `CACHE_VERSION` bumped to `pica-cache-v9` so existing installs
  invalidate their stale HTML cache on next visit.

### Tradeoff

Offline HTML page-load support is gone for now. If the user is
offline and hasn't visited a page recently in the network-first
window (which is essentially "never" since I removed HTML caching),
they get the browser's offline UI instead of a cached page.
Acceptable for now: the punch page's offline-queue feature is what
actually matters for the work-from-the-road use case, and that
operates via `localStorage` and the `/api/punches/clock-in` POST
endpoint (which is queued and replayed on reconnect — entirely
separate from the SW HTML cache).

If we want offline HTML in the future, the right design is to
either (a) cache HTML keyed by `URL + locale` so different locales
get separate cache entries, or (b) drop server-side locale injection
entirely and have `i18n.js` read the locale from a cookie at
runtime. (a) is simpler and preserves the no-flicker property.
Both are out of scope for this fix.

### How users pick up the fix

1. Browser fetches the new `/sw.js` with `CACHE_VERSION = 'pica-cache-v9'`.
2. Old SW activates the new SW (next page navigation).
3. New SW's `activate` handler deletes all caches that aren't `v9`
   — clearing the stale pre-cached HTML.
4. Subsequent navigations go to the network, get the fresh HTML
   with the right meta tag, and `i18n.js` reads it correctly.

If a user is stuck (the SW lifecycle is sometimes finicky), the
unblock is: DevTools → Application → Service Workers → Unregister,
then reload. Or for a clean reset: Application → Storage → Clear
site data.

### Files touched
- `public/sw.js` — `PRECACHE_URLS` no longer contains HTML routes;
  `networkFirst` no longer caches HTML; `CACHE_VERSION` bumped to v9.
- `package.json` — patch bump to 0.15.2.

### Tests
- 11-suite regression: 318 passing, 0 failing. No code/test changes
  beyond the SW.

### Honest disclosures
- **Should have caught this in 0.15.0.** Drop 1 introduced
  per-request HTML rewriting and the SW pre-cache list still
  contained HTML routes from M8c — but the symptom only surfaced
  once translations existed to make the locale visible. I tested
  the locale switch on a fresh install (no SW yet) and it worked,
  which masked the stale-cache problem entirely.
- **The "lang attribute is right but meta isn't" symptom was the
  smoking gun.** Both come from the same `injectLocale()` call. If
  the lang attribute updates, server injection is working — so
  whatever's serving the page must be a snapshot taken at a moment
  when the meta tag wasn't there. That ruled out runtime issues
  and pointed straight at the SW.
- **Offline HTML loss is intentional and small.** No part of Pica's
  workflow needs offline HTML to keep functioning — the punch page's
  offline queue uses `localStorage` for its data and POST replay for
  syncing, both of which the SW doesn't touch. The browser's "you're
  offline" page is fine UX for the rare offline-and-trying-to-load
  case.

---

## [0.15.1] — 2026-04-30 — Milestone 9 (Drop 2): full i18n string coverage

The second drop completes M9. Every page that was English-only after
0.15.0 now switches between en-US and pt-PT via the user's locale
preference. Drop 1 was the foundation (storage + server-side
injection + dictionary parity tests + chrome translated); Drop 2
filled in the remaining ~280 strings across 14 pages.

### Added — `tn()` for pluralization

The new `tn(key, count, params)` helper looks up plural-form
templates using `Intl.PluralRules`. The dictionary value for a
plural key is an object instead of a string:

```js
'punch.queueWaiting': {
  one:   '{count} punch waiting to sync',
  other: '{count} punches waiting to sync',
}
```

`tn('punch.queueWaiting', 1)` → `1 punch waiting to sync`.
`tn('punch.queueWaiting', 5)` → `5 punches waiting to sync`.

PT-PT mirrors the structure with `marcação` / `marcações`. Used in
two places in this drop: the queue badge on the punch page, and the
"synced N offline punches" toast.

### Added — `applyTranslations(root)` helper

A small DOM walker that finds every element with a `data-i18n="key"`
attribute and replaces its `textContent` with `t(key)`. Also handles
attribute translations via `data-i18n-attr="placeholder:some.key"`.

This is the pattern used everywhere in Drop 2: HTML stays declarative
with the English fallback right there in the markup, and a single
`applyTranslations()` call at module load translates the whole page.

### Added — `translateError(errorCode, fallback)` helper

Backend errors that come back with a known `errorCode` get translated
via `errors.<code>` keys; unknown codes fall back to the English
`error` field. Frontend code uses the pattern:

```js
showMessage(el, translateError(result.data.errorCode, result.data.error || 'Generic message'));
```

The dictionary registers the 18 most common business errors (invalid
credentials, already clocked in, leave overlaps, password too short,
etc.). Backend error responses don't yet emit `errorCode` — this is
infrastructure-only; when the backend starts including the field,
every frontend call site will pick up localized error messages with
no further changes. Documented as a future task in M11.

### Added — `fmtDate`, `fmtTime`, `fmtDateTime` Intl helpers

Replace the per-page ad-hoc date formatters with locale-aware
`Intl.DateTimeFormat` wrappers. So far called from corrections.js
and the calendar; per-page replacement of the remaining `formatDate`
helpers is incremental.

### Translated — Drop 2 pages

Every page from the M9 Drop 1 "NOT translated yet" list:

- **`/login`, `/setup`**: form labels, submit/busy states, error
  messages routed through `translateError`.
- **`/punch`**: heading, status block (Clocked in/Clocked out, "since
  09:00" / "last: 09:00"), comment label/placeholder, retry/today
  empty/badges, geo statuses, queue badge with plurals, doPunch
  action toasts, relative-time helper ("just now", "5 min ago",
  "yesterday").
- **`/punches/today`**: heading, link, "Loading…", In/Out badges,
  empty state.
- **`/leaves`**: title, balance heading + table headers, filter chips
  (All / Pending / Approved / Rejected / Cancelled), employee column,
  type tags + status badges (rendered dynamically through
  `t('leaves.type.' + type)` / `t('status.' + status)`), filtered
  empty state.
- **`/leaves/new`**: every form label, type options, unit radio
  labels, end-date hint, reason textarea placeholder.
- **`/leaves/:id`** (detail): every dl/dt label, dynamic status
  banner, decided-on text, Approve / Reject / Cancel buttons,
  cancel-approved confirm, status-updated toast.
- **`/leaves/calendar`**: title, navigation, weekday headers
  (translated via dictionary keys), month name (`Intl.DateTimeFormat`
  for proper localized "abril" vs "April"), legend chips.
- **`/reports`**: title, all controls, group-by chips, leave-month
  options (12 months), table headers, footer total, stat labels
  (Approved / Pending / Rejected / Cancelled / Approved days off),
  CSV download links, dynamic type/status badges in table rows,
  empty state messages.
- **`/employees`**: title, "+ New employee" link, empty hints,
  "no profile yet" placeholder, role badge.
- **`/employees/new`**: every form section header and label,
  position placeholder, role options.
- **`/employees/:id`**: profile heading, all field labels,
  upload/remove picture buttons, "(employer-set)" hint, save button,
  danger zone heading, delete button + confirm, profile-saved toast.
- **`/corrections`**: title, subtitle (own vs employer-view variants),
  bank card label + hint, pending vs history headings, register
  button, dynamic kind chips (both / in only / out only) + justified
  vs no-justification chips + bank chip, status badges, empty state
  variants per role.
- **`/corrections/new`**: title, subtitle, three-radio kind legend
  with all six titles+descriptions, dynamic start/end labels (change
  per kind), justification placeholder, bank-warning paragraph
  (re-rendered via JS so the `{hours}` placeholder appears in a
  `<strong>` element), submit/cancel buttons.
- **`/corrections/:id`**: title, all dl labels, status tag, dynamic
  Arrived/Left labels for kind=in/out, justification placeholder,
  four bank-impact variants (none-single-side / none-justified /
  +Nh added / would-add), Approve / Reject / Cancel / Reverse
  buttons, four approve confirms (one per kind+justified variant),
  cancel/reverse confirms, decision line, reject dialog.
- **`/settings`**: section nav, all four section headings (Company /
  Organization / Working time / Backups), every label, hints,
  carry-forward checkbox label, concurrent-leaves checkbox label,
  save buttons for each section, backup schedule options
  (Off / Hourly / Daily / Weekly), three disabled scaffold buttons.

### Translated — Backend error code dictionary

`errors.*` namespace registered in both locales for 18 business
errors:
- `invalid_credentials`, `unauthorized`, `forbidden`, `not_found`
- `already_clocked_in`, `not_clocked_in`
- `invalid_date`, `invalid_timestamp`, `required`, `invalid_value`
- `password_too_short`, `username_taken`
- `cannot_delete_self`, `cannot_demote_self`
- `leave_overlaps`, `leave_cap_exceeded`
- `correction_window_too_long`, `correction_window_too_short`,
  `correction_end_before_start`

Frontend calls `translateError(errorCode, fallback)` everywhere it
shows a backend error. Today the backend doesn't emit `errorCode`
yet, so every call falls back to the server's English `error`
string — but the wiring is in place so when the backend starts
emitting codes, the frontend instantly localizes without further
changes.

### Files touched
- `public/i18n.js` — added `tn`, `translateError`, `applyTranslations`,
  `fmtDate`, `fmtTime`, `fmtDateTime`. The `t()` semantics are
  unchanged for backward compat.
- `public/locales/en-US.js` + `pt-PT.js` — dictionary expansion from
  ~50 keys to **533 keys each**. Plural keys are objects with
  `one`/`other`. `errors.*` namespace registered.
- 15 HTML files updated with `data-i18n` / `data-i18n-attr` attributes:
  `login.html`, `setup.html`, `punch.html`, `punches-today.html`,
  `leaves.html`, `leaves-calendar.html`, `leave.html`, `leave-new.html`,
  `reports.html`, `employees.html`, `employee.html`,
  `employee-new.html`, `corrections.html`, `correction-new.html`,
  `correction.html`, `settings.html`.
- 15 JS files updated to import `t` / `tn` / `translateError` /
  `applyTranslations` and call them at module load.
- `public/sw.js` — `CACHE_VERSION` bumped to `pica-cache-v8`. (No
  pre-cache list change — locales were already in v7.)
- `package.json` — patch bump to 0.15.1.
- `README.md` — M9 marked complete.
- `tests/test-i18n.mjs` — expanded from 11 to 21 tests:
  - 5 dictionary structure tests (string-or-plural shape, parity,
    plural-shape parity, key-naming, placeholder parity)
  - 6 interpolation tests (no params, single, multi, unmatched,
    missing key, type coercion)
  - 5 plural tests (en-US one/other, pt-PT one/other, missing key)
  - 4 error-code tests (known/missing/empty/pt-PT)
- `tests/test-corrections.mjs` — fixed a date-flaky test that
  assumed April 2026 was the createdAt month. Now uses the actual
  `c.createdAt` to find the file.

### Tests
- 11-suite regression: 318 passing, 0 failing (was 308).
  - +10 tests in i18n suite (now 21 from 11).
  - +0 in corrections suite (the date-flaky test now correctly
    counts as 33 passing, where it was at 32 before today's actual
    date crossed into May).

### Honest disclosures
- **Backend stays English-only.** The `error` field on every API
  response is still the source of truth. Frontend calls
  `translateError(errorCode, fallback)`, which falls back to that
  English string when no `errorCode` is present (which is always,
  today). Backend errorCode emission is a clean follow-up: edit
  ~15 error response sites to include the code, and frontend picks
  up localized errors automatically.
- **Some hardcoded English remains in stored data.** When a
  correction is approved, the materialized punch's comment is
  built server-side as `Manual entry: ...` (English). Punches are
  persistent records — changing them when the locale changes would
  be confusing. Acceptable.
- **`<title>` tags are translated client-side**, not at server-render
  time. There's a brief flash of the English fallback on first paint
  before `applyTranslations()` runs. Acceptable for a feature that's
  mostly cosmetic (browser-tab text). Could be moved server-side in
  a future drop if it becomes a problem.
- **`Intl.NumberFormat`** — not used yet. Numbers in the app today
  are integers (days, hours-as-integers, employee counts). When we
  add currency or percentages they'll need formatting. Deferred.
- **`fmtDate`/`fmtTime`/`fmtDateTime`** are exported but most pages
  still use their per-page formatters. Switching all of them in one
  drop felt unnecessarily risky — they all look right today; the
  Intl helpers are there for new code and for incremental migration.
- **No automated browser tests** — the translation infrastructure is
  validated by the i18n test suite (parity, plurals, interpolation,
  errorCode lookup) and the smoke test (every page returns 200 in
  both locales, the meta tag flips correctly). End-to-end browser
  testing is a M11 item.
- **Dictionary parity is enforced by tests.** Every key in en-US
  must exist in pt-PT, plural categories must match, and `{name}`
  placeholders must match across both. This makes drift impossible
  to merge without it failing CI — the most important guarantee for
  long-term i18n maintenance.
- **No retranslation of existing approved leave/correction data.**
  The "since 09:00 (5 min ago)" relative time on the punch page
  is computed live, so it switches with the locale. But static
  decision notes (e.g. notes the employer typed in English when
  rejecting a leave) stay in whichever language they were written.
  Correct semantics for free-form data.

### Roadmap status
- ✅ M0–M9 (both drops)
- ⏳ M10: Backups
- ⏳ M11: Hardening (offline-trust signing, conflict resolution,
  spend-bank flow, full E2E browser tests, backend errorCode
  emission, password change, full Intl.NumberFormat coverage)

---

## [0.15.0] — 2026-04-30 — Milestone 9 (Drop 1): i18n foundation, en-US + pt-PT

The internationalization foundation. The infrastructure to translate
the app is in place, with two locales (en-US and pt-PT) and the most
visible strings already translated: app-shell chrome, dashboard,
preferences, footer. Pages not yet translated continue to render in
English and pick up `[key.name]` placeholders for any newly-added
keys that haven't been registered — making translation gaps obvious.

A second drop (M9 Drop 2) will translate the remaining pages
(punch, leaves, reports, employees, corrections, settings, login)
and add backend error-message localization via error codes.

### Added — Locale storage in user-prefs

- **`locale` field** replaces the legacy `language` field. Valid
  values: `en-US`, `pt-PT`. Default: `en-US`.
- **Backward compatibility**: existing user-prefs files with
  `language: 'en'` or `language: 'pt'` are read transparently as
  `locale: 'en-US'` / `locale: 'pt-PT'`. The legacy field is
  stripped on the next write. No migration script needed.
- Validator on `update()` enforces the BCP-47 locale tag list.

### Added — Locale dictionaries

- `public/locales/en-US.js` — English (US) translations.
- `public/locales/pt-PT.js` — European Portuguese translations.
  Vocabulary tuned for PT-PT specifically (e.g. "marcar ponto",
  "férias", "definições", not "registrar", "vacaciones",
  "configurações").
- 50 keys per dictionary. Namespace by feature: `nav.*`, `menu.*`,
  `dashboard.*`, `prefs.*`, `login.*`, `app.suffix`,
  `footer.releaseDateUnknown`.
- Both dictionaries are ES modules with `default` exports of plain
  objects — readable, diffable, no JSON-quoting hassle.

### Added — `i18n.js` runtime module

- `t(key, params)` synchronous lookup. `{name}` placeholders are
  substituted from the params object; unmatched placeholders stay
  literal so missing data is visible in the UI.
- `getLocale()` returns the active BCP-47 tag.
- `getSupportedLocales()` returns `['en-US', 'pt-PT']`.
- Missing keys render as `[key.name]` so translation gaps are
  immediately obvious in dev. Better than silent empty strings.
- Both dictionaries imported eagerly (~3 KB each); no flash of
  untranslated content on page load.

### Added — Server-side locale injection

`registerPageRoutes` now resolves the user's locale from
`userPrefsStore` and rewrites the served HTML on the way out:

- `<html lang="en-US">` → `<html lang="pt-PT">` (or whichever)
- Inserts `<meta name="pica-locale" content="...">` before the
  manifest link in `<head>`.

This means `i18n.js` reads the locale synchronously at module load
time without any async dance — no flicker, no fetch delay, no
flash of English text on a page meant to be Portuguese.

Unauthenticated pages (login, setup) default to `en-US`.

### Translated — Drop 1 string coverage

The most-visible chrome and entry-points are now localized:

- **App shell** (header, sidebar, hamburger menu): nav labels,
  "Time management" suffix, profile/preferences/sign-out menu items.
- **Dashboard (`/`)**: welcome heading, "Signed in as ..." line,
  all card titles + descriptions (with role-specific variants for
  Leaves, Corrections, Reports), Dashboard placeholder block.
- **Preferences (`/preferences`)**: all labels, the language change
  hint, color-mode option labels, save button, success message.
- **Footer**: release date now uses `Intl.DateTimeFormat` with the
  active locale (so "Apr 30, 2026" in en-US becomes
  "30 de abr. de 2026" in pt-PT). The "Pica vN.N.N" version label
  and "GitHub" link stay as proper-noun-ish constants.

Saving a new locale on the Preferences page reloads the page so the
server-rendered locale meta tag picks up the new value and every
future navigation sees the right strings.

### NOT Translated yet (Drop 2)

The following pages still render in English regardless of the
selected locale. They'll be translated in M9 Drop 2:

- `/punch`, `/punches/today`
- `/leaves`, `/leaves/calendar`, `/leaves/new`, `/leaves/:id`
- `/reports`
- `/employees`, `/employees/new`, `/employees/:id`
- `/corrections`, `/corrections/new`, `/corrections/:id`
- `/settings`
- `/login`, `/setup`
- All `confirm()` and `alert()` dialogs
- All `showMessage()` and toast() text

API error responses also stay English-only in this drop — the
backend will gain error codes (and frontend translation lookup) in
Drop 2.

### Files touched
- `src/storage/user-prefs.js` — `language` → `locale`,
  `LEGACY_LANGUAGE_MAP`, validator change.
- `src/routes/pages.js` — locale resolution + HTML injection in
  `sendHtml`.
- `server.js` — pass `userPrefsStore` to `registerPageRoutes`.
- `public/locales/en-US.js` + `pt-PT.js` — new files.
- `public/i18n.js` — new file.
- `public/topbar.js` — imports `t`, `getLocale`; nav labels,
  title suffix, menu items via translation keys; `formatReleaseDate`
  uses `Intl`.
- `public/index.{html,js}` — IDs added in HTML for JS-driven text;
  full rewrite of cards using translation keys.
- `public/preferences.{html,js}` — IDs for label translation;
  `language` → `locale`; reload-on-locale-change.
- `public/sw.js` — pre-cache list extended (`/i18n.js`,
  `/locales/en-US.js`, `/locales/pt-PT.js`); `CACHE_VERSION` bumped
  to `pica-cache-v7`.
- `tests/test-user-prefs.mjs` — 3 new tests for legacy migration
  and locale validation; existing tests updated to new field name.
- `tests/test-i18n.mjs` — new file: dictionary parity, placeholder
  parity, key-naming convention, t() interpolation, missing-key
  fallback. 11 tests.
- `package.json` — minor bump to 0.15.0.
- `README.md` — M9 expanded with what's done and what's pending.

### Tests
- 11-suite regression: 308 passing, 0 failing (was 294;
  +3 user-prefs legacy, +11 new i18n suite, +0 changes elsewhere).

### Honest disclosures
- **Drop 1 is intentionally narrow.** The point is to validate the
  whole infrastructure (storage, validation, server injection,
  client lookup, dictionary parity tests) on a small surface
  area before applying it to ~150 more strings across 15+ pages.
  If anything in the design is wrong, it's much cheaper to fix
  now than after Drop 2.
- **Reload-on-language-change is a pragmatic choice.** Single-page
  swap (re-rendering everything on the fly) would require every
  page to listen for a "locale changed" event and re-render its
  templated DOM, which would mean refactoring 15 page modules.
  Reload is one line and has no failure modes. Locale changes
  are rare enough that the reload doesn't sting.
- **No fancy pluralization** in this drop. The Drop-1 strings
  don't need it. When Drop 2 hits the queue badge ("1 punch
  waiting" vs "2 punches waiting") and similar, we'll wire
  `Intl.PluralRules` then.
- **The i18n.js module can't be fully unit-tested** without a
  browser DOM (it reads `<meta>`). The test suite tests the
  `t()` algorithm in isolation by reimplementing it; the
  module itself is exercised via the smoke test on the running
  server. Full E2E browser tests are an open M11 item.
- **`/i18n.js` and the locales** are pre-cached by the SW now,
  so existing PWA users will pick them up after the v7 cache
  invalidation kicks in (next page load after the deploy).

---

## [0.14.1] — 2026-04-30 — App-shell polish: tinted chrome + nav-link restyle

Two small visual fixes after stakeholder review of 0.14.0:

1. The header and sidebar shared the same white background as the
   main content area, so the app shell had no visible "frame" around
   the working area — header, sidebar, and main all blended together.
2. The sidebar nav links were rendered with browser-default
   underlines, which looked unstyled (and inconsistent with the rest
   of the design tokens).

### Changed — Header and sidebar now use --surface tint

Both the `.appshell__header` and `.appshell__sidebar` switched their
backgrounds from `var(--bg)` (white) to `var(--surface)` (the soft
gray that's already used for cards and other secondary surfaces).
The 1px borders along the inner edges (`border-bottom` on the
header, `border-right` on the sidebar) are kept for an extra crisp
edge between chrome and content.

This creates a clear two-tone reading: tinted chrome wraps around
the white working area. No new CSS variables were introduced —
`--surface` was already in use elsewhere, so the new layout fits
right into the existing design system.

### Changed — Sidebar nav links restyled

- **Default state**: regular text colour, weight 500, no underline.
- **Hover**: pill background using `--surface-2` (the slightly darker
  gray that's already used for hover states on other interactive
  surfaces), text stays the regular colour.
- **Active page**: white pill background (`--bg`) so it pops against
  the tinted sidebar — like a tab pulled forward — plus the existing
  accent left-border, accent text colour, and bold weight. A very
  subtle `box-shadow` (4% black) gives the pill a hint of elevation
  to reinforce the "this is selected" cue.

The pattern matches how cards interact with their backgrounds
elsewhere in the app. No underlines anywhere; affordance comes from
hover background + cursor + the active-page treatment.

### Files touched
- `public/topbar.css` — `.appshell__header` and `.appshell__sidebar`
  backgrounds; full rewrite of `.appshell__nav-link` and its
  `:hover` and `--active` variants.
- `public/sw.js` — `CACHE_VERSION` bumped to `pica-cache-v6`.
- `package.json` — patch bump to 0.14.1.

### Tests
- 10-suite regression: 294 passing, 0 failing. Pure CSS change.

### Honest disclosures
- **Sub-elements unchanged.** The avatar's `--surface-2` background
  and the hamburger's `--bg` background still pop against the new
  `--surface` header tint — actually slightly more so than before,
  which is a useful side-effect (better affordance for both
  controls). No tweaks needed.
- **Mobile drawer** stays the same colour as the sidebar (`--surface`
  via inheritance) — looks right when sliding in over the scrim.

---

## [0.14.0] — 2026-04-30 — App-shell layout: header + sidebar nav

The single horizontal top-bar from M8 has been replaced with a
two-axis app shell:

- **Header** (full-width, top): logo on the left, "Company Name —
  Time management" centered, hamburger + avatar on the right.
- **Sidebar** (left, vertical column): primary navigation as
  underlined links (Employees, Calendar, Leaves, Punches, Reports,
  Settings).
- **Main content** fills the remaining space to the right of the
  sidebar.
- **Footer** stays as before, full-width across the bottom.

This matches the stakeholder mockup and provides more nav real
estate than a horizontal bar, especially as the app grows.

### Removed — Horizontal top-bar nav

The old `.topbar` / `.topbar__*` markup, classes, and CSS are gone
entirely. The renaming to `.appshell__*` reflects that this is now
a layout shell, not just a bar. Everything that was there (logo,
avatar dropdown, mobile drawer, sign-out, profile shortcut) is
preserved in the new structure — just rearranged.

### Added — App-shell structure

- **`<header.appshell__header>`** — sticky to the top of the viewport,
  64px tall. Uses CSS grid with three columns (`80px 1fr auto`) so
  the title genuinely centers regardless of the right-side controls'
  width. The title is composed of a bold company name + " — " + a
  muted "Time management" suffix.
- **`<aside.appshell__sidebar>`** — 220px fixed-width column on the
  left, full content height, contains the vertical nav. Active page
  has an accent left-border and bold weight; non-active pages match
  the mockup's underlined-link style.
- **`<div.appshell__body>`** — wrapper around the sidebar + main
  inserted by `mountTopBar()` automatically; pages don't need any
  HTML changes.
- **`<div.appshell__scrim>`** — backdrop for the mobile drawer.

### Changed — Mobile breakpoint

At ≤900px viewport width:
- Sidebar disappears, hamburger appears in the header.
- Tapping the hamburger slides the sidebar in from the left over a
  scrim.
- Tapping the scrim or any nav link closes the drawer.
- The "— Time management" suffix is hidden on mobile to keep the
  header readable on narrow screens (just the company name shows).
- The brand logo shrinks to 40×40 (from 48×48 on desktop).

### Changed — `mountTopBar()` now wraps `<main>` automatically

Pages that already call `mountTopBar()` (which is all authenticated
pages via the convention established in M8a) need no changes. The
function inserts the header at the top of `<body>`, then wraps
`<main>` plus the sidebar plus the scrim into a flex-row container.

Login + setup pages don't call `mountTopBar()` (they only call
`mountFooter()`), so their layout is unaffected.

### Files touched
- `public/topbar.js` — complete rewrite of `buildBar()`,
  `wireEvents()`, and `mountTopBar()`. The old single-element output
  is replaced with a `{header, sidebar, scrim}` triple, all inserted
  in the right places by mountTopBar.
- `public/topbar.css` — full rewrite around `.appshell__*` classes.
  Old `.topbar*` rules deleted. New rules cover desktop layout,
  mobile drawer, scrim, avatar menu.
- `public/app.css` — `#toast-root` top offset bumped from 56px to
  64px to clear the new header height. The legacy `.topbar`
  selector in the transition list is harmless leftover (no element
  has that class anymore).
- `public/sw.js` — `CACHE_VERSION` bumped to `pica-cache-v5` so
  existing PWA installs invalidate cache and pick up the new shell.
- `package.json` — minor bump to 0.14.0.

### Tests
- 10-suite regression: 294 passing, 0 failing. No backend changes,
  no test changes; the layout refactor is pure frontend.

### Honest disclosures
- **No automated visual-regression test.** This is a substantial
  visual change verified by hand-running the smoke and clicking
  through pages. If the look of any page is off (e.g. content too
  wide for the new narrower main area), it'll need a follow-up.
- **The mockup showed plain underlined links;** I added a small
  visual cue for the active page (accent left-border + bold) because
  pure underlined links with no active-state indicator is genuinely
  hard to navigate. Easy to revert if you'd rather match the mockup
  exactly.
- **Title assumption**: the mockup said "Title — Time management"
  and I read "Title" as a stand-in for the company name (so it
  renders as e.g. "Queijadas Finas Maria Augusta — Time
  management"). If you meant "Title" to vary by page section
  (e.g. "Punches — Time management"), that's a one-line change
  to make `appshell__title-name` derive from the page's `<h1>`
  instead of the company branding.
- **Dashboard cards on `/`** are unchanged — they still show a grid
  of section entry-points. With the sidebar always visible they're
  somewhat redundant on desktop but useful on mobile (where the
  sidebar lives behind the hamburger).
- **The legacy `.topbar` in the transition selector list** in
  `app.css` is dead code. Tidying it up is a minor follow-up.

---

## [0.13.0] — 2026-04-30 — Per-employee working-time overrides

The org-wide daily/weekly hours target now has a **per-employee
override** layer on top, mirroring the leaves model. Alice can have a
6h day / 30h week (part-time) while Bob keeps the org default 8h/40h,
and the punch page picks up the right value for whoever's logged in.

The original org-wide setting is unchanged — overrides are strictly
additive. Employees without an override keep using the default.

### Added — Per-employee overrides in storage

- **`workingTime.perEmployeeOverrides`** added to `org-settings.json`
  defaults as an empty map. Shape:
  `{ [userId]: { dailyHours?, weeklyHours? } }`. Either field is
  optional — a partial override (just `dailyHours`) is allowed.
- **Validator** in `cleanWorkingTimePatch`: same range checks as the
  org defaults (0–24 daily, 0–168 weekly), errors point at the
  specific user + field. Users with empty `{}` field objects are
  silently dropped (no override at all).
- **Update semantics**: the overrides map is replaced wholesale on
  each PUT (matches the leaves convention — UI sends the whole table
  every save). Org defaults are merged separately, so updating just
  the defaults doesn't touch overrides and vice versa.

### Added — `resolveWorkingTimeFor(userId)` on the store

New method that returns `{ dailyHours, weeklyHours }` with per-field
fallback to the org default:

```js
// Bob has dailyHours=4 but no weeklyHours override
resolveWorkingTimeFor('bob') === { dailyHours: 4, weeklyHours: 40 }
```

### Changed — `GET /api/settings/working-time` returns resolved values

The endpoint now returns the resolved-for-the-calling-user values
instead of just the org defaults. Punch page automatically picks up
the right "X / target" display without any frontend change.

`GET /api/settings/org` (employer) still exposes the full structure
including the overrides map, so the settings UI can render the table.

### Added — Settings UI: working-time overrides table

The Working time card now has two sub-sections:

1. **Default for everyone** — the existing two inputs.
2. **Per-employee overrides** — a table mirroring the leaves overrides
   table. Each row has the employee's name and two number inputs
   (Daily, Weekly). Empty input = use the default for that field.

Both sections are saved together by the existing "Save working-time
settings" button.

### Files touched
- `src/storage/org-settings.js` — perEmployeeOverrides default,
  validator, resolver method.
- `src/routes/settings.js` — `/api/settings/working-time` uses the
  resolver.
- `public/settings.html` — overrides table wrap inside the Working
  time card, two sub-section headers.
- `public/settings.js` — `renderWorkingTimeOverridesTable()`,
  collection in submit handler, render call in `renderOrg()`.
- `public/sw.js` — cache version bumped to v4.
- `tests/test-org-settings.mjs` — 10 new tests covering full +
  partial overrides, replace-on-update, range checks, resolver
  fallback, isolation from defaults.
- `package.json` — minor bump to 0.13.0 (new feature).

### Tests
- 10-suite regression: 294 passing, 0 failing (was 284; +10 new in
  org-settings).

### What's NOT in this drop (intentionally deferred)
- **Reports integration** — the daily/weekly targets aren't yet used
  in the reports module. The punch page benefits from the resolver
  automatically; reports stay as they were. A future drop can wire
  "Alice worked 38h this week, target 40h, deficit 2h" using the
  existing resolver.
- **Per-day schedules** — overrides only adjust the totals, not the
  shape of the working week (e.g. "Mon-Thu 8h, Fri 4h"). That's a
  bigger feature with its own design conversation if/when needed.
- **Visible default-vs-override indication on the punch page** — the
  punch page just shows the resolved target ("X / 6h" for Alice).
  No "(default: 8)" hint nearby. Add later if it becomes confusing.

### Honest disclosures
- **Replace-on-save semantics** mean a stale browser tab can
  inadvertently wipe an override added in another tab. Same caveat
  applies to leaves overrides today — fixing it for both is a
  cross-cutting concern (probably an `If-Match`-style optimistic
  concurrency check in M11).
- **Override values are NOT capped at 24/168 by the HTML inputs**
  with strict `max` — the inputs accept the full range, validation
  catches invalid values server-side. Same as leaves overrides.

---

## [0.12.4] — 2026-04-30 — Button-anchor hover fix + Corrections removed from top nav

Two small fixes after stakeholder review of the corrections list page:

1. The "Register manual time" call-to-action button (an `<a class="btn-primary">`)
   was rendering as a solid block with **invisible text on hover** — the
   text colour was being pulled into the background colour. Cause: the
   global `a:hover { color: var(--accent-hover) }` rule was overriding
   the white-text-on-coloured-background expectation that button-styled
   anchors need. Specificity quirk: `a:hover` (0,1,1) beats `.btn-primary`
   (0,1,0) on the same element on hover, so the colour was getting
   pulled to `--accent-hover` — the same colour as the hover background.
2. Corrections was removed from the top-bar nav for both roles. Users
   can still reach `/corrections` from the punch page (two static links
   added in 0.12.3) and from the dashboard cards on `/`. Top-bar nav
   was getting crowded.

### Fixed — Button-anchor hover keeps text visible

Added explicit hover rules in `app.css` for the `.btn-*` classes when
applied to anchors:

```css
a.btn:hover, a.btn-primary:hover, a.btn-danger:hover,
a.btn-approve:hover, a.btn-reject:hover { color: white; }
a.btn-ghost:hover { color: var(--text); }
```

Specificity (0,2,1) beats the global `a:hover` (0,1,1), so the white
text wins. `<button>` elements were never affected since they have no
default `a:hover` rule applied to them.

### Removed — Corrections link from the top nav

`NAV_EMPLOYEE` and `NAV_EMPLOYER` in `topbar.js` no longer include
Corrections. Both roles still have:
- Two punch-page links: "View corrections list →" and "Forgot to clock? Register manual time →"
- A dashboard card on `/` (not removed in this drop — the dashboard is
  a less-cluttered space than the top bar).

### Service worker cache bumped to v3

Both `app.css` and `topbar.js` are pre-cached static assets. Bumping
`CACHE_VERSION` from `pica-cache-v2` to `pica-cache-v3` so existing
PWA users invalidate their caches and pick up the changes on next
visit without a manual hard refresh.

### Files touched
- `public/app.css` — added explicit `a.btn-*:hover` colour rules.
- `public/topbar.js` — Corrections removed from `NAV_EMPLOYEE` and `NAV_EMPLOYER`.
- `public/sw.js` — `CACHE_VERSION` bumped to `pica-cache-v3`.
- `package.json` — patch bump to 0.12.4.

### Tests
- 10-suite regression: 284 passing, 0 failing. No new tests; both
  fixes are pure UI / nav config changes.

### Honest disclosures
- **The hover bug also exists in theory** for `a.btn-secondary` if any
  page uses one as an anchor (no current usage, hence not in the
  override rule). If a future page introduces `<a class="btn-secondary">`
  it'll need adding to the list.
- **Dashboard cards still include Corrections.** Removing it there too
  was tempting for symmetry with the top-bar removal, but the dashboard
  is the natural starting point for "what should I do today" and
  removing Corrections would make the punch-page links the only entry
  point, which feels too narrow. Easy to revisit if you'd rather strip
  it from the dashboard too.

---

## [0.12.3] — 2026-04-29 — Punch-page link visibility + button-styling bugfix

Two follow-up fixes from stakeholder testing of 0.12.2:

1. The role-aware corrections link added in 0.12.2 wasn't reaching
   employers reliably. Likely cause: service worker serving stale
   `punch.js`. The user reported they only saw the employee-version
   link ("Forgot to clock? Register manual time →") with no path to
   the approval list at `/corrections`.
2. The Cancel button on the new-correction form rendered as bare,
   unstyled text. Cause: it's an `<a class="btn-ghost">` anchor, but
   the `.btn-ghost` rule only overrode color/background — it relied
   on the base `button` selector for sizing/padding/border-radius,
   which doesn't match anchors.

### Fixed — Two static corrections links on the punch page

Replaced the JS-based role-swap (which depended on the latest
`punch.js` actually being loaded) with **two statically-rendered
links** in the HTML:

- "View corrections list →" → `/corrections`
- "Forgot to clock? Register manual time →" → `/corrections/new`

Both links are visible to both roles. The employer's primary need is
the review list; the employee's primary need is the registration
form; either role might want either page on occasion. Showing both
upfront sidesteps the cache-invalidation problem entirely — there's
no JS swap to miss.

The role-swap JS in `punch.js` was removed.

### Fixed — `.btn-*` classes work on anchors as well as buttons

The base button styling (size, padding, border-radius, font-weight,
flex centering) was scoped to `button, .btn` only. The role-specific
classes (`.btn-primary`, `.btn-ghost`, `.btn-approve`, `.btn-reject`)
only added color overrides on top, so when applied to an `<a>` tag
they got the colors but not the structure.

The fix extends the base rule to include all `.btn-*` selectors
directly, so the same styling applies regardless of element type.
This means `<a class="btn-ghost">Cancel</a>` now renders as a
proper button, matching `<button class="btn-ghost">Cancel</button>`.

Also added `.btn-approve` / `.btn-reject` color overrides to
`corrections.css` (they were previously scoped to `.actions` in
`leave.css` and didn't apply to the corrections detail page).

### Service worker cache bumped

`CACHE_VERSION` bumped from `pica-cache-v1` to `pica-cache-v2` so
deployed clients invalidate their cache and pick up the new
`punch.js` and `app.css` on next visit. Without this bump, users
already running the site as a PWA would continue seeing the broken
link until they manually hard-refreshed.

### Files touched
- `public/punch.html` — replaced the role-swapped link with two
  static links.
- `public/punch.js` — removed the role-swap logic.
- `public/app.css` — extended base button rule to cover `.btn-primary`,
  `.btn-ghost`, `.btn-approve`, `.btn-reject`. Added `text-decoration: none`
  for anchor variants.
- `public/corrections.css` — added `.btn-approve` / `.btn-reject` color
  overrides at the file scope (no longer dependent on `.actions`).
- `public/sw.js` — `CACHE_VERSION` bumped to `pica-cache-v2`.
- `package.json` — patch bump to 0.12.3.

### Tests
- 10-suite regression: 284 passing, 0 failing. No new tests needed —
  these are pure UI fixes.

### Honest disclosures
- **Showing both links was the pragmatic call** over fixing the JS
  role-swap to be more robust. The user value (reliable access to
  /corrections) is delivered either way; statically rendering both
  links is just less code to break later.
- **The original `corrections-link` id** is no longer used by any JS
  but the class `forgot-link` is shared between both new links so
  styling stays consistent.

---

## [0.12.2] — 2026-04-27 — Corrections fixes: fullName, employer link, three kinds

This release fixes three issues from stakeholder feedback on the M8d
corrections feature:

1. **Bug**: usernames showing instead of full names in the corrections UI.
2. **UX**: employer needed an easier path from the punch page to the
   corrections approval list.
3. **Feature**: corrections now support `kind = 'both' | 'in' | 'out'` —
   so users can register only-clock-in or only-clock-out forgots, not
   just complete in/out windows.

### Fixed — fullName lookup in corrections route

`fullNameMap()` was reaching into `e.profile?.fullName`, but
`employeesStore.list()` returns flat `{id, fullName, ...}` records
(matching the leaves route's pattern). The lookup always returned
`undefined` and the UI fell back to the username. Now uses `e.fullName`
directly. The leaves route had the right shape; corrections was the
outlier.

### Changed — Corrections link on the punch page is role-aware

Previously the punch page always showed "Forgot to clock? Register
manual time →" pointing at `/corrections/new`. For employers this was
useless — they don't typically file their own corrections, they need
to approve employees'. The link now adapts:

- **Employee**: "Forgot to clock? Register manual time →" → `/corrections/new`
- **Employer**: "Review pending corrections →" → `/corrections`

Both roles can still navigate via the top-bar Corrections link if they
want the other destination.

### Added — Three correction kinds

The store, route, and frontend now support three kinds:

- **`both`** (default) — full window: requires `start` and `end`. Hours
  computed as the duration. The only kind that can affect the bank.
- **`in`** — clock-in only: requires only `start`. Materializes a
  single in-punch on approval. Use case: arrived but forgot to tap.
- **`out`** — clock-out only: requires only `end`. Materializes a
  single out-punch on approval. Use case: left without tapping.

#### Bank impact by kind

The bank only counts approved **`both`** corrections without
justification. Single-side corrections (`in` / `out`) are paperwork
fixes — there's no duration knowable in isolation, so they never
contribute to the bank regardless of justification status.
`computeBank()` enforces this.

The justification field still exists for all kinds — for `in` / `out`
it serves the audit log but has no bank consequence. The new-form's
"these N hours will go to the bank" warning hides for `in` / `out`.

#### Approval materialization by kind

- `kind='both'` → creates both in-punch (at `start`) and out-punch (at `end`).
- `kind='in'` → creates only the in-punch at `start`.
- `kind='out'` → creates only the out-punch at `end`.

ClientIds remain `correction:<id>:in` / `:out` for idempotency.
`kind='out'`-only corrections put the comment on the out-punch (since
there's no in to attach it to); for `kind='both'` the comment lives on
the in-punch as before.

#### Forward compatibility

Old correction events written before this version don't have a `kind`
field. On read, `applyEvent()` defaults missing `kind` to `'both'`
(which matches the original required-both semantics). No data
migration needed. A test verifies this round-trips correctly.

### Frontend — new-correction form

The form gained a **kind selector** at the top — three radio-button
options with descriptions:

- "Both clock-in and clock-out" — I worked a window that wasn't tracked at all.
- "Just clock-in" — I forgot to clock in (e.g. arrived but didn't tap).
- "Just clock-out" — I forgot to clock out (e.g. left without tapping).

When `in` is selected the End field hides and the Start label changes
to "When you arrived." When `out` is selected the Start field hides
and the End label changes to "When you left." The bank-warning
callout shows only for `kind='both'` without justification.

### Frontend — list and detail pages

- **List rows** now show kind chips (`both` / `in only` / `out only`),
  render `Arrived HH:MM` for in-only and `Left HH:MM` for out-only
  rows, and display "in only" or "out only" in the hours column for
  single-side corrections.
- **Detail page** hides the Start/End/Duration `<dt>` rows that don't
  apply to the kind. For `in` the row label becomes "Arrived"; for
  `out` it becomes "Left". The Bank impact line reads "None —
  single-side correction" for `in` / `out`.
- **Approve confirmation** message branches by kind: for `in` / `out`
  it tells the employer what time the punch will be added at; for
  `both` unjustified it warns about the bank impact.

### Files touched
- `src/storage/corrections.js` — `validateWindow()` now branches on
  kind. `applyEvent()` reads/defaults kind. `create()` accepts kind.
  `computeBank()` filters by `kind='both'`.
- `src/routes/corrections.js` — `fullNameMap()` fixed to read `e.fullName`.
  POST accepts kind. Approve materialization branches by kind.
- `tests/test-corrections.mjs` — 8 new tests covering kind validation,
  bank exclusion for single-side, mixed-kind bank totals, and
  forward-compat for old kind-less events.
- `public/correction-new.html` + `correction-new.js` — kind selector,
  conditional fields, kind-aware warning visibility.
- `public/corrections.js` — list rows render by kind.
- `public/correction.html` + `correction.js` — detail page renders by
  kind, hides irrelevant rows, branches approval confirmation.
- `public/corrections.css` — kind-fieldset, kind-radio, kind chip styles.
- `public/punch.html` + `punch.js` — corrections link gets an id and
  swaps href + text by role.
- `package.json` — patch bump to 0.12.2.

### Tests
- 10-suite regression: 284 passing, 0 failing (was 276 + 8 new in
  corrections covering the three kinds).

### Honest disclosures
- **No frontend tests** for the kind-switching logic. The smoke test
  exercises the full file/approve flow for all three kinds end-to-end
  but the UI radio-button visibility is verified by hand.
- **Re-approving a same-kind correction** is still rejected at the
  storage layer (status machine: pending → approved is one-way),
  but if a `kind='out'` correction is approved and then somehow gets
  another approve event for `kind='in'` materialization, the punch
  idempotency key (`correction:<id>:in`) would prevent duplication.
  Both layers agree.

---

## [0.12.1] — 2026-04-27 — Milestone 8d (frontend): corrections UI + working-time display

This release ships the frontend half of M8d. Employees can now file
corrections through a real form; employers can review and approve them
from a dedicated list. The punch page surfaces the time bank balance
and the daily-hours target. Settings has a Working time card.

### Added — Three new pages

- **`/corrections`** — list page. Splits into "Pending" and "History".
  Employee sees own; employer sees all (including a per-row employee
  name). Each row links to the detail page. A bank-balance card sits
  at the top for employees showing "X hours owed" with a hint
  explaining the bank semantics.
- **`/corrections/new`** — create form. Two `datetime-local` pickers
  (start, end), an optional justification textarea, and a live
  callout: "Without a justification, these {hours} will be added to
  your time bank as compensation owed". The callout updates as the
  user types in the duration and disappears when they enter a
  justification.
- **`/corrections/:id`** — detail page. Mirrors the leaves detail
  layout: definition list of fields, action buttons appropriate to
  role + status. Employer sees Approve / Reject (with notes dialog)
  for pending; "Reverse approval" for approved (cancels but keeps
  materialized punches in the audit log). Owner sees Cancel for
  pending.

Approve / approve-without-justification both confirm() before sending
so the employer knows about the bank impact when there's no
justification.

### Added — Punch page additions

- **`Forgot to clock? Register manual time →`** link below the today
  list. Single tap to `/corrections/new`.
- **Time bank line** appears below the today list when the employee's
  bank is non-zero: "Time bank: 2h 30m" in accent green. Hidden
  when zero.
- **Today total now includes the daily target**: shows "5h 23m / 8h"
  instead of just "5h 23m". Falls back to plain hours if the target
  isn't configured or fetch fails.

### Added — Settings UI

- **New "Working time" card** in `/settings`, employer-only. Two number
  inputs (Daily hours, Weekly hours) with reasonable validation
  attributes (min/max/step). Saves via the existing
  `PUT /api/settings/org`. Section nav gets a new "Working time"
  anchor.

### Added — Top-bar + dashboard nav

- **Corrections** added to top-bar nav for both roles, between Leaves
  and Reports/Punches.
- **Corrections** added to dashboard nav cards for both roles with
  role-appropriate descriptions:
  - Employee: "Manual time entries and bank"
  - Employer: "Approve manual time entries"

### Added — `GET /api/settings/working-time`

The full `/api/settings/org` endpoint is employer-only, but employees
need the daily-hours target on their punch page. Added a tiny
authenticated-but-not-employer-restricted endpoint that returns just
the working-time slice. Avoids leaking the full org settings (which
include per-employee leave overrides, backups config, etc.) to
employees who don't need them.

### Files touched
- `src/routes/pages.js` — three new page routes (`/corrections`,
  `/corrections/new`, `/corrections/:id`).
- `src/routes/settings.js` — new `GET /api/settings/working-time` route.
- `public/corrections.html`, `correction-new.html`, `correction.html`
  — new files.
- `public/corrections.js`, `correction-new.js`, `correction.js` — new
  files.
- `public/corrections.css` — new file (list rows, status tags, chips,
  callout, bank-card, kv list, reject dialog).
- `public/topbar.js` — Corrections in NAV_EMPLOYEE + NAV_EMPLOYER.
- `public/index.js` — Corrections in dashboard nav cards.
- `public/punch.html`, `punch.js`, `punch.css` — bank-line + forgot
  link + today/target combined display.
- `public/settings.html`, `settings.js` — Working time card.
- `README.md` — M8d items all ticked.
- `package.json` — patch bump to 0.12.1.

### Tests
- 9-suite regression still 276 passing, 0 failing. No new tests in
  this drop — the frontend is verified by the smoke test
  (file/approve/bank/materialize end-to-end works).

---

## [0.12.0] — 2026-04-26 — Milestone 8d (backend): time corrections + working-time targets

This release ships the backend half of M8d. Employees can now file
retroactive time entries when they forgot to clock in/out; the employer
approves or rejects them like leaves. Approved corrections materialize as
real punch records, and approved corrections without a justification
accumulate as "uncredited hours" in a per-employee bank that the employer
can later draw against by asking for compensation.

The frontend half of M8d (corrections list page, "Register manually"
link, settings UI for hour targets, bank/working-time displays) ships in
the next drop.

### Added — Time corrections (new entity)

- **Storage** at `src/storage/corrections.js`. Event-sourced model
  mirroring leaves: month-partitioned NDJSON, AES-encrypted sensitive
  fields (justification, decision notes), reducer over the event stream
  produces the current state. Files at `data/corrections/<yyyy>/<mm>.ndjson`.
- **Validation** on create:
  - `start` and `end` required; `end > start`;
  - window between 1 minute and 24 hours;
  - justification optional, truncated at 500 chars.
- **Status machine**: pending → approved / rejected / cancelled.
  Approved → cancelled allowed (employer reverses a decision). Other
  transitions rejected.
- **Storage exports**: `create`, `findById`, `list({employeeId, status})`,
  `approve`, `reject`, `cancel`, `computeBank`.

### Added — Routes (`src/routes/corrections.js`)

- `GET /api/corrections` — list (employee: own; employer: all). Optional
  `?status=pending|approved|rejected|cancelled` filter.
- `GET /api/corrections/bank` — current user's bank balance.
- `GET /api/corrections/bank/:userId` — employer-only.
- `GET /api/corrections/:id` — single, owner or employer.
- `POST /api/corrections` — employee files a correction.
- `POST /api/corrections/:id/approve` — employer; **materializes** the
  correction as in/out punch records.
- `POST /api/corrections/:id/reject` — employer, with optional notes.
- `POST /api/corrections/:id/cancel` — owner if pending; employer any.

### Added — Materialization on approve

When an employer approves a correction, the route layer creates the
corresponding in/out punch records via `punchesStore.append()` BEFORE
recording the approval. Each materialized punch carries a deterministic
`clientId` of `correction:<id>:in` and `:out`. This makes the operation
**idempotent**:
- A retry caused by network flakiness won't double-create punches.
- The approval is only recorded if both punches are persisted (or were
  already present from a prior partial attempt).
- Re-approving an already-approved correction is rejected at the storage
  layer (status machine) and surfaces as a 400.

### Added — Time bank semantics

The bank tracks **uncredited hours** the employee accumulated by filing
manual entries without justification. The intuition: the employee
admitted to missing the registration without an excuse, so the time is
recorded as worked (the punches are real) but the duration also counts
against them as compensation owed. Employer can later request the
employee work extra unpaid hours to clear the bank.

- `correctionsStore.computeBank({userId, asOf?})` returns hours.
- Approved + justified correction → bank unchanged.
- Approved + unjustified correction → adds duration to bank.
- Cancelled approved correction → its hours are removed from the bank.
- Pending and rejected corrections never affect the bank.
- Spending the bank (employer marks hours as "consumed") is **not** in
  this drop — accumulation only. Spending becomes its own feature later.

### Added — Working-time targets

- **`workingTime.dailyHours`** (default 8) and **`workingTime.weeklyHours`**
  (default 40) added to org settings.
- Validators: 0 ≤ daily ≤ 24, 0 ≤ weekly ≤ 168, fractional allowed
  (7.5 / 37.5 supported).
- Org-wide for now; per-employee overrides may come in M11. The UI hookup
  ships in the next drop; for now the values are read/writable via
  `GET/PUT /api/settings/org`.

### Tests

- **New suite `tests/test-corrections.mjs`** — 25 tests covering create
  validation, list filtering, all status transitions (legal + illegal),
  encryption (justification persists with same key, fails with different
  key), and bank computation across all the edge cases (justified
  excluded, unjustified summed, status-scoped, user-scoped, cancellation
  removes hours, fractional precision).
- **6 new tests in `test-org-settings.mjs`** for the workingTime
  validator (defaults, fractional accept, range rejection, isolation
  from other section patches).
- 9-suite regression: 276 passing, 0 failing (was 245; +25 corrections,
  +6 workingTime).

### Files touched
- `src/storage/corrections.js` — new file.
- `src/routes/corrections.js` — new file.
- `src/storage/org-settings.js` — workingTime defaults + validator + merge.
- `server.js` — instantiates correctionsStore, registers routes.
- `tests/test-corrections.mjs` — new file.
- `tests/test-org-settings.mjs` — workingTime tests appended.
- `README.md` — M8d milestone added with backend items ticked, frontend
  items pending.
- `package.json` — minor bump to 0.12.0 (substantial new feature).

### What's NOT in this drop (deferred to next 0.12.x)
- Frontend pages: corrections list, new, detail.
- "Register manually" link on the punch page.
- Working-hours display on the punch page (today: Xh / target).
- Bank balance indicator on the punch page.
- Settings UI for adjusting daily/weekly target hours.
- Spending-the-bank flow (employer marks hours as consumed).
- Per-employee working-time overrides.

### Honest design disclosures
- **Correction → punch materialization is one-way.** Cancelling an
  approved correction reverses the bank but does NOT delete the
  materialized punches. The punches stay in the audit trail. If you
  want them gone, that needs a separate "delete punches by clientId"
  feature.
- **Bank is computed, not stored.** Single source of truth in the
  correction event stream. Slow on huge stores (full reduction every
  call); fine at the scales this app targets. Caching can come in M11.

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
