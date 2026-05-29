#!/usr/bin/env node
// Asserts app.css declares the full M15 token cascade (6 theme×palette combos).
// The pre-M15 alias bridge was removed in 0.41.0 (all stylesheets reference
// canonical tokens directly); see tests/test-no-alias-tokens.mjs for the guard
// that the aliases stay gone.
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
