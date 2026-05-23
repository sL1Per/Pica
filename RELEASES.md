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
