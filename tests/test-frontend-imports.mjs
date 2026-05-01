#!/usr/bin/env node
/**
 * Frontend module — static import audit.
 *
 * Scans every module under public/ and verifies that any imported
 * symbol used in the body is actually in the import list. Catches
 * bugs like the one in 0.16.1: a JS file calling `applyTranslations()`
 * without importing it, which crashes the module at load time and
 * breaks the page silently (no test caught it because we don't yet
 * have browser-based E2E tests).
 *
 * Specifically checks i18n.js exports — the most common class of
 * missing-import bug we've hit in M9/M10. Could be extended to other
 * modules but starting narrow.
 *
 * Run:  node tests/test-frontend-imports.mjs
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// The i18n module's named exports. If you add or remove an export
// from i18n.js, update this list too.
const I18N_EXPORTS = ['t', 'tn', 'translateError', 'applyTranslations',
                      'fmtDate', 'fmtTime', 'fmtDateTime',
                      'getLocale', 'getSupportedLocales'];

// Pages that don't use i18n at all (no top-bar, login/setup-only path,
// or pure infrastructure). All current pages happen to use i18n via
// topbar.js, so this list is empty in practice — kept as a hook.
const SKIP_FILES = new Set(['i18n.js', 'sw.js']);

function getJsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(entry.name);
    }
  }
  return out;
}

function getImportedFromI18n(source) {
  // Match `import { a, b as c } from '/i18n.js';`
  const m = source.match(/import\s*\{([^}]+)\}\s*from\s*['"]\/i18n\.js['"]/);
  if (!m) return null;
  return m[1]
    .split(',')
    .map((s) => s.trim())
    .map((s) => s.split(/\s+as\s+/)[0].trim())  // unalias
    .filter(Boolean);
}

function getBodyExcludingImports(source) {
  // Strip top-of-file import lines so a `t(...)` call inside a
  // comment doesn't false-positive against the destructured import.
  const lines = source.split('\n');
  return lines
    .filter((l) => !l.match(/^\s*import\s/))
    .join('\n');
}

console.log('Frontend i18n import audit');

const files = getJsFiles(publicDir).filter((f) => !SKIP_FILES.has(f));

for (const file of files) {
  const path = join(publicDir, file);
  const source = readFileSync(path, 'utf8');
  const body = getBodyExcludingImports(source);
  const imported = getImportedFromI18n(source);

  // For each i18n export, check whether the body uses it. If used
  // but not imported, that's a runtime error waiting to happen.
  for (const exportName of I18N_EXPORTS) {
    // Match the symbol as a function call: `name(`. We use a word
    // boundary on the left so `tn(` doesn't match `getLocale(...)tn(`.
    const usagePattern = new RegExp(`(^|[^a-zA-Z0-9_$.])${exportName}\\s*\\(`, 'm');
    const isUsed = usagePattern.test(body);
    if (!isUsed) continue;

    // Special exception: `applyTranslations` is sometimes defined as
    // a local function in a module (preferences.js does this). If a
    // local function declaration matches the name, the file is
    // self-contained — no import needed.
    const localDeclPattern = new RegExp(`function\\s+${exportName}\\s*\\(`);
    if (localDeclPattern.test(body)) continue;

    // Used → must be imported.
    test(`${file} imports ${exportName}`, () => {
      assert.ok(
        imported && imported.includes(exportName),
        `${file} calls ${exportName}() but its i18n.js import block is missing the symbol. ` +
        `Add it to the destructured import at the top of the file.`,
      );
    });
  }
}

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
