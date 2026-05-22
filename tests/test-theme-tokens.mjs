#!/usr/bin/env node
// Asserts app.css declares the full M15 token cascade (6 theme×palette combos)
// plus the alias bridge that keeps pre-M15 stylesheets rendering.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'app.css'), 'utf8');
let passed = 0, failed = 0;
const test = (n, f) => { try { f(); console.log(`  ✓ ${n}`); passed++; }
  catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); failed++; } };

console.log('M15 token cascade');
for (const sel of [
  ':root', '[data-theme="dark"]',
  '[data-palette="slate"]', '[data-palette="slate"][data-theme="dark"]',
  '[data-palette="olive"]', '[data-palette="olive"][data-theme="dark"]',
]) test(`declares selector ${sel}`, () => assert.ok(css.includes(sel), `missing ${sel}`));

for (const tok of ['--bg', '--bg-2', '--honey', '--honey-deep', '--paper', '--paper-2', '--ink', '--ink-2',
  '--muted', '--line', '--line-soft', '--sage', '--sage-soft', '--clay', '--clay-soft', '--plum'])
  test(`defines token ${tok}`, () => assert.match(css, new RegExp(`${tok.replace(/[-]/g, '\\-')}\\s*:`)));

console.log('\nAlias bridge (pre-M15 names still resolve)');
for (const alias of ['--accent', '--accent-hover', '--surface', '--surface-2',
  '--border', '--text', '--text-muted', '--text-subtle', '--success', '--danger'])
  test(`alias ${alias} maps to a var()`, () =>
    assert.match(css, new RegExp(`${alias.replace(/[-]/g, '\\-')}\\s*:\\s*var\\(--`)));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
