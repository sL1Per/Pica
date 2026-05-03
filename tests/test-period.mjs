#!/usr/bin/env node
/**
 * Period helpers — computePeriod() / ymdOf() / isWeekday().
 * Used by /api/reports/team-hours and /api/employees/:id/summary.
 *
 * Run:  node tests/test-period.mjs
 */

import assert from 'node:assert/strict';

import { computePeriod, ymdOf, isWeekday } from '../src/storage/period.js';

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

console.log('Period helpers');

// ---- ymdOf --------------------------------------------------------------

test('ymdOf formats single-digit month/day with zero padding', () => {
  // Use a Date constructed from local components so we know exactly
  // what fields it has, regardless of host timezone.
  const d = new Date(2026, 0, 5);  // 2026-01-05 local
  assert.equal(ymdOf(d), '2026-01-05');
});

test('ymdOf formats double-digit month/day correctly', () => {
  const d = new Date(2026, 11, 31);  // 2026-12-31 local
  assert.equal(ymdOf(d), '2026-12-31');
});

// ---- isWeekday ----------------------------------------------------------

test('isWeekday is true for a Wednesday', () => {
  // 2026-05-06 is a Wednesday
  assert.equal(isWeekday(new Date(2026, 4, 6)), true);
});

test('isWeekday is false for a Saturday', () => {
  // 2026-05-02 is a Saturday
  assert.equal(isWeekday(new Date(2026, 4, 2)), false);
});

test('isWeekday is false for a Sunday', () => {
  // 2026-05-03 is a Sunday
  assert.equal(isWeekday(new Date(2026, 4, 3)), false);
});

// ---- computePeriod: today ----------------------------------------------

test('today: from === to === ymd(now)', () => {
  const now = new Date(2026, 4, 6);  // Wed 2026-05-06 local
  const p = computePeriod('today', now);
  assert.equal(p.from, '2026-05-06');
  assert.equal(p.to,   '2026-05-06');
  assert.equal(p.label, '2026-05-06');
  assert.equal(p.weekdays, 1);
});

test('today: weekdays=0 when now is a weekend', () => {
  const sat = new Date(2026, 4, 2);
  const p = computePeriod('today', sat);
  assert.equal(p.weekdays, 0);
});

// ---- computePeriod: week (ISO Mon-Sun) ----------------------------------

test('week starts on Monday for a Wednesday input', () => {
  // 2026-05-06 is a Wednesday
  const wed = new Date(2026, 4, 6);
  const p = computePeriod('week', wed);
  assert.equal(p.from, '2026-05-04', 'Mon');
  assert.equal(p.to,   '2026-05-10', 'Sun');
});

test('week starts on Monday when now IS Monday', () => {
  // 2026-05-04 is a Monday
  const mon = new Date(2026, 4, 4);
  const p = computePeriod('week', mon);
  assert.equal(p.from, '2026-05-04');
  assert.equal(p.to,   '2026-05-10');
});

test('week stays in current week when now is Sunday', () => {
  // ISO weeks end on Sunday. 2026-05-10 is a Sunday — should still
  // belong to the Mon-04 → Sun-10 window, not flip forward.
  const sun = new Date(2026, 4, 10);
  const p = computePeriod('week', sun);
  assert.equal(p.from, '2026-05-04');
  assert.equal(p.to,   '2026-05-10');
});

test('week handles month boundary (week spans two months)', () => {
  // 2026-04-30 is a Thursday → ISO week is Mon-04-27 → Sun-05-03.
  const thu = new Date(2026, 3, 30);
  const p = computePeriod('week', thu);
  assert.equal(p.from, '2026-04-27');
  assert.equal(p.to,   '2026-05-03');
});

test('week handles year boundary (week spans two years)', () => {
  // 2026-01-01 is a Thursday → ISO week is Mon-2025-12-29 → Sun-2026-01-04.
  const thu = new Date(2026, 0, 1);
  const p = computePeriod('week', thu);
  assert.equal(p.from, '2025-12-29');
  assert.equal(p.to,   '2026-01-04');
});

test('week label is from → to', () => {
  const wed = new Date(2026, 4, 6);
  const p = computePeriod('week', wed);
  assert.equal(p.label, '2026-05-04 → 2026-05-10');
});

test('week weekdays=5 for a normal week', () => {
  // No public holidays modeled — every Mon-Fri counts.
  const wed = new Date(2026, 4, 6);
  const p = computePeriod('week', wed);
  assert.equal(p.weekdays, 5);
});

// ---- computePeriod: month -----------------------------------------------

test('month spans the full calendar month', () => {
  // Mid-month input
  const d = new Date(2026, 4, 15);  // 2026-05-15
  const p = computePeriod('month', d);
  assert.equal(p.from, '2026-05-01');
  assert.equal(p.to,   '2026-05-31');
});

test('month label is yyyy-mm', () => {
  const d = new Date(2026, 4, 15);
  const p = computePeriod('month', d);
  assert.equal(p.label, '2026-05');
});

test('month handles February 2026 (28 days)', () => {
  const d = new Date(2026, 1, 10);
  const p = computePeriod('month', d);
  assert.equal(p.from, '2026-02-01');
  assert.equal(p.to,   '2026-02-28');
});

test('month handles February 2024 (leap year, 29 days)', () => {
  const d = new Date(2024, 1, 10);
  const p = computePeriod('month', d);
  assert.equal(p.from, '2024-02-01');
  assert.equal(p.to,   '2024-02-29');
});

test('month weekday count for May 2026', () => {
  // May 2026: 1=Fri, 2=Sat, 3=Sun, ..., 31=Sun.
  // Mon-Fri days: count = 21 (verified by hand: 5 weekdays × 4 weeks
  // covers most, plus extras).
  const d = new Date(2026, 4, 15);
  const p = computePeriod('month', d);
  assert.equal(p.weekdays, 21);
});

test('month weekday count for February 2026', () => {
  // Feb 2026: 1=Sun, 2-6=Mon-Fri, 7-8=Sat-Sun, 9-13=Mon-Fri, 14-15=Sat-Sun,
  // 16-20=Mon-Fri, 21-22=Sat-Sun, 23-27=Mon-Fri, 28=Sat. Mon-Fri = 20.
  const d = new Date(2026, 1, 10);
  const p = computePeriod('month', d);
  assert.equal(p.weekdays, 20);
});

// ---- computePeriod: error case -----------------------------------------

test('computePeriod throws on unknown period', () => {
  assert.throws(
    () => computePeriod('quarter', new Date()),
    /unknown period/,
  );
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
