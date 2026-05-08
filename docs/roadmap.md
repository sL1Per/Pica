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
| M12.2     | Hardening — Drop 2+ (headers, audit, deploy, polish) | 📋 Planned    |
| M13       | E2E browser tests                  | 📋 Planned    |

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

**Drop 2 (⏳ next) — Security headers + CSP:**
- [ ] **Static security headers** (`X-Content-Type-Options`,
      `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`,
      conditional `Strict-Transport-Security`)
- [ ] **CSP** with hash-based inline-script allowance for the theme
      bootstrap; `frame-ancestors 'none'`; tight `connect-src` and
      `img-src`
- [ ] Move the two existing inline `style="..."` attributes to CSS
      classes so we can ban inline styles entirely

**Drop 3 (⏳ planned) — Audit log:**
- [ ] **Encrypted NDJSON** at `data/audit/<yyyy>/<mm>.ndjson`
- [ ] Wrap sensitive operations (login, employee CRUD, leave/correction
      decisions, settings updates, backups, restore, password change)
- [ ] No viewer UI in this drop — on-disk only

**Drop 4 (⏳ planned) — Deployment guide:**
- [ ] `docs/deployment.md` walkthrough
- [ ] Sample Caddy + nginx + systemd configs in `docs/deployment/`

**Drop 5 (⏳ planned) — Smaller polish:**
- [ ] **Input validation audit** on every route
- [ ] **`Intl.NumberFormat` coverage** for locale-dependent number
      formatting (hours, bank balance)

**Pulled out into M13 (its own milestone):**
- ~~CSRF tokens~~ — `SameSite=Lax` cookies already provide solid
  CSRF protection. Adding double-submit tokens is real architectural
  work and touches every fetch in the frontend. Deferred with a
  note in `docs/security.md`.
- ~~E2E browser tests~~ — pulled out into M13. Adding Playwright is
  a significant architectural shift (first npm dependency, ~300 MB
  on disk) and deserves its own milestone.

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

_Last touched in 0.19.0._
