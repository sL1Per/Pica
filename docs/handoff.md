# Handoff — current state of Pica

This file is a snapshot in time. It describes where the project is
**right now** so a new collaborator (human or AI) can pick up without
spelunking through release notes. Update it when the state changes
materially.

_Last touched in 0.46.4._

---

## At a glance

- **Latest version:** 0.46.4 (released 2026-06-02) — **Fix: Correction modal
  Approve/Reject buttons misaligned.** The Reject button sat ~16px below Approve
  in the `correction-detail-modal` Actions row. `correction-detail-modal.css`
  neutralized the global `button { margin-top: 16px }` only on *direct children*
  of `.cdm-actions`, but Reject is nested in `.cdm-reject-wrap` (so its
  collapsible notes sub-form can sit under it), so the `>` rule missed it. Fix:
  `.cdm-actions button { margin-top: 0; }` (descendant, not direct-child).
  CSS-only; `CACHE_VERSION` v85 → v86. Verified with a Playwright screenshot of
  the real card markup at desktop width. See RELEASES 0.46.4.
- **0.46.3** (released 2026-06-02) — **Row separators on the
  Leaves request lists (dead-selector fix) + record-row consistency.** Real bug:
  the Leaves *Pending approval* / *All requests* / *Your history* lists drew **no
  row lines at all** because `leaves.css` used `.lv-row + .lv-row` (adjacent
  sibling) while `leaves.js` renders `<ul class="lv-list"> › <li> › .lv-row` — the
  `.lv-row`s are never adjacent (each alone in its `<li>`), so the rule matched
  nothing. No colour could fix it. Fix: `.lv-list li + li { border-top: 1px solid
  var(--line); }`. Only Leaves was affected — punch `.corr-row` puts the class on
  the `<li>` itself and `.sess__times` are direct siblings, so those work.
  Misdiagnosed twice as contrast (a `--line-strong` token at ~40% then ~28% was
  added then **reverted** per operator — separators are plain `--line` now). Also
  bumped the still-faint `--line-soft` record-row separators that *did* render up
  to `--line` for consistency (Reports `.data-table`, leaves matrix, team list,
  settings tables, home/detail/calendar rows, punch sess/corr lists). Touched:
  `app.css`, `leaves.css`, `employees.css`, `settings.css`, `index.css`,
  `employee.css`, `leaves-calendar.css`, `punch.css`. `CACHE_VERSION` v81 → v85.
  No JS/backend/i18n/test change (no DOM/render test for the leaves list — M16).
  **Verified with a Playwright screenshot** of an offline harness reproducing the
  real `ul.lv-list › li › .lv-row` structure (lines now render). Stale-SW caveat:
  clear site data / unregister the worker (or reload twice after v85) to see it.
  See RELEASES 0.46.3.
- **0.46.2** (released 2026-06-02) — **Fix: employee-summary
  blank page on a pending in/out correction.** `/employees/:id` rendered a
  blank body (topbar present, no error) whenever the employee had a pending
  **in-only or out-only** correction. Cause: `asDate()` in `i18n.js` validated
  only the string path, so an Invalid `Date` instance (from
  `fmtRange(null, …)` → `new Date('null')` for a single-endpoint correction)
  slipped past the `if (!d) return ''` guards and `fmtDate`'s catch-fallback
  `d.toISOString()` threw an uncaught `RangeError`, killing the render. Fix:
  `asDate` now range-checks both paths (hardens every date formatter app-wide);
  `fmtRange` in `employee.js` collapses single-endpoint corrections to one time.
  +2 regression tests (suite total still 53). No backend/API change.
  `CACHE_VERSION` v80 → v81 (`i18n.js` is pre-cached). See RELEASES 0.46.2.
- **0.46.1** (released 2026-06-02) — **Avatars + role labels
  across the punch & leaves people-lists.** Four sections showed the bare
  username where the app shows the role and/or were missing avatars: the employer
  **Today tab**, the leaves **Team-balance matrix**, the **Corrections tab**
  (employer rows), and the **This-week tab** (no person header at all). All now
  show avatar + name + role. **Avatar = picture-always-wins**: hue-tinted
  initials paint immediately, the uploaded picture loads in the background and
  replaces them on success (error → initials stay). This drops the dependence on
  a `hasPicture` flag, so the leaves matrix shows real pictures with **no server
  restart** and **no backend change** (an earlier draft added `hasPicture` to
  `GET /api/leaves/balances`; reverted). Files: `punch.js`,
  `punch-today-employer.js`, `punch-corrections.js`, `punch.html`, `punch.css`,
  `leaves.js`, `leaves.css`. `CACHE_VERSION` v79 → v80. Trade-off: one
  `GET …/picture` per person even for the picture-less (404 → initials) —
  negligible at ≤50. Verified via unit suites + code review (not a fixtured
  screenshot). See RELEASES 0.46.1.
- **0.46.0** (2026-06-02) — **Two pages folded into
  `/punch` tabs.** The employer `/punches/today` view and the `/corrections`
  list page were eliminated **as pages** (no feature lost) by folding them into
  **Today · Corrections · This week** tabs on `/punch`. Employer Today now shows
  everyone (new `punch-today-employer.js`); the Corrections tab is role-aware
  (employee = own, employer = everyone + inline ✓/✗ + a pending-count badge),
  with rows opening a **detail modal** (`correction-detail-modal.{js,css}`) while
  the `/corrections/:id` page stays as a deep-link fallback; This-week gained a
  **MANUAL** badge (client-side, off the `correction:` `clientId` prefix — zero
  backend) + a **search** box + an employer **person picker**. Both old routes
  now **404**; `/corrections/new` redirects to `/punch?tab=corrections&new=1`;
  `?tab=`/`?id=`/`?new=` deep-links supported + query-stripped. Six files deleted;
  shared `.sess` builders extracted to `punch-sessions.js`. **No API change.**
  `CACHE_VERSION` v78 → v79; +1 suite (`test-punch-manual`, total 53). Built
  subagent-driven with two-stage review per task; **verified live via Playwright
  MCP** on a throwaway instance (both roles; one bug found+fixed: the tab-count
  span was wiped by `applyTranslations` and was de-nested from the `data-i18n`
  button). See RELEASES 0.46.0.
- **0.45.1** (2026-06-01) — **Punch map fills the hero
  height.** CSS-only (`punch.css`): the OSM map preview on the punch page now
  stretches to the full height of the clock hero's top row instead of a short
  120px card centred against the taller control column. `.clock-hero__top`
  switched `align-items: center` → `stretch`; `.map-card` is now a flex column
  and `.map-card__frame` grows (`flex: 1 1 auto`, `height` → `min-height:
  120px`), so the tile fills edge-to-edge with the address + attribution pinned
  at the bottom. The card is also pulled left toward the action button
  (`margin-right: 32px`), widening the right-edge gap (24px → ~56px). Mobile
  (≤ 760px stacked) unchanged — the frame falls back to its 120px `min-height`
  and the right margin resets to 0. `CACHE_VERSION` v77 → v78. Verified live via Playwright
  MCP (frame grew 120px → ~397px). See RELEASES 0.45.1.
- **0.45.0** (2026-06-01) — **"Forgot to clock?" modal
  redesign.** Presentational + client-side only (`manual-time-modal.{js,css}` +
  its two callers + i18n; **no backend** — the `POST /api/corrections` payload is
  byte-equivalent). The manual-time correction modal was rebuilt: the
  Both/Clock-in/Clock-out picker is now a horizontal **segmented control** (hidden
  `.sr-only` radios, `:has(:checked)` fill); the two `datetime-local` inputs split
  into a single **Day** + **Start time** + **End time** (the submit handler
  recombines `day + time` → the same ISO `start`/`end`, with an overnight roll for
  "Both" when end ≤ start); the justification is relabelled **"Why?"**, submit
  reads **"Send for approval"** with a checkmark; the punch entry titles it
  **"Forgot to clock?"** via a new per-open `titleKey`/`subtitleKey` on
  `openManualTimeModal` (corrections list keeps "Register manual time"). The
  active segment + primary button use `--honey`, so the accent **follows the
  user's palette** (amber Linen / blue Slate / olive Olive). New i18n keys
  `correctionNew.day/startTime/endTime/forgotTitle/forgotSubtitle`; unused
  `startBoth/endBoth/startIn/endOut` removed (locale parity held). `CACHE_VERSION`
  v76 → v77. **Verified live via the Playwright MCP** on an isolated throwaway
  instance (port 8123, separate data dir — real install untouched): matches the
  target in both Linen and Slate, and a real Both/09:00→17:00 submit created a
  `pending` correction at `07:00Z`/`15:00Z` (correct local→UTC). No new test
  suite (route tests already cover the payload). See RELEASES 0.45.0.
- **0.44.0** (2026-06-01) — **Full company name +
  collapsible sidebar.** Presentational app-shell change (`topbar.js` /
  `topbar.css` + 4 i18n keys; no backend). (1) The sidebar company name now
  **wraps** onto multiple lines (`overflow-wrap: anywhere`) instead of
  truncating with an ellipsis — the whole name is always visible. (2) A
  **"Collapse sidebar"** control at the bottom of the rail shrinks the 232px
  sidebar to a **72px icon-only rail** and back; the choice persists in
  `localStorage` (`pica-sidebar-collapsed`) and re-applies before paint, so it
  holds across pages/reloads. Desktop-only (scoped `@media (min-width:761px)`;
  the control is hidden ≤760px so the mobile drawer is untouched). The
  active-nav marker is hidden in the rail (would clip); `.appshell__collapse`
  resets the global `<button>` chrome to read as a nav row. `CACHE_VERSION`
  v75 → v76. **Verified live via the Playwright MCP** on an isolated throwaway
  instance (51-char name wraps to 4 legible lines; collapse→72px + persistence
  + expand all confirmed); touched unit suites green. See RELEASES 0.44.0.
- **0.43.3** (2026-06-01) — **Live clock in the
  top-bar crumb.** The content top-bar crumb's leading role label
  (`Overview` / `My day`) is replaced by a live `HH:MM:SS` clock + pulsing sage
  dot, so the clock now shows on **every** authenticated page (the date stays:
  `● 12:52:43 · Thu · 15 May 2026`). The redundant home-hero clock (`.emp-clock`,
  both roles) and its two `setInterval` tick loops were removed; the unused
  `crumb.overview`/`crumb.myDay` i18n keys and the now-dead `.emp-clock` rules +
  orphaned `@keyframes pulse` in `index.css` were pruned (`pulse` now lives in
  `topbar.css`, on every page). No backend change. `CACHE_VERSION` v74 → v75.
  Green on the touched unit suites; **live in-browser pass pending** (operator
  to verify — needs an authed session). See RELEASES 0.43.3.
- **0.43.2** (2026-06-01) — **Avatars on
  notifications + leave pending lists.** The notifications bell dropdown, the
  Leaves **Pending approval** list, and the calendar **Pending requests** rail
  now show the requester's round, hue-tinted avatar (uploaded picture or
  coloured initials), matching the dashboard's "Waiting on you" card.
  `GET /api/leaves` + `GET /api/corrections` now carry a per-record
  `hasPicture` boolean (best-effort disk stat in each route's `enrich()`).
  Topbar hue is applied via `data-hue` + `style.setProperty` (inline
  `style` attrs are CSP-blocked by `style-src 'self'`). **Avatars unified
  app-wide:** all pages now derive colour from the additive `(h+charCode)`
  hue seeded on `fullName||username`, and initials from the first two words —
  topbar's `hueFor` (was `h*31`, seeded on `user.id`) and `initialsFor` (was
  first+last word) were brought into line, so a person looks identical on the
  user-tile, lists, dashboard, leaves, calendar, and profile. Helpers remain
  per-script copies (no shared module); the `.cal-pop__av` day-popover badge
  is deliberately left as a square neutral initials badge. `CACHE_VERSION`
  v73 → v74. Verified by unit suites (leaves/corrections/render/
  security-headers/frontend-imports/sw-precache all green); **live in-browser
  pass still pending** (operator to verify). See RELEASES 0.43.2.
- **0.43.1** (2026-06-01) — **Settings tabs
  left-alignment fix.** CSS-only: `.set-tab` inherited the global button
  `justify-content: center`, centring each tab's icon+label so rows staggered
  by label length. Added `justify-content: flex-start` in `settings.css`; all
  five tabs now share one icon column. Verified live in-browser (equal
  `getBoundingClientRect().x`). `CACHE_VERSION` v72 → v73. See RELEASES 0.43.1.
- **0.43.0** (2026-06-01) — **profile redesign +
  soft-deactivate.** The `/employees/:id/profile` editor was rebuilt to a wide
  1040px two-column card layout (name title + "Editing profile · {Role}"
  subtitle, uppercase section labels, inline helpers, footer action bar
  Deactivate · Cancel · Save; read-only Employee|Employer segmented control —
  no role-change endpoint exists). Employee off-boarding is now a reversible
  **soft-deactivate**: an `active` flag in `users.json` (absence = active),
  rejected at the `authenticate()` choke point (revokes all stateless-cookie
  sessions), login refused with `account_deactivated`, employer-only
  deactivate/reactivate POST endpoints, reactivation from the greyed team-list
  rows. Permanent `DELETE` is retained but **gated behind deactivation**
  (`not_deactivated` otherwise) and surfaces as the profile Danger zone only
  for already-deactivated accounts. `/employees/new` adopts the same card/grid
  vocabulary. `CACHE_VERSION` v70 → v71; +2 test suites (50 → 52). Verified by
  unit suites (operator chose tests-only — no live browser pass). See
  RELEASES 0.43.0.
- **0.42.5** (2026-05-31) — leave-calendar layout
  polish (two presentational fixes). (1) Right rail aligned with the grid,
  not the title: the `<header class="cal-head">` lived inside `.cal-main`,
  so the two-column `.cal-page` grid put the title and the rail's first
  card on the same top edge. Moved the header to a direct child of
  `.cal-page` spanning `grid-column: 1 / -1` (margin-bottom zeroed; the
  20px row-gap handles title→body spacing), so the rail now lines up with
  the month-nav toolbar. (2) Toolbar is now a grey header band capping the
  calendar card: `.cal-toolbar` gets `background: var(--bg-2)`, a
  `--line-soft` border rounded on the top corners, and `12px 14px` padding;
  `.cal-weekhead` lost its top border + top rounding so the toolbar's
  bottom border is the divider. Pure CSS/markup — no JS/data/API.
  `CACHE_VERSION` v68 → v69. See RELEASES 0.42.5.
- **0.42.4** (2026-05-31) — employee-detail hero
  button alignment + app.css editor-lint cleanups. The `/employees/:id`
  hero's Reset-password (`<button>`) and Go-to-profile (`<a>`) sat 16px
  out of alignment: the bare `<button>` inherits app.css's global
  `button` rule (`margin-top:16px; min-height:40px`), the `<a>` doesn't,
  so `.ed-btn` now resets `margin-top:0` + pins `min-height:38px`. Also
  cleared three Microsoft Edge Tools CSS findings in `app.css`
  (`-webkit-user-select` added before `user-select`; `-webkit-appearance`
  reordered before `appearance` in the two reset rules); the
  `-webkit-text-size-adjust` line was left prefixed-only on purpose
  (adding the standard property makes Edge Tools flag it as unsupported in
  FF/Safari). Also spaced the reset-password modal's Cancel/Reset action
  row off the confirm field (`btn-row` + `mt-5`, 0px → 24px gap).
  `CACHE_VERSION` v67 → v68. See RELEASES 0.42.4.
  (0.42.3: employer-home
  "Hours this week" fix: `.eh-delta` was inheriting `--font-serif` from
  `.eh-hours__big`, and Instrument Serif has no bold weight, so the
  `+Xh vs last week` delta rendered as faux-bold serif. Switched
  `.eh-delta` to `--font-sans` and dropped the stray leading space in
  the `h` unit. See RELEASES 0.42.3. (0.42.2: Team list toolbar
  + table polish: search no longer stretches (now `.tm-search-wrap`,
  `flex: 0 1 340px`) and gained a masked magnifying-glass icon + the
  `--paper` surface (scoped `.tm-search-wrap .tm-search` to beat
  app.css's `input[type="search"]`); search and chips share a 44px /
  12px-radius shape; chips show `Label · N`; placeholder is now
  "Search by name or position…"; and the table's last column is a fixed
  64px so Status/Week/Today align row-to-row regardless of pending
  badge. See RELEASES 0.42.2. 0.42.1: employer home greeting + live
  clock, matching the employee home.))
- **Test count:** 53 suites (0.46.0 added `test-punch-manual`; 0.43.0 added `test-user-active` +
  `test-employee-deactivation`; 0.37.0 added `test-team-status`; 0.36.0 added `test-calendar-grid`; 0.35.0 added `test-leaves-render`; 0.30.0 added `test-punch-week`; 0.29.0 added
  palette cases to the existing `test-user-prefs`), all green except **two** pre-existing
  flakes unrelated to recent work, both failing identically on the
  pre-feature baseline (see notes.md): `test-reports.mjs`
  `overnight split` bucket count (host-timezone sensitive) and
  `test-auth.mjs` (~1/64 probabilistic — a base64url last-character
  signature-tamper artifact in the test itself, not the auth code;
  if it reds, re-run `node tests/test-auth.mjs` alone 2–3× to
  confirm intermittence before suspecting a regression). M14 email
  notifications added 6 suites (`test-config-mail`, `test-mail-smtp`,
  `test-mail-templates`, `test-mail-mailer`,
  `test-reminder-scheduler`, `test-mail-routes`) and extended
  `test-org-settings` / `test-user-prefs` (pre-existing): 34 → 40.
  The 0.26.0 encrypted settings-managed SMTP config added one more,
  `test-mail-config-store`: 40 → 41. The 0.27.0 M15 foundation added
  three more — `test-theme-tokens`, `test-theme-bootstrap`,
  `test-sw-precache`: 41 → 44. The 0.28.0 employee-home redesign added
  `test-employee-home` (pure-helper contract): 44 → 45. The 0.30.0 clock
  page added `test-punch-week`: 45 → 46. The 0.35.0 leaves restyle added
  `test-leaves-render` (day-count + status-partition): 46 → 47. The 0.36.0
  calendar restyle added `test-calendar-grid` (shared month-matrix): 47 → 48.
  The 0.37.0 employer home + team + employee detail rebuild added
  `test-team-status` (shared pairing + status classify): 48 → 49. The 0.41.0
  alias-bridge removal added `test-no-alias-tokens` (static guard: no alias
  token in any stylesheet + bridge block gone): 49 → 50.
- **Build artifact:** `pica-0.23.0-master-key-management.zip` (0.24.0
  through 0.30.0 are feature drops on top; no new zip cut yet)
- **Dependency count:** zero npm packages (Node 22 standard library only)
- **Lines of code (rough):** ~7 KLoC across `src/`, `public/`, `tests/`
- **Active milestone:** **M15 (Full UI revamp) — COMPLETE, closed at 0.41.0.**
  Next is M16 (Playwright E2E — first npm dependency), then M17 (deployment
  guide, ships last). M15 progression: foundation shipped at
  0.27.0; **employee home** at 0.28.0; **palette picker** at 0.29.0;
  **employee punch (clock) page** at 0.30.0; **corrections list + detail**
  at 0.31.0; **manual-time modal** (`/corrections/new` retired) at 0.32.0;
  **employer `/punches/today`** at 0.33.0 — which **completes the
  punches/corrections screen group**; **leaves** (list / request-leave modal /
  detail) at 0.35.0; **calendar** (toolbar/chips/scope, pending+approved grid,
  anchored popover, right rail) at 0.36.0; **employer home + team list +
  employee detail** (Plan 6) at 0.37.0 (shared `team-status.js`; heuristic
  on-break; inline decide everywhere; Reset-pw on `modal.js`); **Settings +
  Security restyle** (Plan 7) at 0.38.0 (5-tab `/settings` shell + 3-card
  `/security`, zero backend change); **Preferences + Profile edit** (Plan 8) at
  0.39.0 (`/preferences` two-card with radio-cards + password-match gate;
  `/employees/:id/profile` four-card editor with read-only role badge + hard
  Delete; `/employees/new` shares `employee-profile.css`; zero backend change);
  **Reports re-skin** (Plan 9 part 1) at 0.40.0 (`reports.{css,js}` to the M15
  card/toolbar/`.data-table`/serif-totals/status-pill vocabulary; every M13
  behavior byte-equivalent; `reports.css` now alias-free); **alias-bridge
  removal + JS dedup + notification bell** (Plan 9 part 2) at 0.41.0, **which
  closes M15** (canonical tokens end-to-end, bridge gone, `flashSaved` +
  `pairSessions` consolidated, bell wired). M16–M17 follow (M17 deployment guide
  ships last)

---

## What just shipped (0.46.0)

**Two pages folded into `/punch` tabs (post-M15 consolidation).** The employer
`/punches/today` view and the `/corrections` list page were removed **as pages**
without losing any feature, by folding their content into three tabs on `/punch`:
**Today · Corrections · This week**. Pure frontend + page-routing — **no HTTP API
changed**.

- **Today:** employee = own sessions (unchanged); employer = everyone's
  per-employee cards (status pill + worked·break + session pairs), via new
  `public/punch-today-employer.js` reusing `team-status.js`'s `pairSessions`.
- **Corrections** (renamed from "My corrections"): employee = own (file +
  cancel); employer = everyone + "N waiting" inbox with inline ✓/✗ + a
  pending-count badge on the tab. New `public/punch-corrections.js`
  (`initCorrectionsPanel → {reload}`). Rows open a **detail modal**
  (`public/correction-detail-modal.{js,css}`, salvaged from the
  `/corrections/:id` page); the page itself **stays** as a deep-link fallback.
- **This week:** a **MANUAL** badge on correction-materialized punches
  (client-side, off the `correction:` `clientId` prefix — zero backend), a
  **search** box, and an employer **person picker**.
- **Routing:** `/punches/today` + `/corrections` (list) → **404**;
  `/corrections/new` → `/punch?tab=corrections&new=1`; `/corrections/:id` kept.
  `?tab=`/`?id=`/`?new=` deep-links, query-stripped. Six files deleted; shared
  `.sess` builders extracted to `public/punch-sessions.js` (home of `isManual()`).
- **Plumbing:** `CACHE_VERSION` v78 → v79; 4 i18n keys added (rest reused); +1
  suite `test-punch-manual` (total 53). Built **subagent-driven** (one implementer
  + two-stage review per task). **Verified live via Playwright MCP** on a
  throwaway instance (separate data dir/port 8123 — real install untouched), both
  roles; one integration bug found+fixed (tab-count span wiped by
  `applyTranslations`, de-nested from the `data-i18n` button).
- **Honest Disclosures** (full list in RELEASES 0.46.0): employer keeps the clock
  hero (deviates from the screenshots); MANUAL is a clientId-prefix heuristic; the
  modal duplicates the detail page's logic; modal duration shows "9" not "9h"
  (matches the list); the employer person-picker includes the employer and
  defaults to the first entry; no DOM/E2E tests (M16) — verified at one
  viewport/palette.

---

## What just shipped (0.42.0)

**UI polish: page centering (post-M15).** The home page content was pinned
flush-left in the app-shell content column (empty gap on the right, most
visible on wide screens); every other page was centered. Root cause: inside
the shell `<main>` is both `.appshell__content > main` (caps width at 1320px)
and `.container container--wide`, but centering came **only** from
`.container`'s `margin:0 auto` — and the JS-rendered home (`index.js`) clears
`main.className` for both employer/employee views (it builds its own
`.eh-home`/`.emp-home` body), stripping `.container` and the centering. Fix
(one line): centering now lives on the shell rule — `.appshell__content > main`
gains `margin-inline: auto`, so any body centers whether or not it carries a
container class. No width change; pages already centered are unaffected.
`CACHE_VERSION` v59 → v60 (`topbar.css` pre-cached); no i18n/backend/new test.
**Verified live via the Playwright MCP** (flush-left "before" vs centered
"after" on the same employer home at 1920px). Honest Disclosures: centering
only (grid/caps untouched); `index.js` still clears `className` (now harmless,
left as-is); no automated UI test (M16); verified Linen-light at one viewport.

**Second fix (folded into this release): notification bell icon was an empty
box.** Since 0.41.0 the top-bar bell showed its red dot but no glyph. Cause:
the bell `<svg>` is a *direct* flex child of `.appshell__iconbtn`
(`inline-flex`) with size only on HTML attrs (no CSS width — CSP bars inline
`style`); a bare SVG flex child with default `flex-shrink:1` collapses to
**width 0** in Blink/WebKit (height stayed 17, so invisible). Sidebar icons
escaped it via their `.appshell__nav-icon` wrapper (`flex-shrink:0`). Fix (one
line): `.appshell__svg` gains `flex-shrink:0` — global, since icons never want
to shrink; covers the mobile bell too. Confirmed in-browser `0×17` → `17×17`
and glyph visible. Same `CACHE_VERSION` v60 (`topbar.css` carries both fixes).
First two fixes in a UI-polish pass — more may fold in while uncommitted.

**Third + fourth fixes (folded in): punch (clock) page hero.** The
`.clock-hero` `1fr auto` grid had the comment field, OSM map, and feedback as
direct grid children with no placement, so the browser auto-flowed them into
stray cells — textarea beside the buttons, map full-bleed. Rebuilt the hero as
a flex **column** of two rows: `.clock-hero__top` (flex row: **time · map ·
button**, map to the right of the time with its address in `.map-card__meta`
below the tile, button pushed far-right via `margin-left:auto`) and
`.clock-hero__extra` (comment + feedback, full-width below, capped `600px`).
Side-by-side ~halved the hero (~659→~340px desktop); map `280px`/`120px`-frame,
readout `88→68px`. Also the hero showed **both** Clock in/out (one greyed);
`paintStatus()` now toggles `hidden` so exactly one shows (Clock in off the
clock, Clock out working) — out-button ships `hidden` for a clean first paint.
Touches `punch.html/css/js`. `punch.css`/`punch.js` are pre-cached →
`CACHE_VERSION` v60 → v61 → **v62** (each asset edit needs its own bump or a
browser on the old cache runs stale assets against new markup — exactly the
mid-dev bug where a v60-cached browser ran old `punch.js` against new HTML and
showed the disabled Clock-in with no Clock-out). No backend/i18n/new test.
**Verified live via Playwright MCP** by measuring hero geometry in both clock
states.

**Fifth fix (folded in): uniform page titles.** Each page's primary serif
heading had drifted to its own hardcoded size — Calendar/Leaves `28px`
(`1.75rem`), Reports the generic `32px` h1, employer home `40px`, Security
`42px`, Preferences `44px`, Settings `48px`, employee home `52px` — so the
pages looked mismatched (Calendar's `28px` worst). Fix: one `--page-title`
token in `app.css` `:root` (`60px`, redefined to `34px` in a single
`@media (max-width:760px)`). Every primary heading now reads
`font-size: var(--page-title)` — the bespoke `*-head__title`/`*-head h1`
classes (home ×2, Team, Leaves, Calendar, Profile/New, Preferences,
Security, Settings, Clock) plus a new shared `.page-header h1` rule for the
`.page-header` pages (Corrections, Today, New employee, Reports). Per-page
mobile font-size overrides deleted; `reports.css`'s redundant
`.page-header h1` font-family rule removed. **Excluded by design:** employee
detail (`.ed-name`, set beside the 88px avatar) and leave detail
(`.ldet-hero__label`, a colour-coded status word, not a title) keep their
hero treatments. `app.css` + 10 pre-cached stylesheets → `CACHE_VERSION`
v62 → **v63**. No backend/i18n/new test.

---

## What just shipped (0.41.0)

**M15 alias-bridge removal + JS dedup + bell — closes M15 (Plan 9, part 2).**

- **Alias bridge removed (no visual change).** All ~195 pre-M15 alias-token
  usages across 9 stylesheets were rewritten to the canonical token the bridge
  resolved them to (`--accent`→`--honey`, `--surface`→`--paper`, `--text`→`--ink`,
  …), then the bridge block was deleted from `app.css`. `--accent-ring` survives
  as a canonical per-theme token (no flat equivalent); `--border-strong`→`--line`.
  New guard `tests/test-no-alias-tokens.mjs` (49 → 50). Verified live: tokens
  resolve correctly in Linen-light + Slate-dark, zero console errors.
- **`flashSaved` shared in `/app.js`.** The 3 former copies had diverged
  (signature/class/content); replaced with one parameterized helper, each page
  keeping its own flash CSS class. Settings keeps a thin wrapper for its icon.
- **`pairSessions` reused from `/team-status.js`** by `punches-today.js` (adapts
  the shared algorithm to its `{inTs,outTs,…}` render shape; equivalence tested).
- **Notification bell** now opens a panel of the viewer's pending items
  (employer: leaves + corrections awaiting decision; employee: own pending),
  each linking to its detail page, with a red dot (CSS class) when count > 0,
  refreshed on mount + tab focus. Reuses the user-menu popover (shared
  `positionPopover`). No new backend (`/api/leaves` + `/api/corrections`). New
  `notifications.*` keys both locales.

`CACHE_VERSION` v58 → v59. **Deferred (Honest Disclosure):** the geo
unification (`punch.js` onto `/geo.js`) — the two had diverged by design
(`sessionStorage` + failed-sentinel vs `localStorage` + ts-freshness), so a safe
merge needs its own focused change with live clock-in/out testing; not forced
into this cleanup release. Full disclosures in RELEASES.md 0.41.0. **M15 is now
complete.**

---

## What just shipped (0.40.0)

**M15 Reports re-skin (Plan 9, part 1).** `reports.{css,js}` restyled to the M15
design with **zero backend change** — every M13 behavior byte-equivalent (the
two report types, scope Everyone/One-person, Day/Week/Month/Year + ◀/▶ nav, the
period-bucket × employee matrix, the single-person hours/leaves views, CSV
download, Print→Save-as-PDF, server-enforced employee isolation).

- **`reports.css`** rewritten against canonical tokens (alias-free): serif page
  title, the shared chip/toolbar idiom, the shared `.data-table` look (matrix
  keeps its sticky first column), **serif grand totals**, and a new
  `.rpt-status--{approved,pending,rejected,cancelled}` pill for the leaves
  single-view status column. Print stylesheet preserved.
- **`reports.js`** emits the new classes — `data-table` on every table; the
  leaves status cell wraps its (already-`esc()`d) text in a `.rpt-status` pill.
  Four class-string lines changed; rendering/escaping/data flow untouched (kept
  the escaped-`innerHTML` approach — already XSS-safe — rather than rewriting to
  the DOM API).

The design handoff never drew a Reports screen (prototype stub; M13 shipped the
real one at 0.24.0), so this applies the established M15 vocabulary. No new i18n
keys (reuses `reports.*` / `status.*` / `leaves.type.*`); `CACHE_VERSION` v57 →
v58; **no new test suite** (logic covered by `test-reports` /
`test-reports-team`; count stays 49). `reports.css` is now alias-free, retiring
12 of the 195 alias usages ahead of the 0.41.0 bridge removal. Honest
Disclosures (full list in RELEASES.md 0.40.0): escaped-`innerHTML` kept (not a
DOM-API rewrite); no automated UI test (verified live via Playwright MCP, both
roles); no backend change.

---

## What just shipped (0.39.0)

**M15 Preferences + Profile edit (Plan 8).** The per-user `/preferences` page
(§12), the `/employees/:id/profile` editor (§5), and the sibling
`/employees/new` create form restyled to the design with **zero backend change**
(every endpoint, payload, validation, permission byte-equivalent).

- **`/preferences` = two cards.** General (Language [2 locales] · Color-mode
  **radio-cards** Light/Dark/Match-system, styled via CSS `:has()` · the 0.29.0
  Palette swatch cards · Email checkboxes) + Password. One save still PUTs
  `{locale,colorMode,palette,email}`; locale change reloads. New: per-card
  **"✓ Saved" flash** (sage) replacing the success toast, and a **live
  password-match gate** (Change-Password disabled until current non-empty + new
  ≥ 8 + confirm matches, inline mismatch hint). A review-fix ensures the gate
  stays disabled after the flash timeout (the flash's `setTimeout` re-runs
  `refreshPwGate` via an `onComplete` arg). Must-change banner preserved.
- **`/employees/:id/profile` = four cards** (Identity · Role · Contact · Internal
  notes). 88px avatar with a deterministic per-user hue via CSSOM (`--hue` from
  the **display name**, matching the 0.37.0 detail/team pages). Role is
  **read-only as a badge** (no role-switch — Pica has no role-change endpoint);
  position keeps the employer-set permission. Save flash. Danger zone keeps the
  existing **hard Delete** (employer-on-others only). All machinery
  (picture resize/upload/remove, `PUT /api/employees/:id`, delete,
  `applyPermissions`, age display, back-link, 401/403/404) byte-identical.
- **`/employees/new`** switched its stylesheet to the shared
  `employee-profile.css` and adopted the card vocabulary (Account incl. role
  select — legitimate at creation; Identity/Contact/Internal-notes).
  `employee-new.js` unchanged (ids preserved); stale "(M11)" hint refreshed.

~10 new i18n keys/locale (+1 reworded); `CACHE_VERSION` v56 → v57. **No new test suite**
(stays 49). Note: the SW serves all CSS/JS **cache-first keyed by
`CACHE_VERSION`** (not just the `PRECACHE_URLS` subset), so the bump — not
precache membership — is what delivers the new CSS to returning clients.
**Verified live via the Playwright MCP** (both roles: prefs flashes + password
gate + palette/mode; profile 4 cards + avatar hue + picture + delete confirm;
create flow). Honest Disclosures (full list in RELEASES.md 0.39.0): role-switch
not built (read-only); no soft-deactivate (hard Delete); Role card titled
generically; 2 locales not 6; password gate is client UX only; `:has()` reliance;
`flashSaved` duplicated per page; no DOM/E2E tests (M16).

---

## What just shipped (0.38.0)

**M15 Settings + Security restyle (Plan 7).** The employer `/settings` page and
the standalone `/security` page rebuilt to the design with **zero backend
change** — every endpoint, payload, and validation is byte-equivalent.

- **`/settings` = 5-tab page** (Company · Organization · Notifications · Backups
  · Security). Sticky 220px icon-tab sidebar (honey active bar) on desktop;
  horizontal chip row on mobile (≤760px). Active tab persists as `?tab=<id>`
  (replaces the old `#hash` anchors); tab switch swaps the content container via
  `replaceChildren()` with an `AbortController` per tab. `settings.js` is a tab
  router + 5 per-tab renderers; the ~22 existing helpers (logo resize, blocked-
  range editor, override tables, SMTP form, backup list/create/delete/restore/
  schedule, lockdown banner) are ported byte-equivalent into the renderers.
- **Org tab consolidates** the old two save buttons into one "Save organization
  settings" (org form then working-time form, left-committed; error toast names
  the failing form). Per-card **"Saved ✓" flash** replaces the success toast;
  errors still toast.
- **Security tab is an entry card** → `/security` (no inline forms — keeps the
  recovery-lockdown screen minimal, per CLAUDE.md).
- **`/security` = three M15 cards** (change passphrase w/ confirm + match gate +
  `minlength` 8→12 on the new passphrase; recovery code generate/copy/done/
  remove; clay Danger-zone rotate w/ ROTATE gate). Endpoints + post-rotate 503
  lockdown unchanged.
- **Dropped from the prototype** (would have needed backend): Company **tagline**
  (no field), backup **Verify** button (no endpoint), Automatic/Manual chip (no
  origin flag on list entries). Override tables stay `<table>` (a11y +
  byte-equivalent collectors).
- **Lockdown banner improved:** a fresh load during post-restore lockdown
  (`/api/me` 503s) now detects state via the allowlisted `/api/backups/status`
  and shows the "restart Pica" banner (old page showed a blank shell).

~40 new `settings.*`/`security.*` i18n keys per locale; `CACHE_VERSION` v55 →
v56 (no new pre-cached asset). No new test suite (count stays 49). **Verified
live via the Playwright MCP** (all 5 tabs + `?tab=` routing + saves + `/security`
gates + mobile chips + post-restore lockdown banner; zero console errors in the
normal state — the 503s during lockdown come from the topbar shell, pre-existing).

---

## What just shipped (0.37.0)

**M15 employer home + team + employee detail (Plan 6).** The three
employer-facing screens — the employer side of `/`, `/employees`, and
`/employees/:id` — restyled to the design with zero backend change. New shared
**`team-status.js`** (pure, Node-importable): `pairSessions` / `workedMs` /
`breakMs` / `groupByEmployee` / `classify` / `STATUS_SORT` /
`BREAK_CUTOFF_HOUR=18`. Canonical status set **working / break / done / leave /
off** with a shared `.st-dot--*` palette across all three pages.

- **Employer home** = 4-card **stat strip** (Working / On break / On leave /
  Waiting on you — clickable; clay-soft alert when Waiting > 0) + **Team-today**
  card (everyone, sorted by status) + **Waiting-on-you** card (inline ✓/✗ for
  both leaves and corrections) + **Hours-this-week** card (org-wide serif total
  + delta vs last week + Mon–Fri bars). Old `dashboard-welcome` + 3 widgets +
  nav-cards markup removed (the sidebar has been the nav since 0.27.0). The
  employee-home branch (0.28.0) is byte-identical.
- **Team list** = **search** + status **chips** with live counts + a **table**
  (Person / Status / Week+bar / Today / pending dot). Rows are real `<a>` to
  the detail page. Per-employee week hours come from the existing
  `scope=all&type=week` reports matrix; today + status from
  `/api/punches/today`; pending from leaves + corrections fan-out.
- **Employee detail** = **hero** (88px avatar, serif name + role badge,
  position, status pill + today's segments, Reset-pw + Edit-profile actions),
  **3-up stat block** row (This week / This month / Today — serif `/ target` +
  progress bar + caption "missing Xh" or "on track"; today's daily target =
  week/5), **Recent days** (last 7 days with punches this month), **"Pending
  from {firstName}"** with inline ✓/✗ (reuses `leave-actions.js` for leaves;
  bare POST for corrections), **Upcoming leaves** (accent bar + type + dates +
  pill). New data from `/api/punches/by-employee/:id?date=today` and `?year&month`
  alongside the existing `/summary`.
- **Reset-password modal** migrated onto the shared `modal.js` shell (focus
  trap / Esc / backdrop); behavior byte-equivalent.
- **Heuristic "On break".** `classify` treats clocked-out-with-sessions before
  18:00 local as **break** and at/after 18:00 as **done**. Honest Disclosure:
  Pica can't truly distinguish "on a break, will return" from "gone home"; the
  18:00 cutoff is a fixed constant. Team-list week target is a flat 40h
  reference (no per-employee target from the reports endpoint). Recent-days
  window is current-month only (early-month views show fewer days). Missing-
  hours widgets folded into stat-block captions. No DOM/E2E tests (M16).

38 new i18n keys per locale; `employees.title` updated to "Team"/"Equipa";
`CACHE_VERSION` v54 → v55 (+precache `/team-status.js`); new suite
`test-team-status` (48 → 49).

---

## What just shipped (0.36.0)

**M15 calendar restyle (Plan 5).** `/leaves/calendar` rebuilt to the design.
Now shows **pending + approved** (was approved-only): employer bars = everyone's
`{pending,approved}` from `/api/leaves`; employee = own merged with anonymized
others from `/api/leaves/approved` (privacy unchanged). New **toolbar**
(◀▶ Today + serif month + type-filter chips + employee Mine|Team scope), grid
(today honey-circle, closed-day hatch, pills ≤3 + "+N more", pending dashed,
anonymized "Unavailable" blocks), an **anchored day popover** (flips/clamps;
bottom-sheet on mobile; employee "Request leave this day" → Plan-4 modal with
prefilled date), and a **320px right rail** (Out today/tomorrow + employee
balance card / employer pending-requests with inline approve/decline). Two new
**shared modules**: `calendar-grid.js` (`monthMatrix` — also now backs the
leave-detail mini-cal; `leave.js` refactored) and `leave-actions.js`
(approve/reject — `leaves.js` + the rail share it). 13 `calendar.*` i18n keys/
locale; `CACHE_VERSION` v53 → v54 (+precache the 2 shared modules); new suite
`test-calendar-grid` (47 → 48). **Verified live via the Playwright MCP** (employer
grid + popover + rail inline-approve→reload; employee Mine|Team + anonymized
privacy + balance card + request-this-day→modal-prefilled; mini-cal via shared
helper; **zero console errors**). Honest Disclosures (full list in RELEASES.md
0.36.0): employee view stays anonymized (no names/types for others); pending+
approved only (rejected/cancelled excluded); popover is viewport-clamped JS that
closes (not repositions) on scroll; no DOM/E2E tests (M16).

---

## What just shipped (0.35.0)

**M15 leaves restyle (Plan 4) — list + request modal + detail.** All three
leaves screens rebuilt to the design, every existing behavior preserved, four
extras added (all from existing endpoints — no backend change).

- **`/leaves`** split into role regions. *Employee:* "Your balance" 4 stat-blocks
  + "Your history" status tabs (counts) over status-accented rows. *Employer:*
  honey-outlined **"Pending approval" inbox** with a "N waiting on you" tag and
  **inline ✓/✗ per pending row** (NEW — approve reuses the `/overlaps`
  concurrency check + confirm; reject reveals an inline note; the list
  re-fetches so rows move to History and the tag/tabs recompute), a "Team
  balance" matrix, and an "All requests" tabbed list.
- **Request-Leave modal** (`request-leave-modal.{js,css}`, on the 0.32.0
  `modal.js` shell) replaces the `/leave-new` page: type cards, Full-days/Hours
  toggle, reason, file drop-zone + **balance-after summary**, **conflict box**
  (anonymized count for employees / names for employers), and a **success
  state**. `/leaves/new` → `302 /leaves?new=1` (auto-opens, strips query);
  `leave-new.{html,js}` deleted. Home / calendar buttons reach it via that
  redirect.
- **`/leaves/:id`** rebuilt: status-hero + Details/Reason/Attachment/Actions
  cards (attachment + approve/reject/cancel/revoke logic byte-identical) and a
  right column with a **mini-calendar** + **activity timeline**; duration now
  i18n-plural + `fmtDateTime`.

42 new i18n keys/locale; `CACHE_VERSION` v52 → v53 (+precache
`request-leave-modal.{js,css}`); new suite `test-leaves-render` (46 → 47).
**Verified live via the Playwright MCP** (employer inline approve + detail
hero/mini-cal/timeline; employee balance blocks, modal conflict box +
balance-after + success + `?new=1`; privacy held; **zero console errors** both
roles). Honest Disclosures (full list in RELEASES.md 0.35.0): half-day
morning/afternoon deferred (needs a backend unit-model change); the mini-calendar
duplicates Plan 5 calendar code (highlights only the start month of a spanning
leave); employee conflict box is a count only (privacy); home/calendar reach the
modal via redirect, not inline; no DOM/E2E tests (M16).

---

## What just shipped (0.34.0)

**Punch / topbar CSS polish** — two pre-existing bug fixes, no behavior change.
(1) **Topbar avatar CSP fix:** the shell built avatars with an inline
`style="--hue:…"` attribute that CSP `style-src 'self'` blocked → **2 console
errors on every authenticated page since 0.27.0**. The hue is now applied via
CSSOM `el.style.setProperty('--hue', …)` after the shell builds (CSP doesn't
govern CSSOM). **Zero console errors** (Playwright-verified); the per-user
avatar colour is preserved. (2) **`.sess__*` session-row styles:** added
`.sess__timeval` / `.sess__addr` / `.sess__comment-inline` rules to `punch.css`
(the inline comment was fully unstyled) and removed the dead full-row
`.sess__comment` (+ mobile override) — fixes session rows on **both** `/punch`
and `/punches/today`. `.sess__time--out` intentionally has no rule (base
`.sess__time` = neutral OUT). `CACHE_VERSION` v51 → v52; no new i18n or test
suite. Verified live via the Playwright MCP (console clean + computed styles).
See RELEASES.md 0.34.0.

---

## What just shipped (0.33.0)

**M15 employer `/punches/today` restyle.** The employer "everyone's punches
today" page is rebuilt to the M15 design: **per-employee cards** with a
person header (name/role), a **status pill** (sage "Working now" + pulsing
dot when they have an open session, else muted "Done for the day"), a mono
worked·break total, and their punches as **session pairs** (in → out, or
"Still working" for an open session) reusing the 3a `.sess` vocabulary
(`punch.css` is already linked here — no CSS duplication). Added a **tab
strip** (`Today` · `Corrections`→`/corrections`) mirroring the employee
sub-tabs. The renderer was rewritten to `createElement`/`textContent` only
(dropped the old `escapeHtml` + raw-HTML path — XSS surface closed). A small
local `pairSessions` helper does the in→out pairing (not shared with
`punch.js` to avoid its page side effects — a later cleanup). **No backend
change.** Reverse-geocoding/totals/sort/guard/empty all preserved. 5 new
`punchesToday.*` i18n keys (tabs + status) both locales; `CACHE_VERSION`
v50 → v51; no new test suite (count stays 46). **Verified live via the
Playwright MCP** (clock-in → "Working now" + "Still working" row; clock-out
→ "Done for the day" + paired In/Out; Corrections tab navigates). This
**completes the punches/corrections screen group**. Pre-existing
`topbar.js` CSP console errors persist (not this slice). See RELEASES.md
0.33.0.

---

## What just shipped (0.32.0)

**M15 manual-time modal + `/corrections/new` retirement.** Filing a manual
time correction is now a **reusable modal** (native `<dialog>`), not a
separate page. New generic shell `public/modal.js`+`modal.css` (backdrop /
Esc / focus-trap; the shell **Plan 4 request-leave will reuse**) and
`public/manual-time-modal.js`+`manual-time-modal.css` (the form — ported
verbatim from the old page, **self-styled** with `mtm-` classes so it works
on pages that don't link `corrections.css`, e.g. punch). Exposes
`openManualTimeModal({ onFiled })`. Wired into the corrections list
("Register manual time" → opens modal; `onFiled` re-fetches so the new
pending row + tag appear) and the punch page ("Forgot to clock?" / "Missing
a punch?"). `/corrections/new` now `302`→`/corrections?new=1` (auto-opens
the modal, strips the query); `correction-new.{html,js}` deleted and the
dead `.kind-fieldset`/`.kind-radio` removed from `corrections.css`
(`.form-actions` kept — reject dialog uses it). One-line route change; no
other backend change. 2 new i18n keys (`modal.close`, `manualTime.filed`)
both locales; `CACHE_VERSION` v49 → v50 + 4 modal assets precached. **No new
test suite** (count stays 46). **Verified live in a browser via the
Playwright MCP** (open→fill→submit→filed→close→list refresh; redirect
auto-open; Esc close; both entry points) — but the automated in-repo E2E
suite is still M16. Pre-existing items noted, not fixed: `topbar.js` runtime
inline-style CSP console errors (since 0.27.0); detail-page `correction.js`
local date/hour formatters (should use `/i18n.js`). See RELEASES.md 0.32.0.

---

## What just shipped (0.31.0)

**M15 corrections list + detail restyle.** `/corrections` and
`/corrections/:id` rebuilt to the M15 design, **preserving every decide
flow** (file / approve / reject-with-note / cancel / reverse;
justified/unjustified; materialized punches; server-enforced employee
privacy). List: status-accented rows (honey/sage/clay/muted bar, mono
dates, kind + justification chips, status pill, hours) in **Pending** +
**History** cards; the row is still a real `<a>` (keyboard / middle-click /
SR link). **New behavior:** employer **inline approve/decline** on pending
rows (✓/✗ → the existing `POST /api/corrections/:id/{approve,reject}`;
double-submit-guarded + `stopPropagation`; the list re-fetches so the row
moves to History and the "N waiting on you" tag recomputes). Detail:
**status-hero** card + Details/Reason/Actions cards (Leave-detail
vocabulary); only `render()` + markup/CSS changed — decide logic is
byte-identical. **No backend changes.** 14 new `corrections.*`/
`correction.*` i18n keys both locales; `CACHE_VERSION` v48 → v49; no new
test suite. **Deferred to 3b-ii / 3b-iii** (next): the manual-time
**modal** + `/corrections/new` restyle, and the employer `/punches/today`
view — "Register manual time" / "Forgot to clock?" still open the pre-M15
new-entry page. See RELEASES.md 0.31.0.

---

## What just shipped (0.30.0)

**M15 employee punch (clock) page.** `/punch` rebuilt to the design:
clock hero (status pill + live mono readout + location chip + check-in/out),
a **sub-tab strip** (Today/This-week panels on-page; **My corrections**
links to `/corrections`), session-pair rows (with missing-punch hints),
and a new **This week** panel (own prior-day sessions grouped by day, from
`/api/punches/by-employee`). **All machinery preserved**: geolocation,
the offline punch queue, the OSM map preview, reverse-geocoding, break
totals (`punch.js`'s ~18 machinery functions are byte-identical; only
`renderList` markup + `paintStatus` output changed, plus additive
week/tabs). New `punch.*` i18n keys; CACHE_VERSION v47→v48; new
`test-punch-week` suite. **Deferred to plan 3b** (next): `/corrections`
restyle + the manual-time **modal** + employer `/punches/today` &
corrections inbox/History; "Forgot to clock?" currently links to
`/corrections/new`. `punch.js` keeps its own geo copy (unified with
`/geo.js` in the final cleanup). See RELEASES.md 0.30.0.

---

## What just shipped (0.29.0)

**M15 preferences — color-palette picker.** Preferences gains a
**Palette** section: three swatch cards (Linen / Slate / Olive), each
with a 4-chip preview (bg · primary · success · alert) that **swaps with
the selected color mode**. `palette` is now a real user pref
(`src/storage/user-prefs.js`: enum linen/slate/olive, default linen,
validated; `PUT /api/settings/me` already passes it through). Saving
persists it and applies app-wide via the 0.27.0 `data-palette` cascade +
the existing bootstrap/`app.js` (`pica-palette`). New `prefs.palette*`
i18n keys both locales; `CACHE_VERSION` v46→v47. Non-obvious: palette +
mode apply **on Save** (not live); preview chip hex is hardcoded in
`preferences.js` (mirrors `app.css`'s 6 combos — keep in sync); the rest
of the Preferences page is still pre-M15 (full redesign is a later plan).
This was pulled forward from the Preferences plan at the operator's
request. See RELEASES.md 0.29.0.

---

## What just shipped (0.28.0)

**M15 employee home — functional clock hero.** The employee landing
page (`/`) is rebuilt to the design: greeting + live clock, a
clock-in/out **hero that actually clocks** (one tap → real punch via
`POST /api/punches/clock-in|clock-out`) with today's worked total +
session timeline, a "This week" card (Worked/Target/Remaining + Mon–Fri
bars from `GET /api/reports/timesheets?scope=me&type=week`), and an
upcoming-leaves card. New shared `public/geo.js` (fast best-effort
geolocation + `clockPunch`) records punch location; punch errors use
`toast()`. **Employer home unchanged** (later plan). `CACHE_VERSION`
v45→v46 (+`/geo.js`); new `home.*` i18n keys both locales; new suite
`test-employee-home`. Non-obvious / deferred: `geo.js` transitionally
duplicates `punch.js`'s fast-geo (Punches plan unifies them); week bars
are Mon–Fri only; week/today use UTC dates; pre-existing employer
`widgetError` inline-style + shell `.mono` crumb gap noted for later
M15 cleanup. See RELEASES.md 0.28.0.

---

## What just shipped (0.27.0)

**M15 foundation — design tokens, self-hosted fonts, new shell.**
Every existing page re-skins immediately via a compatibility bridge;
the 13 screen bodies are rebuilt in later M15 plans.

**Design-token cascade.** `app.css` carries a `[data-theme]` ×
`[data-palette]` cascade with 6 combos (Linen/Slate/Olive × Light/Dark).
A pre-M15 alias bridge maps the old names (`--accent`, `--surface`,
`--text`, …) onto the new tokens — intentional transitional debt removed
in the final M15 cleanup plan.

**Self-hosted fonts.** Instrument Serif (headings), DM Sans (UI text),
JetBrains Mono (monospace) as 8 woff2 files under `public/fonts/`.
`@font-face` in `app.css`; `font-src 'self'` CSP unchanged. The woff2
files are **committed to the repo** — a clean checkout already has them.
`scripts/fetch-fonts.mjs` exists to refresh them if needed (needs
network). Licenses: SIL OFL, redistribution permitted.

**New bootstrap.** All 21 HTML files' inline `<script>` resolves both
`data-theme` (light/dark/system) and `data-palette` on `<html>`
synchronously, byte-identical across all 21 files (one CSP hash). `app.js`
also applies `palette` from server prefs (defensive: palette pref field
wired in the Preferences M15 plan).

**New shell.** `topbar.js` + `topbar.css` rebuilt: desktop fixed sidebar
(brand + icon nav + user-tile popover) + content top-bar (crumb + bell);
mobile top app-bar + bottom nav + drawer. `mountTopBar()` / `mountFooter()`
signatures unchanged — no other page edited. New nav/menu/crumb i18n keys
in both locales. CACHE_VERSION v44 → v45; 8 fonts in SW pre-cache list.

**3 new suites** (`test-theme-tokens`, `test-theme-bootstrap`,
`test-sw-precache`). Test count 41 → 44. See RELEASES.md 0.27.0 for
the full Honest Disclosures (foundation only, alias bridge debt, static
bell, fonts committed, no CSS fallback for dark mode, etc.).

---

## What just shipped (0.26.0)

**Encrypted settings-managed SMTP config.** SMTP credentials moved out
of the plaintext `mail` block in `config.json` (the unpushed 0.25.0
design) into a single **AES-256-GCM-encrypted blob** keyed by the DEK
(`config.json` `"mail": { "enc": "<base64>" }`, AAD
`pica-mail-config-v1`). The app password no longer sits in plaintext on
disk. Credentials are now edited from **Settings → Email
notifications**, which gained an SMTP editor form and was reordered to
sit **before** Backups (company → organization → notifications →
backups → security).

New `src/storage/mail-config.js` owns the blob (decrypt-on-construct,
in-memory cache, **never throws**, `pass` **write-only**, `write()` is
**abort-not-clobber** so a transient read failure cannot destroy
`security.wraps`). `src/config.js` no longer parses mail
(`normalizeMail` / `config.mailConfigured` removed; `config.mail` is a
raw passthrough). The mailer reads creds from the store
(`isConfigured()` is its Layer-1 gate). New employer-only
`PUT /api/settings/mail` (audited `settings.mail_updated`, no details);
`GET /api/settings/org` returns a sanitized `mail` publicView
(`{enabled,host,port,secure,user,from,hasPassword}` — never `pass`) +
`mailConfigured`. CACHE_VERSION v43 → v44; 15 new i18n keys per locale;
one new suite (`test-mail-config-store`). 0.25.0 stays in history
unchanged; **no migration** from the never-shipped plaintext block. See
RELEASES.md 0.26.0 for the full Honest Disclosures (not in backups,
unavailable during lockdown, runtime config.json mutation, write-only
pass, etc.).

---

## What just shipped (0.25.0)

**Email notifications (M14).** Pica can now send plain-text
notification emails through the operator's own authenticated SMTP
relay over TLS via a new in-house, dependency-free submission client
(`src/mail/smtp.js`) — Pica only *submits*, it never receives mail.
Three notification categories — **leave decision**, **correction
decision**, **24h-before-leave reminder** — plus an informational
**password-reset notice**.

Delivery is gated by **org-level master switches** (employer /
Settings → Email notifications) AND **per-user opt-outs** (both roles
/ Preferences). The password-reset notice deliberately bypasses both
layers (a user must learn their password changed) and is gated only
by `config.mail.enabled` + a recipient address.

Mail is **off until the operator opts in**: a new optional `mail`
block in `config.json` (absent / `enabled:false` → no mail, no
behaviour change). New `POST /api/mail/test` (employer-only config
probe); `GET /api/settings/org` now also returns a safe
`mailConfigured` boolean. A reminder scheduler scans approved leaves
and stamps a `reminder_sent` leaves event (via `markReminderSent`) so
it never double-sends. Best-effort throughout — a failed send is
logged and swallowed; the in-app state + audit log are authoritative.
CACHE_VERSION v42 → v43. See RELEASES.md 0.25.0 for the full Honest
Disclosures (no retry/queue, App-Password-only auth, plaintext SMTP
creds in config.json, no MTA-STS/DANE, etc.).

---

## What just shipped (0.24.0)

**Reports revamp (M13).** The Reports page is rebuilt around two
report types — **Timesheets** and **Leaves** — each runnable for
**everyone** (employer only) or **one person**, over **Day / Week /
Month / Year** period presets with ◀/▶ navigation. The combined view
is a matrix (period buckets × employees + axis totals). Print-friendly
(browser Print → "Save as PDF", landscape print stylesheet); CSV
export for every shape. Employee-isolation is **server-enforced**:
`scope=all` from a non-employer is refused at the route.

New endpoints: `GET /api/reports/timesheets` and
`GET /api/reports/leaves` (`scope=me|all`, `id`, `type`, `anchor`,
`format=csv`). **Removed** (now 404, no shim): `/api/reports/summary`,
`/api/reports/team-hours`, `/api/reports/hours/:id[.csv]`,
`/api/reports/leaves/:id[.csv]`. `period.js` extended additively
(`computePeriod`/`ymdOf`/`isWeekday` unchanged, still power the
dashboard summary). CACHE_VERSION v41 → v42. See RELEASES.md 0.24.0.

---

## What just shipped (0.23.1)

**Security page discoverability.** The standalone `/security` page
(unchanged) now has a proper entry point: a **Security** card at the
end of the Settings page with a full-width button, plus a "Security"
pill in the Settings section-nav. Removed the stray text link that
used to sit above the Settings cards. No backend, route, or recovery-
flow change — `/security` stays a separate minimal page on purpose so
the recover-with-code lockdown screen only touches the allowlisted
passphrase endpoint. See RELEASES.md 0.23.1.

---

## What just shipped (0.23.0)

**Master key management** — envelope encryption, passphrase change,
key rotation, recovery code, and wipe-reset. New **Settings →
Security** page (employer-only).

The master key is now a two-layer scheme: a random **DEK** (data-
encryption key) that encrypts all data on disk, wrapped under a
**KEK** derived from the passphrase via scrypt. The DEK is stored
(wrapped, AES-256-GCM) in `config.json` under a `security.wraps`
array. Multiple wrap slots support both the passphrase (slot 0) and
an optional recovery code (slot 1).

**Migration is zero-touch:** on first boot after upgrading, the legacy
scrypt output is frozen as the DEK — no data file is re-encrypted.

**Operations shipped:**
- `POST /api/security/passphrase` — change passphrase (re-wraps DEK, no data re-encryption)
- `POST /api/security/recovery-code` — generate 32-char (160-bit, 8 groups of 4) Crockford base32 recovery code (shown once)
- `DELETE /api/security/recovery-code` — remove recovery code (requires passphrase)
- `POST /api/security/rotate` — generate new random DEK, re-encrypt all data, lockdown + restart
- `PICA_RESET=1` boot — wipe reset (moves data aside, never deleted)
- `PICA_RECOVERY_CODE=<code>` boot — recover forgotten passphrase, forces new passphrase

**4 new audit events:** `security.passphrase_changed`,
`security.recovery_code_set`, `security.recovery_code_removed`,
`security.key_rotated`. Wipe-reset and recovery-code unlock are
boot-time operations and are logged via the regular logger only.

**5 new test suites** (48 cases): test-dek (11), test-keyring (8),
test-rotate (3), test-masterkey-envelope (10), test-security-routes (16).
CACHE_VERSION → v40. Total: 33 suites, 706 tests.

Non-obvious (full list in RELEASES.md): losing config.json is
unrecoverable; old backups break after rotation; rotation is forward-
only; body parsing now runs for DELETE requests globally; DELETE body
widening is harmless for all existing DELETE routes.

## What shipped in 0.22.17

Bugfix. The Organization setting "Allow multiple employees on
leave at the same time" was advisory only — when off it merely
warned the employer at approval; employees could still book a
vacation overlapping a colleague's approved leave. Now
`POST /api/leaves` enforces it: with the setting off, an
employee request sharing any calendar day with another
employee's **approved** leave is refused with HTTP 400
`leave_overlaps`. Employer and sick leave are exempt (same
rationale as blocked-days 0.22.15). Approval stays advisory
(employer's final call), by design.

New pure helpers `leavesShareADay` / `findConcurrentApprovedLeave`
exported from `src/storage/leaves.js`. The orphan
`errors.leave_overlaps` message (was unused + inaccurate) was
rewritten. New suite `test-leaves-concurrent.mjs` (17 cases).
CACHE_VERSION → v38 (locale files pre-cached).

## What shipped in 0.22.16

Bugfix. `PUT /api/employees/:id/picture` returned a 500
(`missing_required_field: fullName`) when the employee had no
profile yet: the route auto-created an empty profile, and
`create({})` throws since profile fields became mandatory
(0.22.6). Now: no profile → **HTTP 400 `profile_required`**
with a translated, actionable message; `writePicture` wrapped
so the endpoint can never 500; frontend runs the upload error
through `translateError`. New route-level suite
`test-employee-picture-route.mjs` (5 cases). CACHE_VERSION →
v37 (locale files pre-cached).

Design note: a picture is only ever shown beside profile data,
so requiring the profile first is intended — the fix turns the
crash into a clear message, it does not make pictures
standalone.

## What shipped in 0.22.15

**Blocked days** — employers define date ranges on which
employees cannot book leave (company events, all-hands, peak
periods). Three surfaces: a Settings → Organization editor
(add/remove ranges + optional label), enforcement on
`POST /api/leaves` (HTTP 400 `leave_day_blocked`), and the
leave calendar (amber hatch + tag + legend + details row).

Two exemptions by design: **sick leave is never blocked**
(non-discretionary) and **the employer is never blocked**
(they set the policy). All other types refused for employees.

Data: `org-settings.json` → `leaves.blockedRanges`
`[{start,end,label}]`, plaintext, ≤200 entries, validated +
sorted on write, malformed entries dropped on read. Pure
helpers `findBlockingRange` / `isValidYmd` exported from
`src/storage/org-settings.js`. `GET /api/leaves/approved` now
also returns `blockedRanges` (calendar transport; no new
endpoint). New suite `test-leaves-blocked.mjs` (24 cases).
CACHE_VERSION → v36 (locale files pre-cached).

Key non-obvious decisions (full list in RELEASES.md): existing
approved/pending leaves on a newly-blocked day are left
untouched; approve does NOT re-check (gate is at creation);
no recurring/bulk blocks; hard-refuse (no soft-warn mode);
edits ride the existing `settings.org_updated` audit event.

## What shipped in 0.22.14

Follow-up to 0.22.13. The employer's home-page widget
"Working today" now appends `· pausa Xh Ym` (pt-PT) /
`· break Xh Ym` (en-US) to each employee's row detail when
they have same-day break time. Applies to both the "Currently
working" section (e.g. `since 13:00 · pausa 1h 0m`) and the
"Done for the day" section (e.g.
`09:00–12:00, 13:00–18:00 · pausa 1h 0m`).

Implementation: reuses `breakMsFromGroup(g)` added in 0.22.13.
No new locale strings (reuses `punch.todayBreak`).
CACHE_VERSION → v35 (index.js pre-cached).

This reverses the 0.22.13 Honest Disclosure that left the
employer widget without break — operator wanted parity with
the employee widget.

## What shipped in 0.22.13

Two display tweaks for break time:

1. **Home-page widget for employees** now shows a break-time
   caption under the big-number worked-hours when there's
   break > 0. Uses the existing `punch.todayBreak` key so it
   reads "break 1h 0m" in en-US and "pausa 1h 0m" in pt-PT
   without new locale strings.
2. **`formatDuration()` on `/punch` is now localized.** The
   "5 hours / 1 hour / 30 minutes / less than a minute" strings
   were hardcoded English; they now go through `t` / `tn`. New
   keys: `punch.durLessThanMinute`, `punch.durMinutes` plural,
   `punch.durHours` plural. pt-PT: "menos de um minuto", "{n}
   minutos", "{n} horas".

New helper `breakMsFromGroup(g)` in `public/index.js` mirrors
the helpers in `punch.js` / `punches-today.js` but works
against the `{ pairs, openInPunch }` shape that
`groupPunchesByEmployee()` produces. CACHE_VERSION → v34
(index.js, punch.js, and both locales pre-cached).

The employer "Working today" widget on the home page does NOT
show per-employee break — out of scope. Employers see per-row
break on `/punches/today` instead.

## What shipped in 0.22.12

Follow-up to 0.22.11. The employer's `/punches/today` page now
shows per-employee break time next to the worked-hours total
in each group header. Same `punch.todayBreak` translation key
from 0.22.11 (en-US "break {dur}" / pt-PT "pausa {dur}") — no
new locale strings.

Implementation: `breakMs(punches)` helper in
`public/punches-today.js` mirroring the one in `public/punch.js`.
The compact `humanDuration()` already used on this page is
reused for the break segment, so worked + break share one
format on the employer view ("8h 0m · pausa 1h 0m").

No CACHE_VERSION bump: `punches-today.js` is not in the SW
pre-cache list (runtime network-first handles it). No new
tests: the algorithm is byte-identical to the helper covered
by `tests/test-punch-totals.mjs` (0.22.11).

Hours reports still don't surface break — same scope decision
as 0.22.11.

## What shipped in 0.22.11

The `/punch` page now shows total break time alongside total
worked time when there are two or more sessions on the same
day. Example: in 09:00, out 12:00, in 13:00, out 18:00 →
`8 hours / 8h · break 1 hour`. Single uninterrupted sessions
look exactly as before (`8 hours / 8h`).

New `totalBreakMs(punches)` helper in `public/punch.js` mirrors
the existing `totalWorkedMs()` pairing logic — sums out→next-in
gaps. New translation key `punch.todayBreak` in both locales.
CACHE_VERSION → v33 (punch.js + locales pre-cached).

New test suite `tests/test-punch-totals.mjs` covers the user's
9/12/13/18 case, single sessions, three sessions with two
breaks, server-newest-first input, open trailing session, and
empty list — 6 cases. Tests follow the test-i18n.mjs pattern of
re-implementing the function inline (Node can't import absolute
browser paths).

The employer's `/punches/today` view did not surface break in
0.22.11 — that gap was closed in 0.22.12.

## What shipped in 0.22.10

Bugfix following the 0.22.9 punch-address feature: the OSM map
preview on `/punch` was rendering broken in strict browsers
because the CSP `img-src` directive (`'self' data: blob:`)
blocks `https://tile.openstreetmap.org`. This was a pre-existing
issue from M12.2 (0.20.0) that 0.22.9 disclosures flagged.

Fix: `img-src` extended to allow the OSM tile host. No other
CSP directive changed; `connect-src` keeps its Nominatim
allowance from 0.22.9. No frontend files changed; no
`CACHE_VERSION` bump (CSP arrives fresh on every HTTP response).

## What shipped in 0.22.9

Punches now render an approximate **address** instead of raw
lat/lng wherever a geo block is shown — the today list on
`/punch`, the meta line under the OSM map preview, and the
employer's `/punches/today` view.

New browser-side helper `public/geocode.js` calls OSM Nominatim
(`https://nominatim.openstreetmap.org/reverse`) with a 30-day
localStorage cache and a 1.1 sec throttle. Coordinates are
rendered immediately as the fallback; the address swaps in when
the response arrives. On error / offline / rate-limit the coords
just stay — no error UI.

CSP `connect-src` extended to allow Nominatim. No backend
changes; the encrypted `geo` payload on disk is unchanged.

**Privacy trade-off**: each unique punch location reveals itself
to OSM (cached aggressively so each rounded location costs one
request, ever). Documented in RELEASES.md with mitigation paths
(self-host Nominatim, or revert by removing the `reverseGeocode`
call sites). Future drop could expose this as an org-settings
toggle.

CACHE_VERSION → v32 (punch.js is pre-cached).

## What shipped in 0.22.8

The "time bank" feature is gone. Approved unjustified corrections
no longer accumulate as "uncredited hours owed". The signal that
metric tried to provide is now a "missing hours" number computed
directly from punches: `max(0, scheduled - worked)`.

Manual corrections themselves are unchanged — file with or
without justification, approve still materializes the in/out
punches the same way. What's removed: `computeBank`,
`/api/corrections/bank` and `/api/corrections/bank/:userId`,
`bankHours` on the summary endpoint, the bank widget on dashboard
and per-employee summary, the bank card on `/corrections`, the
"+Xh to bank" chip per row, the live bank-warning callout on the
new-correction form, plus 19 i18n keys per locale.

What's added: a `missing` field on every team-hours row, week +
month `missing` on the per-employee summary, two new widgets
("Missing this week" / "Missing this month") replacing the bank
widget on the per-employee summary, a "Missing" column on the
reports team table (red+bold when non-zero, muted "—" when
clean).

Important: missing-hours is **not** adjusted for approved leaves.
A vacation week shows as "missing"; the operator is expected to
cross-check the upcoming-leaves block.

Tests: -9 bank tests in test-corrections.mjs, +2 missing tests in
test-reports-team.mjs, refactored employees-summary tests around
the new shape. Total 575 tests across 23 suites. CACHE_VERSION → v31.

## What shipped in 0.22.7

Mobile readability fix for the team calendar. The ≤600px
breakpoint had been hiding `cal-bar__name` to fit, leaving phone
users with colored stripes only identifiable via the bottom
legend. Symptom: "cannot read details" on mobile.

New details panel sits between the grid and legend. Tap any day
cell with leaves on it; the panel opens and lists each leave on
that day with name, type, range, and a link through to the leave
detail page (when the viewer is owner or employer). Tap the
selected day again to close, or tap × button. Month navigation
closes the panel. Anonymized rows (employee viewing other
employees' leaves) render as italic "Unavailable" rows with
range only, non-clickable.

Tap routing: delegated handler on `.cal-grid`. Desktop bars keep
their `<a>` navigation; the cell handler bails when the click
landed on a `.cal-bar`. On mobile, bars carry
`pointer-events: none` so every tap reaches the cell — single-
purpose mobile interaction. Selected day gets a
`.cal-day--selected` outline.

CACHE_VERSION → v30 (locale files added a new aria-label string).
No backend changes; no new test files. `frontend-imports` picked
up the new `fmtDate` import (counter unchanged externally).

## What shipped in 0.22.6

Profile fields are now mandatory except `comments`. The list:
`fullName`, `dateOfBirth`, `position`, `address`, `contactEmail`,
`contactPhone`. `comments` stays optional.

Enforced both client-side (HTML5 `required` on the inputs in
`employee-new.html` and `employee-profile.html`) and server-side
(new `MANDATORY_FIELDS` export + validators in
`src/storage/employees.js`). On `create`, all required fields
must be present. On `update`, only fields *included in the patch*
are validated — pre-existing empty profiles don't block unrelated
saves (migration-friendly).

Error shape: `400 missing_required_field` with the field name in
the message; new i18n key `errors.missing_required_field` ("Please
fill in all required fields."). `applyPermissions()` in
`employee-profile.js` now also drops `required` from readonly
fields when the viewer is an employee (otherwise empty pre-
existing `position` would block save).

6 new tests in `test-employees.mjs` ("Mandatory fields (0.22.6)"
section). Total: 23 suites, 580 tests. CACHE_VERSION → v29.

## What shipped in 0.22.5

Vacation carry-forward landed for real. The `carryForward` toggle
in org-settings has stored a boolean since M7 but no logic ever
consumed it ("Carry-forward is deferred" — comment now deleted).

`computeBalances()` now adds unused approved year-N-1 vacation as
a `carryIn` field on the year-N row, capped at the base allowance.
A new `leaves.carryForwardExpiresAt` setting (MM-DD, default
`03-31`) drops the carry to zero each year on the configured
date. Pending year-N-1 leaves are ignored — they reduce N-1's
booked total only when approved, so carry recomputes naturally.

`effectiveAllowance` (= allowance + carryIn) is the new cap used
by `wouldExceedCap`. `remaining` semantics changed accordingly:
`effectiveAllowance - pending - booked` (was `allowance - …`).

UI: settings page has a new MM-DD input next to the carry-forward
checkbox. Leaves balance table shows "+5" green badge next to
base allowance when carry-in > 0, with a tooltip naming the
expiry date. Employer balance matrix denominator is now
effective allowance.

New test suite `tests/test-leaves-carry.mjs` (11 tests) plus 3
new tests in `tests/test-org-settings.mjs` for the validator.
Total: 23 suites, 572 tests. CACHE_VERSION → v28.

## What shipped in 0.22.4

Same-day patch on top of 0.22.3. Privacy tightening.

**Employees no longer see other employees' leave details.**
`GET /api/leaves/approved` previously returned full data (name,
type, dates) for every approved leave to every authenticated
user. Now: employers still see everything; employees see full
data for their OWN leaves and only `id + start + end + unit +
anonymized: true` for others. `employeeId`, `username`,
`fullName`, `type`, `reason`, `notes` are all stripped
server-side for non-self leaves seen by an employee.

The team calendar still works for employees as a capacity
planner — other people's leaves render as generic
`.cal-bar--anonymized` blocks ("Unavailable" / "Indisponível"),
non-clickable. The dashboard "on leave today" widget was
already employer-only, so no change there.

New test suite `tests/test-leaves-approved.mjs` (4 tests) locks
in the privacy contract. Total now 22 suites / 558 tests.

## What shipped in 0.22.3

Same-day patch on top of 0.22.2. Single bugfix.

**Leave-new submit now actually shows server errors.** The
non-OK branch in `public/leave-new.js` was calling
`result.translateError(data.errorCode, data.error)` — but
`translateError` is imported from `/i18n.js` (not a method on
`result`) and `data` was never defined (should be `result.data`).
The expression threw `TypeError`, the async handler's rejection
went unhandled, and the user saw the submit button stuck on
"Submitting…" with no message. Most common trigger:
`400 leave_cap_exceeded` when a user hit their annual allowance.

Fixed by switching to the canonical pattern used in `punch.js`,
`login.js`, and `correction-new.js`:
`translateError(result.data.errorCode, result.data.error || t('leaveNew.couldNotSubmit'))`.
Added the `leaveNew.couldNotSubmit` fallback in both locales.
`CACHE_VERSION` bumped to `v26` (locale files are pre-cached).

Localhost couldn't reproduce because the dev account had
unused allowance — the bug fires only when the server returns
any error, and the cap-exceeded path was the most user-visible.

## What shipped in 0.22.2

Same-day patch on top of 0.22.1. Single UX fix.

**Clock-in/out no longer blocks on geolocation.** The click path
previously called the thorough `getGeo()` (15 s + 20 s two-attempt
budget) on every punch. On a desktop without a usable location
source the button sat at "Working…" for up to 35 seconds before the
punch went through, and users assumed it was broken.

The click path now reuses the in-session `lastFix` when present, or
calls a new `getGeoFast()` with a 3-second hard budget, or punches
with `geoSkipReason` set. The server already accepted no-geo
punches — backend unchanged. The thorough `getGeo()` stays for the
page-load map preview and the explicit Retry button.

About re-prompting a blocked permission: browsers don't allow it
programmatically — that's a platform security boundary. Once the
user has blocked location for the site, only manual site-permissions
changes can re-enable it. Pica detects the denied state and stamps
`geoSkipReason: 'denied'` on the punch; the punch still goes through.

## What shipped in 0.22.1

Same-day patch on top of 0.22.0. Single bugfix, no new features.

**"View my profile" no longer dead-ends employees.** The avatar-menu
link in `public/topbar.js` and the `/profile` redirect in
`src/routes/pages.js` both pointed at `/employees/<id>` (the
employer-only summary page). Employees clicking the link got a 403
from the summary API and were bounced to `/` by `employee.js`. Both
entry points now target `/employees/<id>/profile`, which uses
`requireOwnerOrEmployer` and serves the profile editor for both
roles. `CACHE_VERSION` bumped to `v24` (topbar.js is pre-cached).

Bug was reachable in 0.16.4 through 0.22.0 — the entire window
since the profile editor was split out from the summary page. No
security implications.

## What shipped in 0.22.0

The release that closed M12 with the input validation drop. Two
material changes:

1. **Path-traversal vulnerability patched** in `PUT /api/employees/:id/picture`.
   Was exploitable in 0.16.4–0.21.0 by authenticated employers
   sending URL-encoded `../` in the `:id` path parameter. Fix landed
   at two layers: route-level UUID validation via new
   `rejectIfBadId` helper; storage-level UUID validation in
   `src/storage/employees.js` path helpers. The advisory is in
   `RELEASES.md` and `docs/security.md`.

2. **Locale-aware hour formatting.** New `fmtNumber()` and `fmtHours()`
   in `public/i18n.js`. Eleven hour-display call sites migrated from
   ad-hoc `toFixed(1)` / `Math.round * 10 / 10` patterns. en-US shows
   `8.5`, pt-PT shows `8,5`.

Plus: length caps (500 chars) added to `leave.reason` and
`leave.notes`. Matches existing convention from punch.comment etc.

---

## Roadmap state

| ID    | Description                              | Status |
|-------|------------------------------------------|--------|
| M0–M9 | Core features, i18n                      | ✅ shipped |
| M10   | Dashboard widgets                        | ✅ shipped |
| M11   | Encrypted backups (create/restore/sched) | ✅ shipped |
| M12.1 | Hardening — passwords                    | ✅ 0.19.0 |
| M12.2 | Hardening — CSP + security headers       | ✅ 0.20.0 |
| M12.3 | Hardening — audit log                    | ✅ 0.21.0 |
| M12.4 | Hardening — input validation + numfmt    | ✅ 0.22.0 |
| —     | Profile-link bugfix (patch)              | ✅ 0.22.1 |
| —     | Punch non-blocking geolocation (patch)   | ✅ 0.22.2 |
| —     | Leave-submit error display (patch)       | ✅ 0.22.3 |
| —     | Leaves privacy for employees (patch)     | ✅ 0.22.4 |
| —     | Vacation carry-forward + MM-DD expiry    | ✅ 0.22.5 |
| —     | Mandatory profile fields                 | ✅ 0.22.6 |
| —     | Calendar mobile day-details panel        | ✅ 0.22.7 |
| —     | Time bank removed; missing-hours added   | ✅ 0.22.8 |
| —     | Punches show approximate address         | ✅ 0.22.9 |
| —     | CSP fix: OSM map tile renders again      | ✅ 0.22.10 |
| —     | Same-day break time on the punch page    | ✅ 0.22.11 |
| —     | Break time on the employer's today view  | ✅ 0.22.12 |
| —     | Break on home widget + i18n duration words | ✅ 0.22.13 |
| —     | Break on employer "Working today" widget | ✅ 0.22.14 |
| —     | Blocked days (employer no-leave dates)   | ✅ 0.22.15 |
| —     | Fix: picture upload 500 → 400 + message  | ✅ 0.22.16 |
| —     | Enforce no-concurrent-leave at booking   | ✅ 0.22.17 |
| —     | Leave justification file attachments     | ✅ 0.22.18 |
| —     | Master key management (envelope enc, passphrase change, rotation, recovery code) | ✅ 0.23.0 |
| M13   | Reports revamp                           | ✅ 0.24.0  |
| M14   | Add email notifications                  | ✅ 0.25.0  |
| M15   | Full UI revamp                           | ✅ 0.41.0 (closed) |
| M16   | E2E browser tests (Playwright)           | 📋 planned |
| M17   | Deployment guide + TLS samples           | 📋 planned |

**Order matters.** M17 (deployment guide) is deliberately last so it
describes the final security posture rather than a moving target.
M16 (Playwright E2E) introduces the project's first npm dependency, a
significant architectural decision to discuss with the operator
before starting, and lands after M15 so it tests the post-revamp UI.
(This table previously listed only M13/M14 with stale titles; it now
matches the authoritative numbering in `docs/roadmap.md`.)

**Deferred:** CSRF tokens. `SameSite=Lax` cookies already provide
solid CSRF protection for this threat model. Documented in
`docs/security.md`.

---

## Pending work (no specific commitment yet)

These were considered during M12 but didn't make any drop. None
are blockers. Each is logged here so future-you doesn't re-discover
them.

### Audit log viewer UI
The audit log (M12 Drop 3) is on-disk only. Reading it requires the
master key and a Node REPL — there's a recipe in `docs/security.md`.
A future drop could add `/api/audit/recent` (employer-only) and a
viewer page. Not urgent; operators investigating incidents can use
the recipe.

### X-Forwarded-For trust for audit log
The `actorIp` field comes from `req.socket.remoteAddress`. Behind a
reverse proxy this is always `127.0.0.1`. Adding `X-Forwarded-For`
trust would require a configurable trusted-proxy list. Not done
because the threat model doesn't justify it; operators who need
real client IPs should log them at the proxy.

### Audit log retention/rotation
Files rotate by month but never by size. A pathological abuser
triggering a million failed logins in one month would balloon that
month's file. Acceptable at the expected scale (≤ 50 employees).
Adding size-based rotation is straightforward but unnecessary.

### Length caps could be loosened with care
500 chars on free-text fields might be tight for some users (e.g.
medical leave reasons). The cap was chosen to match existing
punch.comment convention. Operators who need longer reasons can
patch the limit in a fork; raising it generally would require
revisiting storage-bloat trade-offs.

### Number formatting edge cases
`fmtHours` rounds at the half-tenth boundary using JavaScript's
`Math.round`. For UI display this is fine. Raw values are always
stored as-is in the underlying records.

### Empty-string return for non-finite hours
`fmtHours(NaN)` returns `''`. UI cells render as `"h"` instead of
e.g. `"NaN h"`. Visually ambiguous but consistent with how the rest
of the app handles missing data. A future drop could add explicit
"—" or "no data" handling.

---

## Things that have NOT been done that you might assume have

- **The M15 alias bridge is still in `app.css`** (as of 0.27.0). The
  ~40 extra lines mapping old token names (`--accent`, `--surface`,
  `--text`, etc.) onto the new 6-combo cascade are intentional
  transitional debt — they go away in the final M15 cleanup plan once
  all 16 stylesheets use design tokens directly. Until then, removing
  them would break the 20 un-migrated pages.
- **The woff2 font files are committed to the repo** and served from
  `public/fonts/`. `scripts/fetch-fonts.mjs` is a convenience for
  refreshing them from upstream; it needs network and is not run as
  part of any startup or test. A checkout that has the committed files
  (normal) needs no extra step.
- **No JS bundling.** Frontend `.js` files are served raw. Imports
  use absolute paths (`/i18n.js`) that work in the browser but NOT
  in Node — tests re-implement frontend logic inline.
- **No frontend framework.** Plain DOM manipulation. No React, no
  Vue, no Svelte, no Web Components. This is intentional.
- **No CI configuration committed.** Run tests locally with
  `node tests/test-X.mjs` per suite. There's no `npm test` because
  there's no `npm`. Adding CI is fine; pick GitHub Actions or
  whatever the operator prefers.
- **No production deployment guide yet.** That's M17 (ships last, so
  it documents the final security posture). Currently the operator
  runs `node server.js` directly and points a reverse proxy at it for
  TLS. M17 will document this properly.
- **No automated dependency update flow.** There are no
  dependencies, so this is a non-issue.
- **No formal release process script.** Bumping the version is a
  manual edit to `package.json`, manual cache-version bump in
  `public/sw.js`, manual `RELEASES.md` entry, manual zip.
- **No multi-tenant support.** One install per organization. The
  master passphrase derives the master key; that key encrypts
  everything; there's no concept of "different orgs in one install."
- **No HA / clustering.** Single-process Node server. The in-memory
  rate limiter and audit log buffer assume one process. Behind a
  load balancer with sticky sessions you can probably get away with
  multiple instances backed by a shared filesystem, but this hasn't
  been tested or documented.

---

## Decision log

Decisions made during the project that are NOT obvious from the code.
Record new ones as they happen.

### Why no npm dependencies?
The original goal was a self-hostable time tracker that an operator
could deploy with `node server.js` and trust. Every npm dependency
is supply-chain risk and operational overhead (lockfile, audit,
update). The Node standard library is rich enough to do everything
Pica needs. The constraint also forces simplicity: when you can't
reach for a library, you build the smallest correct thing.

### Why per-line encryption for the audit log?
Whole-file encryption would require re-encrypting on every append,
or buffering writes. Per-line means each record has its own IV +
GCM tag (~28 bytes overhead) but appends are atomic and partial
corruption only loses one record. Acceptable trade-off at expected
scale.

### Why `SameSite=Lax` cookies and no CSRF tokens?
`SameSite=Lax` on the session cookie blocks cross-origin POSTs from
malicious sites by default. Modern browsers (>=2022) support it
universally. CSRF tokens would add complexity (every fetch needs
the token, every form needs the token, the token has to come from
somewhere). For Pica's threat model — small-team self-hosted on the
operator's own domain — `SameSite=Lax` is sufficient. Documented
in `docs/security.md`.

### Why hash-based CSP for the inline bootstrap script?
Theme-flicker-free dark-mode loading requires running JS before
any CSS parses. That means an inline `<script>`, which CSP would
normally forbid. We compute the hash of the bootstrap at server
startup (it's byte-identical across all 19 HTML files) and pin it
via `script-src 'sha256-...'`. Strict CSP otherwise.

### Why does `config.json` NOT restore from backups?
A backup made on machine A and restored on machine B would clobber
B's `config.json` with A's paths. This breaks more than it helps.
The user-data is portable; the config isn't. Operators must
maintain `config.json` per-install.

### Why audit log writes are best-effort (don't fail the request)?
"Can't audit, can't perform" semantics are too brittle for a small-
team self-hosted app. Disk-full means the operation succeeds but
the audit entry is missing — the operator sees ERROR in the
regular logger. Compliance regimes that need stronger guarantees
would need a different design.

### Why UUID v4 strict validation?
`crypto.randomUUID()` produces v4 UUIDs and Pica only uses that
function for ID generation. Accepting only v4 tightens the
validator without affecting any real user. If the validator were
permissive (any UUID-like string), the path-traversal defense
would be less robust.

---

## Active conventions to verify before changing anything

If you're about to make a non-trivial change, run these checks first:

```bash
# Full regression (46 suites)
for f in tests/test-*.mjs; do printf '%s: ' "$f"; node "$f" 2>&1 | tail -1; done
```

```bash
# Live smoke pattern — run from a COPY of the repo in a throwaway temp dir.
# IMPORTANT: there is NO data-dir env override. config.json is read from the
# server's OWN directory (path.join(__dirname,'config.json')); dataDir/backupDir
# default to ./data and ./backups beside it. So NEVER run `node server.js` from
# the real checkout for a smoke — it would create/clobber the real ./data and
# ./config.json. Copy the repo first (excluding data/backups/config.json).
SMOKE=$(mktemp -d)
rsync -a --exclude data --exclude backups --exclude config.json --exclude .git \
  --exclude 'data.pre-restore-*' --exclude 'data.staging-*' ./ "$SMOKE"/
printf '{ "port": 8099, "host": "127.0.0.1" }' > "$SMOKE/config.json"
( cd "$SMOKE" && PICA_PASSPHRASE="changeme123" node server.js > /tmp/p.out 2>&1 ) &
PID=$!
# wait for boot without a fixed sleep
curl -s --retry 40 --retry-connrefused --retry-delay 1 -o /dev/null http://127.0.0.1:8099/login
# ... your test requests via curl against http://127.0.0.1:8099 ...
kill -INT $PID 2>/dev/null; wait $PID 2>/dev/null
rm -rf "$SMOKE"
```

```bash
# Docs drift check
grep -E "_Last touched in" docs/*.md  # should all be at the current version
grep "version" package.json | head -1
grep "CACHE_VERSION" public/sw.js | head -1
```

If you change a pre-cached SW asset (anything in `public/` except
`*.html`), bump `CACHE_VERSION`. If you change the inline bootstrap
in `index.html`, the same change must appear in all 21 HTML files
byte-identically (the test will fail otherwise).

---

## Last-mile checklist before shipping a release

1. All 46 test suites green (bar the two documented pre-existing flakes)
2. Live smoke covering whatever you changed
3. `package.json` version + releaseDate bumped
4. `public/sw.js` `CACHE_VERSION` bumped if shell assets changed
5. `RELEASES.md` entry written, including Honest Disclosures
6. Affected `docs/*.md` files updated, footer bumped
7. `docs/architecture.md` test count updated if you added tests
8. This file (`docs/handoff.md`) updated if state changed materially
9. Zip the project, exclude `data/`, `backups/`, `config.json`, and
   any `data.pre-restore-*` / `data.staging-*` directories

---

## What to do if you're an LLM picking this up

Read in this order:

1. `CLAUDE.md` (the operator's manual — conventions and invariants)
2. `docs/handoff.md` (this file — current state)
3. `RELEASES.md` (skim the most recent 2–3 entries for context)
4. `docs/architecture.md` (file layout)
5. `docs/security.md` (threat model, encryption, advisories)
6. `docs/roadmap.md` (what's next)

Then, before you start making changes:

- Run the full regression suite and confirm 554/0.
- `grep -nR "TODO\|FIXME\|XXX" src/ public/ tests/` — there shouldn't
  be many; if there are, the operator wants them gone.
- Ask the operator what they want to work on. Don't assume.

When you're working:

- Use `str_replace`, not full-file rewrites, for small edits.
- `grep` to find call sites; `view` only the lines you need.
- Update `docs/*.md` as you go. Don't leave the docs drifting.
- Add a `RELEASES.md` entry for any user-visible change.
- Be honest in disclosures. Trade-offs you took are valuable
  context for whoever runs Pica.
