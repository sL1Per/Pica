// Static guard: the M19 user/admin guides must exist, README must link
// both, and every image they reference must be present on disk. Does NOT
// validate prose. Run: node tests/test-guides.mjs
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const has = (p) => existsSync(path.join(root, p));

// Both guides + the images README exist.
for (const f of ['docs/user-guide.md', 'docs/admin-guide.md', 'docs/images/README.md']) {
  assert.ok(has(f), `missing guide file: ${f}`);
}

// README links both guides.
const readme = read('README.md');
assert.ok(/docs\/user-guide\.md/.test(readme), 'README must link docs/user-guide.md');
assert.ok(/docs\/admin-guide\.md/.test(readme), 'README must link docs/admin-guide.md');

// Every image referenced from a guide exists under docs/. Image links are
// written relative to docs/ (e.g. images/foo.png), so resolve under docs/.
for (const g of ['docs/user-guide.md', 'docs/admin-guide.md']) {
  const md = read(g);
  const refs = [...md.matchAll(/!\[[^\]]*\]\((images\/[^)]+)\)/g)].map((m) => m[1]);
  assert.ok(refs.length > 0, `${g} should reference at least one screenshot`);
  for (const r of refs) {
    assert.ok(has(path.join('docs', r)), `${g} references missing image: docs/${r}`);
  }
}

// The cross-links between the two guides are present.
assert.ok(/admin-guide\.md/.test(read('docs/user-guide.md')), 'user guide must link admin guide');
assert.ok(/user-guide\.md/.test(read('docs/admin-guide.md')), 'admin guide must link user guide');

console.log('test-guides: all assertions passed');
