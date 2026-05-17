#!/usr/bin/env node
/**
 * Reports client period navigation — TZ-independent anchor stepping.
 *
 * Regression for the off-by-one in negative-UTC zones: the old
 * public/reports.js step() used `new Date(state.anchor)` which parses a
 * bare YYYY-MM-DD as UTC midnight, then read/wrote LOCAL date fields —
 * landing a whole period off in the Americas (e.g. America/Los_Angeles).
 *
 * No DOM/browser harness exists, so — like tests/test-i18n.mjs — we
 * re-implement the frontend logic inline as a pure function and assert
 * against it. `stepAnchor` below is a MIRROR of public/reports.js
 * step()'s date math (the fixed, local-component anchor parse) and MUST
 * BE KEPT IN SYNC with it. The assertions are timezone-independent and
 * the suite re-execs itself under TZ=America/Los_Angeles to prove it.
 *
 * Run:  node tests/test-reports-nav.mjs
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);

/**
 * MIRROR of public/reports.js step() — keep in sync.
 *
 * Parses the YYYY-MM-DD anchor from LOCAL components (matching server
 * src/storage/period.js parseYmd), nudges by `delta` units of
 * `periodType`, and re-formats as YYYY-MM-DD from local fields. The
 * server's resolvePeriod re-normalizes (e.g. week snaps to Monday), so
 * this only needs to produce an anchor inside the target period.
 */
function stepAnchor(periodType, anchor, delta) {
  let a;
  if (anchor) {
    const [y, m, d] = anchor.split('-').map(Number);
    a = new Date(y, m - 1, d);
  } else {
    a = new Date();
  }
  if (periodType === 'day') a.setDate(a.getDate() + delta);
  else if (periodType === 'week') a.setDate(a.getDate() + delta * 7);
  else if (periodType === 'month') { a.setDate(1); a.setMonth(a.getMonth() + delta); }
  else a.setFullYear(a.getFullYear() + delta);
  return `${a.getFullYear()}-${String(a.getMonth() + 1).padStart(2, '0')}-${String(a.getDate()).padStart(2, '0')}`;
}

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

console.log(`Reports period nav (TZ=${process.env.TZ || 'host default'})`);

// ---- Month -------------------------------------------------------------

test('month ▶ advances one calendar month', () => {
  assert.equal(stepAnchor('month', '2026-02-01', +1), '2026-03-01');
});

test('month ◀ goes back one calendar month', () => {
  assert.equal(stepAnchor('month', '2026-02-01', -1), '2026-01-01');
});

test('month ▶ across year boundary', () => {
  assert.equal(stepAnchor('month', '2026-12-15', +1), '2027-01-01');
});

// ---- Year --------------------------------------------------------------

test('year ▶ advances one year', () => {
  assert.equal(stepAnchor('year', '2026-01-01', +1), '2027-01-01');
});

test('year ◀ goes back one year (mid-month anchor)', () => {
  assert.equal(stepAnchor('year', '2026-06-15', -1), '2025-06-15');
});

// ---- Day ---------------------------------------------------------------

test('day ▶ advances one day', () => {
  assert.equal(stepAnchor('day', '2026-03-15', +1), '2026-03-16');
});

test('day ◀ crosses month boundary correctly', () => {
  assert.equal(stepAnchor('day', '2026-03-01', -1), '2026-02-28');
});

// ---- Week --------------------------------------------------------------

test('week ▶ moves anchor +7 days', () => {
  assert.equal(stepAnchor('week', '2026-03-11', +1), '2026-03-18');
});

test('week ◀ moves anchor -7 days', () => {
  assert.equal(stepAnchor('week', '2026-03-11', -1), '2026-03-04');
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);

// Re-exec under a negative-UTC zone to prove TZ independence. The
// assertions above are already TZ-agnostic; this makes the guarantee
// explicit and is what the bug actually broke.
let childFailed = false;
if (process.env.TZ !== 'America/Los_Angeles') {
  console.log('');
  console.log('Re-running under TZ=America/Los_Angeles ...');
  const r = spawnSync(process.execPath, [__filename], {
    env: { ...process.env, TZ: 'America/Los_Angeles' },
    stdio: 'inherit',
  });
  childFailed = r.status !== 0;
}

process.exit(failed > 0 || childFailed ? 1 : 0);
