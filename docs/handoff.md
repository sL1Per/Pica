# Handoff — current state of Pica

This file is a snapshot in time. It describes where the project is
**right now** so a new collaborator (human or AI) can pick up without
spelunking through release notes. Update it when the state changes
materially.

_Last touched in 0.23.1._

---

## At a glance

- **Latest version:** 0.23.1 (released 2026-05-16)
- **Test count:** 706 across 33 suites, all green (1 pre-existing
  TZ-sensitive flake in `test-reports.mjs` `overnight split` bucket
  count, unchanged by this release — see notes.md). 0.23.1 added no
  tests (markup/locale/visibility only).
- **Build artifact:** `pica-0.23.0-master-key-management.zip` (0.23.1
  is a UI-only point release on top)
- **Dependency count:** zero npm packages (Node 22 standard library only)
- **Lines of code (rough):** ~6 KLoC across `src/`, `public/`, `tests/`
- **Active milestone:** 0.23.1 shipped; M13 and M14 are next

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
# Full regression (33 suites)
for f in tests/test-*.mjs; do printf '%s: ' "$f"; node "$f" 2>&1 | tail -1; done
```

```bash
# Live smoke pattern — ALWAYS use a throwaway temp dir; NEVER delete ./data, ./backups, ./config.json
SMOKE=$(mktemp -d)
PICA_DATA_DIR="$SMOKE/data" PICA_BACKUP_DIR="$SMOKE/backups" \
  PICA_CONFIG="$SMOKE/config.json" PICA_PASSPHRASE="changeme123" \
  node server.js > /tmp/p.out 2>&1 &
PID=$!
sleep 2
# ... your test requests via curl ...
kill -INT $PID; wait $PID
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
