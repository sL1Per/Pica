import assert from 'node:assert/strict';
import { buildOverview } from '../src/storage/report-overview.js';

// --- Minimal in-memory fakes -------------------------------------------------
function fakePunches(byUser) {
  return {
    listMonth(userId, year, month) {
      return (byUser[userId] || []).filter((p) => {
        const d = new Date(p.ts);
        return d.getFullYear() === year && d.getMonth() + 1 === month;
      });
    },
  };
}
function fakeLeaves(byUser) {
  return {
    list({ employeeId }) { return byUser[employeeId] || []; },
    computeBalances() { return []; },
  };
}
const wt = () => ({ dailyHours: 8, expectedStart: '09:00', graceMinutes: 10 });
const leaveCtx = { orgSettings: {}, leaveTypes: ['vacation','sick','appointment','other'], daysOf: () => 1 };

let passed = 0; const test = (n, f) => { f(); passed++; console.log('ok -', n); };

test('worked, target and overtime for one person', () => {
  // Mon 2026-05-11 09:00–18:00 = 9h worked; target = 8h/day × 1 weekday = 8h.
  const punches = fakePunches({
    u1: [
      { type: 'in',  ts: '2026-05-11T09:00:00' },
      { type: 'out', ts: '2026-05-11T18:00:00' },
    ],
  });
  const r = buildOverview({
    punchesStore: punches, leavesStore: fakeLeaves({}),
    people: [{ id: 'u1', name: 'Ann', role: 'employee' }],
    from: '2026-05-11', to: '2026-05-11', bucketBy: 'day', label: 'Mon',
    workingTimeFor: wt, leaveCtx, scope: 'me',
    now: new Date('2026-05-12T00:00:00'),
  });
  assert.equal(r.people[0].worked, 9);
  assert.equal(r.people[0].target, 8);
  assert.equal(r.people[0].overtime, 1);
  assert.equal(r.kpis.totalHours, 9);
  assert.equal(r.kpis.targetHours, 8);
  assert.equal(r.kpis.overtimeHours, 1);
  assert.equal(r.kpis.vsTargetPct, 113); // 9/8*100 rounded
});

test('punctuality: on-time %, avg clock-in, late days', () => {
  // Two worked weekdays. Day 1 in 08:55 (on time, ≤ 09:10). Day 2 in 09:30 (late).
  const punches = fakePunches({
    u1: [
      { type: 'in',  ts: '2026-05-11T08:55:00' }, { type: 'out', ts: '2026-05-11T17:00:00' },
      { type: 'in',  ts: '2026-05-12T09:30:00' }, { type: 'out', ts: '2026-05-12T17:00:00' },
    ],
  });
  const r = buildOverview({
    punchesStore: punches, leavesStore: fakeLeaves({}),
    people: [{ id: 'u1', name: 'Ann', role: 'employee' }],
    from: '2026-05-11', to: '2026-05-12', bucketBy: 'day', label: 'wk',
    workingTimeFor: wt, leaveCtx, scope: 'me',
    now: new Date('2026-05-13T00:00:00'),
  });
  const row = r.people[0];
  assert.equal(row.lateDays, 1);
  assert.equal(row.onTimePct, 50);    // 1 of 2 days on time
  assert.equal(row.avgClockIn, '09:12'); // mean of 08:55 and 09:30 = 09:12.5 → 09:12
});

test('breaks: intra-day gap between out and next in', () => {
  // 09:00 in → 12:00 out → (1h break) → 13:00 in → 17:00 out. Break = 60 min.
  const punches = fakePunches({
    u1: [
      { type: 'in',  ts: '2026-05-11T09:00:00' }, { type: 'out', ts: '2026-05-11T12:00:00' },
      { type: 'in',  ts: '2026-05-11T13:00:00' }, { type: 'out', ts: '2026-05-11T17:00:00' },
    ],
  });
  const r = buildOverview({
    punchesStore: punches, leavesStore: fakeLeaves({}),
    people: [{ id: 'u1', name: 'Ann', role: 'employee' }],
    from: '2026-05-11', to: '2026-05-11', bucketBy: 'day', label: 'd',
    workingTimeFor: wt, leaveCtx, scope: 'me',
    now: new Date('2026-05-12T00:00:00'),
  });
  assert.equal(r.people[0].avgBreakMin, 60);
  assert.equal(r.breaksSeries.length, 1);
  assert.equal(r.breaksSeries[0].avgBreakMin, 60);
});

test('hoursSeries: per-bucket worked and target', () => {
  const punches = fakePunches({
    u1: [
      { type: 'in',  ts: '2026-05-11T09:00:00' }, { type: 'out', ts: '2026-05-11T17:00:00' }, // 8h Mon
    ],
  });
  const r = buildOverview({
    punchesStore: punches, leavesStore: fakeLeaves({}),
    people: [{ id: 'u1', name: 'Ann', role: 'employee' }],
    from: '2026-05-11', to: '2026-05-12', bucketBy: 'day', label: 'wk',
    workingTimeFor: wt, leaveCtx, scope: 'all',
    now: new Date('2026-05-13T00:00:00'),
  });
  const mon = r.hoursSeries.find((s) => s.key === '2026-05-11');
  assert.equal(mon.worked, 8);
  assert.equal(mon.target, 8);     // one person × 8h on a weekday
  const tue = r.hoursSeries.find((s) => s.key === '2026-05-12');
  assert.equal(tue.worked, 0);
});

test('leaves: by type, totals, on-leave per person, watchlist order', () => {
  const leaves = fakeLeaves({
    u1: [{ id: 'l1', type: 'vacation', unit: 'days', start: '2026-05-11', end: '2026-05-12', status: 'approved' }],
    u2: [],
  });
  const r = buildOverview({
    punchesStore: fakePunches({}), leavesStore: leaves,
    people: [
      { id: 'u1', name: 'Ann', role: 'employee' },
      { id: 'u2', name: 'Bo', role: 'employee' },
    ],
    from: '2026-05-11', to: '2026-05-15', bucketBy: 'day', label: 'wk',
    workingTimeFor: wt, leaveCtx, scope: 'all',
    now: new Date('2026-05-16T00:00:00'),
  });
  const vac = r.leaveByType.find((x) => x.type === 'vacation');
  assert.equal(vac.days, 2);
  assert.equal(r.leaveTotalDays, 2);
  assert.equal(r.people.find((p) => p.id === 'u1').onLeave, 2);
  // coverage gaps: nobody clocked in on 5 weekdays → all gaps (>0).
  assert.ok(r.kpis.coverageGaps > 0);
  // watchlist sorted by onTimePct asc; null on-time (no work) sorts last.
  assert.equal(r.watchlist.length, 2);
});

test('onLeave per bucket: weekday days-unit uses dailyHours, weekend excluded', () => {
  // Vacation Fri 2026-05-15 .. Mon 2026-05-18 (Sat 05-16 / Sun 05-17 inside). Person dailyHours=8.
  const leaves = fakeLeaves({ u1: [
    { id: 'l1', type: 'vacation', unit: 'days', start: '2026-05-15', end: '2026-05-18', status: 'approved' },
  ] });
  const r = buildOverview({
    punchesStore: fakePunches({}), leavesStore: leaves,
    people: [{ id: 'u1', name: 'Ann', role: 'employee' }],
    from: '2026-05-15', to: '2026-05-18', bucketBy: 'day', label: 'wk',
    workingTimeFor: wt, leaveCtx, scope: 'me',
    now: new Date('2026-05-19T00:00:00'),
  });
  const fri = r.hoursSeries.find((s) => s.key === '2026-05-15');
  const sat = r.hoursSeries.find((s) => s.key === '2026-05-16');
  const mon = r.hoursSeries.find((s) => s.key === '2026-05-18');
  assert.equal(fri.onLeave, 8);   // weekday → dailyHours
  assert.equal(sat.onLeave, 0);   // weekend excluded
  assert.equal(mon.onLeave, 8);   // weekday → dailyHours
});

test('onLeave per bucket: hours-unit leave credits actual hours, not a full day', () => {
  const leaves = fakeLeaves({ u1: [
    { id: 'l2', type: 'appointment', unit: 'hours', start: '2026-05-15T10:00:00', end: '2026-05-15T12:00:00', hours: 2, status: 'approved' },
  ] });
  const r = buildOverview({
    punchesStore: fakePunches({}), leavesStore: leaves,
    people: [{ id: 'u1', name: 'Ann', role: 'employee' }],
    from: '2026-05-15', to: '2026-05-15', bucketBy: 'day', label: 'd',
    workingTimeFor: wt, leaveCtx, scope: 'me',
    now: new Date('2026-05-16T00:00:00'),
  });
  assert.equal(r.hoursSeries[0].onLeave, 2);  // actual hours, not 8
});

console.log(`\n${passed} passed`);
