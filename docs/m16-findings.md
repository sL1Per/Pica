# M16 — Findings ledger

Working memory for the M16 code-review milestone. **Findings only — nothing here
has been fixed.** Pedro reviews and triages before any change is made.

**Triage values:** `M16` (fix this milestone — quality/correctness) ·
`M17` (security — defer to the security milestone, do NOT fix here) ·
`later` (needs a dependency / format change / rearchitecture) ·
`wontfix` (deliberate, documented trade-off).

**Status values:** `open` (logged, not reviewed by Pedro) · `accepted` (Pedro
agrees, queued to fix) · `rejected` (Pedro disagrees / won't do) · `fixed`
(shipped, with release).

---

## Findings

| ID | Module / file | Description | Lens | Triage | Status | Release |
|----|---------------|-------------|------|--------|--------|---------|
| F1 | `tests/test-reports.mjs` | ~~**Baseline is RED.** "overnight shift attributes hours to each day separately" expects 2 buckets, gets 1.~~ **FIXED (0.52.1).** Root cause was in the **test**, not the code: `hoursReport()` correctly splits overnight shifts at the server's *local* midnight, but the fixtures used fixed UTC instants (`22:00→06:00 UTC`) that only straddle local midnight in ~UTC-2..UTC+1; on the dev machine (CEST/UTC+2), LA, or Tokyo the shift lands on one local day → 1 bucket. Fix: pinned `process.env.TZ='UTC'` in the test. No production change. Verified across 5 timezones; full suite now 53/53. | correctness | M16 | **fixed** | 0.52.1 |
| F2 | `src/storage/punches.js:47` + `src/routes/punches.js:168` | `punchFile()` builds `path.join(monthDir, `${employeeId}.ndjson`)` directly from the `:id` path param of `GET /api/punches/by-employee/:id`, which has **no UUID guard** (`rejectIfBadId` is defined and used **only** in `employees.js`). This is the same class as the 0.22.0 path-traversal bug. `requireOwnerOrEmployer` gates access but does not validate the id shape. **Contrast:** `leaves.js` guards its attachment path with `safeLeaveId()` (throws on non-UUID), and `corrections.js` looks up `:id` by scanning ndjson logs (no path built from id), so those two are lower-risk. | security | **M17** | open | — |
| F3 | `public/index.js:482` | ~~`start.toLocaleString(undefined, { month: 'short' })` passes `undefined` as the locale → home leave month label follows the browser locale, not the app locale.~~ **FIXED (0.52.2).** Now imports `getLocale` and uses `start.toLocaleString(getLocale(), …)`, matching `leave.js` / `leave-detail-modal.js`. `CACHE_VERSION` v93→v94 (`/index.js` is pre-cached). | i18n / consistency | M16 | **fixed** | 0.52.2 |
| F4 | `CLAUDE.md` line 87 | ~~Stale test-suite count: "~33 suites"; actual is 53.~~ **FIXED (0.52.3).** Line 87 now reads "53 suites (source of truth: docs/architecture.md)". The "total 40"/"total 41" lines (296/314) were **left intact** — they are historical per-release counts (M14 / 0.26.0), correct in context, not current-state claims. | doc drift | M16 | **fixed** | 0.52.3 |
| F5 | `public/leave.js` ↔ `public/leave-detail-modal.js` | **FIXED (0.52.4) — at reduced scope.** Side-by-side read showed the *renderers* (`renderMiniCal`/`renderActivity`) are **adapted, not duplicated** (page `ldet-*` CSS + write-into-host vs modal `ldm-*` CSS + return-detached-node) — sharing them needs CSS unification + has no rendering tests, so left as-is. The only byte-identical code was 5 pure helpers (`pad2`, `ymd`, `parseYmd`, `formatWhen`, `formatDuration`), now extracted to `public/leave-format.js` and imported by both; orphaned `tn`/`fmtHours` imports removed; `/leave-format.js` added to SW precache; `CACHE_VERSION` v94→v95. The correction page/modal pair overlaps even less — **not** acted on. | duplication / DRY | M16 | **fixed** | 0.52.4 |
| F6 | `CLAUDE.md` (Hard rules → "pre-cached SW asset" list) | ~~Pre-cache list omitted per-page page scripts (only named the shell); `sw.js` `PRECACHE_URLS` also caches `index.js`, the `*-detail-modal.js` files, shared helpers.~~ **FIXED (0.52.5).** The rule (and the `sw.js` file-tree comment) now point to `PRECACHE_URLS` as the authoritative list and describe its real contents. CLAUDE.md is gitignored, so the fix lives in the working tree only. | doc drift | M16 | **fixed** | 0.52.5 |
| F7 | `CLAUDE.md` vs `.gitignore:8` | ~~CLAUDE.md is gitignored yet read as the project's institutional memory; doc-fixes never reach git/clones.~~ **RESOLVED (0.52.5) — keep local by design (Pedro's call).** (Correction to original note: the "checked into the codebase" phrase was the harness's label, not text in the file.) CLAUDE.md header now states it is local, gitignored, not committed, and does not travel with clones — this checkout's operator notes, not a shared source of truth. No `.gitignore` change. | repo / doc inconsistency | M16 | **fixed** | 0.52.5 |

---

## Checked — clean (no finding, recorded so we don't re-check)

| ID | Check | Result |
|----|-------|--------|
| C1 | Frontend hour formatting — grep `public/` for `.toFixed(` / `Math.round(* *10)` | **Clean.** All `.toFixed` hits are geo-coordinates (`punch*.js`, `geocode.js`) or byte sizes (`settings.js`, `request-leave-modal.js`); the only `Math.round(*10)/10` is inside `i18n.js`'s `fmtHours` implementation itself. No raw hour formatting bypasses `fmtHours`. |
| C2 | `encryptBlob` / `encryptField` AAD binding — every call site | **Clean.** All sites pass a context AAD: `aadFor(id)` (employees/punches/leaves/corrections), `LOGO_AAD`, `AAD` (audit), `MAGIC` (backup), `attachmentAadFor(id)` (leave attachments), rotate preserves AAD. None use an empty/default AAD. |
| C3 | Locale key parity `en-US.js` vs `pt-PT.js` | **Clean.** 974 keys each; zero keys present in only one. |
| C4 | `rejectIfBadId` on employee `:id` handlers | **Clean.** All 10 `:id` handlers in `employees.js` call it first. |
| C5 | Leave attachment on-disk path | **Clean.** `safeLeaveId()` throws on any non-UUID id before the path is built. |

---

## Coverage — what this first sweep actually covered

Be honest about review depth so later sessions know where to resume.

- **Phase 0 (baseline):** ✅ done — all 53 suites run; **F1** found (1 red suite) and
  **fixed in 0.52.1**; baseline is now **53/53 green**. Smoke NOT run (no-network
  container; must be done locally).
- **New observation (from F1):** other date-sensitive suites construct local `Date`s
  and may share F1's latent timezone fragility. They pass on this machine today. A
  "pin TZ in date-sensitive suites" check belongs in the Phase 3 sweep — logged here,
  not yet actioned.
- **Phase 1 (automated breadth):** ⛔ not done — `/code-review ultra` is operator-
  triggered; Pedro to run and paste results here.
- **Phase 2 (module-by-module reads):** 🟡 **not started as full reads.** Only
  grep-driven spot checks so far. The module matrix in `m16-code-review-plan.md`
  is still all-☐.
- **Phase 3 (cross-cutting invariant sweeps):** 🟡 partial — formatting (C1),
  AAD (C2), locale parity (C3), `rejectIfBadId` (C4), attachment path (C5) done;
  500-char caps, CACHE_VERSION list, CSP-hash parity, throw-vs-null contract NOT
  yet swept.
- **Phase 4 (doc truth):** logged **F4**; full pass deferred to end of milestone.

_Last touched in 0.52.5._
