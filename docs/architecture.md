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
│   │   └── static.js        # static-file handler with content-type sniffing
│   ├── crypto/              # encryption + password primitives
│   │   ├── aes.js           # AES-256-GCM wrappers
│   │   ├── passwords.js     # scrypt hash + verify
│   │   ├── masterkey.js     # KDF + verifier persisted in config.json
│   │   ├── backup-archive.js # pack/unpack encrypted backup blobs
│   │   ├── prompt.js        # TTY passphrase prompt
│   │   └── index.js         # facade re-exporting the rest
│   ├── auth/                # auth + RBAC
│   │   ├── users.js         # users.json store (plaintext, password hashes)
│   │   ├── sessions.js      # signed cookies (HMAC-SHA256)
│   │   ├── rbac.js          # authenticate(), requireAuth, requireRole
│   │   └── rate-limit.js    # in-memory token bucket for /api/login
│   ├── storage/             # one module per resource, encryption-aware
│   │   ├── employees.js     # encrypted profiles + pictures
│   │   ├── punches.js       # NDJSON, encrypted comment + geo
│   │   ├── leaves.js        # NDJSON, encrypted reason
│   │   ├── corrections.js   # NDJSON, encrypted justification
│   │   ├── reports.js       # aggregations over plaintext fields
│   │   ├── period.js        # period boundary helpers (today/week/month)
│   │   ├── user-prefs.js    # locale + colorMode (plaintext)
│   │   ├── org-settings.js  # leave allowances, working time targets
│   │   ├── company-logo.js  # encrypted blob
│   │   └── backups.js       # full-snapshot encrypted backups
│   └── routes/              # one module per resource — register*Routes(router, deps)
│       ├── auth.js          # /api/login, /api/logout, /api/me
│       ├── setup.js         # /api/setup (first-run)
│       ├── employees.js     # /api/employees + /api/employees/:id (+ picture)
│       ├── punches.js       # /api/punches/* (clock-in, clock-out, today)
│       ├── leaves.js        # /api/leaves[/:id], /api/leaves/approved
│       ├── corrections.js   # /api/corrections[/:id], /api/corrections/bank
│       ├── reports.js       # /api/reports/*
│       ├── settings.js      # /api/settings/* (org, working-time, branding)
│       ├── backups.js       # /api/backups (list, create, download, delete, restore, status)
│       └── pages.js         # GET / GET /punch / etc. — serves HTML with i18n meta injection
│   ├── scheduler/           # background timers
│   │   └── backup-scheduler.js # periodic check; makes a backup if due
├── public/                  # everything served as static assets
│   ├── app.css              # global tokens + layout primitives
│   ├── app.js               # shared utilities (postJson, showMessage, toast…)
│   ├── topbar.css           # app-shell styles (header, sidebar, drawer)
│   ├── topbar.js            # mountTopBar / mountFooter — every authed page calls these
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
│   ├── leaves.{html,js,css}
│   ├── leaves-calendar.{html,js,css}
│   ├── leave-new.{html,js}
│   ├── leave.{html,js,css}  # leave detail
│   ├── reports.{html,js,css}
│   ├── employees.{html,js,css}
│   ├── employee-new.{html,js}
│   ├── employee.{html,js,css}          # employer's per-employee summary
│   ├── employee-profile.{html,js,css}  # full profile editor (sub-route)
│   ├── corrections.{html,js,css}
│   ├── correction-new.{html,js}
│   ├── correction.{html,js}  # correction detail
│   ├── settings.{html,js,css}
│   └── preferences.{html,js,css}
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
│   ├── test-period.mjs             # period boundary helpers
│   ├── test-reports-team.mjs       # /api/reports/team-hours route
│   ├── test-employees-summary.mjs  # /api/employees/:id/summary route
│   ├── test-error-codes.mjs        # static audit: every error response carries errorCode
│   ├── test-backups.mjs            # backup archive format + storage
│   └── test-backup-scheduler.mjs   # scheduler decisions + lifecycle
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
| `config.json`         | port, dataDir, KDF salt, master-key verifier          | Read at startup before the master key exists |
| `user-prefs.json`     | per-user `locale` and `colorMode`                     | Used by the locale meta-injection on every served HTML; not sensitive |
| `org-settings.json`   | leave allowances, concurrent-leaves flag, working-time targets | Org-wide policy; not personal |

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
| `leaves/<yyyy>/<mm>.ndjson`         | `{ id, employeeId, type, status, start, end, reason_enc?, …events }` |
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
  `app.css`. Per-page CSS files extend, never override the tokens.
- **App shell layout** since 0.14.0: a sticky header on top, a fixed
  sidebar on the left (collapses to a drawer on ≤900px viewports),
  main content fills the gap, footer at the bottom. Implemented
  entirely in `topbar.css` + `topbar.js`'s `mountTopBar()`. Pages
  don't need any layout markup of their own.
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
- Route-level tests (`reports-team`, `employees-summary`) register
  their target route on a real router instance with mocked stores
  and call the resulting handler directly. Lighter than spinning up
  the full HTTP server, heavier than pure unit tests of the
  underlying primitives — the right granularity for testing
  composition logic (period boundaries × scheduled-hours math ×
  per-employee overrides ×  RBAC enforcement).
- Total: 18 suites, 484 passing as of 0.18.0.

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

### Time bank
Approved corrections without a justification accumulate as the
employee's "time bank" (hours owed back to the employer). Computed
on the fly by `corrections.bank(userId)` — sums the `hours` of
every approved `kind=both` correction whose justification is empty.
Single-side corrections (`kind=in` / `kind=out`) never contribute
because they only add half a punch pair.

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

_Last touched in 0.18.0._
