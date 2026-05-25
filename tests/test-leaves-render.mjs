// Pure-helper tests for the M15 leaves frontend (Plan 4).
//
// The browser modules use absolute imports ('/i18n.js', '/app.js') that Node's
// resolver rejects, so — following the test-i18n.mjs pattern — we re-implement
// the small pure helpers here and lock their contract. These mirror:
//   • additionalDays()  in public/request-leave-modal.js (day-equivalent count,
//     which itself mirrors approxDaysOff() in src/storage/reports.js)
//   • countsByStatus()  in public/leaves.js (status partition + counts)

import assert from 'node:assert/strict';

// ---- Re-implemented helpers (kept byte-faithful to the frontend) -----------

function parseYmd(s) { const [y, m, d] = String(s).split('-').map(Number); return Date.UTC(y, m - 1, d); }

// Mirror of approxDaysOff / additionalDays.
function dayEquivalents(leave) {
  if (leave.unit === 'hours') {
    return typeof leave.hours === 'number' ? leave.hours / 8 : 0;
  }
  return Math.round((parseYmd(leave.end) - parseYmd(leave.start)) / 86_400_000) + 1;
}

function countsByStatus(leaves) {
  const c = { all: leaves.length, pending: 0, approved: 0, rejected: 0, cancelled: 0 };
  for (const l of leaves) if (c[l.status] !== undefined) c[l.status] += 1;
  return c;
}

// ---- Tests -----------------------------------------------------------------

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log('  ✓', name); }

// Day-equivalents
check('single full day = 1', () => {
  assert.equal(dayEquivalents({ unit: 'days', start: '2026-05-04', end: '2026-05-04' }), 1);
});
check('inclusive multi-day span', () => {
  assert.equal(dayEquivalents({ unit: 'days', start: '2026-05-04', end: '2026-05-08' }), 5);
});
check('span across month boundary', () => {
  // 2026-05-30, 31, 06-01 -> 3 days inclusive
  assert.equal(dayEquivalents({ unit: 'days', start: '2026-05-30', end: '2026-06-01' }), 3);
});
check('hours convert at 8h/day', () => {
  assert.equal(dayEquivalents({ unit: 'hours', hours: 8 }), 1);
  assert.equal(dayEquivalents({ unit: 'hours', hours: 4 }), 0.5);
});
check('hours with no number = 0', () => {
  assert.equal(dayEquivalents({ unit: 'hours' }), 0);
});

// Status partition + counts (valid-UUID fixtures, per the project convention)
const U = (n) => `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-4${n}${n}${n}-8${n}${n}${n}-${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}`;
const leaves = [
  { id: U(1), status: 'pending' },
  { id: U(2), status: 'pending' },
  { id: U(3), status: 'approved' },
  { id: U(4), status: 'rejected' },
  { id: U(5), status: 'cancelled' },
  { id: U(6), status: 'approved' },
];

check('countsByStatus tallies each status + all', () => {
  const c = countsByStatus(leaves);
  assert.deepEqual(c, { all: 6, pending: 2, approved: 2, rejected: 1, cancelled: 1 });
});
check('countsByStatus on empty list', () => {
  assert.deepEqual(countsByStatus([]), { all: 0, pending: 0, approved: 0, rejected: 0, cancelled: 0 });
});
check('pending partition keeps only pending', () => {
  const pending = leaves.filter((l) => l.status === 'pending');
  assert.equal(pending.length, 2);
  assert.ok(pending.every((l) => l.status === 'pending'));
});

console.log(`\n${passed} passed, 0 failed`);
