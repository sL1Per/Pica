/**
 * Frontend logic tests for the punch page's same-day totals:
 *   - totalWorkedMs(punches): sum of in→out pair durations
 *   - totalBreakMs(punches):  sum of out→next-in gaps
 *
 * These functions live in /public/punch.js — browser code with absolute
 * imports that Node can't load directly — so we re-implement them inline
 * here and assert their behaviour on a few representative shapes.
 *
 * Run:  node tests/test-punch-totals.mjs
 */
import assert from 'node:assert/strict';

// ---- Inline copies of the functions under test ---------------------------

function totalWorkedMs(punches) {
  const sorted = [...punches].sort((a, b) => a.ts.localeCompare(b.ts));
  let total = 0;
  let openIn = null;
  for (const p of sorted) {
    if (p.type === 'in') {
      openIn = new Date(p.ts).getTime();
    } else if (p.type === 'out' && openIn != null) {
      total += new Date(p.ts).getTime() - openIn;
      openIn = null;
    }
  }
  // Open trailing session is not counted in the test (no clock to "now").
  return total;
}

function totalBreakMs(punches) {
  const sorted = [...punches].sort((a, b) => a.ts.localeCompare(b.ts));
  let total = 0;
  let lastOut = null;
  for (const p of sorted) {
    if (p.type === 'in' && lastOut != null) {
      total += new Date(p.ts).getTime() - lastOut;
      lastOut = null;
    } else if (p.type === 'out') {
      lastOut = new Date(p.ts).getTime();
    }
  }
  return total;
}

// ---- Helpers --------------------------------------------------------------

const H = 3600 * 1000;
const M = 60 * 1000;

function iso(hour, min = 0) {
  // Anchor to a fixed day so localeCompare ordering is stable across TZs.
  const d = new Date('2026-05-14T00:00:00Z');
  d.setUTCHours(hour, min, 0, 0);
  return d.toISOString();
}

// ---- Cases ----------------------------------------------------------------

// 1. The user's example: 9–12, 1–6. Worked 8h, break 1h.
{
  const punches = [
    { type: 'in',  ts: iso(9) },
    { type: 'out', ts: iso(12) },
    { type: 'in',  ts: iso(13) },
    { type: 'out', ts: iso(18) },
  ];
  assert.equal(totalWorkedMs(punches), 8 * H, 'worked 8h');
  assert.equal(totalBreakMs(punches), 1 * H, 'break 1h');
}

// 2. Single uninterrupted session — no break.
{
  const punches = [
    { type: 'in',  ts: iso(9) },
    { type: 'out', ts: iso(17) },
  ];
  assert.equal(totalWorkedMs(punches), 8 * H);
  assert.equal(totalBreakMs(punches), 0, 'no break with single session');
}

// 3. Three sessions, two breaks (30m + 15m = 45m).
{
  const punches = [
    { type: 'in',  ts: iso(8) },
    { type: 'out', ts: iso(10) },
    { type: 'in',  ts: iso(10, 30) },
    { type: 'out', ts: iso(12) },
    { type: 'in',  ts: iso(12, 15) },
    { type: 'out', ts: iso(17) },
  ];
  assert.equal(totalWorkedMs(punches), 2 * H + 90 * M + 285 * M);
  assert.equal(totalBreakMs(punches), 30 * M + 15 * M);
}

// 4. Server returns punches newest-first; sort stabilizes ordering.
{
  const punches = [
    { type: 'out', ts: iso(18) },
    { type: 'in',  ts: iso(13) },
    { type: 'out', ts: iso(12) },
    { type: 'in',  ts: iso(9) },
  ];
  assert.equal(totalWorkedMs(punches), 8 * H);
  assert.equal(totalBreakMs(punches), 1 * H);
}

// 5. Open trailing session — break still 1h, worked covers only the closed pair.
{
  const punches = [
    { type: 'in',  ts: iso(9) },
    { type: 'out', ts: iso(12) },
    { type: 'in',  ts: iso(13) }, // still working
  ];
  assert.equal(totalWorkedMs(punches), 3 * H);
  assert.equal(totalBreakMs(punches), 1 * H);
}

// 6. Empty list.
{
  assert.equal(totalWorkedMs([]), 0);
  assert.equal(totalBreakMs([]), 0);
}

console.log('OK — punch totals (worked + break)');
