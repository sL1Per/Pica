#!/usr/bin/env node
/**
 * Period helpers — computePeriod() / ymdOf() / isWeekday() plus the
 * period-preset helpers (resolvePeriod / shiftPeriod / defaultAnchor /
 * enumerateBuckets). computePeriod() is still used by
 * src/routes/employees.js for the dashboard summary.
 *
 * Run:  node tests/test-period.mjs
 */

import assert from 'node:assert/strict';

import {
  computePeriod, ymdOf, isWeekday,
  resolvePeriod, shiftPeriod, defaultAnchor, enumerateBuckets,
} from '../src/storage/period.js';

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

// ---- new period-preset helpers (M13 reports revamp) --------------------
// These use async/await style consistent with the plan but we wrap them
// in the same synchronous `test()` harness — no actual async work.

test('resolvePeriod day', () => {
  const p = resolvePeriod('day', '2026-03-09');
  assert.deepEqual(p, { type: 'day', from: '2026-03-09', to: '2026-03-09', bucketBy: 'day', label: '2026-03-09' });
});

test('resolvePeriod week = ISO Mon..Sun', () => {
  const p = resolvePeriod('week', '2026-03-11'); // Wed
  assert.equal(p.from, '2026-03-09'); // Monday
  assert.equal(p.to,   '2026-03-15'); // Sunday
  assert.equal(p.bucketBy, 'day');
  assert.match(p.label, /^2026-W\d{2}$/);
});

test('resolvePeriod month', () => {
  const p = resolvePeriod('month', '2026-02-17');
  assert.equal(p.from, '2026-02-01');
  assert.equal(p.to,   '2026-02-28'); // 2026 not leap
  assert.equal(p.bucketBy, 'day');
  assert.equal(p.label, '2026-02');
});

test('resolvePeriod year', () => {
  const p = resolvePeriod('year', '2026-07-04');
  assert.deepEqual(p, { type: 'year', from: '2026-01-01', to: '2026-12-31', bucketBy: 'month', label: '2026' });
});

test('shiftPeriod crosses boundaries', () => {
  assert.equal(shiftPeriod('day',   '2026-03-01', -1), '2026-02-28');
  assert.equal(shiftPeriod('month', '2026-01-15', -1), '2025-12-01');
  assert.equal(shiftPeriod('year',  '2026-07-04', +1), '2027-07-04');
  const a = shiftPeriod('week', '2026-03-11', +1);
  assert.equal(resolvePeriod('week', a).from, '2026-03-16');
});

test('defaultAnchor returns a YYYY-MM-DD', () => {
  assert.match(defaultAnchor('month'), /^\d{4}-\d{2}-\d{2}$/);
});

test('enumerateBuckets: month→days, year→months', () => {
  const days = enumerateBuckets('2026-02-01', '2026-02-28', 'day');
  assert.equal(days.length, 28);
  assert.equal(days[0], '2026-02-01');
  assert.equal(days[27], '2026-02-28');
  const months = enumerateBuckets('2026-01-01', '2026-12-31', 'month');
  assert.deepEqual(months, [
    '2026-01','2026-02','2026-03','2026-04','2026-05','2026-06',
    '2026-07','2026-08','2026-09','2026-10','2026-11','2026-12']);
});

console.log('');
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
