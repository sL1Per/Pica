# Development

Conventions and how-to recipes for working on Pica.

> Doc scope: coding practices, page conventions, how to add common
> things (page, translation, test, route), how to run things locally.
> For structural background see [architecture.md](./architecture.md).
> For security rationale see [security.md](./security.md).

---

## Running locally

```bash
$ node server.js
Passphrase:  ********
Pica listening on http://localhost:8080
```

That's it. No `npm install`, no build step, no watcher.

For automated runs (testing, CI), set the passphrase via env var:

```bash
$ PICA_PASSPHRASE=devpassphrase node server.js
```

The passphrase must be at least 8 characters. The first run also
needs setup — `POST /api/setup` with `{ "username": "admin", "password": "..." }`
to create the first employer.

### Running the test suite

```bash
$ for s in crypto auth employees punches leaves reports user-prefs \
            org-settings company-logo corrections i18n frontend-imports; do
    node tests/test-$s.mjs
  done
```

Each suite is independent; you can run any single suite directly.
The suites use temp directories, but it's still good practice to
clear local state between full runs:

```bash
$ rm -rf data backups config.json
```

### Smoke testing changes that touch routes or pages

```bash
$ rm -rf data backups config.json
$ PICA_PASSPHRASE=smokepass node server.js > /tmp/pica.out 2>&1 &
$ sleep 2
$ curl -s -X POST -H "Content-Type: application/json" -c /tmp/cj \
    -d '{"username":"admin","password":"adminpass123"}' \
    http://127.0.0.1:8080/api/setup
$ # ... your curls here, with -b /tmp/cj for the cookie ...
$ kill %1 && rm -rf data backups config.json
```

The passphrase must be at least 8 characters. The setup password
must too.

---

## Page conventions

Every authenticated page in Pica follows the same shape. Skipping
any of these is a real bug, not a style preference.

### File layout
A page is three files in `public/`:

```
foo.html
foo.css   (optional — only if foo needs page-specific styles)
foo.js
```

The HTML uses a `<main class="container">` (or `container--wide` for
dashboards/2-column layouts) wrapper. Headers, sidebars, and footer
are mounted by `topbar.js` — pages don't write any of that markup.

### Inline theme bootstrap
Every page's `<head>` has this script BEFORE any stylesheet:

```html
<script>
  // Read color mode preference and apply it before paint to avoid FOUC.
  try {
    const mode = localStorage.getItem('pica-color-mode') || 'system';
    if (mode === 'dark' || (mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.dataset.theme = 'dark';
    }
  } catch {}
</script>
```

This prevents the white flash on dark-mode pages. Don't use a
stylesheet-based dark mode (`@media (prefers-color-scheme: dark)`)
because it would override the user's manual choice from Preferences.

### Module bootstrap
The `.js` file's first lines are always:

```js
import { /* helpers */ } from '/app.js';
import { t, /* maybe tn, translateError, applyTranslations, fmt* */ } from '/i18n.js';
import { mountTopBar, mountFooter } from '/topbar.js';
mountTopBar();
mountFooter();
applyTranslations();
```

Login and setup pages are the exception — they call `mountFooter()`
only (no top-bar before sign-in).

### Imports
Always destructure named imports. Always use absolute paths:
`import x from '/topbar.js'`, never `'./topbar.js'`. The browser
serves `public/` at `/`, and absolute paths make the imports work
identically from any URL depth (e.g. `/leaves/calendar` and `/punch`
both resolve `/topbar.js` the same way).

### Avoiding common bugs
- **Don't shadow imports.** A common bug: writing
  `const t = document.createElement('table')` inside a function that
  also calls `t('some.key')` — JS scoping turns the second `t` into
  the table element. Use `tbl` or any other name. The
  `frontend-imports` test only catches missing imports, not shadowed
  ones.
- **Don't forget `applyTranslations()`.** If you add `data-i18n`
  attributes to an HTML page, the JS must call `applyTranslations()`
  at module load.
- **Don't add inline styles in `public/`.** Use the page's `.css`
  file or a token from `app.css`. The only inline styles allowed are
  one-off `style="margin-top: var(--gap-3)"` adjustments where
  adding a class would be more code than it's worth.

---

## Adding a page

Suppose you want a new page `/foobar`.

1. **HTML** — `public/foobar.html`. Copy any existing page (e.g.
   `leaves.html`) and adjust:
   - `<title data-i18n="title.foobar">Pica — Foobar</title>`
   - The `<main class="container">` body
   - Reference `/foobar.js` and `/foobar.css` (if used) at the bottom
2. **CSS** — `public/foobar.css` if needed. Use design tokens
   (`var(--gap-4)`, `var(--text)`, etc.) — don't hardcode colors or
   spacings.
3. **JS** — `public/foobar.js`. Module bootstrap as above.
4. **Translations** — add `title.foobar` and any new visible strings
   to BOTH `public/locales/en-US.js` and `public/locales/pt-PT.js`.
   The i18n test will fail until parity is restored.
5. **Server route** — register a GET handler in
   `src/routes/pages.js`:
   ```js
   router.get('/foobar', requireAuth((req, res) => {
     return sendHtml(res, 'foobar.html', req);
   }));
   ```
   `sendHtml` does locale meta-injection. Don't bypass it with raw
   file streaming.
6. **Top-bar nav link** — if the page should appear in the
   sidebar, edit `topbar.js`'s `NAV_ITEMS` array. Use a
   translation key (`labelKey: 'nav.foobar'`) and add it to the
   dictionaries.
7. **Service Worker** — if the page is one of the pre-cached shell
   pages (rare; we currently only pre-cache the literal shell
   files), add it to `PRECACHE_URLS` in `public/sw.js`. Most pages
   should NOT be pre-cached, see [security.md → Service Worker caching](./security.md#service-worker-caching).
8. **Smoke** — boot the server, hit `/foobar`, look for 200 + the
   right text in the response body.

---

## Adding a translation

The dictionary is two files:

```
public/locales/en-US.js
public/locales/pt-PT.js
```

Each is a default-exported object: `{ 'foo.bar': 'Some text', ... }`.

### Conventions
- **Key naming**: lowerCamelCase with dot namespacing.
  `nav.employees`, `punch.statusIn`, `leaves.type.vacation`.
- **`errors.*` keys use snake_case** to match backend error codes
  (`errors.invalid_credentials`).
- **Plural keys are objects** with `one` / `other`:
  ```js
  'punch.queueWaiting': {
    one:   '{count} punch waiting',
    other: '{count} punches waiting',
  }
  ```
  Used via `tn('punch.queueWaiting', count)`.
- **Placeholders** use `{name}` syntax. Both locales must declare
  the same placeholders for the same key — the test enforces this.

### Adding a string

1. Pick a key (or reuse an existing one if it fits).
2. Add it to **both** dictionaries with translated values. The i18n
   test fails on missing parity.
3. Use `t('your.key')` in JS, or `data-i18n="your.key"` on the HTML
   element (and make sure the page calls `applyTranslations()`).
4. For attribute-based translations (e.g. placeholders):
   `data-i18n-attr="placeholder:your.key"`.
5. Run `node tests/test-i18n.mjs` to confirm parity, plural shape,
   placeholder match.

### Date and time formatting

Use the helpers from `i18n.js`:

```js
import { fmtDate, fmtTime, fmtDateTime, getLocale } from '/i18n.js';

fmtTime('2026-05-02T09:14:00Z')        // '09:14'
fmtDate('2026-05-02')                  // '2 May 2026' / '2 mai 2026'
fmtDateTime('2026-05-02T09:14:00Z')    // '2 May 2026, 09:14'
```

These wrap `Intl.DateTimeFormat` with the current locale. For
absolute control over format options, call
`new Intl.DateTimeFormat(getLocale(), { ... }).format(date)`.

### What about backend errors?

The frontend has `translateError(code, fallback)` that looks up
`errors.<code>` in the dictionary, falling back to the `fallback`
string (which is usually the `error` field from the API response).

Today the backend mostly returns English `error` strings without
`errorCode` — the frontend silently falls back to the English. M12
will add `errorCode` emission to every error response site.

Pattern at the frontend call site:

```js
const result = await postJson('/api/leaves', body);
if (!result.ok) {
  showMessage(messageEl,
    translateError(result.data.errorCode, result.data.error || 'Generic message'),
    'error');
}
```

---

## Adding a route

Routes live under `src/routes/<resource>.js`. Each module exports a
`registerXxxRoutes(router, deps)` function that the entry-point
calls during startup.

### Anatomy of a route module

```js
// src/routes/foobar.js
//
// Routes:
//   GET    /api/foobar           — list
//   GET    /api/foobar/:id       — read one
//   POST   /api/foobar           — create
//   PUT    /api/foobar/:id       — update
//   DELETE /api/foobar/:id       — delete

export function registerFoobarRoutes(router, { foobarStore, requireAuth, requireRole }) {
  router.get('/api/foobar', requireAuth(async (req, res) => {
    const items = foobarStore.list();
    res.json({ foobars: items });
  }));

  router.post('/api/foobar', requireRole('employer')(async (req, res) => {
    const body = await req.json();
    // validate body...
    const created = foobarStore.create(body);
    res.json({ foobar: created });
  }));

  // ...
}
```

### Route ordering matters
The router is **first-match-wins**. A more specific path must be
registered before a less specific one:

```js
router.get('/api/leaves/approved', ...);  // first — exact match
router.get('/api/leaves/:id',      ...);  // second — :id matches anything
```

If you register `:id` first, `GET /api/leaves/approved` would treat
`approved` as an ID and 404 (or worse, return some random leave
whose ID happens to be `approved`).

### Standard error response shape

```js
res.badRequest('Reason here', { errorCode: 'invalid_value' });
res.notFound('Foo not found', { errorCode: 'not_found' });
res.forbidden();
res.unauthorized();
```

The helpers live in `src/http/responses.js`. Always pass an
`errorCode` for known business errors so the frontend can localize.

### Documenting in the route file
The top-of-file comment block lists every route the file
registers, with a one-line description. This is the source of
truth for the API surface — no separate API doc to maintain.

---

## Adding a test

Tests are `node:test`-style suites in `tests/`. Each suite is a
single `.mjs` file you run directly:

```bash
$ node tests/test-foobar.mjs
```

### Test file shell

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFoobarStore } from '../src/storage/foobar.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

const masterKey = Buffer.alloc(32, 1);

console.log('foobar storage');

await test('creates and reads back', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pica-foo-'));
  try {
    const s = createFoobarStore(dir, masterKey);
    const created = s.create({ name: 'Alice' });
    const got = s.findById(created.id);
    assert.equal(got.name, 'Alice');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
```

### Test discipline
- **Each test gets its own temp dir.** No shared state.
- **Always clean up.** `try/finally` is the simplest pattern.
- **Use a fixed master key** for tests (`Buffer.alloc(32, 1)`).
  The encryption is identical, just deterministic for repro.
- **No mocking framework.** If a test needs to control time or
  randomness, swap the dependency in via the store factory.

---

## Bumping a version

Every release does ALL of these in the same commit:

1. **`package.json`** — bump `version` and update `releaseDate`.
   The footer reads both. Format: `"version": "0.16.1"`,
   `"releaseDate": "2026-05-02"`.
2. **`public/sw.js`** — bump `CACHE_VERSION` if any pre-cached or
   runtime-cached asset changed (CSS, JS, i18n, locales, icons,
   manifest). When in doubt, bump.
3. **`RELEASES.md`** — add an entry under the new version with
   what shipped, why, files touched, honest disclosures.
4. **`docs/*.md`** — update the relevant doc file(s) and bump the
   "Last touched in vX.Y.Z" footer. Architecture changes →
   architecture.md. New deployment expectations → security.md.
   New conventions or how-tos → development.md (this file).
   Milestone status → roadmap.md.
5. **`README.md`** — only if the entry-point info changed (rare).

### Version conventions
- **Patch** (0.X.Y → 0.X.Y+1): bug fix, doc-only change, small UX
  tweak that doesn't change semantics.
- **Minor** (0.X.0 → 0.X+1.0): new feature, milestone close,
  reorganization. Pica is pre-1.0, so we don't promise backward
  compat across minors — but we don't break things gratuitously.
- **Major** (0.x → 1.0): not yet planned. Probably ties to a
  combination of M11+M12 closing and a real production deployment.

---

## Process commitments (carry forward)

These are the rules I (Claude) commit to following on every
change. They're listed here because they're easy to forget and
losing them is how documentation rots.

- **Every release bumps both `version` AND `releaseDate` in
  `package.json`.** No exceptions. The footer reads them.
- **Every release adds a `RELEASES.md` entry.** Detailed: what
  shipped, why, files touched, honest disclosures.
- **Any change to a pre-cached SW asset bumps `CACHE_VERSION`.**
- **Every code change touches the relevant `docs/*.md` file** in
  the same turn, with the `_Last touched in vX.Y.Z_` footer
  updated.
- **Token budget conservation**: grep before view; narrow line
  ranges; batch tool calls; prefer `str_replace` over rewriting
  whole files; use scripted batch edits via Python for repetitive
  work.
- **Drop pattern**: substantial features split into a backend-only
  drop then a frontend-only drop. Each drop ships its own zip.

---

_Last touched in 0.18.0._
