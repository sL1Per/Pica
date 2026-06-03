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

## [0.53.1] — 2026-06-03 — Reports dashboard polish

Follow-up tweaks to the 0.53.0 dashboard from operator feedback. Frontend-only.

- **Employee filter is now a select.** The employer scope control was a single
  "Everyone" chip plus a hidden picker; it's now one dropdown — "Everyone" plus
  each employee — matching the person-pickers on the punch pages. Picking a name
  switches to that person's view; "Everyone" returns to the team.
- **Charts reordered.** The full-width Average-breaks chart was oversized;
  Average breaks and Hours-worked-vs-target swapped places. Hours-vs-target now
  owns the full-width row (it's the headline chart); breaks moves into the
  smaller slot beside the leave donut.
- **Target line fixed.** The dashed target on the hours chart was the *mean*
  per-bucket target, which dilutes toward weekend days (a week read ~5.7h
  instead of 8h). It's now the **max** per-bucket target — a full working
  bucket: 8h for a day bar, the monthly figure for a year's month bars. The
  period *total* target (40h for a week, and so on) is still on the
  "team hours" KPI card as the "% of target" figure.
- **Coverage-gaps card removed** from the KPI row (the metric is still computed
  server-side but no longer surfaced).

`CACHE_VERSION` v96 → v97 (`charts.js` changed). No API, i18n, or test changes.

### Honest Disclosures

- The hours chart's target line is a **single full-bucket goal** (per-day or
  per-month), not the whole-period total. The period total lives on the KPI
  card. For a week of day-bars, the line sits at one day's target (8h) — each
  bar is measured against a day, not against 40h.
- `coverageGaps` is still returned by `/api/reports/overview` and exercised by
  `test-report-overview.mjs`; only the UI card was removed. A later cleanup can
  drop the computation if it stays unused.

---

## [0.53.0] — 2026-06-03 — Reports dashboard revamp

The Reports page is rebuilt from a set of tables into a **visual dashboard**
centred on the two things Pica measures: **working time** (hours worked vs
target, breaks, punctuality) and **leaves** (used vs allowance, by type). A
feature release that sits alongside the ongoing M16 review work.

Scope is unchanged and still **server-decided**: an employer sees the whole
team or one chosen person; an employee sees only themselves. `scope=all` from a
non-employer is a 403; a non-employer's `?id=` is coerced to their own id. The
new endpoint reuses the existing `parseCommon` access gate verbatim — there is
exactly one place that decides what a caller may see.

**What's new**

- **One consolidated endpoint.** `GET /api/reports/overview?scope=me|all&id=&
  type=day|week|month|year&anchor=YYYY-MM-DD` returns everything the dashboard
  renders — KPI cards, a per-bucket hours series, a leave-by-type breakdown,
  team-summed leave balances, a breaks series, per-person rows, and a
  punctuality watchlist — in one response. Aggregation lives in a new module,
  `src/storage/report-overview.js` (`buildOverview()`), which is **pure of
  access control**: the route resolves the people/scope and passes them in.
- **Hand-rolled SVG charts.** New `public/charts.js` (zero-dependency) builds
  the hours-vs-target bar chart (worked + on-leave bars with a dashed target
  line), the leave donut (by type, with a centre total), and the inline
  vs-target progress bars. No Chart.js, no build step — the SVG strings are
  injected directly and styled with the existing theme tokens.
- **Punctuality, newly possible.** Two new `workingTime` settings —
  `expectedStart` (`"HH:MM"`, default `09:00`) and `graceMinutes` (default
  `10`), with an optional per-employee `expectedStart` override — let the report
  compute on-time %, average clock-in, and late days from the first clock-in of
  each local day. Configured from **Settings → Working time**.
- **Breaks** are derived on read from intra-day punch gaps (an OUT followed by a
  later IN on the same day). No new stored data.
- **Coverage gaps** (employer/team view only): a count of weekdays where fewer
  than 60% of staff clocked in.
- **Export.** "Export CSV" downloads the per-person summary via the existing
  `/api/reports/timesheets?format=csv`, now extended with `avgClockIn`,
  `lateDays`, `onTimePct`, `overtimeHours`, and `avgBreakMin` columns. "Print"
  uses the browser's Save-as-PDF with a print stylesheet — no server PDF.

**Under the hood**

- `src/storage/reports.js` now exports `pairAndSplit`/`parseYmd` so the overview
  builder pairs punches identically to the timesheet report (same midnight-split
  and open-shift handling). The matrix/CSV functions are unchanged.
- The Timesheets/Leaves **tab switch is removed** — both live on one scrolling
  dashboard, matching the reference design.
- `CACHE_VERSION` v95 → v96; `/charts.js` added to `PRECACHE_URLS` (the changed
  precached `locales/*.js` already required the bump). New i18n keys per locale.
  New suite `test-report-overview.mjs`; total **54 suites**.

### Honest Disclosures

- **Punctuality assumes one expected start time per person** (org default or a
  single per-employee override). There is no support for shifts, rotas, or
  per-weekday schedules. Someone with genuinely variable hours will show noisy
  late-day counts. Night shifts that wrap past midnight are not modelled.
- **Coverage-gap % is a heuristic, not a staffing model.** It counts a weekday
  as "under-staffed" when fewer than 60% of people clocked in — it ignores
  part-time schedules and treats an **approved day off as "not present"**, so a
  week with several booked holidays will report coverage gaps.
- **Breaks and average clock-in are computed from raw punches**, so a forgotten
  clock-out skews them exactly as it skews worked hours. A break is only
  recognised between an OUT and a later IN on the **same** local day;
  cross-midnight gaps are ignored.
- **The leave donut is range-scoped while the allowance figures are annual**
  (the year containing the range start). Across a December→January boundary the
  two can look inconsistent; the UI labels which is which.
- **PDF = browser print.** There is no server-rendered PDF (zero-dependency
  constraint). The print stylesheet hides controls and lays the dashboard out in
  one column.
- **The hours bar chart's target line is the mean target across the visible
  buckets** (a flat line), not a per-bucket step line — a deliberate
  simplification that reads cleanly at the ≤50-employee scale Pica targets.
- **No automated browser test.** `charts.js` and the dashboard render are
  verified by the storage/route suites (which cover all the metric math) plus
  manual smoke, consistent with how the rest of the frontend is tested.

---

## [0.52.5] — 2026-06-03 — M16 F6 + F7: correct CLAUDE.md pre-cache rule & local-only note

Fifth M16 increment. Two documentation corrections to `CLAUDE.md`, both found
while doing earlier M16 fixes.

- **F6 — pre-cache rule was incomplete.** CLAUDE.md's "Hard rules" listed the
  pre-cached SW assets as only the shell (`i18n.js`, `topbar.js`, `app.js`,
  `manifest.json`, `icon.svg`, `locales/*.js`, `*.css`) and said "NOT HTML
  files." But `public/sw.js` `PRECACHE_URLS` also pre-caches most per-page page
  scripts (`index.js`, `punch.js`, the `*-detail-modal.js` files) and shared
  helpers (`calendar-grid.js`, `leave-format.js`, …). The rule now points to
  `PRECACHE_URLS` as the **authoritative list** (so it can't drift again) and
  describes its real contents. The matching "shell changes" shorthand in the
  file-tree comment for `sw.js` was corrected too. This is why the F3 (0.52.2)
  and F5 (0.52.4) edits correctly bumped `CACHE_VERSION` for `index.js` /
  `leave-format.js` even though the old doc implied page scripts weren't cached.
- **F7 — "institutional memory" vs gitignored.** CLAUDE.md is gitignored by
  design (grouped with `.claude/`, `config.json`, `data/`), yet read as the
  project's accumulating institutional memory. Decision (Pedro): **keep it local
  by design.** The header now states plainly that the file is local, gitignored,
  not committed, and does not travel with clones — treat it as this checkout's
  operator notes, not a shared source of truth.

### Honest Disclosures

- **`CLAUDE.md` is gitignored, so neither edit is tracked by git.** As with the
  F4 fix (0.52.3), the committed record of this change is this RELEASES entry +
  the version bump, not a diff. The working-tree CLAUDE.md is now accurate; other
  checkouts keep their own copies (that local-only behaviour is now the
  documented, intended state — F7 resolved as "keep local").
- **Documentation-only.** No code, no behaviour change, no `CACHE_VERSION` bump.
- **F6 trades a concrete list for a pointer.** The doc no longer enumerates every
  pre-cached file; it tells you to read `PRECACHE_URLS`. That is the point (single
  source of truth), but it does mean the doc is now correct-by-reference rather
  than self-contained.

---

## [0.52.4] — 2026-06-03 — M16 F5: share the leave formatting helpers

Fourth M16 fix. `leave.js` (the leave detail page) and `leave-detail-modal.js`
(its in-page modal twin, added 0.48.0) carried **byte-identical** copies of five
pure functions: `pad2`, `ymd`, `parseYmd`, `formatWhen`, and `formatDuration`.
They are now defined once in a new `public/leave-format.js` and imported by both,
so a future fix to (say) the overnight time-range formatting can't land in one
view and miss the other.

Details:

- New `public/leave-format.js` exports the five functions (it imports `tn` /
  `fmtHours` from `/i18n.js`, which `formatDuration` needs). No DOM, no module
  state — pure and safe to import anywhere.
- `leave.js` and `leave-detail-modal.js` drop their local copies and import from
  the shared module. The now-unused `tn` and `fmtHours` imports (they were only
  used by `formatDuration`) were removed from both files.
- `public/sw.js`: `/leave-format.js` added to `PRECACHE_URLS` (it is a static
  import of the already-pre-cached `/leave-detail-modal.js`, so it must be
  cached too); `CACHE_VERSION` v94 → v95.

Scope was deliberately narrowed after a side-by-side read (recorded in the
ledger): the **renderers** `renderMiniCal` / `renderActivity` were *not* shared.
They look similar but are genuinely adapted — the page uses the `ldet-*` CSS
namespace and writes into existing DOM hosts, while the modal uses `ldm-*` and
returns detached nodes. Sharing them would require unifying two CSS files and
has no rendering-test coverage, so it was judged not worth the risk at this
scale. The correction page/modal pair overlaps even less and was left alone.

### Honest Disclosures

- **No behaviour change.** This is a pure dedup; the five functions are
  unchanged. Verified by `node --check` on all four files and the full suite
  (53/53), including `frontend-imports` (import graph resolves) and
  `sw-precache`. There is still **no rendered-DOM test** for these views, so the
  guarantee is "identical source, same inputs," not "pixel-verified."
- **~28 lines removed net of duplication; one new pre-cached module added.** The
  trade is fewer drift-prone copies for one more file in the cache manifest —
  judged worthwhile only because the formatters produce user-facing strings that
  must match between page and modal.
- **The renderers remain duplicated by design.** F5 is considered resolved at
  this scope; a future CSS-namespace unification could revisit the renderers but
  is out of scope for M16.
- `docs/architecture.md`'s frontend file inventory now omits `leave-format.js`;
  that inventory reconciliation is part of the pending Phase 4 doc-truth sweep.

---

## [0.52.3] — 2026-06-03 — M16 F4: correct stale test-suite count in CLAUDE.md

Third M16 fix (doc-truth). CLAUDE.md's file-layout diagram claimed
"`~33 suites`"; the real count is **53** (`docs/architecture.md` already says so).
Updated line 87 to "53 suites (source of truth: docs/architecture.md)".

Deliberately **not** changed: the "total 40" (M14 / 0.25.0) and "total 41"
(0.26.0) lines further down in CLAUDE.md's roadmap snapshot. Those are
point-in-time historical counts describing the suite total *at that release*,
not current-state claims — rewriting them to 53 would corrupt the historical
record. Only the current-count claim was stale.

### Honest Disclosures

- **Documentation-only.** No code, no behaviour change, no `CACHE_VERSION` bump.
- **The corrected file (`CLAUDE.md`) is gitignored** (`.gitignore:8`), so this
  fix lives in the working tree, not git history — even though CLAUDE.md's own
  header describes it as "checked into the codebase." The tracked record of this
  fix is therefore *this RELEASES entry + the version bump*, not a diff to
  CLAUDE.md. The contradiction (gitignored vs. "checked in") is logged as ledger
  finding **F7** for Pedro to decide; not changed here.
- **Narrow scope.** This corrects the one stale *current-count* claim in
  CLAUDE.md. A full Phase 4 doc-truth sweep (architecture.md file lists vs. the
  real `src/`/`public/` contents, F6's pre-cache list, other footers) is still
  pending and tracked in the ledger.
- The "source of truth" pointer now leans on `docs/architecture.md:371`; if that
  number drifts in future, line 87 drifts with it. Keeping a single canonical
  count there (rather than duplicating the number in many docs) is the intent.

---

## [0.52.2] — 2026-06-03 — M16 F3: home leave month label respects app locale

Second M16 fix. On the employee home page, the "Your leaves" card renders each
upcoming leave's month abbreviation. The label was built with
`start.toLocaleString(undefined, { month: 'short' })` — passing `undefined` as
the locale, so the month name (e.g. "May" vs "mai") followed the **browser's**
default locale instead of the user's selected app locale. Every sibling calendar
label (`leave.js`, `leave-detail-modal.js`) already passes the app locale via
`getLocale()`.

The fix: `public/index.js` now imports `getLocale` from `/i18n.js` and uses
`start.toLocaleString(getLocale(), { month: 'short' })`, matching the
established convention. One-line behavioural change; no API or backend impact.

`CACHE_VERSION` v93 → v94 (`/index.js` is a pre-cached SW asset — see the
disclosure below).

While fixing this I noticed CLAUDE.md's "pre-cached SW asset" list is incomplete:
it names only `i18n.js`, `topbar.js`, `app.js`, `manifest.json`, `icon.svg`,
`locales/*.js`, and `*.css`, but `sw.js` actually pre-caches the per-page page
scripts too (including `/index.js`). Logged as ledger finding **F6** for the
Phase 4 doc-truth pass; not fixed here.

### Honest Disclosures

- **Not covered by an automated test.** The label is pure `Intl` formatting; the
  sibling month labels in `leave.js` are likewise untested. Asserting locale
  output inline would be brittle (environment-/ICU-dependent), so this was
  verified by code inspection + `node --check` + the import/precache suites, not
  a rendered-DOM test.
- **Other pages were not swept** for the same `toLocaleString(undefined, …)`
  pattern beyond `index.js` (which is now clean). A full Phase 3 grep for raw
  `undefined`-locale formatting across `public/` is still pending.
- CLAUDE.md's pre-cache list inaccuracy (F6) is documented, not corrected — that
  belongs to the Phase 4 doc pass.

---

## [0.52.1] — 2026-06-03 — M16 F1: fix timezone-flaky reports test

First M16 fix. The baseline shipped red: `tests/test-reports.mjs` →
"overnight shift attributes hours to each day separately" failed on the
development machine (CEST). Root cause was in the **test**, not the code.

What was happening:

- `hoursReport()` buckets hours by the **server's local** calendar day and
  splits overnight shifts at **local** midnight (`splitByMidnight` / `ymdOf`
  in `src/storage/reports.js`). That behaviour is deliberate and correct.
- The test fixtures used fixed UTC instants (a shift from `22:00` on the 5th
  to `06:00` UTC on the 6th) and implicitly assumed those instants land on
  opposite sides of *local* midnight. That only holds in a band of timezones
  (~UTC-2..UTC+1). On CEST (`UTC+2`), Los_Angeles, or Tokyo the whole shift
  falls on a single local day, so the report produced **1** bucket and the
  `length === 2` assertion failed.

The fix: pin the test process to `process.env.TZ = 'UTC'` (Node honors a
runtime TZ write via `tzset`), so the UTC fixtures deterministically straddle
local(=UTC) midnight on any machine. **No production code changed.** Verified
green under the system default plus `TZ=UTC`, `Europe/Lisbon`,
`America/Los_Angeles`, and `Asia/Tokyo` (29/29 each), and the full suite is now
53/53.

Ledger: `docs/m16-findings.md` F1 → fixed.

### Honest Disclosures

- **Test-only change.** Behaviour of `hoursReport()` is untouched; this only
  removes the test's hidden dependence on the developer's machine timezone.
- **Only `test-reports.mjs` was pinned.** Other suites that construct local
  `Date`s may carry the same latent fragility; they pass on this machine today,
  but a systematic "pin TZ in date-sensitive suites" sweep is not part of this
  fix. Logged as an observation for the Phase 3 sweep.
- **The underlying single-server-local-timezone reporting model is unchanged.**
  Whether hours *should* bucket by the employee's timezone rather than the
  server's is a product question, not addressed here.
- No `CACHE_VERSION` bump (no pre-cached asset changed).

---

## [0.52.0] — 2026-06-03 — M16 opens: code-review plan + findings ledger

The start of **M16 (code review / optimization / simplification)**. This release
ships **no code change** — it is the milestone's scaffolding plus the first
read-only review sweep. Nothing in `src/`, `public/`, or `tests/` was modified.

What landed:

- **`docs/m16-code-review-plan.md`** — the full M16 plan: scope contract
  (security findings are deferred to M17 by design), a module-by-module review
  matrix grounded in the actual file list, cross-cutting invariant sweeps, a
  triage rubric, and the per-module release cadence.
- **`docs/m16-findings.md`** — the findings ledger. Every issue is logged here
  for review *before* any fix; nothing is changed until triaged.

First-sweep findings (read-only; details in the ledger):

- **F1 (correctness, M16):** the baseline is **red** — `tests/test-reports.mjs`
  has one failing test ("overnight shift attributes hours to each day
  separately": expects 2 buckets, gets 1). `main` ships with a failing suite.
- **F2 (security, → M17):** `src/storage/punches.js` builds a file path directly
  from the unvalidated `:id` of `GET /api/punches/by-employee/:id` — the 0.22.0
  traversal class. `leaves.js` (guarded by `safeLeaveId`) and `corrections.js`
  (log-scan lookup) are not exposed the same way. Deferred to the security
  milestone, not fixed here.
- **F3 (i18n, M16):** `public/index.js:482` formats a month label with
  `toLocaleString(undefined, …)`, ignoring the app locale.
- **F4 (doc drift, M16):** `CLAUDE.md` still says "~33 suites / total 40"; the
  real count is 53 (`docs/architecture.md` is already correct).
- **F5 (duplication, M16):** suspected large overlap between the page renderers
  and their detail-modal mirrors (`leave*`, `correction*`) — needs a confirming
  read before any extraction.

Clean checks recorded (so they aren't re-run): frontend hour formatting (no
`fmtHours` bypass), `encryptBlob`/`encryptField` AAD binding (all sites bound),
en/pt locale key parity (974 each, zero orphans), `rejectIfBadId` on all employee
`:id` handlers, and the leave-attachment path guard.

### Honest Disclosures

- **This is a partial first sweep, not a complete review.** Phase 2
  (module-by-module reads) has **not** started as full reads — only grep-driven
  spot checks. The plan's module matrix is still entirely unchecked. Phase 3 is
  partial (500-char caps, CACHE_VERSION list, CSP-hash parity, and the
  throw-vs-null contract are not yet swept).
- **No fixes.** F1's red baseline is documented, not repaired — including the
  fact that the project currently ships a failing test. F2 is a live security
  observation left unfixed by design (M17).
- **`/code-review ultra` was not run** — it is operator-triggered and billed;
  its findings are not yet in the ledger.
- **No smoke run** — the review container has no network; the boot smoke must be
  run locally before M16 closes.
- **CACHE_VERSION not bumped** — no pre-cached asset changed (docs only).

---

## [0.51.0] — 2026-06-03 — Employer sees their own leave balance cards

The employer `/leaves` page now shows a personal **"Your balance"** card —
the same four stat blocks (type · remaining `/ allowance` · usage bar · used
· pending) that employees already saw — at the top of the employer region,
above "Pending approval". The employer is a person with their own leave
allowance too, but until now the page only showed the team-balance matrix
(everyone else) and gave them no at-a-glance view of their own remaining
days.

How it works:

- The card mirrors the employee "Your balance" block exactly. `leaves.js`'s
  `renderBalanceBlocks(balances, container)` was parameterized to take a
  target container, so the employee and employer cards share one renderer.
- `refreshBalances()`'s employer branch now also fetches the employer's own
  balance via the existing `GET /api/leaves/balances/:userId` endpoint
  (employers may read anyone's balance, including their own) and renders it
  into the new `#balance-blocks-empr` container, alongside the team matrix.
- It is **year-aware**: changing the year `<select>` (which already drove the
  team matrix) now also re-renders the employer's own balance for that year.

Frontend-only — no HTTP API changed, no new endpoint, no backend code
touched. `CACHE_VERSION` v92 → v93 (`leaves.js` is served cache-first by
the service worker). No new i18n keys (reuses `leaves.yourBalance` /
`leaves.balanceNote` / `leaves.balUsed` / `leaves.balPending`). No new test
suite (the balance-block renderer is the same code path the employee view
already exercises; `test-leaves-render` unchanged at 53 suites).

### Honest Disclosures

- **No live browser pass.** Verified by `node --check` on `leaves.js` and by
  reading the shared render path; not exercised in a fresh authenticated
  employer session (the smoke `rm -rf data` is disallowed on this install).
- **One extra request on the employer page.** The employer `/leaves` load
  now issues a second balances fetch (own balance) in addition to the team
  matrix. Negligible at the ≤ 50-employee target scale.
- **Placement is opinionated.** "Your balance" sits at the very top of the
  employer region, mirroring the employee layout. It pushes the "Pending
  approval" inbox down by one card; if operators prefer the inbox first,
  that's a one-line markup move.
- **Carry-forward still not applied.** Same footnote as the employee card —
  unused-allowance carry-forward is not modeled; the note says so.

---

## [0.50.0] — 2026-06-03 — Bell notifications open the detail modals

Clicking a leave or correction in the notifications bell now opens the
same in-page detail modal you get from the leaves list, the calendar, and
the employee profile — instead of navigating away to the standalone
`/leaves/:id` or `/corrections/:id` page. This completes the modal arc
started in 0.46.0 (corrections) and 0.48.0 (leaves): every entry point to
a pending item now behaves the same way.

How it works:

- Each notification row keeps its `href` (`/leaves/:id`,
  `/corrections/:id`) as a **deep-link fallback**. A plain left-click is
  intercepted (`preventDefault`) and opens the modal; ⌘/Ctrl/Shift-click
  and middle-click still follow the link to the full page, and screen
  readers / no-JS still get a real navigable link.
- The bell lives on every authenticated page, but most pages don't
  `<link>` the modal stylesheets (only leaves, calendar, employee, and
  punch do). `topbar.js` now injects `/modal.css` plus the relevant
  modal stylesheet **on demand** the first time a notification is
  clicked. The modal JS/CSS are already in the service-worker pre-cache,
  so this is a local, instant load.
- The modal modules are pulled in with a dynamic `import()` so pages that
  never open a notification modal don't pay for the code.
- After a decision is taken inside the modal, the bell re-fetches and
  re-renders its pending counts (`onDone` / `onDecided` → `loadNotifs`).

CACHE_VERSION v91 → v92 (`topbar.js` changed).

### Honest Disclosures

- **No new backend.** The bell still aggregates from `/api/leaves` and
  `/api/corrections?status=pending` on mount + tab focus. There is no
  push, no websocket, and no unread/read state — closing and reopening
  the bell re-derives the same list.
- **On-demand stylesheet injection is permanent for the page's lifetime.**
  Once a notification modal is opened on, say, the dashboard, that page
  carries the modal CSS until reload. This is negligible (two small
  stylesheets) and idempotent, but it is not torn down.
- **No deep-link parity check.** The modal and the standalone
  `/leaves/:id` page are maintained separately (the modal re-implements
  the page's rendering). They can drift; this release does not unify
  them. See the 0.48.0 disclosure.
- **Selector coupling.** The click wiring keys off `data-kind` /
  `data-id` attributes on `.appshell__notif-item`. If the notification
  row markup is refactored, this handler must move with it.

---

## [0.49.0] — 2026-06-03 — Slate palette + light mode are the new defaults

The default look for a fresh install (and any user who has never opened
Preferences) is now the **Slate** palette in **light** color mode. Previously
the default was **Linen** palette with color mode **Match system** (which
followed the OS dark/light setting). This is a defaults-only change — every
existing stored preference is untouched, and Linen / Olive / dark / system are
all still selectable in Preferences exactly as before.

- **Synchronous bootstrap (all 17 HTML pages).** The inline `<head>` script
  that resolves the theme before CSS now defaults a missing `pica-palette` to
  `slate` and a missing `pica-color-mode` to `light` (was: bare `:root` = Linen,
  and "no stored mode" = follow `prefers-color-scheme`). It also applies
  `data-palette="slate"` **up front** (overridden if the user picked another
  palette), so the default holds even on the degraded path where `localStorage`
  is blocked. The block stays **byte-identical across all 17 files**, so the
  single CSP hash that pins it still covers them — the server recomputes that
  hash from `index.html` at startup (verified: it produces a valid
  `'sha256-…'` token against the new bootstrap).
- **Server default (`src/storage/user-prefs.js`).** `DEFAULT_PREFS` now reads
  `colorMode: 'light'`, `palette: 'slate'`. `GET /api/settings/me` returns these
  for a user with no stored prefs, so `app.js`'s post-load refresh applies Slate
  light too. `VALID_PALETTES` / `VALID_COLOR_MODES` are unchanged — Linen, Olive,
  dark, and system remain valid choices.
- **Front-end fallbacks aligned.** `app.js`'s color-mode fallback went
  `'system'` → `'light'` (and its dark test from `mode !== 'light'` to
  `mode === 'system'`, functionally identical given the three valid modes);
  `preferences.js`'s `selectedPalette` initial + `prefs.palette || …` fallback
  went `'linen'` → `'slate'`. The Preferences picker, chip previews, and save
  flow are otherwise unchanged.
- **Plumbing.** `CACHE_VERSION` v90 → v91 (the pre-cached `app.js` and
  `preferences.js` changed; the HTML bootstrap is not pre-cached but the SW
  serves all assets cache-first keyed by `CACHE_VERSION`, so the bump is what
  delivers the new JS to returning clients). `test-user-prefs.mjs` updated to
  assert the new defaults. No new test suite (count stays 53); no i18n, no API
  shape change.

**Honest Disclosures.**
- **Linen is still the CSS bare-`:root` combo.** This change does *not* reshuffle
  app.css's token cascade — Slate is applied via `data-palette="slate"`, not by
  making Slate the attribute-less root. The phrase "Linen is the default" in old
  comments was corrected, but the CSS structure (Linen = no attribute) is intact.
- **Only affects users with no stored preference.** Anyone who has saved a
  palette/mode keeps it. There is no migration and no "reset to new default"
  action; existing installs' current users see no change unless they were
  relying on the implicit default.
- **`system` is no longer the out-of-the-box mode.** A new user on a dark-mode OS
  now gets **light** Pica until they choose "Match system" in Preferences. This
  is the deliberate intent of "light color mode the default," but it does mean
  the app no longer auto-follows the OS for brand-new users.
- **Not verified in a live browser this release.** Confirmed by `node --check`,
  the theme/prefs/security-headers suites, and a direct `computeBootstrapHash`
  call; not by a fresh clean-install screenshot. The data path that would prove
  it (a brand-new user with an empty `data/`) isn't exercised here because the
  smoke-cleanup `rm -rf data` is disallowed on this install.

---

## [0.48.0] — 2026-06-02 — View a submitted leave in an in-page modal

Viewing an already-submitted leave no longer navigates away to the
`/leaves/:id` page — it opens an in-page **modal**, mirroring the correction
detail modal shipped in 0.46.0. The standalone page is **kept** as the
deep-link fallback (⌘/middle-click, screen readers, and direct URLs still
reach it). **Frontend-only — no HTTP API changed.**

- **New `public/leave-detail-modal.js`** (`openLeaveModal({ id, me, onDone })`),
  a lazily-built singleton on the generic `/modal.js` shell. It salvages the
  render/decide logic from the `leave.js` detail page at **full parity**: the
  status hero, the Details `<dl>` (employee / type / when / duration /
  requested), the reason, the attachment (download pill + upload/remove via the
  same `PUT`/`DELETE /api/leaves/:id/attachment`), the decision note, the decide
  actions (employer **approve** with the `/overlaps` concurrency confirm +
  inline-notes **reject**; owner **cancel request**; employer **cancel approved**
  with confirm), the mini-calendar (shared `/calendar-grid.js` `monthMatrix`),
  and the activity timeline. All DOM is built with `createElement`/`textContent`
  (no `innerHTML` with dynamic data) and errors render inline inside the modal —
  CSP-clean. After any successful action it re-renders in place and fires
  `onDone` so the opener refreshes.
- **New `public/leave-detail-modal.css`** — self-contained `ldm-` vocabulary
  (adapted from `leave.css`'s `ldet-` rules, collapsed to the modal's single
  column) so it styles correctly on pages that don't link `leave.css`.
- **Four entry points** now open the modal on a plain click while keeping their
  `href` as the fallback: the calendar **pills** and **day-popover rows**
  (`leaves-calendar.js`), the **`/leaves` request-list rows** (`leaves.js`), and
  the **employee-detail upcoming-leave pills** (`employee.js`). Modifier/middle
  clicks (`⌘`/`Ctrl`/`Shift`/non-primary button) fall through to the page.
  `employee.js` now fetches `/api/me` once for an accurate viewer; if that fetch
  fails the pill silently falls back to plain navigation.
- **Plumbing:** `leave-detail-modal.{js,css}` linked on `leaves.html`,
  `leaves-calendar.html`, `employee.html` and added to the SW pre-cache;
  `CACHE_VERSION` v89 → v90. One new i18n key per locale (`leave.modalTitle`);
  every other string reuses the existing `leave.*` / `leaves.*` / `status.*`
  keys. No new test suite (total stays 53).

**Honest Disclosures.** The render/decide logic is **duplicated** from
`leave.js` rather than extracted into a shared module — the page renders into a
fixed HTML scaffold while the modal builds DOM dynamically, so the two don't
share a render path; this is the same trade-off the 0.46.0 correction modal
took, and the page stays the canonical implementation. The mini-calendar
highlights only the **start month** of a leave that spans months (same as the
page). Decide success shows no toast inside the modal (the in-place re-render is
the feedback). On the employee-detail page the modal needs a `/api/me` round-trip
the page didn't previously make. Verified by `node --check` on every touched
file + the touched unit suites + code review — **not** a fresh live browser pass
across all four entry points and both palettes.

---

## [0.47.2] — 2026-06-02 — Calendar: drop the employee Mine|Team scope toggle

Frontend-only change to `/leaves/calendar`. The employee view carried a
**Mine | Team** scope toggle in the toolbar (default Team). Defaulting to Team
already showed every active leave; the **Mine** option filtered the grid down
to the viewer's own leaves. Per the operator's request the toggle is **removed**
— an employee now always sees that *someone* is on leave on a given day, without
having to opt into "Team".

**Privacy is unchanged.** Others' leaves still arrive **anonymized** through
`mergeLeaves` (own all-status leaves from `/api/leaves` + anonymized approved
others from `/api/leaves/approved`); the grid renders them as the existing
"Unavailable" blocks with no name or type, and `canOpen()` still refuses to open
a popover for anonymized entries. The employee learns *that* a day is occupied,
never *who* is off or *why* — exactly the behavior shipped in 0.36.0, now without
the toggle that could hide it.

- **`leaves-calendar.js`:** removed the `scope` state var, the `renderScope()`
  toolbar renderer, its bootstrap call, and the `scopeEl` handle; `scopedLeaves()`
  now just applies the type-chip filter (`allLeaves` already holds the correct
  own+anonymized set). Employer behavior is untouched (the toggle was always
  hidden for employers).
- **`leaves-calendar.html`:** dropped the empty `#cal-scope` toolbar slot.
- **`leaves-calendar.css`:** removed the `.cal-scope` / `.cal-scope__btn` /
  `--active` rules and the mobile `margin-left` reset.
- **i18n:** removed the now-unused `calendar.scopeMine` / `calendar.scopeTeam`
  keys from both locales (parity held).

`CACHE_VERSION` v88 → v89 (pre-cached CSS + locale assets changed). No backend or
API change; no new test suite (`test-calendar-grid` + `test-i18n` stay green;
total 53).

**Honest Disclosures.** The toggle is gone, not hidden — there is no longer any
way for an employee to collapse the calendar to only their own leaves (a minor
loss of a convenience filter, accepted for the always-visible behavior). The
anonymization is only as strong as the `/api/leaves/approved` feed's
`anonymized` flag — this release does not re-audit that endpoint. Verified by
syntax-check + the touched unit suites + a manual read of the privacy path; not
a fresh live browser pass.

---

## [0.47.1] — 2026-06-02 — Sidebar stays put; only the content column scrolls

CSS-only fix to the desktop app shell. Before, `.appshell` used `min-height:
100vh`, so the grid grew with the page and the **whole document** scrolled. The
sidebar's `position: sticky; height: 100vh` kept the rail visible during that
scroll, but because the grid's left column was as tall as the (taller) content
column while the sidebar element itself was only 100vh, an empty `--bg` gap
opened up below the rail (visible at the bottom-left on short/medium pages).

The shell is now pinned to the viewport on desktop and only the content column
scrolls:

```
@media (min-width: 761px) {
  .appshell { height: 100vh; min-height: 0; overflow: hidden; }
  .appshell__content { overflow-y: auto; }
}
```

The sidebar grid cell is now exactly 100vh, so the rail fills it with no gap,
and its own `overflow-y: auto` still handles an over-tall nav. Scoped to the
≥761px desktop breakpoint — the mobile drawer (`position: fixed`) and normal
document scroll below 760px are untouched.

**Footer placement fix (the reason the CSS change alone didn't take on most
pages).** `mountTopBar()` is async (it fetches `/api/me` before wrapping the
DOM). Every page except the home page calls it **without `await`** and then
calls `mountFooter()` synchronously — so the footer was appended to `<body>`
*before* `.appshell__content` existed, landing it full-width at the body level,
**outside** the pinned 100vh shell. That extra body-level content made the
document scroll (dragging the in-shell sidebar up with it) and rendered the
footer spanning under the sidebar. `mountTopBar()` now relocates any
already-mounted `.app-footer` into `.appshell__content` when it wraps the DOM,
so the footer lives inside the scrolling content column regardless of call
order (the awaited home page already landed it there; this fixes the other ~7
pages). `topbar.css` + `topbar.js`; CACHE_VERSION v87→v88.

**Honest Disclosures.**
- **No structural change.** The DOM, the sticky declaration, and the mobile
  layout are unchanged; this is purely the viewport-pinning + content-scroll
  pair plus the `min-height` reset on desktop.
- **The page's vertical scroll position now lives on `.appshell__content`,
  not the document.** On desktop `window.scrollY` is now ~0. The leaves-calendar
  day popover (`leaves-calendar.js`) positions itself absolute-to-`body` using
  `getBoundingClientRect()` + `window.scrollY`: initial placement is still
  correct (rect is viewport-relative and scrollY≈0 maps to viewport coords), but
  the popover **no longer re-tracks its cell if you scroll the content while it
  is open** — it's anchored to the non-scrolling body. Acceptable for a
  tap-to-open day detail; any future scroll-to-top / scroll-restore logic for the
  main column must target `.appshell__content` on desktop, not the document.
- **No tests added.** Layout/scroll behavior isn't covered by the Node test
  suites (no browser harness — the zero-dependency constraint stands); verified
  by local smoke + visual check.

---

## [0.47.0] — 2026-06-02 — Punch tab search everywhere + Today-style week cards

All three `/punch` tabs (**Today · Corrections · This week**) gained the same
styled search box, the This-week tab gained an employer **"All employees"**
view rendered as **Today-style cards**, and the toolbar/search CSS was
generalized. Frontend-only (`punch.{html,css,js}`, `punch-corrections.js` +
2 i18n keys per locale) — **no backend change**.

**Search bar matches the Team list, on every tab.** The search input is wrapped
in `.punch-search-wrap` with a leading **magnifying-glass icon** (CSS mask,
tints with `--muted` across every theme/palette) and the white **`--paper`**
surface, 44px tall with a 12px radius — visually identical to the `/employees`
toolbar. The class is scoped (`.punch-search-wrap .punch-search`, specificity
(0,2,0)) so it beats app.css's `input[type="search"]` (0,0,1). The search grows
wide (`flex: 1 1 320px`); the **person picker** sits beside it
(`flex: 0 0 auto`, `max-width: 200px`, long names ellipsize). The previous
`.week-toolbar`/`.week-search*`/`.week-person` classes were renamed to the
generic `.punch-toolbar`/`.punch-search*`/`.punch-person` and reused by all
three tabs.
  - **Today** filters by name (employer: hides whole `.ptoday-emp` cards),
    address or comment; the employee view hides individual `.sess` rows. The
    filter is re-applied after each `refresh()` (every clock in/out).
  - **Corrections** filters `.corr-row`s in both the pending and history lists by
    name/date/reason. A new optional `onRendered` hook on `initCorrectionsPanel`
    re-applies it after every (re-)render, so it survives tab switches and inline
    approve/reject reloads.
  - **This week** keeps its existing `.sess`-text filter.

**Employer person-picker on all three tabs.** Today and Corrections gained the
same **"All employees" / one-person** `<select>` the This-week tab has (default
"All"). On Today and Corrections it is a pure **DOM filter** (the data already
covers everyone): each Today card carries `data-emp-id` and each correction row
carries `data-emp-id`, and the picker hides the rest, **combined with** the
text search (a row/card must match both). The This-week picker still re-fetches
the chosen person's week. All three are populated by one shared
`populatePersonPicker()` helper (employer-only; hidden for employees and when
the cache is empty).

**Employer "All employees" week → Today-style cards.** The week person-picker
gains a leading **All employees** option (value `''`) that is now the
**default** — the panel shows **everyone's** week, one **card per person** built
with the same `.ptoday-emp` chrome as the employer Today tab (avatar + name +
role head, the **week total** on the right, a padded body of per-day groups).
People with no punches this week are omitted; picking a single name narrows to
that person (the prior single-`#week-head` layout). Employer Today cards now
also stack with a 16px gap (`#employer-today-groups` flex column) to match.
Implemented by extracting shared helpers — `currentWeekWindow()`,
`fetchWeekPunches()`, `buildDayGroups()`, `buildWeekHeadEl()`,
`buildWeekEmpCard()`, `weekTotalMs()`, plus `renderWeekEmpty()`/
`renderWeekError()` — reused by both week paths. `weekPersonId()` returns the
picker's empty value as-is (it previously fell through to the viewer's own id,
so "All" could never load).

`CACHE_VERSION` v86 → v87 (`punch.css`/`punch.js`/`punch-corrections.js`/locales
are pre-cached). New i18n keys `punch.weekAll` + `punch.corrSearchPh` both
locales. No new test suite (the touched logic is pure-helper refactors already
covered by `test-punch-week`; rendering has no DOM test — M16).

**Honest Disclosures:**
- **No DOM/E2E test** for the new card rendering, the search filters, or the
  toolbars — the in-repo helpers (`groupPunchesByDay`/`pairDay`) are unit-tested
  but the render path, filters and CSS are not (M16). Verified by reading,
  syntax-check, and the existing unit suites — **not a live browser pass** this
  round.
- **All-employees mode fans out one `GET /api/punches/by-employee/:id` per
  employee** (×2 when the week straddles a month boundary). Fine at the ≤50
  target scale; it is not a single batched endpoint.
- **Search filters match rendered `textContent`**, so an **address only counts
  once reverse-geocoding has resolved** it (until then the row carries raw
  coords). The Corrections employee view has no name in its rows, though the
  placeholder still says "name".
- **Search does not hide a now-empty container**: a This-week person card or a
  Corrections list heading can remain visible with no matching rows under it.
- The single-person week view and the employee's own week keep the simpler
  `#week-head` + day-list layout (only the all-employees view is card-per-person).
- The week card shows a **week total but no status pill** (a single "Done/Working"
  status is meaningless across a multi-day range); it also keeps the This-week
  **MANUAL/AUTO** badges + missing-punch hints, which the single-day Today card
  does not render.
- The picker has **no chevron glyph** (the `--paper` background overrides
  app.css's `select` chevron image).

---

## [0.46.4] — 2026-06-02 — Fix: Correction modal Approve/Reject buttons misaligned

In the Correction detail modal's **Actions** row (`correction-detail-modal`),
the **Reject** button sat ~16px lower than **Approve**, so the two read as
vertically misaligned.

### Root cause

`correction-detail-modal.css` neutralized the global `button { margin-top:
16px }` only on **direct children** of `.cdm-actions`:

```css
.cdm-actions > button, .cdm-actions > .btn-reject, … { margin-top: 0; }
```

But the Reject button is **not** a direct child — `buildRejectInline()` nests
it inside a `.cdm-reject-wrap` column (so the collapsible reject-notes sub-form
can sit under it). The `>` combinator therefore missed it, the trigger kept its
16px top margin, and with `.cdm-actions { align-items: flex-start }` it dropped
below the Approve button.

### Fix

One line — neutralize the margin on every button in the row regardless of
nesting:

```css
.cdm-actions button { margin-top: 0; }
```

Approve and Reject are now top-aligned and equal height (verified with a
Playwright screenshot of the real card markup at desktop width). CSS-only;
`CACHE_VERSION` v85 → v86; no JS/HTML/backend/i18n/test change; version
`0.46.3` → `0.46.4`.

### Honest Disclosures

- **One-line CSS fix.** No markup or behaviour change; the reject sub-form
  flow, confirm strings, and the mobile (stacked, full-width) layout are
  untouched (mobile never showed the gap — it stacks).
- **No regression test.** Button alignment in a JS-built modal isn't covered by
  the unit suites (DOM/render testing is M16); verified by screenshot.

---

## [0.46.3] — 2026-06-02 — Row separators on the Leaves request lists (dead-selector fix) + record-row consistency

Two things. (1) The real bug: the **Leaves request lists** (employer *Pending
approval* and *All requests*, employee *Your history*) drew **no row
separators at all** — not faint, *absent*. (2) A consistency pass bumping the
deliberately-faint `--line-soft` hairline up to the standard `--line` on the
record-row separators that *were* rendering.

### Root cause of the missing lines

`leaves.css` separated rows with `.lv-row + .lv-row { border-top: … }` — an
**adjacent-sibling** rule. But `leaves.js` renders each row as
`<ul class="lv-list"> › <li> › <div class="lv-row">` — the `.lv-row`s are each
the only `.lv-row` inside their own `<li>`, so they are **never adjacent
siblings** and the rule matched **nothing**. No colour value could ever have
fixed it; the selector was dead. (This was misdiagnosed twice as a contrast
problem, including a short-lived `--line-strong` token that was reverted — see
below.) Fix: target the `<li>` adjacency instead —
`.lv-list li + li { border-top: 1px solid var(--line); }`.

Why only Leaves: the analogous punch lists are **not** affected — there the
`<li>` itself carries the row class (`li.className = 'corr-row …'`), and
`.sess__times` rows are direct siblings, so `.corr-row + .corr-row` /
`.sess__times + .sess__times` match correctly.

### The consistency bump (`--line-soft` → `--line`)

Record-row separators that already rendered but at the very faint
`--line-soft` were raised to the standard `--line` (the token the Reports
`.data-table` already used), so a row of records reads the same everywhere:

- **Reports** (`app.css` `.data-table`): row/`thead`/`tfoot` borders.
- **Leaves** (`leaves.css`): Team-balance matrix header + rows.
- **Team list** (`employees.css`): `.tm-thead` + `.tm-row`.
- **Settings** (`settings.css`): override table + backup list.
- **Home** (`index.css`): `.emp-leave`, `.eh-row`, `.eh-pend`.
- **Employee detail** (`employee.css`): `.ed-day`, `.ed-pend`, `.ed-leave`.
- **Calendar rails** (`leaves-calendar.css`): `.cal-*__row`.
- **Punch** (`punch.css`): `.sess__times` + `.corr-row` lists.

`CACHE_VERSION` v81 → v85 (`app.css` + page stylesheets changed across the
iterations). No HTML, no JS, no backend, no i18n, no new test; version
`0.46.2` → `0.46.3`.

### Honest Disclosures

- **The dead `.lv-row + .lv-row` selector was never caught by a test.** There
  is no DOM/render test asserting the leaves list draws separators (M16
  territory); the fix was verified with a Playwright screenshot of an offline
  harness that reproduces the real `<ul class="lv-list"> › <li> › .lv-row`
  structure. A standing regression test would need the DOM harness M16 brings.
- **A `--line-strong` token was tried and reverted.** Two earlier iterations
  chased contrast (`--line-soft` → `--line`, then a new `--line-strong` token
  at ~40% then ~28% toward `--muted`) before the dead selector was found. Per
  the operator's call the custom token was removed; separators are plain
  `--line`. If `--line` reads too faint once the lists actually render, it is a
  one-line token tweak — but now there is a line to tune.
- **Colour/selector only.** Separators stay 1px; no row padding/hover change.
  Still deliberately faint (left as `--line-soft`): modal/popover/footer
  dividers, the user-menu and app-footer borders, in-card section rules (the
  employer Today card's `.ptoday-emp__head`, the punch `.map-card__meta`), the
  `.sess__missing` hint, and decorative box borders.
- **Service worker caching bit the diagnosis.** A stale SW serves the old
  stylesheet one reload behind even after a hard refresh; clearing site data /
  unregistering the worker (or reloading twice after `v85` activates) is needed
  to actually see the change.

---

## [0.46.2] — 2026-06-02 — Fix: employee-summary blank page on a pending in/out correction

The employer-facing employee-summary page (`/employees/:id`) rendered a
**blank body** — topbar present, content area empty, no visible error —
whenever the employee had a **pending in-only or out-only correction**.
The console showed `RangeError: Invalid time value` thrown from `fmtDate`.

### Root cause

`asDate()` in `public/i18n.js` is the gatekeeper that all date/time
formatters (`fmtDate`/`fmtTime`/`fmtDateTime`) lean on: they call it and
bail with `''` when it returns `null`. But `asDate` validated **only** the
string path — when handed a `Date` instance it returned it **unchecked**:

```js
function asDate(input) {
  if (input instanceof Date) return input;   // ← an Invalid Date slips through
  const d = new Date(input);
  return Number.isFinite(d.getTime()) ? d : null;
}
```

An *Invalid Date* is still a `Date` object and is **truthy**, so it sailed
past every `if (!d) return ''` guard. `Intl.DateTimeFormat.format()` then
threw, and the `catch` fallback `d.toISOString()` threw a second, *uncaught*
`RangeError` — killing the render mid-pass and leaving every section hidden.

The Invalid Date came from `fmtRange()` in `public/employee.js`. A
correction can carry a single endpoint — an **in-only** correction has
`end === null`, an **out-only** one has `start === null`. `fmtRange` did
`fmtDate(new Date(String(start)))`, and `new Date(String(null))` →
`new Date('null')` → Invalid Date. `kind: 'both'` corrections (both
endpoints set) never tripped it, which is why it surfaced only for some
employees.

### The fix

- **`public/i18n.js` — `asDate` now validates both paths.** A `Date`
  instance is range-checked exactly like a parsed string, so an Invalid
  Date can never escape. This hardens **every** date/time formatter
  app-wide, not just this page — any future caller that hands a bad value
  to `fmtDate`/`fmtTime` now gets `''` instead of a thrown render.
- **`public/employee.js` — `fmtRange` handles single-endpoint
  corrections.** It derives the date from whichever endpoint exists and
  collapses to one time when only one is present, so an out-only correction
  reads `Jun 2, 2026 19:00` instead of a half-empty `Jun 2, 2026  –19:00`.
  (`public/punch-corrections.js` already branched per kind and was never
  affected.)
- **`tests/test-i18n.mjs`** gains two cases mirroring the fixed helpers:
  `asDate` rejecting Invalid Date instances, and `fmtDate`/`fmtTime`
  returning `''` (never throwing) for the exact `new Date('null')` input
  from the crash. Suite total unchanged at **53**.

### Honest Disclosures

- **This was a latent bug, not a regression from a recent release.** The
  `asDate`/`fmtRange` code has been in place since the M15 employee-summary
  rebuild (0.27.0 era); it only bites when a pending in/out correction
  reaches the summary, so installs without that data never saw it.
- **No backend, storage, or API change.** The summary endpoint already
  returned `start: null` / `end: null` for single-endpoint corrections —
  that shape is correct and unchanged; the frontend simply mis-handled it.
- **`CACHE_VERSION` bumped v80 → v81** because `i18n.js` is a pre-cached
  asset. Clients pick up the fix on their next service-worker update.
- **Other pages were crash-*safe* but unaudited for display.** The `asDate`
  hardening means no other page can throw on a bad date, but I only
  verified the *visual* correction-range rendering on the employee-summary
  and punch-corrections views. Other date displays were not re-reviewed
  for cosmetic edge cases.
- **The earlier investigation chased a service-worker stale-cache theory**
  (all `.js` is served cache-first, so a fresh HTML page can run a stale
  `employee.js`). That mechanism is real and reproducible but was **not**
  the cause here; it is left as-is. If a stale-shell class of bug recurs,
  revisit the SW JS caching strategy separately.

---

## [0.46.1] — 2026-06-02 — Avatars + role labels across the punch & leaves people-lists

Several people-list sections showed the bare **username** where the rest of the
app shows the **role**, and didn't render the person's **avatar**. This release
aligns them all with the team list (avatar → name → role) and makes the avatar
robust everywhere.

- **Avatar = picture-always-wins.** Every avatar touched here uses one pattern:
  hue-tinted initials paint immediately (instant, no broken-image flash), and
  the uploaded picture loads in the background — replacing the initials on a
  successful load, or leaving them in place on error (no picture on disk). This
  drops the previous dependence on a per-row `hasPicture` flag, which wasn't
  present in every endpoint's payload and would otherwise have needed a server
  restart to surface. **No backend change ships in this release.**
- **Leaves Team-balance matrix** (`leaves.js`, `leaves.css`). Name cell now leads
  with a small avatar and shows the role badge for **every** person (was
  employer-only); the redundant ` · username` sub-label is gone. The shared
  `avatar()` helper switched to the picture-always-wins pattern, so the matrix
  shows real pictures with no restart.
- **Punch employer Today tab** (`punch-today-employer.js`, `punch.js`). Per-
  employee card heads lead with an avatar and show the role label instead of the
  `@handle`. `punch.js` passes an `infoById` map built from the already-fetched
  `/api/employees` list.
- **Punch Corrections tab** (`punch-corrections.js`, `punch.css`). Employer rows
  now lead with the requester's avatar beside the name (new `.corr-row__left` /
  `.corr-row__av`). Employee rows are unchanged (they only ever list their own
  corrections, so no name/avatar is shown). Uses the `employeeId` the
  `/api/corrections` payload already carried — no backend change.
- **Punch This-week tab** (`punch.js`, `punch.html`, `punch.css`). A person
  header (avatar + name + role) now sits above the day groups, identifying whose
  week is on screen — the selected person for an employer, the viewer themselves
  for an employee. New `#week-head` element + `.week-head*` styles.

CACHE_VERSION v79→v80 (`punch.css`, `leaves.css` changed; `punch.html` is not
pre-cached).

**Honest Disclosures.**
- **No HTTP contract changed.** An earlier draft of this work added a
  `hasPicture` field to `GET /api/leaves/balances`; that was reverted in favour
  of the picture-always-wins client pattern, which needs no new field and no
  restart.
- **One picture request per person, even those without a picture.** The
  always-try approach fires a `GET /api/employees/:id/picture` for everyone in a
  list; people with no picture get a 404 and keep their initials. At the
  project's ≤50-employee target this is negligible (and consistent with how the
  list views already fan out), but it is more requests than a `hasPicture`-gated
  approach would make.
- **Not visually verified against a running instance.** Verified via the unit
  suites (`test-leaves*`, `test-punches`, `test-corrections`, all green) and code
  review; no fixtured screenshot was produced. Frontend logic isn't unit-testable
  directly (absolute-path ES modules Node can't import — the standing
  constraint).
- **Avatar sizes differ per surface by design** (36px punch cards/rows/week
  header, 28px leaves table row) — sized to their containers, not one token.

---

## [0.46.0] — 2026-06-02 — Two pages folded into the punch page's tabs

The employer **`/punches/today`** view and the **`/corrections`** list page were
eliminated **as pages** — without losing any feature — by folding their content
into tabs on the existing `/punch` page. The page now carries three tabs:
**Today · Corrections · This week**. Two enhancements requested alongside the
move landed too: a **MANUAL** badge and a **search** filter on This-week.

This is a **frontend + page-routing** change. **No HTTP API changed** — every
endpoint the tabs use already existed.

**Today tab.**
- *Employee:* unchanged — their own session-pair cards.
- *Employer:* the salvaged `/punches/today` view — per-employee cards with a
  status pill (Working now / Done for the day), worked·break totals, and session
  pairs. Lives in a new module `public/punch-today-employer.js`
  (`renderEmployerToday`), reusing `pairSessions` from `team-status.js`.

**Corrections tab** (renamed from the old "My corrections" link).
- *Employee:* their own corrections — Awaiting + History; can file (the existing
  manual-time modal) and cancel their own pending ones.
- *Employer:* everyone's — an "N waiting on you" inbox with **inline ✓/✗** plus
  History; the **Corrections tab carries a pending-count badge**. Reuses
  `POST /api/corrections/:id/{approve,reject}`. New module
  `public/punch-corrections.js` (`initCorrectionsPanel → { reload }`).
- **Rows are clickable → a detail modal** (new `correction-detail-modal.{js,css}`
  on the generic `modal.js` shell), salvaged from the `/corrections/:id` page's
  render + decide logic (approve/reject/cancel/reverse). The standalone
  `/corrections/:id` **page is kept** as a deep-link fallback (the notification
  bell still links to it); a left-click on a row opens the modal, while
  middle/ctrl-click still follow the real `href`.

**This week tab.**
- A **MANUAL** badge now marks any punch materialized from an approved correction
  (correction punches carry a deterministic `clientId` of `correction:<id>:in|out`;
  the read path already exposes `clientId`, so the badge is **pure client-side —
  zero backend change**). Auto clock events keep the "Auto" badge.
- A **search box** filters the week's rows by address/comment text.
- *Employer:* a **person picker** selects whose week to view; *employee:* search
  only, over their own week.

**Routing / files.** `/punches/today` and the `/corrections` list route were
removed (both now **404**). `/corrections/new` still redirects, now to
`/punch?tab=corrections&new=1`. `/punch` accepts `?tab=today|corrections|week`
(and `?id=<correctionId>` to auto-open the detail modal), stripping the query
after handling. Six files deleted (`punches-today.{html,css,js}`,
`corrections.{html,css,js}`); the shared `.sess` builders were extracted into
`public/punch-sessions.js` (also home to `isManual()`).

**Plumbing.** `CACHE_VERSION` v78 → **v79** (new pre-cached assets added,
deleted CSS removed from `PRECACHE_URLS`). i18n: the tab label became
"Corrections"/"Correções"; added `punch.tabManual`, `punch.weekSearchPh`,
`punch.weekPersonAll`, `correction.modalTitle` (both locales); all other strings
reuse existing `corrections.*` / `correction.*` / `punchesToday.*` keys. One new
test suite — `test-punch-manual.mjs` (the `isManual()` predicate) — total **53**.

**Verified live via the Playwright MCP** on a throwaway instance (separate data
dir + port 8123 — the real install untouched), seeded with an employer, an
employee, auto punches, an approved correction (→ MANUAL punches) and a pending
one. Confirmed, both roles: the three tabs; employer Today = everyone; the
Corrections inbox + inline ✓/✗ + count badge + detail modal (approved → Reverse,
employee pending → Cancel); This-week MANUAL badges + working search + person
picker; `?tab`/`?id` deep-links + query strip; and the removed routes returning
404 while `/corrections/:id` stays 200. Console was clean. The live pass caught
one bug, fixed in this release: the pending-count `<span>` was nested inside the
`data-i18n` tab button, so `applyTranslations()` (which sets `textContent`)
wiped it — the i18n label was moved onto an inner span so the count is a sibling.

### Honest Disclosures

- **The employer keeps the clock-in/out hero** on `/punch`. This was an explicit
  choice and **deviates from the design screenshots**, which show no hero for the
  employer. Employers can still self-clock from this page as before.
- **MANUAL detection is a heuristic on the `clientId` prefix** (`correction:`).
  It's coupled to the convention in `src/routes/corrections.js`; if that prefix
  ever changes, the badge silently stops appearing. The coupling is commented at
  both ends.
- **The detail modal duplicates the `/corrections/:id` page's render/decide
  logic** rather than sharing one module. The page stays for deep links; unifying
  the two is a deferred cleanup.
- **Duration renders without a unit in the modal** (`fmtHours(9)` → "9", matching
  the corrections list's existing rendering) rather than the old detail page's
  "9h". Consistent with the list; a cosmetic difference from the retired page.
- **The employer person-picker lists every user, including the employer**, and
  defaults to the first entry (which may be the employer, who often has no
  punches) — so an employer may see an empty week until they pick a colleague.
- **No DOM/E2E test harness** covers the new tabs (that is M16). Verification was
  live via the Playwright MCP at one viewport and palette (Linen-light), plus the
  unit suites. The two pre-existing flakes (`test-reports` overnight-split TZ,
  `test-auth` ~1/64) are unrelated and unchanged by this work.

---

## [0.45.1] — 2026-06-01 — Punch map fills the hero height

The OSM map preview on the punch page now stretches to the full height of the
clock hero's top row instead of sitting as a short 120px-tall card centred
against the taller control column. **CSS-only** (`punch.css`); no markup, JS,
or backend change.

**What changed.**

- **`.clock-hero__top` now stretches its columns** (`align-items: center` →
  `stretch`), so the map column matches the height of the taller control column
  (status · time · comment · button) beside it.
- **`.map-card` became a flex column** and **`.map-card__frame` grows to fill**
  (`flex: 1 1 auto`, fixed `height: 120px` → `min-height: 120px`). The tile now
  fills the available height edge-to-edge while the address line and OSM
  attribution stay at their natural height pinned to the bottom of the card.
- **Map pulled left toward the action button** with `margin-right: 32px` on
  `.map-card`, widening the gap to the section's right edge (24px → ~56px). Reset
  to `0` in the mobile stacked layout, where the card is full-width.

CACHE_VERSION v77 → v78 (`punch.css` is a pre-cached SW asset).

**Honest Disclosures.**

- **Purely presentational.** The map only renders after a successful
  geolocation fix; nothing about when/whether it appears, the tile source, the
  pin maths, or the address lookup changed.
- **The pin stays centred in the frame** (`top: 50%`, translate to the tip), so
  in the taller frame it sits at the vertical centre rather than over the exact
  fix point — same approximation as before, just over a larger tile.
- **Mobile is unchanged.** When the hero stacks (≤ 760px), the map-card has no
  parent height to stretch into, so the frame falls back to its `min-height`
  (120px) — the original stacked look.
- **No new tests.** This is a layout tweak with no testable logic; verified
  visually against the live install (frame grew 120px → ~397px).

---

## [0.45.0] — 2026-06-01 — "Forgot to clock?" modal redesign

The manual-time correction modal (the one reached from the punch page's
"Forgot to clock?" / "Missing a punch?" links and from the corrections list's
"Register manual time" button) was rebuilt to a clearer, friendlier layout.
**Presentational + client-side only** — `manual-time-modal.{js,css}`, the two
callers, and i18n; the `POST /api/corrections` payload is byte-equivalent, so
**no backend, route, or storage change.**

**What changed.**

- **Segmented "What did you miss?" control.** The three "what was missed"
  options (Both / Clock-in / Clock-out) moved from a vertical stack of radio
  cards to a single horizontal **segmented control**, each segment a bold label
  over a one-line hint ("Whole shift" / "Forgot to start" / "Forgot to end").
  The radios are visually hidden (`.sr-only`) but stay in the DOM and focusable,
  so arrow-key group navigation and the single accessible name are preserved;
  the checked segment is filled via `:has(:checked)`.
- **Day + Start time + End time.** The two `datetime-local` inputs became a
  single **Day** date picker plus separate **Start time** / **End time** time
  pickers — fewer keystrokes and no fiddly combined widget. The submit handler
  recombines `day + time` into the same ISO `start` / `end` timestamps the API
  already expected (interpreted in the user's local timezone, then
  `toISOString()`), so the request body is unchanged.
- **Friendlier copy + footer.** The justification field is now labelled
  **"Why?"** with the hint "(optional but helps your manager decide)"; the
  submit button reads **"Send for approval"** with a leading checkmark; the
  actions sit on a footer bar with a full-bleed top divider. The punch-page
  entry titles the modal **"Forgot to clock?"** with the subtitle "Tell your
  manager what you actually worked. They'll review it." (a new per-open
  `titleKey`/`subtitleKey` option on `openManualTimeModal`); the corrections
  list keeps "Register manual time".
- **The accent follows the user's palette.** The active segment and the primary
  button use the `--honey` accent token, which the palette cascade redefines per
  theme — amber on Linen, **blue on Slate**, olive on Olive — so the modal
  matches whichever palette the user has chosen rather than a hardcoded colour.

**Implementation notes.**

- The checkmark is built with `createElementNS` (SVG, `stroke="currentColor"`,
  no inline `style` attribute) so it inherits the button text colour and stays
  within the `style-src 'self'` CSP that `test-security-headers.mjs` enforces.
- New i18n keys `correctionNew.day` / `.startTime` / `.endTime` /
  `.forgotTitle` / `.forgotSubtitle` (en-US + pt-PT); existing `kind*` /
  `justification*` / `submit` text reworded; the now-unused `startBoth` /
  `endBoth` / `startIn` / `endOut` keys were removed (both locales stay in
  parity — `test-i18n.mjs` green). `CACHE_VERSION` v76 → v77
  (`manual-time-modal.{js,css}` and the locale files are pre-cached). No new
  test suite — the form logic is exercised end-to-end by the existing
  `POST /api/corrections` route tests.

**Verification.** Verified live in a browser via the Playwright MCP on an
isolated throwaway instance (separate data dir `/tmp/pica-verify/data` + port
8123 — the real install was **not** touched). The modal renders to match the
target in the Linen palette (amber accent) and the Slate palette (blue accent,
`--honey` resolving to `#2563EB`); a real submit (Both, 09:00→17:00 on
2026-06-01) closed the modal with no error and created a `pending` correction
with `start 07:00Z` / `end 15:00Z` — i.e. the local→UTC day+time recombination
is correct. Touched unit suites green (`test-i18n`, `test-sw-precache`,
`test-security-headers`, `test-theme-tokens`).

**Honest Disclosures.**

- **Overnight windows are now implicit, not explicit.** A single Day can't
  directly express a shift that crosses midnight the way two `datetime-local`
  inputs could. For the "Both" kind, when the End time is at or before the Start
  time the handler assumes the shift crossed midnight and rolls the end onto the
  next day. That covers the common overnight case but is a heuristic: a genuine
  zero/negative-length entry can't be expressed, and a user who mistypes an end
  earlier than the start gets a next-day window rather than a validation error.
  ("Clock-in only" and "Clock-out only" have a single time, so they're
  unaffected.)
- **The corrections-list entry shares the new layout** but keeps its own
  "Register manual time" title/subtitle — only the punch-page entry reads
  "Forgot to clock?".
- **No automated DOM/E2E test** for the modal — covered by the live Playwright
  pass above; an in-repo browser suite waits for M16.
- **Two locales (en-US, pt-PT)**, not the broader set some strings imagine.

---

## [0.44.0] — 2026-06-01 — Full company name + collapsible sidebar

Two sidebar (app-shell) changes. Both are presentational — `topbar.js` /
`topbar.css` only, plus four i18n keys; **no backend, route, or data change.**

**What changed.**

- **The company name is now fully visible.** `.appshell__brand-name` used
  `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`, so a name
  longer than the ~150px brand column was truncated with an ellipsis (e.g.
  "Maria Augusta – Q…"). It now wraps onto as many lines as it needs
  (`overflow-wrap: anywhere` so an over-long single word still breaks); the
  flex item already had `min-width: 0`, so it shrinks to the column width and
  the whole name is always legible. `.appshell__brand-link` gained
  `flex-shrink: 0` so the logo mark keeps its size beside a multi-line name.
- **The sidebar is collapsible (desktop).** A new "Collapse sidebar" control
  sits at the bottom of the rail (below the user tile). Clicking it shrinks the
  232px sidebar to a **72px icon-only rail** — brand text, nav labels, the
  user-tile text, and the control's own label are hidden; the brand mark, nav
  icons, avatar, and a flipped chevron stay centred — and the content column
  reclaims the space. Clicking again expands it. The choice is **persisted in
  `localStorage` (`pica-sidebar-collapsed`)** and re-applied before the shell
  paints, so it holds across pages and reloads without a flash. The control's
  `aria-label`/`title` toggle between Collapse/Expand.

**Implementation notes.**

- The collapsed rules are scoped to `@media (min-width: 761px)` and the control
  is hidden at `≤760px`, so the mobile off-canvas drawer (which reuses
  `.appshell__sidebar` full-width) is untouched even when the flag is set.
- `.appshell__collapse` resets the global `<button>` chrome (honey fill, white
  text, centring, `margin-top`, 40px min-height) so it reads as a subtle nav
  row, not a call-to-action.
- The active-nav marker (`.appshell__nav-bar`, `left:-14px`) is hidden in the
  collapsed rail where it would clip against the narrow edge — the active
  link's background already marks it.
- New i18n keys `nav.collapse` / `nav.expand` (en-US + pt-PT).
  `CACHE_VERSION` v75 → v76 (`topbar.js`/`topbar.css`/locales are pre-cached).

**Verification.** Verified live in a browser via the Playwright MCP on an
isolated throwaway instance (separate data dir/port — the real install was not
touched): a 51-character company name wraps to four fully-legible lines; the
collapse toggle shrinks the rail to 72px and back; the state persists across a
navigation (`localStorage` "1", `aria-label` "Expand sidebar") and the expand
toggle restores it. Touched unit suites green (`test-sw-precache`,
`test-theme-bootstrap`, `test-security-headers`).

**Honest Disclosures.**

- **Collapse is desktop-only.** On mobile the sidebar remains the existing
  off-canvas drawer; the collapse control is hidden there by design.
- **No CSS transition on the width.** The rail snaps between 72px and 232px;
  animating a CSS-grid track width is unreliable, so it was left instant.
- **The persisted flag is per-browser, not per-user.** It lives in
  `localStorage`, so it does not follow the account to another device and is
  not a server-side preference.
- **No automated UI test.** The behaviour is verified live (Playwright MCP),
  not by an in-repo E2E suite — that arrives with M16.
- **Tooltips on the collapsed icons were not added.** In the icon-only rail the
  nav labels are hidden with no hover tooltip; the icons are the only affordance
  (the same icons already label the mobile bottom nav).

---

## [0.43.3] — 2026-06-01 — Live clock in the top-bar crumb

The content top-bar crumb used to read `Overview · <date>` (employer) or
`My day · <date>` (employee) — a static role label followed by today's date.
The home page (both roles) separately showed a live ticking clock in its hero
(`HH:MM:SS` beside a pulsing green dot). With the clock now in the top-bar — and
therefore visible on **every** authenticated page — the hero copy was redundant.

**What changed.**

- **Top-bar crumb** (`topbar.js` / `topbar.css`): the leading role label
  (`crumb.overview` / `crumb.myDay`) is replaced by a live `HH:MM:SS` clock with
  a pulsing sage dot, mirroring the home-hero clock it supersedes. The date
  stays: the crumb now reads `● 12:52:43 · Thu · 15 May 2026`. The clock ticks
  once a second via a `setInterval` that is intentionally never cleared — the
  shell lives for the whole page lifetime (same pattern as the old hero clock).
  `fmtClock()` is duplicated into `topbar.js` (local 24h, zero-padded) to match
  `index.js` byte-for-byte. The `@keyframes pulse` and dot styles were added to
  `topbar.css`, which loads on every authenticated page (`index.css` / `punch.css`
  each keep their own copy).
- **Home hero** (`index.js` / `index.css`): the `.emp-clock` pill (employer
  `eh-head`, employee `emp-greet`) and both per-page `setInterval` tick loops
  were removed, along with the `liveClock` element ref and the now-unused
  `fmtClock()` helper. The dead `.emp-clock` / `.emp-clock__dot` rules and the
  orphaned `@keyframes pulse` were pruned from `index.css`.
- **i18n**: the unused `crumb.overview` / `crumb.myDay` keys were removed from
  both locales (no other reference existed).

No backend change; no new endpoints, payloads, or permissions. `CACHE_VERSION`
v74 → v75 (`topbar.js`, `topbar.css`, `index.js`, `index.css`, and both locale
files are pre-cached). No new test suite — the existing suites
(`test-i18n`, `test-theme-bootstrap`, `test-sw-precache`, `test-security-headers`,
`test-frontend-imports`, `test-employee-home`) stay green (count stays 52).

**Honest Disclosures.**

- **Live in-browser pass pending.** Verified by unit suites and a JS syntax
  check only; the live install on :8080 needs an authenticated session to
  exercise the crumb, and a from-scratch smoke would require wiping
  `data/`/`config.json` (refused). Operator to confirm the ticking clock + dot
  in a browser (Linen-light and Slate-dark, both roles, desktop + mobile crumb).
- **Two `fmtClock()` copies.** `topbar.js` and `index.js` now each carry the
  helper. Pica's frontend can't share modules across absolute-path scripts
  without a build step, so the duplication is deliberate (and `index.js` still
  uses its copy for `fmtHM` siblings — kept local for consistency).
- **Uncleared interval, by design.** The crumb clock's `setInterval` is never
  cleared. The shell is mounted once per page load and never torn down, so there
  is no leak in practice; clearing it would need a teardown hook the shell
  doesn't have.
- **The pulse keyframes are now duplicated a third time** (`topbar.css` joins
  `index.css`/`punch.css`/`punches-today.css`). A shared animation in `app.css`
  would consolidate all four — deferred to avoid touching unrelated stylesheets
  in a point release.
- **Single clock format.** 24h `HH:MM:SS` regardless of locale (the home hero
  was the same); no 12h/AM-PM variant. The date beside it remains
  locale-formatted via `fmtDate`.

---

## [0.43.2] — 2026-06-01 — Avatars on notifications + leave pending lists

The notifications bell dropdown, the Leaves page **Pending approval** list, and
the Leave calendar **Pending requests** rail showed the requester's name as
plain text with no avatar — unlike the dashboard's "Waiting on you" card, which
renders a round, hue-tinted avatar (uploaded picture, or coloured initials).
This release brings those three surfaces in line with the dashboard.

**Backend.** `GET /api/leaves`, `GET /api/corrections`, and the single-record
reads now carry a `hasPicture` boolean per record (added to the `enrich()`
helper in both routes). It's a best-effort `employeesStore.hasPicture()` disk
stat per record — acceptable at the project's ≤ 50-employee scale and consistent
with the existing "decrypt every profile to render the list" posture. No new
endpoints; the picture itself is still streamed by the existing owner-or-employer
`GET /api/employees/:id/picture`.

**Frontend.**
- `topbar.js` notification rows gain an avatar (`notifAvatar`). The hue rides on
  a `data-hue` attribute and is applied via `el.style.setProperty` after
  `innerHTML` — an inline `style="--hue:…"` attribute would be blocked by the
  `style-src 'self'` CSP, which has no `'unsafe-inline'`.
- `leaves.js` pending/all-requests rows (the employer's `showName` rows) prepend
  a `.lv-row__av`. Employee history rows (no name shown) are unchanged.
- `leaves-calendar.js` pending-request rows prepend a `.cal-pend__av`.

**Picture takes priority; initials are strictly the fallback.** Every one of
these avatars renders the uploaded picture when the record's `hasPicture` is
true, and the hue-tinted initials only when it isn't. A picture that *fails to
load* (e.g. deleted between the list fetch and the image request) now degrades
to the tinted initials via an `img` `error` handler, rather than leaving a
broken-image box — so "no usable picture → initials" holds in every case.
(Operator note: the `hasPicture` field is new, so a running server must be
restarted to serve it; until then the frontend correctly falls back to
initials because the field is absent.)

**Uniform avatars across all pages.** The whole app now derives avatar colour
and initials identically, so a given person looks the same everywhere
(user-tile, notifications, team list, dashboard, leaves, calendar, employee
detail, profile editor):
- **Hue:** every copy uses the additive `(h + charCode)` algorithm. The top-bar
  `hueFor`, previously the lone outlier on `h*31`, was switched to additive to
  match `employees.js` / `employee.js` / `index.js` / `leaves.js` /
  `leaves-calendar.js` / `employee-profile.js`.
- **Hue seed:** the user-tile now seeds from the display name
  (`fullName || username`) instead of `user.id`, so *your* user-tile colour
  equals *your* colour in any row avatar. (All other avatars already seeded on
  the name.)
- **Initials:** the top-bar `initialsFor` now takes the first letter of the
  first two words (matching everywhere else) instead of first + last word — so
  e.g. "Carlos Alberto Martins" is **CA** everywhere, not **CM** on the
  user-tile and **CA** in lists.

The now-redundant `rowHue` helper added during the first cut of this release was
removed; notification rows call the unified `hueFor`.

CACHE_VERSION v73 → v74 (`topbar.js` / `topbar.css` are pre-cached shell assets).

**Honest Disclosures.**
- **Six duplicated helper copies, not one shared module.** The `hue` and
  `initials` functions are now byte-identical across the page scripts, but
  they're still *copies* — the project's per-page-script convention (and the
  inline-reimplementation pattern its Node tests rely on) was kept rather than
  introducing a shared `/avatar.js` module. Identical today; a comment on each
  `hueFor`/`hue` asks future editors to keep them in sync. Drift is possible if
  that's ignored.
- **Calendar day-popover + "Out today" badges unchanged.** The `.cal-pop__av`
  (day-detail popover) stays a square, neutral-background, initials-only badge
  by design — "uniform" here means the round hue avatars share one colour/
  initials scheme, not that every avatar-like element was redrawn round and
  tinted.
- **Per-record disk stat.** `hasPicture` is an `fs.existsSync` per leave /
  correction in the list responses. Fine at ≤ 50 employees; it would not be at
  thousands.
- **No avatars added to the calendar popover or "Out today" rails.** Scope was
  the three surfaces shown to need it. The day-popover (`.cal-pop__av`) and
  "Out today / tomorrow" rows still render their existing square, initials-only
  badges — untouched here.
- **Initials fallback unchanged in substance.** Where no picture exists, the
  avatar is still just coloured initials; this adds picture *support* to these
  rows, it does not change what a picture-less employee looks like beyond the
  new round, hue-tinted treatment.

---

## [0.43.1] — 2026-06-01 — Settings tabs left-alignment fix

CSS-only point fix. The Settings page sidebar tabs (Company, Organization,
Notifications, Backups, Security) were rendering with their icon+label content
horizontally staggered — each row sat at a different left offset depending on
its label length, so the icons did not form a clean vertical column.

**Cause.** The global `button` base rule in `app.css` sets
`justify-content: center`. `.set-tab` overrode `display: flex` and
`align-items: center` but never `justify-content`, so each tab inherited
`center` and centred its `[icon][label]` pair within the full-width button.
Because the labels differ in length, every row centred to a different x — the
visible cascade. The buttons themselves were correctly aligned (same x, same
width); only their inner content drifted.

**Fix.** Added `justify-content: flex-start;` to `.set-tab` in `settings.css`.
All five tabs now hang flush-left and share one icon column. Verified in the
live browser: every tab's icon now reports the same `getBoundingClientRect().x`.

`CACHE_VERSION` v72 → v73 (`settings.css` is a pre-cached SW asset).

**Honest Disclosures.** This is a one-line cosmetic CSS change; no markup,
JS, backend, or behaviour changed. No automated test guards tab content
alignment — the fix was verified visually and by reading computed
`justify-content`/bounding boxes in the running app, not by a new suite. The
mobile chip row (≤ 760px) was never affected and is untouched.

---

## [0.43.0] — 2026-06-01 — Profile redesign + soft-deactivate

Two things ship together: the employee **profile editor** is redesigned to a
wide, two-column card layout, and employee **off-boarding** becomes a reversible
**soft-deactivate** (with permanent delete gated behind it).

**Profile redesign (`/employees/:id/profile`).** The page widens from the 640px
form to a 1040px layout. The page title is the person's name with an
"Editing profile · {Role}" subtitle. Card headings became small uppercase
section labels ("IDENTITY", "ROLE AT {org}", "CONTACT", "INTERNAL NOTES");
fields are laid out in a responsive two-column grid (collapses to one column on
mobile). Inline helpers were added ("Used to sign in." under Username, age beside
the date of birth, "e.g. Baker, Counter, Owner." under Position). The footer is a
single action bar: **Deactivate account** (clay, left) · **Cancel** · **Save
profile** (honey). The sibling `/employees/new` create form adopts the same card
and grid vocabulary (keeping its role `<select>` — role IS settable at creation).

**Role is a read-only segmented control.** The Employee | Employer toggle shows
the current role (honey-filled) but is inert — Pica still has no role-change
endpoint. It is presentational only.

**Soft-deactivate (real backend).** A new `active` flag lives in
`data/users.json` (absence = active, so every existing record keeps working
untouched). `usersStore.setActive(id, active)` flips it and stamps/clears a
`deactivatedAt` timestamp. Enforcement is at the single auth choke point:
`authenticate()` in `src/auth/rbac.js` now returns null when `active === false`.
Because Pica's sessions are stateless signed cookies (no server-side session
store), this rejection revokes **all** of a deactivated user's sessions at once.
Login (`POST /api/login`) refuses a deactivated account with HTTP 403
`account_deactivated` rather than issuing a cookie. New employer-only endpoints
`POST /api/employees/:id/deactivate` and `POST /api/employees/:id/reactivate`
(audited `employee.deactivated` / `employee.reactivated`; cannot deactivate self).
`GET /api/employees` and `GET /api/employees/:id` now include `active`.

**Reactivation** happens from the **team list** (`/employees`): deactivated rows
render greyed with a "Deactivated" pill and an inline **Reactivate** button; they
sort last and don't inflate the working/break/leave chip counts.

**Permanent delete, gated.** `DELETE /api/employees/:id` is retained but now
refuses with `not_deactivated` unless the target is already deactivated — a
deliberate two-step off-boarding. On the profile page the permanent-delete
**Danger zone** appears only when viewing a deactivated account; for an active
account the footer shows Deactivate instead.

`CACHE_VERSION` v70 → v71 → **v72** (the v72 bump is a footer-button alignment
follow-up: the bare `<button>` Save/Deactivate inherit app.css's global
`button { margin-top: var(--gap-4) }`, which pushed them 16px below the Cancel
`<a>` in the flex action bar; `.prof-btn` / `.prof-btn-danger` now reset
`margin-top: 0`). ~17 new i18n keys per locale. Two new test suites
(`test-user-active`, `test-employee-deactivation`); total 50 → 52.

### Honest Disclosures (0.43.0)

- The Role control is a read-only segmented **look**. Pica still has no
  role-change endpoint; it displays the current role and cannot change it.
- Deactivation is enforced by rejecting in `authenticate()`. Sessions are
  stateless signed cookies, so this revokes all sessions on the **next**
  request — a request already mid-handler is not interrupted.
- Deactivated users still appear in reports/CSV exports and the team list
  (greyed) by design; their data is preserved, not hidden.
- Permanent Delete requires deactivation first (two-step). There is no
  one-click erase of an active employee, and no bulk deactivate.
- The only "last employer" guard is cannot-deactivate-self / cannot-delete-
  self; an employer could still deactivate another employer.
- Not verified in a live browser (operator chose tests-only); covered by
  `test-user-active`, `test-employee-deactivation`, and the existing suites.
- The "Role at {org}" label falls back to the generic "Role" when the org
  name isn't available to the page (e.g. an employee viewing their own
  profile, where `/api/settings/org` is employer-only and 403s).

---

## [0.42.6] — 2026-05-31 — Book-leave modal + Preferences palette alignment

Two presentational fixes, no behavior change.

**Start and End now sit on the same row in the book-leave modal.** On the
request-leave modal's "Full days" view, the **End** label and its date
picker were pushed slightly lower than **Start**, so the two columns no
longer lined up. Root cause: `.rlm-field + .rlm-field` adds a
`margin-top` so that vertically-stacked fields breathe — but the two date
columns live in a `.rlm-row` grid, where they are *also* adjacent
siblings, so the second column (End) inherited that top margin and dropped
below the first. Fix: a scoped `.rlm-row .rlm-field + .rlm-field
{ margin-top: 0 }` reset, so columns inside a row keep their grid-aligned
top edge while stacked fields elsewhere are unaffected. Same fix covers
the "Hours" view's From/To row, which uses the same `.rlm-row` markup.
(`public/request-leave-modal.css`.)

**Preferences palette swatches were invisible.** On `/preferences.html`
the three palette cards (Linen / Slate / Olive) rendered with blank,
zero-width colour bars and centred labels instead of the full-width
4-colour swatch + left-aligned text. Root cause: the cards are
`<button class="palette-card">` elements, and the global `button` rule in
`app.css` sets `align-items: center`. `.palette-card` is a flex column but
never re-declared `align-items`, so the button rule's `center` won — and
since the swatch bar's chips are `flex: 1` with no flex-basis (zero
intrinsic width), centring let the whole `.palette-swatches` container
shrink-wrap to 0 width. The chip background colours were set correctly the
whole time (confirmed via computed style); they were just painted into a
0 px-wide box. Fix: `.palette-card { align-items: stretch }`, so the swatch
bar fills the card and labels sit left. Verified live (isolated Playwright
instance, port 8099): swatch bar 266 px wide, four 66 px chips with the
expected hexes. (`public/preferences.css`.)

**Honest Disclosures.** Both fixes are CSS-only; no JS, markup, or backend
change. The leave-modal fix touches only two-column `.rlm-row` rows
(single-column stacked fields are unaffected) and was verified by reading
the cascade, not re-screenshotted. The palette fix was confirmed live.
`CACHE_VERSION` bumped v69→v70 once (both `request-leave-modal.css` and
`preferences.css` are pre-cached shell assets).

---

## [0.42.5] — 2026-05-31 — Leave-calendar rail alignment + grey toolbar band

Two presentational fixes, no behavior change.

**Right rail now starts level with the calendar toolbar/grid.** On
`/leaves-calendar.html` the right-hand rail (Pending requests / Out today
/ Out tomorrow) sat at the very top of the page, level with the "Leave
calendar" title — leaving the calendar grid starting well below it and the
two columns visibly misaligned. Root cause: the `<header class="cal-head">`
(title + subtitle) lived *inside* `.cal-main`, so the two-column
`.cal-page` grid put the title and the rail's first card on the same top
edge. Fix: the header is now a direct child of `.cal-page` spanning the
full width (`grid-column: 1 / -1`), so the title occupies its own row above
a clean two-column row — `[toolbar + grid]` on the left, rail on the right
— and the rail's top now lines up with the toolbar. Its `margin-bottom`
was zeroed since the grid's 20 px row-gap now handles the title→body
spacing. Confirmed live at 1280 px (Playwright MCP): rail top sits level
with the month-nav toolbar. (`public/leaves-calendar.html`,
`public/leaves-calendar.css`.)

**Toolbar is now a grey header band capping the calendar card.** The
month-nav + filter-chip toolbar previously floated on the page background
above the grid. It now reads as the top of the calendar: `.cal-toolbar`
gets `background: var(--bg-2)` (the same subtle grey as weekend columns),
a full `--line-soft` border with `border-radius` on the top corners only,
and `padding: 12px 14px` — its `margin-bottom` dropped to 0 so it butts
against the weekday header, whose top border + top corner-rounding were
removed (`.cal-weekhead`: `border-top: none; border-radius: 0`). The
toolbar's bottom border becomes the divider between the grey band and the
white weekday row. (`public/leaves-calendar.css`.)

CACHE_VERSION v68→v69 (`leaves-calendar.css` is pre-cached).

**Honest Disclosures.**
- Pure layout/CSS — no JS, no data, no API touched. The rail's content,
  the toolbar's controls, and the calendar's behavior are unchanged.
- The grey band uses `--bg-2`, so it tracks the active palette/theme
  (linen/slate/olive, light/dark) automatically — no hard-coded colour.
- The single-column mobile layout (≤ 980 px) is unaffected: the header
  spanning `1 / -1` collapses to full width in a one-column grid, so the
  stacking order (header → calendar → rail cards) is identical to before.
- Only the leaves calendar was touched. No audit of other pages for the
  same header-inside-column pattern was done in this release.

---

## [0.42.4] — 2026-05-31 — Employee-detail hero button alignment + app.css linter cleanups + reset-modal spacing

Three small presentational/tooling fixes, no behavior change.

**1. Employee-detail hero: Reset-password / Go-to-profile buttons aligned.**
On `/employees/:id` the two hero actions sat 16 px out of vertical
alignment (and 2 px apart in height). Root cause: "Reset password" is a
`<button class="ed-btn">` and "Go to profile" is an `<a class="ed-btn
ed-btn--primary">`. The bare `<button>` inherits app.css's global button
rule (`margin-top: 16px; min-height: 40px`); the `<a>` does not, so it sat
flush at 38 px while the button was pushed down and rendered 40 px tall.
Fix: `.ed-btn` now explicitly resets `margin-top: 0` and pins
`min-height: 38px` (matching its `height: 38px`), so both elements render
identically regardless of tag. Confirmed live (Playwright MCP): both
actions now share `top` and `height`. (`public/employee.css`.)

**2. app.css: cleared the editor (Microsoft Edge Tools) CSS lint findings.**
The operator's editor flagged three real items in `app.css`:
- `user-select: none` on `.checkbox`/`.radio` without the `-webkit-`
  prefix (an **error** — unsupported on Safari/iOS). Added
  `-webkit-user-select: none;` ahead of it.
- `appearance: none` listed **before** `-webkit-appearance: none` in two
  rules (the form-control reset and the checkbox/radio reset) — a warning
  about prefix ordering. Reordered so the prefixed property comes first.

Deliberately **not** changed: the `-webkit-text-size-adjust` line (adding
the standard `text-size-adjust` makes Edge Tools flag *that* as
unsupported in Firefox/Safari — net worse, so left prefixed-only); the
`★` "transform/opacity in @keyframes triggers Composite/Paint" perf hints
(animating transform/opacity is the GPU-friendly approach — not a defect);
and cSpell "unknown word" notices (`topbar`, `textareas`, `nums`, … are
legitimate identifiers, not CSS issues).

**3. Reset-password modal: space the action row off the confirm field.**
In the employer's "Reset employee password" modal (`employee.js`
`openResetModal`) the Cancel / Reset-password `.btn-row` sat flush against
the "Confirm new password" input (0 px gap — `.btn-row > *` zeroes the
buttons' `margin-top` and `.btn-row` itself has none). Added the existing
`mt-5` utility to that row (`margin-top: var(--gap-5)` = 24 px) so the
actions are clearly separated from the field above. Scoped to this one row
(not the global `.btn-row`). Confirmed live: 0 px → 24 px.

`CACHE_VERSION` v67 → v68 (`app.css` + `employee.css` are pre-cached; the
`employee.js` edit is also served cache-first keyed by this version). No
backend, no i18n, no new test suite (count stays 50).

**Honest Disclosures.** Presentational/tooling only. The global bare-
`button` rule that leaks `margin-top`/`min-height` onto component buttons
is left as-is (other component button classes that set their own geometry
should likewise reset these two; this fix only touches `.ed-btn`). The
lint cleanups silence findings from one editor (Edge Tools) — a different
linter may surface a different set. Verified at one viewport in
Linen-light only; no automated UI test (that's M16).

---

## [0.42.3] — 2026-05-30 — Employer home: fix "Hours this week" delta font

A one-widget presentational fix. The employer-home "Hours this week"
card renders a big serif number, a small `h` unit, and a `+Xh vs last
week` delta. `.eh-hours__big` sets `font-family: var(--font-serif)`
(Instrument Serif), and both the unit and the delta inherited it.
Instrument Serif ships **only a 400 weight** — no bold — so the delta's
`font-weight: 600` triggered the browser's faux-bold synthesis on a
serif face, producing the heavy, ungainly bold-serif `+7.3h vs last
week` text instead of the intended clean sans-serif.

Changes (`public/index.css`, `public/index.js`):

- `.eh-delta` now sets `font-family: var(--font-sans)` (DM Sans), so the
  delta renders as crisp sans-serif bold in sage/clay — matching the
  rest of the app's metadata text and the intended design.
- The `h` unit kept its leading space (`' h'`) where every other
  `<small>h</small>` unit in the file (`.emp-stat__val`,
  `.emp-hero__big`) sits flush against the number. Removed the space so
  the employer-home unit reads `15.3h`, consistent with those widgets.

The unit `h` itself stays serif on purpose — that is the house style
for value+unit pairs across the home/stat cards, and it matches the
serif number it annotates.

CACHE_VERSION v66→v67 (`index.css` is a pre-cached shell asset).

### Honest Disclosures

- Purely cosmetic. No behavior, data, or API change. The computed
  numbers are identical; only typography moved.
- Scope is deliberately the employer-home `.eh-hours` widget only. The
  employee-home `.emp-stat__val` / `.emp-hero__big` units were already
  serif-by-design and are untouched.
- Not verified in a running browser this session — the live instance on
  :8080 required a login I did not have. The fix is grounded in the CSS
  inheritance chain (serif inherited by `.eh-delta`) and the known
  absence of a bold weight in Instrument Serif, not in a live capture.
  Worth an eyeball on next employer-home load.
- No new i18n keys, no locale changes, no test added — there is no
  headless way to assert a rendered font face without the M16 Playwright
  harness (not yet landed).

---

## [0.42.2] — 2026-05-30 — Team page: search/filter toolbar + column alignment

A presentational pass on the Team list toolbar and table
(`employees.css`, `employees.html`, `employees.js`, both locales).

**Changes.**
- **Search bar no longer stretches.** `.tm-search` was `flex: 1`, so it
  grew to fill the toolbar row and pushed the filter chips to the far
  right, leaving a wide dead gap. The search is now `flex: 0 1 340px`
  (wrapped in a `.tm-search-wrap`), so the input and the chip group sit
  together, left-aligned.
- **Search box restyled with an icon and the right surface.** A
  magnifying-glass icon now sits at the left of the input, drawn as a
  CSS `mask` filled with `var(--muted)` so it tracks every theme/palette
  (no hard-coded colour). The input padding-left makes room for it.
  Crucially, `app.css`'s `input[type="search"]` rule (specificity
  `(0,1,1)`) was silently overriding the single-class `.tm-search`
  `(0,1,0)` — forcing the grey `--bg` background and the default
  padding (which made the icon overlap the placeholder). The rules are
  now scoped as `.tm-search-wrap .tm-search` `(0,2,0)` so they win:
  surface is `var(--paper)`, padding leaves room for the icon.
- **Search box and chips share one height and shape.** Both are now
  `44px` tall with a `12px` radius (chips were full `999px` pills at
  ~33px). With the toolbar centring them, their edges line up — fixes
  the vertical-offset look.
- **Filter chips show `Label · N`.** The count span now renders
  `· {n}` (e.g. `All · 6`) with a muted separator, instead of a faded
  bare number. Active chip keeps the dark fill / light count.
- **Placeholder copy.** `team.searchPlaceholder` changed from
  "Search people…" to "Search by name or position…" (and the pt-PT
  equivalent) — it already searches name, username, and position.
- **Table columns align row-to-row.** `.tm-thead` and each `.tm-row`
  are *independent* CSS grids, and the last column was sized `auto`.
  Rows carrying a pending badge got a wider last column, which stole
  width from the `fr` columns and shifted *every* cell in that row — so
  Status now / This week / Today drifted between rows with and without
  a badge. The last column is now a fixed `64px`, so the `fr` tracks
  are identical across the header and all rows.

CACHE_VERSION v65→v66 (`employees.css`, the two `locales/*.js`, and the
runtime-cached `employees.js` are all served cache-first).

**Honest Disclosures.**
- Presentational only — no route, storage, or status-logic changes; no
  new tests (nothing testable changed). `employees.js` changed only in
  how the chip count string is built.
- "White" search background = `var(--paper)`, the app's surface token
  (warm cream in the *linen* default palette, near-white in *slate*).
  It is deliberately not a hard-coded `#fff`, to stay theme-correct;
  the contrast against `--bg` is subtle in the linen palette.
- The `64px` last table column fits the pending badge + chevron with
  margin; an extreme zoom or a future multi-icon end cell could crowd
  it. Fine for the current single badge + chevron.
- Verified by rendering the toolbar in isolation against the real
  stylesheets at desktop width (screenshot), not in the full
  authenticated page (no live-install credentials this session). The
  table-column fix was reviewed in code, not re-screenshotted.

---

## [0.42.1] — 2026-05-30 — Employer home: time-of-day greeting + live clock

A small consistency pass on the employer home page (`index.js`,
`renderEmployerHome`). The employee home already opened with a
time-of-day greeting ("Good evening, *Pedro*") and a live, ticking
clock pill; the employer home did not — it showed the **company name**
as its title and had no clock. The two role homes now match.

**Changes.**
- The employer home title is now `greetingKeyFor(new Date())` + the
  signed-in user's first name (`<em>`-italicised, same markup as the
  employee home), reusing the existing `home.greet.{morning,afternoon,
  evening,late}` locale keys. The company name is no longer the title
  (it still appears in the sidebar brand and, where present, the
  legacy `#welcome` heading).
- A live clock pill (`.emp-clock` + `.emp-clock__dot`, the same class
  the employee home uses) sits at the top-right of the header. The
  boot code starts a 1 s `setInterval` that rewrites the
  `[data-live-clock]` span via `fmtClock()`, mirroring the employee
  home tick.
- `.eh-head` becomes a flex row (`justify-content: space-between`,
  `align-items: flex-end`, `flex-wrap`) so the title/subtitle sit left
  and the clock sits right; it wraps on narrow widths.

CACHE_VERSION v64→v65 (`index.js` and `index.css` are both pre-cached).
No new locale keys (the greeting + clock primitives already existed for
the employee home). No backend, route, or storage changes. No new tests
(pure presentational reuse of existing, tested primitives).

**Honest Disclosures.**
- The greeting time-of-day boundaries are the employee home's
  (`<5` late, `<12` morning, `<18` afternoon, else evening) and use the
  **browser's** local clock, not the server's — a client with a skewed
  clock sees a skewed greeting and clock. This already applied to the
  employee home; the employer home now inherits it.
- The clock is wall-clock display only; it has no bearing on punch
  timestamps (those are server-stamped).
- The subtitle ("Here's how your team is doing today.", `home.empSub`)
  is unchanged — only the title and the clock were touched. The
  reference mock's summary subtitle ("N working now · …") was **not**
  adopted; that data already lives in the stat cards below.
- Not visually verified in a browser this session: the live install on
  `:8080` owns the only `config.json`/`data/`, so an isolated smoke
  would have required clobbering real state. The change is a faithful
  reuse of the already-shipped employee-home clock/greeting and was
  syntax-checked (`node --check`); confirm with a refresh on `:8080`.

---

## [0.42.0] — 2026-05-30 — UI polish: page centering + notification bell icon + punch hero layout + uniform page titles

A post-M15 polish pass. First fix: the **home page content was pinned
flush-left** inside the app-shell content column, leaving an empty gap on
the right (most visible on wide screens). Every other page was centered;
only the home looked off.

**Root cause.** Inside the app shell, `<main>` is simultaneously
`.appshell__content > main` (caps width at `1320px`, `width:100%`) and
`.container container--wide`. The horizontal centering came **only** from
`.container`'s `margin: 0 auto` — `topbar.css` explicitly delegated
centering to the per-page container class. The JS-rendered home
(`index.js`) clears `main.className` for both the employer and employee
views (it builds its own `.eh-home` / `.emp-home` body), which stripped
`.container` and therefore the centering. The content kept its `1320px`
cap but lost `margin:auto`, so it sat flush-left in the wider `1fr`
content track. The "shell owns width" comment was mistaken: the shell rule
caps width at `1320px` regardless (higher specificity than `--wide`'s
`1600px`), so stripping the class only ever removed the centering.

**Fix (one line).** Centering now lives on the shell rule itself —
`.appshell__content > main` gains `margin-inline: auto`. Every page body is
centered in the content track whether or not it carries a `.container`
class, so a page that builds its own body and drops the class still
centers instead of pinning left. No width changed; pages already centered
via `.container` are unaffected (the auto margins agree). The explanatory
comment in `topbar.css` was rewritten to document the new contract.

**Second fix: the notification bell rendered as an empty box.** The
top-bar bell (and its mobile twin) showed its red pending-dot but **no
bell glyph** since it shipped in 0.41.0 — just a blank rounded square.

**Root cause.** `.appshell__iconbtn` is `display: inline-flex;
justify-content: center` and the bell's `<svg>` sits **directly** inside
it as the single flex child. The SVG carries its size only as `width`/
`height` HTML attributes (no CSS width — CSP forbids inline `style`), and
a bare SVG flex child with default `flex-shrink: 1` collapses to **0 on
the main axis** in Blink/WebKit (the cross axis kept its `17px`, so the
glyph was zero-width but full-height — invisible). The sidebar nav icons
never hit this because they are wrapped in `.appshell__nav-icon`, which
already carries `flex-shrink: 0`; the unwrapped icon-button was the gap.

**Fix (one line).** `.appshell__svg` (the shared inline-icon class) gains
`flex-shrink: 0`, so any icon that is a direct flex child keeps its
intrinsic width instead of collapsing. Confirmed in-browser: the bell SVG
goes from a measured `0×17` to `17×17`. Icons never want to shrink, so the
rule is global and also covers the mobile bell and any future icon button.
An explicit CSS `width` alone does **not** fix it (flex still shrinks past
it); `flex-shrink: 0` / `flex: none` is the property that holds.

**Third fix: the punch (clock) page hero was visually scrambled.** The
`.clock-hero` is a `1fr auto` grid (status body | action buttons), but the
comment field, OSM map preview, and feedback elements were **direct grid
children** with no placement rules — so the browser auto-flowed them into
stray cells. The result: the comment textarea landed *beside* the buttons
(detached from its own "Comment (optional)" label), and the map sprawled
**full-bleed** across the bottom of the card.

**Fix.** `.clock-hero` is now a flex **column** of two explicit rows
instead of an auto-placing grid. The top row (`.clock-hero__top`, a flex
row) holds **time block · map preview · action button**, left to right —
the map sits to the right of the time with its address in
`.map-card__meta` directly below the tile, and the button is pushed to the
far right (`.punch-actions { margin-left: auto }`). The bottom row
(`.clock-hero__extra`) stacks the comment label + textarea + feedback
full-width under everything, capped at `600px`. Side-by-side (rather than
the stacked map) roughly **halves the hero height** — measured `659px` →
`~340px` at desktop width; the map shrank to `280px`/`120px`-frame and the
big readout from `88px` to `68px`. No JS drove the old scatter — it was
pure grid auto-placement — so the markup + CSS restructure carries the
whole fix.

**Fourth fix (same page): only one action button shows at a time.** The
hero previously rendered **both** Clock in and Clock out, greying out the
inapplicable one via `disabled`. Two large buttons (one dimmed) read as
ambiguous. `paintStatus()` now toggles the `hidden` attribute so exactly
one button is present: **Clock in** when off the clock, **Clock out** when
working. The out-button ships `hidden` in the markup so the first paint
(before `/api/punches/status` resolves) shows only Clock in; `paintStatus`
then corrects it. The `disabled` flags are kept as belt-and-suspenders
alongside the existing `if (btn.disabled) return;` click guards.

**Fifth fix (same page): the time, comment, and button now share one
centered axis.** The earlier top-row layout pushed the action button to the
**far right** of the hero (`.punch-actions { margin-left: auto }`), detached
from the comment that sat in a separate full-width row below. The hero is
still a flex column with the map on the right, but the left side is now a
single **centered control column** (`.clock-hero__main`): the status pill,
big readout, and sub line (`.clock-hero__lead`) center as a group directly
over a capped (`600px`) `.clock-hero__form` that stacks **comment label →
textarea → full-width button → feedback**. The button moved out of the top
row and under the comment, full-width (`width: 100%`, no more `min-width:
180px` / `margin-left: auto`), so the time reads as the heading of the same
stacked control the operator acts on. The map preview stays to the right,
vertically centered against the taller control column
(`.clock-hero__top { align-items: center }`). Pure markup + CSS — `punch.js` is
untouched (it addresses every element by `id`, so moving nodes in the DOM
changes nothing). Mobile is unchanged in spirit: the column already stacked
above the map; the form's `600px` cap simply relaxes to full width.

`CACHE_VERSION` v59 → v60 → v61 → v62 → v63 → **v64**. The centering + bell fixes
touched `topbar.css` (v60); the punch hero/button fixes touched `punch.css`
+ `punch.js` (v61); the hero **layout** refinement (map beside the time,
shorter card) touched `punch.css` + `punch.html` again (v62); the uniform
page-title token touched `app.css` plus ten per-page stylesheets (v63); the
centered-control-column refinement touched `punch.css` + `punch.html` once
more (v64). Each bump
matters because the SW serves pre-cached `.js`/`.css` **cache-first**: a
browser holding an older cache would run stale assets against newer markup.
That is not hypothetical here — it bit us mid-development: after the v61 JS
edit a browser still on the v60 cache ran the old `punch.js` (which only
toggled `disabled`) against the new HTML (out-button shipped `hidden`), so a
clocked-in user saw the disabled Clock-in button and no Clock-out until the
bump invalidated the cache. No i18n, no backend, no new test suite (the
existing shell/precache guards stay green; the punch suite covers pure
week-grouping helpers, untouched here).
**Verified live via the Playwright MCP**: the centering before/after on the
same employer home at 1920px, the bell rendering the empty box "before" →
the proper glyph "after", and the punch hero measured in both clock states —
map below the address, textarea below its label, and exactly one button
visible per state.

**Fifth fix: page titles were every size but uniform.** Each page's
primary serif heading had drifted to its own hardcoded `font-size` — the
Leave calendar at `28px` (`1.75rem`), Leaves the same, Reports inheriting
the generic `32px` h1, the employer home `40px`, Security `42px`,
Preferences `44px`, Settings `48px`, the employee home `52px`. Side by
side the pages looked like they belonged to different apps; the calendar's
`28px` was the most obviously undersized.

**Root cause.** There was no shared heading size. Every page defined its
own `*-head__title` (or `*-head h1`) class with a literal `px`/`rem`
value, plus its own mobile override at a mix of `600px`/`760px`
breakpoints. Nothing kept them in sync, so each rebuild nudged a different
number.

**Fix.** A single source of truth: a `--page-title: 60px` token in
`app.css`'s `:root`, redefined to `34px` inside one
`@media (max-width: 760px)` block. Every primary heading now reads
`font-size: var(--page-title)` — the bespoke title classes (home ×2,
Team, Leaves, Calendar, Profile/New, Preferences, Security, Settings,
Clock) plus a new shared `.page-header h1` rule that covers the pages
whose title lives in a semantic `.page-header` (Corrections, Today,
New employee, Reports). The per-page mobile font-size overrides were
deleted so the token alone drives responsiveness; `reports.css`'s
now-redundant `.page-header h1` font-family rule was removed too. Result:
one number changes all eleven headings, and the `760px` breakpoint shrinks
them together.

**Honest Disclosures.**
- **Scope is centering only.** This release does not touch the home's
  internal grid, the `1320px` content cap, or the (now effectively
  inert inside the shell) `640px` width on `.container` narrow forms —
  inside the app shell every body is capped at `1320px` regardless of
  container variant, and that pre-existing behavior is unchanged.
- **`index.js` still clears `main.className`.** Those lines are now
  harmless (the shell centers either way) and were left untouched to keep
  the change surgical; the misleading "shell owns width" comment in
  `index.js` was not rewritten.
- **No automated UI/DOM test.** Both fixes are CSS-layout properties;
  they are covered by live verification, not an in-repo suite (DOM/E2E
  remain M16). The bell collapse is a rendered-geometry bug a static
  CSS/markup test would not have caught.
- Verified on Linen-light only at one viewport; both rules are
  palette/theme-independent so other combos are expected to match.
- **Bell glyph absence dated to 0.41.0**, the release that wired the bell
  up — it was empty-box from the moment it shipped, not a later
  regression. The dot-positioning and panel behavior were always correct;
  only the icon was invisible.
- **Punch hero scatter dated to 0.30.0**, the M15 clock-page rebuild — the
  trailing elements were direct grid children from the start. It only
  *looked* fine when the comment/map were empty/hidden; with a live map and
  a focused comment the auto-placement was always going to scatter.
- **Map is a fixed `280px`/`120px`-frame, not responsive to the fix's
  accuracy or zoom.** It stays a single static OSM tile (no pan/zoom, no
  API key); the smaller frame just crops a touch more. Below `760px` the
  top row stacks (time → map → button) and the map goes full-width.
- **The geocoded address renders twice** — once in the chip under the
  time (`.clock-loc`) and once under the map tile (`.map-card__meta`). This
  duplication is deliberate (it matches the requested layout) and both are
  fed by the same reverse-geocode; it is not two lookups.
- **One-button-at-a-time is presentational only.** The backend already
  rejects a clock-in while open (and vice-versa); hiding the wrong button
  removes the dead control but is not the enforcement boundary. If
  `paintStatus` never runs (status fetch hangs), the markup default leaves
  **only Clock in** showing — a deliberate fail-safe, though it could be the
  wrong button for an already-working user until the fetch resolves.
- **No automated DOM test for the hero.** Same as the other two fixes:
  verified by live geometry measurement, not an in-repo suite (E2E is M16).
- **The stale-cache button bug shipped briefly during development.** The
  punch JS/HTML were edited without bumping `CACHE_VERSION` past v60, so a
  browser that had already cached v60 ran the old `punch.js` against the new
  markup — a clocked-in user saw the disabled Clock-in button and no
  Clock-out. Caught on the live install and fixed by the v61 bump. The
  standalone preview used for geometry verification bypassed the service
  worker, so it could not have surfaced this — the SW cache-first path is
  exactly the gap an in-repo test does not cover (M16).

---

## [0.41.0] — 2026-05-29 — M15 alias-bridge removal + JS dedup + bell — closes M15

The second half of M15 Plan 9, and the **release that closes M15**: the
transitional design-token alias bridge is removed, the divergent front-end
helpers are consolidated, and the notification bell is finally wired.

**Alias-bridge removal (no visual change).** The pre-M15 alias tokens
(`--accent`, `--surface`, `--text`, `--border`, `--success`/`--warning`/
`--danger`/`--info` and their `-soft` variants) are gone. Every usage across the
9 remaining stylesheets (~195 references; `reports.css` was already done in
0.40.0) was rewritten to the canonical token the bridge resolved it to
(`--accent`→`--honey`, `--surface`→`--paper`, `--text`→`--ink`,
`--text-muted`→`--ink-2`, `--success`→`--sage`, …), then the bridge block was
deleted from `app.css`. Because each replacement is the literal current value,
computed styles are identical across all six theme×palette combos — verified
live (token resolution + zero console errors in Linen-light and Slate-dark).

- **`--accent-ring` survives as a canonical token** — it is defined per theme
  (rgba focus-ring values) with no flat-token equivalent, so it was promoted out
  of the bridge block rather than removed. It is the one alias-looking name that
  remains, by design.
- **`--border-strong` collapsed to `--line`** (its current bridge target).
- New durable guard: **`tests/test-no-alias-tokens.mjs`** scans `public/*.css`,
  fails if any removed alias reappears, and asserts the bridge block is gone.
  The obsolete "alias bridge" assertions in `test-theme-tokens.mjs` were dropped.
  Test count **49 → 50**.

**JS consolidation.** Two of the three planned dedups landed; the third was
deferred (see below). The "duplicates" turned out to be *divergent*
implementations, so each became a deliberate refactor rather than a copy delete:
- **`flashSaved` → shared in `/app.js`.** The three former copies
  (Preferences / Profile / Settings) had different signatures, CSS classes, and
  content (word vs icon-html). Replaced with one parameterized helper
  (`flashClass` / `word`|`html` / `startDisabled` / `restore` / `onComplete` /
  `beforeFlash`); each page keeps its own flash CSS class, so the visual is
  unchanged. Settings keeps a thin wrapper supplying its icon content.
- **`pairSessions` → reused from `/team-status.js`.** `punches-today.js` had its
  own copy returning a different shape (`{inTs,outTs,inGeo,…}` vs `{in,out}`); it
  now adapts the shared (test-covered) pairing algorithm to its render shape.
  Equivalence verified across normal / open / two-session / back-to-back-in /
  empty cases.

**Notification bell.** The previously-static bell now opens a **notifications
panel** (reusing the user-menu popover machinery, refactored into a shared
`positionPopover`) listing the viewer's pending items — employer: leaves +
corrections awaiting their decision; employee: their own pending requests — each
linking to its detail page. A **red dot** (CSS class, not an inline style)
appears when the count > 0; the panel refreshes on mount and tab focus. No new
backend — it aggregates the existing `/api/leaves` and
`/api/corrections?status=pending`. New `notifications.*` i18n keys in both
locales. Verified live (employer: red dot + both item types + links + outside-
click/Esc close; zero console errors).

`CACHE_VERSION` v58 → v59 (app.css, the 4 migrated page stylesheets, app.js,
topbar.js, topbar.css, locales).

**Honest Disclosures:**
- **Geo unification was deferred.** The plan intended to fold `punch.js`'s fast
  geolocation onto `/geo.js`, but the two had diverged by design — `punch.js`
  uses `sessionStorage` + a "failed this session" sentinel (so the bootstrap
  doesn't re-prompt a denied location every page load) and a module-level skip
  reason, while `geo.js` uses `localStorage` + ts-freshness and a return value.
  Merging them safely needs its own focused change with live clock-in/out
  testing; forcing it into this cleanup release risked the punch page's geo UX,
  so it stays as two implementations for now.
- **`--accent-soft` / `--warning-soft` / `--info-soft` collapse to the neutral
  `--paper-2`** — faithful to what the bridge already rendered. Giving them true
  tinted "soft" backgrounds would be a visual change for a separate release.
- **The bell is a focus-refreshed aggregator, not real-time/push.** New items
  appear on the next focus or navigation. There is no "mark as read" and no
  history — it mirrors current pending state only. Counts come from fanning out
  the same endpoints the home widget uses (fine at the ≤50-employee target).
- **No automated UI/E2E tests** for the restyle or bell — verified live via the
  Playwright MCP against a throwaway instance. The in-repo browser suite is M16.

With this release **M15 (Full UI revamp) is complete**: every screen body is
restyled, the token vocabulary is canonical end-to-end, and the alias bridge is
gone. Next is M16 (Playwright E2E — the project's first npm dependency), then
M17 (deployment guide), which ships last.

---

## [0.40.0] — 2026-05-29 — M15 Reports re-skin (Plan 9, part 1)

The Reports page is restyled to the M15 design. **Every M13 behavior is
byte-equivalent** — no endpoint, payload, query, or report-logic change. This is
the first of the two releases that make up M15 Plan 9; the second (0.41.0)
removes the token alias bridge and closes M15.

The design handoff never drew a Reports screen (the prototype stubbed it; Pica
already shipped the real Reports page in the M13 revamp at 0.24.0), so this
applies the now-established M15 vocabulary rather than inventing the prototype's
missing one.

**What changed (visual only):**
- **`reports.css` rewritten** against the canonical token vocabulary — serif page
  title, the chip/toolbar idiom shared with the calendar and leaves pages, the
  shared `.data-table` look for the matrix and single-person tables (sticky
  first column kept for the horizontally-scrolling matrix), **serif grand
  totals**, and a new `.rpt-status--{approved,pending,rejected,cancelled}` pill
  for the leaves single-view status column. The print stylesheet (landscape,
  `printable-title`) is preserved.
- **`reports.js`** emits the new classes (`data-table` on every table; the leaves
  status cell wraps its text in a `.rpt-status` pill). Four class-string lines
  changed; nothing else.

**Preserved exactly:** Timesheets / Leaves report types; scope Everyone /
One-person (employer picker; employees pinned to self server- and client-side);
Day / Week / Month / Year presets with ◀/▶ nav (the local-component anchor math
that avoids the UTC-midnight off-by-one); the matrix and both single-person
shapes; CSV download; Print → Save-as-PDF; server-enforced employee isolation.

**SW:** `CACHE_VERSION` v57 → v58 (`reports.css` is pre-cached; the SW serves all
CSS cache-first keyed by the version, so the bump — not pre-cache membership — is
what delivers the new CSS to returning clients). No new i18n keys (the restyle
reuses existing `reports.*` / `status.*` / `leaves.type.*` keys). No new test
suite — report logic is unchanged and covered by `test-reports` /
`test-reports-team`. As a side effect, `reports.css` is now fully tokenized
(alias-free), retiring its 12 alias usages ahead of the 0.41.0 bridge removal.

**Honest Disclosures:**
- **`reports.js` keeps its escaped-`innerHTML` rendering** — it was already
  XSS-safe (every interpolated value goes through `esc()`), so this restyle did
  not rewrite it to the `createElement`/`textContent` DOM API the way the 0.33.0
  punches-today rebuild did. Lower-risk for a pure restyle; the status enum is
  additionally `esc()`-wrapped inside the new pill class.
- **No automated UI test.** Verified live via the Playwright MCP (both roles, both
  report types, all four periods, matrix + single views, CSV link target, print
  preview). The in-repo browser-test suite is still M16.
- **No backend change** of any kind — this is purely a CSS/markup restyle.

---

## [0.39.0] — 2026-05-29 — M15 Preferences + Profile edit restyle

### What changed

**M15 Plan 8** re-skins the per-user **`/preferences`** page (§12), the
**`/employees/:id/profile`** profile editor (§5), and the sibling
**`/employees/new`** create-employee form to the design. **Zero backend
changes** — every endpoint, payload, validation, and permission is
byte-equivalent. Only markup, CSS, and two additive client-side behaviours
changed.

- **`/preferences` is now two cards.** A serif header over a **General
  preferences** card (Language select — the two shipped locales; **Color mode**
  as three radio-cards Light / Dark / Match system; the 0.29.0 **Palette** swatch
  cards; the **Email** notification + reminder checkboxes) and a **Password**
  card. One "Save preferences" button still PUTs `{locale, colorMode, palette,
  email:{notifications,reminders}}` to `/api/settings/me`; locale change still
  reloads. New: a per-card **"✓ Saved" flash** (sage) on the save buttons
  replacing the success toast, and a **live password-match gate** — the Change
  Password button is disabled until current is non-empty, new is ≥ 8, and confirm
  matches, with an inline "Passwords don't match" hint. The must-change-password
  banner is preserved.
- **`/employees/:id/profile` is now four cards** — Identity (88px avatar with a
  deterministic per-user hue, Upload/Remove picture, full name, username
  read-only, DOB with live "X years old", address), Role (role rendered
  **read-only as a badge** + position with the employer-set permission preserved),
  Contact (email, phone), and Internal notes (comments, employer-editable). Save
  gets the "✓ Saved" flash. The **danger zone keeps the existing hard Delete**
  (employer-on-others only, confirm). All machinery — picture resize/upload/remove,
  the `PUT /api/employees/:id` save, delete, `applyPermissions`, age display,
  back-link context, 401/403/404 handling — is byte-identical.
- **`/employees/new` shares `employee-profile.css`** and is restructured into the
  same card vocabulary (Account card with username + initial password + role
  select — role is legitimately set once at creation; Identity / Contact /
  Internal-notes cards). Its `employee-new.js` logic is unchanged (all element
  ids preserved); the stale "(M11)" hint copy was refreshed.

~10 new `prefs.*` / `employee.*` / `employeeNew.*` i18n keys per locale (plus
the reworded create-form password hint).
`CACHE_VERSION` v56 → v57. No new test suite (count stays **49**, matching
Plan 7). Verified live via the Playwright MCP (both roles).

### Why the CACHE_VERSION bump (corrected rationale)

The service worker serves **all** `.css`/`.js` **cache-first**, keyed by
`CACHE_VERSION` — not only the curated `PRECACHE_URLS` subset. `preferences.css`
and `employee-profile.css` are *not* in the precache list, but a returning client
would still be served its stale cache-first copy until the cache key changes.
Bumping `CACHE_VERSION` is therefore what actually delivers the new CSS to
returning users; it is required whenever any CSS/JS changes, regardless of
precache membership.

### Honest Disclosures

- **The prototype's role-switch control is not built.** Pica has no role-change
  endpoint, so role is rendered read-only. Changing a user's role after creation
  is not possible from the UI (a future plan could add the endpoint + RBAC).
- **No soft-deactivate.** The prototype's "Deactivate account" is the existing
  **irreversible hard Delete**, restyled. There is no disable-login-keep-data
  state.
- **The Role card is titled generically "Role"**, not "Role at {org}" — this
  avoids an extra org-name fetch on the profile page.
- **Two locales, not six.** The Language select offers only the shipped en-US /
  pt-PT, not the prototype's fictional six.
- **The password-match gate is client-side UX only.** The server remains the
  authority; the disabled-until-valid button is a convenience, not a security
  control.
- **The colour-mode radio-cards rely on CSS `:has()`** for the checked-state
  styling. Supported in all current evergreen browsers; the existing `change`
  listener (which re-tints the palette chips) would be the fallback if an older
  target ever mattered.
- **`flashSaved` is duplicated per page** (preferences.js, employee-profile.js,
  and the pre-existing settings.js) with slightly different semantics. There is
  no shared frontend util module beyond `app.js`/`i18n.js`; consolidating it is a
  future-cleanup candidate, not done here.
- **The profile avatar hue derives from the display name** (matching the 0.37.0
  employee-detail and team pages), which differs from the topbar avatar's
  id-based hue — a pre-existing inconsistency in the shell, not introduced here.
- **No DOM/E2E tests.** Browser-behaviour coverage waits for M16 (Playwright);
  this release is verified by a live Playwright-MCP walkthrough, not committed
  tests.

---

## [0.38.0] — 2026-05-29 — M15 Settings + Security restyle

### What changed

**M15 Plan 7** re-skins the employer **`/settings`** page and the standalone
**`/security`** page to the design. **Zero backend changes** — every API
surface, payload, and validation is byte-equivalent; this is a pure frontend
rewrite around the new visual vocabulary.

- **`/settings` is now a 5-tab page.** A serif header + a sticky 220px sidebar
  of icon-tile tab buttons (honey active bar) on desktop; a horizontal
  scrolling chip row on mobile (≤760px). The active tab persists in the URL as
  `?tab=<id>` (replacing the old `#hash` anchors); switching tabs swaps the
  content container in place via `replaceChildren()` with no full reload and an
  `AbortController` per tab cancelling the previous tab's in-flight fetches.
  Tabs, in order: **Company · Organization · Notifications · Backups ·
  Security**.
  - **Company** — name input + 88×88 logo tile (Choose / Remove + client-side
    256×256 PNG resize). Save persists name (org PUT) + logo (branding
    PUT/DELETE), exactly as before.
  - **Organization** — three cards (Leave allowances + carry-over + per-employee
    overrides · Leave policy concurrent + blocked-dates editor · Working time +
    per-employee overrides) collapsed under **one** "Save organization settings"
    button that saves the org form then the working-time form in sequence.
  - **Notifications** — SMTP-server card (write-only password discipline
    preserved: a blank password field keeps the stored secret) + Notification
    events card (3 master switches). Status line reads the safe `mailConfigured`
    boolean.
  - **Backups** — Create card (with the post-restore lockdown banner up top) +
    a CSS-grid backup list (date + **Latest** pill on the newest + mono ID chip
    + size + Download / Delete) + Automatic-backups card (toggle + schedule +
    retention) + a clay-bordered **Restore** card (dashed file drop-zone + type
    `RESTORE` + a big clay button disabled until both gates are met).
  - **Security** — a single entry card with an "Open security settings" button →
    `/security`. **No forms here** (see Honest Disclosures).
- **`/security` rebuilt to three M15 cards.** Change passphrase (current + new +
  **confirm**, with an inline "Passphrases don't match" hint and a submit gated
  until current present, new ≥ 12 chars, confirm matches), Recovery code
  (generate → dashed-honey mono code block with Copy + "Done — I've saved it" +
  "won't be shown again" warning; Remove), and a clay **Danger zone** Rotate
  card (current + type `ROTATE`, both gated). All endpoints and the post-rotate
  503 lockdown are unchanged.
- **Per-card "Saved ✓" flash** replaces the old top-of-page success toast for
  successful saves; errors still surface as toasts so they can't be missed.
- **i18n:** ~40 new `settings.*` / `security.*` keys per locale (en-US + pt-PT).
- **`CACHE_VERSION` v55 → v56** (`security.css` / `security.js` are pre-cached
  and changed; `settings.*` are network-first). No new pre-cached asset.

### Tests

No new test suite — the rewrite is DOM + API plumbing over endpoints already
covered by `test-org-settings`, `test-mail-config-store`, `test-backups`,
`test-security-routes`, `test-rotate`, `test-keyring`, `test-dek`,
`test-masterkey-envelope`. Locale parity holds (`test-i18n`); CSP cross-file
inline-bootstrap hash invariant holds (`test-security-headers`). Full suite:
48/49 green, the lone red being the pre-existing host-timezone-sensitive
`test-reports.mjs` "overnight split" flake. **Verified live via the Playwright
MCP** as employer: all 5 tabs render + `?tab=` updates + content swaps with
**zero console errors**; Company/Org/Notifications/Backups all load + save;
consolidated org save; `/security` three cards with the mismatch hint and the
ROTATE gate enabling the button (rotation **not** executed); mobile chip row at
600px; and the post-restore lockdown banner rendering after a real
restore-then-reload.

### Honest Disclosures

- **5 tabs, not 4.** The prototype ships Company / Organization / Backups /
  Security; we add **Notifications** as a 5th tab to preserve the 0.26.0 SMTP +
  events surface. Deliberate deviation from the prototype.
- **Security tab is an entry card, not inline forms.** Per the CLAUDE.md "things
  that have bitten us" note: a data-heavy Settings page becomes a wall of 503s
  during `passphraseResetRequired` lockdown. `/security` stays a standalone
  minimal page; Settings → Security is a styled card with an "Open security
  settings" button. (There is no home-page Security card in the codebase to
  re-point; the only `/security` link was inside the old Settings page.)
- **`/security` `minlength` tightened 8 → 12** on the *new* passphrase to match
  the design copy. Existing 8–11-char passphrases continue to authenticate — the
  rule is on new-passphrase entry, not on validating the in-use one.
- **Org save consolidates.** The two old buttons ("Save organization" + "Save
  working-time") become one "Save organization settings" that saves the org form
  then the working-time form. If the org save fails the working-time save is
  skipped and the error toast names which form failed; org-then-working-time is
  left-committed (matches the old two-button semantics).
- **Save flash, not toast (success only).** Per-card "Saved ✓" flash replaces
  the top-of-page success toast. Errors still toast.
- **No "tagline" field.** The prototype's Company tagline input is omitted — the
  backend `company` object has only `name`; inventing a field would be a backend
  change. Dropped rather than faked.
- **No "Verify" backup button and no auto/manual chip.** The prototype shows a
  per-row Verify action and an Automatic/Manual label, but there is **no**
  `POST /api/backups/verify` endpoint and the backup list entries carry no
  origin flag (`{id, filename, timestamp, sizeBytes, createdAt}`). Both were
  dropped rather than add backend surface. Download + Delete are unchanged.
- **Per-employee override tables stay `<table>` elements** (CSS-restyled), not
  the prototype's grid divs, to keep screen-reader semantics and the existing
  `data-uid`/`data-type`/`data-field` collectors byte-equivalent. They render
  full (no virtualization) at the ≤ 50-employee target.
- **Tab state in `?tab=`, not `#hash`.** The old `#company`/`#organization`/
  `#security` anchors are gone; external links to those anchors load cleanly on
  the default tab. `/settings?tab=security` is honored.
- **Lockdown banner improved.** On a fresh load during post-restore lockdown
  (`/api/me` returns 503), the page now detects the state via the allowlisted
  `/api/backups/status` and renders the "restart Pica" banner — the old page
  showed a blank shell in that case. During lockdown the **topbar** still emits
  benign 503 console errors fetching `/api/me` / `/api/branding` (pre-existing
  shell behavior, out of scope here).
- **No DOM/E2E tests** for the new shell — that's M16. Verified live via the
  Playwright MCP.

---

## [0.37.0] — 2026-05-28 — M15 employer home + team + employee detail

### What changed

**M15 Plan 6** rebuilds the three employer-facing screens — the employer side
of `/`, `/employees`, and `/employees/:id` — to the design, preserving every
shipped feature and adding the design's richer status / stat / inline-decide
surfaces. **Zero backend changes**; everything is a frontend fan-out over
endpoints we already had.

- **Shared `team-status.js`** (pure, Node-importable like `calendar-grid.js`).
  Exports `pairSessions` / `workedMs` / `breakMs` / `groupByEmployee` /
  `classify` / `STATUS_SORT` / `BREAK_CUTOFF_HOUR`. The canonical status set is
  **working / break / done / leave / off**; all three screens render the same
  status dot + label vocabulary (`.st-dot--*`). New suite `test-team-status`.
- **Employer home `/`** is rebuilt around a **4-card stat strip** (Working now /
  On break / On leave / Waiting on you — each clickable; "Waiting on you" turns
  clay-soft when > 0), a **2-column grid** with a **Team-today** card listing
  **everyone** (sorted working → break → done → on-leave → not-in) and a right
  column with the **Waiting-on-you** card (avatars, type/name/detail, inline
  ✓ / ✗ per row) plus an **Hours-this-week** card (org-wide serif total + delta
  vs last week + Mon–Fri bars, today's bar honey). The old `dashboard-welcome` +
  3 widget cards + quick-nav cards are gone — the sidebar has been the nav
  since 0.27.0. Employee home (0.28.0) is byte-identical.
- **Team list `/employees`** gains a **toolbar** (search + status chips with
  live counts) and a **table** (Person · Status · Week+bar · Today · pending
  dot). Each row is still a real `<a>` to the detail page. Avatars / role
  badges / `+ New employee` / no-profile hint preserved. Per-row status is the
  shared `classify`; week hours come from `/api/reports/timesheets?scope=all&type=week`;
  today from `/api/punches/today` paired client-side; pending counts from
  `/api/leaves` (pending) + `/api/corrections?status=pending`.
- **Employee detail `/employees/:id`** rebuilt: a **hero** card (88px avatar,
  serif name + role badge, position, status pill + today's segments, Reset-pw +
  Edit-profile buttons), a **3-up stat block row** (This week / This month /
  Today — each serif number / target + progress bar + caption: "missing Xh" or
  "on track"; "Today" derives a daily target = weekly/5), a **Recent days**
  card (last 7 days with punches this month, mono date · sessions · total), a
  **"Pending from {firstName}"** card with **inline ✓ / ✗** for both leave and
  correction requests (reuses `leave-actions.js`; correction approve/reject is a
  plain POST), and an **Upcoming leaves** card (accent bar + type + dates +
  pill, link to `/leaves/:id`). New data: `/api/punches/by-employee/:id?date=today`
  for the hero + Today stat, `?year&month` for Recent days.
- **Reset-password modal** moved off its hand-rolled markup onto the shared
  `modal.js` shell (`createModal({ titleKey })` → focus trap, Esc, backdrop).
  The flow / validation / endpoint / success message are byte-equivalent.
- **Inline decide** is consistent across home and detail (and matches `leaves.js`
  / `corrections.js`): ✓ on leaves calls `approveLeaveWithCheck` (handles the
  concurrent-overlap confirm); ✗ reveals an inline note → `rejectLeave`. ✓ on
  corrections is a bare POST; ✗ posts with `{notes}`.
- **Status model — heuristic "On break".** Pica's punch data cannot tell
  "on a break, will return" from "done for the day". `classify` treats
  clocked-out-with-sessions before `BREAK_CUTOFF_HOUR = 18` (local hour) as
  **break** and at/after 18 as **done**. Honest Disclosure.

### Numbers

- New file: `public/team-status.js` (pure helpers).
- New test suite: `tests/test-team-status.mjs` (14 cases).
- Test count: 48 → **49**.
- `CACHE_VERSION` `v54` → `v55` (precaches `/team-status.js`).
- 38 new i18n keys per locale (en-US + pt-PT); `employees.title` → "Team" /
  "Equipa" (value update on an existing key).

### Honest Disclosures

- **"On break" is a heuristic, not ground truth.** The 18:00 cutoff is a fixed
  constant, not configurable; it's a reasonable approximation for a Mon–Fri
  daytime workforce and reads wrong for shift work. The status vocabulary is
  honest about its limits.
- **Team-list week target is a flat 40h reference** for the progress bar (the
  reports endpoint doesn't return per-employee targets and we deliberately did
  not add a backend dependency). Operators with non-standard weeks will see a
  bar that doesn't reflect their target — the worked-hours number is still
  accurate.
- **Recent-days window is the current calendar month only** (one
  `by-employee?year&month` fetch). Early-month views show fewer than 7 days; we
  do not fetch the prior month.
- **Detail "missing hours" widgets are folded** into the new 3-up stat blocks
  (`missing Xh` caption under the worked-vs-target bar). The number isn't lost
  but it's no longer in its own card.
- **Employer-home fan-out is wider** than before (7 parallel requests including
  this-week + last-week timesheets matrices). Fine at ≤ 50 employees; the
  endpoints all use existing server-aggregated stores.
- **Stat-card clicks navigate** rather than filter in place (Working/Break →
  `/employees`, On leave → `/leaves/calendar`, Waiting on you → scrolls to its
  card). No anchor / sticky-filter persistence.
- **`index.html`'s static `#widget-grid` + `#nav-cards`** are now dead markup
  (both role paths replace `<main>`'s contents). Left in place to avoid
  CSP-hash drift on the bootstrap; harmless.
- **No DOM / E2E tests** — that's M16 (Playwright).
- **`leave-actions.js` overlap-check confirm** uses `window.confirm`, same as
  the calendar and leaves-list paths. Migrating to a styled modal is a Plan-9
  polish item.

---

## [0.36.0] — 2026-05-25 — M15 calendar restyle

### What changed

**M15 Plan 5** rebuilds `/leaves/calendar` to the design, preserving employee
privacy and adding pending leaves + a right rail + an anchored day popover. It
also unifies the month-grid scaffolding into a shared helper.

- **Data model.** The calendar now shows **pending + approved** (was approved-
  only). Both roles fetch `/api/leaves` + `/api/leaves/approved`. Employer bars
  = everyone's `{pending, approved}`. Employee bars = own `{pending, approved}`
  (from `/api/leaves`) **merged** with anonymized others (from
  `/api/leaves/approved`) — others still carry no identity or type (privacy
  unchanged). `blockedRanges` from the approved feed.
- **Toolbar.** ◀ ▶ Today + serif month label · **type-filter chips**
  (Vacation / Sick / Appointment / Other / Closed — toggle visibility) ·
  employee-only **Mine | Team** scope.
- **Grid.** Today = honey circle; weekends muted; outside-month faded; **closed
  days** (employer blocked ranges) get the 135° hatch + a "Closed" label; leave
  **pills ≤ 3 + "+N more"**; **pending → dashed** pill; bold name when it's the
  viewer; anonymized others render as generic "Unavailable" blocks.
- **Anchored day popover** (replaces the old details panel). Click a cell → a
  popover positioned below it (flips up near the bottom, clamps to the viewport;
  **bottom-sheet on mobile ≤ 600px**) lists each leave (avatar initials + name +
  type · range, linking to `/leaves/:id` for employer/owner; anonymized rows for
  employees) and, for employees, **"Request leave this day"** → opens the Plan-4
  request modal with the date prefilled. Closes on outside-click / Esc / nav.
- **Right rail (320px).** Out today + Out tomorrow lists; employee **vacation
  balance** card (remaining / cap + bar + Request CTA); employer **pending
  requests** card with inline approve / decline. Header subtitle: employer
  `N out today · M pending`; employee `You have N of {cap} vacation days left`.
- **Shared modules (DRY).** New `calendar-grid.js` (`monthMatrix` — the Mon-first
  6×7 day matrix) now backs **both** the calendar and the leave-detail
  mini-calendar (`leave.js` refactored onto it). New `leave-actions.js`
  (`approveLeaveWithCheck` / `rejectLeave` — the concurrency-checked decide
  helpers) is shared by the leaves list (`leaves.js` refactored onto it) and the
  calendar rail.

13 new `calendar.*` i18n keys per locale; `CACHE_VERSION` v53 → v54 (locales
changed and `calendar-grid.js` + `leave-actions.js` joined the precache list).
New suite `test-calendar-grid.mjs` (month-matrix contract): 47 → 48.

Verified live via the Playwright MCP on a throwaway server: employer grid
(approved solid + pending dashed), chips, popover, rail pending **inline approve
→ reload** (the row clears and the approved leave appears in Out tomorrow);
employee Mine|Team scope, anonymized "Unavailable" blocks (privacy held),
balance card, popover **"Request leave this day" → modal prefilled**; the
leave-detail mini-calendar still renders via the shared helper; **zero console
errors** on both roles.

### Honest Disclosures

- **The employee view stays anonymized** — other employees' leaves show as
  count-free "Unavailable" blocks (no name, no type) in the grid, popover, and
  Out-today/tomorrow rail, consistent with `/api/leaves/approved` (0.22.4). Only
  the employer sees names.
- **The calendar shows pending + approved only.** Rejected and cancelled leaves
  are excluded by design.
- **Popover positioning is viewport-clamped vanilla JS** (CSSOM `left`/`top`; no
  positioning library). It flips above the cell near the bottom edge and becomes
  a bottom sheet on mobile, but it does not reposition on scroll/resize while
  open — it closes on outside interaction instead.
- **A multi-month leave highlights only the portion in the shown month** (the
  leave-detail mini-calendar anchors on the leave's start month). Unchanged from
  0.35.0; the shared helper did not alter this.
- **No DOM / E2E tests** for the rendered calendar markup — Playwright is M16.
  The new unit suite covers only the pure month-matrix helper; the UI was
  smoke-verified manually.
- Pre-existing, untouched: the unauthenticated `GET /api/settings/me` 401 logged
  once on the login page (palette pre-fetch before auth).

---

## [0.35.0] — 2026-05-25 — M15 leaves restyle (list + request modal + detail)

### What changed

**M15 Plan 4** rebuilds the three leaves screens to the design, preserving every
existing leave behavior and adding four design extras (all from existing
endpoints — no backend change).

- **Leaves list (`/leaves`).** Split into role regions.
  - *Employee:* a "Your balance" card of four stat-blocks (vacation / sick /
    appointment / other — remaining-over-total, used count, progress bar,
    pending note; unlimited types show no cap) and a "Your history" section with
    status tabs (counts per status) over status-accented rows.
  - *Employer:* a honey-outlined **"Pending approval" inbox** with a
    "N waiting on you" tag and **inline ✓ / ✗ on each pending row** (NEW — until
    now only the detail page could decide), a "Team balance" matrix with a year
    selector, and an "All requests" tabbed list. Inline approve runs the same
    `/overlaps` concurrency check + confirm as the detail page; reject reveals an
    inline note. On either, the list re-fetches so the row moves to History and
    the tag/tabs recompute.
- **Request-Leave modal.** The old `/leave-new` page is retired; requesting a
  leave now opens a reusable `<dialog>` modal (`request-leave-modal.{js,css}`)
  built on the 0.32.0 `modal.js` shell — type cards, Full-days/Hours toggle,
  reason, and a file drop-zone (same 5 MB multipart upload). Plus three extras:
  a **balance-after summary** (serif day count + remaining-after-deduction,
  clay when overdrawn), a **conflict box** (counts approved leaves overlapping
  the chosen range — anonymized count for employees, names for employers), and a
  **success state** that replaces the body (check + "Request sent" + Request
  another / Done). `/leaves/new` now `302`→`/leaves?new=1` (auto-opens the modal,
  strips the query); `leave-new.{html,js}` deleted. The home "+ Book time off"
  and calendar "Request leave" buttons reach the modal through that redirect.
- **Leave detail (`/leaves/:id`).** Rebuilt to a two-column layout: a
  status-hero card (status-colored bg/border + round icon + serif label +
  blurb), Details / Reason / Attachment / Actions cards (the full attachment
  add/replace/remove flow and approve / reject-with-note / cancel / revoke logic
  are byte-identical, including the concurrency confirm), and a right column with
  a **mini-calendar** (the leave's month, its days tinted by type, today
  honey-bordered) and an **activity timeline** (Requested → decision, with the
  rejection note as a bubble). Duration now uses locale-aware i18n plurals and
  `fmtDateTime` (replacing the old hardcoded English strings).

42 new i18n keys per locale (`rlm.*`, plus `leaves.*` / `leave.*` additions);
`CACHE_VERSION` v52 → v53 (locales changed and `request-leave-modal.{js,css}`
joined the precache list). New suite `test-leaves-render.mjs` (day-count +
status-partition contract): 46 → 47.

Verified live via the Playwright MCP on a throwaway server: employer inline
approve (tabs/matrix recompute) + detail hero/mini-calendar/timeline; employee
balance blocks, request modal with conflict box + balance-after + success state,
`?new=1` auto-open; privacy held (employee sees only own leaves; conflict box is
a count with no name); **zero console errors** on both roles.

### Honest Disclosures

- **Half-day morning/afternoon is NOT included.** The design's request modal
  offers Full-day / Morning / Afternoon (0.5-day) buttons, but the backend leave
  model only has `days` / `hours` units. Adding half-days needs a storage-layer
  unit-model change (and balance/`daysOf` math), out of scope for a restyle
  plan. The existing Hours unit covers sub-day leave in the meantime.
- **The detail mini-calendar is self-contained**, duplicating month-grid logic
  the Plan 5 Calendar will own. It's deliberate transitional code; Plan 5
  unifies them. It also highlights only the portion of a multi-month leave that
  falls in the leave's **start** month.
- **The employee conflict box is a count only** ("N colleagues already off") —
  no names — because `/api/leaves/approved` anonymizes other employees' leaves
  for employees (by design). Employers see names. The box is informational;
  concurrency is still enforced server-side at submit (0.22.17).
- **Home / calendar reach the modal via the `/leaves?new=1` redirect**, not by
  opening it inline on those pages (they don't link the modal assets yet). A
  later pass could wire the modal directly into the employee home card.
- **"Request another"** in the success state resets the form in place (it does
  not preserve the previous values).
- **No DOM / E2E tests** for the rendered markup — Playwright is M16. The new
  unit suite covers only the pure helpers (day-count, status partition); the UI
  was smoke-verified manually.
- Pre-existing, untouched: the unauthenticated `GET /api/settings/me` 401 logged
  once on the login page (palette pre-fetch before auth).

---

## [0.34.0] — 2026-05-25 — Punch / topbar CSS polish (two pre-existing bug fixes)

### What changed

Two small, pre-existing defects surfaced during the M15 punches work are now
fixed. Both are styling / CSP-cleanliness only — **no behavior change**.

- **Topbar avatar CSP violation (app-wide, since 0.27.0).** The shell built
  the sidebar and mobile avatars as markup carrying an inline
  `style="--hue:…"` attribute; once parsed, CSP `style-src 'self'` blocked it,
  emitting **two console errors on every authenticated page**. The per-user
  hue is now applied via CSSOM (`el.style.setProperty('--hue', …)` after the
  shell is built), which CSP does not govern. Result: **zero console errors**
  (verified live) and the avatar still renders its per-user colour.
- **Missing `.sess__*` session-row styles (since 0.30.0).** `punch.js` (and,
  since 0.33.0, `punches-today.js`) emit `.sess__timeval`, `.sess__addr`, and
  `.sess__comment-inline`, but `punch.css` defined none of them — the inline
  comment was fully unstyled, and a now-dead full-row `.sess__comment` rule
  lingered. Added explicit rules for the time value (`--ink`, 14px), the
  address (`--muted`, 12px), and the inline comment (italic, `--ink-2`,
  12.5px); removed the dead `.sess__comment` rule (+ its mobile override).
  Fixes both `/punch` and `/punches/today` at once.

`CACHE_VERSION` v51 → v52 (`topbar.js` + `punch.css` are pre-cached). No new
i18n, no new test suite.

### Honest Disclosures

- Purely a CSP-cleanliness + styling fix; the data flows and markup structure
  are unchanged.
- `.sess__time--out` deliberately has **no** modifier rule — the base
  `.sess__time` pill is the intended neutral OUT look (only `--in` overrides
  to sage); a code comment now says so.
- The static `test-security-headers` suite guards inline styles in **HTML
  files**; it cannot see a runtime inline style parsed from a JS-built markup
  string, so this class of bug is caught by the **Playwright MCP** console
  check, not an in-repo test. An automated DOM/console suite is still M16.
- Remaining Plan-9 cleanup trivia (the M15 alias bridge, the dead
  `title.correctionNew` locale key, the unstyled `mtm-modal` scoping class)
  are still deferred to the final M15 cleanup.

---

## [0.33.0] — 2026-05-24 — M15 employer `/punches/today` restyle

### What changed

The employer-only "everyone's punches today" page (`/punches/today`) is
rebuilt to the M15 design, **preserving every shipped behavior** (grouping
by employee, worked/break totals, reverse-geocoded addresses,
most-recently-active sort, employer-only guard, empty/loading states):

- Each employee is now a **card** with a person header — name, role, a
  **status pill** (sage "Working now" with a pulsing dot when they have an
  open session, else muted "Done for the day"), and a mono worked·break
  total.
- Their punches render as **session pairs** (in → out, or "Still working"
  for an open session) using the same `.sess` vocabulary as the employee
  clock page (3a) — `punch.css` is already linked here, so no CSS was
  duplicated. Addresses are reverse-geocoded per fix (coords first, then
  the label swaps in).
- A **tab strip** (`Today` active · `Corrections` → `/corrections`) mirrors
  the employee `/punch` sub-tabs and the design's employer view (Pica stays
  multi-page — "Corrections" is a link, not an in-page panel).
- The renderer was rewritten to build DOM with `createElement`/
  `textContent` only — the old `escapeHtml` + raw-HTML-string assignment
  path is gone, closing that XSS surface.

No backend changes (the `/api/punches/today`, `/api/employees`, `/api/me`
contracts are unchanged). 5 new `punchesToday.*` i18n keys (tab + status
labels) in both locales; `CACHE_VERSION` v50 → v51 (locales are
pre-cached). `punches-today.{html,js,css}` are not pre-cached, so editing
them needed no bump on their own account.

This completes the **punches/corrections screen group** (employee clock
0.30.0 · corrections list+detail 0.31.0 · manual-time modal 0.32.0 ·
employer today 0.33.0). Verified live in a browser via the Playwright MCP
(employer clocks in → card shows "Working now" + a live "Still working"
row; clocks out → "Done for the day" + a paired In/Out session; the
Corrections tab navigates).

### Honest Disclosures

- **No backend change.** Session pairing is a small **local**
  re-implementation in `punches-today.js` (~12 lines) — deliberately not
  shared with `punch.js`, whose pairing helpers live in a module with page
  side effects (importing it would run that page's bootstrap). Extracting a
  shared `punch-helpers.js` is a later cleanup; until then the pairing
  logic exists in two places (both covered: `punch.js` by
  `test-punch-week`, this one by the browser smoke).
- **Reverse-geocoding still hits OSM Nominatim** per unique fix (the
  existing privacy/throughput trade-off from 0.22.9, unchanged).
- **Browser-smoke-verified, no in-repo DOM test.** The Playwright MCP drove
  the flow once; an automated committed E2E suite is still M16.
- **Pre-existing, not addressed here:** the `topbar.js` runtime
  inline-style CSP console errors (every page since 0.27.0) still appear in
  the browser console; and a couple of zero-impact CSS nits in
  `punches-today.css` (a zero-delta `--done` status modifier kept for
  JS-toggle symmetry; the mobile head uses `flex-wrap`) are deferred to the
  Plan 9 cleanup.

---

## [0.32.0] — 2026-05-24 — M15 manual-time modal + `/corrections/new` retirement

### What changed

Filing a manual time correction is now a **reusable modal** instead of a
standalone page. The form (kind both/in/out, start/end, justification)
and its `POST /api/corrections` contract are ported verbatim from the old
`/corrections/new` page — only the container changed.

- **Generic modal shell** `public/modal.js` (+ `modal.css`) — a small,
  dependency-free primitive on the native `<dialog>` element (the same
  precedent as the reject dialog): centered panel, dimmed backdrop,
  close on the × button / Escape / backdrop click, native focus-trap and
  focus restoration. Built with `createElement`/`textContent` (no
  `innerHTML`), CSP-clean. This shell is what **Plan 4 (request-leave)
  will reuse**.
- **Manual-time modal** `public/manual-time-modal.js` (+
  `manual-time-modal.css`) — builds the form into the shell and exposes
  `openManualTimeModal({ onFiled })`. It is **self-styled** (its own
  `mtm-` classes), so it renders correctly on any page — including the
  punch page, which does not link `corrections.css`.
- **Wired into** the corrections list ("Register manual time" → opens the
  modal; on success the list re-fetches so the new pending row and the
  "N waiting on you" tag appear) and the punch page ("Forgot to clock?" /
  "Missing a punch?" → open the modal in place). All entry points keep
  their `href="/corrections/new"` as a no-op fallback.
- **`/corrections/new` retired** — the route now `302`-redirects to
  `/corrections?new=1`, which auto-opens the modal (and strips the query
  via `replaceState`). The standalone `correction-new.html` /
  `correction-new.js` are deleted, and the now-dead `.kind-fieldset` /
  `.kind-radio` rules were removed from `corrections.css` (`.form-actions`
  stays — the reject dialog still uses it).

No backend changes beyond the one-line route redirect. Two new i18n keys
(`modal.close`, `manualTime.filed`) in both locales; `CACHE_VERSION`
v49 → v50 and the four modal assets added to the SW precache (the
pre-cached punch page statically imports the modal).

This release was **verified live in a real browser** via the Playwright
MCP (not an in-repo dependency): open from the list and the punch page,
fill, submit, the correction is filed (`pending`, 8h, justification
round-tripped), the modal closes, the list refreshes with the inline
✓/✗ actions; the `/corrections/new` redirect auto-opens the modal; Escape
closes it.

### Honest Disclosures

- **No no-JS fallback for filing.** The standalone form page is gone, so
  filing a correction now requires JavaScript. Acceptable — the whole app
  already requires JS — but it is a real removal of progressive
  enhancement for this one flow. The `href` fallbacks only navigate to
  the redirect, which needs JS to open the modal.
- **Files for self only**, unchanged: `POST /api/corrections` is
  `requireAuth` and records `employeeId = req.user.id` (an employer can
  file for themselves, as before).
- **Offline filing still isn't queued.** Unlike punches, a correction
  POSTed while offline fails; the modal surfaces the error and stays
  open. (The modal assets are pre-cached so the punch page still loads
  offline; only the submit needs the network.)
- The generic `modal.js` shell is intentionally **minimal** (no size
  variants, no stacking of multiple modals) — Plan 4 will extend it as
  request-leave needs.
- **Browser-smoke-verified, but still no in-repo DOM test.** The
  Playwright MCP drove the flow this once; an automated, committed E2E
  suite is still M16. There remain two **pre-existing** items this slice
  did not address: the `topbar.js` runtime inline-style CSP violations
  (visible as console errors on every page since 0.27.0), and the
  detail-page `correction.js` local date/hour formatters (CLAUDE.md says
  to use `/i18n.js`).

---

## [0.31.0] — 2026-05-24 — M15 corrections list + detail restyle

### What changed

The `/corrections` list and `/corrections/:id` detail pages are rebuilt
to the M15 design, **preserving every shipped decide flow** (file /
approve / reject-with-note / cancel / reverse, justified/unjustified
semantics, the materialized-punch behavior, and server-enforced employee
privacy — employees still see only their own):

- **List (`/corrections`)** — status-accented rows (a thin honey/sage/
  clay/muted bar by status, mono dates, kind + justification chips, a
  status pill, hours) grouped into a **Pending** card and a **History**
  card, with role-aware headings and empty states. The clickable row is
  still a real `<a>` to the detail page (keyboard-focusable, middle-click
  to open in a new tab, announced as a link by screen readers).
- **Employer inline approve/decline (new)** — pending rows now carry
  inline ✓/✗ buttons so an employer can decide without opening the
  detail page. Approve shows the same confirmation as the detail page
  for an unjustified both-punch correction; decline reveals an inline
  notes field. Both post to the **existing**
  `POST /api/corrections/:id/{approve,reject}` endpoints, then the list
  re-fetches so the row moves to History and the "N waiting on you" tag
  recomputes. The inline buttons are double-submit-guarded and
  `stopPropagation` so they never trigger the row's navigation.
- **Detail (`/corrections/:id`)** — rebuilt to a **status-hero** card
  (status-colored icon + serif label + one-line blurb) plus **Details**
  (When/Kind/Hours), **Reason/justification**, and **Actions** cards,
  mirroring the Leave-detail vocabulary. All decide logic is byte-for-
  byte unchanged — only `render()` and the markup/CSS were rewritten.

No backend changes — the endpoints are exactly as before. 14 new
`corrections.*`/`correction.*` i18n keys in both locales; `CACHE_VERSION`
v48 → v49 (locale files are pre-cached). `corrections.css`/
`correction.css` are not pre-cached, so editing them needs no bump.

### Honest Disclosures

- The **inline approve/decline** is the only new behavior; the detail
  page remains the full view (decision notes, the reverse/cancel flows,
  the employee-name header). The inline decline collects an optional
  note but no other metadata.
- The **manual-time modal** and the **`/corrections/new` restyle** are
  the next plan (3b-ii) — "Register manual time" / "Forgot to clock?"
  still navigate to the existing (pre-M15) new-entry page. The
  **employer `/punches/today`** view is plan 3b-iii.
- **No DOM/browser tests.** The restyle was smoke-verified (the pages
  and their CSS/JS serve, the corrections API round-trips, auth-gating
  returns 401/302, and the CSP / theme-bootstrap invariants hold) and
  unit-verified (i18n parity, SW precache, frontend imports). But the
  interactive inline-decide wiring is client-side JS a headless smoke
  cannot exercise — browser verification waits for M16 (Playwright).
- The "N waiting on you" tag uses a single `{n}`-interpolated string (no
  singular/plural split); it reads correctly for n = 1 in both en-US and
  pt-PT, so no `tn()` plural form was added.
- A pre-existing, build-date-sensitive `test-reports.mjs` case
  ("overnight shift attributes hours to each day separately") fails on
  this date independent of this change; it touches no file in this slice
  (verified failing identically at the branch base).

---

## [0.30.0] — 2026-05-24 — M15 employee punch (clock) page restyle

### What changed

The employee-facing `/punch` (Clock) page is rebuilt to the M15 design
while **preserving every shipped behavior**:

- a **clock hero** — status pill ("Working now" with a pulsing dot /
  "Not clocked in"), a big mono readout (live elapsed when working, else
  the wall clock), a location chip, and a tall check-in/out button;
- a **sub-tab strip** — **Today** and **This week** are panels on the
  page; **My corrections** is a link to `/corrections` (a "tab strip over
  existing routes", not a consolidation);
- **session-pair rows** (IN/OUT with reverse-geocoded address, duration,
  origin badge, comment, and a clay "missing punch · file a correction"
  hint for incomplete pairs);
- a **This week** panel (new) — the viewer's own prior-day sessions
  grouped by day with per-day totals, sourced from
  `GET /api/punches/by-employee/<self>?year=&month=`;
- an inline "Missing a punch?" reminder linking to `/corrections/new`.

All of the page's machinery is untouched: geolocation (thorough + fast
paths), the **offline punch queue** (enqueue/drain/idempotency), the
**OSM map preview**, reverse-geocoded addresses, and break-time totals.
New `punch.*` i18n keys in both locales; `CACHE_VERSION` v47 → v48; new
`test-punch-week` suite (day-grouping + pairing helpers).

### Honest Disclosures

- **My corrections** links to the still-pre-M15 `/corrections` page, and
  **"Forgot to clock?"** navigates to the existing `/corrections/new`
  page — the `/corrections` restyle and the manual-time **modal** are the
  next plan (3b). The **employer** `/punches/today` + corrections
  inbox/History are also a later plan.
- `punch.js` still carries its own copy of the fast-geo logic (it was NOT
  migrated onto the shared `/geo.js`); that unification is the final
  cleanup plan.
- This-week groups by **UTC day** (consistent with the reports endpoint /
  home / server `todayYmd`); near local midnight a session can appear
  under the UTC day. Acceptable at the ≤50-employee self-hosted target.
- Session rows show an **Auto** origin badge for now — punches carry no
  manual/source field yet; correction-sourced (manual) entries arrive
  with plan 3b (the CSS already has a `--manual` variant).
- The Week tab is **not** re-fetched after an offline-queue drain (the
  badge + Today tab reflect the sync; the Week tab refreshes on reload).
- No DOM/browser tests (pixels verified by smoke); Playwright is M16.

---

## [0.29.0] — 2026-05-23 — M15 preferences: color-palette picker

### What changed

The Preferences page gains a **Palette** picker — three swatch cards
(Linen / Slate / Olive), each showing a 4-chip preview (background ·
primary · success · alert) that **swaps with the selected color mode**,
so you can see how a palette looks in light or dark before saving. The
chosen palette is persisted per-user and applied app-wide through the
`data-palette` token cascade shipped in 0.27.0.

`palette` is now a first-class user preference: `src/storage/user-prefs.js`
adds it (enum `linen|slate|olive`, default `linen`, validated like
`colorMode`) and `PUT /api/settings/me` accepts it (the route already
passes the body through — no route change). The synchronous theme
bootstrap and the `app.js` server-refresh (both from 0.27.0) already read
`pica-palette` / `prefs.palette`, so a saved palette takes effect
immediately and on every page.

New `prefs.palette*` i18n keys in both locales; `CACHE_VERSION` v46 → v47
(locale files are pre-cached). Palette validation + default are covered by
new cases in `test-user-prefs`.

### Honest Disclosures

- This adds the **palette control + persistence only**; the rest of the
  Preferences page keeps its pre-M15 layout (the full Preferences
  redesign is a later M15 plan). The picker is styled with design tokens
  (via the alias bridge) so it sits cleanly inside the old page.
- Palette and color mode apply **on Save** (consistent with the existing
  color-mode behavior), not live on card-click; the card highlight + chip
  preview give immediate feedback.
- The preview chip hex values are **hardcoded** in `preferences.js`
  (mirroring the 6-combo cascade in `app.css`) because the preview must
  show all three palettes at once — which the live CSS vars (only the
  active palette) cannot provide. If the palette token values in `app.css`
  ever change, update the `PALETTE_CHIPS` map too.
- No DOM tests (pixels verified by smoke); Playwright is M16.

---

## [0.28.0] — 2026-05-23 — M15 employee home redesign (functional clock hero)

### What changed

The employee landing page (`/`) is rebuilt to the M15 design. For
**employees only**, the read-only widget dashboard is replaced with:

- a **greeting** (time-of-day + first name) and a live HH:MM:SS clock;
- a **clock-in/out hero** that actually clocks — one tap records a real
  punch via `POST /api/punches/clock-in|clock-out` — showing today's
  worked total, a session timeline (closed sessions in sage, the live
  one in honey), and a status pill;
- a **This week** card — Worked / Target / Remaining + a Mon–Fri bar
  chart (today highlighted) — sourced from
  `GET /api/reports/timesheets?scope=me&type=week` with the weekly
  target from `/api/settings/working-time`;
- an **upcoming-leaves** card (date tile + title + status pill) with a
  "Book time off" button → `/leaves/new`.

The hero records punch location through a new shared `public/geo.js`
(best-effort fast geolocation: a fresh cached fix or a single 3-second
low-accuracy attempt, else the punch goes through with a
`geoSkipReason`). Punch errors surface via the existing `toast()`.

The **employer** home is unchanged. New `home.*` i18n keys in both
locales; `CACHE_VERSION` v45 → v46 (adds `/geo.js` to the pre-cache
list). One new test suite (`test-employee-home`, pure-helper contract)
→ 45 suites total.

### Honest Disclosures

- **Employer home is still pre-M15** — re-skinned only via the alias
  bridge; rebuilt in a later M15 plan.
- The home hero uses the **fast** geo path (cached fix or a 3 s
  attempt, else `geoSkipReason`); there is **no map preview** here.
  `/punch` remains the full geolocation UI (map + retry).
- **`geo.js` duplicates `punch.js`'s fast-geo logic transitionally** —
  `punch.js` is migrated onto `geo.js` in the Punches plan; until then
  the ~40 lines live in both.
- The **This-week bars are Mon–Fri only**; weekend work still counts in
  the Worked total but is not bar-charted.
- "Book time off" links to the existing `/leaves/new` page — the
  Request-Leave modal is a later plan.
- Week buckets and the "today" highlight use **UTC dates** (consistent
  with the reports endpoint); near local midnight the highlighted bar
  follows the UTC day.
- No DOM/browser tests yet (pixels verified by smoke); Playwright is
  M16. Pre-existing and out of scope (later M15 cleanup): an inline
  `style="text-align:center"` in the employer-path `widgetError`, and
  the shell's `.mono` crumb-date class has no global CSS rule yet.

---

## [0.27.0] — 2026-05-23 — M15 foundation: design tokens, self-hosted fonts, new shell

### What changed

The visual **foundation** of the M15 UI revamp. Every existing page
re-skins immediately through a compatibility bridge; the screen bodies
themselves are rebuilt in later M15 plans.

**Design-token cascade.** `public/app.css` now carries a
`[data-theme]` × `[data-palette]` CSS-custom-property cascade with
**6 theme × palette combos**: Linen Light, Linen Dark, Slate Light,
Slate Dark, Olive Light, Olive Dark. These are the canonical token
vocabulary for the rest of M15. A **pre-M15 alias bridge** maps the
old token names (`--accent`, `--surface`, `--text`, etc.) onto the
new ones so the 20 not-yet-migrated stylesheets keep rendering without
a single edit. The bridge is intentional transitional debt, removed in
the final M15 cleanup plan.

**Self-hosted fonts.** Three font families — Instrument Serif (headings),
DM Sans (UI text), JetBrains Mono (monospace) — are now served from
`public/fonts/` as 8 woff2 files. `@font-face` blocks in `app.css`
reference them with absolute `/fonts/*.woff2` paths. `font-src 'self'`
in the CSP is **unchanged** — no Google CDN, no third-party request,
no IP leak. The woff2 files are **committed to the repo**, so a clean
checkout already has them and the app works offline without any extra
step. A zero-dep `scripts/fetch-fonts.mjs` downloader exists for
operators who want to refresh or re-fetch the files (needs network).
Licenses: Instrument Serif, DM Sans, and JetBrains Mono are all SIL
OFL and permit redistribution.

**Theme + palette bootstrap.** The inline `<script>` in all 21 HTML
files is swapped for a new bootstrap that resolves **both** color mode
(light / dark / system via `matchMedia`) **and** palette. It sets both
`data-theme` and `data-palette` on `<html>` synchronously, before any
CSS parses, so there is no flash. The script is byte-identical across
all 21 HTML files — one CSP `sha256-` hash covers them all. `app.js`
now also applies `palette` from the server's stored preferences
(defensive default: palette API field doesn't exist server-side yet —
that is wired in the Preferences M15 plan).

**New shell.** `public/topbar.js` and `public/topbar.css` are rebuilt
to the M15 design:

- **Desktop:** fixed sidebar (232 px) with brand mark and a
  role-specific icon nav — employer: Home / Team / Calendar / Leaves /
  Punches / Reports (plus a Settings link pinned at the bottom);
  employee: Home / Clock / Calendar / My leaves / Reports — plus a
  user-tile popover (profile / preferences / sign-out). The content
  area gets its own top-bar with breadcrumb and notification bell.
- **Mobile (≤ 760 px):** top app-bar (burger + brand name + bell +
  avatar) + bottom nav (employer: 4 primary + "More"; employee: all 5)
  + slide-in drawer (full nav + user controls).

The `mountTopBar()` and `mountFooter()` export signatures are
**unchanged**, so none of the other 20 pages were edited.

New nav, menu, and crumb keys added to both `public/locales/en-US.js`
and `public/locales/pt-PT.js`.

`CACHE_VERSION` v44 → v45 (shell CSS/JS, fonts, locales changed).
8 font files added to the SW pre-cache list.

**3 new test suites**: `test-theme-tokens` (token cascade: all 6
combos defined, alias bridge present), `test-theme-bootstrap` (inline
bootstrap byte-identical across all 21 HTML, resolves both mode and
palette, no third-party CDN URL in any public file — privacy/offline
regression guard), `test-sw-precache` (font woff2 files in the pre-
cache list, all listed assets exist on disk). Test count 41 → 44.

### Files touched

- `public/fonts/` — **new directory**. 8 woff2 files: Instrument Serif
  Regular + Italic, DM Sans Regular + Medium + SemiBold + Bold,
  JetBrains Mono Regular + Medium. Committed to the repo.
- `scripts/fetch-fonts.mjs` — **new**. Zero-dep downloader for
  refreshing the woff2 files (needs network; not shipped to clients).
- `public/app.css` — design-token cascade (6 `[data-theme]` ×
  `[data-palette]` combos), pre-M15 alias bridge, `@font-face` blocks,
  font-family token values.
- All 21 `public/*.html` — swapped inline bootstrap to resolve both
  `data-theme` and `data-palette` (byte-identical across all 21).
- `public/app.js` — extended server-refresh IIFE to also apply
  `palette` from stored prefs.
- `public/topbar.js` — rebuilt shell DOM (sidebar + content top-bar
  + mobile top-bar / bottom-nav / drawer / user-menu popover). Public
  contract (`mountTopBar` / `mountFooter`) unchanged.
- `public/topbar.css` — full restyle to the M15 design shell.
- `public/locales/en-US.js`, `public/locales/pt-PT.js` — new
  nav / menu / crumb i18n keys.
- `public/sw.js` — 8 font files added to the pre-cache list;
  `CACHE_VERSION` v44 → v45.
- `package.json` — 0.27.0, 2026-05-23.
- `tests/test-theme-tokens.mjs` — **new**.
- `tests/test-theme-bootstrap.mjs` — **new**.
- `tests/test-sw-precache.mjs` — **new**.
- `docs/architecture.md`, `docs/handoff.md`, `docs/roadmap.md`,
  `RELEASES.md` — this entry; test count; milestone state.
- `docs/superpowers/plans/2026-05-22-m15-foundation-tokens-shell.md`,
  `docs/superpowers/plans/2026-05-22-m15-ui-revamp-roadmap.md` — M15
  planning artifacts committed alongside the release.

### Honest Disclosures

- **Foundation only.** The 13 screen bodies (dashboard, punch, leaves,
  reports, employees, corrections, settings, etc.) are still their
  pre-M15 layouts, re-skinned via the alias bridge. Each is rebuilt in
  a later M15 plan. See
  `docs/superpowers/plans/2026-05-22-m15-ui-revamp-roadmap.md` for the
  full plan series.
- **The alias bridge is intentional transitional debt.** It keeps all
  20 un-migrated stylesheets rendering without a single edit. It is
  removed in the final M15 cleanup plan, once every stylesheet
  references design tokens directly. Until then it adds ~40 lines to
  `app.css` that will eventually go away.
- **The notification bell is static.** No red-dot / unread-count
  wiring exists yet. The pending-count nav badge is deferred to the
  Employer-home plan to avoid inventing a backend endpoint prematurely.
- **The woff2 files are committed to the repo.** `scripts/fetch-fonts.mjs`
  exists for operators who want to refresh them from upstream sources
  (needs network). A checkout without the files would fall back to
  system fonts; the committed files mean that fallback should never
  occur in practice.
- **System dark mode requires JS.** There is no `prefers-color-scheme`
  CSS-only fallback. With JS disabled, system-preference users get the
  light theme. This is acceptable because the app requires JS to
  function at all.
- **Brand sub-line uses `app.suffix` ("Time management").** A real
  company tagline is a Settings concern, handled in the Settings M15
  plan.
- **No browser / DOM tests.** Shell layout and interaction are
  smoke-verified (assets serve, CSP intact, bootstrap byte-identical).
  Playwright is M16 — it tests the post-revamp UI once all 13 screens
  are rebuilt.

---

## [0.26.0] — 2026-05-22 — Encrypted settings-managed SMTP config

### What changed

SMTP configuration **moves out of plaintext `config.json`** and into a
single **AES-256-GCM-encrypted blob** keyed by the DEK. The plaintext
`mail` block introduced in the (unpushed) 0.25.0 design — host, port,
user, **pass**, from, and the commented `_mail_help` array — is gone.
In its place `config.json` carries `"mail": { "enc": "<base64>" }`: one
encrypted blob (AAD `pica-mail-config-v1`) holding the full SMTP struct.
The app password never sits in plaintext on disk.

The credentials are now **configured from the app**, on **Settings →
Email notifications**, which gains an SMTP editor form (host, port,
secure, user, password, from). The Settings sections were **reordered**
so Email notifications sits **before** Backups: company →
organization → notifications → backups → security.

The supporting plumbing changed accordingly:

- New `src/storage/mail-config.js` owns the encrypted blob. It decrypts
  once on construct and caches the struct in memory; `read()` /
  `isConfigured()` / `publicView()` / `write()`. It **never throws** —
  an absent / malformed / undecryptable blob yields the safe disabled
  default (mail off). `write()` is **abort-not-clobber**: it re-reads
  the existing `config.json` and aborts the write rather than proceed on
  a blank object, so a transient read failure cannot destroy
  `security.wraps`.
- `src/config.js` **no longer parses mail**: `normalizeMail` and the
  derived `config.mailConfigured` scalar are removed; `config.mail` is
  a raw passthrough (the store, not the config loader, owns mail now).
- The mailer reads SMTP credentials from the store. Its Layer-1 gate is
  the store's `isConfigured()` (all of enabled + host + user + pass +
  from present) rather than a config flag.
- New **employer-only `PUT /api/settings/mail`**, audited as
  `settings.mail_updated` with **no details** (so the audit record can
  never leak the password). `GET /api/settings/org` returns a
  **sanitized `mail` publicView** plus an authoritative `mailConfigured`
  boolean.
- `pass` is **write-only** end-to-end: never returned by any endpoint,
  never logged, never audited. The Settings password field loads blank
  and only overwrites the stored credential when non-empty.

`CACHE_VERSION` v43 → v44 (Settings assets + 14 new i18n keys per
locale, plus one updated value, changed).

0.25.0 (Email notifications, M14) stays in history unchanged; this is a
new 0.26.0 layered on top. There is **no migration** from the
never-shipped 0.25.0 plaintext `mail` block.

### Endpoints

New:

- `PUT /api/settings/mail` — employer-only. Writes the SMTP config
  through `mailConfigStore.write()`, audited as `settings.mail_updated`
  (no details). The response includes the sanitized `mail` publicView
  and the authoritative `mailConfigured` boolean.

Changed:

- `GET /api/settings/org` now returns a sanitized `mail` publicView —
  `{ enabled, host, port, secure, user, from, hasPassword }`, **never
  `pass`** — alongside the `mailConfigured` boolean.

Config / storage:

- `config.json` `mail` is now `{ enc: "<base64 AES-256-GCM>" }` — a
  single encrypted blob keyed by the DEK (AAD `pica-mail-config-v1`).
  The plaintext `mail` block and `_mail_help` array are removed. A
  `mail` key written by hand (plaintext fields) is **ignored** — only
  the `{ enc }` shape is read.

### Files touched

- `src/storage/mail-config.js` — **new**. The encrypted mail-config
  store (decrypt-on-construct, in-memory cache, never-throws,
  write-only `pass`, abort-not-clobber `write()`).
- `tests/test-mail-config-store.mjs` — **new**. Covers the store:
  encrypt/decrypt round-trip, AAD binding, never-throws on bad input,
  write-only `pass`, abort-not-clobber on read failure, `publicView`
  omits `pass`.
- `src/config.js` — removed `normalizeMail` / `config.mailConfigured`;
  `config.mail` is now a raw passthrough.
- `config.json.example` — replaced the plaintext `mail` block + help
  with a note: SMTP is configured in-app (Settings → Email
  notifications) and stored AES-256-GCM-encrypted as `mail.enc`.
- `tests/test-config-mail.mjs` — updated for the no-parse config.
- `src/mail/mailer.js` — reads creds from the store; Layer-1 gate is
  `isConfigured()`.
- `tests/test-mail-mailer.mjs` — updated for the store-driven mailer.
- `src/routes/settings.js` — `GET /api/settings/org` `mail` publicView
  + `mailConfigured`; new employer-only `PUT /api/settings/mail`
  (audited `settings.mail_updated`, no details).
- `tests/test-mail-routes.mjs` — updated for the new GET shape + PUT
  route.
- `server.js` — constructs `createMailConfigStore`, threads it to the
  mailer and the settings route, store-driven startup warn;
  `config.mail` / `mailConfigured` references fully removed repo-wide.
- `public/settings.html`, `public/settings.js` — SMTP editor form;
  section reorder (Email notifications before Backups); `pass`
  write-only in the UI; PUT response drives the authoritative
  `mailConfigured`.
- `public/locales/en-US.js`, `public/locales/pt-PT.js` — 15 new i18n
  keys per locale for the SMTP editor.
- `public/sw.js` — `CACHE_VERSION` v43 → v44.
- `package.json` — 0.26.0.
- One new suite (`tests/test-mail-config-store.mjs`). Total: 41 suites.

### Honest Disclosures

- **SMTP config is NOT in backups.** `config.json` stays gitignored and
  excluded from the backup archive (unchanged behaviour). After
  restoring data on a fresh machine the operator **must re-enter** the
  SMTP details from Settings. The trade-off is deliberate: the app
  password never travels inside a backup.
- **The master key must be unlocked to decrypt the SMTP config.** The
  blob is keyed by the DEK, so outbound mail is **unavailable during
  the recovery-code / passphrase-reset lockdown** (the DEK is unlocked
  but the app is in a 503 lockdown that allows only login / `me` /
  logout / set-passphrase). Mail is best-effort anyway and the lockdown
  is a rare safety state, so this is an accepted limitation, not a
  regression.
- **`config.json` is mutated at runtime by the Settings save.** This is
  the **same behaviour class** as changing the passphrase, generating a
  recovery code, or rotating the key — all of which already rewrite
  `config.json` via `writeConfigAtomic`. The Settings write **aborts
  rather than clobber**: if it cannot first read the existing
  `config.json`, it abandons the write so a transient read failure can
  never destroy `security.wraps`.
- **No plaintext fallback, no hand-edited `mail` block.** Only the
  encrypted `{ enc }` shape is read; a `mail` key written by hand with
  plaintext fields is ignored. There is **no migration** from the
  never-shipped 0.25.0 plaintext block — operators on that unpushed
  design re-enter their settings once via the UI.
- **Losing `config.json` or the passphrase loses the SMTP config**
  (along with everything else `config.json` holds). The blob is keyed
  by the DEK whose wraps live only in `config.json`; neither passphrase
  nor recovery code can recover it without the wrapped ciphertext.
- **`pass` is write-only.** It is never returned by any endpoint, never
  logged, and never audited — the `settings.mail_updated` audit record
  deliberately carries **no details** for exactly this reason. The UI
  password field is blank on load and only overwrites the stored
  credential when non-empty.
- **Two pre-existing test flakes are unrelated to this work and
  untouched.** `tests/test-reports.mjs` → `overnight shift attributes
  hours to each day separately` is host-timezone sensitive.
  `tests/test-auth.mjs` has a ~1/64 probabilistic case (a base64url
  last-character signature-tamper artifact in the test itself, not the
  auth code). Both fail identically on the pre-0.26.0 baseline; if
  `test-auth.mjs` reds, re-run it alone to confirm it is the
  intermittent pre-existing issue, not a regression.

---

## [0.25.0] — 2026-05-18 — Email notifications (M14)

### What changed

Pica can now **send notification emails**. A new in-house,
dependency-free SMTP submission client (`src/mail/smtp.js`) submits
mail through the operator's own authenticated relay over TLS. There
are **three notification categories** plus one informational notice:

- **Leave decision** — the requesting employee is emailed when their
  leave is approved or rejected.
- **Correction decision** — the requesting employee is emailed when
  their time correction is approved or rejected.
- **Leave reminder** — the employee is emailed roughly **24 hours
  before** an approved leave starts (a background scheduler).
- **Password-reset notice** — when an employer resets a user's
  password, that user is emailed an informational notice (no token,
  no link, no credential — just "your password was reset, contact
  your administrator").

Delivery is gated by two independent layers. **Org-level master
switches** (employer-managed, on Settings → Email notifications) turn
each category on or off org-wide. **Per-user opt-outs** (both roles,
on Preferences) let each user silence the categories they receive.
The password-reset notice deliberately bypasses both layers — a user
must learn their password changed — and is gated only by
`config.mail.enabled` plus a recipient address.

Mail is **off until the operator opts in**: a new optional `mail`
block in `config.json` (absent or `enabled:false` → no mail, no
behaviour change). The block is entirely operator-managed; the server
never writes or auto-populates it.

`CACHE_VERSION` v42 → v43 (Preferences/Settings/locale assets
changed).

### Endpoints

New:

- `POST /api/mail/test` — employer-only. Sends a fixed test message
  to the configured `from`/`user` address so the operator can verify
  SMTP settings without waiting for a real notification. Gated by
  `config.mail.enabled` and a usable recipient; bypasses the org/user
  opt-out layers (it is a config probe, not a notification).

Changed:

- `GET /api/settings/org` now also returns a safe boolean
  `mailConfigured` (whether a usable `mail` block is present and
  enabled). No credentials or host details are exposed — just the
  boolean, so the Settings UI can show the switches as live or inert.

Config / storage:

- New optional `config.json` `mail` block
  (`enabled`, `host`, `port`, `secure`, `user`, `pass`, `from`) plus
  a commented `_mail_help` array in `config.json.example`. Normalized
  and validated in `src/config.js`; an invalid/partial block disables
  mail rather than crashing the server.
- New event-sourced leaves event `reminder_sent`, appended via
  `markReminderSent(id)` on the leaves store, so the reminder
  scheduler never double-sends a reminder for the same leave.

### Files touched

- `src/mail/smtp.js` — minimal SMTP submission client: EHLO,
  STARTTLS (when `secure:false`), `AUTH LOGIN`, `MAIL FROM`/`RCPT
  TO`/`DATA`. TLS certificate verified (`rejectUnauthorized` default
  true).
- `src/mail/templates.js` — server-side plain-text templates for the
  four message kinds, localized en-US / pt-PT.
- `src/mail/mailer.js` — the gating + best-effort boundary: resolves
  org switch × per-user opt-out × `config.mail.enabled`, builds the
  message from a template, hands it to the SMTP client, never throws
  into the caller.
- `src/routes/mail.js` — `POST /api/mail/test` (employer-only).
- `src/scheduler/reminder-scheduler.js` — periodic scan of approved
  leaves; sends the 24h-before reminder once per leave (idempotent
  via `reminder_sent`).
- `src/config.js` — `mail` block normalization/validation.
- `src/storage/org-settings.js` — org-level notification switches
  (validated, defaulted).
- `src/storage/user-prefs.js` — per-user email notification opt-outs.
- `src/storage/leaves.js` — `reminder_sent` event + `markReminderSent`.
- `src/routes/settings.js` — `mailConfigured` boolean on
  `GET /api/settings/org`; org switch read/write.
- `src/routes/leaves.js`, `src/routes/corrections.js`,
  `src/routes/employees.js` — fire the decision / password-reset
  notifications (best-effort; the in-app state + audit log remain
  authoritative).
- `server.js` — wires the mailer, registers the mail route, starts
  the reminder scheduler.
- `public/settings.{html,js}` — employer "Email notifications"
  section (org switches + a "Send test email" button).
- `public/preferences.{html,js}` — per-user email notification
  toggles.
- `public/locales/en-US.js`, `public/locales/pt-PT.js` — new strings
  for both UIs.
- `public/sw.js` — `CACHE_VERSION` v42 → v43.
- `config.json.example` — the new `mail` block + `_mail_help`.
- Tests — six new suites: `tests/test-config-mail.mjs`,
  `tests/test-mail-smtp.mjs`, `tests/test-mail-templates.mjs`,
  `tests/test-mail-mailer.mjs`, `tests/test-reminder-scheduler.mjs`,
  `tests/test-mail-routes.mjs`. `tests/test-org-settings.mjs` and
  `tests/test-user-prefs.mjs` (pre-existing) extended for the new
  switches/opt-outs. Total: 40 suites.
- `package.json` — 0.25.0.

### Honest Disclosures

- **Best-effort, no retry or queue.** A transient send failure loses
  that one email. There is no retry, no outbox, no dead-letter
  queue. The in-app state (the leave/correction decision itself) and
  the audit log are authoritative; email is a courtesy on top. A
  failed send is logged via the regular logger and otherwise
  swallowed — it never fails the user-facing request.
- **Pica is not an MTA and not an SMTP server.** It only *submits*
  outbound mail through the operator's own authenticated relay. It
  never listens for, receives, or routes inbound mail. There is no
  bounce handling.
- **App Password only — no OAuth2 / XOAUTH2.** Gmail / Google
  Workspace requires a 2-Step-Verification account with an App
  Password used as `pass`. Pica authenticates with plain
  `AUTH LOGIN` over TLS only; it does not implement OAuth2 token
  flows.
- **No MTA-STS, no DANE.** The TLS certificate **is** verified
  (`rejectUnauthorized` defaults to true) and STARTTLS is **required**
  when `secure:false` (it is not silently downgraded to plaintext if
  the server omits STARTTLS). But there is no SMTP policy discovery
  beyond that — no MTA-STS policy fetch, no DANE/TLSA validation.
- **SMTP credentials sit in plaintext in `config.json`.** This is the
  same trust boundary as the already-present wrapped DEK: anyone who
  can read `config.json` already holds the keys to the install.
  `config.json` is gitignored and is **not** included in Pica
  backups. Use a dedicated send-only account with an App Password,
  never a primary credential.
- **The password-reset notice is informational only and is not
  user-opt-outable.** It carries no token, link, or credential — it
  only tells the user their password was reset and to contact their
  administrator. It deliberately ignores the org switch and the
  per-user opt-out (a user must learn their password changed); it is
  gated solely by `config.mail.enabled` plus a recipient address.
- **No self-service password recovery, no email-KEK master-key
  recovery, no HTML email, no per-event employer digest.** This
  release sends plain-text notifications only. The reserved email
  KEK recovery slot from 0.23.0 is **not** unblocked here; the
  offline recovery code remains the master-key recovery path. These
  are out of scope or later milestones.
- **The SMTP reply parser treats a leading `2` or `3` as success.**
  This matches the design's reply model for submission to a known
  relay. A non-conforming relay that returned a 3xx where a 2xx is
  expected would be treated as success. Bounded: this only affects a
  misbehaving relay the operator themselves chose to point Pica at.
- **The reminder scheduler scans all approved leaves each tick** with
  no month pre-filter. This is deliberate: at the ≤50-employee target
  scale the scan is negligible, and a month-window optimisation could
  drop a leave that falls due exactly at a month boundary. The
  `reminder_sent` event is written as an **unencrypted** event line —
  it carries only a timestamp and the already-non-secret leave id; no
  PII is added.
- **A correction with neither an in nor an out timestamp would render
  a blank date in its decision email.** This shape is structurally
  prevented at correction creation, so the path is unreachable in
  normal operation; noted for completeness.
- **`POST /api/mail/test` bypasses the org/user opt-out layers** (it
  is a configuration probe, like the password-reset notice is a
  mandatory security notice). Both are still gated by `mail.enabled`
  plus a recipient address.
- **Two pre-existing test flakes are unrelated to M14 and untouched.**
  `tests/test-reports.mjs` → `overnight shift attributes hours to
  each day separately` is host-timezone sensitive. `tests/test-auth.mjs`
  has a ~1/64 probabilistic case (a base64url last-character
  signature-tamper artifact in the test itself, not the auth code).
  Both fail identically on the pre-M14 baseline; if `test-auth.mjs`
  reds, re-run it alone to confirm it is the intermittent
  pre-existing issue, not a regression.

---

## [0.24.0] — 2026-05-17 — Reports revamp (M13)

### What changed

The Reports page is rebuilt around **two report types** —
**Timesheets** and **Leaves** — each runnable for **everyone**
(employer only) or for **one person**, over **Day / Week / Month /
Year** period presets with ◀/▶ navigation to step through periods.

The combined ("everyone") view is a **matrix**: period buckets down
one axis, employees across the other, with row and column totals. The
page is print-friendly — the browser's Print dialog → "Save as PDF"
renders a landscape sheet via a print stylesheet — and every report
shape exports to CSV.

Visibility is **server-enforced**: an employer sees everyone; an
employee only ever sees themselves. `scope=all` from a non-employer
is refused at the route, not just hidden in the UI.

### Endpoints

New:

- `GET /api/reports/timesheets` — query: `scope=me|all`, `id`,
  `type=day|week|month|year`, `anchor` (a date inside the period),
  optional `format=csv`.
- `GET /api/reports/leaves` — same query shape.

Removed (no redirect, no back-compat shim — these now 404):

- `GET /api/reports/summary`
- `GET /api/reports/team-hours`
- `GET /api/reports/hours/:id` and its `.csv` variant
- `GET /api/reports/leaves/:id` and its `.csv` variant

### Files touched

- `src/storage/period.js` — added period presets (Day/Week/Month/
  Year resolution + navigation). Additive only: `computePeriod`,
  `ymdOf`, `isWeekday` are unchanged and still power the dashboard
  summary in `src/routes/employees.js`.
- `src/storage/reports.js` — `bucketKeyFor`, `leavesRangeReport`,
  `hoursMatrix`, `leavesMatrix`, and four new CSV serializers. The
  old `hoursReportToCsv` / `leavesReportToCsv` serializers were
  removed.
- `src/routes/reports.js` — rewritten around the two new endpoints
  and the server-side scope check; the four old handlers were
  deleted.
- `public/reports.html`, `public/reports.css`, `public/reports.js` —
  rebuilt: type/scope/period controls, the matrix table, the
  single-person itemised view, print stylesheet (`@page landscape`),
  CSV download.
- `public/locales/en-US.js`, `public/locales/pt-PT.js` — report
  string keys synced for the new UI.
- `public/sw.js` — `CACHE_VERSION` v41 → v42 (precached assets
  changed).
- Tests — `tests/test-reports-routes.mjs` added (new endpoints,
  scope enforcement); `tests/test-reports-team.mjs` removed (it only
  exercised the deleted team-hours route); `tests/test-period.mjs`
  (pre-existing) extended for the presets; `tests/test-reports.mjs`
  extended with matrix/CSV cases and its old-CSV tests removed.
- `package.json` — 0.24.0.

### Honest Disclosures

- **No server-generated PDF.** "PDF" here means the browser's own
  Print dialog → "Save as PDF" rendered against a print stylesheet
  (`@page landscape`). A zero-dependency project ships no stdlib PDF
  encoder and none was added. There is no server endpoint that
  returns a `.pdf`.
- **The old employer "Team overview" band is gone.** Its
  scheduled-vs-worked-vs-missing math was removed together with
  `/api/reports/summary` and `/api/reports/team-hours`. Any external
  bookmark or integration hitting the four removed endpoints
  (including the per-employee `/api/reports/hours/:id` /
  `/api/reports/leaves/:id` and their `.csv` variants) now returns
  404 — there is no redirect or compatibility shim. Scheduled-vs-
  worked figures still exist in the dashboard widgets; only the
  Reports-page band was removed.
- **The combined Leaves matrix cell is approved days off only.**
  Days are attributed per calendar day; an hours-unit leave
  contributes `hours / 8` to the leave's start day. The matrix does
  not break leaves down by type or status. The single-person Leaves
  view still itemises every record and shows the per-status /
  per-type summary — that detail was not lost, only the combined
  view aggregates.
- **Wide matrices rely on scrolling.** A Month bucketed by day across
  many employees is wide; on screen it relies on horizontal scroll
  and in print on landscape orientation. This is acceptable at the
  documented ≤50-employee target scale and was not optimised beyond
  it.
- **`period.js` is unchanged where it mattered.** The extension is
  strictly additive; `computePeriod` / `ymdOf` / `isWeekday` keep
  their old behaviour and the dashboard summary in
  `src/routes/employees.js` still uses them as before.
- **One pre-existing flake is untouched.** `tests/test-reports.mjs` →
  `overnight shift attributes hours to each day separately` is
  sensitive to the host timezone, fails identically on the
  pre-feature baseline, and is out of scope for this release. It is
  the only failing case in the whole suite; everything else passes.
- **A benign module import cycle exists.** `src/storage/period.js`
  and `src/storage/reports.js` import each other, but each only
  references the other inside function bodies — never at
  module-evaluation time — so the cycle never deadlocks the loader.
  It is covered by `tests/test-frontend-imports.mjs` and exercised
  by the reports suites; flagged here so a future reader does not
  "fix" it into a real problem.

---

## [0.23.1] — 2026-05-16 — Security page reachable from Settings

### What changed

The standalone **Security** page (change passphrase, recovery code,
encryption-key rotation) introduced in 0.23.0 had no entry point in
the navigation — operators reached it only by typing `/security` or
following a stray text link wedged above the Settings cards.

This release replaces that link with a proper **Security** card at
the end of the Settings page, matching the Company / Organization /
Backups sections in layout, and adds a "Security" pill to the
Settings section-nav. The card holds one full-width primary button
that opens `/security`.

The `/security` page itself is **unchanged**: same HTML/CSS/JS, same
route, same employer-only guard, same API endpoints, same
recover-with-code lockdown behavior. Only the way you get there from
the UI changed.

### Why the page stays separate

The recover-with-code flow boots the server into a lockdown where
every API call except login / `me` / logout / set-passphrase returns
503. The Security page is deliberately minimal so that, in that
state, it renders and works while calling only the allowlisted
passphrase endpoint. The Settings page loads employee, org, and
branding data on mount — all of which 503 in lockdown — so folding
the security forms into it would have made the single most
safety-critical screen in the app a wall of errors exactly when the
operator needs it. The card-with-a-button keeps the discoverability
win without touching the recovery path.

### Files touched

- `public/settings.html` — removed the stray `<p><a href="/security">`
  link; added a `#security` section-nav pill and a `#security`
  `.card` with the entry-point button.
- `public/settings.js` — reveal the new nav pill + section for
  employers (same pattern as the other employer-only sections).
- `public/locales/en-US.js`, `public/locales/pt-PT.js` — added
  `settings.nav.security`, `settings.securityHeading`,
  `settings.securitySubtitle`, `settings.securityOpenBtn`; removed
  the now-unused `nav.security` key (its only consumer was the
  deleted link).
- `public/sw.js` — `CACHE_VERSION` v40 → v41 (precached locale
  dictionaries changed).
- `package.json` — 0.23.1.

### Honest Disclosures

- **This does not change the recovery flow.** It only adds a way to
  find the existing Security page. The lockdown allowlist, the
  passphrase-reset path, and `/security`'s own minimalism are all
  untouched.
- **The Security card is a link, not the forms.** Clicking it is a
  full-page navigation to `/security`, not an in-place reveal. The
  forms still live on their own page; this is intentional (see "Why
  the page stays separate").
- **No automatic redirect on `passphrase_reset_required`.** As
  before, after a recovery-code boot the operator must navigate to
  the Security page themselves once they see the error — the dotted
  errorCode is shown but nothing routes them there. Unchanged by
  this release; noted because the new card does not address it.
- **`/security` still has no link in the top bar.** The only UI
  entry point is now Settings → Security. Employees never see it
  (the Settings route already redirects non-employers away).
- **No new tests.** The change is markup/locale/visibility only;
  `test-security-routes.mjs` exercises the unchanged API layer and
  `test-security-headers.mjs` enumerates `public/*.html`
  dynamically, so both still pass without modification.

---

## [0.23.0] — 2026-05-16 — Master key management: envelope encryption, passphrase change, rotation, recovery code

### What's new

Full **master-key management** for the server admin — change the
passphrase, generate a recovery code, rotate the data-encryption
key, perform a wipe-reset, and recover when the passphrase is
forgotten. New **Settings → Security** page in the employer UI.

#### Envelope encryption (config.json `security`, version 2)

The master key is now a two-layer scheme:

- **DEK** (data-encryption key, 32 bytes random): the key that
  actually encrypts all data on disk. Unchanged from what lived
  in RAM in prior releases — the same AES-256-GCM everywhere.
- **KEK** (key-encryption key): derived from the passphrase via
  scrypt (same N=2¹⁷, r=8, p=1 as before). The DEK is wrapped
  (AES-256-GCM) under the KEK and stored in `config.json` as a
  `wraps` array (slot 0 = passphrase slot, slot 1 = recovery
  code slot when set). AAD binds each wrap to its slot:
  `pica-dek-wrap-v1:<slot>`.

`config.json` gains a `security` object:
```json
{
  "security": {
    "version": 2,
    "kdfSalt": "<hex>",
    "verifier": "<base64>",
    "wraps": [
      { "slot": 0, "kdfSalt": "<hex>", "wrappedDek": "<base64>" }
    ]
  }
}
```

**Migration (v1 → v2):** automatic on first boot after upgrade.
The legacy scrypt output (the old "master key") is frozen as the
DEK — no re-encryption of any data file. The scrypt salt from
the old `config.json` becomes the DEK-wrap salt for slot 0.
The `masterkey.js` module returns `{ masterKey, mustResetPassphrase }`
after migration; `mustResetPassphrase` is always `false` (the
migration is seamless, no action required from the operator).

#### Operations

| Operation | How to invoke | Audit event |
|---|---|---|
| Change passphrase | `POST /api/security/passphrase` (current + new passphrase) | `security.passphrase_changed` |
| Set recovery code | `POST /api/security/recovery-code` | `security.recovery_code_set` |
| Remove recovery code | `DELETE /api/security/recovery-code` (passphrase required) | `security.recovery_code_removed` |
| Rotate keys | `POST /api/security/rotate` (current passphrase + new passphrase) | `security.key_rotated` |
| Wipe reset | Boot with `PICA_RESET=1` env var | (boot-time; logged via regular logger, not audit) |
| Recover with code | Boot with `PICA_RECOVERY_CODE=<code>` env var | (boot-time; logged via regular logger, not audit) |

**Recovery code**: offline, 32 Crockford base32 characters (8
groups of 4 separated by dashes, 160 bits of entropy), shown
exactly once at generation time. Stored as a second KEK-slot in
`wraps`. Lets the admin unlock the DEK when the passphrase is
forgotten.

**Key rotation**: generates a new random DEK, re-encrypts the
entire `data/` directory in a staging copy, swaps staging into
place, updates `config.json` with the new DEK wrapped under the
new passphrase. A 503 lockdown (restart required) follows a
successful rotation. Takes a pre-rotation snapshot
(`data.pre-rotate-<ts>/`) before the swap.

**Wipe reset** (`PICA_RESET=1`): moves `data/` aside to
`data.pre-reset-<ts>/` (never deleted), generates a fresh DEK
and new `config.json security` block, starts with a blank
`data/`. The passphrase at boot becomes the new credential.
Irreversible in the sense that all prior data is no longer
accessible under the new key — but the moved-aside directory
is preserved if the operator needs it.

**Recover with code** (`PICA_RECOVERY_CODE=<code>`): unwraps
the DEK from slot 1. On the same boot the server enters a
lockdown that allows only login, `/api/me`, logout, and the
passphrase-set endpoint. The operator signs in and uses
**Settings → Security** to set a new passphrase; no current
passphrase is required in that state (the recovery-code boot
already authenticated and the in-memory DEK is re-wrapped under
the new passphrase). The lockdown does not auto-redirect pages.
After recovering, the operator should regenerate or remove the
recovery code from Settings → Security — a passphrase change
alone does NOT invalidate it (key rotation drops the recovery
slot).

#### Settings → Security page

New employer-only page at `/security`. Displays the security
version and active slots; provides buttons for passphrase change
and recovery code management (set / remove). Key rotation has a
dedicated form with a warning about the backup incompatibility
(see Honest Disclosures). The page is the only place in the app
that exposes the recovery code — shown once in a modal after
generation.

#### Body-parsing gate widened

`server.js` now parses request bodies for `DELETE` requests in
addition to `POST`, `PUT`, and `PATCH`. This was necessary so
`DELETE /api/security/recovery-code` can carry the passphrase in
the request body. Existing `DELETE` routes (corrections, leaves,
employees, backups) ignore the body, so behavior is unchanged.

### Audit events (exact set)

- `security.passphrase_changed`
- `security.recovery_code_set`
- `security.recovery_code_removed`
- `security.key_rotated`

Wipe-reset and recovery-code unlock happen at boot, before the
audit store is initialized — they are recorded in the regular
server log, not the encrypted audit log.

### Files touched

**New:**
- `src/crypto/dek.js` — DEK wrap/unwrap, v1→v2 migration logic
- `src/crypto/keyring.js` — multi-slot wrap array management
- `src/crypto/rotate.js` — staged re-encrypt + atomic swap
- `src/routes/security.js` — 6 HTTP endpoints + wipe/recover boot paths
- `public/security.html`, `public/security.css`, `public/security.js` — Settings → Security page
- `tests/test-dek.mjs` — 11 cases
- `tests/test-keyring.mjs` — 8 cases
- `tests/test-rotate.mjs` — 3 cases
- `tests/test-masterkey-envelope.mjs` — 10 cases
- `tests/test-security-routes.mjs` — 17 cases

**Modified:**
- `src/crypto/masterkey.js` — now returns `{ masterKey, mustResetPassphrase }`;
  detects v1 config and performs zero-touch v1→v2 migration on startup
- `src/crypto/index.js` — re-exports new modules
- `src/routes/pages.js` — `/security` page route
- `server.js` — body parsing extended to DELETE; registers security routes;
  wipe-reset and recover-with-code boot paths
- `public/locales/en-US.js`, `public/locales/pt-PT.js` — `security.*`
  and `errors.*` keys for new page and new error codes
- `public/topbar.js` — adds Security link to employer nav
- `public/sw.js` — `CACHE_VERSION` → `pica-cache-v40`; `/security.css`
  and `/security.js` added to precache (consistent with pattern for
  page-specific CSS/JS)
- `package.json` — version `0.23.0`

### What this does NOT do (Honest Disclosures)

- **Losing `config.json` makes all data unrecoverable.** The DEK is
  wrapped inside `config.json` — without it, neither the passphrase
  nor the recovery code can unlock anything. `config.json` is
  intentionally NOT restored from backups (it is install-specific).
  The recovery code guards against a *forgotten passphrase*; it does
  not guard against loss of `config.json` itself.
- **After key rotation OR wipe-reset, pre-existing backups become
  unrestorable under the new passphrase.** The DEK changes; old
  backup archives were encrypted with the old DEK. Take a fresh
  backup immediately after rotating or resetting.
- **Rotation cannot un-leak already-exfiltrated plaintext.** If an
  attacker copied the in-memory DEK before rotation, rotating gives
  them no benefit — the new DEK protects only future writes. Rotation
  is a forward-looking control, not a retroactive one.
- **Weak-passphrase offline brute force is bounded only by the scrypt
  cost.** Envelope encryption does not change this. The wrapping layer
  adds no extra KDF stretch beyond what scrypt already provides.
- **A written-down recovery code is passphrase-equivalent.** Anyone
  who has it can unlock the DEK and set a new passphrase. Guard it
  with the same care as the passphrase itself. It is shown exactly
  once; Pica does not store it in plaintext anywhere.
- **Migrated installs carry a derived-then-frozen DEK.** The historical
  scrypt output becomes the DEK verbatim — cryptographically identical
  strength to the prior scheme. It is neither weaker nor stronger.
  Rotating after upgrade generates a truly random DEK if the operator
  wants a clean break.
- **`wipeReset` is not atomic.** The sequence is: rename `data/` →
  `data.pre-reset-<ts>/`, then write the new `config.json security`
  block. If the config write fails after the rename, the server starts
  with no data directory and no valid config. Recovery: restore the
  aside `data.pre-reset-*` directory and re-run with `PICA_RESET=1`.
- **Rotate residual window.** Rotation writes the new `config.json`
  BEFORE the staging-data swap completes. If the swap fails
  mid-flight and the rollback restores the old data directory, the
  config wraps the new DEK while the data files are encrypted with the
  old DEK. In this failure state the operator must restore from a
  pre-rotation backup. The common (non-failure) path is safe; only
  the mid-swap crash window is affected. This is disclosed, not
  eliminated.
- **`DELETE /api/security/recovery-code` requires the passphrase in
  the request body.** `server.js` now parses bodies for DELETE
  requests globally. Existing DELETE endpoints ignore the body, so
  this is harmless — but it is a widening of prior behavior.

---

## [0.22.18] — 2026-05-15 — Leave justification attachments

### What's new

An employee can attach **one justification file** to a leave
request (a doctor's note, a scanned form, etc.):

- **In the new-leave form**: an optional file input. PDF or
  image (JPG, PNG, GIF, WEBP), **max 5 MB**.
- **On the leave detail page**: the filename shows as a
  download link; while the leave is still **pending**, the
  owner or an employer can add / replace / remove the file.
- **Encrypted at rest** (AES-256-GCM) in its own file,
  `data/leaves/attachments/<leaveId>`, never in the event log.
- **Visibility is exactly the leave's own ACL**: only the
  leave's owner or an employer. Another employee gets HTTP 403
  — the same rule `GET /api/leaves/:id` already enforces.
- Served **download-only** (`Content-Disposition: attachment` +
  `X-Content-Type-Options: nosniff`) so even a hostile upload
  cannot execute in the viewer's browser.

### How it works

- **Storage** (`src/storage/leaves.js`): two new append-only
  events, `attachment_set` / `attachment_removed`. The reducer
  folds them into `state.attachment = { name, mime, size } |
  null`. The bytes live in a separate encrypted file (AAD
  `leave-attachment:<id>`, distinct from the `leave:<id>` AAD
  that binds the reason/notes blob); the metadata travels in
  the event's encrypted field. Kept out of the ndjson log on
  purpose — a ≤5 MB blob there would bloat every `list()`.
  New store methods `setAttachment` / `removeAttachment` /
  `readAttachment`, all **pending-only** (decided leaves are
  frozen).
- **Routes** (`src/routes/leaves.js`): `POST /api/leaves` now
  accepts `multipart/form-data` (still accepts JSON — the file
  is validated *before* the leave is created, so a bad upload
  never leaves an orphan leave). New `GET/PUT/DELETE
  /api/leaves/:id/attachment`, all behind the owner-or-employer
  check. `validateAttachment()` is a pure, exported, tested
  policy function (size + extension/mime allowlist).
- **Body cap**: `POST /api/leaves` and `*/attachment` get a
  dedicated `attachmentMaxBytes` (6 MB default — a full 5 MB
  file plus the multipart envelope) via the same path-scoped
  mechanism the restore endpoint already uses. The file itself
  is still hard-capped at 5 MB in `validateAttachment`.

### Files touched

- `src/storage/leaves.js` — events, reducer, attachment file
  I/O, `setAttachment`/`removeAttachment`/`readAttachment`,
  `safeLeaveId` path guard.
- `src/routes/leaves.js` — multipart-aware create,
  `validateAttachment`, three attachment routes.
- `src/config.js`, `config.json.example`, `server.js` —
  `attachmentMaxBytes` (6 MB) + path-scoped body cap.
- `public/leave-new.html` / `leave-new.js` — file input,
  multipart submit (JSON path unchanged when no file).
- `public/leave.html` / `leave.js` / `leave.css` — download
  link + pending-only add/replace/remove UI.
- `public/locales/en-US.js`, `pt-PT.js` — `leave.attachment*`,
  `leaveNew.attachment*`, `errors.attachment_*` (3 codes).
- `public/sw.js` — `CACHE_VERSION` → `pica-cache-v39` (locale
  files are pre-cached).
- `tests/test-leaves-attachment.mjs` — new suite, 26 cases
  (storage lifecycle incl. encrypted-at-rest + pending-lock +
  wrong-key, `validateAttachment` policy, route authz incl.
  the **other-employee 403** privacy case).
- `package.json` — version `0.22.18`.

### What this does NOT do (Honest Disclosures)

- **One file per leave.** Replacing uploads a new one and
  discards the old. Multiple attachments were explicitly out of
  scope; if needed later it's a storage-layout change
  (`<leaveId>/` directory) plus list UI.
- **Type checking is extension + declared-MIME, not content
  sniffing.** A renamed `.pdf` that is really something else is
  accepted. Mitigated by: download-only + `nosniff` (the file
  is never rendered inline by Pica), 5 MB cap, and same-org
  trust model (≤50 employees). Pica does not parse/scan
  uploads for malware.
- **No virus scanning.** Out of scope for a zero-dependency
  self-hosted tool; the operator's environment is trusted.
- **Attachment is frozen once the leave is decided/cancelled.**
  Deliberate — the justification should reflect what was true
  at decision time. There is no post-decision edit path; an
  employer who needs a corrected document asks for a new leave
  or keeps it out-of-band.
- **The original filename is stored (encrypted) and echoed in
  the download.** It is sanitized for header-injection / path
  characters but is otherwise the user's chosen name; it is
  only ever shown to the owner/employer.
- **No audit event for attachment add/replace/remove.** Leave
  lifecycle events were already un-audited; this stays
  consistent. The encrypted event log itself records that an
  `attachment_set`/`attachment_removed` happened and when.
- **No download rate-limiting / streaming.** The decrypted
  file is buffered in memory and sent in one `res.end()`. Fine
  at 5 MB and this scale; not a streaming pipeline.

---

## [0.22.17] — 2026-05-15 — Enforce "no concurrent leave" at booking time

### What was wrong

The Organization setting **"Allow multiple employees on leave at
the same time"** was *advisory only*. When unchecked, it merely
showed the employer a warning banner at approval time
(`GET /api/leaves/:id/overlaps`) — but an employee could still
freely **book** a vacation overlapping a colleague's already-
approved leave. The `errors.leave_overlaps` message existed in
both locales but was never produced by any code path: the
setting had no teeth.

### What's fixed

`POST /api/leaves` now enforces the setting at creation. When
`leaves.concurrentAllowed === false`, an employee's request is
refused with **HTTP 400 `leave_overlaps`** if it shares any
calendar day with a *different* employee's **approved** leave.

Exemptions mirror the blocked-days policy (0.22.15), for the
same reasons:

- **The employer is never refused** — they have the final call
  (consistent with the existing approval-time advisory model).
- **Sick leave is never refused** — non-discretionary; you do
  not choose to be ill on a day a colleague is off.

So vacation / appointment / other by an employee are gated;
sick and any employer booking pass.

### How it works

Two pure, exported helpers in `src/storage/leaves.js`:

- `leavesShareADay(a, b)` — normalizes both leaves to inclusive
  `[startDay, endDay]` date spans (days-mode dates are already
  `YYYY-MM-DD`; hours-mode ISO timestamps → first 10 chars), so
  mixed-unit comparisons are correct. Lexicographic compare is
  valid for `YYYY-MM-DD`.
- `findConcurrentApprovedLeave(candidate, requesterId, all)` —
  first approved leave of a *different* employee sharing a day,
  else null. Geometry + status/identity filter only; the route
  owns the on/off + employer/sick policy.

The orphan `errors.leave_overlaps` message (en-US + pt-PT) was
rewritten to accurately describe the cause — it was previously
"overlaps another approved or pending leave", which was both
unused and inaccurate for this enforcement (we check approved
only).

### Files touched

- `src/storage/leaves.js` — `leavesShareADay` +
  `findConcurrentApprovedLeave` exports.
- `src/routes/leaves.js` — concurrent check in `POST /api/leaves`
  (after blocked-days, before cap), employer/sick exempt.
- `public/locales/en-US.js`, `pt-PT.js` — accurate
  `errors.leave_overlaps` wording.
- `public/sw.js` — `CACHE_VERSION` → `pica-cache-v38` (locale
  files are pre-cached).
- `tests/test-leaves-concurrent.mjs` — new suite, 17 cases
  (helper geometry incl. days↔hours, status/identity filter,
  route enforcement incl. setting on/off, employer + sick
  exemptions, own-leave-ignored, no-overlap-allowed).
- `package.json` — version `0.22.17`.

### What this does NOT do (Honest Disclosures)

- **Approval is still advisory.** Approving a *pending* leave
  that overlaps is unchanged — the employer still gets the
  `/overlaps` warning and the final call. The gate added here
  is at employee booking only, matching the reported problem.
  Closing the approval path the same hard way would take the
  decision away from the very person who set the policy.
- **Only OTHER employees' APPROVED leave blocks a booking.**
  Pending leave of a colleague does not (a pending request is
  not a commitment, and two pending requests racing would
  otherwise deadlock each other). Documented; revisit if the
  operator wants pending to reserve a slot.
- **No team/role scoping.** The check is org-wide: any one
  approved leave anywhere blocks any overlapping employee
  booking. For a ≤50-person tool that is the intended reading
  of the setting; per-team capacity rules are out of scope.
- **Pre-existing overlaps are not touched.** Leaves approved
  before this shipped that already overlap stay valid; the gate
  only applies to *new* bookings.
- **Same imperfect-but-consistent date model as elsewhere.**
  Day granularity only — an hours-mode leave anywhere on a day
  blocks (and is blocked by) any other leave on that calendar
  day; Pica does not do sub-day capacity.

---

## [0.22.16] — 2026-05-15 — Bugfix: picture upload 500 when no profile exists

### What was wrong

`PUT /api/employees/:id/picture` returned **HTTP 500
(`missing_required_field: fullName`)** whenever the target
employee had no profile JSON yet. The route auto-created an
empty profile (`employeesStore.create(id, {})`) "so the picture
had something to attach to" — but once profile fields became
mandatory in 0.22.6, `create({})` throws, and nothing caught
it. Every picture upload for a freshly-created user (account
exists, profile not yet filled) crashed with an opaque 500.

### What's fixed

The route no longer tries to create a profile. Instead:

- **No profile yet → HTTP 400** with `errorCode:
  profile_required` and a clear, translated message: "Complete
  the required profile fields before uploading a picture."
  (en-US / pt-PT). This is the correct product behavior — a
  picture only shows next to profile data in the list and
  summary views; an orphan `<id>.picture` with no `<id>.json`
  never surfaces there anyway.
- **`writePicture` is wrapped in try/catch** → a storage throw
  maps to a 400, so this endpoint can never 500 again.
- **Frontend** (`employee-profile.js`) now runs the upload
  failure through `translateError(errorCode, fallback)` — the
  same path the profile-save handler already used — so the
  message is localized instead of showing the raw English
  server string.

### Files touched

- `src/routes/employees.js` — replace `create({})` with a
  `!exists → 400 profile_required` guard; wrap `writePicture`.
- `public/employee-profile.js` — picture-upload error path uses
  `translateError`.
- `public/locales/en-US.js`, `pt-PT.js` — new
  `errors.profile_required` key.
- `public/sw.js` — `CACHE_VERSION` → `pica-cache-v37` (locale
  files are pre-cached).
- `tests/test-employee-picture-route.mjs` — new route-level
  suite (5 cases): no-profile→400, profile→200, writePicture
  throw→400 (never 500), no-file→400, bad-id→400.
- `tests/test-employees.mjs` — added a storage-level assertion
  that pictures are profile-independent (documents WHY the
  route, not the store, owns the policy).
- `package.json` — version `0.22.16`.

### What this does NOT do (Honest Disclosures)

- **It does not let you upload a picture before the profile
  exists.** That was considered (make the picture truly
  standalone) but rejected: the picture is only ever rendered
  beside profile data, so a picture without a profile is dead
  weight the user can't see. Requiring the profile first is the
  intended workflow; the fix just makes that requirement a
  clear message instead of a crash.
- **It does not backfill or repair profiles** with empty
  mandatory fields created before 0.22.6. Those still load and
  accept picture uploads (the profile JSON exists, so the guard
  passes); only the *no-profile-at-all* case is gated. Updating
  such a profile still requires filling the mandatory fields,
  unchanged from 0.22.6.
- **No new audit event.** Picture upload was not audited before
  and still isn't; this is a pure bug/UX fix, no behavior added.

---

## [0.22.15] — 2026-05-15 — Blocked days (employer-defined no-leave dates)

### What's new

**Employers can now block date ranges on which employees may not
book leave** — company offsites, all-hands, peak periods. Three
surfaces:

1. **Settings → Organization → "Blocked days".** An add/remove
   editor of date ranges, each with an optional label (e.g.
   "Inventory week"). Employer-only (the whole Organization card
   already is). Saved through the existing `PUT /api/settings/org`
   leaves patch.
2. **Enforcement on `POST /api/leaves`.** A request that touches
   a blocked range is refused with HTTP 400 + `errorCode:
   leave_day_blocked`; the message names the range
   ("All-hands (2026-06-01 → 2026-06-03) is blocked…").
3. **Leave calendar.** Blocked days get a distinct amber hatch,
   an in-cell label tag, a legend chip, and a row in the
   tap-to-expand day-details panel — so employees see the
   restriction *before* trying to book.

**Two exemptions, by design (operator chose these):**

- **Sick leave is never blocked.** It is non-discretionary — you
  cannot choose not to be ill on an all-hands day. `type ===
  'sick'` skips the check.
- **The employer is never blocked.** They set the policy and may
  legitimately need to record their own leave on a company day.
  `req.user.role === 'employer'` skips the check.

Every other type (vacation, appointment, other) is refused for
employees.

### How it works

- **Data model.** `org-settings.json` gains
  `leaves.blockedRanges`: `[{ start, end, label }]`, `start <=
  end`, label ≤ 80 chars, ≤ 200 entries, stored sorted by start.
  Plaintext (it is company policy, not a secret) — consistent
  with the rest of that file.
- **Pure geometry.** `findBlockingRange(leave, ranges)` and
  `isValidYmd(s)` are exported, side-effect-free helpers in
  `src/storage/org-settings.js`. Days-mode leaves test the
  `[start, end]` span; hours-mode leaves are intraday and test
  `start.slice(0,10)`. Lexicographic compare is correct for
  `YYYY-MM-DD`. The route owns the employer/sick *policy*; the
  helper is geometry only.
- **Calendar transport.** `GET /api/leaves/approved` now also
  returns `blockedRanges` (unchanged otherwise). Blocked ranges
  are company policy visible to everyone; only the employer can
  write them. No new endpoint.
- **Read resilience.** A hand-edited `org-settings.json` with
  malformed range entries does not crash the app — bad entries
  are dropped on read; the strict validator runs on write.

### Files touched

- `src/storage/org-settings.js` — `blockedRanges` default,
  `mergeOntoDefaults` filter, `cleanBlockedRanges` validator,
  exported `isValidYmd` + `findBlockingRange`.
- `src/routes/leaves.js` — block check in `POST /api/leaves`
  (employer/sick exempt); `blockedRanges` added to
  `GET /api/leaves/approved`.
- `public/settings.html` / `settings.js` / `settings.css` —
  blocked-days editor in the Organization card.
- `public/leaves-calendar.html` / `leaves-calendar.js` /
  `leaves-calendar.css` — cell hatch + tag, legend chip,
  details-panel row.
- `public/locales/en-US.js`, `pt-PT.js` — `errors.leave_day_blocked`,
  `calendar.blocked`, and 10 `settings.blocked*` keys per locale.
- `tests/test-leaves-blocked.mjs` — new suite, 24 cases:
  `isValidYmd`, `findBlockingRange` geometry (days/hours/edge),
  org-settings validation + sort + cap + hand-edit resilience,
  and route enforcement (employee blocked, sick allowed,
  employer allowed, outside-range allowed, hours-mode blocked).
- `tests/test-leaves-approved.mjs` — mock `orgSettingsStore.get()`
  updated to return `{ leaves: { blockedRanges: [] } }` (route
  now reads it).
- `public/sw.js` — `CACHE_VERSION` → `pica-cache-v36` (locale
  files are pre-cached; the changed `.css`/`.js`/`.html` for
  settings and calendar are NOT in `PRECACHE_URLS`).
- `package.json` — version `0.22.15`.

### What this does NOT do (Honest Disclosures)

- **Existing approved/pending leaves on a newly-blocked day are
  left untouched.** Blocking only refuses *new* bookings.
  Retroactively cancelling someone's already-approved vacation
  because the employer later added a block would be destructive
  and surprising; the employer can cancel specific leaves
  manually if they truly need to. The calendar will show both
  the amber block AND the pre-existing leave bar on such a day.
- **Approving a pending leave does not re-check blocked ranges.**
  The gate is at creation. If a leave was created before a range
  was added (so it slipped through) and is still pending, the
  employer approving it is an explicit human decision — they can
  see the block on the calendar. We did not add a second gate on
  approve to avoid a confusing "you can't approve this" state
  for the very person who set the policy.
- **No bulk/recurring blocks.** Each range is a single
  contiguous span. "Every Friday" or "the 1st of each month"
  must be entered as individual ranges. Recurrence rules were
  out of scope and add real complexity (timezones, end
  conditions) for a ≤50-employee tool.
- **The block is all-or-nothing per range.** There is no
  per-employee or per-team exception list, and no "soft" warning
  mode (like `concurrentAllowed`'s advisory banner). It is a
  hard refuse for non-sick employee bookings. Per-employee
  exceptions can be layered on later if asked.
- **Calendar colours are fixed (amber hatch).** They are not
  theme-variable-driven and not separately overridable, matching
  how the existing leave-type chips are coded. Contrast was
  checked for light and dark backgrounds but not formally
  WCAG-audited.
- **No audit event for editing blocked ranges.** The change
  rides the existing `settings.org_updated` audit record (the
  whole org patch is one event). A dedicated
  `leaves.blocked_changed` event was not added; the org-settings
  diff is recoverable from backups if ever needed.

---

## [0.22.14] — 2026-05-15 — Break time on the employer's "Working today" widget

### What's new

**The employer's home-page widget `widgets.workingToday` now
surfaces break time** per employee, appended to each row's
detail line when there's a break > 0:

- Currently working: `since 13:00 · pausa 1h 0m`
- Done for the day: `09:00–12:00, 13:00–18:00 · pausa 1h 0m`

Single-uninterrupted-session rows are unchanged. Total
worked-hours on the row aside is untouched. No layout change,
no new translation keys (reuses `punch.todayBreak` from
0.22.11).

This reverses the Honest Disclosure in 0.22.13 that left the
employer home widget without break — the user wanted parity
with the employee home widget.

### Files touched

- `public/index.js` — `renderWorkingTodayEmployer` calls
  `breakMsFromGroup(g)` (added in 0.22.13) and appends a
  `· {todayBreak}` segment to each row's detail when the
  helper returns a positive value. Both the "currently
  working" and "done for the day" sections get the same
  treatment.
- `public/sw.js` — `CACHE_VERSION` bumped to `pica-cache-v35`
  (index.js is pre-cached).
- `package.json` — version `0.22.14`.

### What this does NOT do (Honest Disclosures)

- **The aside (right-side total) does not split into
  worked + break.** It still shows the worked total only; the
  break sits in the detail line under the name. This keeps the
  visual hierarchy stable and matches the `/punches/today`
  page's "worked · pausa Xh" pattern.
- **No new tests.** Same algorithm as 0.22.13's
  `breakMsFromGroup`, already covered indirectly by the test
  suite for `totalBreakMs` (`tests/test-punch-totals.mjs`,
  6 cases). The "currently working" path adds the last
  closed-pair-out → open-in gap, which the helper already
  handles correctly and matches what `/punch` does for the
  same shape (open trailing session).
- **No backend change.** Display-only, derived from data the
  widget already fetches.

---

## [0.22.13] — 2026-05-15 — Break time on the dashboard widget + i18n for duration words

### What's new

**The "Today's hours" widget on the dashboard now shows the
employee's total break time** as a small caption line under the
big-number worked-hours figure, when there's break time to
show. Single-uninterrupted-session days look unchanged.

Layout (employee dashboard, when `brk > 0`):

```
8h 00m              ← .widget__bignum (unchanged)
Daily target: 8h    ← existing target / clocked-in caption
pausa 1h 0m         ← NEW (when break > 0); uses punch.todayBreak
```

**`formatDuration()` on the `/punch` page is now translated.**
Before this release, the punch-page header rendered strings
like `5 hours`, `1 hour`, `30 minutes`, `1 minute`, `less than
a minute` straight from JavaScript without going through i18n,
so the pt-PT locale leaked English. Three new translation
groups cover this:

- `punch.durLessThanMinute` (string)
- `punch.durMinutes` (plural: one / other) — "1 minute" /
  "{count} minutes" ↔ "1 minuto" / "{count} minutos"
- `punch.durHours` (plural: one / other) — "1 hour" /
  "{count} hours" ↔ "1 hora" / "{count} horas"

`Intl.PluralRules` picks the form per locale; both en-US and
pt-PT use `one` for 1 and `other` for everything else, which
matches the existing `punch.queueWaiting`/`punch.queueSynced`
pattern.

### How it works

`breakMsFromGroup(g)` in `public/index.js` mirrors the helpers
in `punch.js` and `punches-today.js`, but works against the
`{ pairs, openInPunch }` shape that `groupPunchesByEmployee()`
already builds: sum the gap between consecutive pairs' out/in,
plus the gap from the last closed pair's out to the
currently-open in if there is one.

`formatDuration()` in `public/punch.js` keeps the same branch
shape but now calls `t('punch.durLessThanMinute')`,
`tn('punch.durMinutes', n)`, and `tn('punch.durHours', n)`
instead of the hardcoded English strings. The compact `${h}h
${m}m` branch when both h and m are nonzero stays as-is —
those are number+unit-letter tokens, identical across locales,
already shared with the employer view's `humanDuration()`.

### Files touched

- `public/index.js` — `breakMsFromGroup(g)` helper;
  `renderTodayHoursEmployee` appends a `widget__caption` line
  with the break when `> 0`.
- `public/punch.js` — `formatDuration` switched to `t` / `tn`
  for the long-form duration phrases. `tn` was already imported
  at the top of the file.
- `public/locales/en-US.js`, `public/locales/pt-PT.js` — three
  new keys (`punch.durLessThanMinute`, `punch.durMinutes` plural,
  `punch.durHours` plural). pt-PT translations: "menos de um
  minuto", "1 minuto" / "{count} minutos", "1 hora" / "{count}
  horas".
- `public/sw.js` — `CACHE_VERSION` bumped to `pica-cache-v34`
  (`index.js`, `punch.js`, and both locale files are pre-cached).
- `package.json` — version `0.22.13`.

### What this does NOT do (Honest Disclosures)

- **The dashboard widget for employers (`widgets.workingToday`)
  does not show per-row break time.** The widget already
  renders one line per employee with their total today hours;
  adding break per row would crowd the layout. If an employer
  wants per-employee break, the dedicated `/punches/today` page
  shows it. Out of scope.
- **`humanDuration()` on the employer pages is still raw
  English-shape tokens (`8h 0m`).** Those `h` and `m` suffixes
  are short and conventionally untranslated in Portuguese
  timekeeping UIs (Pica's pt-PT locale uses the same letters
  elsewhere). If full translation is wanted later, that's a
  bigger rework — change the suffix in every place
  `${h}h ${m}m` appears across the codebase.
- **No new tests.** `breakMsFromGroup` is the same algorithm as
  `totalBreakMs` (already covered by
  `tests/test-punch-totals.mjs`); the `formatDuration` change
  is purely textual. `tests/test-i18n.mjs` was extended in
  spirit by the new pluralized keys but no new assertion was
  added — the existing plural-shape parity check catches any
  category mismatch automatically.
- **Stored punches in `data/` are not affected.** This is a
  display-only change. Existing audit log entries, exports, and
  CSV reports keep their wire formats.

---

## [0.22.12] — 2026-05-15 — Break time on the employer's "today" view

### What's new

**The employer's `/punches/today` page now shows per-employee
break time** next to the worked-hours total in each employee's
group header, matching what 0.22.11 added on the per-user
`/punch` page. When an employee has more than one session
today, the header reads, for example:

    Alice Example                    8h 0m · pausa 1h 0m

The break segment only appears when break time is > 0; an
employee with a single uninterrupted session sees the existing
`8h 0m` exactly as before. Sort order, group expansion, and
punch list rendering are unchanged.

The label uses the same `punch.todayBreak` translation key
introduced in 0.22.11 (en-US: "break {dur}"; pt-PT: "pausa
{dur}"), so the page is fully translated in both locales
without adding new keys.

### How it works

A new `breakMs(punches)` helper in `public/punches-today.js`
mirrors the helper added to `public/punch.js` in 0.22.11 — sums
out→next-in gaps. The two files keep their own copies on
purpose: each page is a self-contained ES module loaded
directly by the browser, and Pica has no shared frontend bundle
to import from. If a third surface needs the same math later
we'll factor a `/punch-totals.js` helper module, but two
copies is below the threshold where that pays off.

The compact `humanDuration()` already used on the page (`8h 0m`
/ `30m`) is reused for the break value, so the two segments
share one format on this page. The `/punch` page keeps its
existing chattier `formatDuration()` ("5 hours" / "1 hour") —
matching the page's larger header style rather than the
employer view's denser per-employee row.

### Files touched

- `public/punches-today.js` — `breakMs()` helper; `renderGroup`
  appends the break segment to the hours label when the helper
  returns a positive value. `humanDuration()` is unchanged.
- `package.json` — version `0.22.12`, releaseDate `2026-05-15`.

No `CACHE_VERSION` bump: `punches-today.js` is NOT in the
service worker's `PRECACHE_URLS` list (see `public/sw.js`).
The runtime network-first handler will refresh it on the next
navigation.

No locale files changed — the `punch.todayBreak` key from
0.22.11 covers both pages.

No new tests: the logic is byte-identical to the
`totalBreakMs()` already covered by `tests/test-punch-totals.mjs`
(6 cases). Adding a duplicate suite for the same algorithm
would only verify that copy-paste worked.

### What this does NOT do (Honest Disclosures)

- **Cross-employee total break is not summed.** The page has no
  "team total" line; if it did, summing breaks across employees
  would be misleading (one person's break is not the other's
  break). Out of scope.
- **Hours reports still don't surface break time.** Same as the
  0.22.11 disclosure — break is computable from the punch log
  if an operator wants it; baking it into the CSV adds a
  mostly-zero column for full-shift employees. Deferred until
  someone actually asks.
- **The two copies of the break helper will drift if one is
  changed without the other.** The risk is low — the algorithm
  is six lines and the test suite covers the shape. If/when a
  third caller appears, factor to a shared module.
- **The break value reflects only punches the server returned.**
  Offline punches that haven't yet drained from the per-user
  queue do not contribute to either worked or break time —
  same constraint as 0.22.11 and every prior page on this data.

---

## [0.22.11] — 2026-05-14 — Break time on the punch page

### What's new

**The punch page now shows total break time alongside total
worked time** when the employee has more than one session on the
same day. A "break" is the gap between an `out` punch and the
next `in` punch within today's list.

The today-total label in the "Today" section header now reads,
for the user's example case (in 09:00, out 12:00, in 13:00, out
18:00):

    8 hours / 8h · break 1 hour

The break segment only appears when break time is > 0; users
with a single uninterrupted session see the existing
`8 hours / 8h` exactly as before. Targets and the trailing
"open session counts up to now" behaviour are unchanged.

### How it works

A new `totalBreakMs(punches)` helper in `public/punch.js` mirrors
the existing `totalWorkedMs()` pairing logic, but instead of
summing in→out pair durations it sums out→next-in gaps. The
calculation is identical for the user's "morning + afternoon"
case (it does not assume any particular shift shape — three
sessions register two break gaps; an open trailing session
contributes zero break).

The translation key `punch.todayBreak` ("break {dur}" / "pausa
{dur}") was added to both locales. Existing keys and the
`fmtNumber`/`fmtHours` chain are untouched.

### Files touched

- `public/punch.js` — `totalBreakMs()` helper; `renderList()`
  appends the break segment to the today-total label when the
  helper returns a positive value.
- `public/locales/en-US.js`, `public/locales/pt-PT.js` —
  `punch.todayBreak` key.
- `public/sw.js` — `CACHE_VERSION` bumped to `pica-cache-v33`
  (pre-cached `punch.js` and `locales/*.js` both changed).
- `tests/test-punch-totals.mjs` — new suite (6 cases): the
  user's 9/12/13/18 example, single uninterrupted session, three
  sessions with two breaks, server-newest-first input ordering,
  open trailing session, and empty list. Follows the established
  pattern (`test-i18n.mjs` style) of re-implementing frontend
  functions inline because `public/*.js` uses absolute imports
  Node's resolver rejects.
- `package.json` — version `0.22.11`, releaseDate `2026-05-14`.

### What this does NOT do (Honest Disclosures)

- **Today's punches page (`/punches/today`, the employer's
  cross-employee view) does NOT show per-employee break time.**
  Only the per-user `/punch` page. The employer view groups by
  employee but only renders the punch list, not aggregated
  totals; expanding it would also need a column for break and is
  out of scope for this drop.
- **Reports do not surface break time.** The hours report still
  emits worked hours only. Break is computable from the punch
  log if an operator wants it; baking it into the CSV would add
  a column with mostly-zero values for full-shift employees and
  no clear acceptance criterion (does a 5-minute walk between
  buildings count? Pica can't know). Deferred until someone
  actually asks for it.
- **No backend change.** All math runs in the browser from the
  punches `/api/punches/today` already returns. No new API, no
  new storage. As a consequence: if a punch is queued offline
  and not yet replayed, it does not contribute to either worked
  or break time on the current page until the queue drains —
  same as before this change.
- **Negative or zero-length "breaks" are dropped silently.** If
  the punch log has anomalies (e.g. two `out` in a row with no
  intervening `in`, or an `in` chronologically before its
  preceding `out`), the helper treats the gap as 0 and moves on.
  This avoids surfacing negative numbers in the UI when data is
  inconsistent; the underlying log is unchanged.
- **The label uses a small dot separator (` · `) rather than a
  new line.** On very narrow mobile widths the today-total may
  wrap; the section header already handles wrapping (`align-items:
  baseline`) so this is fine but not gorgeous. If it becomes an
  issue, we can split into two stacked lines later.

---

## [0.22.10] — 2026-05-10 — Bugfix: punch-page map tile blocked by CSP

Patch release. Same-day as 0.22.9.

### What's fixed

**The OSM map preview on `/punch` renders again.** When the
M12.2 security headers shipped (0.20.0, 2026-05-09), the CSP set
`img-src 'self' data: blob:` — which blocks the `https://tile.openstreetmap.org`
URL the punch page uses for the map tile. The tile silently
failed to load in strict browsers and the user saw a broken
image where the map should be. The 0.22.9 release notes flagged
this as a pre-existing issue; 0.22.10 fixes it.

`img-src` is now `'self' data: blob: https://tile.openstreetmap.org`.
The map tile renders again. No other img-src origins were
added; the tile host is the only third-party image asset Pica
loads.

### Files touched

- `src/http/security-headers.js` — `img-src` directive extended.
  No other CSP directive changed; `connect-src` retains the
  Nominatim allowance from 0.22.9.
- `package.json` — version `0.22.10`.

No frontend files changed; no `CACHE_VERSION` bump is required.
The CSP header arrives fresh on every HTTP response and the
service worker doesn't intercept HTML pages.

### What this does NOT do (Honest Disclosures)

- **No regression test added.** The existing
  `test-security-headers.mjs` suite verifies the CSP shape but
  does not assert the specific `img-src` content; adding such an
  assertion would lock in a string the operator might
  legitimately want to extend (custom logo CDN etc.). The fix is
  verifiable by inspection. If a similar host-blocking
  regression happens again, the symptom (broken map tile) is
  visible to anyone opening the punch page on a real browser.
- **The third-party connection is a small additional privacy
  trade-off.** Each tile fetch reveals the rough geographic area
  to OSM (the tile coordinate is computed from the punch
  coordinate). This was the de-facto behaviour before strict
  browsers started honoring the CSP — the map was always trying
  to load from OSM. Documented in `docs/security.md`
  "Third-party connections".
- **Self-hosted OSM tile servers are not auto-discovered.**
  Operators who want to point at a different tile host (their
  own server, or a public alternative like CartoDB) must edit
  `public/punch.js`'s `mapTile.src` URL. No config setting is
  exposed for this; if it becomes a real need, follow-up.

---

## [0.22.9] — 2026-05-10 — Approximate addresses on punches (replacing raw lat/lng)

### What's new

**Punches now display an approximate address instead of raw
coordinates** wherever a `geo` field is rendered:

- Punch page → today's list ("Acme Office, Rua de Santa Catarina,
  Porto" instead of "41.1496, -8.6109")
- Punch page → map preview meta line under the OSM tile
- Today's punches page (`/punches/today`, employer view)

Coordinates remain visible **as the immediate fallback**: the
list renders coords first, then swaps to the address when the
reverse-geocode response arrives. If the request fails, times
out, gets rate-limited, or the device is offline, coordinates
stay — no error UI.

### How it works

`public/geocode.js` is a new browser-side helper that:

1. Rounds `(lat, lng)` to 4 decimal places (~11m precision) for
   the cache key — multiple punches at the same building share
   one cached label.
2. Reads from `localStorage` first (`pica-geocode:LAT,LNG`) with
   a 30-day TTL. Cache hit → instant return.
3. On miss, queues a fetch behind a 1.1-second throttle (a hair
   over Nominatim's stated 1 req/sec policy ceiling). Concurrent
   calls for the same key dedupe to a single in-flight promise.
4. Calls `https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&addressdetails=1&lat=…&lon=…`
   with `Accept-Language: <document.lang>` so labels come back
   in the user's locale when Nominatim has it.
5. Formats the response into a short label: landmark + street +
   locality, falling back to the first two chunks of
   `display_name`. Returns `null` on any failure; callers keep
   their coordinate fallback rendered.

CSP: `connect-src 'self'` was extended to allow
`https://nominatim.openstreetmap.org`. No other connect targets
are added; the Referer header on the request identifies the Pica
deployment to OSM, which is what their usage policy expects.

### Files touched

- `public/geocode.js` — new, ~125 lines, zero deps.
- `public/punch.js` — imports `reverseGeocode`; today's-list
  rendering and map-meta line both kick off async geocoding.
- `public/punches-today.js` — same wiring on the employer view.
- `src/http/security-headers.js` — `connect-src` extended with
  the Nominatim host plus a comment naming the trade-off.
- `public/sw.js` — `CACHE_VERSION` bumped to `pica-cache-v32`
  because `punch.js` is in the pre-cache list.
- `package.json` — version `0.22.9`.

No new tests; no test-suite count change. The frontend-imports
suite picked up the new `geocode.js` import sites and stayed
green at 54 checks.

### What this does NOT do (Honest Disclosures)

- **Privacy regression: each unique punch location reveals
  itself to a third party.** Coordinates leave the operator's
  browser and reach `nominatim.openstreetmap.org` (community
  OSM infrastructure) at least once per location, ever. The
  30-day localStorage cache means no repeat traffic for the
  same building, but the first punch at any new place sends a
  request. Operators who consider employee location data
  sensitive should either:
  (a) self-host a Nominatim instance and patch
      `NOMINATIM_BASE` in `public/geocode.js`, or
  (b) revert the feature by setting `geoSpan.textContent` to
      coords only and removing the `reverseGeocode` call site.
  A future drop could surface this as an org-settings toggle,
  but the feature was requested as the simplest "show address
  on punches" implementation; gating it adds scope.
- **No User-Agent identifying Pica.** Browsers don't allow
  setting `User-Agent` on `fetch`, so the request carries the
  browser's stock UA. Nominatim's policy says stock UAs from
  HTTP libraries can be blocked; in practice browsers tend to
  pass. If your deployment hits sustained blocks, the fallback
  is coordinates and operators see no breakage — just no
  upgrade to addresses. Self-hosted Nominatim is the proper
  fix.
- **Rate limit is single-instance per browser.** Two tabs open
  on the same machine could each fire ~1 req/sec, doubling the
  rate. Also the localStorage cache is per-origin per browser,
  so the cache doesn't share across users on the same site.
  Acceptable at the ≤50 employee scale; a server-side cache
  would fix both at the cost of putting Pica's server on the
  outbound-call hook (and complicating offline restore).
- **No backend involvement.** Geocoding is a pure-frontend
  feature. The encrypted `geo` payload on disk is unchanged;
  punches still store `{lat, lng, accuracy}` and never the
  resolved address. Decrypting old backups produces the same
  records as before. No data migration.
- **Address rendering is best-effort, not authoritative.**
  The label is a UX nicety; the punch's location-of-record
  remains the encrypted lat/lng. Two punches at the same
  building can render different labels if Nominatim updates its
  database between them, and a deliberately-misnamed building
  in OSM would mislead. Operators should not rely on the label
  for compliance-grade location auditing.
- **No address shows on the offline-replay path or in CSV
  exports.** Reports CSV export still includes lat/lng; the
  reports HTML view doesn't render `geo` per-punch yet, so
  there's nothing to upgrade there. Adding addresses to CSV
  would either require server-side geocoding (out of scope) or
  pre-resolving every cell client-side before export (slow and
  rate-limit-bound).
- **The pre-existing CSP hole on `img-src` and OSM tiles is
  unchanged.** The map tile request to `tile.openstreetmap.org`
  is technically blocked by `img-src 'self' data: blob:`. The
  tile may or may not render in your browser depending on how
  strictly the CSP is enforced. Fixing this is its own issue,
  flagged for follow-up.
- **Service-worker caching note.** Same as 0.22.1–0.22.8 —
  clients on the old `CACHE_VERSION` need the SW to reactivate
  before they pick up the new `geocode.js` and updated punch
  pages.

---

## [0.22.8] — 2026-05-10 — Time bank removed; "missing hours" replaces it

The "time bank" feature (approved unjustified corrections
accumulating as uncredited hours owed back to the employer) is
gone. The signal it tried to provide — "this employee is behind
on hours" — is now computed directly from punches as
`missing = max(0, scheduled - worked)` per period. The manual
correction workflow is unchanged: an employee who forgets to
clock can still file a correction with or without a
justification, and approval still materializes the in/out punches
the same way.

### What was removed

**Backend:**
- `correctionsStore.computeBank({ userId, asOf })` — gone.
- `GET /api/corrections/bank` — gone (404 from the router from
  this release on).
- `GET /api/corrections/bank/:userId` — gone.
- The `bankHours` field on the `GET /api/employees/:id/summary`
  response — gone.
- File-header comment blocks describing "Bank semantics" in
  `src/storage/corrections.js` and `src/routes/corrections.js`
  rewritten to match the new model.
- 9 bank-specific tests in `test-corrections.mjs` deleted; 2
  bank-related assertions in `test-employees-summary.mjs`
  replaced with missing-hours assertions.

**Frontend:**
- `public/punch.js` `refreshBank()` and the `#bank-line` DOM
  block on `punch.html` — gone. The "register manual time"
  link below the today list stays.
- `public/index.js` `renderBankSummaryEmployee()` and the
  `bank` widget from `buildEmployeeWidgets()` — gone. Employee
  dashboard now has 2 widgets (pending + today) instead of 3.
- `public/employee.js` + `employee.html` — bank widget on the
  per-employee summary page is replaced by **two** new widgets:
  "Missing this week" and "Missing this month" (per the user's
  preference).
- `public/correction.js` + `correction.html` — the "Bank impact"
  field on the correction-detail page is gone.
- `public/corrections.js` + `corrections.html` + `corrections.css`
  — the standalone time-bank card and the per-row "+Xh to bank"
  chip are gone, along with their CSS.
- `public/correction-new.js` + `correction-new.html` — the
  live "this will go to your time bank" warning callout is
  gone (the form no longer cares about justification for any
  bookkeeping reason).
- 19 bank-related i18n keys deleted from each locale file
  (`en-US.js`, `pt-PT.js`). Two confirm-dialog strings rephrased
  to drop bank language. One dashboard-card description trimmed.

### What's new

**Missing-hours signal** computed inline by every consumer that
needs it. Definition: `missing = max(0, scheduled - worked)` for
the relevant period. **Not** adjusted for approved leaves — an
employee on vacation will show as "missing" hours; the operator
is expected to cross-check the upcoming-leaves block.

- `GET /api/employees/:id/summary` now returns:
  - `week:  { from, to, hours, scheduled, missing }`
  - `month: { from, to, hours, scheduled, missing }` (new — was
    not in the response before)
  - The week/month period boundaries come from the existing
    `computePeriod(...)` helper. Month scheduled is
    `dailyHours × weekdays`, matching the team-hours convention.
- `GET /api/reports/team-hours` rows now include `missing` for
  each employee.
- Per-employee summary page shows two new widgets ("Missing this
  week" / "Missing this month") replacing the old bank widget.
  Caption shows `worked/scheduled` for context.
- Reports → Team overview gets a new "Missing" column. Cells
  with shortfall render in danger-red and bold; zero-shortfall
  cells render as a muted "—" so the eye finds the rows that
  matter.
- 5 new i18n keys per locale: `employee.summary.missingWeekTitle`,
  `missingMonthTitle`, `missingZero`, `missingExplain`,
  `reports.teamMissing`.
- 3 new tests: 1 in `test-employees-summary.mjs` (missing
  equals scheduled when no hours worked, plus the existing
  shape/week-shape tests now include `missing` in their
  must-have-keys lists), 2 in `test-reports-team.mjs` (missing
  exposed as a number, missing is 0 when worked ≥ scheduled).

### Files touched

- `src/storage/corrections.js`, `src/routes/corrections.js`,
  `src/routes/employees.js`, `src/routes/reports.js`
- `public/punch.js`, `public/punch.html`, `public/punch.css`
- `public/index.js`
- `public/employee.js`, `public/employee.html`
- `public/correction.js`, `public/correction.html`
- `public/corrections.js`, `public/corrections.html`,
  `public/corrections.css`
- `public/correction-new.js`, `public/correction-new.html`
- `public/reports.js`, `public/reports.html`, `public/reports.css`
- `public/locales/en-US.js`, `public/locales/pt-PT.js`
- `public/sw.js` — `CACHE_VERSION` bumped to `pica-cache-v31`
- `package.json` — version `0.22.8`
- `tests/test-corrections.mjs`, `tests/test-employees-summary.mjs`,
  `tests/test-reports-team.mjs`
- `docs/architecture.md` — "Time bank" section rewritten as
  "Missing-hours signal"
- `docs/security.md` — comment in encryption table updated

Test totals: 23 suites, 575 tests (was 582; net -7 from
removing 9 bank-specific corrections tests, plus +2 in
reports-team, plus shape changes in employees-summary that net to
0). Existing reports DST flake unrelated; remains.

### What this does NOT do (Honest Disclosures)

- **Manual corrections themselves are unchanged.** Create,
  approve, reject, cancel, materialize-as-punches — all the
  workflow stays. An approved correction still puts in/out
  punches in the punch ledger, and `hoursReport` reads those
  punches like any other clock event. The user's request was
  explicit: "make sure you keep the manual corrections in case
  someone forgets to register in time, dont change any of that."
- **The `isJustified` derived field stays on each correction
  record** for any UI that wants to show whether a correction
  carried a reason. It has no functional consequence anymore —
  the bank was the only consumer. Tests still exercise it.
- **Justification text remains optional.** This is a deliberate
  carry-over: someone forgetting to clock is the canonical use
  case, and forcing a justification would just train people to
  type "forgot" every time. The approval-confirmation dialog
  for unjustified corrections still exists, just rephrased to
  drop the bank wording.
- **Missing hours does NOT subtract approved leaves.** Vacations
  show as missing hours. Documented inline in the
  `src/routes/employees.js` summary endpoint header and in the
  team-hours route. Adding leave-aware adjustment is plausible
  follow-up work; the user explicitly said this signal is about
  punches, not leaves. Operators are expected to cross-check the
  upcoming-leaves block alongside.
- **The dashboard "on leave today" widget didn't exist for
  employees** (it was always employer-only via
  `buildEmployerWidgets`). Removing the bank widget from
  employee dashboard takes that view from 3 widgets to 2 — the
  layout still works, but the visual rhythm is slightly
  different. Acceptable; future drops can add a third widget if
  one becomes load-bearing.
- **No data migration.** Historical corrections data on disk is
  unchanged; the encrypted NDJSON files keep their event
  streams. Anyone who decrypts a backup created before 0.22.8
  will see records that look identical to what 0.22.8 emits;
  the difference is purely in what the running system COMPUTES
  from those records.
- **The roadmap's M8d "Time bank" checkmark stays where it is.**
  The roadmap is a historical record of what shipped per
  milestone; we don't rewrite history. The 0.22.8 release entry
  is the canonical record of when the feature was retired.
- **The `correction.confirmApproveBothUnjust` translation
  string was rephrased** but the dialog still fires when an
  employer approves an unjustified `kind=both` correction. The
  old wording said the hours would go to the employee's time
  bank as compensation owed; the new wording just notes the
  hours will be added to the employee's worked-hours record.
  Operators using the existing reverse-approval flow get
  similarly rephrased copy.
- **Service-worker caching note.** Same as 0.22.1–0.22.7 —
  clients on the old `CACHE_VERSION` need the SW to reactivate
  before they pick up the new locale strings, the new HTML
  templates, and the deleted bank-related assets. Deleted bank
  endpoints would otherwise show as 404 in old clients still
  trying to fetch them; the rollover is the same as for any
  other release.

---

## [0.22.7] — 2026-05-10 — Calendar gets a tap-to-expand day-details panel

### What's new

**The team calendar is now readable on mobile.** Previously, the
≤600px breakpoint hid `cal-bar__name` to fit, leaving phone users
with colored stripes they could only identify via the legend at
the bottom of the page. The user could see *that* someone was on
leave but not *who*, *what type*, or *over what range*.

A new details panel lives between the grid and the legend. Tap
any day cell with leaves on it and the panel opens, showing each
leave on that day as a row with name, type, range, and a link
through to the leave detail page (when the viewer is owner or
employer). Tap the same day again to close, tap a different day
to switch, tap the × button to dismiss. Month navigation
(prev/next/today) closes the panel.

The panel works on every viewport, but it's the primary read
surface on mobile where bars collapse to colored pills with no
text. On mobile the panel auto-scrolls into view after opening.

### Anonymized rows respected

When an employee views the calendar, other employees' leaves
arrive from `/api/leaves/approved` with `anonymized: true`,
`type` stripped, names stripped (per the 0.22.4 privacy model).
The details panel renders these as italic "Unavailable" rows
with the date range only, non-clickable. Self leaves and any
leaves an employer can see render fully, with a link to the
leave detail page.

### How taps are routed

The grid uses delegated click handling on `.cal-grid`. Bars on
desktop keep their direct `<a href="/leaves/:id">` navigation;
the cell handler bails when the click landed on a `.cal-bar`.
On mobile the bars carry `pointer-events: none` (CSS), so every
tap inside a cell falls through to the cell handler — even if
the user's finger lands on a colored pill. This keeps the mobile
behaviour single-purpose: tap = open details.

The currently expanded day gets a `.cal-day--selected` outline so
it's obvious which day the panel is describing. Re-rendering the
month (after navigation) clears `selectedDateStr` and closes the
panel — the panel is always coherent with what's displayed.

### Files touched

- `public/leaves-calendar.html` — new `<section id="cal-details">`
  between the grid and the legend, with title heading, close
  button, and an empty `<ul>` populated by JS.
- `public/leaves-calendar.js` — new `openDetailsForDate()`,
  `closeDetails()`, `paintSelectedHighlight()`, `renderDetailRow()`,
  and `formatRange()` helpers; delegated click handler on
  `.cal-grid`; `selectedDateStr` state; `data-date` attribute on
  every cell. Imports `fmtDate` from `/i18n.js` for locale-aware
  date formatting in the panel header and per-row meta.
- `public/leaves-calendar.css` — new `.cal-details*` styles, new
  `.cal-day--selected` outline highlight; mobile bars get
  `pointer-events: none` and cells get `cursor: pointer` +
  `-webkit-tap-highlight-color`.
- `public/locales/en-US.js` and `pt-PT.js` — new
  `calendar.detailsClose` aria-label string.
- `public/sw.js` — `CACHE_VERSION` bumped to `pica-cache-v30`
  (locale files are pre-cached).
- `package.json` — version `0.22.7`.

No backend changes. No new test files; the existing `i18n` and
`frontend-imports` suites pick up the new strings and the
`fmtDate` import. Total: 23 suites, 580 tests (unchanged count;
`frontend-imports` ticked from 53 → 54 to reflect the new import
check, but the suite stays at the same total visible to the
counter).

### What this does NOT do (Honest Disclosures)

- **No keyboard navigation for the panel.** Arrow-key navigation
  between days, escape-to-close, focus management on tap — none
  of that is wired up. The panel works fine via mouse and touch,
  but a keyboard-only user has to tab through the grid to reach
  a day, then tab to the close button. A future drop could add
  proper roving tabindex and Escape handling. Not blocking for
  the mobile-readability fix, which was the actual ask.
- **The mobile cell visual is unchanged.** Bars still render
  inside cells as tiny colored stripes (with `pointer-events:
  none`). I considered swapping them for a row of dots or count
  pills but chose to keep the existing visual — it's consistent
  with desktop and operators are used to it. If multiple leaves
  stack in a small cell the result still looks dense; the
  details panel is the read surface, not the cell itself.
- **No swipe-to-navigate between months on mobile.** Prev/next
  buttons are the only way. Adding a swipe gesture would mean
  pulling in (or hand-rolling) a touch-tracker; out of scope.
- **No deep link to a specific date.** The URL doesn't change
  when a day is selected, and reloading the page closes the
  panel. Could be added with a URL hash (`/leaves/calendar#2026-06-15`)
  but introduces edge cases (cross-month, invalid dates) that
  weren't worth handling for this drop.
- **The `aria-live="polite"` announcement on the panel is
  best-effort.** Most screen readers will read the new content
  on tap, but the timing depends on the SR's settings. Verified
  by inspection only; no SR testing was done.
- **Empty days don't show "no leaves" feedback.** Tapping a day
  cell with no leaves silently closes the panel rather than
  saying "No leaves on this day." Decided that the absence of a
  visible bar in the cell already signals "nothing to see here"
  and an empty card would just add clutter. Reasonable people
  could differ.
- **Service-worker caching note.** Same as 0.22.1–0.22.6 —
  clients on the old `CACHE_VERSION` need the SW to reactivate
  before they pick up the new HTML/CSS/JS and locale strings.
  The HTML and CSS changes are not pre-cached so they'll arrive
  fresh; only the locale bump forces the cache-version rev.

---

## [0.22.6] — 2026-05-10 — Profile fields are now mandatory (except comments)

### What's new

**Every profile field except `comments` is now required.** The
list (`MANDATORY_FIELDS` in `src/storage/employees.js`):

- `fullName`
- `dateOfBirth`
- `position`
- `address`
- `contactEmail`
- `contactPhone`

`comments` remains optional (it's an employer-only free-text
field used for HR notes).

### Where it's enforced

- **Frontend** — `required` attribute on the inputs in both
  `public/employee-new.html` and `public/employee-profile.html`.
  Native HTML5 validation catches the most common case before any
  network request.
- **Backend on `create` (POST `/api/employees`)** — every
  mandatory field must be present and non-empty. Missing or
  whitespace-only values are rejected with `400 missing_required_field`.
- **Backend on `update` (PUT `/api/employees/:id`)** — only
  validates fields that are *included* in the patch. A patch that
  sets `contactEmail = ''` is rejected; a patch that simply
  doesn't mention `dateOfBirth` is fine. This is the migration-
  friendly variant: pre-existing profiles with empty fields don't
  block unrelated updates.

The error carries `errorCode: 'missing_required_field'` and a
message naming the missing field. The frontend translates the
code via the new `errors.missing_required_field` i18n key
("Please fill in all required fields." / "Por favor preencha
todos os campos obrigatórios.").

### Files touched

- `src/storage/employees.js` — new `MANDATORY_FIELDS` export,
  `isEmptyValue()` helper, `makeMissingFieldError()`, and
  validation in both `create()` and `update()`.
- `src/routes/employees.js` — `POST /api/employees` and
  `PUT /api/employees/:id` map `err.code === 'missing_required_field'`
  to a clean 400. Other error paths unchanged.
- `public/employee-new.html` — `required` on the six mandatory
  inputs. `comments` left optional.
- `public/employee-profile.html` — same.
- `public/employee-profile.js` — `applyPermissions()` now also
  drops `required` from the readonly fields when an employee is
  viewing their own profile (otherwise an empty pre-existing
  `position` from before this rule shipped would block save).
  Save handler switched to `translateError(...)` so the new
  errorCode renders.
- `public/employee-new.js` — same translateError switch.
- `public/locales/en-US.js` and `pt-PT.js` — new
  `errors.missing_required_field` string.
- `public/sw.js` — `CACHE_VERSION` bumped to `pica-cache-v29`
  (locale files are pre-cached).
- `package.json` — version `0.22.6`.
- `tests/test-employees.mjs` — 6 new tests in a new
  "Mandatory fields (0.22.6)" section. Total: 34 passing in this
  suite.

Test totals: 23 suites, 580 tests (was 572).

### What this does NOT do (Honest Disclosures)

- **Existing profiles with empty mandatory fields are NOT
  retroactively migrated.** `update()` only rejects when the
  patch *sets* a mandatory field to empty. A profile that
  predates this release with an empty `dateOfBirth` stays empty
  until someone explicitly fills it in. Pragmatic — the
  alternative would block every save until everyone updates
  every field, which is a worse UX than the inconsistency.
  Operators who want a hard sweep can run a one-time scan; not
  in scope here.
- **`update()` on a non-existent id still creates a partial
  profile.** This is the existing contract used in tests
  (`update on non-existent id creates the profile`). In the
  current routing, only `POST /api/employees` reaches
  `create()`, and that path *does* enforce all-mandatory.
  `PUT /api/employees/:id` only fires after the user exists, and
  the profile typically already exists too. The non-existent-id
  case is a storage-layer leniency that production routes don't
  exercise. Tightening it would require migrating fixtures and
  is deferred.
- **Field-format validation is not added.** `contactEmail` only
  needs to be non-empty — we don't validate it parses as an
  email. The HTML5 `type="email"` input enforces a basic shape
  client-side; the server doesn't. Same for `contactPhone` —
  any non-empty string passes. Tightening would need to handle
  international phone formats, plus-prefixes, etc.
- **No errorCode-with-field-name interpolation.** The translated
  message is the generic "Please fill in all required fields."
  The server-side English message includes the offending field
  name, so anyone reading the API directly or the network tab
  can see it; translated UI users get the generic message and
  rely on the HTML5 `required` highlight to find the missing
  field. Acceptable trade-off; future drop could thread the
  field name through `translateError(code, fallback, params)`.
- **No audit log entry.** Employee profile edits aren't audited
  (existing rule — only sensitive operations like
  `employee.created`, `password.reset_by_employer`, etc. are).
  Required-field validation doesn't change that.
- **Service-worker caching note.** Same as 0.22.1–0.22.5 —
  clients on the old `CACHE_VERSION` need the SW to reactivate
  before they pick up the new HTML attributes and locale strings.

---

## [0.22.5] — 2026-05-10 — Vacation carry-forward with annual MM-DD expiry

Implements the carry-forward feature that has been a stub in
`org-settings.json` since M7. Unused approved vacation from year
N-1 now rolls into year N's available balance, and an operator-
configurable expiry date drops it back to zero each year.

### What's new

**`leaves.carryForwardExpiresAt` setting (MM-DD, applied annually).**
Default `'03-31'` (typical Portuguese-EU convention). The operator
sets it once in Settings → Organization; it applies to every year
without manual updates. Validation rejects malformed strings,
months outside 01–12, and days that don't exist in the configured
month using a non-leap-year reference (so `02-29` is rejected to
ensure the expiry triggers every year).

**`computeBalances()` actually carries vacation now.** Previously
the `carryForward` toggle stored a value but no logic consumed it
(see the "Carry-forward is deferred" comment that just got
deleted). The new logic:

1. For year N being queried, sum **approved** vacation days for
   the user in year N-1. Pending year-N-1 leaves are ignored —
   they reduce N-1's booked total only when they get approved,
   so the carry naturally re-computes.
2. `unused = max(0, baseAllowance - prevBooked)` — never
   negative, capped at the base.
3. Compare `now` to `${year}-${MM-DD}` (end of day). Before the
   cutoff, carry counts; on or after midnight the day after, it
   drops to 0.
4. Result fields per balance row:
   - `allowance` — base (unchanged meaning)
   - `carryIn` — vacation only; 0 for other types and unlimited (allowance=0) types
   - `effectiveAllowance` — `allowance + carryIn`
   - `remaining` — `effectiveAllowance - pending - booked` (semantics changed; was `allowance - pending - booked`)
   - `carryExpiresAt` — `YYYY-MM-DD` of the next expiry, or `null`

**`wouldExceedCap()` uses effective allowance.** The leave-create
flow already calls this at request time and again at approve time;
both paths now correctly accept bookings up to `effectiveAllowance`
when carry-in is active.

**UI surfaces.** Settings page gets a text input next to the
existing carry-forward checkbox (`MM-DD` pattern, default
`03-31`). Leaves balance table shows carry as a green
"+5" badge next to the base allowance with a tooltip naming the
expiry date. The employer balance matrix shows
`remaining / effectiveAllowance` so the cap visible to managers
matches the cap actually enforced.

### Files touched

- `src/storage/org-settings.js` — new field in defaults + merge +
  `cleanCarryExpiresAt` validator; rejects `02-29` and other
  impossible-every-year dates.
- `src/storage/leaves.js` — extended `computeBalances` (new
  optional `now` arg, carry computation, new return fields);
  `wouldExceedCap` now uses `effectiveAllowance` and accepts
  `now` for testability.
- `public/settings.html` + `public/settings.js` — new MM-DD input
  wired into `renderOrg` and the save patch.
- `public/leaves.js` — balance table renders carry-in badge and
  the employer matrix uses effective allowance.
- `public/leaves.css` — new `.balance-cell--carry` style.
- `public/locales/en-US.js` and `pt-PT.js` — three new strings:
  `settings.carryExpiresLabel`, `settings.carryExpiresHint`,
  `leaves.carryTooltip`. Existing `settings.carryForwardLabel`
  retitled to "Unused vacation carries over to next year" (was
  "Unused allowance…") to reflect the vacation-only scope.
- `tests/test-leaves-carry.mjs` — new suite, 11 tests covering
  basic accumulation, pending-N-1 ignored, MM-DD expiry timing,
  type scope (vacation only), unlimited bypass, the
  `carryForward: false` switch, `remaining` math, and
  `wouldExceedCap` integration.
- `tests/test-org-settings.mjs` — 3 new tests for the
  `carryForwardExpiresAt` validator.
- `public/sw.js` — `CACHE_VERSION` bumped to `pica-cache-v28`
  (locale files are pre-cached).
- `package.json` — version `0.22.5`, releaseDate `2026-05-10`.

Test totals: 23 suites, 572 tests (was 22 / 558). Existing
suites unchanged; the new fields don't disturb any earlier
expectation because they default to 0 / null when no
previous-year data exists.

### What this does NOT do (Honest Disclosures)

- **Pro-rated allowances are not modeled.** A new hire whose
  contract started halfway through year N-1 has the same base
  allowance applied retroactively when computing what they
  could have used. If their actual entitlement was prorated,
  carry-in over-counts. This is a labour-policy gap, not a
  Pica concern — operators using prorated entitlements should
  set `perEmployeeOverrides[userId].vacation` to the prorated
  number and accept that historical computation is approximate.
- **Allowance changes mid-year are not retroactive.** Carry-in
  is computed against the *current* `defaultAllowances.vacation`
  (or override) — not the value that was in effect during year
  N-1. If an employer raises everyone's allowance from 22 to 25
  in December, the next-year carry uses 25 as the prev-year
  base. This is the simpler choice and matches how many
  payroll systems behave; it's not necessarily what every legal
  framework expects. Documented here so operators know to
  re-confirm balances after any allowance change.
- **No grace period or partial expiry.** Carry-in is binary:
  active up to and including the configured `MM-DD`, zero
  thereafter. Operators wanting "carry expires 50% on March 31
  and the rest on June 30" need to revisit the design.
- **`02-29` is rejected by the validator** so the expiry
  triggers every year. Operators who want late-February expiry
  should pick `02-28`. February 29 of leap years would let the
  expiry not fire in 75% of years.
- **Past years now show carry=0 retroactively.** Querying year
  2024's balance in 2026 returns `carryIn: 0` because the
  expiry at `2024-03-31` has long passed. The historical
  reality (Jan–March 2024 had carry from 2023) is lost in the
  current view. A future drop could surface "carry-while-it-was-
  active" as a separate field for historical accuracy. Not in
  scope here.
- **No audit log entry for the setting change.**
  `settings.org_updated` already logs which top-level keys
  changed; the value of the new MM-DD is not captured. Matches
  existing behaviour for `defaultAllowances` etc.
- **No backend route changes.** The privacy contract for
  `/api/leaves/balances` and `/api/leaves/balances/:userId`
  carries forward — employer sees all rows, employee sees only
  their own. The new fields are exposed identically.
- **Service-worker caching note.** Same pattern as 0.22.1–0.22.4
  — clients on the old `CACHE_VERSION` need the SW to
  reactivate before they pick up the new locale strings and
  settings markup. The backend changes apply immediately on
  server restart.
- **The roadmap's "annual carry-forward" checkmark on M7 is
  now actually true.** Previously the toggle was stored but
  unused; now it does what the M7 entry advertised. The 0.22.5
  release notes are the canonical record of when the feature
  actually shipped.

---

## [0.22.4] — 2026-05-09 — Privacy: employees no longer see other employees' leave details

Patch release. Same-day as 0.22.3.

### What's new

**Approved-leave visibility is now role-aware.** `GET /api/leaves/approved`
previously returned name, type, dates, and ids for every approved
leave to every authenticated user — including employees viewing
each other through the team calendar. From 0.22.4:

- **Employers** still see full data (name, type, dates) for every
  approved leave. Unchanged.
- **Employees** see full data for their OWN approved leaves; for
  everyone else's leaves, the response includes only `id`,
  `start`, `end`, `unit`, and `anonymized: true`. The fields
  `employeeId`, `username`, `fullName`, `type`, `reason`, and
  `notes` are stripped server-side.

The team calendar (`/leaves/calendar`) is still accessible to
employees but renders other people's leaves as generic "someone is
unavailable on this day" capacity blocks (new
`.cal-bar--anonymized` style: greyish striped pattern, italicized
label "Unavailable" / "Indisponível"). Employees can still plan
around team capacity without learning who is on what kind of leave.

The dashboard "on leave today" widget is unaffected: it was
already employer-only (in `buildEmployerWidgets`, never built for
employees). No new widget for employees.

### Files touched

- `src/routes/leaves.js` — `/api/leaves/approved` handler
  branches on `req.user.role`; non-employer callers get
  anonymized records for everyone but themselves.
- `public/leaves-calendar.js` — `renderBar()` recognizes
  `leave.anonymized` and renders a non-clickable generic block.
- `public/leaves-calendar.css` — new `.cal-bar--anonymized` style.
- `public/locales/en-US.js` and `pt-PT.js` — new
  `calendar.anonymized` string ("Unavailable" / "Indisponível").
- `tests/test-leaves-approved.mjs` — new route-level suite, 4
  tests, brings the total to 22 suites / 558 tests.
- `public/sw.js` — `CACHE_VERSION` bumped to `pica-cache-v27`
  (locale files are pre-cached).
- `package.json` — version `0.22.4`.

### What this does NOT do (Honest Disclosures)

- **No timing-attack defense.** An employee can still infer that
  Bob is on leave on a given week by counting anonymized blocks
  per day and correlating with Bob's silence on chat. The change
  bounds *what the API hands out*, not what an observer can
  reconstruct from social signals. Acceptable at the ≤50 employee
  scale — Pica is not a privacy-anonymization tool, just an
  internal time tracker tightening identity exposure.
- **The leave `id` is still revealed.** The frontend needs *some*
  stable per-leave key for calendar rendering. UUIDs are
  unguessable so revealing them isn't a meaningful additional
  leak vs. the start/end/unit. A future drop could substitute a
  per-day capacity counter instead of per-leave ids if that
  becomes a concern.
- **Direct GETs of `/api/leaves/:id` are unchanged.** That route
  uses `requireOwnerOrEmployer`, so an employee fetching another
  employee's leave id directly still gets 403. But if an attacker
  knows or guesses an id (which the calendar still surfaces),
  they don't gain access — the per-record endpoint already
  enforces the rule. No regression.
- **`/api/leaves` (the personal list) was already correct.** Line
  117 of `src/routes/leaves.js` already filtered by
  `employeeId === req.user.id` for non-employers. No change there.
- **`/api/leaves/balances`** is employer-only;
  `/api/leaves/balances/:userId` already enforces self-or-employer.
  No change.
- **No backend audit-log entry.** Reads aren't audited (existing
  rule, see `docs/security.md`). The privacy upgrade is enforced
  by the route handler, not surfaced as an audit event.
- **Service-worker caching note.** Same as 0.22.1–0.22.3 —
  clients on the old `CACHE_VERSION` need the SW to reactivate
  before they pick up the new locale strings. The backend change
  takes effect immediately on server restart regardless.

---

## [0.22.3] — 2026-05-09 — Bugfix: leave-submit error swallowed when allowance exceeded

Patch release. Same-day as 0.22.2.

### What's fixed

**The leave-new submit handler now actually shows the server's
error message.** When `POST /api/leaves` returned a non-OK
response — most commonly `400 leave_cap_exceeded` after the user
ran out of annual allowance — the frontend tried to call
`result.translateError(data.errorCode, data.error)`. Two errors
on one line:

1. `translateError` is imported from `/i18n.js`, not a method on
   the `postJson` result object.
2. `data` was never defined in the handler's scope; it should
   have been `result.data`.

The expression threw `TypeError: result.translateError is not a
function`, which bubbled out of the async `submit` handler. The
default browser behaviour for an unhandled rejection in a form
submit handler is to log to the console and do nothing visible.
The user saw the submit button stuck on "Submitting…" with no
error message — the punch payload was rejected, but the UI had
no idea.

The line now matches the canonical pattern used in
`punch.js`, `login.js`, and `correction-new.js`:

```js
const msg = translateError(
  result.data.errorCode,
  result.data.error || t('leaveNew.couldNotSubmit'),
);
showMessage(messageEl, msg, 'error');
```

`errors.leave_cap_exceeded` was already in both locale
dictionaries — the message "This leave would exceed your
allowance." now actually reaches the user.

### Why localhost couldn't reproduce it

Pedro's dev account had plenty of unused allowance, so submits
never hit `leave_cap_exceeded`. The bug only fires when the
server returns an error of any kind. Anyone testing on a fresh
install with a small allowance would have hit it; the production
report came from a real user running into their cap.

### Files touched

- `public/leave-new.js` — fixed the `translateError` call site
  and added a fallback string. The handler now also reaches its
  `setBusy(submitBtn, false)` line, so the button unsticks.
- `public/locales/en-US.js` — added `leaveNew.couldNotSubmit`
  ("Could not submit leave request").
- `public/locales/pt-PT.js` — added the parity entry
  ("Não foi possível submeter o pedido de férias").
- `public/sw.js` — `CACHE_VERSION` bumped to `pica-cache-v26`
  because the locale files are pre-cached.
- `package.json` — version `0.22.3`.

### What this does NOT do (Honest Disclosures)

- **No regression test.** The bug was a single broken line in a
  frontend handler that doesn't have a `node:test` equivalent —
  testing the submit handler against real fetch/translateError
  semantics would need M13 (Playwright). The `frontend-imports`
  static suite catches missing imports but not call-shape errors
  like calling `translateError` as a method on the wrong object.
  This whole class of bug is exactly what M13 will start to catch.
- **No audit of other call sites.** The canonical pattern is
  unambiguous — `translateError(result.data.errorCode,
  result.data.error || t('fallback'))` — and the other pages I
  spot-checked (`punch.js`, `login.js`, `correction-new.js`) use
  it correctly. A full sweep across every postJson caller in
  `public/*.js` is plausible cleanup but out of scope here.
- **No new errorCode coverage.** The existing
  `errors.leave_cap_exceeded` and `errors.leave_overlaps` strings
  in the dictionaries are what the user sees. If the backend
  surfaces a new errorCode that has no `errors.<code>` entry,
  `translateError` falls back to the second argument
  (`result.data.error`, the English server message) — graceful
  degradation, not localized.
- **No backend change.** `src/routes/leaves.js` was already
  emitting `errorCode: 'leave_cap_exceeded'` correctly. The
  frontend was just discarding it.
- **Service-worker caching note.** Same as 0.22.1 / 0.22.2 —
  clients on the old `CACHE_VERSION` need the SW to reactivate
  before they pick up the new locale files.

---

## [0.22.2] — 2026-05-09 — Punch click no longer blocks on geolocation

Patch release. Same-day as 0.22.1.

### What's fixed

**Clock-in/out is now non-blocking on geolocation.** The previous
implementation called the thorough `getGeo()` on every click, which
on a desktop without a usable location source (no GPS, no Wi-Fi
triangulation) burned its full budget — 15 s low-accuracy timeout
plus a 20 s high-accuracy fallback — before resolving null and
letting the punch proceed. From the user's perspective the button
sat at "Working…" for up to 35 seconds and the punch felt broken,
even though it would have eventually succeeded.

The click path now:

1. Reuses the in-session `lastFix` when one exists (the page-load
   bootstrap, the Retry button, or a previous successful punch
   already populated it). No new geolocation call. Instant.
2. Otherwise calls a new `getGeoFast()` with a **3-second hard
   budget** and a single low-accuracy attempt. The browser's own
   `maximumAge: 300_000` lets it return a recently-cached fix
   without firing the platform backend at all.
3. Otherwise punches with `geoSkipReason` set and no `geo`. The
   server already accepts this — backend behaviour is unchanged.
4. If a session has already failed once (`geoFailedThisSession()`
   sentinel), the click skips step 2 entirely. Subsequent clicks
   are instant. The user can still click "Retry location" to clear
   the sentinel and try again with the thorough timeout.

The thorough `getGeo()` (35 s, two-attempt) stays for the page-load
map preview and the explicit Retry button — both contexts where the
user is not blocked on the result.

### About the "force browser to re-prompt" question

Browsers do not allow programmatic re-prompting once a user has
blocked geolocation for a site — this is a platform security
boundary, not a Pica decision. Once denied, the only path to
re-enable is for the user to open the browser's site-permissions UI
manually (typically the lock/info icon in the address bar). Pica
correctly detects the denied state via the standard error callback
and tags the punch with `geoSkipReason: 'denied'`; surfacing
browser-specific re-enable instructions could be added later.

### Files touched

- `public/punch.js` — added `getGeoFast()`; rewired `doPunch()` to
  prefer cached / fast / no-geo. Existing `getGeo()` and Retry button
  unchanged.
- `public/sw.js` — `CACHE_VERSION` bumped to `pica-cache-v25`
  because `punch.js` is pre-cached.
- `package.json` — version `0.22.2`.

### What this does NOT do (Honest Disclosures)

- **No tests added.** Geolocation-on-click is browser-mediated and
  not exercised by any current `node:test` suite. The change is a
  scoped frontend rewire; verification is by hand on a desktop where
  geolocation legitimately fails (the original repro — open the
  punch page over plain HTTP / on a desktop with no location
  source). Tests-as-coverage would need M13 (Playwright).
- **No browser-permissions UI hint.** When a user has permanently
  blocked location, we do not yet surface a "click here to re-enable"
  prompt with browser-specific instructions. The "Retry location"
  button is still the entry point; it will simply re-fire and report
  "Location permission denied" if blocked. A future drop could detect
  the `denied` state via `navigator.permissions.query({name:'geolocation'})`
  and show a clearer message — out of scope here.
- **Reused `lastFix` ages with the session.** A user who clocks in
  at 09:00 and clocks out at 17:00 from a different physical
  location will have both punches stamped with the 09:00 fix unless
  the user re-triggers Retry. Acceptable at the ≤50 employee scale —
  the location field is an approximate where-stamp, not a precise
  audit. If location-per-punch becomes important, drop the session-
  cache reuse and accept the 3 s budget on every click instead.
- **3 s budget can miss a slow-but-eventually-good fix.** A device
  on a slow Wi-Fi triangulation step might return a fix at 4 s. The
  click path discards it; the next page navigation's bootstrap
  `getGeo()` will pick it up. Acceptable trade-off — the user's
  primary signal is "punch happened fast", not "punch had geo".
- **No backend change.** `geo` and `geoSkipReason` were already
  optional (validated in `src/routes/punches.js`). The fix is purely
  client-side.
- **Service-worker caching note.** Same as 0.22.1 — clients on the
  old `CACHE_VERSION` need the SW to reactivate (close all tabs or
  reload twice) before they see the new `punch.js`.

---

## [0.22.1] — 2026-05-09 — Bugfix: "View my profile" sent employees home

Patch release. Same-day as 0.22.0. No new features.

### What's fixed

**Employees can now reach their own profile from the topbar menu.**
The "View my profile" item in the avatar menu (and the `/profile`
redirect) used to point at `/employees/<id>`, which serves the
employer-only summary page. The summary endpoint
(`GET /api/employees/:id/summary`) is gated by `requireRole('employer')`,
so the page-level fetch returned 403 and `public/employee.js` bounced
the browser back to `/`. Net effect: an employee clicking their own
"View my profile" landed on the home dashboard, not their profile.

The fix routes both entry points to `/employees/<id>/profile` — the
profile editor at `public/employee-profile.html`, whose API
(`GET /api/employees/:id`) uses `requireOwnerOrEmployer` and so
accepts owner self-reads. Employers retain access; employees stop
bouncing.

### Files touched

- `public/topbar.js` — menu link `/employees/${user.id}` →
  `/employees/${user.id}/profile`. (Pre-cached SW asset; see below.)
- `src/routes/pages.js` — `GET /profile` redirect target updated.
- `public/sw.js` — `CACHE_VERSION` bumped to `pica-cache-v24`
  because `topbar.js` is in the pre-cache list. Without the bump,
  installed clients would keep serving the old bundled menu link
  from cache.
- `package.json` — version `0.22.1`.

### What this does NOT do (Honest Disclosures)

- **No tests added.** The bug was a routing wiring mistake. There
  is no existing test that mounts `topbar.js` against a fake
  session and follows the menu link, and adding one would mean
  re-implementing topbar's DOM construction in Node (per the
  frontend-tests-don't-import-frontend rule). The fix is verifiable
  by inspection: `topbar.js:210` and `pages.js:118` now name the
  same path that `public/employee.js:114` already used for the
  summary page's "Go to profile" button. If a future Playwright
  suite (M13) lands, this should become a one-line nav assertion.
- **No change to the summary page itself.** Employer-only
  `/employees/:id` (the dashboard-style summary) keeps its current
  RBAC and UX. The bug was only in *which* link took users there.
- **The bug was reachable in 0.16.4–0.22.0.** That's the entire
  window since the profile editor was split out from the summary
  page (introduced as `/employees/:id/profile`). All employees on
  affected versions saw the bounce-to-home; the fix is a one-line
  redirect retarget per location.
- **No security implications.** Both old and new targets enforce
  authentication and ownership at the API layer; the bug was
  purely a UX dead-end. No data was exposed, leaked, or written
  in error.
- **Service-worker caching note.** Clients on 0.22.0 will pick up
  the new menu link only after the SW reactivates with the new
  `CACHE_VERSION`. The standard SW lifecycle (close all tabs, or
  reload twice) applies. Operators worried about a slow rollout
  can advise users to do a hard reload once.

---

## [0.22.0] — 2026-05-09 — M12 Drop 4: input validation + number formatting

Closes M12. The deployment guide originally planned for "Drop 4"
has been pulled out into M14 (its own milestone, will ship last).

This drop is a maintenance release, but it patches a **real
path-traversal vulnerability** discovered during the audit, so
the security implications outweigh the modest visible scope.
See **Security advisory** below for the disclosure.

### What's new

**Locale-aware hour formatting.** Hours now render with the user's
locale's decimal separator: `8.5` in en-US, `8,5` in pt-PT. Two new
helpers in `public/i18n.js`:
- `fmtNumber(n, opts)` — locale-aware number formatting via
  `Intl.NumberFormat`. Falls back to `String(n)` on non-finite or
  Intl-unavailable.
- `fmtHours(n)` — specialized helper. Integer hours render as
  integers (`8`), fractional values get one decimal (`8.5`).
  Returns empty string on NaN/Infinity for clean UI behavior.

11 hour-display call sites across 5 frontend files migrated from
ad-hoc `Math.round(h * 10) / 10` and `.toFixed(1)` to `fmtHours()`:
`employee.js`, `index.js`, `leave.js`, `leaves.js`, `reports.js`.

**Length caps on free-text fields.** `leave.reason` and `leave.notes`
(employer reject) now cap at 500 chars at the storage layer, matching
the existing convention from `punch.comment`,
`correction.justification`, and `correction.notes`. The 5 MB body
cap at the HTTP layer is the upper bound; without storage caps,
maximum-size submissions could bloat encrypted ledgers without
forensic value.

**New `src/util/validators.js`.** Currently exports `isUuid()` —
strict RFC 4122 v4 UUID matching. Used as a defense-in-depth gate
on `:id` URL parameters.

**`rejectIfBadId(req, res)` route-layer helper** in
`src/routes/employees.js`. Called at the top of all 8 `:id`-taking
employee handlers; returns 400 with `errorCode: invalid_id`. Storage
layer (`src/storage/employees.js`) re-validates ids in
`profilePath()` and `picturePath()` as a safety net.

### Security advisory — path traversal in employee picture upload

**Affected versions:** Pica 0.16.4 through 0.21.0 inclusive.
**Fixed in:** 0.22.0.
**Severity:** Medium. Authenticated employer required.
**CVE:** Not assigned (Pica is small enough not to participate in MITRE).

**Description:**
The `PUT /api/employees/:id/picture` endpoint computed disk paths
via `path.join(empDir, id + '.picture')`. Because the URL router
calls `decodeURIComponent` on captured `:id` segments, an
authenticated user with the `employer` role could send a request
with `id = '..%2F..%2F<name>'` and write attacker-controlled bytes
to `<name>.json` and `<name>.picture` files outside the data
directory.

A live proof-of-concept against 0.21.0:
```
curl -X PUT -F 'picture=@evil.jpg' \
  https://pica.example/api/employees/..%2F..%2Fmarker/picture
```
created `pica/marker.json` and `pica/marker.picture` (one level
above `pica/data/employees/`, in the project root).

**Impact:**
- An employer could write controlled file content under any
  directory reachable via `path.join` from `data/employees/`.
- Use to fill disk (DoS) or stage payloads for other tools running
  on the same host.

**Limitations on impact:**
- Read-side endpoints already required the file to exist at the
  resolved path AND to be a Pica-encrypted blob with the right
  AES-GCM AAD; they do not enable arbitrary-file reading.
- The fixed `.json` / `.picture` suffix prevented overwriting
  unrelated files (Pica's own data files have different shapes).
- RBAC was always enforced; this was not a privilege-escalation
  vulnerability.
- Bog-standard non-employer users are not affected. The
  `requireOwnerOrEmployer((req) => req.params.id)` gate was the
  effective filter.

**Discovery:** internal review during M12 Drop 4 work. Not known to
have been exploited.

**Fix in 0.22.0:**
1. Route layer: `rejectIfBadId(req, res)` runs at the top of every
   `:id`-taking handler in `src/routes/employees.js`. Returns 400
   `invalid_id` for any `:id` that isn't a valid UUID v4.
2. Storage layer: `src/storage/employees.js` `profilePath()` /
   `picturePath()` throw on bad ids; `exists`/`hasPicture`/`remove`
   /`deletePicture` silently return "doesn't exist" on bad ids
   (graceful for queries, loud for writes).

**Verification:** the same exploit `curl` against 0.22.0 returns
400 `invalid_id` with no file written.

**Operator action required:** none beyond upgrading. No data
migration; no config change. Restart the server after upgrade.
If your install was run in a multi-employer environment (more than
one trusted user with the `employer` role) and you have reason to
suspect malicious activity from one of them, audit your project
directory for unexpected `.json` or `.picture` files outside
`data/employees/`. Routine single-employer installs are not at
practical risk.

### Files touched
- **New:** `src/util/validators.js` — `isUuid()`.
- **New:** `tests/test-validators.mjs` — 15 tests covering accepted
  inputs (`crypto.randomUUID()` output, well-formed v4 case-insensitive)
  and the rejection envelope (path traversal characters, URL-encoded
  forms, all-zero, v1, bad variant nibble, length, non-hex,
  whitespace-padded).
- `src/routes/employees.js` — `isUuid` import; `rejectIfBadId` helper
  defined at the top of `registerEmployeeRoutes`; the helper is
  invoked at the top of all 8 handlers that take `:id`.
- `src/storage/employees.js` — `isUuid` import; `profilePath()` and
  `picturePath()` throw on bad ids; `exists`, `hasPicture`, `remove`,
  `deletePicture` silently no-op on bad ids.
- `src/storage/leaves.js` — `reason` and reject `notes` capped at
  500 chars before encryption.
- `public/i18n.js` — `fmtNumber()` and `fmtHours()` exports.
- `public/employee.js`, `public/index.js`, `public/leave.js`,
  `public/leaves.js`, `public/reports.js` — `fmtHours` import added,
  11 ad-hoc rounding sites migrated.
- `tests/test-i18n.mjs` — 7 new tests for fmtNumber/fmtHours covering
  en-US/pt-PT decimal separators, integer/fractional rendering,
  negatives, NaN/Infinity, and big-number grouping.
- `tests/test-leaves.mjs` — 4 new tests for the length caps:
  truncation at 500, exact-500 verbatim, short verbatim, reject
  notes truncation.
- `tests/test-employees.mjs` — fake-id fixtures replaced with valid
  UUIDs (now that storage validates).
- `tests/test-employees-summary.mjs` — same fixture cleanup, plus
  `workingTime`/`bank`/`profiles` map-key fixes.
- `public/sw.js` — `CACHE_VERSION` bumped to `pica-cache-v23`.
- `package.json` — minor bump to 0.22.0.
- `docs/architecture.md` — `src/util/validators.js` in layout,
  `tests/test-validators.mjs` in test list, count to 554.
- `docs/security.md` — new "Input validation" section with the
  path-traversal advisory.
- `docs/roadmap.md` — M12 Drop 4 ✅ (combining input validation +
  numfmt under one drop). Deployment guide pulled out to M14
  (its own milestone, ships last).

### Tests
- 21-suite regression: **554 passing, 0 failing** (was 528).
  Increase of 26 = 7 (i18n) + 4 (leaves length caps) + 15
  (validators).
- Live exploit smoke: `..%2F..%2Fmarker` PUT to picture endpoint
  returned `200 ok` and created files outside dataDir on 0.21.0.
  Same request returns `400 invalid_id` and creates nothing on
  0.22.0.
- Frontend regression: 50 `test-frontend-imports` checks pass —
  every page that imports `fmtHours` declares the import correctly,
  no orphan `toFixed` calls remain in hour-display contexts.

### Honest disclosures

- **The advisory is honest about scope.** This was a real bug in a
  shipped version. The right thing is to be loud about it in the
  release notes, not bury it. Operators reading this who have run
  ≤0.21.0 in a multi-employer environment with adversarial trust
  assumptions should audit. Single-employer installs are not at
  practical risk because the only person able to exploit was
  themselves.
- **No credit acknowledgement section** because no external party
  reported this — found during internal audit. Listing it under
  "discovered by ourselves" reads like a humblebrag, so it just
  goes in the disclosure section.
- **The fix is conservative.** UUID v4 validation rejects any
  legacy id that wasn't generated by `crypto.randomUUID()`. Pica
  has only ever used `crypto.randomUUID()`, so all real ids match.
  If a future code path needed to accept other id formats, the
  validator would need a more permissive option — not a problem
  today.
- **Other stores were audited and found OK.** `leaves`,
  `corrections`, `punches`, `backups` use ids only as record keys
  inside NDJSON files keyed by year/month — they never flow into
  `path.join(dir, id + suffix)`. Bad ids return clean 404s from
  `findById()`. No additional UUID validation needed.
- **Length caps are 500 chars, possibly tight for some users.** A
  real "explain why I'm taking medical leave" reason might want
  more than 500 chars. The 500-char limit matches existing
  conventions and is what UI elements were already designed
  around. Operators who need longer reasons can patch the limit
  in a fork; lifting it generally would require revisiting
  storage-bloat trade-offs.
- **`fmtHours` rounds at the half-tenth boundary** using
  JavaScript's `Math.round(n * 10) / 10`. So `8.05` rounds to `8.1`
  in some implementations and `8` in others (banker's rounding).
  Forensically not significant — hour displays are user-facing
  approximations; raw values are stored as-is in the underlying
  records.
- **Frontend imports of `fmtHours` are now imported per-page.**
  No tree-shaking is possible without a build step; each page
  pulls in the whole `i18n.js` module. Acceptable — `i18n.js` is
  already on the critical path for every authed page.
- **The empty-string return for non-finite hours** (NaN/Infinity)
  means a UI cell may render as `"h"` or `" h"` instead of e.g.
  `"NaN h"`. Visually ambiguous but matches the convention in the
  rest of the app where missing data is "blank" rather than a
  diagnostic message. A future drop could add explicit "—" or "no
  data" handling at the UI level.
- **Path-traversal tests don't include integration tests** that
  actually run the server and try to exploit. The unit tests in
  `test-validators.mjs` cover the validator; the live smoke during
  development confirmed the route + storage chain. A future M13
  E2E suite (Playwright) could add a regression test that hits the
  endpoint with the exploit payload and asserts 400.
- **The `00000000-...-000000000000` all-zero UUID is rejected.**
  Strictly speaking this could be a valid v4 (vanishingly improbable
  collision) but `crypto.randomUUID()` will never produce it, so
  rejecting it tightens the validator without affecting real users.
  If this ever causes a false negative (e.g. a backup contains an
  all-zero id from some imported source), the validator can be
  loosened.
- **Number formatting now goes through `Intl.NumberFormat`.** This
  uses the runtime's CLDR data, which can change minor formatting
  details across browser versions (e.g. the thousands separator in
  pt-PT may be U+00A0 or U+202F depending on the engine). The tests
  in `test-i18n.mjs` use a tolerant regex (`1[^0-9]234,57`) rather
  than pinning the exact character, on purpose.
- **The audit log gained no new event types in this release.** A
  better UX would be to record `password.self_change` failures
  due to length-cap rejection, etc., but those are UI-correctable
  user errors, not access-level events. M12 Drop 3 documented this
  policy and it still applies.

---

## [0.21.0] — 2026-05-08 — M12 Drop 3: audit log

Sensitive operations are now recorded in an encrypted append-only
log. The "what happened, when, by whom" forensics ledger that was
mentioned in the threat model since day one finally exists.

### What's new

**Encrypted NDJSON audit log** at `data/audit/<yyyy>/<mm>.ndjson.enc`:
- Per-line AES-256-GCM encryption (each record gets its own IV)
- Base64-encoded, one record per line
- Monthly rotation
- AAD `pica-audit-v1` binds records to this format version

**14 sensitive event types wired:**

| Event | Source |
|-------|--------|
| `setup.completed` | First-run admin creation |
| `auth.login_success` | Successful login (notes mustChangePassword=true if applicable) |
| `auth.login_failure` | Failed login (target = attempted username; no actor) |
| `auth.logout` | Logout (uses verifySession to read user info best-effort) |
| `password.self_change` | Self-service change (success + wrong-current-password failure) |
| `password.reset_by_employer` | Employer-initiated reset |
| `employee.created` | New employee |
| `employee.deleted` | Employee deletion |
| `leave.decision` | Approve / reject / employer-cancel |
| `correction.decision` | Approve / reject |
| `settings.org_updated` | Org settings update (records changed keys, not values) |
| `backup.created` | Manual backup creation |
| `backup.deleted` | Backup deletion |
| `backup.restore` | Restore (success + failure with errorCode) |

### Record shape

```json
{
  "ts": "2026-05-08T18:30:42.123Z",
  "event": "leave.decision",
  "actorId": "uuid-of-employer",
  "actorUsername": "admin",
  "actorRole": "employer",
  "actorIp": "192.168.1.10",
  "target": { "leaveId": "uuid", "employeeId": "uuid" },
  "outcome": "success",
  "details": { "decision": "approved", "type": "vacation", "start": "2026-06-01", "end": "2026-06-03" }
}
```

### What's NOT logged

- Reads. Logging every `GET /api/employees` would swamp the file.
- Punch in/out. Punches are their own append-only log.
- Self-cancellation of one's own pending leave. Routine user action.
- 403 denials (RBAC, mustChangePassword block). Goes to regular log.
- Self-service password changes that failed validation (too short, etc.).
- Settings changes for branding/working-time overrides — not access-level.

### Restore semantics

Restore audits land in the **post-restore** audit log (a fresh entry
in the restored install's log). The OLD audit log moves with the
old `data/` to `data.pre-restore-<ts>/`. This means:
- A future investigator on the restored install sees a record of
  HOW the install was restored (who, when, from where, how many entries).
- The pre-restore audit log is preserved on disk in the snapshot folder
  and can still be read with the masterKey.

### Failure semantics

Audit writes are best-effort. A disk error during append doesn't
fail the user-facing request — the audit module catches the error,
returns false, and emits it via the regular logger at ERROR level.
The alternative ("can't audit, so deny") is too brittle for a
small-team self-hosted app.

### Files touched
- **New:** `src/storage/audit.js` — `createAuditStore({dataDir, masterKey, logger, now})`
  with `appendRecord()`, `readMonth()`, `listMonths()`. Plus
  `auditContext(req)` helper.
- `server.js` — instantiates auditStore, threads it into 6 route registrations.
- `src/routes/setup.js` — audits `setup.completed`.
- `src/routes/auth.js` — audits 4 events. Added `verifySession` import for
  the unauthenticated logout path.
- `src/routes/employees.js` — audits 3 events.
- `src/routes/leaves.js` — audits 1 event with 3 decision variants.
- `src/routes/corrections.js` — audits 1 event with 2 decision variants.
- `src/routes/settings.js` — audits `settings.org_updated`.
- `src/routes/backups.js` — audits 3 events.
- **New:** `tests/test-audit.mjs` — 17 tests covering append/read,
  encryption properties (per-record IV, wrong-key rejection, tamper
  detection), listMonths, error paths, constructor validation.
- `public/sw.js` — `CACHE_VERSION` bumped to `pica-cache-v22`.
- `package.json` — minor bump to 0.21.0.
- `docs/architecture.md` — audit.js + test in layout, count to 528.
- `docs/security.md` — new "Audit log" section between Backups and SW.
- `docs/roadmap.md` — M12 Drop 3 ✅, Drop 4+ planned.

### Tests
- 20-suite regression: 528 passing, 0 failing (was 511; +17 new in
  test-audit.mjs).
- Live end-to-end smoke decrypted 14 records covering all wired
  event types; per-record IV verified (same plaintext → different
  ciphertext); wrong-key fails loudly; single-line tampering throws
  with the line number.

### Honest disclosures

- **No viewer UI.** Reading audit logs requires the masterKey and a
  Node REPL. A future drop should add `/api/audit/recent` (employer-only)
  + a viewer page. For now, `docs/security.md` documents the decrypt
  recipe.
- **`actorIp` is the socket address.** Behind a reverse proxy, this is
  always `127.0.0.1`. We don't currently trust `X-Forwarded-For`
  because that requires configurable trusted-proxy lists. If you need
  real client IPs in the audit log, log them at the proxy.
- **Audit failures are silent to the user.** A disk-full state means
  the operation succeeds but no audit entry is written. Operators
  monitoring logs will see ERROR messages from the regular logger.
  Compliance regimes that require "no audit, no operation" semantics
  would need a different design (probably write-then-act); Pica's
  threat model doesn't go there.
- **No log rotation by size, only by month.** A pathological abuser
  triggering a million failed logins in May would balloon
  `2026/05.ndjson.enc` without splitting. Acceptable for the
  expected scale; adding size-based rotation is straightforward later.
- **No retention/cleanup.** Audit logs grow forever. A future drop
  could add a configurable retention (default: keep forever). Not
  doing it now because deleting audit history defeats the point;
  operators with disk pressure can manually archive old months.
- **Settings update only logs changed top-level keys, not values.**
  This was deliberate — settings can include long company text or
  policy notes that don't belong in audit logs. The trade-off:
  forensic value of "which knob was turned?" without "what did you
  change it from?". Good enough for now.
- **No before/after diffing for any event.** "Alice's role was
  changed from employee to employer" would be valuable but Pica
  doesn't actually have a role-change endpoint (employees are
  delete-and-recreate). If/when role mutations exist, the audit
  schema can be extended.
- **Per-line encryption means slightly larger files than whole-file
  encryption** (each line carries its own 12-byte IV + 16-byte tag,
  ~28 bytes overhead per record). Worth it for append efficiency
  and partial-corruption isolation.
- **The audit log itself is a target.** An attacker with write access
  to `data/audit/` can corrupt records (which `readMonth` will
  detect and throw on) but cannot forge new records without the
  masterKey. A sophisticated attacker with masterKey + write access
  CAN forge entries; the integrity property is "either-undetectably-tampered
  OR genuine-from-Pica", not "definitely-untampered". Stronger
  guarantees (signed records, append-only filesystems, external WORM
  storage) are out of scope.
- **Login attempts that hit the rate limiter are NOT audited.** They
  go to the regular logger but not the audit log — would be
  high-volume noise during a sustained attack. If you're getting
  rate-limited, the regular logs already tell you that.

---

## [0.20.0] — 2026-05-08 — M12 Drop 2: security headers + CSP

Pica was already careful about XSS — `textContent` everywhere we
build DOM, no `innerHTML` with user data, no `eval`, no inline event
handlers. This drop adds defense-in-depth headers so a future bug
or a third-party-service compromise can't escalate.

### What's new

**Five security headers on every response:**

| Header | Value | Purpose |
|--------|-------|---------|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'sha256-…'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` | Locks down where scripts/styles/images can come from |
| `X-Content-Type-Options` | `nosniff` | No MIME sniffing |
| `X-Frame-Options` | `DENY` | Belt-and-braces for `frame-ancestors` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Don't leak full URLs |
| `Permissions-Policy` | `geolocation=(self), camera=(), microphone=(), payment=(), usb=(), interest-cohort=()` | Allow geolocation (clock-in needs it), deny everything else |

**`Strict-Transport-Security` conditionally** — only when running with
`NODE_ENV=production` AND the request carries `X-Forwarded-Proto: https`
(typical behind a TLS-terminating reverse proxy). Setting HSTS over
plain HTTP would upgrade-pin clients to HTTPS even if the deployment
doesn't have it; the conditional guard prevents that surprise.

### CSP design

The CSP forbids `'unsafe-inline'` for both scripts and styles. The
single inline script in every Pica HTML page — the theme bootstrap
that runs synchronously before CSS to prevent a flash of unstyled
content — is allowed via a SHA-256 hash. The hash is **computed at
server startup** by reading the canonical script from `index.html`,
so future bootstrap edits don't require manual hash updates.

### Cross-file invariants enforced by tests

`tests/test-security-headers.mjs` now verifies, across every HTML file:

- Exactly one inline `<script>` per page
- All bootstrap scripts are byte-identical (so a single CSP hash
  covers all 19 pages)
- Zero inline event handlers (`onclick=`, `onsubmit=`, etc.)
- Zero `style=""` attributes
- Zero `<style>` elements

Any future PR that violates these breaks tests *before* anyone runs
the server and hits a CSP violation in the browser console.

### Bootstrap normalization

Five HTML files had a slightly longer bootstrap (extra explanatory
comments in the script body) than the other 14. Normalized to a
single canonical version so one CSP hash covers everything.

### Inline styles migrated

Two pages had `style="margin-top: var(--gap-3);"` / `--gap-5`
attributes. Replaced with `.mt-3` / `.mt-5` utility classes added
to `app.css`. CSP can now refuse `'unsafe-inline'` for `style-src`
without breaking layout.

### Files touched
- **New:** `src/http/security-headers.js` — `computeBootstrapHash()`,
  `createSecurityHeaders({ publicDir, isProduction })` returning
  the per-request applier.
- `server.js` — imports + constructs the applier at startup, calls
  it at the top of every request handler before any route runs.
- 15 of 19 HTML pages — bootstrap script normalized to the canonical
  short form (3 lines of comment removed).
- `public/punch.html` + `public/setup.html` — inline `style=""`
  attributes replaced with class names.
- `public/app.css` — added `.mt-3` and `.mt-5` utility classes.
- **New:** `tests/test-security-headers.mjs` — 13 tests (9 unit + 4
  cross-file invariants).
- `public/sw.js` — `CACHE_VERSION` bumped to `pica-cache-v21`.
- `package.json` — minor bump to 0.20.0.
- `docs/architecture.md` — added security-headers.js to layout, new
  test to test list, count to 511.
- `docs/roadmap.md` — M12 Drop 2 marked ✅, Drop 3+ planned.

### Tests
- 19-suite regression: 511 passing, 0 failing (was 498; +13 new in
  test-security-headers.mjs).
- Live smoke verified: every page returns 200 with full headers,
  bootstrap script in served HTML hashes to exactly the value
  advertised in the CSP header on `/`, `/preferences`, `/login`.

### Honest disclosures

- **HSTS preload is NOT included.** The header sets `max-age` and
  `includeSubDomains` but omits `preload`. Submitting a domain to
  the browser preload list is a one-way commitment that's hard to
  reverse — it should be an operator decision, made explicitly,
  not hidden inside a release. If you want to preload, edit the
  header.
- **No `report-uri` / `report-to` directive.** CSP violations are
  silent in this drop. Adding a reporting endpoint means storing
  reports somewhere, deciding what to do with them, and dealing
  with the inevitable noise from browser extensions. Worth doing
  later, not now.
- **`X-Forwarded-Proto` is trusted blindly.** A misconfigured
  reverse proxy (or absence of one) means a malicious client could
  spoof the header and trigger HSTS in dev, or never trigger it
  in prod. Documented in `docs/security.md`. Operators should
  ensure their proxy strips client-supplied `X-Forwarded-Proto`
  before forwarding, which Caddy does by default and nginx does
  with the right config (the Drop 4 deployment guide will cover
  this).
- **The CSP hash is computed from `index.html`, not all 19 pages.**
  The cross-file invariant test guarantees they match — but if
  someone disables that test and edits a different page's
  bootstrap, the runtime CSP would block the page silently. The
  test is the safety net.
- **No `Cross-Origin-Embedder-Policy` / `Cross-Origin-Opener-Policy`
  / `Cross-Origin-Resource-Policy` headers.** These enable
  cross-origin isolation (required for `SharedArrayBuffer`, etc.)
  and Pica doesn't need any of them. Adding them prematurely
  would constrain future feature work without measurable benefit.
- **The Permissions-Policy uses `interest-cohort=()` to opt out of
  FLoC.** FLoC is essentially dead (Chrome moved to Topics API,
  which doesn't honor the same opt-out). The directive is
  harmless and self-documenting; included for completeness.
- **`form-action 'self'` is set, but Pica doesn't use HTML form
  submissions for state changes** — every form is intercepted by
  JS and submitted via `fetch()`. The directive is therefore
  belt-and-braces; if a regression turned a button into a real
  form submission to a third-party origin, the directive would
  block it.
- **The `connect-src 'self'` will need updating if Pica ever
  fetches from an external API.** Today it doesn't. If Drop 4's
  deployment guide ever recommends a CDN for icons or fonts,
  this directive needs widening. Followed by `font-src` if fonts
  are loaded from elsewhere.
- **CSP errors won't show up in unit tests.** Browsers enforce
  CSP, Node doesn't. The cross-file invariants are the next-best
  thing — they catch the patterns that *would* trip CSP. A real
  E2E browser test (M13) is what would actually exercise the
  enforcement; for now we manually verified key pages.

---

## [0.19.0] — 2026-05-03 — M12 Drop 1: password change/reset

The "Reset password" button on the employee summary page has been
disabled with a "coming in a future release" tooltip since 0.16.4.
This release activates it, and adds matching self-service flow.

### What's new

**Self-service password change** — `/change-password` page, also
linked from a button in `/preferences`. User enters current + new +
confirm. On success the session cookie is reissued so they stay
logged in; other sessions on other devices are invalidated.

**Employer-initiated reset** — `/employees/:id` summary page, "Reset
password" button now opens a modal. Employer types a new temporary
password, employee gets it out-of-band (in person, secure chat).
On the employee's next login they're redirected to `/change-password`
and locked out of every other page until they change it.

**Forced-change flow:**
- Pages — every authenticated route except `/change-password`
  redirects to `/change-password` when `mustChangePassword=true`
- API — every endpoint except `/api/me`, `/api/me/password`, and
  `/api/logout` returns 403 with `errorCode: must_change_password`
- Login response now carries `mustChangePassword: true|false` so
  the frontend knows to redirect

**Session invalidation by password change** — sessions issued before
`passwordChangedAt` are rejected by the auth middleware. Other devices
get logged out automatically; the device that did the change gets a
fresh cookie carrying the new `iat` timestamp. Brute-force from a
stolen session is no more useful than from no session.

### New endpoints

| Method | Path                                       | Purpose                          |
|--------|--------------------------------------------|----------------------------------|
| POST   | `/api/me/password`                         | Self-service change              |
| POST   | `/api/employees/:id/password-reset`        | Employer-initiated (employer only) |

Both are rate-limited per user-id (5 attempts/hour) to slow brute-force
on the current password and to slow attempts to spam reset across
many accounts.

### Storage layer additions

`usersStore` got two new methods (already present in the codebase as
scaffolding from a previous drop, now wired through):

- `setPassword(userId, newPassword, { mustChange })` — stamps
  `passwordChangedAt` and `mustChangePassword`. Used by the
  employer-reset flow.
- `verifyAndSetPassword(userId, currentPassword, newPassword)` —
  checks current before setting new. Always clears
  `mustChangePassword`. Used by self-service.

Both throw with `.code` so routes can forward to `errorCode`.

### Session changes

`signSession()` now puts a millisecond `iat` in the payload. Older
session cookies (without `iat`) are treated as `iat=0` so any
password change kills them; new password change rotates everyone
out cleanly.

### Files touched
- `src/auth/sessions.js` — `iat` added to payload (millisecond
  precision so it can be compared against `passwordChangedAt`).
- `src/auth/rbac.js` — session rejection by `passwordChangedAt`,
  plus `mustChangePassword` allowlist on `requireAuth`.
- `src/routes/auth.js` — login response carries `mustChangePassword`,
  `/api/me/password` reissues the session cookie on success.
- `src/routes/employees.js` — `/api/employees/:id/password-reset`
  was scaffolded in a prior release; this release wires it to the
  rest of the flow.
- `src/routes/pages.js` — `authed()` redirects to `/change-password`
  when `mustChangePassword=true`; `/` handler picks up the same
  redirect; new `/change-password` page route bypasses it via
  `allowMustChange: true`.
- **New:** `public/change-password.html` + `public/change-password.js`
  — the forced + voluntary change page. Doesn't mount the topbar
  (forced-mode users have nowhere to go).
- `public/locales/en-US.js` + `pt-PT.js` — 33 new keys per locale
  (12 changePassword.*, 7 employee.summary.resetPw*, 11 prefs.*,
  2 errors.*: `cannot_reset_self`, `must_change_password`). 2
  obsolete "coming soon" keys removed.
- `tests/test-auth.mjs` — 11 new tests covering setPassword,
  verifyAndSetPassword, iat-based session invalidation, and the
  mustChange API allowlist.
- `public/sw.js` — `CACHE_VERSION` bumped to `pica-cache-v20`.
- `package.json` — minor bump to 0.19.0.
- `docs/roadmap.md` — M12 split into drops; Drop 1 ✅, Drops 2-5
  planned, M13 (E2E tests) pulled out.
- `docs/architecture.md` — repo layout updated, test count to 498.

### Tests
- 18-suite regression: 498 passing, 0 failing (was 484; +11 auth,
  +3 frontend-imports picking up the new module).

### Honest disclosures

- **Sub-millisecond race in session invalidation.** If a password
  change and a freshly-signed cookie land in the exact same
  millisecond, the comparison `iat < passwordChangedAt` is false
  and the cookie survives. The reissue inside `/api/me/password`
  always lands AFTER the `setPassword` call (ms is monotonic in
  practice on every modern system) so the user's own session
  survives correctly. The race only affects "did I successfully
  invalidate every other device's session immediately?" — answer:
  in practice yes, in theory there's a sub-millisecond gap that
  attackers can't exploit but pedants can point at. Acceptable.
- **No "forgot password" flow.** Pica has no email infrastructure.
  If a user forgets their password, an employer must reset it for
  them. If the *only* employer forgets their password, recovery
  is manual (edit `users.json` directly, restart). Documented in
  `docs/security.md` as a known limitation.
- **Old session cookies without `iat` survive any password
  change.** They have `iat=0`, which is older than any
  `passwordChangedAt`, so they get rejected. ✓ Actually this works
  — false alarm.
- **Rate limiter is in-memory**, so a process restart resets the
  counters. Acceptable for the threat model (resetting takes
  effort, attackers can't trigger restarts).
- **The forced-change banner is shown on the change-password page
  itself.** A user who navigates manually to `/change-password`
  voluntarily ALSO sees the banner (we check `mustChangePassword`
  via `/api/me`). If the flag is false, the banner stays hidden.
  Correct; just clarifying.
- **Employer reset doesn't generate a random password.** The
  employer types one. This is the simpler UX (the employer can
  pick something the employee will recognize as theirs to type
  once before changing). A "generate random + show once" mode
  could be added; not in scope here.
- **Self-reset is forbidden via the employer endpoint.** The
  employer can't `POST /api/employees/<own-id>/password-reset` —
  returns `cannot_reset_self`. Forces them to use the regular
  self-service flow, which requires the current password (more
  secure: a stolen employer session can't reset its own password
  without knowing the current one).
- **The `/api/me/password` rate limiter is keyed by user-id, not
  IP.** Means a user in an open office can't be locked out by
  someone else on the same IP brute-forcing a different account.
- **No password complexity requirements beyond "≥8 characters".**
  Same as before this drop. Adding zxcvbn-style complexity scoring
  is its own ergonomic-vs-secure debate; deferred.
- **Password reset doesn't log the old password's hash anywhere.**
  Once changed, the old hash is overwritten. Audit log work
  (Drop 3) won't include old hashes either — auditing should record
  *that* a change happened, not enable forensic recovery of the
  old password.
- **Modal scaffolding was already present in `employee.html` and
  `employee.js` from a previous drop.** I re-verified everything
  and added translations + the `cannot_reset_self` error code, but
  the structural HTML/JS for the modal wasn't new in this release.
  Mentioned for honesty about effort distribution.

---

## [0.18.0] — 2026-05-03 — M11 Drop 2: restore, scheduler, retention

Closes M11. Backups go from "create and download" (Drop 1) to a full
recovery + automation story.

### What's new

**Restore from backup** — Settings → Backups → "Restore from a backup
file" section:

- File picker accepting `.bak` files
- A "type RESTORE to enable" textbox — the button stays disabled until
  the literal text matches (forced-friction confirmation)
- On submit: server decrypts, validates every path, writes to a
  staging directory, atomically swaps `data/` aside (kept as
  `data.pre-restore-<timestamp>/`), and replaces it with the restored
  contents. Pre-restore folder stays on disk for emergency rollback.
- After a successful restore: the server enters **lockdown mode** —
  all API calls return 503 with `errorCode: restore_pending_restart`,
  except `/api/backups/status` and `/api/logout`. The user must
  restart Pica to load the restored data into memory.

**Delete backups** — per-row Delete button in the existing list, with
a `window.confirm()` prompt. Frees disk space when manual backups pile
up.

**Scheduler + retention** — the M7 scheduler controls (enable / off /
hourly / daily / weekly / retention) are now actually wired up:

- A 5-minute interval timer wakes up and checks `org-settings.backups`
- If a backup is due (no prior backup, or the most recent is older
  than the schedule's interval), it makes one and prunes to the
  retention count
- Skipped while the post-restore lockdown is active
- Decision logic is a pure function (`shouldMakeBackup`) so it's
  trivially testable without wall-clock waits
- "Due" is **time-since-last**, not "wall-clock at 3am every day".
  A user wanting cron-precision scheduling can hit `POST /api/backups`
  from cron instead.

### New endpoints

| Method | Path                          | Purpose                                |
|--------|-------------------------------|----------------------------------------|
| GET    | `/api/backups/status`         | report `restoreCompleted` flag         |
| DELETE | `/api/backups/:id`            | permanently remove a backup file       |
| POST   | `/api/backups/restore`        | restore (requires confirmation header) |

The restore endpoint is the only one that accepts
`Content-Type: application/octet-stream` raw bytes (up to
`backupMaxBytes = 200 MB`, configurable). Every other endpoint stays
under the global 5 MB cap. Plus the restore endpoint requires
`X-Pica-Confirm-Restore: RESTORE` — a typed-confirmation gate
mirroring the UI textbox.

### Path-traversal protection

Every entry in an uploaded backup is path-validated before any
filesystem write:

- Must start with `data/` or be exactly `config.json`
- Must not contain `..` segments or backslashes
- Must not be absolute

If any path fails validation, the **entire restore is aborted** —
nothing was written to disk yet (writes go to a staging directory
first, then a single atomic rename swaps things in).

### `config.json` is intentionally NOT restored

Backups bundle `config.json` for completeness and future cross-install
support, but Drop 2 only handles same-install restore. The decryption
key check (HKDF over the running master key) IS the cross-install
gate — a backup made on a different Pica install fails decryption and
gets `errorCode: restore_wrong_key`. Restoring `config.json` would
mean replacing the wrapped master key, which could lock the user out
on next restart if the bundled config came from a different
passphrase. Conservative-by-default; cross-install restore is its own
flow if ever needed.

### Files touched
- `src/storage/backups.js` — added `delete()`, `restore()`,
  `pruneToKeep()`, plus `validateRestorePath()` helper. ~140 new
  lines.
- `src/routes/backups.js` — added 3 new endpoints (status, delete,
  restore). Restore maps decryption/validation failures to specific
  errorCodes (`restore_wrong_key`, `restore_not_a_backup`,
  `restore_unsafe_path`, `restore_confirmation_required`,
  `restore_failed`).
- **New:** `src/scheduler/backup-scheduler.js` — `startBackupScheduler()`,
  `shouldMakeBackup()` pure decision function.
- `src/http/responses.js` — added `serviceUnavailable` 503 helper.
- `src/config.js` — added `backupMaxBytes` (default 200 MB) with
  validation.
- `server.js` — instantiates `serverState`, registers backups route
  with it, starts the scheduler, adds the post-restore lockdown
  short-circuit + per-path body cap override for the restore endpoint.
- `public/settings.html` — backups section: restore form (file
  picker + confirmation textbox + danger button), lockdown banner,
  scheduler form re-enabled with a Save button.
- `public/settings.js` — restore submit handler with confirmation
  enable/disable gate, lockdown banner check on page load, schedule
  save handler, per-row Delete with confirm. ~150 new lines.
- `public/settings.css` — `.btn-link--danger`, restore form spacing,
  lockdown banner styling.
- `public/locales/en-US.js` + `pt-PT.js` — 17 new keys per locale
  (restore UI + delete confirmation + schedule save messages),
  6 new error codes (`restore_*`). Obsolete
  `settings.backupsAutoComingSoon` removed.
- **New:** `tests/test-backup-scheduler.mjs` (19 tests).
- `tests/test-backups.mjs` — extended with 12 Drop 2 tests (delete,
  pruneToKeep, restore round-trip, traversal rejection,
  config.json-skip behavior, fresh-restore edge case).
- `public/sw.js` — `CACHE_VERSION` bumped to `pica-cache-v19`.
- `package.json` — minor bump to 0.18.0.
- `docs/architecture.md` — repo layout updated for new files
  + scheduler folder, test list updated, total bumped to 18 suites
  / 484 tests.
- `docs/roadmap.md` — M11 marked complete.

### Tests
- 18-suite regression: 484 passing, 0 failing (was 453; +31 new across
  Drop 2 backups extensions and the new scheduler suite).
- Live end-to-end smoke verified: schedule save round-trip, create,
  delete, restore (without confirm → 400, with confirm → success),
  503 lockdown engaged, allowlisted endpoints still 200, restart →
  alice restored.

### Honest disclosures

- **No "verify backup before restore" two-step.** The UI shows a
  confirmation textbox but doesn't decrypt the header to display
  metadata before the user commits. Adding that would mean a
  separate `POST /api/backups/verify` endpoint that decrypts but
  doesn't write — easy follow-up. For now, if the user picks the
  wrong file, they get a localized error AFTER hitting Restore (no
  filesystem changes happen, but it's worse UX than "show me what
  I'm about to do").
- **No restore progress indicator.** The button just spins until
  the response comes back. For typical backup sizes (KBs to MBs)
  this is fine. A 100 MB restore over a slow link could appear
  hung.
- **The post-restore lockdown is process-wide and one-way.** Once
  set, the only way to clear it is restarting Pica. There's no
  "I changed my mind, let me undo" path. Recovery from a mistake
  is: stop the server, manually rename `data.pre-restore-<ts>/` →
  `data/`, restart. The pre-restore folder stays on disk for
  exactly this scenario — but it never auto-cleans, so disk usage
  grows by the size of `data/` per restore. Manual cleanup
  required. (A future "Pre-restore snapshots" UI section could
  list and delete these.)
- **Scheduler granularity is 5 minutes.** A daily schedule won't
  fire at exactly 24h00; it'll fire on the next 5-minute tick after
  the 24h interval elapses. Fine for "make sure we have a daily
  backup"; not fine for "exactly midnight every day". Use cron for
  the latter.
- **Catch-up on resume is "make one, not N".** If Pica was off for
  3 days under daily scheduling, on resume it makes ONE backup,
  not three. The list shows the gap; the user can manually create
  more. Avoids surprise disk bursts.
- **Delete is permanent + immediate.** No "trash" / "are you sure?"
  except the JS `window.confirm()`. The file is gone. No
  pre-delete copy.
- **Schedule timer leaks if the process exits uncleanly.** We call
  `setInterval(...).unref()` so the timer doesn't keep the event
  loop alive, but we don't hook SIGTERM/SIGINT to call
  `scheduler.stop()`. Node cleans up on exit anyway. Mentioned
  for completeness — not actually a problem.
- **`data.pre-restore-<ts>/` accumulates.** Every restore creates
  a new one, none auto-clean. Counter-balanced by retention being
  small (default 7), so the worst case is bounded — but worth
  knowing if you do many restores.
- **Restore is the only endpoint with a 200 MB body cap.** The
  cap is per-path: `req.path === '/api/backups/restore'` triggers
  the higher cap, everything else stays at 5 MB. Could be cleaner
  as a per-route declaration on the router, but the path-based
  override is one line and works.
- **No "backup file is too old" warning.** Restore happily replaces
  current data with a 6-month-old backup. Drop 1's metadata
  (timestamp visible in the list) is the only signal; the restore
  endpoint doesn't refuse based on age.
- **Lockdown also blocks `/api/version` and other harmless reads.**
  This is the conservative side of the cliff: rather than maintain
  an evolving allowlist, we deny everything by default and added
  status + logout as the bare minimum. Could be relaxed if it
  matters.

---

## [0.17.0] — 2026-05-03 — M11 Drop 1: encrypted backups (create/list/download)

First feature beyond M10. The Settings page has had a "Backups"
section since M7 with disabled placeholder buttons; this release
wires up everything except restore and scheduling. Restore is its
own focused drop next.

### What's new

**Backups section on Settings → Backups** (employer only):

- "Create backup now" button — produces a single encrypted file with
  every byte under `data/` plus `config.json`, atomically written to
  `backups/`
- Existing-backups table — created date, ID, size, per-row Download
  link
- The auto-backup scheduler controls (enable / schedule / retention)
  remain disabled with a "Scheduled backups and retention are not
  yet wired up" notice. Drop 2.

**Three new endpoints**, all employer-only:
- `GET /api/backups` — list metadata for every `*.bak` in `backups/`
- `POST /api/backups` — create a new encrypted snapshot
- `GET /api/backups/:id/download` — stream a backup as
  `application/octet-stream` with `Cache-Control: no-store`

### Backup file format

A single binary file with the layout:

```
+------------------------------------------------+
| 16  PICA_BACKUP_V1 (UTF-8 magic + version)     |
| 16  HKDF salt (random per backup)              |
| 12  AES-GCM IV                                 |
|  N  Encrypted payload (chunked entries)        |
| 16  GCM authentication tag                     |
+------------------------------------------------+
```

The encrypted payload is a length-prefixed concatenation of
`{path, data}` entries — no compression, no streaming. Pica's
typical data sizes don't justify either. Full implementation lives
in `src/crypto/backup-archive.js` (~190 lines).

Encryption: **per-backup key derived from the master key via HKDF-SHA256**
with a random per-backup salt. Two backups made from the same
master key produce different ciphertexts. AAD is the magic header,
binding the ciphertext to its declared format version.

### Filename convention

`pica-backup-<timestamp>-<id8>.bak` where:
- `<timestamp>` is `YYYY-MM-DDTHHMMSSZ` (UTC, second precision)
- `<id8>` is the first 8 hex chars of `SHA-256(blob)`

Both are filesystem-safe everywhere. The ID doubles as a tampering
tell-tale — change a byte and the filename no longer matches the
hash.

### Files touched
- **New:** `src/crypto/backup-archive.js` — pack/unpack, HKDF + AES-GCM
- **New:** `src/storage/backups.js` — store: list/create/read
- **New:** `src/routes/backups.js` — list/create/download endpoints
- **New:** `tests/test-backups.mjs` — 24 tests, format + storage
- `server.js` — instantiates `backupsStore`, registers
  `registerBackupRoutes`
- `public/settings.html` — backups section rebuilt: manual create
  + list table + disabled auto-backup placeholders
- `public/settings.js` — `loadBackupsList()`, `renderBackupsList()`,
  `fmtSize()`, create-button handler. Imports `fmtDateTime` from
  i18n.
- `public/settings.css` — `.backups-table`, `.btn-link` styles
- `public/locales/en-US.js` + `pt-PT.js` — 14 new keys per locale
  (backups manual heading, list heading, table headers, download,
  empty state, auto-backup heading + coming-soon text, error +
  success messages). 4 obsolete scaffold keys dropped
  (`backupsScaffoldNotice`, `runFull`, `runDelta`, `browseSnapshots`).
- `public/sw.js` — `CACHE_VERSION` bumped to `pica-cache-v18`
- `package.json` — minor bump to 0.17.0
- `docs/architecture.md` — repo layout updated for new modules,
  test list updated, total bumped to 17 suites / 453 tests
- `docs/roadmap.md` — M11 split into Drop 1 (this release) and
  Drop 2 (next), milestone table updated

### Tests
- 17-suite regression: 453 passing, 0 failing (was 427; +24 new
  in `test-backups.mjs`, +1 in `test-error-codes.mjs` picking up
  the new route module, +1 in `test-frontend-imports.mjs` picking
  up `fmtDateTime` newly imported in settings.js).

### Honest disclosures

- **Drop 1 only — no restore yet.** Backups are produced, listed,
  and downloadable, but there's no UI or endpoint to restore from
  one. Restore is high-stakes (replaces the entire data directory,
  requires server restart) and deserves its own focused session.
- **No automatic backup retention.** Every "Create backup" click
  adds a file to `backups/` until the user manually cleans up. The
  M7 retention setting (still disabled in UI) will activate when
  Drop 2 ships.
- **No scheduler.** Manual backups only. The auto-backup form
  fields persist their values to `org-settings.json` (existing M7
  behavior) but no scheduler reads them.
- **Backups include `config.json`** which contains the wrapped
  master key (scrypt-protected). A leaked backup file plus a
  brute-forceable passphrase = full data exposure. The wrapped
  key uses the same scrypt KDF as the live config, so this is
  acceptable risk in the same threat model — but it's worth being
  explicit: backups are NOT a way to share data with someone who
  doesn't know the Pica passphrase.
- **Backup encryption key is derived from the master key.** No
  separate "backup passphrase" UI step. Good UX (one passphrase to
  remember), but it does mean every running Pica instance can
  decrypt every backup ever made by that installation.
- **`Content-Length` for downloads is the full encrypted size.**
  We send the whole blob in one `res.end(buffer)` call rather than
  streaming. Acceptable for the data sizes we expect (KBs to a few
  MBs). If a Pica install ever produces 100+ MB backups, this will
  buffer all of that in RAM during the download — manageable but
  not ideal.
- **Deltas are deferred indefinitely.** The roadmap originally
  included delta backups; in practice typical data sizes don't
  justify the complexity. Full snapshots stay small.
- **No backup integrity check beyond GCM auth.** A user can verify
  a backup is intact by attempting to download it (the server
  reads from disk, which would error on filesystem corruption),
  but there's no "verify all backups" admin tool. Not needed at
  current scale.
- **Per-row Download link uses a plain `<a download>`.** The
  browser will save the file with the server-suggested filename.
  No progress indicator, no chunking. Fine for the data sizes we
  expect.
- **Created backup's `entryCount` includes config.json.** A
  freshly-set-up Pica with no employees produces a 2-entry backup
  (config.json + users.json) — confusing if the user expected the
  count to mean "employees" or "data files". The UI doesn't
  display entryCount, only the size; the field is in the API
  response for diagnostics.

---

## [0.16.5] — 2026-05-02 — Server-side errorCode emission + new test suites

Two debt-paying jobs in one release. Both are net-zero on user-visible
features but make the codebase noticeably more robust.

### 1. Backend errorCode emission

Since M9 (0.15.x) the frontend has been calling
`translateError(result.data.errorCode, result.data.error || 'fallback')`
on every error display. The wiring was in place, but the backend never
actually emitted `errorCode` — every error response was just
`{ error: '...' }`, and the frontend silently fell back to the
English string.

This release wires the codes through. Every `res.notFound` /
`res.forbidden` / `res.unauthorized` / `res.badRequest` /
`res.serverError` call across `src/routes/*.js` and `src/auth/*.js`
now emits an `errorCode` field. The frontend immediately picks up
localized error messages — Portuguese users see `"Funcionário não
encontrado"` instead of `"Employee not found"` for a 404.

**Numbers:** 67 error response sites tagged across 9 files. 47 codes
were already in the M9 dictionary; 4 new ones added
(`internal_error`, `profile_create_failed`, `rate_limited`,
`setup_already_done`) along with their en-US and pt-PT translations.

**Pattern for store-level validation errors**: stores can now attach
a `.code` property to thrown Error objects, and routes forward it
via `errorCode: err.code || 'invalid_value'`. `users.js` opted in
for `password_too_short`, `username_taken`, and `invalid_value`;
other stores still throw plain Errors and inherit the
`invalid_value` fallback. Tagging more stores is a clean follow-up.

**Response helpers** (`src/http/responses.js`) gained an `opts`
parameter: `res.notFound(msg, { errorCode: 'not_found' })`. The
old single-arg form (`res.notFound(msg)`) still works — fully
backward compatible.

### 2. Four new test suites

The two endpoints added in 0.16.2 and 0.16.4 had no automated tests
— I called this out in their release notes as a known gap. This
release closes the gap.

#### `tests/test-period.mjs` (21 tests)

`computePeriod()` extracted from `src/routes/reports.js` into a new
`src/storage/period.js` module so it's importable and testable.
Tests cover today/week/month boundaries, ISO week semantics
(Mon-Sun), month/year boundary handling, weekday counting (incl.
Feb 2024 leap year), and label formatting.

`employees.js` was refactored to use the same shared `computePeriod`
+ `ymdOf` helpers instead of its own inline ISO-week math —
removes ~15 lines of duplicated date arithmetic and means both
endpoints stay aligned automatically.

#### `tests/test-reports-team.mjs` (13 tests)

The team-hours route handler from 0.16.2. Uses a real router with
mocked stores; calls the handler directly. Covers:
- 401 for unauthenticated, 403 for non-employer
- Bad period rejected with `errorCode: invalid_value`
- Default period is `month` when not specified
- Scheduled hours math: `today=dailyHours`, `week=weeklyHours`,
  `month=dailyHours × weekdays-in-month`
- Per-employee working-time overrides honored
- Alphabetical sort by full name with username fallback
- Row shape + missing-profile handling
- Empty user list

#### `tests/test-employees-summary.mjs` (20 tests)

The summary route handler from 0.16.4. Same approach — real router,
mocked stores. Covers:
- 403 for non-employer, 404 for unknown id
- Response shape (id, username, role, profile, week, bankHours,
  upcomingLeaves, pending)
- Week computation + scheduled-hours per-employee override
- Bank balance reading + zero default
- **Upcoming leaves** classification across many edge cases:
  starts in next 30 days ✓, currently in progress ✓, past ✗,
  > 30 days out ✗, pending ✗, rejected/cancelled ✗
- Sorting by start date ascending
- Per-employee scoping (no bleed between users)
- Pending corrections: status filter, scoping, safe field shape
  (no `justification`)
- Profile shape edge cases (null when missing, `hasPicture` only
  when picture-only)

#### `tests/test-error-codes.mjs` (9 tests)

Static analysis: every `res.<error-helper>(...)` call across
`src/routes` and `src/auth` is checked for `errorCode` inclusion.
Catches regressions where someone adds a new error response but
forgets to include the code, breaking the i18n flow. Includes
proper handling of comments (so JSDoc examples don't trigger false
positives) and balanced-paren parsing.

The test caught one site I missed during the manual sweep —
proving its worth on day one.

### Files touched
- **New**: `src/storage/period.js` — extracted period helpers.
- **New**: `tests/test-period.mjs`, `tests/test-reports-team.mjs`,
  `tests/test-employees-summary.mjs`, `tests/test-error-codes.mjs`.
- `src/http/responses.js` — helpers accept `{ errorCode }` opts.
- `src/auth/users.js` — validation errors carry `.code`.
- `src/auth/rbac.js` — three middleware error sites tagged.
- `src/routes/auth.js` — login + setup errors tagged.
- `src/routes/setup.js` — forwards `err.code` from users.create.
- `src/routes/employees.js` — 11 sites tagged, plus refactored to
  use shared period helpers (removed ~15 lines of inline date math).
- `src/routes/punches.js` — 5 sites tagged.
- `src/routes/leaves.js` — 19 sites tagged (the most), including
  the cap-exceeded composite messages.
- `src/routes/corrections.js` — 12 sites tagged.
- `src/routes/reports.js` — 9 sites tagged, period helpers
  extracted to module.
- `src/routes/settings.js` — 6 sites tagged.
- `public/locales/en-US.js` + `pt-PT.js` — 4 new error keys per
  locale.
- `public/sw.js` — `CACHE_VERSION` bumped to `pica-cache-v17`.
- `package.json` — patch bump to 0.16.5.
- `docs/architecture.md` — repo layout updated for new files;
  test paragraph rewritten with route-level testing section.
- All four `docs/*.md` footers bumped to 0.16.5.

### Tests
- 16-suite regression: 427 passing, 0 failing (was 364; +63 across
  4 new suites).

### Honest disclosures
- **Backend store validation errors mostly use `invalid_value`.**
  I tagged the user-creation errors specifically (`password_too_short`,
  `username_taken`) but left org-settings/user-prefs/leaves/corrections
  store throws as the generic fallback. Tagging each individually
  would add ~30 small edits across the storage layer for marginal
  gain — the user gets the correct English message regardless, and
  the i18n layer's `translateError()` falls through cleanly. Easy
  follow-up if any specific case needs better localization.
- **The route-level tests use mocked stores.** They exercise the
  handler's composition logic but don't catch storage bugs. For
  storage logic the existing per-store tests (test-leaves, test-corrections,
  test-reports) remain the source of truth. The new tests are
  intentionally focused on the route layer's choices: RBAC,
  validation, period selection, response shaping.
- **`tests/test-error-codes.mjs` is a static audit, not a runtime
  test.** It catches the structural bug (missing `errorCode` arg)
  but not semantic bugs (wrong code applied). To catch wrong-code
  bugs we'd need actual error trigger tests, which would be a
  significant expansion. The static audit covers the 80% case.
- **No frontend changes.** The translation infrastructure was
  already plumbed in M9; this just lights it up. After deploying
  0.16.5, switching the locale to pt-PT will translate previously
  English-only error toasts (e.g. "Funcionário não encontrado").
  Verify by triggering a 404 on `/api/employees/no-such-id` from
  a pt-PT session.
- **The `period.js` module was extracted purely for testability.**
  Its only callers are the team-hours and summary route handlers.
  Pulling it out doesn't add complexity at the call sites — both
  use the same shared boundary computation now, which removes
  duplicated logic that would have drifted.

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
