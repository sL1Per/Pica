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
| M11       | Backups                            | ⏳ Next       |
| M12       | Hardening                          | 📋 Planned    |

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

- [ ] **Encrypted full backup of `/data`** — single-archive snapshot,
      AES-256-GCM with the master key, header includes KDF salt for
      cross-machine restore
- [ ] **Encrypted delta backup** (files changed since last snapshot —
      manifest with mtime + content hash)
- [ ] **Restore from encrypted archive**, with a pre-restore safety
      snapshot of current `/data`
- [ ] **Scheduler** with cron-like intervals (off / hourly / daily /
      weekly), honors the org settings configured in M7
- [ ] **Wire up** the M7 Backup section buttons (run full, run delta,
      browse snapshots, restore-from-archive)

Open design questions for M11:
- Where do backups live by default? (`./backups` next to `./data` is
  the obvious choice but means a single-disk failure loses both.)
- Are deltas chained (delta-N depends on delta-N-1) or full-relative
  (delta-N depends on the most recent full)? Full-relative is
  simpler to restore but uses more space.
- Restore semantics: full replace `/data`? Or merge?

### Milestone 12 — Hardening
A grab-bag of security and operational improvements that don't fit
under a single feature heading.

- [ ] **Password change** (authenticated, in Preferences) — current
      password + new password + confirm
- [ ] **Force-change-on-first-login flag** — new accounts get
      `mustChangePassword: true`; first authenticated request
      redirects to a password-change screen
- [ ] **Employer-side password reset** for any employee — generates
      a new random password, shows it once on screen, sets the
      force-change flag
- [ ] **Backend `errorCode` emission** on all user-visible business
      errors (frontend already plumbed in M9 — this is a server-side
      sweep)
- [ ] **Input validation audit** on every route
- [ ] **CSRF protection** on state-changing routes (token-based,
      belt-and-suspenders to `SameSite=Lax`)
- [ ] **Audit log** for sensitive actions (user/leave edits,
      restores, backup runs)
- [ ] **Security headers** (CSP, X-Frame-Options, Referrer-Policy)
- [ ] **Sample Caddy / nginx TLS config** in `deploy/`
- [ ] **Full E2E browser tests** — Playwright or similar; replaces
      the static frontend-imports audit added in M10
- [ ] **`Intl.NumberFormat` coverage** for any locale-dependent
      number formatting (currently zero numbers in the app need it,
      but bank balance and report totals would benefit)

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

_Last touched in 0.16.5._
