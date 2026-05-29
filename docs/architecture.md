# Architecture

How Pica is organized internally. If you're modifying code, start here.

> Doc scope: structural and design choices that span multiple files.
> For per-file details, the file headers (top-of-file comment blocks)
> are the authoritative source. For security-specific rationale, see
> [security.md](./security.md). For coding conventions and how-to
> recipes, see [development.md](./development.md).

---

## High-level shape

```
┌──────────────────────────────────────────────┐
│  Browser (mobile-first, vanilla JS + CSS)    │
│  - ES modules per page                       │
│  - Service Worker for offline + asset cache  │
│  - i18n.js synchronous translation runtime   │
└───────────────────┬──────────────────────────┘
                    │ HTTPS (via reverse proxy)
┌───────────────────▼──────────────────────────┐
│  Node.js HTTP server (http module, no deps)  │
│  ├── Router                                  │
│  ├── Auth (scrypt + signed session cookies)  │
│  ├── RBAC middleware                         │
│  ├── Crypto layer (AES-256-GCM, master key)  │
│  ├── Storage layer (JSON / NDJSON, encrypt)  │
│  └── Routes per resource (auth, employees,   │
│      punches, leaves, corrections, reports,  │
│      settings, pages)                        │
└───────────────────┬──────────────────────────┘
                    │ master key held in RAM only
┌───────────────────▼──────────────────────────┐
│  /data                                       │
│    employees/<id>.json        (encrypted)    │
│    employees/<id>.picture     (encrypted)    │
│    punches/<yyyy>/<mm>.ndjson (mixed)        │
│    leaves/<yyyy>/<mm>.ndjson  (mixed)        │
│    corrections/<yyyy>/<mm>.ndjson (mixed)    │
│    user-prefs.json            (plaintext)    │
│    org-settings.json          (plaintext)    │
│    company-logo               (encrypted)    │
│    users.json                 (plaintext)    │
│    config.json                (plaintext)    │
└──────────────────────────────────────────────┘
```

---

## Repository layout

```
pica/
├── server.js                # entry point (passphrase prompt, store wiring)
├── package.json             # version + releaseDate (footer reads these)
├── config.json.example      # ships in repo; real config.json gitignored
├── README.md                # thin orientation doc
├── RELEASES.md              # per-version changelog
├── LICENSE                  # currently TBD
├── docs/                    # the deeper docs (this file lives here)
│   ├── architecture.md
│   ├── security.md
│   ├── development.md
│   └── roadmap.md
├── deploy/                  # sample deploy configs (Caddy etc., still TBD)
├── src/
│   ├── router.js            # method/path matching, route registration
│   ├── config.js            # config.json loader + defaults
│   ├── logger.js            # simple stdout logger
│   ├── http/                # request/response helpers
│   │   ├── body.js          # JSON + multipart parsing
│   │   ├── cookies.js       # parse + Set-Cookie helpers
│   │   ├── responses.js     # res.json / .html / .redirect / .notFound …
│   │   ├── security-headers.js # CSP + nosniff + XFO + Referrer + Permissions + HSTS
│   │   └── static.js        # static-file handler with content-type sniffing
│   ├── crypto/              # encryption + password primitives
│   │   ├── aes.js           # AES-256-GCM wrappers
│   │   ├── passwords.js     # scrypt hash + verify
│   │   ├── masterkey.js     # KDF + verifier; v1→v2 migration; returns { masterKey, mustResetPassphrase }
│   │   ├── dek.js           # DEK wrap/unwrap under a KEK; v1→v2 migration logic (0.23.0)
│   │   ├── keyring.js       # multi-slot wraps array management (0.23.0)
│   │   ├── rotate.js        # staged re-encrypt + atomic data-dir swap (0.23.0)
│   │   ├── backup-archive.js # pack/unpack encrypted backup blobs
│   │   ├── prompt.js        # TTY passphrase prompt
│   │   └── index.js         # facade re-exporting the rest
│   ├── auth/                # auth + RBAC
│   │   ├── users.js         # users.json store (plaintext, password hashes)
│   │   ├── sessions.js      # signed cookies (HMAC-SHA256)
│   │   ├── rbac.js          # authenticate(), requireAuth, requireRole
│   │   └── rate-limit.js    # in-memory token bucket for /api/login
│   ├── util/                # small reusable helpers
│   │   └── validators.js    # isUuid (path-traversal defense)
│   ├── storage/             # one module per resource, encryption-aware
│   │   ├── employees.js     # encrypted profiles + pictures
│   │   ├── punches.js       # NDJSON, encrypted comment + geo
│   │   ├── leaves.js        # NDJSON, encrypted reason
│   │   ├── corrections.js   # NDJSON, encrypted justification
│   │   ├── reports.js       # aggregations + matrices + CSV serializers
│   │   ├── period.js        # period boundary helpers + Day/Week/Month/Year presets
│   │   ├── user-prefs.js    # locale + colorMode (plaintext)
│   │   ├── org-settings.js  # leave allowances, working time targets
│   │   ├── company-logo.js  # encrypted blob
│   │   ├── mail-config.js   # encrypted SMTP config blob in config.json (mail.enc) (0.26.0)
│   │   ├── backups.js       # full-snapshot encrypted backups
│   │   └── audit.js         # append-only encrypted NDJSON audit log
│   └── routes/              # one module per resource — register*Routes(router, deps)
│       ├── auth.js          # /api/login, /api/logout, /api/me
│       ├── setup.js         # /api/setup (first-run)
│       ├── employees.js     # /api/employees + /api/employees/:id (+ picture)
│       ├── punches.js       # /api/punches/* (clock-in, clock-out, today)
│       ├── leaves.js        # /api/leaves[/:id], /api/leaves/approved
│       ├── corrections.js   # /api/corrections[/:id]
│       ├── reports.js       # /api/reports/*
│       ├── settings.js      # /api/settings/* (org, working-time, branding); GET org returns sanitized mail publicView + mailConfigured; PUT /api/settings/mail employer-only (0.26.0)
│       ├── backups.js       # /api/backups (list, create, download, delete, restore, status)
│       ├── security.js      # /api/security/* (passphrase, recovery-code, rotate) (0.23.0)
│       ├── mail.js          # POST /api/mail/test — employer-only SMTP config probe (0.25.0)
│       └── pages.js         # GET / GET /punch / etc. — serves HTML with i18n meta injection
│   ├── mail/                # outbound email (0.25.0, M14) — stdlib only
│   │   ├── smtp.js          # minimal SMTP submission client (EHLO/STARTTLS/AUTH LOGIN/DATA)
│   │   ├── templates.js     # plain-text message templates, localized en-US / pt-PT
│   │   └── mailer.js        # gating (org switch × user opt-out × config) + best-effort send
│   ├── scheduler/           # background timers
│   │   ├── backup-scheduler.js # periodic check; makes a backup if due
│   │   └── reminder-scheduler.js # 24h-before-leave reminder scan; idempotent via reminder_sent (0.25.0)
├── scripts/
│   └── fetch-fonts.mjs      # zero-dep font downloader (run locally; needs network) (0.27.0)
├── public/                  # everything served as static assets
│   ├── app.css              # global tokens + layout primitives; design-token cascade (6 theme×palette combos) + pre-M15 alias bridge + @font-face blocks (0.27.0)
│   ├── app.js               # shared utilities (postJson, showMessage, toast…); applies palette from server prefs (0.27.0)
│   ├── fonts/               # self-hosted woff2 files: Instrument Serif, DM Sans, JetBrains Mono — 8 files (0.27.0)
│   ├── topbar.css           # app-shell styles: desktop sidebar + content top-bar + mobile top-bar/bottom-nav/drawer (rebuilt M15, 0.27.0)
│   ├── topbar.js            # mountTopBar / mountFooter — every authed page calls these; shell rebuilt for M15 keeping same public contract (0.27.0)
│   ├── i18n.js              # t / tn / translateError / applyTranslations / fmtDate…
│   ├── manifest.json        # PWA manifest
│   ├── sw.js                # Service Worker (cache shell + offline fallback)
│   ├── icon.svg             # PWA icon
│   ├── locales/
│   │   ├── en-US.js         # English dictionary
│   │   └── pt-PT.js         # European Portuguese dictionary
│   ├── login.{html,js}      # login + setup pages (no top-bar)
│   ├── setup.{html,js}
│   ├── index.{html,js,css}  # dashboard with widgets
│   ├── punch.{html,js,css}  # clock-in/out
│   ├── punches-today.{html,js}
│   ├── leaves.{html,js,css}  # M15 list: balance blocks / pending inbox + inline decide (0.35.0)
│   ├── leaves-calendar.{html,js,css}  # M15 calendar: toolbar/chips/scope, grid, popover, rail (0.36.0)
│   ├── leave.{html,js,css}  # leave detail: status hero + mini-calendar + timeline (0.35.0)
│   ├── reports.{html,js,css}
│   ├── employees.{html,js,css}
│   ├── employee-new.{html,js}
│   ├── employee.{html,js,css}          # employer's per-employee summary
│   ├── employee-profile.{html,js,css}  # full profile editor (sub-route)
│   ├── corrections.{html,js,css}
│   ├── correction.{html,js,css}  # correction detail
│   ├── modal.{js,css}                # generic reusable <dialog> shell (0.32.0)
│   ├── manual-time-modal.{js,css}    # manual-time form modal; /corrections/new retired (0.32.0)
│   ├── request-leave-modal.{js,css}  # leave-request modal; /leaves/new retired (0.35.0)
│   ├── calendar-grid.js              # shared Mon-first month-matrix (calendar + leave mini-cal) (0.36.0)
│   ├── leave-actions.js              # shared approve/reject helpers (leaves list + calendar rail) (0.36.0)
│   ├── team-status.js                # shared session-pairing + status classify (home / team / detail) (0.37.0)
│   ├── settings.{html,js,css}
│   ├── preferences.{html,js,css}
│   ├── security.{html,js,css}       # standalone page (passphrase/recovery/rotate);
│   │                                #   linked from a Settings → Security card (0.23.0; entry point 0.23.1)
│   └── change-password.{html,js}    # forced + voluntary password change
├── tests/                   # node:test-style suites, no framework
│   ├── test-crypto.mjs
│   ├── test-auth.mjs
│   ├── test-employees.mjs
│   ├── test-punches.mjs
│   ├── test-leaves.mjs
│   ├── test-reports.mjs
│   ├── test-user-prefs.mjs
│   ├── test-org-settings.mjs
│   ├── test-company-logo.mjs
│   ├── test-corrections.mjs
│   ├── test-i18n.mjs
│   ├── test-frontend-imports.mjs   # static i18n-import audit
│   ├── test-period.mjs             # period boundary helpers + presets
│   ├── test-reports-routes.mjs     # /api/reports/timesheets|leaves routes
│   ├── test-reports-nav.mjs        # client period-nav anchor stepping (TZ-safe)
│   ├── test-employees-summary.mjs  # /api/employees/:id/summary route
│   ├── test-error-codes.mjs        # static audit: every error response carries errorCode
│   ├── test-backups.mjs            # backup archive format + storage
│   ├── test-backup-scheduler.mjs   # scheduler decisions + lifecycle
│   ├── test-security-headers.mjs   # CSP, headers, cross-file invariants
│   ├── test-audit.mjs              # audit log: append, read, encryption, listMonths
│   ├── test-validators.mjs         # isUuid edge cases (path-traversal defense)
│   ├── test-leaves-approved.mjs    # /api/leaves/approved privacy model
│   ├── test-leaves-carry.mjs       # vacation carry-forward + MM-DD expiry
│   ├── test-punch-totals.mjs       # punch-page worked + break helpers
│   ├── test-leaves-blocked.mjs     # employer blocked-days: helpers, store, route
│   ├── test-employee-picture-route.mjs  # picture upload: 400 not 500 when no profile
│   ├── test-leaves-concurrent.mjs  # no-concurrent-leave enforcement at booking
│   ├── test-leaves-attachment.mjs  # leave justification file: storage, policy, authz
│   ├── test-leaves-render.mjs      # M15 leaves frontend pure helpers (day-count + partition)
│   ├── test-calendar-grid.mjs      # M15 shared month-matrix helper (offsets, today, in/out-month)
│   ├── test-team-status.mjs        # M15 shared session-pairing + status classify (0.37.0)
│   ├── test-dek.mjs                # DEK wrap/unwrap + v1→v2 migration (0.23.0)
│   ├── test-keyring.mjs            # multi-slot keyring operations (0.23.0)
│   ├── test-rotate.mjs             # key rotation staged swap (0.23.0)
│   ├── test-masterkey-envelope.mjs # envelope encryption end-to-end (0.23.0)
│   ├── test-security-routes.mjs    # security HTTP endpoints: passphrase, recovery code, rotate (0.23.0)
│   ├── test-config-mail.mjs        # config.json mail block normalization/validation (0.25.0)
│   ├── test-mail-smtp.mjs          # SMTP submission client: EHLO/STARTTLS/AUTH/DATA (0.25.0)
│   ├── test-mail-templates.mjs     # plain-text templates, en-US / pt-PT (0.25.0)
│   ├── test-mail-mailer.mjs        # gating boundary: org × user × config, best-effort (0.25.0)
│   ├── test-reminder-scheduler.mjs # 24h-before-leave reminder scan + idempotence (0.25.0)
│   ├── test-mail-routes.mjs        # POST /api/mail/test route (employer-only) (0.25.0); GET org mail view + PUT /api/settings/mail (0.26.0)
│   ├── test-mail-config-store.mjs  # encrypted SMTP config store: round-trip, AAD, never-throws, write-only pass, abort-not-clobber (0.26.0)
│   ├── test-theme-tokens.mjs       # design-token cascade: all 6 theme×palette combos defined, alias bridge present (0.27.0)
│   ├── test-theme-bootstrap.mjs    # inline bootstrap byte-identical across all HTML (20 after /corrections/new retired in 0.32.0), resolves mode+palette; no third-party CDN URLs in public/ (0.27.0)
│   └── test-sw-precache.mjs        # font woff2 files in SW pre-cache list; all listed assets exist on disk (0.27.0)
├── data/                    # gitignored, created on first run
└── backups/                 # gitignored, M11
```

---

## Request lifecycle

A request takes one of two paths through the server:

### Static assets
`/app.css`, `/app.js`, `/icon.svg`, `/locales/pt-PT.js`, etc.

`src/http/static.js` resolves the path under `public/`, sniffs content
type by extension, and streams the file. No auth, no decryption,
nothing dynamic.

### API calls and HTML pages
Everything under `/api/*` and the page routes (`/`, `/punch`, etc.)
goes through `src/router.js`, which calls one route handler. The
handlers live in `src/routes/*.js`.

A typical authenticated API handler:

1. `requireAuth(req)` — pulls the session cookie, verifies the HMAC,
   loads the user from `users.json`. Throws on missing/expired/forged
   sessions; returns `{ user }`.
2. `requireRole('employer')` if the route is employer-only, or an
   ad-hoc owner-or-employer check using the `userId` from the URL.
3. Reads request body via `req.json()` (parsed by `src/http/body.js`).
4. Calls a method on a storage module (`employees.update(id, patch)`).
   The storage module owns encryption — handlers don't touch
   ciphertext.
5. `res.json({ ... })` sends a response.

A typical page handler is simpler: it calls `sendHtml(res, file, req)`
in `src/routes/pages.js`. That function reads the static HTML file,
injects `<html lang="...">` and `<meta name="pica-locale" content="...">`
based on the user's stored locale, and writes the response.

---

## Storage layout

### Plaintext files (top-level under `/data`)

| File                  | Contents                                              | Why plaintext |
|-----------------------|-------------------------------------------------------|---------------|
| `users.json`          | username, password hash, role, createdAt              | The server needs to authenticate before it can derive the master key |
| `config.json`         | port, dataDir, KDF salt, wrapped DEK, optional `mail` block which is now an AES-256-GCM-encrypted `{ enc }` blob (SMTP creds, keyed by the DEK, AAD `pica-mail-config-v1`) (0.26.0) | Read at startup before the master key exists; install-specific, never in backups |
| `user-prefs.json`     | per-user `locale`, `colorMode`, email-notification opt-outs | Used by the locale meta-injection on every served HTML; not sensitive |
| `org-settings.json`   | leave allowances, concurrent-leaves flag, working-time targets, email-notification org switches | Org-wide policy; not personal |

### Encrypted blobs

| Path                               | Format                                  |
|------------------------------------|-----------------------------------------|
| `employees/<id>.json`              | AES-256-GCM blob containing the profile JSON |
| `employees/<id>.picture`           | AES-256-GCM blob containing the JPEG/PNG bytes |
| `company-logo`                     | AES-256-GCM blob containing the company logo |

Each encrypted blob is `iv (12B) || ciphertext || authTag (16B)`.
Helpers live in `src/crypto/aes.js`.

### NDJSON event logs (mixed plaintext + encrypted fields)

| Path                                | Per-line shape                                            |
|-------------------------------------|-----------------------------------------------------------|
| `punches/<yyyy>/<mm>.ndjson`        | `{ id, type, employeeId, ts, comment_enc?, geo_enc? }`    |
| `leaves/<yyyy>/<mm>.ndjson`         | `{ id, employeeId, type, status, start, end, reason_enc?, …events }` (incl. a `reminder_sent` event line — timestamp + leave id only, unencrypted — once the 24h reminder fires) |
| `corrections/<yyyy>/<mm>.ndjson`    | `{ id, employeeId, kind, status, start, end, hours, justification_enc? }` |

Each `*_enc` field is a base64-encoded encrypted blob of just that
field's value. The plaintext fields (timestamps, IDs, types,
statuses, dates) are intentionally readable so reports can aggregate
without decrypting every row.

The format is **append-only**. A "leave approved" event is a new line
in the same NDJSON file, not an in-place edit. The current state of
an entity is computed by replaying its events. This makes the storage
layer crash-safe (a partial write loses at most one event, never
corrupts an existing record) and gives us an audit log for free.

---

## Tech choices

### Backend
- **Node.js stdlib only.** No npm dependencies. `http`, `fs`,
  `path`, `crypto`, `url`, `zlib`, `readline`, `child_process`,
  `node:test`. The decision is documented in
  [security.md → Supply chain](./security.md#supply-chain) and the
  README's non-goals.
- **No database.** All data is files under `/data`. Reasoning: small
  teams (≤ 50 employees) generate kilobytes per day; reading the
  current month of NDJSON is faster than spinning up Postgres for a
  single-VPS deploy. The cost is reduced query power — fine because
  the queries are simple (per-employee, per-month).
- **No build step.** Source is what runs. Adding TypeScript or Babel
  would require a watch process, a build pipeline, and explanatory
  documentation, in exchange for type-checking that solid file
  headers and the test suite already provide.

### Frontend
- **Vanilla ES modules.** Each page has a `.html`, `.css`, and `.js`
  file. The `.js` imports from a small set of shared modules
  (`/app.js`, `/topbar.js`, `/i18n.js`). No bundler.
- **Mobile-first CSS** with custom-property design tokens defined in
  `app.css`. Per-page CSS files extend, never override the tokens. As
  of 0.27.0, `app.css` carries a full M15 token cascade: 6
  `[data-theme]` × `[data-palette]` combos (Linen/Slate/Olive ×
  Light/Dark) with a pre-M15 alias bridge that keeps the 20
  not-yet-migrated stylesheets rendering unchanged.
- **App shell layout** rebuilt for M15 at 0.27.0: fixed desktop
  sidebar (220 px, brand + icon nav + user-tile popover) + content
  top-bar (breadcrumb + bell); mobile top app-bar + bottom nav (5
  destinations) + slide-in drawer. Implemented in `topbar.css` +
  `topbar.js`; the `mountTopBar()` / `mountFooter()` public contract
  is unchanged so the 20 other pages needed no edits. Three
  self-hosted woff2 font families served from `public/fonts/`; `font-src
  'self'` in CSP unchanged.
- **PWA shell** (manifest + service worker) for installability and
  offline punch queueing. The SW pre-caches the shared shell
  (CSS/JS/i18n) but does **not** cache HTML pages — see
  [security.md → Service Worker caching](./security.md#service-worker-caching).
- **i18n at module load.** The locale is server-injected as a meta
  tag, read synchronously by `i18n.js` on import, and used by `t()`
  / `tn()` and the `applyTranslations()` DOM walker. No flicker, no
  async dance. See [development.md → Adding a translation](./development.md#adding-a-translation).

### Testing
- `node:test`-style suites in `tests/`, no framework. Each suite is a
  single `.mjs` file invoked directly (`node tests/test-X.mjs`).
- Suites are isolated: each rebuilds its store in a temp directory,
  no shared state between tests in the same file.
- The `frontend-imports` suite is a static analysis check that walks
  `public/*.js` and verifies any used `i18n.js` symbol is also
  imported. Catches the most common refactor bug (missing import
  after a batch edit) without needing a browser.
- The `error-codes` suite is a similar static check on the backend —
  every `res.notFound`/`res.forbidden`/etc. call must include an
  `errorCode` so the frontend's `translateError()` can localize.
- Route-level tests (`reports-routes`, `employees-summary`) register
  their target route on a real router instance with mocked stores
  and call the resulting handler directly. Lighter than spinning up
  the full HTTP server, heavier than pure unit tests of the
  underlying primitives — the right granularity for testing
  composition logic (period boundaries × matrix bucketing ×
  per-employee aggregation × scope/RBAC enforcement).
- Total: **49 suites** (+`test-employee-home` in 0.28.0 — employee-home
  helpers; +`test-punch-week` in 0.30.0 — clock-page day-grouping/pairing
  helpers; the 0.31.0 corrections restyle, the 0.32.0 manual-time modal,
  and the 0.33.0 employer-today restyle each added no new suite;
  +`test-leaves-render` in 0.35.0 — leaves day-count + status-partition
  helpers; +`test-calendar-grid` in 0.36.0 — shared month-matrix helper;
  +`test-team-status` in 0.37.0 — shared pairing + status classify),
  passing as of 0.37.0 except two pre-existing
  flakes unrelated to any recent feature, both failing identically on
  the pre-feature baseline: `test-reports.mjs` overnight-split bucket
  count (host-timezone sensitive) and `test-auth.mjs` (~1/64
  probabilistic — a base64url last-character signature-tamper
  artifact in the test itself, not the auth code). The 0.25.0 email
  notifications work (M14) added six suites — `test-config-mail.mjs`,
  `test-mail-smtp.mjs`, `test-mail-templates.mjs`,
  `test-mail-mailer.mjs`, `test-reminder-scheduler.mjs`,
  `test-mail-routes.mjs` — and extended `test-org-settings.mjs` /
  `test-user-prefs.mjs` (pre-existing) for the new org switches and
  per-user opt-outs, taking the total from 34 to 40. The 0.26.0
  encrypted settings-managed SMTP config added one more —
  `test-mail-config-store.mjs` (encrypted store: round-trip, AAD
  binding, never-throws, write-only `pass`, abort-not-clobber) —
  bringing the total to 41. The 0.27.0 M15 foundation added three more
  — `test-theme-tokens.mjs` (design-token cascade: all 6 combos,
  alias bridge), `test-theme-bootstrap.mjs` (inline bootstrap
  byte-identical across all 21 HTML, no CDN URL leak), and
  `test-sw-precache.mjs` (font woff2 files in SW pre-cache list,
  all assets on disk) — bringing the total to 44.

---

## Cross-cutting subsystems

### Auth & sessions
The full chain — login, signed cookies, RBAC enforcement, rate
limiting — is documented in [security.md → Authentication and authorization](./security.md#authentication-and-authorization).
The code lives under `src/auth/`.

### i18n
The locale dictionaries (`public/locales/*.js`) are eagerly imported
ES modules with one default-export object per locale. The `i18n.js`
runtime exposes `t`, `tn`, `translateError`, `applyTranslations`,
`fmtDate`, `fmtTime`, `fmtDateTime`, `getLocale`,
`getSupportedLocales`. Server-side, `src/routes/pages.js` injects the
locale into every served HTML page based on the user's stored
preference. See [development.md → Adding a translation](./development.md#adding-a-translation)
for the full how-to.

### Service Worker
`public/sw.js` pre-caches the shared shell (CSS/JS/i18n/icon/manifest)
on install and serves static assets cache-first; HTML pages always go
to the network (so the locale meta tag is always fresh). On every
release a `CACHE_VERSION` bump invalidates the old cache. The
caching strategy is intentionally narrow — see
[security.md → Service Worker caching](./security.md#service-worker-caching)
for the rationale.

### Offline punch queue
`punch.js` keeps an in-memory + `localStorage` queue of clock
events. If a clock-in/out POST fails (network down), the event is
queued; on the next successful navigation or `online` event, the
queue drains via the same API endpoints. Idempotency comes from the
`clientId` field on each event — the server treats a repeated
`clientId` as a no-op.

### Missing-hours signal (replaces the old time bank)
The "time bank" feature (approved unjustified corrections accumulating
as uncredited hours owed) was removed in 0.22.8. Approved corrections
still materialize as in/out punch records the same way; reports just
read those punches like any other clock event. The new "missing hours"
signal is computed on the fly by every consumer that needs it
(the employee summary endpoint behind the dashboard widgets) as
`max(0, scheduled - worked)` for the relevant period. The old
employer "team-hours report" that also surfaced this number was
removed in 0.24.0 along with `/api/reports/summary` and
`/api/reports/team-hours`. It is **not**
adjusted for approved leaves — operators should cross-check the
upcoming-leaves block when interpreting the number.

### Outbound email (0.25.0, M14)
`src/mail/` is the only outbound side-channel. `smtp.js` is a
minimal, stdlib-only SMTP **submission** client (EHLO, STARTTLS when
`secure:false`, `AUTH LOGIN`, `DATA`) — Pica never receives mail.
`templates.js` renders four plain-text message kinds (leave decision,
correction decision, 24h leave reminder, password-reset notice),
localized en-US / pt-PT. `mailer.js` is the gating + best-effort
boundary: it resolves the org master switch (`org-settings.json`) ×
the per-user opt-out (`user-prefs.json`) × the SMTP store's
`isConfigured()`, builds the message, and hands it to the SMTP client,
never throwing into the calling route. As of 0.26.0 the SMTP
credentials live in `src/storage/mail-config.js`, which owns an
AES-256-GCM-encrypted blob in `config.json` (`mail.enc`, keyed by the
DEK, AAD `pica-mail-config-v1`) and is configured from Settings →
Email notifications via `PUT /api/settings/mail`; `src/config.js` no
longer parses mail (the old `normalizeMail` / `config.mailConfigured`
were removed). The whole subsystem is inert unless the operator saves
an enabled SMTP config from Settings. The
password-reset notice and `POST /api/mail/test` deliberately bypass
the org/user opt-out layers (a mandatory security notice and a
config probe respectively) — still gated by `mail.enabled` + a
recipient. `src/scheduler/reminder-scheduler.js` periodically scans
all approved leaves and sends each one's 24h-before reminder once,
recording a `reminder_sent` event on the leave so it never
double-sends. A send failure is logged and swallowed; the in-app
state and audit log are authoritative.

---

## What's *not* in this doc

- **Per-route API shapes.** Each route's input/output is documented in
  the file header at the top of `src/routes/<resource>.js`.
- **Per-storage-module field schemas.** Each storage module's header
  lists the fields it stores and which are encrypted.
- **Specific design tokens** (colors, spacings, typography). All in
  `public/app.css` under `:root`.
- **Per-version changes.** [RELEASES.md](../RELEASES.md) is the
  authoritative changelog.

---

_Last touched in 0.40.0._
