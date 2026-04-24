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
