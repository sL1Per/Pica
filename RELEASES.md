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
