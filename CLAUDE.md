# CLAUDE.md — Operator's manual for AI development on Pica

Read this file first. It captures the conventions, invariants, and
"how things are done" that aren't documented in any individual file.
For project-level orientation see `README.md`; for the file layout
see `docs/architecture.md`; for what shipped when see `RELEASES.md`.

This file is the closest thing Pica has to institutional memory.
Update it when you learn a new constraint or set a new convention.

---

## The shape of this project

**Zero-npm-dependency Node.js application.** That is the single most
important fact. The project intentionally runs on `node server.js`
with no `npm install` step. No bundler, no transpiler, no Babel, no
TypeScript, no Webpack, no Vite, no React. Just Node 22 + the standard
library + plain ES modules in the browser.

Every dependency you would reflexively reach for has been considered
and refused. The reasoning is in `RELEASES.md` and `docs/roadmap.md`.
**Do not add npm dependencies without explicit operator approval.**
This is the project's defining constraint.

Concrete consequences:
- The browser frontend uses `<script type="module">` and bare HTML/CSS.
  No JSX. No build artifacts. The `.js` files in `public/` are exactly
  what the browser sees.
- All "imports" in the frontend are absolute paths (e.g. `/i18n.js`)
  served directly. They cannot be imported from Node — Node's resolver
  rejects them. Tests that need to verify frontend logic re-implement
  it inline (see `tests/test-i18n.mjs` for the pattern).
- Database = files. Everything in `data/`. Most of it AES-256-GCM
  encrypted with a master key derived from a passphrase via scrypt.
- HTTP routing = a tiny in-house router (`src/router.js`).
- Body parsing = an in-house parser (`src/http/body.js`) that handles
  JSON and multipart/form-data.

**Target scale: ≤ 50 employees.** Architecture decisions are sized for
small-team self-hosted use. "Full-table scans on each request" is fine.
"Decrypt every employee profile to render the list view" is fine.
Don't over-engineer for scale that doesn't apply.

---

## Files you should know exist

```
pica/
├── server.js              # entry; constructs all stores; injects routes
├── package.json           # version + releaseDate; no dependencies
├── RELEASES.md            # complete version history + Honest Disclosures
├── README.md              # user-facing: install, run
├── CLAUDE.md              # this file
├── LICENSE                # MIT
├── .gitignore             # ignores data/, backups/, config.json
├── config.json.example    # commented sample config
├── docs/
│   ├── architecture.md    # file layout, module responsibilities, test list
│   ├── security.md        # threat model, encryption, advisories, decrypt recipes
│   ├── development.md     # how to run tests, smoke pattern, conventions
│   ├── roadmap.md         # milestone history + status
│   └── handoff.md         # current state snapshot (read after this file)
├── src/
│   ├── router.js          # method/path matcher; first-match-wins
│   ├── config.js          # loads/normalizes config.json
│   ├── logger.js
│   ├── http/              # body parser, cookies, responses, static, security headers
│   ├── auth/              # users, sessions, RBAC, rate-limit
│   ├── crypto/            # aes, passwords, masterkey, prompt, backup-archive
│   ├── util/              # validators (currently isUuid)
│   ├── routes/            # one file per resource
│   ├── storage/           # one file per resource; encryption-aware
│   └── scheduler/         # backup-scheduler.js
├── public/
│   ├── *.html, *.css, *.js  # one triplet per page; never inline styles/scripts
│   ├── i18n.js              # t/tn/translateError/applyTranslations/fmt*
│   ├── topbar.js            # mountTopBar(); imported by every authed page
│   ├── app.js               # showMessage() and shared frontend bits
│   ├── locales/             # en-US.js, pt-PT.js dictionaries
│   ├── manifest.json
│   ├── icon.svg
│   └── sw.js                # service worker; CACHE_VERSION must be bumped on shell changes
└── tests/
    └── test-*.mjs           # 21 suites at last count; node tests/test-X.mjs to run one
```

---

## Hard rules — do not break these

These are invariants enforced by tests, by convention, or by reality.
Breaking one will fail CI or break the app.

### Project structure

- **Zero npm dependencies.** Already covered. Worth saying twice.
- **Every release bumps `version` AND `releaseDate` in `package.json`.**
  No exceptions. Format: `'YYYY-MM-DD'`. Tests don't enforce this; the
  release process does.
- **Every release adds a detailed entry to `RELEASES.md`** with
  Honest Disclosures (what we know is wrong / limited / deferred).
  This section is non-negotiable. Operators rely on it.
- **Any change to a pre-cached SW asset bumps `CACHE_VERSION`** in the
  same commit. Pre-cached assets: `i18n.js`, `topbar.js`, `app.js`,
  `manifest.json`, `icon.svg`, `locales/*.js`, `*.css`. NOT HTML files.
- **Every code change touches the relevant `docs/*.md` file** with
  an updated `_Last touched in vX.Y.Z._` footer. Helps drift detection.

### Frontend conventions

- **Split `*.html`, `*.css`, `*.js` per page.** No inline styles. No
  inline scripts. Tests enforce this — CSP allows only the bootstrap
  inline script (which is byte-identical across all 19 HTML files,
  hash-pinned in CSP) and rejects everything else.
- **Every authed page imports `mountTopBar` AND `mountFooter`** from
  `/topbar.js`. Login, setup, and change-password are exceptions
  (they mount footer only or none — they're outside the app shell).
  Tests enforce these patterns.
- **Inline theme bootstrap in `<head>`** before stylesheets. Must be
  byte-identical across all HTML files (CSP hash test enforces).
- **`[hidden] { display: none !important; }`** is a global rule. Use
  the `hidden` attribute to hide things, not inline `display: none`.
- **Container widths.** `.container` = 640px (centered narrow forms).
  `.container--wide` = 1600px (data tables, dashboards).
- **App shell.** Full-width header. Grid `80px | 1fr | auto`. Sidebar
  220px. Mobile ≤ 900px collapses sidebar to a drawer.
- **Hour formatting goes through `fmtHours()` from `/i18n.js`.** Don't
  use `.toFixed(1)` or `Math.round(h * 10) / 10` directly. Locale
  matters: en-US shows `8.5`, pt-PT shows `8,5`.
- **Date formatting goes through `fmtDate/fmtTime/fmtDateTime`** from
  `/i18n.js`. Same locale story.
- **Error messages from the API** carry `{errorCode}`. Frontend uses
  `translateError(errorCode, fallback)` from `/i18n.js`.

### Backend conventions

- **Route registration order matters** — first match wins. The
  `/api/...` routes are registered before any `/<page>` routes; static
  serving is the fallback. If you add a new route that overlaps, put
  it in the right order.
- **Stores throw on programmer errors** (bad types, malformed input
  the route should have caught) and return null/false on legitimate
  "not found" cases. Routes catch storage errors, map to `errorCode`,
  return appropriate HTTP status.
- **`req.user`** = `{id, username, role, mustChangePassword}` after
  `requireAuth`. `req.params.X` = decoded URL path components.
  `req.body` = parsed JSON or multipart body. `req.query` =
  URLSearchParams flattened to a plain object.
- **`audit.appendRecord({...auditContext(req), event: 'foo.bar', ...})`**
  on sensitive ops. Best-effort: never throws, logs failures via the
  regular logger. Event types are dotted snake_case.
- **AES-GCM AAD** binds ciphertexts to context. `encryptBlob(data, key, aad)`
  / `decryptBlob`. Conventions: employees use `aadFor(id)` (the user
  id), audit uses `pica-audit-v1`, leaves use the leave id, etc.
- **Free-text fields are capped at 500 chars** at the storage layer.
  `punch.comment`, `correction.justification`, `correction.notes`,
  `leave.reason`, `leave.notes`. The 5 MB body cap is the upper
  bound; without storage caps an attacker maxes-out request size.
- **`:id` URL parameters for employees go through `rejectIfBadId`**
  (UUID v4 validation) at the top of every handler. Storage layer
  re-validates. See `src/util/validators.js`.

### Encryption

- **Master key is 32 bytes**, derived via scrypt from a passphrase.
  Held in memory after server start. Never written to disk in
  plaintext. `config.json` stores only the salt + a verifier
  ciphertext.
- **Audit log: per-line AES-256-GCM** with AAD `pica-audit-v1`,
  base64-encoded one record per line, monthly rotation at
  `data/audit/<yyyy>/<mm>.ndjson.enc`. To decrypt manually, see
  `docs/security.md` "Audit log".
- **Backups: AES-256-GCM** with the magic prefix `PICA_BACKUP_V1`,
  HKDF-derived key. See `src/crypto/backup-archive.js`.
- **Restore atomic-swaps the data directory** to `data.pre-restore-<ts>/`
  and renames `data.staging-<ts>/` to `data/`. After a successful
  restore, `serverState.restoreCompleted = true` triggers a 503
  lockdown except for `/api/backups/status` and `/api/logout`.
  `config.json` is NOT restored from backups (only data is).

### Tests

- **Smoke pattern:** `PICA_PASSPHRASE=8+chars node server.js > /tmp/p.out 2>&1 &`.
  **Always** `rm -rf data backups config.json data.pre-restore-* data.staging-*`
  between runs. The container has no network → run smokes locally.
- **Test fixtures use valid UUIDs** (e.g. `'11111111-1111-4111-8111-111111111111'`).
  Real UUID validation now runs in stores; fake `'u1'` ids will fail.
- Each suite is a standalone `node tests/test-X.mjs` script using
  `node:assert/strict`. No test runner.
- Total test count is in `docs/architecture.md`. Bump it when adding tests.

---

## Token economy when working on this repo

The repo is large enough that careless tool calls burn context fast.

- **Grep before view.** Don't view a 500-line file when grep can
  point you at the 20 lines you need.
- **Narrow line ranges.** `view ... view_range=[100, 130]`, not the
  whole file.
- **Batch edits with Python or `str_replace`.** Don't rewrite files
  for small changes. Don't use `view` then `str_replace` if you can
  predict the exact `old_str` from grep output.
- **For multi-file sweeps, use a Python script.** See the bulk-edit
  patterns used in M12 Drop 4 (replacing fake test ids, adding the
  same guard to 8 handlers).
- **Don't re-view the same file after a successful `str_replace`** —
  the line numbers from earlier views are stale anyway.

---

## Style and writing

- **Comments explain "why", not "what".** The code shows what; the
  comment justifies it. Especially: when the choice was non-obvious
  or when a future reader might be tempted to "simplify" the code in
  a way that breaks an invariant.
- **Honest Disclosures.** Every release notes section ends with a list
  of things the change does NOT do, things known to be limited,
  trade-offs taken consciously. This is the project's most distinctive
  habit. Lean into it. If something is incomplete or imperfect, say
  so. Operators reading the notes need to know what risks they're
  carrying forward.
- **Voice is direct, not promotional.** "Pica does X" not "Pica
  empowers users to X". Say what something is and isn't. Avoid
  marketing register.
- **No unattributed quotes.** When the release notes say "an attacker
  could write controlled bytes," the next sentence should say what
  the attacker could NOT do. Bound the claim.

---

## Roadmap snapshot

- **M0–M11:** all shipped. Core features (clock, leaves, corrections,
  reports), i18n, dashboard, backups.
- **M12: Hardening (closed at 0.22.0).** Four drops:
  - Drop 1 (0.19.0): password change + employer-initiated reset.
  - Drop 2 (0.20.0): security headers + CSP (hash-based inline).
  - Drop 3 (0.21.0): encrypted append-only audit log, 14 event types.
  - Drop 4 (0.22.0): input validation (path-traversal patch),
    locale-aware number formatting.
- **M13 (planned):** E2E browser tests with Playwright. Will be the
  project's first npm dependency — significant decision.
- **M14 (planned):** Deployment guide + sample Caddy/nginx/systemd
  configs. Pulled out from M12 deliberately so it ships LAST and
  references the final security posture.
- **CSRF tokens** are deferred — `SameSite=Lax` already provides
  solid CSRF protection for this threat model. See `docs/security.md`.

---

## Things that have bitten us (read this before refactoring)

- **`path.join(dir, id + '.json')` resolves `..` segments.** This was
  the path-traversal vulnerability fixed in 0.22.0. If you're computing
  a disk path from a URL parameter, validate the parameter first.
- **`req.user` is not available in `/api/logout`.** Logout is reachable
  from a stale/missing session, so it has no `requireAuth` wrapper.
  If you need user info there (e.g. for audit logging), call
  `verifySession(rawCookie, sessionKey)` and `usersStore.findById()`
  yourself.
- **The router strips trailing slashes** (regex `/?$`). Routes
  registered with or without a trailing slash both match. Don't rely
  on the difference.
- **CSP hash-pinning of the inline bootstrap** means changing one
  byte of the inline `<script>` in `index.html` requires re-computing
  the hash at startup. The server does this automatically by reading
  the file and hashing — but if you accidentally make the bootstraps
  in different HTML files differ from each other, the cross-file
  invariant test in `test-security-headers.mjs` will fail.
- **Service worker pre-caches the shell, NOT HTML.** Don't add HTML
  files to the pre-cache list. Stale shell + fresh HTML is fine; the
  reverse breaks login redirects.
- **Restore lockdown survives only until process restart.** After a
  successful restore, the operator must restart the server. Until
  then, the in-memory stores are stale.
- **The `:id` URL param is decoded after the route regex matches.**
  `[^/]+` matches the encoded form (no slashes); `decodeURIComponent`
  then restores any `%2F` to `/`. Validate the post-decode value.
- **`config.json` is NOT restored from backups.** Only `data/` is.
  This is intentional — `config.json` contains environment-specific
  paths and must stay tied to the install, not the backup.
- **`data.pre-restore-<ts>/`** directories accumulate in the project
  root after every restore. The operator is expected to clean them up
  manually. There is no auto-cleanup; we're conservative with deletion
  of recovery snapshots.

---

## Where to look when you're stuck

| Question | File |
|----------|------|
| What did this milestone change? | `RELEASES.md` |
| What is the file layout? | `docs/architecture.md` |
| How does encryption work here? | `docs/security.md` |
| How do I run tests / smoke? | `docs/development.md` |
| What's planned next? | `docs/roadmap.md` |
| What state are we in right now? | `docs/handoff.md` |
| How does Pica do X? | grep + read the source; the codebase is small |

When you finish a piece of work, update the relevant `docs/*.md` and
add a `RELEASES.md` entry with Honest Disclosures.
