# Roadmap

Pica is built in small, shippable milestones. Each one leaves the
app in a usable state.

> Doc scope: milestone status (what's done, what's next). For
> per-version detail see [RELEASES.md](../RELEASES.md). For
> architecture context see [architecture.md](./architecture.md).

---

## Status overview

| Milestone | Title                              | Status        |
|-----------|------------------------------------|---------------|
| M0        | Project bootstrap                  | ✅ Done       |
| M1        | Server foundation                  | ✅ Done       |
| M2        | Security foundation                | ✅ Done       |
| M3        | Employee management                | ✅ Done       |
| M4        | Clock in / out                     | ✅ Done       |
| M5        | Leaves                             | ✅ Done       |
| M6        | Reports                            | ✅ Done       |
| M7        | Settings page                      | ✅ Done       |
| M8        | UI polish (a/b/c/d drops)          | ✅ Done       |
| M9        | i18n (Drop 1 + Drop 2)             | ✅ Done       |
| M10       | Dashboard widgets                  | ✅ Done       |
| M11       | Backups — Drop 1 (create/list/download) | ✅ 0.17.0     |
| M11.2     | Backups — Drop 2 (restore/scheduler)    | ✅ 0.18.0     |
| M12       | Hardening — Drop 1 (passwords)     | ✅ 0.19.0     |
| M12.2     | Hardening — Drop 2 (security headers, CSP) | ✅ 0.20.0     |
| M12.3     | Hardening — Drop 3 (audit log)            | ✅ 0.21.0     |
| M12.4     | Hardening — Drop 4 (input validation + numfmt) | ✅ 0.22.0  |
| —         | Master key management (envelope enc, passphrase change, rotation, recovery code) | ✅ 0.23.0 |
| M13       | Reports revamp                     | ✅ 0.24.0     |
| M14       | Add email notifications            | ✅ 0.25.0     |
| M15       | Full UI revamp                     | ✅ 0.41.0 (closed; foundation 0.27.0 · employee home 0.28.0 · palette picker 0.29.0 · punch clock page 0.30.0 · corrections list+detail 0.31.0 · manual-time modal 0.32.0 · employer punches-today 0.33.0 · punch/topbar CSP+CSS polish 0.34.0 · leaves list+modal+detail 0.35.0 · calendar 0.36.0 · employer home+team+detail 0.37.0 · settings+security 0.38.0 · preferences+profile edit 0.39.0 · reports re-skin 0.40.0 · alias-removal+dedup+bell 0.41.0) |
| M16       | Code review / optimization / simplification | ✅ 0.53.10 (closed; opened 0.52.0 · whole-codebase sweep · findings F1–F16: fixed/wontfix or deferred to M17 · doc-truth pass · isolated boot smoke passed) |
| M17       | Full security review               | ✅ 0.54.5 (closed; opened 0.54.0 · S1–S3 + S5/S7/S13/S15 fixed · 11-domain sweep 0 crit/high/med · residuals documented) |
| M18       | Deployment guide + TLS samples     | ✅ 0.56.0     |
| M19       | User guide                         | 📋 Planned    |
| M20       | Project documentation update       | 📋 Planned    |

The roadmap was renumbered after M9 closed: M10 was originally
"Backups" but the dashboard widget work earned its own milestone,
pushing Backups to M11 and the hardening grab-bag to M12. This
matches the milestone references in the M9.x and M10.x release
entries.

---

## Done

### Milestone 0 — Project bootstrap ✅
- ✅ README, goal, requirements, threat model, roadmap
- ✅ Repository layout
- ✅ `LICENSE`, `.gitignore`, `.editorconfig`

### Milestone 1 — Server foundation ✅
- ✅ Minimal HTTP server (static files + JSON routes)
- ✅ Router with method/path matching
- ✅ Request helpers: body parser (JSON + `multipart/form-data` for uploads), cookie parser
- ✅ Response helpers: `json`, `html`, `redirect`, `notFound`, `forbidden`
- ✅ Config file (`config.json`) with port, data dir, backup dir
- ✅ Simple logger

### Milestone 2 — Security foundation ✅
- ✅ Passphrase prompt on startup + verifier check
- ✅ Master-key derivation with `crypto.scrypt`
- ✅ Crypto helpers: `encryptBlob`, `decryptBlob`, `encryptField`, `decryptField` (AES-256-GCM)
- ✅ Password hashing + verification (`crypto.scrypt`)
- ✅ Signed session cookies (HMAC-SHA256)
- ✅ Login / logout pages
- ✅ RBAC middleware: `requireAuth`, `requireRole('employer')`, `requireOwnerOrEmployer`
- ✅ Rate-limited login
- ✅ First-run setup wizard (creates first employer + picks passphrase)

### Milestone 3 — Employee management ✅
- ✅ List / create / edit / remove employees (employer only)
- ✅ Encrypted profile files (name, age, address, contact, role, comments)
- ✅ Encrypted picture upload (client-side resize; server writes ciphertext)
- ✅ Employee self-service: view own profile, edit allowed fields only
- ✅ Employer profile (same model, different role)

### Milestone 4 — Clock in / out ✅
- ✅ "Clock in" and "Clock out" buttons (authenticated employee only)
- ✅ Optional comment on each punch — encrypted
- ✅ Browser geolocation captured on punch — encrypted (`lat`, `lng`, `accuracy`)
- ✅ Guard against duplicate open punches
- ✅ Daily punch list: own punches for employees, all punches for employers

### Milestone 5 — Leaves ✅
- ✅ Book leave: day range or hour range
- ✅ Leave types: vacation, sick, appointment, other
- ✅ Reason / notes field — encrypted
- ✅ Employee requests → employer approves / rejects
- ✅ Calendar-style monthly view

### Milestone 6 — Reports ✅
- ✅ Worked hours per day / week / month (uses plaintext timestamps, no decryption needed)
- ✅ Monthly leaves summary
- ✅ CSV export (employer only for all; employees get their own data)
- ✅ Printable view

### Milestone 7 — Settings page ✅
- ✅ Settings page (employee: account section only; employer: all sections)
- ✅ Account settings (per user): language, color mode (light / dark / system)
- ✅ Organization settings (per company): default leave allowances per type, per-employee override, annual carry-forward
- ✅ Concurrent-leaves policy (yes / no) — stored; enforcement in M8
- ✅ Backup settings UI (scheduler + on-demand buttons) — scaffold only; wired up in M11
- ✅ Color mode applied immediately via `<html data-theme>` attribute

### Milestone 8 — UI polish ✅
Split into four drops:

**M8a — Navigation shell + company identity ✅**
- ✅ Sticky top menu bar across all pages
- ✅ Role-filtered nav links
- ✅ Avatar dropdown: user name + role + sign-out
- ✅ Hamburger drawer on mobile
- ✅ Company logo upload (encrypted at rest)
- ✅ Company name field
- ✅ Logo + name shown in the top bar
- ✅ New Settings section "Company" — employer only

**M8b — Visual polish ✅**
- ✅ Design-token pass: cohesive typography scale, spacing, color depth
- ✅ Desktop layout: wider containers, multi-column on larger screens, keyboard focus styles
- ✅ Mobile polish: touch targets ≥ 44px, larger tap zones
- ✅ Component refinement: buttons, forms, tables, empty states, loading states, toasts
- ✅ Accessibility pass (partial): focus-visible, prefers-reduced-motion, ARIA toasts
- ✅ Concurrent-leaves warning on approve
- ✅ Leave-allowance cap enforcement at create + approve
- ✅ Per-page iteration — Settings, Leaves, Punches, Dashboard, Preferences

**M8c — PWA + offline ✅**
- ✅ Web App Manifest + home-screen icon (installable PWA)
- ✅ Offline-friendly clock-in (queue locally, sync when online)

**M8d — Time corrections + working-time targets ✅**
- ✅ Manual time entry (employee files retroactive in/out window with optional justification)
- ✅ Approval flow (pending → approved / rejected / cancelled, mirrors leaves)
- ✅ Time bank — approved unjustified corrections accumulate as "uncredited hours owed"
- ✅ Configurable daily / weekly working-hours targets in org settings (defaults 8h / 40h)
- ✅ Approved corrections materialize as punch records with deterministic clientIds
- ✅ Frontend: corrections list, new/detail pages, "Register manually" link on punch page
- ✅ Frontend: working-hours display on punch page + bank balance indicator

### Milestone 9 — i18n ✅
- ✅ Language dictionaries: `public/locales/en-US.js`, `public/locales/pt-PT.js`
- ✅ `i18n.js` runtime module with `t(key, params)` and `tn(key, count, params)` (plurals via `Intl.PluralRules`)
- ✅ Language switcher in Preferences (reads/writes user-prefs)
- ✅ Per-user `locale` preference (replaces the M7 `language` field with backward-compat read)
- ✅ Server-side locale injection (`<html lang>` + `<meta name="pica-locale">`)
- ✅ Drop 1 string coverage: app shell, dashboard, preferences, footer
- ✅ Drop 2 string coverage: every authenticated page (punch, punches-today, leaves, leave detail, leave-new, calendar, reports, employees, employee detail, employee-new, corrections list/new/detail, settings, login, setup)
- ✅ Date formatting via `Intl.DateTimeFormat`
- ✅ Plural forms via `tn(key, count)`
- ✅ Error code translation infrastructure (`errors.*` namespace, `translateError(code, fallback)` helper) — frontend ready; backend errorCode emission deferred to M12
- ✅ Dictionary parity enforced by tests (every key in en-US must exist in pt-PT, plural categories must match, placeholders must match)
- ✅ 533 keys per locale, 21 i18n tests

### Milestone 10 — Dashboard widgets ✅
- ✅ Employer: pending approvals widget (leaves + corrections)
- ✅ Employer: working-today widget (currently clocked in + done for the day with punch pairs)
- ✅ Employer: on-leave-today widget
- ✅ Employee: my pending approvals widget
- ✅ Employee: today's hours widget (live-counting for open punch)
- ✅ Employee: bank summary widget
- ✅ Auto-refresh on tab focus (visibilitychange)
- ✅ Per-widget independent loading + error states
- ✅ Translations for widget strings (en-US + pt-PT)
- ✅ Static frontend-imports audit suite (`tests/test-frontend-imports.mjs`) — catches the missing-import class of bug that crashed `/leaves/new` in 0.16.0

---

## Up next

### Milestone 11 — Backups
The Settings page already has a Backups section UI (scaffolded in
M7). M11 wires it up.

**Drop 1 (✅ shipped in 0.17.0):**
- ✅ **Encrypted full backup of `/data`** — single-archive snapshot,
      AES-256-GCM with a per-backup HKDF-derived key, magic header
      `PICA_BACKUP_V1`, includes config.json so backups are
      self-contained
- ✅ **List + create + download** endpoints, employer-only
- ✅ Backup section UI rebuilt: manual create button, list table,
      per-row download links

**Drop 2 (✅ shipped in 0.18.0):**
- ✅ **Restore from encrypted archive** — with a pre-restore safety
      snapshot of current `/data`. Server enters a lockdown mode after
      restore and refuses other API calls until the process is restarted.
- ✅ **Scheduler** — wakes every 5 minutes, makes backups when due
      based on the off/hourly/daily/weekly schedule from M7's settings.
- ✅ **Retention** — auto-prunes backups beyond the configured keep-N
      count after each scheduled backup creation.
- ✅ **Delete-backup** endpoint + UI button per row.

Deferred (not currently planned):
- ~~Encrypted delta backup~~ — the typical Pica data size doesn't
  justify the complexity. Full-snapshot backups stay small (KBs to
  low-MBs) for the foreseeable future.

Design notes carried over from M7:
- Backups live in `./backups/` next to `./data/`. Single-disk
  failure loses both — users wanting offsite redundancy should
  copy `*.bak` files elsewhere via the Download button.
- Restore semantics: full replace, not merge. Server restart
  required after restore so all stores re-read from disk.

### Milestone 12 — Hardening
A grab-bag of security and operational improvements. Splits into
drops; each is independently shippable.

**Drop 1 (✅ shipped in 0.19.0) — Password change/reset:**
- ✅ **Self-service password change** at `/change-password`, reachable
      from a button on `/preferences`. Reissues the session cookie
      so the user stays logged in.
- ✅ **Employer-initiated reset** via the "Reset password" button on
      the employee summary page. Sets `mustChangePassword: true` on
      the target user.
- ✅ **Forced-change flow** — users with `mustChangePassword: true`
      get redirected to `/change-password` from every other page,
      and every API call except `/api/me`, `/api/me/password`, and
      `/api/logout` returns 403 with `errorCode: must_change_password`.
- ✅ **Session invalidation by password change** — sessions issued
      before `passwordChangedAt` are rejected. Other devices are
      logged out automatically; the device that did the change gets
      a fresh cookie.
- ✅ Backend `errorCode` emission was already shipped in 0.16.5
      ahead of M12.

**Drop 2 (✅ shipped in 0.20.0) — Security headers + CSP:**
- ✅ **Static security headers** (`X-Content-Type-Options`,
      `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`,
      conditional `Strict-Transport-Security`)
- ✅ **CSP** with hash-based inline-script allowance for the theme
      bootstrap; `frame-ancestors 'none'`; tight `connect-src` and
      `img-src`
- ✅ The two existing inline `style="..."` attributes migrated to CSS
      classes (`mt-3`, `mt-5`); CSP forbids inline styles entirely
- ✅ Cross-file invariant test: every HTML page has exactly one
      byte-identical inline bootstrap, no inline handlers, no
      `style=""`, no `<style>` elements

**Drop 3 (✅ shipped in 0.21.0) — Audit log:**
- ✅ **Encrypted NDJSON** at `data/audit/<yyyy>/<mm>.ndjson.enc` —
      per-line AES-256-GCM, base64-encoded, monthly rotation
- ✅ Wrapped sensitive operations: setup, login (success + failure),
      logout, password self-change, employer-initiated reset, employee
      created/deleted, leave decisions, correction decisions, settings
      org_updated, backup created/deleted, backup restore (success + failure)
- ✅ No viewer UI in this drop — on-disk only. A future drop can add
      `/api/audit/recent` (employer-only) + a viewer page.

**Drop 4 (✅ shipped in 0.22.0) — Input validation audit + numfmt polish:**
- ✅ **Input validation audit** across every route. Notable findings:
  - **Path-traversal vulnerability** in `PUT /api/employees/:id/picture`
    discovered (was exploitable in 0.16.4–0.21.0); patched at the
    storage layer (`src/storage/employees.js` rejects non-UUID ids
    in path-computing helpers) and the route layer (new
    `rejectIfBadId` helper at the top of all 8 `:id`-taking
    employee handlers). See `docs/security.md` for the advisory.
  - **Length caps** added to `leave.reason` and `leave.notes` (both
    500 chars, matching the existing punch.comment convention).
  - Other route-level inputs already had appropriate validation;
    storage layers reject bad input. No further changes needed.
- ✅ **`Intl.NumberFormat` coverage** — new `fmtNumber()` and
      `fmtHours()` helpers in `public/i18n.js`. 11 hour-display
      callsites across 5 frontend files migrated from
      `Math.round * 10 / 10` / `toFixed(1)` to `fmtHours()`. Hours
      now render as `8.5` in en-US and `8,5` in pt-PT.
- ✅ New `src/util/validators.js` (`isUuid`) and new test suite
      `tests/test-validators.mjs` (15 tests).

**Pulled out into M17 (its own milestone) — Deployment guide:**
- Will ship as the very last milestone before any future work, so
  it can reference the final security posture rather than describing
  a moving target.

**Deferred / pulled out:**
- ~~CSRF tokens~~ — `SameSite=Lax` cookies already provide solid
  CSRF protection. Adding double-submit tokens is real architectural
  work and touches every fetch in the frontend. Deferred with a
  note in `docs/security.md`.
- ~~E2E browser tests~~ — pulled out into M16. Adding Playwright is
  a significant architectural shift (first npm dependency, ~300 MB
  on disk); see M16 below.

### Milestone 13 — Reports revamp ✅ 0.24.0

Delivered in a single drop at 0.24.0. The Reports page is rebuilt
around two report types — **Timesheets** and **Leaves** — each
runnable for everyone (employer only) or one person, over Day / Week
/ Month / Year period presets with ◀/▶ navigation. The combined view
is a matrix (period buckets × employees + axis totals). Print-friendly
(browser Print → "Save as PDF", landscape print stylesheet); CSV
export for every shape; employee-isolation server-enforced.

New endpoints `GET /api/reports/timesheets` and
`GET /api/reports/leaves` (`scope=me|all`, `id`, `type`, `anchor`,
`format=csv`) replaced the removed `/api/reports/summary`,
`/api/reports/team-hours`, `/api/reports/hours/:id[.csv]` and
`/api/reports/leaves/:id[.csv]` (now 404, no shim). See RELEASES.md
0.24.0 for the full entry and Honest Disclosures.

### Milestone 14 — Add email notifications ✅ 0.25.0

Delivered in a single drop at 0.25.0. A new in-house,
dependency-free SMTP **submission** client (`src/mail/smtp.js`) sends
plain-text notifications through the operator's own authenticated
relay over TLS — Pica never receives mail. Three notification
categories (leave decision, correction decision, 24h-before-leave
reminder) plus an informational password-reset notice. Org-level
master switches (employer / Settings) and per-user opt-outs (both
roles / Preferences) gate the three categories; the password-reset
notice deliberately bypasses both (a user must learn their password
changed) and is gated only by `config.mail.enabled` + a recipient.

Mail is off until the operator adds an enabled `mail` block to
`config.json`. New `POST /api/mail/test` (employer-only config probe);
`GET /api/settings/org` now also returns a safe `mailConfigured`
boolean; a reminder scheduler scans approved leaves and stamps a
`reminder_sent` event so it never double-sends. CACHE_VERSION v42 →
v43. See RELEASES.md 0.25.0 for the full entry and Honest
Disclosures.

This does **not** unblock the email-based KEK master-key recovery
slot reserved in 0.23.0 — the offline recovery code remains the
master-key recovery path. Self-service password recovery, HTML
email, and per-event employer digests are out of scope / later.

**Follow-up — 0.26.0 (encrypted settings-managed SMTP config).** M14
itself stays shipped at 0.25.0; 0.26.0 is a follow-up that moved SMTP
configuration out of the plaintext `mail` block in `config.json` (the
unpushed 0.25.0 design) into a single AES-256-GCM-encrypted blob keyed
by the DEK (`mail.enc`, AAD `pica-mail-config-v1`), edited from
Settings → Email notifications (now ordered before Backups) via a new
employer-only `PUT /api/settings/mail`. New `src/storage/mail-config.js`;
`config.js` no longer parses mail. See RELEASES.md 0.26.0. This does not
change the milestone arc: M15 / M16 / M17 are unchanged and M17 still
ships last.

### Milestone 15 — Full UI revamp 🔄 in progress

Foundation shipped at **0.27.0**. Detailed plan series lives in
`docs/superpowers/plans/2026-05-22-m15-*.md`.

**Foundation (0.27.0) — done:**
- ✅ Design-token cascade in `app.css`: 6 `[data-theme]` × `[data-palette]`
  combos (Linen/Slate/Olive × Light/Dark) as the canonical token vocabulary.
- ✅ Pre-M15 alias bridge so all 20 un-migrated stylesheets keep rendering.
- ✅ Three self-hosted font families (Instrument Serif, DM Sans, JetBrains
  Mono) as 8 woff2 files in `public/fonts/`; `font-src 'self'` CSP unchanged.
- ✅ Theme + palette inline bootstrap swapped across all 21 HTML files
  (byte-identical; single CSP hash).
- ✅ New shell in `topbar.js`/`topbar.css`: desktop sidebar + content
  top-bar + mobile top app-bar + bottom nav + drawer. `mountTopBar()` /
  `mountFooter()` contract unchanged.
- ✅ New nav/menu/crumb i18n keys. CACHE_VERSION v44 → v45.
- ✅ 3 new test suites (`test-theme-tokens`, `test-theme-bootstrap`,
  `test-sw-precache`). Total 44.

**Screen bodies shipped so far:** employee home (0.28.0), palette picker
(0.29.0), employee punch/clock page (0.30.0), the **corrections list +
detail** restyle (0.31.0 — including a new employer *inline* approve/decline
on pending rows), the **manual-time modal** (0.32.0 — a reusable
`<dialog>` shell + the manual-time form; `/corrections/new` retired to a
redirect that auto-opens the modal), and the **employer `/punches/today`**
restyle (0.33.0 — per-employee cards + status + session pairs). The
**punches/corrections screen group is now complete.** _(Post-M15, 0.46.0
consolidated this group into one page: `/punches/today` and the `/corrections`
list were folded into Today/Corrections/This-week tabs on `/punch` — both old
routes now 404; the `/corrections/:id` detail page stays as a deep-link
fallback and also opens as a modal from the Corrections tab.)_ **Leaves** (0.35.0 —
Plan 4: list with employee balance stat-blocks / employer pending inbox +
*inline* approve/decline + team matrix; a **request-leave modal** reusing the
0.32.0 shell with balance-after + conflict box + success state, retiring
`/leaves/new` to a `?new=1` redirect; and a leave-detail status-hero +
mini-calendar + activity timeline). **Calendar** (0.36.0 — Plan 5: toolbar with
type-filter chips + employee Mine|Team scope; a pending+approved month grid with
closed-day hatch, "+N more", and anonymized blocks for employees; an anchored day
popover with employee "Request leave this day"; and a right rail with Out
today/tomorrow + an employee balance card / employer pending-requests inline
decide. Introduced shared `calendar-grid.js` [month-matrix, also adopted by the
leave-detail mini-cal] and `leave-actions.js` [approve/reject, shared with the
leaves list]). **Employer home + Team + Employee detail** (0.37.0 — Plan 6:
4-card stat strip · Team-today everyone-sorted · Waiting-on-you inline decide ·
Hours-this-week with delta · team list with search/chips/status/week+bar/today/
pending · employee detail hero with status pill + segments, 3-up stats, recent
days, inline decide, Reset-pw via shared `modal.js`. Introduced shared
`team-status.js` [pairing + `classify` heuristic on-break/done at 18:00 cutoff],
the canonical `.st-dot--*` palette across all three pages; no backend change).

**M15 plans (all shipped — milestone closed):**
- ✅ Plan 7 — Settings + Security (employer Settings rebuild + Security page
  restyle) — shipped 0.38.0.
- ✅ Plan 8 — Profile edit + the remainder of Preferences (palette picker shipped
  0.29.0; the rest + profile editor + create-employee form) — shipped 0.39.0.
- ✅ Plan 9 — Reports re-skin + final cleanup, split into two releases:
  **Reports re-skin shipped 0.40.0** (part 1); **alias-bridge removal + JS dedup
  (flashSaved, pairSessions) + notification bell shipped 0.41.0** (part 2),
  which **closed M15**. See
  `docs/superpowers/plans/2026-05-29-m15-reports-cleanup.md`.
- ✅ Alias bridge removed in 0.41.0 — all stylesheets reference design tokens
  directly; `--accent-ring` kept as a canonical per-theme token, guarded by
  `tests/test-no-alias-tokens.mjs`. **Deferred:** the `punch.js`→`/geo.js`
  geolocation unification (the two implementations diverged by design; needs its
  own focused change — see RELEASES.md 0.41.0).

### Milestones 16–20 — planned 📋

The order is deliberate — code quality and security come first (clean and
audit the code before it ships), then the operator-facing deliverables
(deployment guide, user guide) and a final documentation sweep. The
deployment guide and docs land late so they describe the final, reviewed
posture rather than a moving target.

> **Note (renumbered after M15 closed):** the old M16 "E2E browser tests"
> milestone (Playwright as the first npm dependency) was dropped. The
> zero-dependency constraint stands; automated browser tests are no longer
> on the roadmap. The remaining work is the five milestones below.

> **0.53.0 (feature, out of arc):** Reports dashboard revamp — the Reports page
> rebuilt as a visual dashboard (KPI cards, hand-rolled SVG charts, punctuality,
> breaks, coverage gaps) over a new `GET /api/reports/overview` endpoint, with a
> new `expectedStart`/`graceMinutes` working-time setting. A feature shipped
> mid-M16 at operator request; M16 review work continues below.

- **M16 — Code review / optimization / simplification.** ✅ **Closed at 0.53.10**
  (opened 0.52.0). A full pass over the codebase for correctness, dead code,
  duplication, and simplification now that the UI revamp settled. No new features.
  Plan/findings live in the gitignored `docs/superpowers/` (`m16-code-review-plan.md`,
  `m16-findings.md`); every issue was triaged before any fix (security findings
  deferred to M17). The whole codebase was swept (findings F1–F16, clean checks
  C1–C23); the automated `/code-review ultra` phase was **dropped at operator
  request**; a doc-truth pass + an isolated boot smoke (validated 0.53.10) closed it. Fixes ship as
  small releases: F1, F3–F13 + F15 done (F8 punch-comment cap 0.53.7; F9 stale
  comments 0.53.8; F10/F12/F13/F15 low batch 0.53.9; Phase-4 doc-truth 0.53.10);
  F14 closed wontfix (documented design choices); F2/F11/F16 deferred to M17. **All
  phases complete + isolated boot smoke passed (validated 0.53.10) → M16 CLOSED.**
  Next: M17 (security review) inherits F2 (punch `:id` UUID guard), F11 (CSV formula
  injection), F16 (unsigned ±7-day punch `clientTs`).
- **M17 — Full security review.** 🚧 In progress (opened 0.54.0). End-to-end
  review of the threat model, encryption, auth, input validation, authorization/
  isolation, secrets hygiene, and the audit log against the final feature set —
  and the milestone where M16's deferred security findings get fixed. Plan/findings
  in the gitignored `docs/superpowers/` (`m17-security-review-plan.md`,
  `m17-findings.md`); seeded with S1 (punch `:id` traversal), S2 (CSV formula
  injection), S3 (unsigned punch `clientTs`). Threat-model-relative severity;
  fixes ship as small releases with regression tests.
- **M18 — Deployment guide + TLS samples.** ✅ **Shipped at 0.56.0.** Caddy /
  nginx / systemd / WinSW samples in `deploy/` plus `docs/deployment.md`
  (browser→proxy→node, public + LAN TLS, running as a service on Linux +
  Windows 11, a hardening checklist, verification, troubleshooting). Reconciled
  the old M12 deployment-guide IOU in `security.md` and linked the guide from
  `README.md`; added a `test-deploy-samples` drift guard (57 → 58 suites).
  Documents the final, reviewed (post-M17) security posture. Next: M19.
- **M19 — User guide.** Operator- and employee-facing documentation for
  running and using Pica day to day.
- **M20 — Project documentation update.** A final sweep of all `docs/*`,
  `README.md`, and `RELEASES.md` to match the shipped state.

---

## How milestones work

- Each milestone gets a minor version bump on completion (e.g. M9
  closed at 0.15.x → 0.16.0 starts M10).
- Within a milestone, patch versions ship per drop or per fix
  (0.16.0 → 0.16.1 fixed missing imports; 0.16.0 was the M10
  feature drop itself).
- Substantial milestones get split into drops (M8 had four; M9 had
  two). Each drop is independently shippable.
- The minor version bump happens at the *start* of the milestone's
  first drop, not the end. This way, version numbers reference the
  feature being worked on, not the previous one.
- A milestone is "closed" when its checklist is all `✅` and a
  release entry says so. Then the roadmap status flips to ✅ and
  the README's headline status updates.

---

_Last touched in 0.56.0._
