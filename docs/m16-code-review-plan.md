# M16 — Code Review / Optimization / Simplification Plan

> **For agentic workers:** This is a *review-and-cleanup* milestone, not a feature
> build, so it does not follow the strict red-green-refactor task shape. It is a
> sequence of review passes with concrete per-module checklists, a triage rubric,
> and a release cadence. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Do a full, structured pass over the Pica codebase to remove dead code,
duplication, and inconsistency, fix correctness bugs, and tighten adherence to the
project's own invariants — leaving `main` production-ready and `docs/*` truthful —
*without* changing externally visible behavior or adding npm dependencies.

**Approach:** Three lenses run as separate passes — (1) automated breadth via the
review tooling, (2) a manual module-by-module sweep against a Pica-specific
invariant checklist, (3) a doc-truth pass. Findings are triaged into M16 (quality),
M17 (security — deferred, do **not** fix here), or later. Each cleanup lands as its
own small release per the project release ritual.

**Tooling (no new deps):** `/code-review ultra` (cloud multi-agent, branch-wide),
`/simplify` (quality-only, per-diff), `/code-review` (correctness, per-diff),
`karpathy-guidelines` skill (surgical-change discipline), the existing 53 test
suites, and the local smoke pattern.

**Scope at start:** v0.51.0, working tree clean (only `notes.md` dirty). Backend
~10k LOC (`src/` + `server.js`), frontend ~13.4k LOC (`public/`), tests ~14.6k LOC
across 53 suites.

---

## Progress snapshot — RESUME HERE

_Updated 2026-06-03 at **v0.52.5**, committed to `main` (`b3413f7`). Working tree
clean except pre-existing `notes.md`. Baseline **53/53 green**._

**Read first when resuming:** `docs/m16-findings.md` (the ledger) — every finding,
its triage, status, and the release that fixed it.

**Done so far — the "first sweep" (Phase 0 + grep-driven slices of Phases 3/4):**
- Phase 0 baseline run found the suite was **red** (a timezone-flaky reports test);
  fixed → now 53/53 green. Smoke **not** run yet (no-network review container —
  still owed locally before M16 closes).
- Opened M16 at **0.52.0** (plan + ledger, docs-only), then shipped fixes as patch
  releases **0.52.1–0.52.5**. All seven first-sweep findings are closed:
  F1 (reports TZ), F3 (`index.js` locale), F4 (CLAUDE.md test count), F5 (leave
  formatter dedup → `leave-format.js`), F6 (CLAUDE.md pre-cache rule), F7
  (CLAUDE.md local-by-design). **F2 (punches path-traversal) deferred to M17.**

**NOT started — the bulk of M16 remains:**
- **Phase 1** — `/code-review ultra` never run (operator-triggered; Pedro to run,
  then triage results into the ledger).
- **Phase 2** — module-by-module reads: **0 of ~40 modules done.** The matrix
  below is still entirely ☐. *This is the main remaining work.*
- **Phase 3** — partial. ✅ done: `fmtHours/fmtDate` sweep, `encryptBlob`/
  `encryptField` AAD, `rejectIfBadId` on employee routes, en/pt locale key parity.
  ⬜ still owed: 500-char caps, throw-vs-null contract, CSP-hash parity, a full
  `CACHE_VERSION`/`PRECACHE_URLS` audit.
- **Phase 4** — partial. ✅ done: test count (F4), `leave-format.js` added to the
  architecture inventory, footers/roadmap/handoff kept current per release.
  ⬜ still owed: full `architecture.md` file-list reconciliation, final coherence pass.

**Deviation from the plan as written:** Phase 0 Step 4 said open a branch
`m16-code-review`; in practice the work went **straight to `main`** as version
releases (matching the established release-on-main workflow). No branch was used.

**Suggested next step:** start Phase 2 with `src/storage/` (it carries most of the
invariants). Read a module end-to-end → log findings to the ledger → fix only after
Pedro triages.

---

## Scope contract (read before touching anything)

**In scope (M16):**
- Dead code, unreachable branches, unused exports/vars/params.
- Duplication — extract shared helpers where it reduces real surface area.
- Naming, altitude, and consistency with surrounding code.
- Correctness bugs found incidentally (fix + add a regression test).
- Invariant adherence (the CLAUDE.md "Hard rules" list).
- Doc drift (test counts, file lists, milestone status).

**Out of scope — do NOT do in M16:**
- **Security findings → defer to M17.** Log them in the triage list; do not fix.
  Keeping the security lens separate is the whole point of M16→M17 ordering.
- Storage-format changes, router rearchitecture, encryption-scheme changes.
- New features, new endpoints, UI redesign (M15 is closed).
- Anything requiring an npm dependency.
- Performance work that isn't a clear win at ≤50-employee scale (full-table
  scans are explicitly fine).

**Definition of done for M16:** every module in the matrix below has a ✅,
every M16-triaged finding is fixed-and-released or consciously deferred with a
RELEASES Honest Disclosure, all 53+ suites green, a clean smoke run, and
`docs/*` footers + counts reflect reality.

---

## Phase 0 — Baseline & freeze

- [x] **Step 1: Confirm clean tree.** ✅ Done (`notes.md` left as-is — it is
  Pedro's pre-existing local change, deliberately not committed).

- [x] **Step 2: Green baseline.** ✅ Done — and it caught **F1**: `test-reports.mjs`
  was red (timezone-flaky overnight-split test). Fixed in 0.52.1; baseline now 53/53.

```bash
for f in tests/test-*.mjs; do node "$f" || echo "FAIL: $f"; done
```

- [ ] **Step 3: Clean smoke.** ⬜ NOT done — the review container has no network,
  so the boot smoke is still owed and must be run locally before M16 closes.

```bash
PICA_PASSPHRASE=testpass1 node server.js > /tmp/p.out 2>&1 &
# verify boot, hit a couple of pages, then kill the temp server
```

Expected: server boots, no stack traces in `/tmp/p.out`. Kill the temp server
after (live install on :8080 is never touched).

- [~] **Step 4: Open the working branch.** ⚠️ Skipped — work went straight to
  `main` as version releases (matches the established release-on-main workflow).

```bash
git switch -c m16-code-review   # NOT used; see note above
```

- [x] **Step 5: Create the finding ledger.** ✅ Done — `docs/m16-findings.md` with
  columns: `ID | module | description | lens | triage (M16/M17/later/wontfix) |
  status | release`. Every finding from every later phase lands here first, gets
  triaged, *then* gets actioned. This is the milestone's working memory.

---

## Phase 1 — Automated breadth

Run the tooling first so the manual sweep can focus on what tools miss.

- [ ] **Step 1: Branch-wide cloud review.** ⬜ NOT run yet (operator-triggered;
  Pedro to run, then triage results into the ledger). Launch `/code-review ultra`
  against the working branch once there is a meaningful diff to review, OR — if
  you want a map of the *current* code before changing it — run it early against a
  no-op branch so it reviews recent history. Note: ultra is user-triggered and
  billed; you cannot launch it yourself — ask Pedro to run it and paste results.

- [ ] **Step 2: Triage every ultra finding** into `docs/m16-findings.md`. Security
  findings → triage `M17`, do not fix now.

- [ ] **Step 3: Per-area `/simplify` + `/code-review`.** As each module is cleaned
  in Phase 2, run `/simplify` (quality) and `/code-review` (correctness) on that
  diff before committing. These are the per-chunk workhorses.

---

## Phase 2 — Module-by-module sweep

Work one module at a time. For each: read it end-to-end, apply the relevant
invariant checks below, log findings, fix the M16 ones, run that module's test
suite + `/simplify` + `/code-review`, then **ship as one small release** (version
bump + RELEASES entry with Honest Disclosures + doc footer + CACHE_VERSION if a
pre-cached asset changed). Mark the row ✅ when released.

### Backend — storage layer (`src/storage/`)

| File | Status | Module-specific watch-items |
|------|--------|-----------------------------|
| `employees.js`     | ☐ | `aadFor(id)` on every blob; UUID re-validation; 500-char caps |
| `punches.js`       | ☐ | `punch.comment` ≤500; totals math; throw-vs-null contract |
| `corrections.js`   | ☐ | `justification`/`notes` ≤500; state machine completeness |
| `leaves.js`        | ☐ | `reason`/`notes` ≤500; carry-over math; concurrent-edit path |
| `reports.js`       | ☐ | scope=me|all isolation; CSV escaping; period bucketing |
| `audit.js`         | ☐ | AAD `pica-audit-v1`; best-effort never-throws; monthly rotation |
| `org-settings.js`  | ☐ | mail master-switch gating |
| `user-prefs.js`    | ☐ | per-user opt-out defaults (DEFAULT_PREFS truth) |
| `mail-config.js`   | ☐ | never-throws; `pass` write-only; abort-not-clobber `write()` |
| `company-logo.js`  | ☐ | content-type/size validation |
| `backups.js`       | ☐ | magic prefix; HKDF key; config.json NOT in backup |
| `period.js`        | ☐ | `computePeriod`/`ymdOf`/`isWeekday` unchanged (dashboard relies) |

### Backend — routes (`src/routes/`)

| File | Status | Module-specific watch-items |
|------|--------|-----------------------------|
| `employees.js`   | ☐ | `rejectIfBadId` at top of **every** `:id` handler |
| `punches.js`     | ☐ | role checks; person-picker scoping |
| `corrections.js` | ☐ | employer-only decision routes; audit on approve/reject |
| `leaves.js`      | ☐ | employee isolation; attachment handling; audit events |
| `reports.js`     | ☐ | removed legacy endpoints stay 404 (no shim) |
| `settings.js`    | ☐ | employer-only; org fetch 503-safe during lockdown |
| `security.js`    | ☐ | three independent lockdown allowlists intact |
| `mail.js`        | ☐ | `PUT /api/settings/mail` audited with NO details (no `pass` leak) |
| `backups.js`     | ☐ | restore lockdown allowlist; status endpoint |
| `auth.js`        | ☐ | rate-limit; `/api/logout` has no `requireAuth` (by design) |
| `setup.js`       | ☐ | first-run only path |
| `pages.js`       | ☐ | route order (api before pages, static fallback) |

### Backend — crypto / auth / http / infra

| File(s) | Status | Module-specific watch-items |
|---------|--------|-----------------------------|
| `crypto/aes.js`, `dek.js`, `keyring.js`, `masterkey.js`, `rotate.js` | ☐ | envelope v2 wording; wrap AAD `pica-dek-wrap-v1:<slot>`; no key-on-disk |
| `crypto/backup-archive.js`, `passwords.js`, `prompt.js`, `index.js`  | ☐ | HKDF; password hashing params; no secret logging |
| `auth/sessions.js`, `users.js`, `rbac.js`, `rate-limit.js`           | ☐ | session verify; role matrix; limiter reset paths |
| `http/body.js`, `cookies.js`, `responses.js`, `static.js`, `security-headers.js` | ☐ | 5MB cap; multipart edge cases; CSP hash; SameSite=Lax |
| `util/validators.js`                                                 | ☐ | `isUuid` correctness; post-decode validation |
| `mail/smtp.js`, `mailer.js`, `templates.js`                          | ☐ | submission-only; gating layers; en/pt parity |
| `scheduler/backup-scheduler.js`, `reminder-scheduler.js`            | ☐ | no month pre-filter (deliberate); `markReminderSent` |
| `server.js`, `config.js`, `logger.js`, `router.js`                  | ☐ | store wiring; lockdown allowlists; trailing-slash strip |

### Frontend (`public/`)

Run the relevant test suites (`test-frontend-imports`, `test-theme-*`,
`test-sw-precache`, `test-i18n`, `test-no-alias-tokens`) after each change.

| Area | Status | Module-specific watch-items |
|------|--------|-----------------------------|
| Shared: `i18n.js`, `app.js`, `topbar.js`, `modal.js`, `calendar-grid.js` | ☐ | `fmtHours/fmtDate` used everywhere (no raw `.toFixed`); `mountTopBar`+`mountFooter` |
| Locales `locales/en-US.js`, `pt-PT.js` | ☐ | key parity; no orphan keys; `translateError` codes covered |
| Punch: `punch*.js`, `manual-time-modal.js` | ☐ | totals via `fmtHours`; modal CSS injection pattern |
| Leaves: `leave*.js`, `request-leave-modal.js`, `leaves-calendar.js` | ☐ | detail-modal parity with `/leaves/:id` deep-link fallback |
| Corrections: `correction*.js` | ☐ | modal parity with deep-link |
| Employees: `employee*.js`, `employees.js`, `team-status.js` | ☐ | person-picker reuse; no duplicated render logic |
| Settings/Prefs/Security: `settings.js`, `preferences.js`, `security.js` | ☐ | security page stays standalone; 503-safe mounts |
| Reports/geo/setup/login: `reports.js`, `geo*.js`, `setup.js`, `login.js`, `index.js` | ☐ | CSV/print paths; no inline styles/scripts |
| Service worker: `sw.js` | ☐ | pre-cache list = shell only (no HTML); `CACHE_VERSION` accuracy |

---

## Phase 3 — Cross-cutting invariant audits

These cut across modules; do them as dedicated grep-driven sweeps and write a
**test** for any gap (don't just hand-fix), so the invariant is enforced going
forward.

- [~] **`rejectIfBadId` coverage.** ⚠️ Partial — confirmed present on all 10
  employee `:id` handlers (C4). Other `:id` routes (`punches` `by-employee/:id`,
  `corrections`, `leaves`) do NOT use it; `punches` building a path from the raw id
  is logged as **F2 → M17** (security). No per-route test added yet.

- [ ] **500-char caps.** ⬜ NOT done. Grep storage writers for the five capped
  free-text fields (`punch.comment`, `correction.justification`, `correction.notes`,
  `leave.reason`, `leave.notes`); confirm each is enforced at the storage layer and
  covered by a test.

- [x] **`fmtHours`/`fmtDate` usage.** ✅ Done (C1) — no hour-formatting bypass; the
  one raw-locale month label (`index.js`) was **F3**, fixed in 0.52.2. Remaining
  raw `toLocaleDateString(locale,…)` calendar labels correctly pass the app locale.

- [x] **`encryptBlob` AAD.** ✅ Done (C2) — every `encryptBlob`/`encryptField` call
  site passes a context-binding AAD; none default/empty.

- [ ] **CACHE_VERSION discipline.** ⬜ NOT fully audited. (Note: F6 corrected the
  CLAUDE.md description of which assets are pre-cached.) Still confirm
  `test-sw-precache` covers the full `PRECACHE_URLS` and that the list matches reality.

- [ ] **Inline style/script ban + CSP hash parity.** ⬜ NOT done. Confirm
  `test-security-headers` still enforces the byte-identical bootstrap across all HTML.

- [ ] **Store throw-vs-null contract.** ⬜ NOT done. Spot-check that stores throw on
  programmer errors and return null/false on legitimate not-found, and routes map
  accordingly.

- [x] **(bonus) en/pt locale key parity.** ✅ Done (C3) — 974 keys each, zero orphans.

---

## Phase 4 — Doc-truth pass (do this LAST, after code is settled)

Code drifted from docs; reconcile in this order (per `reference_pica_docs`):

- [x] **Test count.** ✅ Done (F4, 0.52.3) — CLAUDE.md `~33` → 53. `docs/architecture.md`
  was already correct (53); roadmap's "40/41" mentions are historical, left intact.

- [~] **File lists.** ⚠️ Partial — `leave-format.js` added to `architecture.md`.
  Still reconcile the full `src/storage/`, `src/routes/`, `public/` inventories
  (e.g. `modal.js`, `geo*.js`, the `*-detail-modal.js` files) against reality.

- [x] **Footers.** ✅ Kept current — every `docs/*.md` touched by an M16 release got
  its `_Last touched in vX.Y.Z._` footer bumped as part of that release.

- [x] **Roadmap status.** ✅ Done — `docs/roadmap.md` shows M16 🚧 In progress (0.52.0);
  M17–M20 framing unchanged.

- [x] **handoff.md.** ✅ Kept current — snapshot reflects v0.52.5 and the open/closed
  finding list. (Re-verify again before M16 *closes*.)

- [ ] **RELEASES.md.** ⬜ Final coherence pass still owed — entries exist for
  0.52.0–0.52.5 with Honest Disclosures; do the read-through when M16 closes.

---

## Triage rubric (apply to every finding)

| Lens of finding | Triage |
|-----------------|--------|
| Dead code, duplication, naming, altitude, consistency | **M16** — fix now |
| Correctness bug (wrong output, broken state) | **M16** — fix + regression test |
| Auth/crypto/input-validation weakness, info leak, timing | **M17** — log, do **not** fix here |
| Needs a dependency, format change, or rearchitecture | **later** — log for a future milestone |
| Deliberate trade-off already documented | **wontfix** — note it, move on |

When unsure whether a finding is "quality" or "security," treat it as security and
defer to M17 — the cost of carrying a quality nit one milestone is low; the cost of
half-reviewing security under a quality lens is high.

---

## Release cadence

M16 is **many small releases, not one**. Recommended unit: one release per module
(or per cross-cutting sweep) that produced changes. Each release:

1. Bump `version` + `releaseDate` in `package.json`.
2. RELEASES.md entry **with Honest Disclosures** (what this cleanup did NOT touch).
3. Bump `CACHE_VERSION` in `sw.js` *iff* a pre-cached asset changed (CSS/JS shell,
   locales, manifest, icon — **not** HTML).
4. Update the touched `docs/*.md` footer.
5. Run that module's suite(s) + `/simplify` + `/code-review`; green before commit.

Keeping releases small means every cleanup is independently revertable if a
behavior regression surfaces later.

---

## What this plan does NOT do (Honest Disclosures)

- **No security remediation.** Security findings are logged and deferred to M17 by
  design. M16 does not harden anything; it may *surface* issues it deliberately
  leaves unfixed.
- **No behavior changes.** If a cleanup changes externally visible behavior, it is
  out of scope and gets reclassified as a feature, not a refactor.
- **No automated browser tests.** The Playwright/E2E milestone was dropped; the
  zero-dependency constraint stands. Frontend verification stays manual smoke +
  the re-implemented-inline test pattern.
- **No performance milestone.** Optimization here means removing waste, not scaling
  past ≤50 employees. Full-table scans stay.
- **Not a guarantee of completeness.** A human/Claude review of ~24k LOC will miss
  things. The invariant tests added in Phase 3 are the durable safety net; the
  manual sweep is best-effort.
- **`/code-review ultra` is operator-triggered.** This plan cannot launch it; it
  assumes Pedro runs it and feeds results into the ledger.

---

_Plan written 2026-06-03 against v0.51.0. Progress snapshot last updated 2026-06-03
at v0.52.5 (commit `b3413f7`) — see "Progress snapshot — RESUME HERE" near the top._
