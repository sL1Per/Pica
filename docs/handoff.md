# Handoff — current state of Pica

This file is a snapshot in time. It describes where the project is
**right now** so a new collaborator (human or AI) can pick up without
spelunking through release notes. Update it when the state changes
materially.

_Last touched in 0.22.1._

---

## At a glance

- **Latest version:** 0.22.1 (released 2026-05-09)
- **Test count:** 554 across 21 suites, all green
- **Build artifact:** `pica-0.22.1-profile-link-fix.zip`
- **Dependency count:** zero npm packages (Node 22 standard library only)
- **Lines of code (rough):** ~6 KLoC across `src/`, `public/`, `tests/`
- **Active milestone:** M12 closed; M13 and M14 are next

---

## What just shipped (0.22.1)

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
| M13   | E2E browser tests (Playwright)           | 📋 planned |
| M14   | Deployment guide + TLS samples           | 📋 planned |

**Order matters.** M14 was deliberately pulled to last so that the
deployment guide describes the final security posture rather than a
moving target. M13 (Playwright E2E) introduces the project's first
npm dependency, which is a significant architectural decision and
should be discussed with the operator before starting.

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

- **No JS bundling.** Frontend `.js` files are served raw. Imports
  use absolute paths (`/i18n.js`) that work in the browser but NOT
  in Node — tests re-implement frontend logic inline.
- **No frontend framework.** Plain DOM manipulation. No React, no
  Vue, no Svelte, no Web Components. This is intentional.
- **No CI configuration committed.** Run tests locally with
  `node tests/test-X.mjs` per suite. There's no `npm test` because
  there's no `npm`. Adding CI is fine; pick GitHub Actions or
  whatever the operator prefers.
- **No production deployment guide yet.** That's M14. Currently the
  operator runs `node server.js` directly and points a reverse proxy
  at it for TLS. M14 will document this properly.
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
# Full regression (21 suites)
for s in crypto auth employees punches leaves reports user-prefs \
         org-settings company-logo corrections i18n frontend-imports \
         period reports-team employees-summary error-codes backups \
         backup-scheduler security-headers audit validators; do
  node tests/test-$s.mjs 2>&1 | tail -1 | sed "s/^/$s: /"
done
```

```bash
# Live smoke pattern
rm -rf data backups config.json data.pre-restore-* data.staging-*
PICA_PASSPHRASE="changeme123" node server.js > /tmp/p.out 2>&1 &
PID=$!
sleep 2
# ... your test requests via curl ...
kill -INT $PID; wait $PID
rm -rf data backups config.json
```

```bash
# Docs drift check
grep -E "_Last touched in" docs/*.md  # should all be at the current version
grep "version" package.json | head -1
grep "CACHE_VERSION" public/sw.js | head -1
```

If you change a pre-cached SW asset (anything in `public/` except
`*.html`), bump `CACHE_VERSION`. If you change the inline bootstrap
in `index.html`, the same change must appear in all 19 HTML files
byte-identically (the test will fail otherwise).

---

## Last-mile checklist before shipping a release

1. All 21 test suites green
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
