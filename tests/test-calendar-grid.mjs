// Tests for the shared month-matrix helper (M15 Plan 5).
// calendar-grid.js has no '/'-absolute imports, so Node can import it directly.

import assert from 'node:assert/strict';
import { monthMatrix, ymd } from '../public/calendar-grid.js';

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log('  ✓', name); }

check('always 42 cells', () => {
  assert.equal(monthMatrix(2026, 5).length, 42);
});

check('ymd formats local date zero-padded', () => {
  assert.equal(ymd(new Date(2026, 0, 3)), '2026-01-03');
});

check('June 2026 (1st is Monday) → no leading offset', () => {
  const m = monthMatrix(2026, 5);   // June (0-based 5)
  assert.equal(m[0].ymd, '2026-06-01');
  assert.equal(m[0].inMonth, true);
});

check('May 2026 (1st is Friday) → 4 leading days from April', () => {
  const m = monthMatrix(2026, 4);   // May
  // Mon Apr 27, Tue 28, Wed 29, Thu 30, then Fri May 1
  assert.equal(m[0].ymd, '2026-04-27');
  assert.equal(m[0].inMonth, false);
  assert.equal(m[4].ymd, '2026-05-01');
  assert.equal(m[4].inMonth, true);
});

check('inMonth count equals days in the month', () => {
  // February 2026 has 28 days; June has 30; July has 31.
  assert.equal(monthMatrix(2026, 1).filter((c) => c.inMonth).length, 28);
  assert.equal(monthMatrix(2026, 5).filter((c) => c.inMonth).length, 30);
  assert.equal(monthMatrix(2026, 6).filter((c) => c.inMonth).length, 31);
});

check('exactly one isToday for the current month, none for a far month', () => {
  const now = new Date();
  const cur = monthMatrix(now.getFullYear(), now.getMonth());
  assert.equal(cur.filter((c) => c.isToday && c.inMonth).length, 1);
  const far = monthMatrix(1990, 0);
  assert.equal(far.filter((c) => c.isToday).length, 0);
});

console.log(`\n${passed} passed, 0 failed`);
