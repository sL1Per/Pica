#!/usr/bin/env node
// The SW must precache the self-hosted fonts and the shell assets so the app
// works offline, and CACHE_VERSION must be bumped past v44 (this release).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const sw = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sw.js'), 'utf8');
let passed = 0, failed = 0;
const test = (n, f) => { try { f(); console.log(`  ✓ ${n}`); passed++; }
  catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); failed++; } };

console.log('Service worker precache (M15)');
test('CACHE_VERSION is at least v46', () => {
  const m = sw.match(/pica-cache-v(\d+)/);
  assert.ok(m, 'no CACHE_VERSION found');
  assert.ok(Number(m[1]) >= 46, `expected >= v46, got v${m && m[1]}`);
});
for (const f of [
  '/fonts/instrument-serif-400.woff2', '/fonts/instrument-serif-400-italic.woff2',
  '/fonts/dm-sans-400.woff2', '/fonts/dm-sans-500.woff2', '/fonts/dm-sans-600.woff2',
  '/fonts/dm-sans-700.woff2', '/fonts/jetbrains-mono-400.woff2', '/fonts/jetbrains-mono-500.woff2',
])
  test(`precaches ${f}`, () => assert.ok(sw.includes(`'${f}'`), `missing ${f}`));
for (const f of ['/app.css', '/topbar.css', '/topbar.js', '/app.js', '/i18n.js', '/geo.js'])
  test(`precaches shell asset ${f}`, () => assert.ok(sw.includes(`'${f}'`)));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
