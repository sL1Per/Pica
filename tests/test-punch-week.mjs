#!/usr/bin/env node
// Pure-helper tests for the punch clock page's This-week grouping/pairing.
// The helpers are re-implemented inline (the test-i18n.mjs pattern) because
// public/punch.js imports /-absolute browser modules Node can't resolve.
// KEEP these copies byte-for-byte identical to punch.js's groupPunchesByDay /
// pairDay.
import assert from 'node:assert/strict';

// --- copies of public/punch.js pure helpers (keep in sync) ---
function groupPunchesByDay(punches) {
  const byDay = new Map();
  for (const p of [...punches].sort((a, b) => new Date(a.ts) - new Date(b.ts))) {
    const ymd = new Date(p.ts).toISOString().slice(0, 10);
    if (!byDay.has(ymd)) byDay.set(ymd, []);
    byDay.get(ymd).push(p);
  }
  return [...byDay.entries()].map(([ymd, list]) => ({ ymd, list }));
}
function pairDay(list) {
  const pairs = []; let open = null;
  for (const p of list) {
    if (p.type === 'in') { if (open) pairs.push({ in: open, out: null }); open = p; }
    else if (p.type === 'out') { pairs.push({ in: open, out: p }); open = null; }
  }
  if (open) pairs.push({ in: open, out: null });
  return pairs;
}

let passed = 0, failed = 0;
const test = (n, f) => { try { f(); console.log(`  ✓ ${n}`); passed++; }
  catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); failed++; } };

const inP  = (ts) => ({ type: 'in',  ts });
const outP = (ts) => ({ type: 'out', ts });

console.log('groupPunchesByDay');
test('groups across two UTC days, sorted ascending', () => {
  const g = groupPunchesByDay([
    outP('2026-05-20T12:00:00Z'),
    inP('2026-05-19T08:00:00Z'),
    inP('2026-05-20T09:00:00Z'),
  ]);
  assert.equal(g.length, 2);
  assert.equal(g[0].ymd, '2026-05-19');
  assert.equal(g[1].ymd, '2026-05-20');
  assert.equal(g[0].list.length, 1);
  assert.equal(g[1].list.length, 2);
});
test('empty input → empty array', () => {
  assert.deepEqual(groupPunchesByDay([]), []);
});

console.log('pairDay');
test('normal in→out pair', () => {
  const pairs = pairDay([inP('2026-05-20T08:00:00Z'), outP('2026-05-20T12:00:00Z')]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].in.ts, '2026-05-20T08:00:00Z');
  assert.equal(pairs[0].out.ts, '2026-05-20T12:00:00Z');
});
test('two closed pairs', () => {
  const pairs = pairDay([
    inP('2026-05-20T08:00:00Z'), outP('2026-05-20T10:00:00Z'),
    inP('2026-05-20T11:00:00Z'), outP('2026-05-20T12:00:00Z'),
  ]);
  assert.equal(pairs.length, 2);
  assert.equal(pairs[1].in.ts, '2026-05-20T11:00:00Z');
});
test('trailing open in → { out: null }', () => {
  const pairs = pairDay([inP('2026-05-20T09:00:00Z')]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].in.ts, '2026-05-20T09:00:00Z');
  assert.equal(pairs[0].out, null);
});
test('double in flushes the first as open-with-no-out', () => {
  const pairs = pairDay([inP('2026-05-20T08:00:00Z'), inP('2026-05-20T09:00:00Z')]);
  assert.equal(pairs.length, 2);
  assert.equal(pairs[0].out, null);              // first in, never closed
  assert.equal(pairs[1].in.ts, '2026-05-20T09:00:00Z');
  assert.equal(pairs[1].out, null);              // second in still open
});
test('orphan out → { in: null }', () => {
  const pairs = pairDay([outP('2026-05-20T17:00:00Z')]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].in, null);
  assert.equal(pairs[0].out.ts, '2026-05-20T17:00:00Z');
});
test('empty list → no pairs', () => {
  assert.deepEqual(pairDay([]), []);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
