// Static guard: every local image and relative Markdown/HTML link in
// README.md must resolve to a file on disk — so the GitHub landing page
// never shows a broken image or a dead doc link. Does NOT validate prose
// or check external (http) URLs. Run: node tests/test-readme.mjs
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readme = readFileSync(path.join(root, 'README.md'), 'utf8');
const has = (p) => existsSync(path.join(root, p));

// Strip an anchor / query so links like ./docs/x.md#section resolve to the file.
const toPath = (target) => target.replace(/[#?].*$/, '').replace(/^\.\//, '');
const isLocal = (target) => !/^(https?:|mailto:|#)/.test(target);

// Markdown images:  ![alt](path)   — both inline and reference-style inline.
const imgRefs = [...readme.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]);
// HTML <img src="...">  (the hero image).
const htmlImgRefs = [...readme.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);
// Markdown links:  [text](path)    — excludes images (negative lookbehind on '!').
const linkRefs = [...readme.matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1]);

const allRefs = [...imgRefs, ...htmlImgRefs, ...linkRefs].filter(isLocal);
assert.ok(allRefs.length > 0, 'README should contain local references');

for (const ref of allRefs) {
  const p = toPath(ref);
  assert.ok(has(p), `README references missing local file: ${p}`);
}

// The hero image and the four feature-strip screenshots are load-bearing for
// the landing page — assert them by name so a rename can't silently drop them.
for (const img of [
  'docs/images/admin-dashboard.png',
  'docs/images/user-clock.png',
  'docs/images/user-calendar.png',
  'docs/images/admin-reports.png',
  'docs/images/admin-team.png',
]) {
  assert.ok(htmlImgRefs.concat(imgRefs).some((r) => toPath(r) === img),
    `README must embed ${img}`);
  assert.ok(has(img), `missing landing-page screenshot: ${img}`);
}

console.log('test-readme: all assertions passed');
