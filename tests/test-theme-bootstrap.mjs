#!/usr/bin/env node
// The inline theme+palette bootstrap must be ONE attribute-less <script>,
// byte-identical across every HTML page (so a single CSP hash covers them),
// and must resolve BOTH color-mode and palette. Also guards against any
// third-party font/script CDN URL sneaking into public/ (offline + privacy).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
let passed = 0, failed = 0;
const test = (n, f) => { try { f(); console.log(`  ✓ ${n}`); passed++; }
  catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); failed++; } };

const htmlFiles = readdirSync(publicDir).filter((f) => f.endsWith('.html'));

console.log('Inline bootstrap — content + uniqueness');
const bodies = new Set();
for (const f of htmlFiles) {
  const html = readFileSync(join(publicDir, f), 'utf8');
  const matches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  test(`${f} has exactly one attribute-less inline <script>`,
    () => assert.equal(matches.length, 1));
  if (matches.length === 1) bodies.add(matches[0][1]);
}
test('all bootstraps are byte-identical', () => assert.equal(bodies.size, 1));
test('bootstrap resolves color-mode and palette', () => {
  const b = [...bodies][0] || '';
  assert.match(b, /pica-color-mode/, 'reads pica-color-mode');
  assert.match(b, /pica-palette/, 'reads pica-palette');
  assert.match(b, /prefers-color-scheme/, 'resolves system mode');
  assert.match(b, /data-palette/, 'sets data-palette');
});

console.log('\nNo third-party CDN URLs in public/ (offline + privacy)');
const cdnPattern = /(fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com|cdn\.jsdelivr\.net|googlefonts)/;
for (const f of readdirSync(publicDir)) {
  if (!/\.(html|css|js)$/.test(f)) continue;
  test(`${f} has no font/script CDN URL`, () =>
    assert.doesNotMatch(readFileSync(join(publicDir, f), 'utf8'), cdnPattern));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
