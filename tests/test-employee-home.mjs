#!/usr/bin/env node
// Pure-helper tests for the employee home. Logic is re-implemented inline
// (the test-i18n.mjs pattern) because index.js imports /-absolute browser
// modules Node can't resolve. Keep these copies in sync with index.js.
import assert from 'node:assert/strict';

// --- copies of index.js pure helpers (keep in sync) ---
function greetingKeyFor(d) {
  const h = d.getHours();
  if (h < 5)  return 'home.greet.late';
  if (h < 12) return 'home.greet.morning';
  if (h < 18) return 'home.greet.afternoon';
  return 'home.greet.evening';
}
function pairWorkedMs(punches, nowMs) {
  // punches: [{type,ts}] ascending. Returns {workedMs, open, segments:[{startMs,endMs,live}]}.
  let open = null, workedMs = 0; const segments = [];
  for (const p of punches) {
    if (p.type === 'in') open = new Date(p.ts).getTime();
    else if (p.type === 'out' && open != null) {
      const end = new Date(p.ts).getTime();
      segments.push({ startMs: open, endMs: end, live: false }); workedMs += end - open; open = null;
    }
  }
  let isOpen = false;
  if (open != null) { segments.push({ startMs: open, endMs: nowMs, live: true }); workedMs += nowMs - open; isOpen = true; }
  return { workedMs, open: isOpen, segments };
}
function weekBars(period, buckets, todayYmd) {
  // period:{from,to}; buckets:[{key:ymd,hours}]. Returns one entry per day from..to.
  // Use UTC noon to iterate — avoids local-midnight rollback in UTC+ timezones.
  const byKey = new Map(buckets.map((b) => [b.key, b.hours]));
  const out = []; const d = new Date(period.from + 'T12:00:00Z');
  const end = new Date(period.to + 'T12:00:00Z');
  while (d <= end) {
    const ymd = d.toISOString().slice(0, 10);
    out.push({ ymd, hours: byKey.get(ymd) || 0, today: ymd === todayYmd, dow: d.getUTCDay() });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

let passed = 0, failed = 0;
const test = (n, f) => { try { f(); console.log(`  ✓ ${n}`); passed++; }
  catch (e) { console.error(`  ✗ ${n}\n    ${e.message}`); failed++; } };

console.log('greetingKeyFor');
test('00:30 → late',      () => assert.equal(greetingKeyFor(new Date(2026,4,23,0,30)),  'home.greet.late'));
test('09:00 → morning',   () => assert.equal(greetingKeyFor(new Date(2026,4,23,9,0)),   'home.greet.morning'));
test('14:00 → afternoon', () => assert.equal(greetingKeyFor(new Date(2026,4,23,14,0)),  'home.greet.afternoon'));
test('20:00 → evening',   () => assert.equal(greetingKeyFor(new Date(2026,4,23,20,0)),  'home.greet.evening'));

console.log('pairWorkedMs');
test('two closed sessions sum', () => {
  const r = pairWorkedMs([
    { type:'in', ts:'2026-05-23T08:00:00Z' }, { type:'out', ts:'2026-05-23T10:00:00Z' },
    { type:'in', ts:'2026-05-23T11:00:00Z' }, { type:'out', ts:'2026-05-23T12:00:00Z' },
  ], Date.parse('2026-05-23T13:00:00Z'));
  assert.equal(r.open, false); assert.equal(r.segments.length, 2);
  assert.equal(r.workedMs, 3 * 3600_000);
});
test('open session counts to now + marks live', () => {
  const now = Date.parse('2026-05-23T09:30:00Z');
  const r = pairWorkedMs([{ type:'in', ts:'2026-05-23T09:00:00Z' }], now);
  assert.equal(r.open, true);
  assert.equal(r.segments.at(-1).live, true);
  assert.equal(r.workedMs, 30 * 60_000);
});
test('no punches → zero', () => {
  const r = pairWorkedMs([], Date.now());
  assert.equal(r.workedMs, 0); assert.equal(r.open, false); assert.equal(r.segments.length, 0);
});

console.log('weekBars');
test('one bar per day, today flagged, missing day = 0', () => {
  const bars = weekBars({ from:'2026-05-18', to:'2026-05-24' },
    [{ key:'2026-05-18', hours: 8 }, { key:'2026-05-20', hours: 7.5 }], '2026-05-20');
  assert.equal(bars.length, 7);
  assert.equal(bars[0].hours, 8);
  assert.equal(bars[1].hours, 0);          // 05-19 absent → 0
  assert.equal(bars[2].today, true);       // 05-20
  assert.equal(bars[2].hours, 7.5);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
